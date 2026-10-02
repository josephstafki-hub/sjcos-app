#!/usr/bin/env bash
# Poll pending / unknown Square payment attempts (A20). Reads CRON_SECRET from
# the app's .env.local and calls the cron endpoint. Run by the
# sjcos-payments-reconcile systemd user timer.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/payments-reconcile
