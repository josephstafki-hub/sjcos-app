-- 0020 — Cron run ledger (A09b). app/api/cron/_lib/guard.ts records every
-- timer-driven job body here, INCLUDING the graceful rate-limit skips, so
-- "skipped this run, will retry next tick" cannot hide work that never gets
-- processed: lib/worker/health.ts flags a job with N consecutive rate-limit
-- skips. Additive only.
CREATE TABLE IF NOT EXISTS cron_runs (
  id           bigserial PRIMARY KEY,
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean NOT NULL DEFAULT false,
  -- NULL when ok; 'rate_limited' for a provider quota skip; 'failed' otherwise.
  error_class  text CHECK (error_class IS NULL OR error_class IN ('rate_limited','failed','timeout')),
  error        text,
  duration_ms  integer,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job, started_at DESC);
