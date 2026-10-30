# Monitoring

SJC OS is watched by three layers. Each covers what the one above it can't.

## 1. In-app health (`/api/health`, `/api/health/deep`)

- `/api/health` answers when the Next.js app is up.
- `/api/health/deep` (CRON_SECRET) lists problems the app itself can see:
  - queue ages
  - unknown sends
  - stale worker
  - backups

## 2. The on-box monitor (`scripts/sjcos-monitor.sh`, every 5 minutes)

`deploy/sjcos-monitor.timer` runs it. It works when the app is down: it talks to Postgres with psql and
to Telegram with curl, and never goes through the app, MCP or `notifyOwner()`.

**Checks:**
- app health and deep health
- MCP `/healthz`
- `pg_isready`
- worker heartbeat
- queue ages (source events, action intents, obligations, runbook wakeups)
- UNKNOWN sends
- last successful cron
- rate-limit skip streaks
- backups

**Alerts go to Joe's Telegram:**
- the first problem at once
- a repeat every 30 minutes while it keeps failing
- escalated wording from the 3rd notice
- one "recovered" message when it's clean again

Every run is logged to `logs/sjcos-monitor.log`. State lives in `~/sjcos-backups/monitor-state.json`.

## 3. Off-box heartbeat (Tier 4)

If the host itself is down (power, disk, kernel, a frozen box), layer 2 doesn't run and can't say so.
That needs something outside the server.

**Setup (one time, free):**
1. Make a check at healthchecks.io, or any service that alerts when a ping URL goes quiet. Period: 5 min.
   Grace: 10 min.
2. Set its email and/or SMS integration to Joe.
3. Put the ping URL in `~/sjcos-app/.env.local` as `SJCOS_HEALTHCHECK_URL=https://hc-ping.com/<uuid>`.
   No restart is needed; the monitor reads it every run.

**What the monitor sends to it:**

| Situation | Ping |
|---|---|
| Every passing run | the URL |
| Every failing run | `URL/fail` with the problem list |
| Telegram delivery fails | `URL/fail` with the alert text, so the outside service is the fallback channel |

**What Joe gets:**

| Situation | Alert |
|---|---|
| The host is down or the timer stopped | No pings arrive. The service emails or texts once the grace period passes. |
| Something is failing | Telegram, as before, plus an email/SMS from the service. |
| Telegram is broken | The email/SMS still arrives. |

Unset `SJCOS_HEALTHCHECK_URL`, and the monitor behaves as before (Telegram only).
