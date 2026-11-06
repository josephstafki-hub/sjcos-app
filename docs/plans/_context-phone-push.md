# Context: phone alerts (Telegram → SJC OS app)

## Joe's request, verbatim (2026-11-05)
> can you migrate all the notifications and functionality of SJC OS telegram channel into the mobile apps? use the pnale of judges ive set up the past couple days. ask those session what im talking about if its not in memory

Later the same day Joe supplied the APNs key ID and key file through the secret prompt; both live on the server only, never in the repo.

## Decisions (coordinator calls, Joe may overturn)
- Telegram stays on beside the app; owner setting App / Telegram / Both, default Both.
- Owner only (same line as notify-owner.ts). Staff devices may register but never get owner alerts.
- Direct APNs (HTTP/2 + ES256), no Expo push service.
- Same quiet hours / cap / park / drain as Telegram, one shared gate.
- One shared resolver (lib/owner-actions.ts) for Telegram and phone actions.
- Lock-screen actions open the app (SDK 57 iOS can't finish a network call for a background action reliably); Approve / Decline / Hold need Face ID; answers go through a persistent outbox with one actionId per answer.

## Bar
Revised until every judge gives 10/10 in the same round (design + completeness), against the Telegram parity checklist P1–P15 in docs/plans/phone-push.md.

## Where things are
- Plan/spec: docs/plans/phone-push.md. Contract: docs/mobile-api/push.md.
- Backend worktree /home/joe/.t3/worktrees/sjcos-app/t3-ed43be56, branch t3/phone-push. Migration 0092_phone_push.
- Phone worktree /home/joe/.t3/worktrees/sjcos-mobile-push, branch phone-push. Build number 6.
- Telegram code reused: lib/notify-owner.ts, lib/providers/telegram.ts, lib/decisions/*, lib/owner-reply-delivery.ts, app/api/telegram/webhook/route.ts.
- Reviews: docs/plans/reviews/build-phone-push-rN-<lens>.md (round 1 eng report also at /home/joe/qa-sjcos/mobile/judge/push-eng-r1.md).
