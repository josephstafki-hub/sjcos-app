# SMS two-way inbox — provider seam (scaffolded, inert)

Status: **backend seam built, not live.** Two-way business SMS needs a paid
provider + A2P 10DLC registration, so nothing sends until that's set up. The
seam mirrors `lib/ai.ts` / `lib/gmail.ts`: a provider is isolated behind a small
interface and everything degrades gracefully when unconfigured.

## What exists
- **DB:** `sms_threads` (one per counterparty number) + `sms_messages` (in/out,
  deduped on provider message id). In `db/schema.sql` (additive).
- **`lib/sms.ts`** — `smsConfigured()` gate; reads (`getSmsThreads`,
  `getSmsThread`, `getUnreadSmsCount`); writes (`recordInboundSms`,
  `sendSmsOnThread`); `sendViaProvider()` (Twilio REST wired; telnyx/signalwire
  stubbed). Refuses to send when unconfigured — no fake sends.
- **`lib/actions/sms.ts`** — owner-gated `sendSmsReply`, `markSmsThreadRead`.
- **`app/api/sms/webhook/route.ts`** — inbound webhook. Returns **503** until
  configured; **401** without the `?secret=` matching `SMS_WEBHOOK_SECRET`.

## What's NOT built yet (next, once a provider is picked)
- The `/messages` inbox UI (thread list + conversation + composer), mirroring
  the Gmail inbox. `revalidatePath("/messages")` calls already point at it.
- Nav entry + unread badge (`getUnreadSmsCount()` is ready).
- Thread↔record linking (leads/subs/clients/projects) — columns exist on
  `sms_threads`; auto-classify like the Gmail inbox later.
- telnyx / signalwire send implementations (slot into `sendViaProvider`).

## To activate
1. Pick a provider (Twilio / Telnyx / SignalWire) and buy a number (~$1–2/mo).
2. Register **A2P 10DLC** brand + campaign (required for US business SMS; ~1–3
   weeks, small fees). Google Voice is exempt only as *personal* — no API.
3. Set env (`.env.local`, gitignored):
   ```
   SMS_PROVIDER=twilio
   SMS_ACCOUNT_SID=...
   SMS_AUTH_TOKEN=...
   SMS_FROM_NUMBER=+16125551234
   SMS_WEBHOOK_SECRET=<random>
   ```
4. Point the provider's inbound-message webhook at
   `https://os.sjcarpentryllc.com/api/sms/webhook?secret=<SMS_WEBHOOK_SECRET>`.
5. Build the `/messages` UI and rebuild the prod service.
