// Worker / queue health (A03b failure signals, A09b). Computed straight from
// the database so the monitor script and /api/health/deep agree. Pure.

import type { Run } from "../commands/core.ts";
import { cronJobHealth, type CronJobHealth } from "./cron-runs.ts";
import { listWorkers } from "./registry.ts";

export interface WorkerHealth {
  generated_at: string;
  workers: { name: string; instance_id: string; version: string; state: string; heartbeat_age_s: number; last_run_at: string | null; last_result: Record<string, unknown> | null }[];
  source_events: { pending: number; oldest_pending_age_s: number | null; leased_expired: number; exhausted: number; failed: number };
  intents: { pending: number; oldest_pending_age_s: number | null; leased_expired: number; unknown: number; accepted: number; held: number };
  decisions: { pending: number; expired_unswept: number; approved_unconsumed: number };
  wakeups: { present: boolean; pending: number; oldest_pending_age_s: number | null };
  obligations: { present: boolean; open: number; overdue: number; oldest_open_age_s: number | null };
  cron: CronJobHealth[];
  problems: string[];
}

export interface HealthThresholds {
  workerHeartbeatMaxAgeS: number;
  sourceEventMaxAgeS: number;
  intentMaxAgeS: number;
  wakeupMaxAgeS: number;
  rateLimitSkipsMax: number;
  cronFailuresMax: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  workerHeartbeatMaxAgeS: 90,
  sourceEventMaxAgeS: 15 * 60,
  intentMaxAgeS: 15 * 60,
  wakeupMaxAgeS: 5 * 60,
  rateLimitSkipsMax: 4,
  cronFailuresMax: 3,
};

async function exists(run: Run, table: string): Promise<boolean> {
  const r = await run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table]);
  return Boolean(r[0]?.ok);
}

export async function workerHealth(run: Run, t: Partial<HealthThresholds> = {}): Promise<WorkerHealth> {
  const th = { ...DEFAULT_THRESHOLDS, ...t };
  const problems: string[] = [];
  const workers = (await listWorkers(run)).map((w) => ({
    name: w.name,
    instance_id: w.instance_id,
    version: w.version,
    state: w.state,
    heartbeat_age_s: Number(w.heartbeat_age_s),
    last_run_at: w.last_run_at,
    last_result: w.last_result,
  }));
  if (!workers.length) problems.push("no worker has ever registered (sjcos-worker.service not running?)");
  for (const w of workers) {
    if (w.state === "stopped") continue;
    if (w.heartbeat_age_s > th.workerHeartbeatMaxAgeS) problems.push(`worker ${w.name} heartbeat is ${w.heartbeat_age_s}s old (limit ${th.workerHeartbeatMaxAgeS}s)`);
    if (w.state === "timed_out") problems.push(`worker ${w.name}: last iteration timed out`);
    const lr = w.last_result as { error?: string | null } | null;
    if (w.state === "error" && lr?.error) problems.push(`worker ${w.name}: last iteration failed: ${String(lr.error).slice(0, 160)}`);
  }

  const [se] = await run<{ pending: number; oldest: number | null; leased_expired: number; exhausted: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE state IN ('pending','failed'))::int AS pending,
            EXTRACT(EPOCH FROM (now() - min(received_at) FILTER (WHERE state IN ('pending','failed'))))::int AS oldest,
            count(*) FILTER (WHERE state = 'leased' AND lease_until < now())::int AS leased_expired,
            count(*) FILTER (WHERE state = 'exhausted')::int AS exhausted,
            count(*) FILTER (WHERE state = 'failed')::int AS failed
       FROM source_events`,
  );
  const source_events = { pending: se.pending, oldest_pending_age_s: se.oldest, leased_expired: se.leased_expired, exhausted: se.exhausted, failed: se.failed };
  if (source_events.exhausted > 0) problems.push(`${source_events.exhausted} source event(s) exhausted retries — needs a human look`);
  if ((source_events.oldest_pending_age_s ?? 0) > th.sourceEventMaxAgeS) problems.push(`oldest pending source event is ${source_events.oldest_pending_age_s}s old`);
  if (source_events.leased_expired > 0) problems.push(`${source_events.leased_expired} source event lease(s) expired and not yet swept`);

  const [ai] = await run<{ pending: number; oldest: number | null; leased_expired: number; unknown: number; accepted: number; held: number }>(
    `SELECT count(*) FILTER (WHERE state IN ('pending','retryable_failure'))::int AS pending,
            EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE state IN ('pending','retryable_failure'))))::int AS oldest,
            count(*) FILTER (WHERE state = 'leased' AND lease_until < now())::int AS leased_expired,
            count(*) FILTER (WHERE state = 'unknown')::int AS unknown,
            count(*) FILTER (WHERE state = 'accepted')::int AS accepted,
            count(*) FILTER (WHERE state = 'held')::int AS held
       FROM action_intents`,
  );
  const intents = { pending: ai.pending, oldest_pending_age_s: ai.oldest, leased_expired: ai.leased_expired, unknown: ai.unknown, accepted: ai.accepted, held: ai.held };
  if (intents.unknown > 0) problems.push(`${intents.unknown} action intent(s) in UNKNOWN state — reconcile with the provider before any retry`);
  if ((intents.oldest_pending_age_s ?? 0) > th.intentMaxAgeS) problems.push(`oldest pending action intent is ${intents.oldest_pending_age_s}s old (dispatcher stalled?)`);
  if (intents.leased_expired > 0) problems.push(`${intents.leased_expired} intent lease(s) expired and not yet swept`);

  const [dc] = await run<{ pending: number; expired_unswept: number; approved_unconsumed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'pending' AND expires_at > now())::int AS pending,
            count(*) FILTER (WHERE status = 'pending' AND expires_at <= now())::int AS expired_unswept,
            count(*) FILTER (WHERE status = 'approved' AND uses < max_uses)::int AS approved_unconsumed
       FROM decisions`,
  );
  const decisions = { pending: dc.pending, expired_unswept: dc.expired_unswept, approved_unconsumed: dc.approved_unconsumed };

  const wakeups: WorkerHealth["wakeups"] = { present: false, pending: 0, oldest_pending_age_s: null };
  if (await exists(run, "runbook_wakeups")) {
    const [w] = await run<{ pending: number; oldest: number | null }>(
      `SELECT count(*)::int AS pending, EXTRACT(EPOCH FROM (now() - min(created_at)))::int AS oldest FROM runbook_wakeups WHERE state = 'pending'`,
    );
    wakeups.present = true;
    wakeups.pending = w.pending;
    wakeups.oldest_pending_age_s = w.oldest;
    if ((w.oldest ?? 0) > th.wakeupMaxAgeS) problems.push(`oldest pending runbook wakeup is ${w.oldest}s old — lost wakeup not yet drained`);
  }

  const obligations: WorkerHealth["obligations"] = { present: false, open: 0, overdue: 0, oldest_open_age_s: null };
  if (await exists(run, "obligations")) {
    const [o] = await run<{ open: number; overdue: number; oldest: number | null }>(
      `SELECT count(*) FILTER (WHERE status IN ('open','waiting'))::int AS open,
              count(*) FILTER (WHERE status IN ('open','waiting') AND COALESCE(deadline_at, due_at) < now())::int AS overdue,
              EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status IN ('open','waiting'))))::int AS oldest
         FROM obligations`,
    );
    obligations.present = true;
    obligations.open = o.open;
    obligations.overdue = o.overdue;
    obligations.oldest_open_age_s = o.oldest;
  }

  const cron = (await exists(run, "cron_runs")) ? await cronJobHealth(run) : [];
  for (const c of cron) {
    if (c.consecutive_rate_limit_skips >= th.rateLimitSkipsMax) problems.push(`cron ${c.job}: ${c.consecutive_rate_limit_skips} consecutive rate-limit skips — work is not being processed`);
    else if (c.consecutive_failures >= th.cronFailuresMax) problems.push(`cron ${c.job}: ${c.consecutive_failures} consecutive failures (${(c.last_error ?? "").slice(0, 120)})`);
  }

  return { generated_at: new Date().toISOString(), workers, source_events, intents, decisions, wakeups, obligations, cron, problems };
}
