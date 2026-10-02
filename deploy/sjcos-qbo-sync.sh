#!/usr/bin/env bash
# QuickBooks Online sync (A14): dry-run unless the per-direction switches on
# Settings › Accounting are ON. Reads CRON_SECRET from the app's .env.local.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 300 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/qbo-sync
