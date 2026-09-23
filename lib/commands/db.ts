import "server-only";

// Pool-bound helpers for the command layer inside Next.js: a transaction
// runner over lib/db's pool, and principal resolution from the request
// (session cookie / bearer token / service secret). Pure logic lives in the
// sibling modules so node --test can drive it against the harness.

import { pool, bumpLiveChange } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/dal";
import { getUserFromRequest } from "@/lib/api-auth";
import type { Run } from "./core";
import { runCommand, type CommandContext, type CommandOutcome, type CommandSpec } from "./core";
import type { AgentPrincipal, Principal, ServicePrincipal, UserPrincipal } from "./principal";

export type { Run } from "./core";

const WRITE_SQL = /^\s*(insert\s+into|update|delete\s+from)\s+(?:only\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i;

/** Run `fn` inside one transaction on a dedicated pool client. */
export async function withTransaction<T>(fn: (run: Run) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const touched = new Set<string>();
  const run: Run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
    const res = await client.query(sql, params as never[]);
    const m = WRITE_SQL.exec(sql);
    if (m && (res.rowCount ?? 0) > 0) touched.add(m[2].toLowerCase());
    return res.rows as R[];
  };
  try {
    await client.query("BEGIN");
    const out = await fn(run);
    await client.query("COMMIT");
    for (const t of touched) bumpLiveChange(t);
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Autocommit runner for reads / single statements outside a command. */
export const runDirect: Run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
  const res = await pool.query(sql, params as never[]);
  const m = WRITE_SQL.exec(sql);
  if (m && (res.rowCount ?? 0) > 0) bumpLiveChange(m[2].toLowerCase());
  return res.rows as R[];
};

/** The app-side entry point: runCommand over the shared pool. */
export function command<I, R>(spec: CommandSpec<I>, handler: (ctx: CommandContext, input: I) => Promise<CommandOutcome<R>>) {
  return runCommand(withTransaction, spec, handler);
}

// ── Principal resolution (server-derived, never from a body) ────────────────

export function userPrincipal(u: CurrentUser): UserPrincipal {
  return { kind: "user", userId: u.id, role: u.role, name: u.name, permissions: u.permissions, linkSlug: u.linkSlug };
}

/** The signed-in user from the session cookie, or null. */
export async function sessionPrincipal(): Promise<UserPrincipal | null> {
  const u = await getCurrentUser();
  return u ? userPrincipal(u) : null;
}

/** Bearer-token user (mobile API), or null. */
export async function bearerPrincipal(req: Request): Promise<UserPrincipal | null> {
  const u = await getUserFromRequest(req);
  return u ? userPrincipal(u) : null;
}

/** Trusted local caller (cron timers, the MCP server, workers) authenticated
 *  with CRON_SECRET. Fails closed when the secret is unset. */
export function servicePrincipal(req: Request, name: string): ServicePrincipal | null {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return null;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}` ? { kind: "service", name } : null;
}

/** An agent acting for a person. The person is looked up by id on the server
 *  (an agent cannot claim a role); an unknown/inactive id yields an unattended
 *  agent with NO human authority. */
export async function agentPrincipal(agent: string, opts: { onBehalfOfUserId?: string | null; runId?: string | null }): Promise<AgentPrincipal> {
  let onBehalfOf: UserPrincipal | null = null;
  if (opts.onBehalfOfUserId) {
    const rows = await runDirect<{ id: string; role: UserPrincipal["role"]; name: string; permissions: string[] | null; active: boolean; link_slug: string | null }>(
      `SELECT id, role, name, permissions, active, link_slug FROM users WHERE id = $1`,
      [opts.onBehalfOfUserId],
    );
    const u = rows[0];
    if (u?.active) {
      const { normalizePermissions } = await import("@/lib/permissions");
      onBehalfOf = { kind: "user", userId: u.id, role: u.role, name: u.name, permissions: u.role === "staff" ? normalizePermissions(u.permissions) : [], linkSlug: u.link_slug };
    }
  }
  return { kind: "agent", agent, runId: opts.runId ?? null, onBehalfOf };
}

/** The active owner account as a principal — for automatic policy actions
 *  that must be attributed to the company (policy auth_ref), never for
 *  approvals. */
export async function ownerPrincipalForPolicy(): Promise<Principal> {
  const rows = await runDirect<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'owner' AND active = true ORDER BY created_at LIMIT 1`);
  const u = rows[0];
  return u ? { kind: "service", name: `policy-on-behalf-of:${u.id}` } : { kind: "service", name: "policy" };
}
