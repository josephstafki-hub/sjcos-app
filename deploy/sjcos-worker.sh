#!/usr/bin/env bash
# Launcher for the SJC OS supervised worker (deploy/sjcos-worker.service).
# Reads the app's .env.local via SJCOS_ENV; env-resolved node (never a
# hardcoded binary path — see the sjcos-mcp 203/EXEC lesson in deploy/README.md).
set -euo pipefail
APP="${SJCOS_APP:-$HOME/sjcos-app}"
export SJCOS_ENV="${SJCOS_ENV:-$APP/.env.local}"
cd "$APP"
exec /usr/bin/env node scripts/sjcos-worker.mjs "$@"
