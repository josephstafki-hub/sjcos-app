# SJC OS — Deployment

Production host: this Linux box (residential, public IP `73.94.192.119`).
Public URL: **https://os.sjcarpentryllc.com**

## Architecture

```
browser ──HTTPS──> nginx (:443, Let's Encrypt) ──HTTP──> 127.0.0.1:3017 (Next.js prod)
                                                            │
                                                            ├── Postgres :5432 (role/db: sjcos)
                                                            └── Ollama :11434 (qwen2.5:7b-instruct)
```

- **App**: `next start` on loopback `127.0.0.1:3017`, run as the systemd **user** service
  `sjcos.service` (reboot-persistent via `loginctl enable-linger joe`). See `sjcos.service`.
- **AI**: Ollama runs as the systemd user service `ollama.service` (separate).
- **TLS/DNS**: `os.sjcarpentryllc.com` is an A record → `73.94.192.119`, **DNS-only (grey
  cloud)** in the Cloudflare account that holds the zone (managed by Joe's web developer;
  registrar is Squarespace). nginx terminates TLS via certbot. See `nginx-sjcos.conf`.

## First-time go-live steps

1. **DNS** (developer, one-time): add A record `os` → `73.94.192.119`, DNS-only.
   Verify: `dig +short A os.sjcarpentryllc.com @1.1.1.1` returns `73.94.192.119`.
2. **App service**: `cp deploy/sjcos.service ~/.config/systemd/user/ && systemctl --user
   daemon-reload && systemctl --user enable --now sjcos.service`
3. **nginx + TLS** (sudo):
   ```
   sudo cp deploy/nginx-sjcos.conf /etc/nginx/sites-available/sjcos
   sudo ln -s /etc/nginx/sites-available/sjcos /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d os.sjcarpentryllc.com
   ```
4. **Env**: `.env.local` (gitignored) must set `GMAIL_REDIRECT_URI=https://os.sjcarpentryllc.com/api/inbox/oauth/callback`,
   `AI_PROVIDER=ollama`, `NEXT_PUBLIC_AI_PROVIDER=ollama`, `SESSION_SECRET`, DB + Gmail creds.
5. **Gmail modify re-consent** (one-time, after TLS): register the prod redirect URI in Google
   Cloud Console → Credentials → the OAuth client, then visit
   `https://os.sjcarpentryllc.com/api/inbox/oauth/start`, approve, paste the new
   `GMAIL_REFRESH_TOKEN` into `.env.local`, `systemctl --user restart sjcos.service`.

## Redeploy after a code change

```
cd ~/sjcos-app
git pull                       # (or edit in place)
npm run build                  # do NOT run while sjcos.service is live if it shares .next — stop it first
systemctl --user restart sjcos.service
```

### Zero-downtime variant — stage now, go live on the next restart

`next.config.ts` honours `SJC_DIST_DIR`, and `sjcos.service` runs
`deploy/promote-staged-build.sh` as `ExecStartPre`. So the app can keep serving
the old build while the new one compiles beside it:

```
cd ~/sjcos-app
git pull --ff-only
SJC_DIST_DIR=.next-staged npm run build      # live .next untouched
systemctl --user restart sjcos.service       # later, whenever: swaps .next-staged → .next
```

The promote step is a no-op unless `.next-staged/BUILD_ID` exists, and it parks
the previous build at `~/sjcos-backups/next-rollback` (move it back + restart to
roll back). Don't leave `.next-staged` lying around after a source change — a
restart would promote a build of older code.

## Scheduler — daily reminders

A systemd **user timer** runs the reminder sweep (`/api/cron/reminders`) once a
day at 08:00. The endpoint is not session-gated (the proxy excludes `/api`); it
checks `CRON_SECRET` from `.env.local`. Reboot-persistent via the existing
`loginctl enable-linger joe`.

Install (one-time):
```
# .env.local must contain CRON_SECRET=<random hex>  (gitignored)
install -m755 deploy/sjcos-reminders.sh ~/bin/sjcos-reminders
cp deploy/sjcos-reminders.service deploy/sjcos-reminders.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-reminders.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-reminders.service           # trigger now
journalctl --user -u sjcos-reminders.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-reminders.timer       # next run
```

Windows emitted: compliance items 60/30 days out; sub COI expiry 30/15/5;
warranty-claim ack (≤2d) + resolution (≤5d); insurance-policy renewals 60/30/14;
and A/R dunning at 15/30 days overdue (the urgent ≤14-day compliance window is
emitted on feed-read in `lib/notify.ts`). Each (record, window) fires once via
the `reminder_log` dedup table. The cron JSON returns a per-scan count
(`compliance`/`coi`/`warranty`/`insurance`/`ar`).

## Scheduler — owner-agent approval-ping retries

A systemd **user timer** runs every 10 minutes (`/api/cron/agent-retries`) to
re-nudge a work item's owner agent (Hermes/Claude) when the approval ping sent
from the Approve button (`notifyAgentOwner()` in `lib/dev-agents.ts`) errored
out — e.g. the Hermes gateway or `claude` CLI wasn't reachable at the moment
Joe clicked Approve. Same auth pattern as the reminders cron (`CRON_SECRET`).
Gives up after 5 attempts on one item; the last "⚠️ ..." reply in that item's
Ask-window conversation is the record of why.

Install (one-time):
```
install -m755 deploy/sjcos-agent-retries.sh ~/bin/sjcos-agent-retries
cp deploy/sjcos-agent-retries.service deploy/sjcos-agent-retries.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-agent-retries.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-agent-retries.service           # trigger now
journalctl --user -u sjcos-agent-retries.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-agent-retries.timer       # next run
```

## Scheduler — live "needs reply" lead-thread sync

A systemd **user timer** runs every 15 minutes (`/api/cron/lead-thread-sync`)
to keep a lead's "Needs reply" flag + `last_contact_at` honest against real
Gmail state: whoever sent the MOST RECENT message in a lead's matched thread
determines whether we owe them a reply (see `lib/lead-thread-sync.ts`). This
catches replies sent from Gmail directly (outside the app) — an in-app reply
already clears the flag instantly via `logLeadActivity()`. No-ops safely if
Gmail isn't connected (`gmailConfigured()` false). Same auth pattern as the
reminders cron.

Pass `?dry=1` to compute + return what WOULD change without writing — used to
sanity-check the feature before the timer runs unattended, and safe to reuse
any time (e.g. after Gmail is (re)connected).

Install (one-time):
```
install -m755 deploy/sjcos-lead-thread-sync.sh ~/bin/sjcos-lead-thread-sync
cp deploy/sjcos-lead-thread-sync.service deploy/sjcos-lead-thread-sync.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-lead-thread-sync.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-lead-thread-sync.service           # trigger now
journalctl --user -u sjcos-lead-thread-sync.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-lead-thread-sync.timer       # next run
```

## Scheduler — hourly detector sweep (W1)

A systemd **user timer** runs the detector layer (`/api/cron/detect`) hourly at
**:20** (offset from the newsletter drip at :10 and the lead-thread sync at
:0/15). Ten deterministic detectors (`lib/detectors.ts`) file work items for
conditions like "client waiting 3+ days", "sent estimate unanswered 7+ days",
"approved estimate with no draw schedule" — one item per underlying thing via
the `detector_state` dedup table — and auto-resolve them when the condition
clears. Max 30 work-item creations per run, so a first-run burst spreads over a
few hours. Same auth pattern as the reminders cron.

Pass `?dry=1` to compute + return what WOULD be filed/bumped/resolved without
writing — review that output before enabling the timer, and reuse it any time
a threshold changes.

Install (one-time):
```
install -m755 deploy/sjcos-detect.sh ~/bin/sjcos-detect
cp deploy/sjcos-detect.service deploy/sjcos-detect.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-detect.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-detect.service           # trigger now
journalctl --user -u sjcos-detect.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-detect.timer       # next run
```

## Scheduler — hourly bid follow-up sweep

A systemd **user timer** runs the bid-chase sweep (`/api/cron/bid-follow-ups`)
hourly at **:25**. Like the newsletter drip, this one can send email to real
people (subs on an open bid package) without a Release click — the guards are
documented at the top of `lib/bid-follow-ups.ts`. Per package it is armed by
the "Auto follow-up" switch on the Bidding tab (new packages default ON;
packages that predate the feature were backfilled OFF). Silent subs get nudges
at day 2 and 5 after the packet was emailed, subs marked "working on it" get a
softer check-in at day 4, and the sweep also retries any thank-you email that
failed when Joe recorded a bid. Claim-before-send on `bid_invite_emails`
(unique per invite + kind) makes re-runs and overlaps double-send-proof; max
25 sends per run. Same auth pattern as the reminders cron.

Install (one-time; DB first — `node db/apply-bid-follow-ups.mjs`):
```
install -m755 deploy/sjcos-bid-follow-ups.sh ~/bin/sjcos-bid-follow-ups
cp deploy/sjcos-bid-follow-ups.service deploy/sjcos-bid-follow-ups.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-bid-follow-ups.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-bid-follow-ups.service           # trigger now
journalctl --user -u sjcos-bid-follow-ups.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-bid-follow-ups.timer       # next run
```

## Voice daily logs — whisper.cpp (Phase-3 7-voice)

Local, offline speech-to-text for the daily-log composers. `/api/transcribe`
decodes the browser recording with **ffmpeg** (system package) and transcribes
it with **whisper.cpp** (user-local, no sudo). `lib/transcribe.ts` shows the mic
button only when both the binary and model are present, so typed logs never
break if it's missing.

Install (one-time, no sudo — matches the Ollama pattern):
```
# portable cmake (whisper.cpp needs it to build)
curl -sL https://github.com/Kitware/CMake/releases/latest \
  | grep -oE 'cmake-[0-9.]+-linux-x86_64.tar.gz' | head -1   # note the version
# download that asset, extract to ~/.local/opt, symlink bin/cmake -> ~/.local/bin

# build whisper.cpp
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git ~/.local/src/whisper.cpp
cd ~/.local/src/whisper.cpp
PATH="$HOME/.local/bin:$PATH" cmake -B build -DCMAKE_BUILD_TYPE=Release
PATH="$HOME/.local/bin:$PATH" cmake --build build -j 8        # -> build/bin/whisper-cli

# model (English, ~142MB)
mkdir -p ~/.local/share/whisper-models
curl -sL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin \
  -o ~/.local/share/whisper-models/ggml-base.en.bin
```

Defaults (override in `.env.local` if you move them):
`WHISPER_BIN=~/.local/src/whisper.cpp/build/bin/whisper-cli`,
`WHISPER_MODEL=~/.local/share/whisper-models/ggml-base.en.bin`, `FFMPEG_BIN=ffmpeg`.
The pipeline is `ffmpeg -ar 16000 -ac 1 -c:a pcm_s16le` → `whisper-cli -nt -np -otxt`.

## MCP HTTP service (`sjcos-mcp.service`)

`deploy/sjcos-mcp.service` is the user unit for the bearer-gated Streamable
HTTP MCP transport on `127.0.0.1:3018` (Hermes' `sjcos` tools). Install /
update it with `cp deploy/sjcos-mcp.service ~/.config/systemd/user/ &&
systemctl --user daemon-reload && systemctl --user restart sjcos-mcp.service`.
`ExecStart` resolves node via `/usr/bin/env node` — never hardcode a binary
path: an older copy pointed at `/usr/local/bin/node`, which vanished with a
Node upgrade and left the unit crash-looping (`status=203/EXEC`) from Aug 3–15
2026, unnoticed. Restart it after every deploy so newly added tools register.

A watchdog timer backstops the service: `sjcos-mcp-watchdog.{sh,service,timer}`
probes the unauthenticated `GET /healthz` on `127.0.0.1:3018` every 5 minutes;
on failure it restarts `sjcos-mcp.service` and appends a timestamped line to
`~/sjcos-app/logs/sjcos-mcp-watchdog.log`. Install (one-time):
```
install -m755 deploy/sjcos-mcp-watchdog.sh ~/bin/sjcos-mcp-watchdog
cp deploy/sjcos-mcp-watchdog.service deploy/sjcos-mcp-watchdog.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-mcp-watchdog.timer
```

Two nginx locations in `deploy/nginx-sjcos.conf` are load-bearing for the
claude.ai / ChatGPT connectors and must be present in the LIVE
`/etc/nginx/sites-available/sjcos` (certbot rewrites that copy, so diff it
against the repo after any cert work): the `/.well-known/oauth*` +
`/.well-known/openid-configuration` → `404` blocks (added to the repo
2026-08-03 but found missing live on 2026-08-17 — connectors then see a
307-to-login and treat the host as a broken OAuth server) and the secret
`location = /mcp-connect-<random>` that injects the bearer. Don't `cp` the
whole repo file over the live one (you'd lose the certbot TLS lines and the
live secret path/token) — paste the missing `location` blocks into the live
`server {}` block, then `sudo nginx -t && sudo systemctl reload nginx`. Check
with `curl -sI https://os.sjcarpentryllc.com/.well-known/oauth-protected-resource`
→ `404`.

## Universal operator panel deploy notes (2026-08-15)

- Migrations (idempotent): `node db/apply-orchestration-p1.mjs` … `p4.mjs`.
- Piper TTS lives at `~/.local/bin/piper` (symlink into the extracted release
  under `~/.local/src/piper/` — keep it a symlink; the bundled libs sit beside
  the binary) with the `en_US-lessac-medium` voice in
  `~/.local/share/piper-voices/`. Override with `PIPER_BIN` / `PIPER_VOICE`.
- Do NOT leave old `.next*` build/backup directories inside the repo:
  `tsconfig.json` includes `.next-preview/**/types`, so a stale
  `validator.ts` there breaks `next build`'s typecheck against moved routes.
  Park backups under `~/sjcos-backups/` instead.

## Scheduler — same-day lead first response sweep

The same-day first response to a new inbound lead (`lib/lead-first-response.ts`)
normally runs right at intake. A systemd **user timer** every 10 minutes
(`/api/cron/lead-first-response`) is the safety net for anything missed — model
down, restart mid-draft. It only *mails* when the owner has armed
"Auto-send the first response to new inbound leads" in Settings → AI; otherwise
it stages drafts on the lead page. One-time DB step: `node db/apply-lead-first-response.mjs`.

Install (one-time):
```
install -m755 deploy/sjcos-lead-first-response.sh ~/bin/sjcos-lead-first-response
cp deploy/sjcos-lead-first-response.service deploy/sjcos-lead-first-response.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-lead-first-response.timer
```
