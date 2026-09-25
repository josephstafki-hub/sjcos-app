#!/usr/bin/env bash
# Daily trigger for the comms watch: 10DLC registration status (vetting score,
# campaign carrier status), SMS/voice health (env validation, Telnyx
# reachability, webhook freshness) and the stale-call sweep. Reads CRON_SECRET
# from the app's .env.local and calls the cron endpoint. Run by the
# sjcos-comms-watch systemd user timer (reboot-persistent via loginctl linger).
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -X POST -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/comms-watch
