#!/usr/bin/env bash
# Promote a staged Next build into place. Runs as ExecStartPre of sjcos.service,
# so "stage now, go live on the next restart" works without touching the
# running server:
#
#   cd ~/sjcos-app && git pull --ff-only
#   SJC_DIST_DIR=.next-staged npm run build      # live .next is untouched
#   systemctl --user restart sjcos.service       # whenever convenient → this
#                                                 # swaps .next-staged → .next
#
# Idempotent and cheap: does nothing unless a *complete* staged build exists
# (BUILD_ID is the last file `next build` writes). The previous build is parked
# in ~/sjcos-backups (never inside the repo — see deploy/README.md) so a bad
# promote can be rolled back by moving it back and restarting.
set -euo pipefail
APP="${1:-$HOME/sjcos-app}"
STAGED="$APP/.next-staged"
LIVE="$APP/.next"
BACKUPS="$HOME/sjcos-backups"

[ -f "$STAGED/BUILD_ID" ] || exit 0

mkdir -p "$BACKUPS"
if [ -d "$LIVE" ]; then
  # Keep exactly one rollback copy.
  rm -rf "$BACKUPS/next-rollback"
  mv "$LIVE" "$BACKUPS/next-rollback"
fi
mv "$STAGED" "$LIVE"
echo "promoted staged build $(cat "$LIVE/BUILD_ID") (previous parked in $BACKUPS/next-rollback)"
