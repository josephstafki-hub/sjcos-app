#!/usr/bin/env bash
# hourly at :35 trigger: Weekly client summaries (A16, W10). Reads CRON_SECRET from the app's .env.local and calls
# the cron endpoint. Run by the sjcos-weekly-summary systemd user timer.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 110 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/weekly-summary
