// The supervised worker loop (A03b). One iteration = runOnce():
//
//   0. stop file / lane pause ('all' or 'agents') → heartbeat only, no work;
//   1. sweep expired source-event leases (→ retry) and expired intent leases
//      (→ unknown, held for reconciliation) and expire stale decisions;
//   2. claim source events per registered provider under a bounded lease,
//      run the processor with a lease heartbeat, finish fenced on the token;
//   3. run WS-approvals' intent dispatcher when it is wired in (optional);
//   4. poll for lost wakeups: pending runbook_wakeups older than a threshold
//      are drained by polling — a lost notification never loses the work.
//
// Every write is fenced (lease token / instance id), every count is bounded,
// and a hung iteration ends visibly at iterationTimeoutMs: last_result shows
// timed_out=true, the leases it held expire and are swept on the next pass;
// the late promise's writes then miss their token and change nothing.

import { existsSync } from "node:fs";
import { claimSourceEvents, finishSourceEvent, sweepSourceEventLeases, type SourceEvent } from "../commands/source-events.ts";
import { sweepExpiredLeases } from "../commands/intents.ts";
import { expireStaleDecisions } from "../commands/decisions.ts";
import { laneOpen } from "../commands/policies.ts";
import type { Run } from "../commands/core.ts";
import { heartbeatWorker, recordIteration, registerWorker } from "./registry.ts";
import { DEFAULT_LIMITS, type IterationResult, type SourceEventProcessor, type WorkerDeps, type WorkerLimits } from "./types.ts";

export const WORKER_NAME = "sjcos-worker";

/** Extend a source-event lease. False = the lease is gone (expired, swept or
 *  re-claimed) — an expired lease is never revived, because another worker may
 *  claim it the moment it lapses. */
export async function heartbeatSourceEvent(run: Run, id: string, token: string, seconds: number): Promise<boolean> {
  const rows = await run(
    `UPDATE source_events SET lease_until = now() + ($3::int * interval '1 second') WHERE id = $1 AND lease_token = $2 AND state = 'leased' AND lease_until >= now() RETURNING id`,
    [id, token, seconds],
  );
  return rows.length === 1;
}

function tableExists(run: Run, name: string): Promise<boolean> {
  return run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name]).then((r) => Boolean(r[0]?.ok));
}

export class IterationTimeoutError extends Error {
  constructor(ms: number) {
    super(`worker iteration exceeded ${ms}ms and was abandoned; its leases will expire and be swept`);
    this.name = "IterationTimeoutError";
  }
}

function emptyResult(now: Date): IterationResult {
  return {
    at: now.toISOString(),
    duration_ms: 0,
    paused: false,
    source_events: { claimed: 0, done: 0, failed: 0, fenced: 0, by_provider: {} },
    dispatcher: { ran: false },
    sweeps: { source_leases: 0, intent_unknown: 0, intent_requeued: 0, decisions_expired: 0 },
    wakeups: { pending: 0, drained: 0, failed: 0, drainer: false },
    error: null,
    timed_out: false,
  };
}

async function processOne(run: Run, p: SourceEventProcessor, ev: SourceEvent, token: string, limits: WorkerLimits, log: (l: string) => void): Promise<"done" | "failed" | "fenced"> {
  let outcome: Awaited<ReturnType<SourceEventProcessor["process"]>>;
  try {
    outcome = await p.process(ev, { run, leaseToken: token, heartbeat: () => heartbeatSourceEvent(run, ev.id, token, limits.leaseSeconds) });
  } catch (err) {
    outcome = { ok: false, error: (err as Error)?.message ?? String(err) };
  }
  const applied = await finishSourceEvent(run, ev.id, token, outcome.ok ? { ok: true } : { ok: false, error: outcome.error, retryInSeconds: outcome.retryInSeconds });
  if (!applied) {
    log(`[worker] ${p.provider} event ${ev.event_id}: finish fenced (lease lost)`);
    return "fenced";
  }
  if (!outcome.ok) log(`[worker] ${p.provider} event ${ev.event_id} attempt ${ev.attempts}: ${outcome.error}`);
  return outcome.ok ? "done" : "failed";
}

/** Work that this iteration does once the pause/stop checks passed. */
async function iterate(deps: WorkerDeps, limits: WorkerLimits, res: IterationResult, log: (l: string) => void): Promise<void> {
  const { run } = deps;
  // 1. sweeps — recover before claiming so expired work is eligible now.
  res.sweeps.source_leases = await sweepSourceEventLeases(run);
  let retryableKinds: string[] = [];
  try {
    const kinds = (await import("../dispatch/kinds.ts")) as { REQUEUE_ON_LEASE_EXPIRY?: string[] };
    retryableKinds = kinds.REQUEUE_ON_LEASE_EXPIRY ?? [];
  } catch {
    /* dispatcher kinds not present: every expired intent lease is unknown */
  }
  const swept = await sweepExpiredLeases(run, { retryableKinds });
  res.sweeps.intent_unknown = swept.unknown;
  res.sweeps.intent_requeued = swept.requeued;
  res.sweeps.decisions_expired = await expireStaleDecisions(run);

  // 2. source events by provider.
  for (const p of deps.processors) {
    const { token, events } = await claimSourceEvents(run, { provider: p.provider, limit: limits.sourceEventsPerProvider, leaseSeconds: limits.leaseSeconds });
    res.source_events.claimed += events.length;
    res.source_events.by_provider[p.provider] = (res.source_events.by_provider[p.provider] ?? 0) + events.length;
    for (const ev of events) {
      const r = await processOne(run, p, ev, token, limits, log);
      if (r === "done") res.source_events.done++;
      else if (r === "failed") res.source_events.failed++;
      else res.source_events.fenced++;
    }
  }

  // 3. intent dispatcher (WS-approvals) when wired.
  if (deps.dispatcher) {
    res.dispatcher.ran = true;
    try {
      res.dispatcher.result = await deps.dispatcher();
    } catch (err) {
      res.dispatcher.error = (err as Error)?.message ?? String(err);
      log(`[worker] dispatcher: ${res.dispatcher.error}`);
    }
  }

  // 4. lost wakeups — poll, never trust the notification.
  if (await tableExists(run, "runbook_wakeups")) {
    const [row] = await run<{ n: number }>(
      `SELECT count(*)::int AS n FROM runbook_wakeups WHERE state = 'pending' AND created_at < now() - ($1::int * interval '1 second')`,
      [limits.lostWakeupAfterSeconds],
    );
    res.wakeups.pending = row?.n ?? 0;
    if (res.wakeups.pending > 0 && deps.wakeupDrainer) {
      res.wakeups.drainer = true;
      try {
        const d = await deps.wakeupDrainer(Math.min(20, res.wakeups.pending));
        res.wakeups.drained = d.sent;
        res.wakeups.failed = d.failed;
      } catch (err) {
        log(`[worker] wakeup drain: ${(err as Error)?.message ?? err}`);
      }
    }
  }
}

/** One bounded iteration. Always records last_result on the workers row. */
export async function runOnce(deps: WorkerDeps): Promise<IterationResult> {
  const limits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) };
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const name = deps.name ?? WORKER_NAME;
  const started = now();
  const res = emptyResult(started);
  const ident = { name, instanceId: deps.instanceId };
  const { run } = deps;

  let state = "idle";
  try {
    if (deps.stopFile && existsSync(deps.stopFile)) {
      res.paused = { reason: `stop file present: ${deps.stopFile}`, by: "stop-file" };
    } else {
      const lane = await laneOpen(run, "agents");
      if (!lane.open) res.paused = { reason: `${lane.lane} lane paused: ${lane.reason}`, by: "lane_pauses" };
    }
    if (res.paused) {
      state = "paused";
    } else {
      state = "running";
      await heartbeatWorker(run, ident, state, "");
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IterationTimeoutError(limits.iterationTimeoutMs)), limits.iterationTimeoutMs);
      });
      try {
        await Promise.race([iterate(deps, limits, res, log), timeout]);
      } finally {
        clearTimeout(timer);
      }
      state = "idle";
    }
  } catch (err) {
    res.error = (err as Error)?.message ?? String(err);
    res.timed_out = err instanceof IterationTimeoutError;
    state = res.timed_out ? "timed_out" : "error";
    log(`[worker] iteration ${res.timed_out ? "timed out" : "failed"}: ${res.error}`);
  }
  res.duration_ms = now().getTime() - started.getTime();
  const owned = await recordIteration(run, ident, res as unknown as Record<string, unknown>, state).catch(() => false);
  if (!owned) {
    res.error = res.error ?? "fenced: another worker instance registered under this name";
    log(`[worker] ${res.error}`);
  }
  return res;
}

/** Long-running supervision: register, heartbeat every 15s, iterate until
 *  stop() or fenced. Never throws out of the loop; errors land in last_result. */
export function supervise(deps: WorkerDeps): { stop: () => Promise<void>; done: Promise<void> } {
  const limits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) };
  const log = deps.log ?? (() => {});
  const name = deps.name ?? WORKER_NAME;
  const ident = { name, instanceId: deps.instanceId };
  let stopping = false;
  let wake: (() => void) | null = null;
  let lastState = "starting";

  const heartbeat = setInterval(() => {
    heartbeatWorker(deps.run, ident, lastState).then((ok) => {
      if (!ok && !stopping) {
        log(`[worker] fenced by a newer instance; stopping`);
        stopping = true;
        wake?.();
      }
    }).catch((e) => log(`[worker] heartbeat failed: ${(e as Error).message}`));
  }, limits.heartbeatMs);

  const done = (async () => {
    await registerWorker(deps.run, { name, instanceId: deps.instanceId, version: deps.version });
    log(`[worker] ${name} ${deps.instanceId} v${deps.version} registered`);
    while (!stopping) {
      const r = await runOnce(deps);
      lastState = r.paused ? "paused" : r.timed_out ? "timed_out" : r.error ? "error" : "idle";
      if (r.error?.startsWith("fenced:")) {
        stopping = true;
        break;
      }
      const busy = r.source_events.claimed > 0 && !r.error;
      if (!busy && !stopping) await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, r.paused ? Math.max(limits.idleSleepMs, 10_000) : limits.idleSleepMs);
      });
      wake = null;
    }
    clearInterval(heartbeat);
    await heartbeatWorker(deps.run, ident, "stopped", "").catch(() => {});
    log(`[worker] stopped`);
  })();

  return {
    done,
    stop: async () => {
      stopping = true;
      wake?.();
      await done;
    },
  };
}
