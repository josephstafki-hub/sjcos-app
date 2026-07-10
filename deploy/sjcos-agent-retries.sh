#!/usr/bin/env bash
# Periodic retry sweep for approval pings to owner agents (Hermes/Claude) that
# failed to send. Reads CRON_SECRET from the app's .env.local and calls the
# cron endpoint. Run by the sjcos-agent-retries systemd user timer
# (reboot-persistent via loginctl linger).
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 60 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/agent-retries
