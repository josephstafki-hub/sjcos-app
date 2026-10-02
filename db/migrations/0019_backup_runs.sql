-- 0019 — Backup run ledger (A09a). One row per backup attempt per kind so
-- lib/backup/status.ts can answer "when did the last GOOD db / files / config
-- backup finish, where did it go, and has a restore ever been proven from it".
-- A missing off-host destination is recorded here as a FAILED run, never
-- silently skipped. Additive only.
CREATE TABLE IF NOT EXISTS backup_runs (
  id                bigserial PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  kind              text NOT NULL CHECK (kind IN ('db','files','config')),
  mode              text NOT NULL DEFAULT 'full' CHECK (mode IN ('full','db-only')),
  bytes             bigint,
  checksum          text,                                  -- sha256 of the encrypted artifact
  artifact          text,                                  -- artifact file name inside the backup set
  backup_set        text,                                  -- stamp shared by every artifact of one run (YYYYMMDDTHHMMSSZ)
  destination       text,                                  -- rclone:<remote:path> | ssh:<user@host:path> | dir:<path> | none
  state             text NOT NULL DEFAULT 'running' CHECK (state IN ('running','ok','failed','stale')),
  error             text,
  host              text NOT NULL DEFAULT '',
  code_version      text NOT NULL DEFAULT '',
  restore_tested_at timestamptz,
  restore_note      text
);
CREATE INDEX IF NOT EXISTS idx_backup_runs_kind_started ON backup_runs(kind, started_at DESC);
