#!/usr/bin/env bash
# SJC OS independent monitor (A09b). Run every 5 minutes by
# deploy/sjcos-monitor.timer. Designed to work when the app is DOWN: every
# check talks to Postgres with psql and to Telegram with curl directly — none
# of it goes through Next.js, the MCP server or notifyOwner().
#
# Checks (each produces a FAIL line on trouble):
#   app        GET 127.0.0.1:3017/api/health → 200 + "ok":true
#   deep       GET /api/health/deep (CRON_SECRET) → problems[] (only when app up)
#   mcp        GET 127.0.0.1:3018/healthz → "ok"
#   pg         pg_isready against DATABASE_URL
#   worker     workers.heartbeat_at age (psql, independent of the app)
#   queues     oldest pending source event / action intent, exhausted events,
#              unknown intents, expired leases, oldest pending obligation,
#              pending runbook wakeups, last successful cron job, rate-limit skip streaks
#   backups    last OK db backup age, last run failed, destination configured
#
# Alerting: Telegram sendMessage via curl using TELEGRAM_BOT_TOKEN +
# TELEGRAM_OWNER_CHAT_ID from .env.local. State in
# ~/sjcos-backups/monitor-state.json: first alert immediately, repeat every 30
# minutes while failing, escalated wording from the 3rd notice, one "recovered"
# message when clean again. Every run appends to logs/sjcos-monitor.log.
#
# LIMITATION: if this HOST is down (power, disk, kernel) nothing here runs.
# Host-down detection needs another machine: put a cron on any always-on box
# (phone-hosted cron apps count) that curls
# https://os.sjcarpentryllc.com/api/health every 5 minutes and pages Joe on
# non-200 — see docs/automation-reliability/monitoring.md.
#
# Test seams (env): SJCOS_MONITOR_CURL, SJCOS_MONITOR_PSQL,
# SJCOS_MONITOR_PG_ISREADY (commands), SJCOS_MONITOR_STATE, SJCOS_MONITOR_LOG,
# SJCOS_MONITOR_NOW (epoch seconds), SJCOS_MONITOR_ENV (env file), thresholds
# below as SJCOS_MONITOR_<NAME>.
set -uo pipefail

APP="${SJCOS_APP:-$HOME/sjcos-app}"
ENV_FILE="${SJCOS_MONITOR_ENV:-$APP/.env.local}"
STATE="${SJCOS_MONITOR_STATE:-$HOME/sjcos-backups/monitor-state.json}"
LOG="${SJCOS_MONITOR_LOG:-$APP/logs/sjcos-monitor.log}"
CURL="${SJCOS_MONITOR_CURL:-curl}"
PSQL="${SJCOS_MONITOR_PSQL:-psql}"
PG_ISREADY="${SJCOS_MONITOR_PG_ISREADY:-pg_isready}"
NOW="${SJCOS_MONITOR_NOW:-$(date +%s)}"
HEALTH_URL="${SJCOS_MONITOR_HEALTH_URL:-http://127.0.0.1:3017/api/health}"
MCP_URL="${SJCOS_MONITOR_MCP_URL:-http://127.0.0.1:3018/healthz}"
TELEGRAM_API_BASE="${TELEGRAM_API_BASE:-https://api.telegram.org}"

# thresholds (seconds unless noted)
T_WORKER_HB="${SJCOS_MONITOR_WORKER_HB:-90}"
T_SOURCE_AGE="${SJCOS_MONITOR_SOURCE_AGE:-900}"
T_INTENT_AGE="${SJCOS_MONITOR_INTENT_AGE:-900}"
T_WAKEUP_AGE="${SJCOS_MONITOR_WAKEUP_AGE:-300}"
T_OBLIGATION_AGE="${SJCOS_MONITOR_OBLIGATION_AGE:-604800}"
T_CRON_AGE="${SJCOS_MONITOR_CRON_AGE:-7200}"
T_RATE_SKIPS="${SJCOS_MONITOR_RATE_SKIPS:-4}"
T_BACKUP_AGE_H="${SJCOS_MONITOR_BACKUP_AGE_H:-30}"
REPEAT_S="${SJCOS_MONITOR_REPEAT_S:-1800}"
ESCALATE_AFTER="${SJCOS_MONITOR_ESCALATE_AFTER:-3}"

mkdir -p "$(dirname "$LOG")" "$(dirname "$STATE")" 2>/dev/null || true

envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DATABASE_URL="${DATABASE_URL:-$(envval DATABASE_URL)}"
CRON_SECRET="${CRON_SECRET:-$(envval CRON_SECRET)}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(envval TELEGRAM_BOT_TOKEN)}"
TELEGRAM_OWNER_CHAT_ID="${TELEGRAM_OWNER_CHAT_ID:-$(envval TELEGRAM_OWNER_CHAT_ID)}"

FAILS=()
INFO=()
fail() { FAILS+=("$1"); }
info() { INFO+=("$1"); }

# ── app ──────────────────────────────────────────────────────────────────────
APP_UP=0
body="$($CURL -fsS -m 10 "$HEALTH_URL" 2>/dev/null)" || body=""
if [ -n "$body" ] && printf '%s' "$body" | grep -q '"ok":true'; then
  APP_UP=1
  sha="$(printf '%s' "$body" | grep -o '"sha":"[^"]*"' | head -1 | cut -d'"' -f4)"
  head_="$(printf '%s' "$body" | grep -o '"head":[0-9]*' | head -1 | cut -d: -f2)"
  info "app up (code ${sha:-?}, schema head ${head_:-?})"
else
  fail "app: $HEALTH_URL not answering ok (${body:0:120})"
fi

if [ "$APP_UP" = 1 ] && [ -n "$CRON_SECRET" ]; then
  deep="$($CURL -fsS -m 20 -H "Authorization: Bearer $CRON_SECRET" "${HEALTH_URL}/deep" 2>/dev/null)" || deep=""
  if [ -n "$deep" ]; then
    # problems: ["a","b"] → one FAIL per entry
    printf '%s' "$deep" | grep -o '"problems":\[[^]]*\]' | head -1 | sed -e 's/^"problems":\[//' -e 's/\]$//' | tr ',' '\n' | sed -e 's/^"//' -e 's/"$//' | while IFS= read -r p; do
      [ -n "$p" ] && echo "DEEP:$p"
    done > "${STATE}.deep.tmp" 2>/dev/null
    while IFS= read -r line; do [ -n "$line" ] && fail "${line#DEEP:}"; done < "${STATE}.deep.tmp"
    rm -f "${STATE}.deep.tmp"
  else
    fail "app: /api/health/deep did not answer"
  fi
fi

# ── mcp ──────────────────────────────────────────────────────────────────────
if $CURL -fsS -m 5 "$MCP_URL" 2>/dev/null | grep -q ok; then info "mcp up"; else fail "mcp: $MCP_URL not answering"; fi

# ── database, independent of the app ─────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  fail "db: DATABASE_URL not found in $ENV_FILE"
elif $PG_ISREADY -d "$DATABASE_URL" -q 2>/dev/null; then
  info "postgres ready"
  q() { $PSQL "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null; }
  # worker
  hb="$(q "SELECT COALESCE(min(EXTRACT(EPOCH FROM (now() - heartbeat_at)))::int, -1) FROM workers WHERE state <> 'stopped'")"
  if [ -z "$hb" ] || [ "$hb" = "-1" ]; then fail "worker: no live worker registered (sjcos-worker.service?)"
  elif [ "$hb" -gt "$T_WORKER_HB" ]; then fail "worker: heartbeat ${hb}s old (limit ${T_WORKER_HB}s)"
  else info "worker heartbeat ${hb}s"; fi
  wstate="$(q "SELECT state FROM workers WHERE name='sjcos-worker'")"
  [ "$wstate" = "timed_out" ] && fail "worker: last iteration timed out"
  [ "$wstate" = "error" ] && fail "worker: last iteration errored ($(q "SELECT left(COALESCE(last_result->>'error',''),120) FROM workers WHERE name='sjcos-worker'"))"
  # queues
  read -r se_old se_exh se_exp <<<"$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(received_at) FILTER (WHERE state IN ('pending','failed'))))::int,0), count(*) FILTER (WHERE state='exhausted'), count(*) FILTER (WHERE state='leased' AND lease_until < now()) FROM source_events" | tr '|' ' ')"
  [ "${se_old:-0}" -gt "$T_SOURCE_AGE" ] && fail "queues: oldest pending source event ${se_old}s old"
  [ "${se_exh:-0}" -gt 0 ] && fail "queues: ${se_exh} source event(s) exhausted retries"
  [ "${se_exp:-0}" -gt 0 ] && fail "queues: ${se_exp} expired source-event lease(s) unswept"
  read -r ai_old ai_unk ai_exp <<<"$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE state IN ('pending','retryable_failure'))))::int,0), count(*) FILTER (WHERE state='unknown'), count(*) FILTER (WHERE state='leased' AND lease_until < now()) FROM action_intents" | tr '|' ' ')"
  [ "${ai_old:-0}" -gt "$T_INTENT_AGE" ] && fail "queues: oldest pending action intent ${ai_old}s old (dispatcher stalled?)"
  [ "${ai_unk:-0}" -gt 0 ] && fail "sends/payments: ${ai_unk} action intent(s) UNKNOWN — reconcile with the provider"
  [ "${ai_exp:-0}" -gt 0 ] && fail "queues: ${ai_exp} expired intent lease(s) unswept"
  ob_old="$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at)))::int,0) FROM obligations WHERE status IN ('open','waiting')" || echo 0)"
  [ "${ob_old:-0}" -gt "$T_OBLIGATION_AGE" ] && fail "obligations: oldest open obligation ${ob_old}s old"
  wk_old="$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at)))::int,0) FROM runbook_wakeups WHERE state='pending'" || echo 0)"
  [ "${wk_old:-0}" -gt "$T_WAKEUP_AGE" ] && fail "runbooks: pending wakeup ${wk_old}s old — lost wakeup not drained"
  cr_age="$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(started_at) FILTER (WHERE ok)))::int, -1) FROM cron_runs" || echo -1)"
  if [ "${cr_age:-x}" = "-1" ]; then info "cron: no successful run recorded yet"
  elif [ "$cr_age" -gt "$T_CRON_AGE" ]; then fail "cron: last successful workflow step was ${cr_age}s ago"
  else info "cron last ok ${cr_age}s ago"; fi
  q "SELECT job || ' ' || n FROM (SELECT job, count(*) AS n FROM (SELECT job, ok, error_class, row_number() OVER (PARTITION BY job ORDER BY started_at DESC) rn FROM cron_runs) t WHERE rn <= $T_RATE_SKIPS AND NOT ok AND error_class='rate_limited' GROUP BY job) s WHERE n >= $T_RATE_SKIPS" 2>/dev/null | while read -r job n; do
    [ -n "$job" ] && echo "RL:$job $n"
  done > "${STATE}.rl.tmp"
  while IFS= read -r line; do [ -n "$line" ] && fail "cron: ${line#RL:} consecutive rate-limit skips — work is not being processed"; done < "${STATE}.rl.tmp"
  rm -f "${STATE}.rl.tmp"
  # backups
  bk_age="$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(finished_at) FILTER (WHERE state='ok')))::int / 3600, -1) FROM backup_runs WHERE kind='db'" || echo -1)"
  bk_last="$(q "SELECT state || ' ' || COALESCE(left(error,100),'') FROM backup_runs WHERE kind='db' ORDER BY started_at DESC LIMIT 1" || echo '')"
  bk_cfg="$(q "SELECT count(*) FROM backup_runs WHERE destination IS NOT NULL AND destination <> 'none'" || echo 0)"
  if [ "${bk_cfg:-0}" = "0" ]; then fail "backups: off-host destination NOT CONFIGURED (no backup has ever had a destination)"
  elif [ "${bk_age:-x}" = "-1" ]; then fail "backups: no successful db backup on record"
  elif [ "$bk_age" -gt "$T_BACKUP_AGE_H" ]; then fail "backups: last good db backup is ${bk_age}h old"
  else info "backup db ok ${bk_age}h ago"; fi
  case "$bk_last" in failed*) fail "backups: last db backup FAILED: ${bk_last#failed }";; esac
else
  fail "db: pg_isready failed for DATABASE_URL"
fi

# ── state, dedupe, escalation ────────────────────────────────────────────────
read_state() { grep -o "\"$1\": *\"\{0,1\}[^,}\"]*" "$STATE" 2>/dev/null | head -1 | sed -e "s/\"$1\": *//" -e 's/^"//' -e 's/"$//'; }
prev_fp="$(read_state fingerprint)"
prev_since="$(read_state failing_since)"; prev_since="${prev_since:-0}"
prev_alert="$(read_state last_alert_at)"; prev_alert="${prev_alert:-0}"
prev_count="$(read_state alert_count)"; prev_count="${prev_count:-0}"

fingerprint="$(printf '%s\n' "${FAILS[@]:-}" | sha256sum | cut -c1-16)"
write_state() { printf '{"fingerprint":"%s","failing_since":%s,"last_alert_at":%s,"alert_count":%s,"checked_at":%s,"failing":%s}\n' "$1" "$2" "$3" "$4" "$NOW" "$5" > "$STATE"; }

send_telegram() {
  local text="$1"
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_OWNER_CHAT_ID" ]; then
    echo "$(date -Is) ALERT (telegram not configured): $text" >>"$LOG"; return 1
  fi
  if $CURL -sS -m 15 -X POST "$TELEGRAM_API_BASE/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
       --data-urlencode "chat_id=$TELEGRAM_OWNER_CHAT_ID" --data-urlencode "text=$text" >/dev/null 2>&1; then
    return 0
  fi
  echo "$(date -Is) ALERT DELIVERY FAILED (telegram): $text" >>"$LOG"; return 1
}

if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "$(date -Is) ok: ${INFO[*]}" >>"$LOG"
  if [ -n "$prev_fp" ] && [ "$prev_count" -gt 0 ]; then
    down_for=$(( NOW - prev_since ))
    send_telegram "[SJC OS monitor] recovered — all checks pass again (was failing for $((down_for/60)) min)." || true
  fi
  write_state "" 0 0 0 false
  echo "OK"
  exit 0
fi

echo "$(date -Is) FAIL(${#FAILS[@]}): $(printf '%s; ' "${FAILS[@]}")" >>"$LOG"
since="$prev_since"; count="$prev_count"
[ "$prev_fp" = "$fingerprint" ] || since=0
[ "$since" = 0 ] && since="$NOW"
should_alert=0
if [ "$prev_fp" != "$fingerprint" ]; then should_alert=1
elif [ $(( NOW - prev_alert )) -ge "$REPEAT_S" ]; then should_alert=1; fi

if [ "$should_alert" = 1 ]; then
  count=$(( count + 1 ))
  prefix="[SJC OS monitor] PROBLEM"
  [ "$prev_fp" = "$fingerprint" ] && prefix="[SJC OS monitor] STILL FAILING (notice $count, since $(date -d "@$since" '+%H:%M' 2>/dev/null || echo "$since"))"
  [ "$count" -ge "$ESCALATE_AFTER" ] && prefix="🚨 [SJC OS monitor] ESCALATION — failing for $(( (NOW - since) / 60 )) min and $count notices: this needs you now"
  msg="$prefix"$'\n'"$(printf -- '- %s\n' "${FAILS[@]}")"
  send_telegram "$msg" && last_alert="$NOW" || last_alert="$prev_alert"
  write_state "$fingerprint" "$since" "${last_alert:-$NOW}" "$count" true
else
  write_state "$fingerprint" "$since" "$prev_alert" "$count" true
fi
printf 'FAIL %s\n' "${FAILS[@]}"
exit 1
