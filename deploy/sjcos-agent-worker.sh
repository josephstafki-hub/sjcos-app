#!/usr/bin/env bash
# One worker pass: sweep stranded leases, claim pending agent_triggers, run
# each through the configured operating model (Claude CLI business profile by
# default), record agent_executions. Run by the sjcos-agent-worker systemd user
# timer every 3 minutes (reboot-persistent via loginctl linger).
#
# Install:
#   install -m 755 deploy/sjcos-agent-worker.sh ~/bin/sjcos-agent-worker
#   cp deploy/sjcos-agent-worker.{service,timer} ~/.config/systemd/user/
#   systemctl --user daemon-reload && systemctl --user enable --now sjcos-agent-worker.timer
# Pause without uninstalling: pause the 'agents' lane (lane_pauses) — the
# worker exits without claiming anything while it is paused.
set -euo pipefail
cd /home/joe/sjcos-app
# DATABASE_URL, APP_INTERNAL_URL and CRON_SECRET come from .env.local via the
# runner's own fallback; the MCP child inherits DATABASE_URL explicitly.
export SJC_AGENT_RUNTIME="${SJC_AGENT_RUNTIME:-claude}"
export SJC_AGENT_MODEL="${SJC_AGENT_MODEL:-}"
export SJC_AGENT_MAX_TURNS="${SJC_AGENT_MAX_TURNS:-40}"
exec /usr/bin/env node scripts/run-business-agent.mjs --once --limit "${SJC_AGENT_LIMIT:-2}"
