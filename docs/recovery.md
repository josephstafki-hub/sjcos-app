# Recovery runbook (A09a · A09b · V13)

What exists, what it proves, and the exact steps when the host is gone.

## Backups (`scripts/backup.mjs`, timer `sjcos-backup`)

- Sets: `db` (pg_dump custom format), `files` (upload store), `config`
  (systemd units, nginx, `.env.local` minus secrets listed in
  `docs/automation-reliability/credentials-inventory.md`). Each set is
  encrypted (`age` or `openssl`, `lib/backup/crypto.ts`) and shipped to an
  **off-host** target (`SJC_BACKUP_TARGET` = `dir:`, `rclone:` or `ssh:`;
  `lib/backup/targets.ts`). No target or no passphrase → the run exits non-zero
  AND writes a failed `backup_runs` row (V13).
- Retention: 14 daily / 8 weekly / 6 monthly (`lib/backup/retention.ts`;
  monthly keeps the oldest set of the month).
- Health: `lib/backup/status.ts backupHealth()` — stale when the newest
  successful run per kind is older than the cadence (30 h) or the newest run
  failed. `alertOnBackupHealth()` raises the owner alert through the
  independent monitor path, not through the app that may be down.

## Restore proof (`scripts/restore.mjs`)

- `node scripts/restore.mjs --set <stamp> --to <fresh database url> --files <dir>`
  restores a set into a disposable database + directory and runs the
  integrity queries (`tests/backup-db.test.mjs` does this end to end against
  the harness; the `backup_runs.restore_tested_at` mark is written only after
  a real restore).
- Timed target: a full DB restore of the current size completes in minutes;
  record the measured time on each drill in `STATUS.md`.

## Losing the host — order of operations

1. **Freeze sends.** On the recovered app, before anything else:
   `INSERT INTO lane_pauses (lane, paused_by, reason) VALUES ('all', 'recovery', 'restore in progress')`.
   Every dispatcher, cron and agent path checks `laneOpen()`; nothing sends
   until you resume. Unknown-outcome intents stay held (A05/A06).
2. Provision Postgres 16, Node 22, nginx; restore `config` first (units +
   nginx), then `db`, then `files`. Secrets come from the credentials
   inventory, never from a backup.
3. Run `node db/migrate.mjs` (ledger check — a restored DB should already be
   at the deployed migration; a mismatch is a stop signal).
4. Reconcile before resuming: `action_intents` in `leased`/`unknown` → confirm
   with the provider (Telnyx / Gmail / Square) or mark failed;
   `agent_triggers` leased → sweep (`node scripts/run-business-agent.mjs --sweep-only`);
   `source_events` pending → let the worker drain.
5. Resume lanes one at a time (`resumeLane`), sends last.

## Monitoring (see `monitoring.md`)

The monitor (`scripts/sjcos-monitor.sh`, timer `sjcos-monitor`) runs
independently of the app process and alerts on: HTTP down, worker heartbeat
stale, cron job missed, backup stale/failed, source-event backlog, decision
push failures. A silent app is an alert, not a green.
