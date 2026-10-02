// Event wakeup queue for background agent runs (A24): agent_triggers.
//
//   enqueueAgentTrigger(run, { kind, ref, projectId, leadId, payload })
//     Idempotent on (kind, ref). A pending/leased trigger is returned as-is
//     (times_seen bumped, payload merged); a done/failed one is re-opened so a
//     repeated event resumes the same work rather than spawning a duplicate.
//     Callers: WS-money (payment / acceptance), WS-field (field_report /
//     signoff), WS-recovery (message / note / approval), WS-procurement
//     (quote), WS-estimating (selection), esign (signature). Call it INSIDE
//     the command transaction that persisted the event.
//   claimAgentTriggers(run, { worker, limit, leaseSeconds })
//     FOR UPDATE SKIP LOCKED lease; attempts++.
//   finishAgentTrigger(run, id, token, outcome)
//     done | retry (backoff, or failed once attempts >= max) | failed.
//   sweepStrandedTriggers(run)
//     expired leases back to pending (or failed past max_attempts).
//
// Pure over run(sql, params).

import { randomUUID } from "node:crypto";
import type { Run } from "../commands/core.ts";

export const TRIGGER_KINDS = ["signature", "message", "note", "quote", "selection", "payment", "field_report", "approval", "signoff", "sweep"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface AgentTrigger {
  id: string;
  kind: TriggerKind;
  ref: string;
  project_id: string | null;
  lead_id: string | null;
  payload: Record<string, unknown>;
  state: "pending" | "leased" | "done" | "failed";
  lease_token: string | null;
  lease_until: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  enqueued_by: string;
  times_seen: number;
  last_execution_id: string | null;
  created_at: string;
  done_at: string | null;
}

const COLS = `id, kind, ref, project_id, lead_id, payload, state, lease_token, lease_until::text AS lease_until, attempts, max_attempts,
  next_attempt_at::text AS next_attempt_at, last_error, enqueued_by, times_seen, last_execution_id, created_at::text AS created_at, done_at::text AS done_at`;

export interface EnqueueTriggerInput {
  kind: TriggerKind;
  /** Stable event identity, e.g. `signature_request:12:signed`, `gmail:<msgid>`, `decision:<id>`. */
  ref: string;
  projectId?: string | null;
  leadId?: string | null;
  payload?: Record<string, unknown> | null;
  enqueuedBy?: string;
  /** Delay the first run (seconds). */
  delaySeconds?: number;
  maxAttempts?: number;
}

export function isTriggerKind(k: unknown): k is TriggerKind {
  return typeof k === "string" && (TRIGGER_KINDS as readonly string[]).includes(k);
}

export async function enqueueAgentTrigger(run: Run, input: EnqueueTriggerInput): Promise<{ trigger: AgentTrigger; created: boolean; reopened: boolean }> {
  if (!isTriggerKind(input.kind)) throw new Error(`unknown trigger kind: ${String(input.kind)}`);
  const ref = String(input.ref ?? "").trim();
  if (!ref) throw new Error("trigger ref is required");
  const payload = JSON.stringify(input.payload ?? {});
  const [existing] = await run<AgentTrigger>(`SELECT ${COLS} FROM agent_triggers WHERE kind = $1 AND ref = $2 FOR UPDATE`, [input.kind, ref]);
  if (existing) {
    if (existing.state === "pending" || existing.state === "leased") {
      const [row] = await run<AgentTrigger>(
        `UPDATE agent_triggers SET times_seen = times_seen + 1, payload = payload || $2::jsonb WHERE id = $1 RETURNING ${COLS}`,
        [existing.id, payload],
      );
      return { trigger: row, created: false, reopened: false };
    }
    const [row] = await run<AgentTrigger>(
      `UPDATE agent_triggers
          SET state = 'pending', times_seen = times_seen + 1, payload = payload || $2::jsonb, attempts = 0,
              next_attempt_at = now() + ($3::int * interval '1 second'), lease_token = NULL, lease_until = NULL, last_error = NULL, done_at = NULL
        WHERE id = $1 RETURNING ${COLS}`,
      [existing.id, payload, input.delaySeconds ?? 0],
    );
    return { trigger: row, created: false, reopened: true };
  }
  const [row] = await run<AgentTrigger>(
    `INSERT INTO agent_triggers (kind, ref, project_id, lead_id, payload, enqueued_by, next_attempt_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now() + ($7::int * interval '1 second'), $8)
     ON CONFLICT (kind, ref) DO UPDATE SET times_seen = agent_triggers.times_seen + 1, payload = agent_triggers.payload || EXCLUDED.payload
     RETURNING ${COLS}`,
    [input.kind, ref, input.projectId ?? null, input.leadId ?? null, payload, input.enqueuedBy ?? "system", input.delaySeconds ?? 0, input.maxAttempts ?? 4],
  );
  return { trigger: row, created: row.times_seen === 1, reopened: false };
}

export async function getAgentTrigger(run: Run, id: string): Promise<AgentTrigger | null> {
  const [row] = await run<AgentTrigger>(`SELECT ${COLS} FROM agent_triggers WHERE id = $1`, [id]);
  return row ?? null;
}

export async function claimAgentTriggers(run: Run, opts: { worker: string; limit?: number; leaseSeconds?: number } ): Promise<AgentTrigger[]> {
  const token = `${opts.worker}:${randomUUID()}`;
  return run<AgentTrigger>(
    `UPDATE agent_triggers t
        SET state = 'leased', lease_token = $1, lease_until = now() + ($2::int * interval '1 second'), attempts = attempts + 1
      WHERE t.id IN (
        SELECT id FROM agent_triggers
         WHERE state = 'pending' AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED)
      RETURNING ${COLS}`,
    [token, opts.leaseSeconds ?? 900, opts.limit ?? 1],
  );
}

export async function heartbeatTrigger(run: Run, id: string, token: string, seconds = 900): Promise<boolean> {
  const rows = await run(`UPDATE agent_triggers SET lease_until = now() + ($3::int * interval '1 second') WHERE id = $1 AND lease_token = $2 AND state = 'leased' RETURNING id`, [id, token, seconds]);
  return rows.length === 1;
}

export type TriggerOutcome = { kind: "done"; executionId?: string | null } | { kind: "retry"; error: string; executionId?: string | null; backoffSeconds?: number } | { kind: "failed"; error: string; executionId?: string | null };

/** Finish a leased trigger. Fenced by the lease token: a stale worker whose
 *  lease was swept cannot overwrite a newer outcome. */
export async function finishAgentTrigger(run: Run, id: string, token: string, outcome: TriggerOutcome): Promise<AgentTrigger | null> {
  if (outcome.kind === "done") {
    const [row] = await run<AgentTrigger>(
      `UPDATE agent_triggers SET state = 'done', done_at = now(), lease_token = NULL, lease_until = NULL, last_error = NULL, last_execution_id = COALESCE($3::uuid, last_execution_id)
        WHERE id = $1 AND lease_token = $2 AND state = 'leased' RETURNING ${COLS}`,
      [id, token, outcome.executionId ?? null],
    );
    return row ?? null;
  }
  if (outcome.kind === "failed") {
    const [row] = await run<AgentTrigger>(
      `UPDATE agent_triggers SET state = 'failed', lease_token = NULL, lease_until = NULL, last_error = $3, last_execution_id = COALESCE($4::uuid, last_execution_id)
        WHERE id = $1 AND lease_token = $2 AND state = 'leased' RETURNING ${COLS}`,
      [id, token, outcome.error.slice(0, 1000), outcome.executionId ?? null],
    );
    return row ?? null;
  }
  const [row] = await run<AgentTrigger>(
    `UPDATE agent_triggers
        SET state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
            next_attempt_at = now() + (COALESCE($3::int, LEAST(3600, 60 * power(2, attempts))::int) * interval '1 second'),
            lease_token = NULL, lease_until = NULL, last_error = $4, last_execution_id = COALESCE($5::uuid, last_execution_id)
      WHERE id = $1 AND lease_token = $2 AND state = 'leased' RETURNING ${COLS}`,
    [id, token, outcome.backoffSeconds ?? null, outcome.error.slice(0, 1000), outcome.executionId ?? null],
  );
  return row ?? null;
}

/** Repair sweep: leases that expired (worker died mid-run) go back to pending
 *  with backoff, or to failed once attempts are exhausted. Also marks the
 *  matching running executions as 'timeout'. Returns counts. */
export async function sweepStrandedTriggers(run: Run): Promise<{ requeued: number; failed: number; executionsTimedOut: number }> {
  const requeued = await run<{ id: string }>(
    `UPDATE agent_triggers SET state = 'pending', lease_token = NULL, lease_until = NULL,
            next_attempt_at = now() + interval '60 seconds', last_error = COALESCE(last_error, 'lease expired (worker did not finish)')
      WHERE state = 'leased' AND lease_until < now() AND attempts < max_attempts RETURNING id`,
  );
  const failed = await run<{ id: string }>(
    `UPDATE agent_triggers SET state = 'failed', lease_token = NULL, lease_until = NULL, last_error = COALESCE(last_error, 'lease expired; attempts exhausted')
      WHERE state = 'leased' AND lease_until < now() AND attempts >= max_attempts RETURNING id`,
  );
  const timedOut = await run<{ id: string }>(
    `UPDATE agent_executions SET status = 'timeout', finished_at = now(), error = COALESCE(error, 'stranded: trigger lease expired')
      WHERE status = 'running' AND started_at < now() - interval '30 minutes' RETURNING id`,
  );
  return { requeued: requeued.length, failed: failed.length, executionsTimedOut: timedOut.length };
}

export async function listPendingTriggers(run: Run, limit = 50): Promise<AgentTrigger[]> {
  return run<AgentTrigger>(`SELECT ${COLS} FROM agent_triggers WHERE state IN ('pending','leased') ORDER BY next_attempt_at LIMIT $1`, [limit]);
}
