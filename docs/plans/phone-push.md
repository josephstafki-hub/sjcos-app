# Phone alerts: everything the Telegram bot does, in the SJC OS app

Joe, 2026-11-05: "migrate all the notifications and functionality of SJC OS
telegram channel into the mobile apps". Repos:

- Backend: `/home/joe/.t3/worktrees/sjcos-app/t3-ed43be56`, branch `t3/phone-push` (from main 76d57cd8).
- Phone: `/home/joe/.t3/worktrees/sjcos-mobile-push`, branch `phone-push` (from sjcos-mobile main cab1a34, build 5).

## 0. Decisions (coordinator's calls; Joe can overturn them)

1. **Telegram stays switched on until the app has proven itself.** The phone is a
   second owner channel in `CHANNELS` (lib/notify-owner.ts), not a replacement.
   An owner setting picks where alerts go: **App**, **Telegram**, or **Both**
   (default: Both while the first builds are tested). The Telegram webhook keeps
   working whatever the setting, so an old card's buttons still work.
2. **Owner only**, same as Telegram ("THE LINE" in notify-owner.ts). Staff logins
   may register devices (stored, never pushed by notifyOwner) so a later staff
   feature can reuse the table.
3. **Direct to Apple (APNs HTTP/2 + ES256 token), no Expo push service.** Alert
   text carries client names and draft text; it should not pass through a third
   party. Android is parked (no Play build); the table and payload builder take
   a `platform` so FCM can be added later.
4. **Same rules as Telegram**: quiet hours 07:00–21:00 America/Chicago, 4 per
   rolling hour with the same exempt kinds, parking in `push_outbox`, the
   "…and N more" fold, stale-approval nudges after 4h. One gate for all channels:
   a push that is parked is parked for every channel.
5. **One action path.** A phone button does exactly what the Telegram button
   does: the webhook's post-commit logic moves into one shared module that both
   the webhook and the phone endpoint call. No second copy of approval rules.

## 1. Telegram parity checklist (the completeness judge scores against this)

Every row must work from the phone, from the lock screen where noted.

| # | Telegram today | Where it lives | Phone |
|---|---|---|---|
| P1 | Push for each `OwnerPushKind`: grant, decision, urgent_item, agent_failure, stale_approval, approval_needed, sms_inbound, voice_call, comms, payment, contract_signed, portal_message | lib/notify-owner.ts + 34 call sites | Remote push, same title/body, tap opens the right screen |
| P2 | Quiet hours, hourly cap, cap-exempt kinds, parking + drain, "…and N more" summary | notify-owner `gate`, `runPushDrain` | Same gate; drained rows go to the app too |
| P3 | Decision card buttons: Approve ✓ / Request changes / Hold 4h, content-hash checked | keyboards.ts `d|…`, telegram.ts, webhook | Lock-screen actions + in-app buttons; stale hash refused with the reason |
| P4 | Approve does the real thing (sends woken, first-draw invoice emailed, staged grant send performed) and says what happened | webhook → `performApprovalEffects` | Same function; result shown in-app and as a follow-up push line |
| P5 | Draft (work item) card: "Approve & send ✓" / "Approve ✓" / Decline; refused if pulled back or already decided | `w|…`, `approveWorkItemById`, `describeApproval` | Same |
| P6 | Request changes → "what should change?" prompt; the typed answer pulls the request (changes_requested) and goes to the chat that filed it or the operating agent | `askWhatShouldChange`, owner-replies.ts, owner-reply-delivery.ts | "Change…" text action on the notification + reply box in-app |
| P7 | Text reply to any decision/permission/draft card does P6 directly; card updated "Pulled back for changes…" | `recordOwnerReply`, `markDraftCardPulled`, `refreshTelegramCard` | Reply box; the card's state updates |
| P8 | Agent's answer to Joe's note (`reply_to_owner`: no_change / question / done; run replies; acks; `sweepUnansweredReplies`) threaded under his note | owner-reply-delivery.ts `replyToOwner`, `sendOwnerTelegram` | Push threaded under the original alert; shows in the alert's thread; Joe can reply again |
| P9 | Portal message push carries the text; reply posts into the portal as Joe; ack "Posted in the portal for X. Reply here to send more." and that ack is itself replyable | `notifyPortalMessage`, portal-replies.ts | "Reply" text action + thread; ack shown; follow-ups allowed |
| P10 | A card is edited in place once decided (Approved ✓ / Declined / Changes requested) | `refreshTelegramCard`, webhook `edit` | Decided alerts drop off the lock screen / Notification Center and show their outcome in-app; badge = open approvals |
| P11 | Revised draft re-pushes threaded under Joe's note | `closeRepliesRevisedByDraft` | Same thread |
| P12 | Help text for a message that isn't a reply | `REPLY_HELP` | Not needed: the operator (Ask) is the free-text path. The thread composer only exists on replyable alerts |
| P13 | Every update persisted before acting; duplicate update ids never re-applied; only the owner can resolve | telegram_updates, `ownerPrincipal` | Each phone action has a client `actionId` (UUID), stored before acting; a repeat returns the first result; owner session required |
| P14 | Channel health logged (`logChannelStatus`), test seams (`TELEGRAM_API_BASE`, `SJC_OUTBOUND_DISABLED`) | notify-owner, providers/telegram.ts | `APNS_API_BASE` stub seam, fake mode under `SJC_OUTBOUND_DISABLED=1`, status line per channel, "Send a test alert" button |
| P15 | Payment / contract-signed alerts (no buttons) | payments/owner-alert.ts, actions/esign.ts | Push, tap opens the job's money / documents |

## 2. Backend (Codex builder)

### Migration `db/migrations/0092_phone_push.sql`
Numbers 0074–0091 are taken by open PRs (#110, #112, subs). Use **0092**.

- `push_devices`: id uuid pk, user_id uuid → users, platform text check ('ios','android'),
  token text unique, environment text check ('sandbox','production'),
  app_version text, build text, device_name text, created_at, last_seen_at,
  disabled_at, disabled_reason. One row per token; re-registering the same
  token moves it to the current user.
- `owner_push_messages`: the app's equivalent of the Telegram chat history.
  id uuid pk, kind text, title, body, href, decision_id, work_item_id,
  grant_id, portal_channel_key, portal_message_id, owner_reply_id (for agent
  answers / acks), reply_to_id uuid → owner_push_messages (threading),
  thread_key text (APNs thread-id: one per record), category text,
  state text ('open','decided','info') + outcome text, created_at,
  delivered_at, push_outbox_id. Each `transmit` writes one row and sends it
  to the app channel; the row id is what a reply or action points at.
- `push_actions`: id = client actionId uuid pk, message_id, user_id, action,
  text, result jsonb, created_at (P13 idempotency).
- `owner_replies.channel` already exists (default 'telegram'); app replies use
  'app' with message_id null and a new `push_message_id uuid` column.
- push_outbox: add `channels text[]` if needed so a drained row knows where to go.
- Update `deploy/db-roles.manifest.json` + the SQL `node scripts/db-roles-sql.mjs <table>` prints
  (worker drains the outbox; MCP's `reply_to_owner` and `notifyOwnerCall` paths write
  owner_push_messages). New trigger functions: `SECURITY DEFINER SET search_path = public, pg_temp`.

### APNs provider `lib/providers/apns.ts`
- Node `http2` to `https://api.push.apple.com` (production) or
  `https://api.sandbox.push.apple.com` per device environment; `APNS_API_BASE`
  overrides both for tests.
- ES256 provider JWT from the .p8 (`APNS_KEY_PATH`, `APNS_KEY_ID`,
  `APNS_TEAM_ID`=B98Y8U657X, `APNS_TOPIC`=com.sjcarpentryllc.sjcos), cached ~50
  minutes. Never log the key or full tokens (last 6 chars only).
- Headers: apns-push-type alert, apns-topic, apns-priority 10 (5 for the
  silent cleanup push), apns-collapse-id where a later push replaces an earlier
  one (stale nudges per item).
- 410 / BadDeviceToken / Unregistered → `disabled_at` + reason. Other errors
  throw to the caller like the Telegram channel does.
- Fake mode under `SJC_OUTBOUND_DISABLED=1`: records the payload, sends nothing.

### Payload (contract the phone reads)
```jsonc
{
  "aps": {
    "alert": { "title": "Approve: email Larson the rough estimate", "body": "…" },
    "sound": "default",
    "badge": 3,                     // open approvals for the owner
    "thread-id": "decision:<uuid>", // groups an alert with its replies
    "category": "SJC_DECISION",     // see categories
    "interruption-level": "time-sensitive" // grants/decisions/drafts/portal only, if entitlement is present; else omit
  },
  "sjc": {
    "v": 1,
    "messageId": "<owner_push_messages.id>",
    "kind": "decision",            // OwnerPushKind or "reply" / "ack" / "test"
    "href": "/engine/decisions",   // web path; phone maps it with lib/mobile-rpc/destinations.ts rules
    "dest": { /* the same Destination object the phone already routes (see docs/mobile-api.md) */ },
    "approvalKey": "decision:<uuid>" | "work_item:<uuid>" | "grant:<uuid>" | null,
    "contentHash": "…" | null,
    "sends": true                  // draft/decision that emails/texts someone → "Approve & send"
  }
}
```
Plain text only; trim body to keep the payload under 4 KB (APNs limit), with
"…" and the full text available in-app.

### Categories (phone registers these; backend picks one per message)
| id | actions |
|---|---|
| `SJC_DECISION` | Approve (auth required) · Request changes (text input) · Hold 4h |
| `SJC_DRAFT_SEND` | Approve & send (auth required) · Change… (text input) · Decline (destructive, auth required) |
| `SJC_DRAFT` | Approve (auth required) · Change… (text input) · Decline (destructive, auth required) |
| `SJC_GRANT` | Approve (auth required) · Request changes (text input) · Decline (destructive) — only if the web's permission card has the same verbs; otherwise mirror whatever Telegram offers for a grant |
| `SJC_REPLY` | Reply (text input) — portal messages, agent questions/answers, acks |
| `SJC_INFO` | none (payment, contract signed, call, text, comms, agent failure, urgent) |

### Endpoints (Bearer, owner for actions; contract in `docs/mobile-api/push.md`)
- `POST /api/mobile/push/devices` `{ token, platform, environment, appVersion, build, deviceName }` → `{ ok, deviceId }`. Any active login.
- `DELETE /api/mobile/push/devices` `{ token }` (log out / switch off on this phone).
- `GET /api/mobile/push/settings` / RPC `push.saveSettings` `{ channels: { app: bool, telegram: bool } }` → owner only; stored in app_settings `owner_push.channels`. Also shows quiet hours and whether each channel is configured.
- `POST /api/mobile/push/test` → sends a "test" alert to this device now (ignores quiet hours, logs it).
- `GET /api/mobile/push/messages?before=&limit=` → the alert feed (owner_push_messages, newest first) with replies nested by `reply_to_id`, each with its live state (open / decided + outcome) and which actions are still allowed.
- `GET /api/mobile/push/messages/:id` → one alert + its thread.
- `POST /api/mobile/push/action` `{ actionId, messageId, action: "approve"|"decline"|"changes"|"hold"|"reply", text? }` → `{ ok, message, outcome, followUp? }`. Runs the shared resolver (§ below). Idempotent on actionId.
- `GET /api/mobile/push/open` → `{ badge, decidedMessageIds[] }` so the phone can clear delivered alerts that were decided elsewhere (web, Telegram, another device).

### Shared resolver `lib/owner-actions.ts`
Extract from `app/api/telegram/webhook/route.ts` + `lib/decisions/telegram.ts`
the "owner pressed X on alert Y" logic so both channels call it:
decision approve/changes/hold with content-hash check → `performApprovalEffects`;
work item approve/decline with the `approval_status='requested'` guard →
`approveWorkItemById` / `rejectWorkItemById` / `describeApproval`; grants the
way `permissions.approve` does; text replies → `recordOwnerReply` /
`recordPortalReply` then `deliverOwnerReply` / portal revalidation. The webhook
becomes a thin Telegram adapter over it; its tests must still pass unchanged.

When anything is decided (any channel, the web, MCP), mark the matching
owner_push_messages rows `decided` with the outcome, refresh the Telegram card
(as today), and send the app a low-priority background push
(`content-available: 1`, no alert) carrying `{ sjc: { v:1, kind:"cleanup", decidedMessageIds, badge } }`.

### Replies and agent answers (P8, P9, P11)
`sendOwnerTelegram` / `replyToOwner` / acks / sweep become channel-aware: each
writes an owner_push_messages row with `reply_to_id` = the alert Joe replied
to (or the thread root) and goes to every enabled channel. A reply sent from
Telegram is mirrored into the app thread and vice versa, so the history is one
conversation whichever side he used. Revised-draft re-pushes keep the
thread-id of the original alert.

### Tests (node --test, DB tests use the QA cluster tag `SJC_TEST_CLUSTER_TAG=push`)
APNs JWT + payload builder (size cap, categories per kind, sends flag);
channel routing by setting; gate shared across channels; device disable on 410;
action endpoint parity with the webhook for every verb (same DB end state as
the Telegram path for the same card); idempotent actionId; stale hash refused;
pulled draft refused; reply routing to conversation / agent / portal;
cleanup on decision from the web. Existing telegram tests unchanged and green.

## 3. Phone (Claude builder)

Read `docs/MOBILE-PLAN.md` + `docs/DESIGN-SYSTEM.md` in the phone repo; the bar
is 9/10 function and looks; use only the design-system primitives.

- **Native**: add `expo-application` (push environment via
  `getIosPushNotificationServiceEnvironmentAsync`). `app.json`: expo-notifications
  plugin config, `ios.infoPlist.UIBackgroundModes: ["remote-notification"]`
  (plus location's existing mode), entitlement `aps-environment` handled by the
  plugin/EAS. Build number 6. Read the installed expo-notifications docs in
  `node_modules/expo-notifications` for SDK 57 behaviour before coding: what
  runs when a text/action response arrives while the app is killed or in the
  background (background task via expo-task-manager vs foreground launch). An
  action that can't run in the background must open the app and finish there,
  never silently drop.
- **Registration** (`src/lib/push/*`): after login, if the owner has not
  chosen yet, Today shows a one-time card "Get alerts on this phone" (what
  you'll get, quiet hours) → system prompt → register token. Re-register on
  every app start (tokens change). Unregister on logout. Staff logins: no card.
- **Categories + responses**: register the six categories in §2 at startup;
  handle each action by POSTing `/api/mobile/push/action` with a fresh
  actionId; on success replace the delivered notification with nothing and
  show the server's message (toast if foreground, else a local notification
  with the result, threaded). On failure: a local notification with the reason
  and a tap-through to the alert.
- **Tap**: deep-link to the alert's destination (approval sheet for approvals,
  portal thread for portal messages, the job/lead/to-do/call/text otherwise)
  using the app's existing destination routing; cold start included
  (`getLastNotificationResponseAsync`).
- **Foreground**: show the banner unless the user is already on that alert's
  screen; refresh the feed and badge.
- **Cleanup**: on app foreground + on a `cleanup` background push, dismiss
  delivered notifications whose messageId is decided; set the badge from the server.
- **Alerts screen**: the existing Notifications screen gains the alert feed:
  each push-backed row shows its state (Waiting on you / Approved / Declined /
  Changes requested / Answered), inline buttons for what is still allowed, and
  opens a thread view (the alert, Joe's notes, agent answers, acks) with a
  reply composer on replyable alerts. Same look as the rest of the app.
- **Settings**: "Phone alerts" section: this phone on/off (permission state
  with a route to iOS Settings when denied), "Send alerts to: App / Telegram /
  Both" (owner), quiet hours shown in words, "Send a test alert".
- Contract types in `src/lib/api/push.ts` exactly as `docs/mobile-api/push.md`.

## 4. Rules for every builder and judge (paste into briefs)

- Never run `next dev`, `expo start`, a simulator or a browser. No servers.
- One niced typecheck at a time through `flock /tmp/sjcos-tsc.lock` (backend) or
  `flock /home/joe/qa-sjcos/mobile/tsc.lock` (phone). Single test files only.
- Never stop/restart/rebuild sjcos.service, sjcos-mcp, sjcos-worker, ordinem. Never touch the live `.next`.
- Exit 137 / "Killed" = memory cap: stop and report.
- Don't commit, push or stage; the coordinator does.
- Stay in your repo and file set; several agents may work at once.
- Plain words in every string Joe sees (no raw enums, no invented nouns).

## 5. What Joe has to do (only he can)

1. Apple Developer → Certificates, IDs & Profiles → Keys → "+" → tick
   **Apple Push Notifications service (APNs)** → download the .p8 once and
   note the Key ID. Hand it over through the secret prompt.
2. OK the deploy (backend first, then build 6 → TestFlight).
3. Install build 6 from TestFlight, allow alerts, press "Send a test alert".

## Backend implementation clarifications (2026-11-05)

- Migration 0004 already has `push_devices` (including `web`, `label`, and
  `revoked_at`). 0092 extends it, preserving those columns and web rows;
  new mobile registrations accept only iOS/Android. Tokens become globally unique.
- Grants already use a linked decision with Approve / Request changes / Hold.
  Native permission cards use those verbs, including Hold instead of Decline.
- The test endpoint takes `{ token }` to identify this device, never an arbitrary
  user id. Settings RPC retains the established `{ ok, result }` envelope.
- Cleanup is persisted by database triggers for every writer; the existing
  push-drain cron and foreground `open` reconciliation send cleanup after commit.
  This avoids making database triggers perform network calls. Background cleanup
  from an unrelated web write may wait until the next drain (up to five minutes).
- `owner_push_messages` also stores the rendered content hash, sends flag,
  Telegram message id, completed channels and a cleanup-pending flag. These retain
  stale-card protection, reply mapping and independent channel retries.
- Parked messages snapshot their enabled channels; pre-existing outbox rows with
  no snapshot use the current setting when drained.
- Time-sensitive interruption level is omitted until the Apple entitlement is
  confirmed. Alerts use the normal sound and category in the meantime.
- R1 replaces the session advisory lock with a nonblocking durable action claim.
  The decision/reply/portal mutation and its evidence commit together. A claim
  interrupted before mutation resumes; committed decision effects not yet started
  resume their saved resolution. An interrupted external effect returns a durable
  `needs_review` result with current domain/send evidence and never blindly resends.

## R1 backend implementation and validation

- Engineering F1–F10 and the parity/failure-test finding: session-bound device
  enrollment with column reads and one-purpose invalidation; authoritative card
  purpose/revision checks; bounded nonblocking action claims; separate throttle
  accounting; durable conversational delivery; correct Telegram follow-up mappings;
  actionable threaded revisions; live hold/expiry/reopen reconciliation; shared
  delivery leases; reusable APNs sessions and per-device retry receipts.
- Security 1/2/3/5(server)/6/9(server)/10 use those same fixes. Phone-only security
  findings remain with the phone builder. APNs titles are generic; Telegram text
  and full in-app titles retain their existing content.
- Seed bugs: holds show “On hold until … Central”, reopen when elapsed and re-alert
  once through the shared gate; resolution refreshes reuse the original root card.
  A replacement approval with buttons becomes a fresh threaded approval card.
- Tests declare adversarial expectations in `tests/phone-push-r1-expectations.md`.
  Focused DB tests use actual domain effects and the real webhook/phone endpoints;
  only framework and outbound provider boundaries are replaced. Coverage includes
  simultaneous channels, provider failure reopening, lost completion after actual
  provider acceptance, and saved-resolution recovery without a second approval.
- Validation uses only disposable tagged PostgreSQL and a newly restored isolated
  `sjcos_qa_push_r1_backend_1105` database on 5499. No live database, service,
  coordinator QA database, app server, browser or mobile repository is touched.
- Remaining operational checks: coordinator review/build, physical iOS hidden
  previews/unlock/APNs verification, then owner-authorized deployment. Uncertain
  external effects deliberately require review; they are never automatically replayed.

### R1 final validation (2026-11-05)

`tsc` exit 0 under the required flock/nice command. Each test file ran separately
with `SJC_TEST_CLUSTER_TAG=phone_r1_backend`; no skips or failures.

| File | Passed |
|---|---:|
| `tests/apns.test.mjs` | 4 |
| `tests/apns-transport.test.mjs` | 9 |
| `tests/db-roles-manifest-db.test.mjs` | 6 |
| `tests/db-roles-paths-db.test.mjs` | 2 |
| `tests/telegram-events-done-db.test.mjs` | 1 |
| `tests/telegram-replies-db.test.mjs` | 1 |
| `tests/telegram-draft-replies-db.test.mjs` | 1 |
| `tests/portal-telegram-db.test.mjs` | 3 |
| `tests/notifications-v2-db.test.mjs` | 1 |
| `tests/inbox-notification.test.mjs` | 2 |
| `tests/portal-checkout.test.mjs` | 7 |
| `tests/portal-financials.test.mjs` | 2 |
| `tests/portal-pay-link.test.mjs` | 4 |
| `tests/portal-payment-breakdown.test.mjs` | 4 |
| `tests/portal-presentation.test.mjs` | 11 |
| `tests/portal-preview.test.mjs` | 2 |
| `tests/portal-selection-counts.test.mjs` | 2 |
| `tests/portal-selection-groups.test.mjs` | 1 |
| `tests/portal-selection-price.test.mjs` | 4 |
| `tests/portal-signature-review.test.mjs` | 4 |
| `tests/phone-push-db.test.mjs` | 19 |
| `tests/phone-push-parity-db.test.mjs` | 16 |
| `tests/phone-push-delivery-db.test.mjs` | 12 |
| `tests/phone-push-sweep-db.test.mjs` | 3 |

Total: 121 passed. Role scan exit 0; only the manifest's documented withheld
paths remain. Seed: 26 scenario states, zero errors/limitations, zero staff-device
deliveries, Unicode APNs payload 4,058 bytes. Its isolated database is
`sjcos_qa_push_r1_backend_1105` on 5499. The disposable test cluster was stopped.

## Round 2 backend fixes (2026-11-05)

Coordinator rulings R-a/R-b apply: APNs uses the real title and plain app body;
Telegram retains its existing text. App text is saved separately in parked payloads.
Messages expose author and agent display name; send approvals add SJC_DECISION_SEND
and SJC_GRANT_SEND. See Changes in R2 in the mobile contract for exact additions.

Work-item cards bind an approval-cycle UUID and source-content fingerprint before
parking. Reconciliation and mutations compare that binding rather than delivery
order. Phone action claims use a generation, nonblocking reclamation and a row lock
inside the mutation transaction; completion/effect checkpoints are conditional.
Folded rows delegate transactionally to durable summary jobs grouped by saved
channels, with the same leases, recipient receipts and cap accounting as direct
alerts. Legacy Telegram acknowledgments fall back only before durable transport
starts. Device fanout checks the registering credential's expiry as well as
revocation; expired cleanup requests keep a distinguishable retryable response.

Design finding 14 remains out of scope. No mobile code, native verification or
production deployment is part of this backend change.

R2 backend validation (single files, `SJC_TEST_CLUSTER_TAG=pushr2backend_1105`):

| Test file | Passed |
| --- | ---: |
| apns.test.mjs | 4 |
| apns-transport.test.mjs | 9 |
| decision-summary.test.mjs | 4 |
| phone-push-db.test.mjs | 19 |
| phone-push-r2-db.test.mjs | 26 |
| phone-push-parity-db.test.mjs | 16 |
| phone-push-delivery-db.test.mjs | 12 |
| phone-push-sweep-db.test.mjs | 3 |
| db-roles-manifest-db.test.mjs | 6 |
| db-roles-paths-db.test.mjs | 2 |
| telegram-events-done-db.test.mjs | 1 |
| telegram-replies-db.test.mjs | 1 |
| telegram-draft-replies-db.test.mjs | 1 |
| portal-telegram-db.test.mjs | 3 |
| notifications-v2-db.test.mjs | 1 |

108 passed, no skips. The 26 fresh adversarial cases follow expectations recorded
before implementation in `tests/phone-push-r2-expectations.md`. The exact judge's
blocked portal INSERT/timestamp-advance/duplicate UUID reproduction commits once:
the timestamp UPDATE now waits on the action-row fence. Additional cases start
with an already-expired lease to exercise SKIP LOCKED reclamation for both portal
posts and owner notes. Stale-generation and first-result stability are checked.
The real staged-email test parks the $100 card, pulls/revises/resubmits $900,
drains the old card, refuses it, and sends the current card once through fake email.

The required flock/nice typecheck and `node scripts/db-roles-scan.mjs --diff`
exit 0. Migration 0092 and the seed script were proved on a new
`sjcos_qa_push_r2_backend` restored from `/home/joe/qa-sjcos/sjcqa/live.dump`,
with explicit DATABASE_URL throughout: 26 fixture states, 28 deliveries to the
new owner device, none to staff, Unicode payload bounded at 4,086 bytes. All
providers were fake; no live DB, coordinator DB, service, browser or app server
was used. The tagged test cluster is stopped after validation; the task's QA
clone remains available for coordinator inspection.
