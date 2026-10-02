#!/usr/bin/env bash
# Nightly off-host backup (deploy/sjcos-backup.timer, 02:30 America/Chicago) and
# the optional 4-hourly DB-only run (deploy/sjcos-backup-db.timer, pass --db-only).
# Production is reached ONLY through SJCOS_ENV → DATABASE_URL. BACKUP_* keys
# (passphrase, destination) live in the same .env.local; nothing is in git.
set -euo pipefail
APP="${SJCOS_APP:-$HOME/sjcos-app}"
export SJCOS_ENV="${SJCOS_ENV:-$APP/.env.local}"
mkdir -p "$APP/logs"
cd "$APP"
/usr/bin/env node scripts/backup.mjs "$@" 2>&1 | tee -a "$APP/logs/sjcos-backup.log"
exit "${PIPESTATUS[0]}"
