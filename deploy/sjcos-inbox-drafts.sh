#!/usr/bin/env bash
# Install as ~/bin/sjcos-inbox-drafts. This only stages suggestions; never sends.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 290 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/inbox-drafts
