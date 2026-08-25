#!/usr/bin/env bash
# Hourly trigger for the SJC OS bid follow-up sweep. Reads CRON_SECRET from the
# app's .env.local and calls the cron endpoint. Run by the sjcos-bid-follow-ups
# systemd user timer (reboot-persistent via loginctl linger).
#
# NOTE: like the newsletter drip, this sweep can send email to real people
# (subs with an open bid invite) — see the guard list at the top of
# lib/bid-follow-ups.ts. It only chases packages whose "Auto follow-up" switch
# is on; packages that predate the feature were backfilled off.
set -euo pipefail
SECRET="$(grep -E '^CRON_SECRET=' /home/joe/sjcos-app/.env.local | cut -d= -f2-)"
exec curl -fsS -m 120 -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:3017/api/cron/bid-follow-ups
