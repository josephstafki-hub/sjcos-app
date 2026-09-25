#!/usr/bin/env bash
# hourly at :40 trigger: Post-project follow-through (A17, W12). Reads CRON_SECRET from the app's .env.local and calls
# the cron endpoint. Run by the sjcos-post-project systemd user timer.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 110 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/post-project
