// Shared server command infrastructure (A03a).
//
// Every business action — from the UI, the MCP server, a cron route, a
// webhook handler or a worker — runs through runCommand() with a trusted
// Principal the SERVER derived (lib/commands/principal.ts). The caller cannot
// submit "I am the owner". A command is keyed by (name, request_key):
//
//   • same key + same input      → the stored result is returned, the handler
//                                   does not run again (safe retry);
//   • same key + different input → CommandConflictError;
//   • concurrent same key        → the second caller blocks on the row lock
//                                   and then sees the first caller's result.
//
// Business state, audit and external-action INTENTS (lib/commands/intents.ts)
// are written in the same PostgreSQL transaction. Network calls never happen
// inside; the handler returns `afterCommit` hooks (dispatcher kick,
// notifications) that run only once the transaction is committed, so a
// rollback leaves no dispatchable intent behind.
//
// NO "server-only" import here on purpose: node --test imports this file
// straight from tests/ with a real pg.Client. Callers inside Next.js get the
// pool-bound wrapper from lib/commands/db.ts.

import { createHash } from "node:crypto";
import type { Principal } from "./principal.ts";

export type Run = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export class CommandConflictError extends Error {
  constructor(name: string, requestKey: string) {
    super(`Command ${name} was already run with request key "${requestKey}" and different input.`);
    this.name = "CommandConflictError";
  }
}

export class CommandAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandAuthError";
  }
}

/** Deterministic JSON: sorted keys, so two callers building the same input in
 *  a different order hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function hashInput(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface CommandSpec<I> {
  /** Dotted business name, e.g. "invoice.issue_milestone". */
  name: string;
  /** Caller idempotency key; scoped by name. Use the business operation key
   *  (e.g. `invoice:${id}:send`) so retries from any surface collapse. */
  requestKey: string;
  input: I;
  principal: Principal;
  /** What authorised this: "decision:<id>", "grant:<id>", "policy:<key>@<v>", "owner". */
  authRef?: string | null;
}

export interface CommandOutcome<R> {
  result: R;
  /** Run after COMMIT (dispatcher kicks, owner pushes). Never inside the tx. */
  afterCommit?: Array<() => Promise<void>>;
}

export interface CommandContext {
  run: Run;
  commandId: string;
  principal: Principal;
  authRef: string | null;
}

interface CommandRow {
  id: string;
  status: "running" | "succeeded" | "failed";
  input_hash: string;
  result: unknown;
  error: string | null;
}

/** Execute `handler` exactly once per (name, request_key). `tx` must run its
 *  callback inside ONE transaction and roll back if it throws. */
export async function runCommand<I, R>(
  tx: <T>(fn: (run: Run) => Promise<T>) => Promise<T>,
  spec: CommandSpec<I>,
  handler: (ctx: CommandContext, input: I) => Promise<CommandOutcome<R>>,
): Promise<{ result: R; replayed: boolean; commandId: string }> {
  const inputHash = hashInput(spec.input);
  const principalJson = JSON.stringify(redactPrincipal(spec.principal));
  const principalUserId = spec.principal.kind === "user" ? spec.principal.userId : spec.principal.kind === "agent" ? spec.principal.onBehalfOf?.userId ?? null : null;

  let hooks: Array<() => Promise<void>> = [];
  let failure: { id: string; error: string } | null = null;

  const outcome = await tx(async (run) => {
    await run(
      `INSERT INTO commands (name, request_key, input_hash, input, principal, principal_user_id, auth_ref)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (name, request_key) DO NOTHING`,
      [spec.name, spec.requestKey, inputHash, canonicalJson(spec.input), principalJson, principalUserId, spec.authRef ?? null],
    );
    // Row lock serializes concurrent callers with the same key.
    const [row] = await run<CommandRow>(
      `SELECT id, status, input_hash, result, error FROM commands WHERE name = $1 AND request_key = $2 FOR UPDATE`,
      [spec.name, spec.requestKey],
    );
    if (!row) throw new Error("command row vanished");
    if (row.input_hash !== inputHash) throw new CommandConflictError(spec.name, spec.requestKey);
    if (row.status === "succeeded") return { result: row.result as R, replayed: true, commandId: row.id };
    if (row.status === "running") {
      // Ours (fresh insert) or a crashed earlier run that never finished. A
      // crashed run's transaction rolled back, so re-running is correct.
    }
    if (row.status === "failed") {
      await run(`UPDATE commands SET status = 'running', error = NULL, started_at = now(), finished_at = NULL WHERE id = $1`, [row.id]);
    }
    try {
      const out = await handler({ run, commandId: row.id, principal: spec.principal, authRef: spec.authRef ?? null }, spec.input);
      await run(`UPDATE commands SET status = 'succeeded', result = $2::jsonb, finished_at = now() WHERE id = $1`, [
        row.id,
        JSON.stringify(out.result ?? null),
      ]);
      hooks = out.afterCommit ?? [];
      return { result: out.result, replayed: false, commandId: row.id };
    } catch (err) {
      failure = { id: row.id, error: (err as Error).message ?? String(err) };
      throw err;
    }
  }).catch(async (err) => {
    // The transaction rolled back (business writes + intents gone). Record the
    // failure on the command row best-effort so the audit shows the attempt.
    if (failure && !(err instanceof CommandConflictError)) {
      try {
        await tx(async (run) => {
          await run(
            `INSERT INTO commands (name, request_key, input_hash, input, principal, principal_user_id, auth_ref, status, error, finished_at)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'failed', $8, now())
             ON CONFLICT (name, request_key) DO UPDATE SET status = 'failed', error = EXCLUDED.error, finished_at = now()`,
            [spec.name, spec.requestKey, inputHash, canonicalJson(spec.input), principalJson, principalUserId, spec.authRef ?? null, failure!.error.slice(0, 2000)],
          );
        });
      } catch {
        /* audit is best-effort here; the caller still sees the error */
      }
    }
    throw err;
  });

  for (const h of hooks) {
    try {
      await h();
    } catch (err) {
      // Post-commit hooks are kicks, not effects: the durable intent/row is
      // already committed and a sweep will pick it up.
      console.error(`[commands] afterCommit hook failed for ${spec.name}:`, (err as Error).message);
    }
  }
  return outcome;
}

/** The principal stored on audit rows: identity, never secrets/tokens. */
export function redactPrincipal(p: Principal): Record<string, unknown> {
  if (p.kind === "user") return { kind: "user", userId: p.userId, role: p.role, name: p.name };
  if (p.kind === "service") return { kind: "service", name: p.name };
  return {
    kind: "agent",
    agent: p.agent,
    runId: p.runId ?? null,
    onBehalfOf: p.onBehalfOf ? { userId: p.onBehalfOf.userId, role: p.onBehalfOf.role, name: p.onBehalfOf.name } : null,
  };
}
