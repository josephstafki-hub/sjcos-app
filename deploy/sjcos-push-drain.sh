#!/usr/bin/env bash
# 5-minute trigger for the W3 owner-push drain (parked Telegram pushes +
# stale-approval nudges). Reads CRON_SECRET from the app's .env.local and
# calls the cron endpoint. Run by the sjcos-push-drain systemd user timer
# (reboot-persistent via loginctl linger).
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/push-drain
