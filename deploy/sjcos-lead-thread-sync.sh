#!/usr/bin/env bash
# Periodic trigger for the live "needs reply" lead-thread sync. Reads
# CRON_SECRET from the app's .env.local and calls the cron endpoint. Run by
# the sjcos-lead-thread-sync systemd user timer (reboot-persistent via
# loginctl linger).
set -euo pipefail
# Long timeout: after a restart the first Gmail scan is paced to half the
# per-minute quota (lib/gmail-quota.ts) and can take several minutes.
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 600 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/lead-thread-sync
