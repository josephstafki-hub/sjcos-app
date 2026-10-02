#!/usr/bin/env bash
# 2-minute trigger for the intent dispatcher (A05/A06): sweeps expired leases,
# expires stale decisions, dispatches due intents and reconciles unknown
# outcomes with each provider. Reads CRON_SECRET from the app's .env.local and
# calls the cron endpoint. Run by the sjcos-dispatch systemd user timer.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 110 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/dispatch
