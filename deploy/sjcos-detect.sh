#!/usr/bin/env bash
# Hourly trigger for the W1 detector sweep. Reads CRON_SECRET from the app's
# .env.local and calls the cron endpoint. Run by the sjcos-detect systemd
# user timer (reboot-persistent via loginctl linger).
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/detect
