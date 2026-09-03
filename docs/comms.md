# SMS + voice on Telnyx

Built 2026-09-02 from `SJCOS_Comms_Build_Prompt.md`. Two-way texting and phone
calls for SJ Carpentry inside SJC OS, on Telnyx. This page is the operator
reference: what exists, how it is wired, what Joe configures, how to prove it.

Provider ruling: **Telnyx only.** Twilio permanently banned the account on
2026-08-29 (ticket 29159205); there is no Twilio code path and there will not be.

## What it does

- **Texts in** land on `/messages`, link to the lead / project / sub / vendor
  whose phone matches, push Joe on Telegram (quiet hours 7am–9pm CT respected),
  and file a work item if unanswered after 4 hours (hourly detector layer).
- **Texts out** go only through a single-use **owner grant** — Joe's Reply
  button mints one inline; agents use `send_sms` with a grant Joe approved.
  Opted-out contacts (STOP) are refused with a reason, never silently dropped.
- **Calls in** to the business number are answered by the OS, recorded (dual
  channel) and forwarded to Joe's cell. No IVR, no greeting. No answer →
  voicemail (greeting, beep, recorded) → callback work item + push.
- **Click-to-call** from `/messages` or `/calls`: Joe's cell rings first; when
  he picks up the OS dials the other party and bridges. Grant-gated the same way
  (`place_call`).
- **Every recorded call** is transcribed by Telnyx and turned into **AI call
  notes** (summary, decisions, action items, scope / price / schedule flags),
  filed to Open Brain against the linked record, pushed to Joe, and action items
  become work items. Hermes drafts, Claude sonnet reviews; an unparseable or
  failed review retries, never approves.
- **10DLC registration** is a CLI (`scripts/register-10dlc.mjs`), dry-run by
  default, with a daily timer watching the carrier status. Rejection is loud.
- **Nothing fails silently**: startup validation names every missing variable,
  `GET /api/comms/health` covers both integrations, and every webhook / timer /
  provider failure files a work item and pushes Joe.

## Environment (`.env.local`, gitignored)

The repo is public. Every value lives here and nowhere else.

```
# Messaging
SMS_PROVIDER=telnyx
SMS_API_KEY=                       # Telnyx bearer (also used for voice commands)
SMS_MESSAGING_PROFILE_ID=          # uuid of the "SJC OS" messaging profile
SMS_FROM_NUMBER=                   # +E.164
SMS_PUBLIC_KEY=                    # base64 Ed25519 public key (portal → API keys → Public key)

# Voice
VOICE_APPLICATION_ID=              # Call Control application id
VOICE_FROM_NUMBER=                 # +E.164, same number as SMS_FROM_NUMBER for now
VOICE_FORWARD_TO=                  # +E.164, Joe's cell
VOICE_RECORDING=all                # all | off
VOICE_RECORDING_ANNOUNCEMENT=off   # off | on  (built, ships off — env change + restart only)
VOICE_TRANSCRIPTION=telnyx

# 10DLC registration script + daily watch only
TELNYX_API_KEY=
TENDLC_LEGAL_NAME=                 # exact IRS legal name. NOT the display name. Never normalized.
TENDLC_DISPLAY_NAME=
TENDLC_EIN=                        # 12-3456789
TENDLC_PHONE=                      # +E.164
TENDLC_STREET=                     # physical address, no P.O. box
TENDLC_CITY=
TENDLC_STATE=                      # MN
TENDLC_POSTAL_CODE=
TENDLC_COUNTRY=US
TENDLC_EMAIL=
TENDLC_WEBSITE=                    # https://
TENDLC_VERTICAL=CONSTRUCTION
```

Optional tuning (defaults in parentheses): `VOICE_RING_SECONDS` (25),
`VOICE_RECORDING_NOTICE`, `VOICE_VOICEMAIL_GREETING`, `VOICE_TTS_VOICE`
(`female`, basic tier), `VOICE_TRANSCRIPTION_ENGINE` (`B` = Telnyx; `A` =
Google), `SMS_HELP_AUTOREPLY` (`on`), `TENDLC_STATE_FILE`
(`.10dlc-state.json`), `TELNYX_API_BASE` (test stub).

Removed with Twilio and flagged as stale if present: `SMS_ACCOUNT_SID`,
`SMS_AUTH_TOKEN`, `SMS_WEBHOOK_SECRET`.

**Validation semantics** (`lib/comms/env.ts`): a feature is *enabled* when its
switch var is set (`SMS_PROVIDER`, `VOICE_APPLICATION_ID`, `TELNYX_API_KEY`).
An enabled feature with anything missing or invalid is *broken*: the startup
check (`instrumentation.ts`) logs every missing var at once, files a work item,
pushes Joe, and the feature refuses to run (sends refuse, webhooks answer 503).
Unset switch = inert, one calm log line.

## Public endpoints (configure in the Telnyx portal)

| Purpose   | Route file                       | Public URL                                        |
| --------- | -------------------------------- | ------------------------------------------------- |
| Messaging | `app/api/sms/webhook/route.ts`   | `https://os.sjcarpentryllc.com/api/sms/webhook`   |
| Voice     | `app/api/voice/webhook/route.ts` | `https://os.sjcarpentryllc.com/api/voice/webhook` |

Both: API **V2**, Ed25519-signed with the same key, verified by
`lib/comms/telnyx-signature.ts` (raw body → `${timestamp}|${body}` → Node
`crypto.verify`, 5-minute replay window). Unverified bodies are never processed
(401). Both return 200 immediately and do the work in `after()`.

Two public audio files Telnyx plays (generated in code, no data):
`/api/voice/audio/ringback.wav`, `/api/voice/audio/beep.wav`.

## The send line

`lib/owner-grant-types.ts` adds two gated actions: `send_sms` and `place_call`,
target kind `phone`, target id the +E.164 number. `grantCovers()` is the pure
rule (unit-tested), `consumeGrant()` spends atomically.

- Owner UI: `lib/actions/sms.ts` / `lib/actions/calls.ts` mint a 1-use,
  short-lived grant on the click, then call the same core.
- Agents: MCP `send_sms` / `place_call` (`mcp/grants-tools.mjs`) →
  `/api/internal/owner-grants` → `lib/agent-sends.ts` → `lib/sms.ts sendSms()`
  / `lib/voice.ts placeCall()`. No grant, nothing transmits.
- The one deliberate exception: the carrier-mandated HELP/INFO auto-response
  (`sendHelpReply`), a fixed registered string, `sent_by = 'system:help'`.

## Data model (`db/apply-comms-sms-voice.mjs`, mirrored in `db/schema.sql`)

- `sms_threads` + `opted_out`, `opted_out_at`, `opted_in_at`,
  `last_inbound_at`, `last_outbound_at`, `business_number`; `vendor` link type.
- `sms_messages` + `media` (re-stored MMS as `files` rows), `error_*`,
  `failure_kind`, `sent_by`, `grant_id`, `keyword`.
- `calls`: one row per call — legs, outcome, recording (a `files` row under
  `uploads/`), transcript, AI notes, linked record, callback work item, grant.
- `call_events`: the Call Control webhook trail per call (dedup on event id).
- `push_outbox.kind` gains `voice_call`, `comms`.

Run on the server: `node db/apply-comms-sms-voice.mjs`, then restart
`sjcos.service` and `sjcos-mcp.service`.

## Inbound SMS flow (`lib/sms.ts recordInboundSms`)

1. Thread upsert by +E.164; dedup on Telnyx message id.
2. Auto-link by last-10-digits: converted lead → its project, else lead, sub,
   vendor (`lib/comms-shared.ts matchPhoneToRecord`). Unmatched still lands.
3. Keywords, case-insensitive, message must *be* the keyword:
   `STOP`/`UNSUBSCRIBE` → `opted_out`; `HELP`/`INFO` → registered help reply;
   `START`/`YES` → opted back in. All six registered on the campaign are honoured.
4. MMS `media[]` downloaded and re-stored (`files` rows; Telnyx URLs expire).
5. Telegram push (`sms_inbound`, quiet hours + hourly cap apply).
6. Delivery receipts (`message.sent` / `message.finalized`) update the outbound
   row; a terminal failure files a work item — a 10DLC-pending failure is
   labelled "10DLC campaign not yet approved", normal priority, one open item.
7. Detector `sms-unanswered` (hourly, `lib/detectors.ts`): unread thread, last
   inbound ≥ 4h old, no outbound since → high-priority work item.

## Voice flow (`lib/comms/voice-flow.ts` plans, `lib/voice.ts` executes)

Inbound: `call.initiated` → answer → (`VOICE_RECORDING_ANNOUNCEMENT=on`: speak
notice) → `record_start` dual/mp3 with Telnyx transcription → dial
`VOICE_FORWARD_TO` (`link_to` the caller leg) + ringback to the caller → Joe
answers → bridge. Joe doesn't answer in `VOICE_RING_SECONDS` → greeting → beep
(recording already running; if recording is off, `record_start` with beep) →
caller hangs up → callback work item + push. Caller gives up while ringing →
Joe's leg is hung up, "missed" push.

Outbound (`placeCall`): dial Joe's cell with state `{role: owner}` → on answer:
record, dial the client with `link_to`, ringback to Joe → client answers →
bridge. No answer → "No answer from …" spoken to Joe → hang up.

Recording (`call.recording.saved`, URL valid 10 min) is downloaded at once into
`uploads/` as a `files` row. Transcript arrives on
`call.recording.transcription.saved` and triggers `lib/call-notes.ts`.

Every command carries `client_state = base64 {c: callId, r: role, p: phase}`;
the planner keys on it, so an answering layer could be inserted later by
changing plans, not the webhook.

## AI call notes (`lib/call-notes.ts`)

Prompted from the transcript + call context → JSON `{summary, decisions[],
action_items[], flags[]}`. Draft by Hermes (`askHermes`); if the gateway is
unreachable, Claude sonnet drafts. Review by `reviewCallNotes` in
`lib/orchestrator/claude-review.ts` (sonnet, low effort); `null` = retry, up to
`CALL_NOTES_MAX_ROUNDS` (2). On approve: `calls.notes`, a `knowledge_items` row
(`kind = call_summary`, linked lead/project), work items for Joe's action items,
a `voice_call` push with the summary and flags. On failure: work item "write up
the call yourself" + push. The note-taker never sends, never changes stages.

## 10DLC registration (`scripts/register-10dlc.mjs`)

```
node scripts/register-10dlc.mjs brand      --confirm
node scripts/register-10dlc.mjs vetting    --confirm
node scripts/register-10dlc.mjs campaign   --confirm
node scripts/register-10dlc.mjs assign +1XXXXXXXXXX --confirm
node scripts/register-10dlc.mjs status
```

Dry run is the default (prints the exact body, sends nothing). Ids land in
`.10dlc-state.json` (gitignored); a stage with an id refuses without `--force`.
Local validation first: EIN `^\d{2}-\d{7}$`, E.164 phone, https website, no P.O.
box. Trial accounts print "account is on trial, 10DLC unavailable, upgrade first".
Bodies live in `lib/comms/tendlc.mjs` (shared with the watch): PRIVATE_PROFIT,
usecase MIXED, embeddedLink true, numberPool false, ageGated false, keywords
`START,YES` / `STOP,UNSUBSCRIBE` / `HELP,INFO`; asserts that a sample has a URL
and every sample carries opt-out language.

Live API paths differ from the prompt in two places (checked against the Telnyx
OpenAPI spec): number assignment is `POST /v2/10dlc/phone_number_campaigns`,
vetting is `POST /v2/10dlc/brand/{id}/externalVetting` with `{evpId: "AEGIS",
vettingClass: "STANDARD"}`.

Daily watch: `app/api/cron/comms-watch` (`deploy/sjcos-comms-watch.*`, 09:05).
Diffs brand + campaign + assignment status vs the last snapshot in
`app_settings`; any change → push + work item; rejection → **urgent**.

## Health

- Startup: `instrumentation.ts` → `commsStartupCheck()`.
- `GET /api/comms/health` (CRON_SECRET bearer): env report, Telnyx probes
  (messaging profile + Call Control app), last verified webhook per channel,
  10DLC snapshot, last comms error. 503 when anything is wrong.
- Failure path: `reportCommsFailure(area, err)` → one open work item per area
  (refreshed) + one push per area per day. Used by both webhooks, sends, call
  commands, recording storage, notes, the watch.
- Daily sweep closes calls that never hung up and transcripts that never came.

## MCP tools

Granted (need `owner_grant_id`): `send_sms`, `place_call`. Read-only:
`list_sms_threads`, `get_sms_thread`, `list_calls`, `get_call` (transcript +
notes). See `mcp/README.md`.

## Testing

No Telnyx account needed — `npm test` (Node's test runner; TS imported directly):

- signature accept / reject / tamper / wrong key / replay window
- E.164 normalization incl. rejections
- inbound payload parsing (`to[]` array, `from.phone_number`, `media[]`)
- all six keywords, case-insensitive; sentences are not keywords
- env validation naming every missing var at once; Twilio rejected
- grant gate: no grant / wrong action / wrong number / spent / expired refused
- 10DLC: local validation, body rulings, campaign asserts, status diff, trial
  detection; the CLI's dry-run output for every stage and each rejection
- the whole call flow (inbound, voicemail, missed, outbound, no-answer) as
  planner tests

Needs the account, in this order: **voice first** (works as soon as the number
and Call Control app exist, does not wait on 10DLC), then SMS once the campaign
is approved. Before either: set the env, restart, check
`journalctl --user -u sjcos.service | grep comms` for the startup report and
`GET /api/comms/health`.

## Go-live checklist

1. `node db/apply-comms-sms-voice.mjs` on the server.
2. Fill `.env.local`; `systemctl --user restart sjcos.service sjcos-mcp.service`.
3. Portal: messaging profile webhook → `/api/sms/webhook` (API V2); Call Control
   app webhook → `/api/voice/webhook` (API V2); number on the profile + app.
4. Install the `sjcos-comms-watch` timer (deploy/README.md).
5. Voice: call the number from another phone → Joe's cell rings → hang up →
   `/calls` shows the record, recording, transcript, notes.
6. 10DLC: `brand`, `vetting`, `campaign`, `assign` with `--confirm`; watch the
   daily push. SMS end-to-end after "campaign approved".
7. Google Voice port only after both work end to end; then
   `assign +1<ported> --confirm` again.
