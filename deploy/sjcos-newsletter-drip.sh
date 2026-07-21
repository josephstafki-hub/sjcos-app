#!/usr/bin/env bash
# Hourly trigger for the SJC OS newsletter drip sweep. Reads CRON_SECRET from the
# app's .env.local and calls the cron endpoint. Run by the sjcos-newsletter-drip
# systemd user timer (reboot-persistent via loginctl linger).
#
# NOTE: unlike the other sweeps, this one can send email to real clients — see
# the guard list at the top of lib/newsletter-drip.ts. It is a no-op until a
# sequence is switched on in the Newsletter → Automations tab.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/newsletter-drip
