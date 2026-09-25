// Fake provider for worker tests (A03b / V04 / V07). Simulates what a real
// webhook source does to us: latency, acceptance-then-timeout, duplicate,
// late and out-of-order deliveries, and a stale worker that outlives its
// lease. Pure; no network. Used by tests/worker-db.test.mjs.

import type { Run } from "../commands/core.ts";
import { recordSourceEvent, type SourceEvent } from "../commands/source-events.ts";
import type { ProcessContext, ProcessOutcome, SourceEventProcessor } from "./types.ts";

export interface FakeEvent {
  eventId: string;
  eventType: string;
  seq: number;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export interface FakeBehaviour {
  /** Processing latency per event (ms). */
  latencyMs?: number | ((ev: SourceEvent) => number);
  /** Event ids that fail with a retryable error the first N times. */
  failFirst?: Record<string, number>;
  /** Event ids whose processor NEVER resolves (hung provider call). */
  hang?: Set<string>;
  /** Called with every effect the processor produces (keyed by event id → count). */
  onEffect?: (eventId: string) => void;
}

export const FAKE_PROVIDER = "fake";

/** Deliver events into source_events the way a webhook would — including
 *  duplicates (same id twice) and out-of-order (by seq) arrivals. */
export async function deliver(run: Run, account: string, events: FakeEvent[]): Promise<{ created: number; duplicates: number }> {
  let created = 0;
  let duplicates = 0;
  for (const e of events) {
    const r = await recordSourceEvent(run, {
      provider: FAKE_PROVIDER,
      account,
      eventId: e.eventId,
      eventType: e.eventType,
      payload: { seq: e.seq, ...(e.payload ?? {}) },
      verified: true,
      sourceAt: e.occurredAt ?? null,
    });
    if (r.created) created++;
    else duplicates++;
  }
  return { created, duplicates };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A processor that applies events to a version-checked "fake_targets" row
 *  so out-of-order arrivals resolve by seq, not arrival order. Effects are
 *  keyed on (target, event id) so a re-run never double-applies. */
export function fakeProcessor(b: FakeBehaviour = {}): SourceEventProcessor & { effects: Map<string, number>; attempts: Map<string, number> } {
  const effects = new Map<string, number>();
  const attempts = new Map<string, number>();
  const failures = { ...(b.failFirst ?? {}) };
  return {
    provider: FAKE_PROVIDER,
    effects,
    attempts,
    async process(ev: SourceEvent, ctx: ProcessContext): Promise<ProcessOutcome> {
      attempts.set(ev.event_id, (attempts.get(ev.event_id) ?? 0) + 1);
      if (b.hang?.has(ev.event_id)) await new Promise(() => {}); // never resolves
      const lat = typeof b.latencyMs === "function" ? b.latencyMs(ev) : (b.latencyMs ?? 0);
      if (lat > 0) {
        await sleep(lat);
        const alive = await ctx.heartbeat();
        if (!alive) return { ok: false, error: "lease lost during latency; not applying" };
      }
      if ((failures[ev.event_id] ?? 0) > 0) {
        failures[ev.event_id]!--;
        return { ok: false, error: "simulated transient failure", retryInSeconds: 0 };
      }
      const seq = Number((ev.payload as { seq?: number }).seq ?? 0);
      const target = String((ev.payload as { target?: string }).target ?? ev.account);
      // Version-checked apply: only a newer seq moves the target; the applied
      // event id is recorded so a duplicate/late copy is a no-op either way.
      const rows = await ctx.run<{ applied: boolean }>(
        `INSERT INTO fake_targets (target, version, applied_events) VALUES ($1, $2, ARRAY[$3]::text[])
         ON CONFLICT (target) DO UPDATE
           SET version = GREATEST(fake_targets.version, EXCLUDED.version),
               applied_events = CASE WHEN $3 = ANY(fake_targets.applied_events) THEN fake_targets.applied_events ELSE fake_targets.applied_events || $3 END
         RETURNING NOT ($3 = ANY(applied_events[1:array_length(applied_events,1)-1])) AS applied`,
        [target, seq, ev.event_id],
      );
      if (rows[0]?.applied) {
        effects.set(ev.event_id, (effects.get(ev.event_id) ?? 0) + 1);
        b.onEffect?.(ev.event_id);
      }
      return { ok: true };
    },
  };
}

/** Test-only table for the fake processor. */
export async function ensureFakeTables(run: Run): Promise<void> {
  await run(`CREATE TABLE IF NOT EXISTS fake_targets (target text PRIMARY KEY, version integer NOT NULL DEFAULT 0, applied_events text[] NOT NULL DEFAULT '{}')`);
  await run(`TRUNCATE fake_targets`);
}
