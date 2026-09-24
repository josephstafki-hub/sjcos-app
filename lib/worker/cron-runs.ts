// cron_runs ledger (0020). Every timer-driven job body — ok, failed AND the
// graceful provider rate-limit skips — leaves a row, so "skipped, will retry"
// is countable. lib/worker/health.ts flags N consecutive skips. Pure.

import type { Run } from "../commands/core.ts";

export type CronErrorClass = "rate_limited" | "failed" | "timeout";

export async function recordCronRun(
  run: Run,
  r: { job: string; startedAt: Date; ok: boolean; errorClass?: CronErrorClass | null; error?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  const duration = Math.max(0, Date.now() - r.startedAt.getTime());
  await run(
    `INSERT INTO cron_runs (job, started_at, finished_at, ok, error_class, error, duration_ms, detail)
     VALUES ($1, $2, now(), $3, $4, $5, $6, $7::jsonb)`,
    [r.job, r.startedAt.toISOString(), r.ok, r.ok ? null : (r.errorClass ?? "failed"), r.error?.slice(0, 2000) ?? null, duration, JSON.stringify(r.detail ?? {})],
  );
}

export interface CronJobHealth {
  job: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  consecutive_rate_limit_skips: number;
  consecutive_failures: number;
  last_error: string | null;
}

/** Per job: last run, last success and how many runs in a row ended in a
 *  rate-limit skip / a failure (counted back from the most recent run). */
export async function cronJobHealth(run: Run, opts: { lookback?: number } = {}): Promise<CronJobHealth[]> {
  const rows = await run<{ job: string; started_at: string; ok: boolean; error_class: string | null; error: string | null }>(
    `SELECT job, started_at::text AS started_at, ok, error_class, error FROM (
       SELECT job, started_at, ok, error_class, error, row_number() OVER (PARTITION BY job ORDER BY started_at DESC) AS rn
         FROM cron_runs) t
      WHERE rn <= $1 ORDER BY job, started_at DESC`,
    [opts.lookback ?? 50],
  );
  const byJob = new Map<string, typeof rows>();
  for (const r of rows) byJob.set(r.job, [...(byJob.get(r.job) ?? []), r]);
  const out: CronJobHealth[] = [];
  for (const [job, runs] of byJob) {
    let skips = 0;
    let failures = 0;
    for (const r of runs) {
      if (r.ok) break;
      if (r.error_class === "rate_limited") skips++;
      else failures++;
    }
    out.push({
      job,
      last_run_at: runs[0]?.started_at ?? null,
      last_ok_at: runs.find((r) => r.ok)?.started_at ?? null,
      consecutive_rate_limit_skips: skips,
      consecutive_failures: failures,
      last_error: runs[0]?.ok ? null : (runs[0]?.error ?? null),
    });
  }
  return out;
}
