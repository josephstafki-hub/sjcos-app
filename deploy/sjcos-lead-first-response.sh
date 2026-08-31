#!/usr/bin/env bash
# Periodic safety-net trigger for the same-day lead first response
# (lib/lead-first-response.ts). Reads CRON_SECRET from the app's .env.local and
# calls the cron endpoint. Run by the sjcos-lead-first-response systemd user
# timer (reboot-persistent via loginctl linger). Up to 5 leads × ~30s of local
# model time per pass, hence the long curl timeout.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 290 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/lead-first-response
