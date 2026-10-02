#!/usr/bin/env bash
# Watchdog for the SJC OS MCP HTTP service (sjcos-mcp.service, port 3018).
# Run every 5 minutes by the sjcos-mcp-watchdog systemd user timer. Probes the
# unauthenticated /healthz liveness route; on any failure it restarts the
# service and logs a timestamped line, so a crash-loop or dead binary can never
# again go unnoticed for days (Aug 3–15 2026: 12 days of 203/EXEC, no alarm).
set -uo pipefail

LOG="${HOME}/sjcos-app/logs/sjcos-mcp-watchdog.log"
mkdir -p "$(dirname "$LOG")"

if curl -fsS -m 5 http://127.0.0.1:3018/healthz >/dev/null 2>&1; then
  exit 0
fi

echo "$(date -Is) healthz probe failed — restarting sjcos-mcp.service" >>"$LOG"
systemctl --user restart sjcos-mcp.service
sleep 5
if curl -fsS -m 5 http://127.0.0.1:3018/healthz >/dev/null 2>&1; then
  echo "$(date -Is) recovered after restart" >>"$LOG"
else
  echo "$(date -Is) STILL DOWN after restart — check journalctl --user -u sjcos-mcp.service" >>"$LOG"
fi
