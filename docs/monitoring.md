# Monitoring (A09b · A03b · A08b)

Independent of the app: the monitor is a shell script on a systemd user timer
(`deploy/sjcos-monitor.*`) that talks to Postgres and the public URL directly.
The app being up but idle is a failure it detects; the app being down cannot
silence it.

## What is watched

| signal | source | threshold | proof |
|---|---|---|---|
| HTTP | `GET https://os.sjcarpentryllc.com/api/health` | non-200 or > 10 s | uptime |
| Worker heartbeat | `workers.last_heartbeat_at` per registered worker (`lib/worker/registry.ts`) | > 5 min | worker alive |
| Cron ticks | `cron_runs` per job (`lib/worker/cron-runs.ts cronJobHealth`) | missed schedule or last run failed | timers firing |
| Backups | `backup_runs` (`lib/backup/status.ts backupHealth`) | stale > 30 h or last failed | recoverable |
| Intake backlog | `source_events` pending older than 10 min | count > 0 | events not stranded |
| Ambiguous sends | `action_intents.state = 'unknown'` | any | reconcile needed |
| Decision delivery | `decision_deliveries` failed pushes in 1 h | count > 0 | Joe is reachable |
| Agent worker | `agent_triggers` leased past `lease_until`; executions `timeout`/`failed` in 1 h | any / > 3 | agent loop healthy |
| Business progress | obligations past due with no receipt in 7 d | count | work moves |

## Alerting

`notifyOwner()` (Telegram, `lib/notify/owner.ts`) with the owner push quiet
hours and the 4/hour cap; monitor alerts are grouped per run and repeat only
when the state changes. If Telegram itself fails the monitor writes to
`push_outbox` and the journal (`journalctl --user -u sjcos-monitor`).

## Reading it

- `/engine/capabilities` — implemented / deployed / enabled / proven per task.
- `/engine/measure` — measurement cases, owner time, unknown effects.
- `systemctl --user list-timers 'sjcos-*'` — every timer and its next run.
- `node scripts/run-business-agent.mjs --status` — agent triggers and last executions.

Nothing here is enabled on the live host by merging this branch; the deploy
packet (`deploy/README.md`) lists the units to install and the env keys.
