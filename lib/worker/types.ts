// Supervised worker contracts (A03b). Pure: no server-only, relative imports,
// so tests/worker-db.test.mjs drives the loop against the disposable harness
// and scripts/sjcos-worker.mjs runs it as a long-lived systemd user service.

import type { Run } from "../commands/core.ts";
import type { SourceEvent } from "../commands/source-events.ts";

export type ProcessOutcome =
  | { ok: true; note?: string }
  | { ok: false; error: string; retryInSeconds?: number };

export interface ProcessContext {
  run: Run;
  /** Extend this event's lease (call during long work). False = lease lost — stop. */
  heartbeat: () => Promise<boolean>;
  leaseToken: string;
}

/** One processor per provider. It MUST be idempotent per event: the same
 *  event can be handed to it again after a crash, a lease expiry or a late
 *  duplicate, and every effect it produces must be keyed (commands, intents,
 *  ON CONFLICT rows) so a second pass changes nothing. */
export interface SourceEventProcessor {
  provider: string;
  process(event: SourceEvent, ctx: ProcessContext): Promise<ProcessOutcome>;
}

export interface WorkerLimits {
  /** Source events claimed per provider per iteration. */
  sourceEventsPerProvider: number;
  /** Lease length for a claimed source event (seconds). */
  leaseSeconds: number;
  /** Hard cap for one iteration; a hung iteration ends visibly at this point. */
  iterationTimeoutMs: number;
  /** Idle sleep between iterations (ms). */
  idleSleepMs: number;
  /** Heartbeat cadence (ms). */
  heartbeatMs: number;
  /** A pending runbook wakeup older than this is a lost wakeup → drained by polling. */
  lostWakeupAfterSeconds: number;
}

export const DEFAULT_LIMITS: WorkerLimits = {
  sourceEventsPerProvider: 25,
  leaseSeconds: 120,
  iterationTimeoutMs: 5 * 60 * 1000,
  idleSleepMs: 3000,
  heartbeatMs: 15_000,
  lostWakeupAfterSeconds: 30,
};

export interface WorkerDeps {
  /** Autocommit runner over a dedicated pg client/pool. */
  run: Run;
  name?: string;
  instanceId: string;
  version: string;
  processors: SourceEventProcessor[];
  /** WS-approvals' intent dispatcher, when lib/dispatch exists. Optional. */
  dispatcher?: (() => Promise<unknown>) | null;
  /** lib/runbook-engine drainRunbookWakeups, when present. Optional. */
  wakeupDrainer?: ((limit: number) => Promise<{ sent: number; failed: number }>) | null;
  /** Presence of this file halts processing (heartbeats continue). */
  stopFile?: string | null;
  limits?: Partial<WorkerLimits>;
  log?: (line: string) => void;
  /** Test seam: injected clock. */
  now?: () => Date;
}

export interface IterationResult {
  at: string;
  duration_ms: number;
  paused: false | { reason: string; by: string };
  source_events: { claimed: number; done: number; failed: number; fenced: number; by_provider: Record<string, number> };
  dispatcher: { ran: boolean; result?: unknown; error?: string };
  sweeps: { source_leases: number; intent_unknown: number; intent_requeued: number; decisions_expired: number };
  wakeups: { pending: number; drained: number; failed: number; drainer: boolean };
  error: string | null;
  timed_out: boolean;
}
