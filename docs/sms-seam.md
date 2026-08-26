# SMS two-way inbox — provider seam (scaffolded, inert)

Status (2026-08-25): **backend + `/messages` UI built; still not live.** Two-way business SMS needs a paid
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

## Built since (2026-08-25 review)
- **`/messages` UI** — `app/(os)/messages/page.tsx` + `components/messages/
  MessagesClient.tsx`: thread list, conversation, composer, mirroring the Gmail
  inbox. It renders a "not configured" state instead of a composer when
  `smsConfigured()` is false, so nothing can fake a send.
- **Nav entry + unread badge** — the Messages rail item, badged from
  `getUnreadSmsCount()`.
- **Thread↔record linking** — `getSmsLinkOptions()` backs an owner picker that
  ties a thread to a lead / sub / client / project (`link_type` + `link_slug`).
  Auto-classification (the Gmail-style AI pass) is still manual-only.

## Still NOT built (needs the provider decision)
- telnyx / signalwire send implementations (slot into `sendViaProvider`; Twilio
  REST is already wired).
- Automatic thread↔record classification.
- **Nothing sends.** `sendSmsOnThread` refuses while `smsConfigured()` is false;
  the webhook returns 503. That is the whole gate — see "To activate".

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
5. Rebuild + restart the prod service. The `/messages` UI is already built —
   it goes live the moment `smsConfigured()` flips true.
