// Permanent external-action intents + append-only attempts (A03a / A05/A06).
//
// An intent is created INSIDE a command transaction (so a rollback erases it)
// and dispatched AFTER commit by lib/commands/dispatch.ts. operation_key is the
// stable economic identity of the operation — "invoice:42:send:rev3",
// "po:7:send:rev1", "square:charge:inv42:att1" — so a retried command, a
// second caller or a restored backup cannot enqueue a second copy. Same key
// with a different payload is refused (the artifact changed → new revision →
// new key → fresh decision).
//
// State machine (DESIGN.md): pending → leased → accepted → confirmed
//                              ↘ retryable_failure (→ pending after backoff)
//                              ↘ unknown (held; reconcile before any retry)
//                              ↘ permanent_failure | cancelled | held
// A timeout after transmission is `unknown`, never a retry.

import { createHash, randomUUID } from "node:crypto";
import type { Run } from "./core.ts";
import { canonicalJson, redactPrincipal } from "./core.ts";
import type { Principal } from "./principal.ts";

export type IntentState =
  | "pending"
  | "leased"
  | "accepted"
  | "confirmed"
  | "retryable_failure"
  | "unknown"
  | "permanent_failure"
  | "cancelled"
  | "held";

export interface ActionIntent {
  id: string;
  operation_key: string;
  kind: string;
  target_kind: string | null;
  target_id: string | null;
  recipient: string | null;
  project_id: string | null;
  lead_id: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  artifact_revision: string | null;
  decision_id: string | null;
  grant_id: string | null;
  policy_ref: string | null;
  command_id: string | null;
  state: IntentState;
  hold_reason: string | null;
  provider: string | null;
  provider_ref: string | null;
  provider_state: string | null;
  lease_token: string | null;
  lease_until: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
}

export class IntentPayloadMismatchError extends Error {
  constructor(key: string) {
    super(`An action with operation key "${key}" already exists with a different payload; stage a new revision instead of overwriting it.`);
    this.name = "IntentPayloadMismatchError";
  }
}

export const INTENT_COLS = `id, operation_key, kind, target_kind, target_id, recipient, project_id, lead_id, payload, payload_hash,
  artifact_revision, decision_id, grant_id, policy_ref, command_id, state, hold_reason, provider, provider_ref, provider_state,
  lease_token, lease_until::text AS lease_until, attempts, max_attempts, next_attempt_at::text AS next_attempt_at, last_error,
  created_at::text AS created_at, completed_at::text AS completed_at`;

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export interface EnqueueIntentInput {
  operationKey: string;
  kind: string;
  targetKind?: string | null;
  targetId?: string | number | null;
  recipient?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  payload: Record<string, unknown>;
  artifactRevision?: string | null;
  decisionId?: string | null;
  grantId?: string | null;
  policyRef?: string | null;
  commandId?: string | null;
  principal: Principal;
  maxAttempts?: number;
  /** Create in 'held' with this reason instead of 'pending' (e.g. lane paused). */
  hold?: string | null;
}

/** Idempotently create an intent. Returns { intent, created }. */
export async function enqueueIntent(run: Run, input: EnqueueIntentInput): Promise<{ intent: ActionIntent; created: boolean }> {
  const payloadHash = hashPayload(input.payload);
  const [inserted] = await run<ActionIntent>(
    `INSERT INTO action_intents
       (operation_key, kind, target_kind, target_id, recipient, project_id, lead_id, payload, payload_hash, artifact_revision,
        decision_id, grant_id, policy_ref, command_id, principal, state, hold_reason, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18)
     ON CONFLICT (operation_key) DO NOTHING
     RETURNING ${INTENT_COLS}`,
    [
      input.operationKey,
      input.kind,
      input.targetKind ?? null,
      input.targetId == null ? null : String(input.targetId),
      input.recipient?.trim().toLowerCase() ?? null,
      input.projectId ?? null,
      input.leadId ?? null,
      canonicalJson(input.payload),
      payloadHash,
      input.artifactRevision ?? null,
      input.decisionId ?? null,
      input.grantId ?? null,
      input.policyRef ?? null,
      input.commandId ?? null,
      JSON.stringify(redactPrincipal(input.principal)),
      input.hold ? "held" : "pending",
      input.hold ?? null,
      input.maxAttempts ?? 5,
    ],
  );
  if (inserted) return { intent: inserted, created: true };
  const [existing] = await run<ActionIntent>(`SELECT ${INTENT_COLS} FROM action_intents WHERE operation_key = $1`, [input.operationKey]);
  if (!existing) throw new Error("intent vanished after conflict");
  if (existing.payload_hash !== payloadHash) throw new IntentPayloadMismatchError(input.operationKey);
  return { intent: existing, created: false };
}

export async function getIntent(run: Run, id: string): Promise<ActionIntent | null> {
  const [row] = await run<ActionIntent>(`SELECT ${INTENT_COLS} FROM action_intents WHERE id = $1`, [id]);
  return row ?? null;
}

export async function getIntentByKey(run: Run, operationKey: string): Promise<ActionIntent | null> {
  const [row] = await run<ActionIntent>(`SELECT ${INTENT_COLS} FROM action_intents WHERE operation_key = $1`, [operationKey]);
  return row ?? null;
}

/** Claim up to `limit` dispatchable intents of the given kinds with a bounded
 *  lease. FOR UPDATE SKIP LOCKED makes concurrent workers disjoint; the lease
 *  token fences every later write from a stale worker. */
export async function claimIntents(
  run: Run,
  opts: { kinds?: string[]; limit?: number; leaseSeconds?: number; worker: string },
): Promise<{ token: string; intents: ActionIntent[] }> {
  const token = randomUUID();
  const rows = await run<ActionIntent>(
    `WITH picked AS (
       SELECT id FROM action_intents
        WHERE state IN ('pending','retryable_failure')
          AND next_attempt_at <= now()
          AND (lease_until IS NULL OR lease_until < now())
          AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
        ORDER BY next_attempt_at, created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED)
     UPDATE action_intents a
        SET state = 'leased', lease_token = $3, lease_until = now() + ($4::int * interval '1 second'),
            attempts = attempts + 1
       FROM picked WHERE a.id = picked.id
     RETURNING ${INTENT_COLS.replace(/\b(id|operation_key|kind|target_kind|target_id|recipient|project_id|lead_id|payload|payload_hash|artifact_revision|decision_id|grant_id|policy_ref|command_id|state|hold_reason|provider|provider_ref|provider_state|lease_token|attempts|max_attempts|last_error)\b(?=,|$| )/g, "a.$1").replace(/lease_until::text/, "a.lease_until::text").replace(/next_attempt_at::text/, "a.next_attempt_at::text").replace(/created_at::text/, "a.created_at::text").replace(/completed_at::text/, "a.completed_at::text")}`,
    [opts.kinds ?? null, opts.limit ?? 20, token, opts.leaseSeconds ?? 120],
  );
  return { token, intents: rows };
}

export async function heartbeatLease(run: Run, id: string, token: string, seconds = 120): Promise<boolean> {
  const rows = await run(
    `UPDATE action_intents SET lease_until = now() + ($3::int * interval '1 second')
      WHERE id = $1 AND lease_token = $2 AND state = 'leased' RETURNING id`,
    [id, token, seconds],
  );
  return rows.length === 1;
}

export type ResponseClass = "accepted" | "confirmed" | "retryable" | "unknown" | "permanent" | "skipped";

export interface AttemptResult {
  responseClass: ResponseClass;
  providerRef?: string | null;
  providerState?: string | null;
  provider?: string | null;
  error?: string | null;
  requestSummary?: Record<string, unknown>;
  /** Backoff for retryable failures (seconds). */
  retryInSeconds?: number;
}

/** Record an attempt and move the intent. Every write is fenced on the lease
 *  token: a stale worker whose lease expired and was re-claimed cannot flip
 *  the state under the new holder. Returns the new state or null when fenced. */
export async function finishAttempt(run: Run, id: string, token: string, worker: string, r: AttemptResult): Promise<IntentState | null> {
  const [cur] = await run<{ attempts: number; max_attempts: number; state: IntentState }>(
    `SELECT attempts, max_attempts, state FROM action_intents WHERE id = $1 AND lease_token = $2 FOR UPDATE`,
    [id, token],
  );
  if (!cur) return null;
  await run(
    `INSERT INTO action_attempts (intent_id, attempt_no, lease_token, worker, request_summary, response_class, provider_ref, error, finished_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())
     ON CONFLICT (intent_id, attempt_no) DO NOTHING`,
    [id, cur.attempts, token, worker, JSON.stringify(r.requestSummary ?? {}), r.responseClass, r.providerRef ?? null, r.error?.slice(0, 2000) ?? null],
  );
  let next: IntentState;
  let nextAttempt = "now()";
  switch (r.responseClass) {
    case "confirmed":
      next = "confirmed";
      break;
    case "accepted":
      next = "accepted";
      break;
    case "unknown":
      next = "unknown"; // held for reconciliation; never auto-retried
      break;
    case "permanent":
      next = "permanent_failure";
      break;
    case "skipped":
      next = "cancelled";
      break;
    case "retryable":
    default:
      if (cur.attempts >= cur.max_attempts) next = "permanent_failure";
      else {
        next = "retryable_failure";
        const backoff = r.retryInSeconds ?? Math.min(3600, 30 * 2 ** Math.max(0, cur.attempts - 1));
        nextAttempt = `now() + (${Math.floor(backoff)} * interval '1 second')`;
      }
  }
  await run(
    `UPDATE action_intents
        SET state = $3, provider = COALESCE($4, provider), provider_ref = COALESCE($5, provider_ref),
            provider_state = COALESCE($6, provider_state), last_error = $7,
            lease_token = NULL, lease_until = NULL, next_attempt_at = ${nextAttempt},
            completed_at = CASE WHEN $3 IN ('confirmed','permanent_failure','cancelled') THEN now() ELSE completed_at END
      WHERE id = $1 AND lease_token = $2`,
    [id, token, next, r.provider ?? null, r.providerRef ?? null, r.providerState ?? null, r.error?.slice(0, 2000) ?? null],
  );
  return next;
}

/** Reconciliation outcome for an accepted/unknown intent (provider poll or
 *  webhook told us what really happened). Not lease-fenced: reconciliation
 *  is authoritative evidence, not a worker's guess. */
export async function reconcileIntent(
  run: Run,
  id: string,
  outcome: { state: "confirmed" | "permanent_failure" | "pending"; providerRef?: string | null; providerState?: string | null; note?: string },
): Promise<void> {
  await run(
    `UPDATE action_intents
        SET state = $2, provider_ref = COALESCE($3, provider_ref), provider_state = COALESCE($4, provider_state),
            last_error = COALESCE($5, last_error), lease_token = NULL, lease_until = NULL,
            next_attempt_at = CASE WHEN $2 = 'pending' THEN now() ELSE next_attempt_at END,
            completed_at = CASE WHEN $2 IN ('confirmed','permanent_failure') THEN now() ELSE NULL END
      WHERE id = $1 AND state IN ('accepted','unknown','leased','held')`,
    [id, outcome.state, outcome.providerRef ?? null, outcome.providerState ?? null, outcome.note ?? null],
  );
}

export async function holdIntent(run: Run, id: string, reason: string): Promise<void> {
  await run(`UPDATE action_intents SET state = 'held', hold_reason = $2, lease_token = NULL, lease_until = NULL WHERE id = $1 AND state IN ('pending','retryable_failure','leased')`, [id, reason]);
}

export async function releaseHold(run: Run, id: string): Promise<void> {
  await run(`UPDATE action_intents SET state = 'pending', hold_reason = NULL, next_attempt_at = now() WHERE id = $1 AND state = 'held'`, [id]);
}

export async function cancelIntent(run: Run, id: string, reason: string): Promise<boolean> {
  const rows = await run(
    `UPDATE action_intents SET state = 'cancelled', last_error = $2, completed_at = now(), lease_token = NULL, lease_until = NULL
      WHERE id = $1 AND state IN ('pending','retryable_failure','held') RETURNING id`,
    [id, reason],
  );
  return rows.length === 1;
}

/** Leases that expired while 'leased': the worker died mid-call. Whether the
 *  provider received the request is unknowable here, so they become 'unknown'
 *  (held for reconciliation) unless the kind is marked reconcile-free. */
export async function sweepExpiredLeases(run: Run, opts: { retryableKinds?: string[] } = {}): Promise<{ unknown: number; requeued: number }> {
  const requeued = await run(
    `UPDATE action_intents SET state = 'retryable_failure', lease_token = NULL, lease_until = NULL, next_attempt_at = now(),
            last_error = COALESCE(last_error, 'lease expired before the provider was called')
      WHERE state = 'leased' AND lease_until < now() AND kind = ANY($1::text[]) RETURNING id`,
    [opts.retryableKinds ?? []],
  );
  const unknown = await run(
    `UPDATE action_intents SET state = 'unknown', lease_token = NULL, lease_until = NULL,
            last_error = COALESCE(last_error, 'worker lease expired mid-call; outcome unknown until reconciled')
      WHERE state = 'leased' AND lease_until < now() RETURNING id`,
  );
  return { unknown: unknown.length, requeued: requeued.length };
}

export async function listOpenIntents(run: Run, opts: { limit?: number } = {}): Promise<ActionIntent[]> {
  return run<ActionIntent>(
    `SELECT ${INTENT_COLS} FROM action_intents WHERE state NOT IN ('confirmed','permanent_failure','cancelled') ORDER BY created_at LIMIT $1`,
    [opts.limit ?? 200],
  );
}
