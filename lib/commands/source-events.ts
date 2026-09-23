// Durable provider event intake (A03b). Persist a verified event under
// (provider, account, event_id) BEFORE acknowledging receipt to the provider;
// processing happens later under a bounded lease. A duplicate receipt returns
// the existing row (created=false) and is NOT proof the effects completed —
// unfinished processing resumes on the next claim.

import { createHash, randomUUID } from "node:crypto";
import type { Run } from "./core.ts";
import { canonicalJson } from "./core.ts";

export interface SourceEvent {
  id: string;
  provider: string;
  account: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  verified: boolean;
  source_at: string | null;
  received_at: string;
  state: "pending" | "leased" | "done" | "failed" | "exhausted" | "ignored";
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  last_error: string | null;
}

const COLS = `id, provider, account, event_id, event_type, payload, payload_hash, verified, source_at::text AS source_at,
  received_at::text AS received_at, state, attempts, max_attempts, lease_token, last_error`;

export async function recordSourceEvent(
  run: Run,
  input: { provider: string; account?: string | null; eventId: string; eventType?: string; payload: Record<string, unknown>; verified: boolean; sourceAt?: string | Date | null; ignore?: boolean },
): Promise<{ event: SourceEvent; created: boolean }> {
  const hash = createHash("sha256").update(canonicalJson(input.payload)).digest("hex");
  const [row] = await run<SourceEvent>(
    `INSERT INTO source_events (provider, account, event_id, event_type, payload, payload_hash, verified, source_at, state)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (provider, account, event_id) DO NOTHING
     RETURNING ${COLS}`,
    [input.provider, input.account ?? "", input.eventId, input.eventType ?? "", canonicalJson(input.payload), hash, input.verified, input.sourceAt ? new Date(input.sourceAt).toISOString() : null, input.ignore ? "ignored" : "pending"],
  );
  if (row) return { event: row, created: true };
  const [existing] = await run<SourceEvent>(`SELECT ${COLS} FROM source_events WHERE provider = $1 AND account = $2 AND event_id = $3`, [input.provider, input.account ?? "", input.eventId]);
  return { event: existing, created: false };
}

export async function claimSourceEvents(run: Run, opts: { provider?: string; limit?: number; leaseSeconds?: number }): Promise<{ token: string; events: SourceEvent[] }> {
  const token = randomUUID();
  const events = await run<SourceEvent>(
    `WITH picked AS (
       SELECT id FROM source_events
        WHERE state IN ('pending','failed') AND next_attempt_at <= now()
          AND (lease_until IS NULL OR lease_until < now())
          AND ($1::text IS NULL OR provider = $1)
        ORDER BY received_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     UPDATE source_events s SET state = 'leased', lease_token = $3, lease_until = now() + ($4::int * interval '1 second'), attempts = attempts + 1
       FROM picked WHERE s.id = picked.id
     RETURNING s.id, s.provider, s.account, s.event_id, s.event_type, s.payload, s.payload_hash, s.verified, s.source_at::text AS source_at,
               s.received_at::text AS received_at, s.state, s.attempts, s.max_attempts, s.lease_token, s.last_error`,
    [opts.provider ?? null, opts.limit ?? 50, token, opts.leaseSeconds ?? 120],
  );
  return { token, events };
}

export async function finishSourceEvent(run: Run, id: string, token: string, outcome: { ok: true } | { ok: false; error: string; retryInSeconds?: number }): Promise<boolean> {
  if (outcome.ok) {
    const rows = await run(`UPDATE source_events SET state = 'done', processed_at = now(), lease_token = NULL, lease_until = NULL WHERE id = $1 AND lease_token = $2 RETURNING id`, [id, token]);
    return rows.length === 1;
  }
  const rows = await run(
    `UPDATE source_events
        SET state = CASE WHEN attempts >= max_attempts THEN 'exhausted' ELSE 'failed' END,
            last_error = $3, lease_token = NULL, lease_until = NULL,
            next_attempt_at = now() + (LEAST(3600, $4::int) * interval '1 second')
      WHERE id = $1 AND lease_token = $2 RETURNING id`,
    [id, token, outcome.error.slice(0, 2000), outcome.retryInSeconds ?? 60],
  );
  return rows.length === 1;
}

/** Expired leases go back to 'failed' (retry) — processing an event twice is
 *  safe because every effect it produces is keyed (commands / intents). */
export async function sweepSourceEventLeases(run: Run): Promise<number> {
  const rows = await run(`UPDATE source_events SET state = 'failed', lease_token = NULL, lease_until = NULL, next_attempt_at = now() WHERE state = 'leased' AND lease_until < now() RETURNING id`);
  return rows.length;
}
