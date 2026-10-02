// Durable intake helpers shared by the webhooks and the worker (A03b). Pure.
//
// Webhook order of operations:
//   verify raw body → persistInbound() → 200. Persistence failure → 503 so the
//   provider retries; a duplicate → 200 with duplicate=true and NO after()
//   work (the first receipt's processing is resumed by the worker if it never
//   finished). The webhook's after() may then take the event under a lease
//   with leaseEvent() and run the fast half inline; anything it doesn't
//   finish is recovered by the worker poll (lease expiry → sweep → retry).

import { randomUUID } from "node:crypto";
import type { Run } from "../commands/core.ts";
import { finishSourceEvent, recordSourceEvent, type SourceEvent } from "../commands/source-events.ts";
import type { ProcessOutcome, SourceEventProcessor } from "./types.ts";
import { heartbeatSourceEvent } from "./loop.ts";

export type PersistOutcome = { ok: true; event: SourceEvent; created: boolean } | { ok: false; error: string };

/** Persist a VERIFIED provider event. Never throws: the caller maps ok=false
 *  to the provider's retryable response (503). */
export async function persistInbound(
  run: Run,
  input: { provider: string; account: string; eventId: string; eventType: string; payload: Record<string, unknown>; sourceAt?: string | null },
): Promise<PersistOutcome> {
  try {
    const r = await recordSourceEvent(run, { ...input, verified: true, sourceAt: input.sourceAt ?? null });
    return { ok: true, event: r.event, created: r.created };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/** Lease ONE specific pending event (the one this request just persisted).
 *  Null when the worker already has it or it is no longer pending. */
export async function leaseEvent(run: Run, id: string, leaseSeconds = 120): Promise<{ token: string; event: SourceEvent } | null> {
  const token = randomUUID();
  const [row] = await run<SourceEvent>(
    `UPDATE source_events SET state = 'leased', lease_token = $2, lease_until = now() + ($3::int * interval '1 second'), attempts = attempts + 1
      WHERE id = $1 AND state IN ('pending','failed') AND (lease_until IS NULL OR lease_until < now())
      RETURNING id, provider, account, event_id, event_type, payload, payload_hash, verified, source_at::text AS source_at,
                received_at::text AS received_at, state, attempts, max_attempts, lease_token, last_error`,
    [id, token, leaseSeconds],
  );
  return row ? { token, event: row } : null;
}

/** Run a processor inline for one event under its own lease. Used by the
 *  webhooks' after() for the fast half. Returns what happened; never throws. */
export async function processInline(run: Run, processor: SourceEventProcessor, eventId: string, opts: { leaseSeconds?: number } = {}): Promise<"done" | "failed" | "skipped" | "fenced"> {
  const leased = await leaseEvent(run, eventId, opts.leaseSeconds ?? 120);
  if (!leased) return "skipped";
  const { token, event } = leased;
  let outcome: ProcessOutcome;
  try {
    outcome = await processor.process(event, { run, leaseToken: token, heartbeat: () => heartbeatSourceEvent(run, event.id, token, opts.leaseSeconds ?? 120) });
  } catch (err) {
    outcome = { ok: false, error: (err as Error)?.message ?? String(err) };
  }
  const applied = await finishSourceEvent(run, event.id, token, outcome.ok ? { ok: true } : { ok: false, error: outcome.error, retryInSeconds: outcome.retryInSeconds });
  if (!applied) return "fenced";
  return outcome.ok ? "done" : "failed";
}
