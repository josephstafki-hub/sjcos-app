SCORES: design=10 completeness=10

# Phone alerts: build round 8, DESIGN judge

I judged from the diff (`git diff 96ec1fc4 025818cf`; HEAD 9eb7eb30 adds only the R7 review files) and the code around it. The phone app is unchanged (5b1b883). I ran nothing and built nothing.

## What I checked

### My R7 required item

| R7 item | Now | Verdict |
|---|---|---|
| Fix 1. Ops card for staff without Today had an empty action column | `components/engine/RecordOps.tsx:222` now renders `<span className="text-meta text-ink-3">Waiting on approval.</span>`. That is the exact change I asked for. It uses neutral wording, not "Waiting on Joe", which is right because a teammate with Today can also approve. It adds no control. `canApprove={can(viewer, "today")}` is unchanged on both record pages (`leads/[slug]/page.tsx:395`, `projects/[slug]/page.tsx:840`). The new UI test (`tests/phone-push-r6-ui.test.mjs:80-95`) checks the real card JSX for both lead and project. Without Today the card has 0 buttons and exactly one note. With Today it has 2 buttons and no note. | Resolved |

### Moving shared draft cards to Today access, view by view

The gate is in two places. `listPendingApprovals` lists draft cards only when the viewer has `today` (`lib/approvals.ts:108`). `approveWaiting` / `declineWaiting` now call `requireAccess("today")` and then the session-free `approveWorkItemById` / `rejectWorkItemById` (`lib/actions/approvals.ts:97-98,115-116`). What a viewer is shown and what the server accepts are the same rule.

| Staff view | Today only | Engine only | Neither |
|---|---|---|---|
| **Today page** (`requireAccess("today")`) | No approve buttons live on Today itself (`components/today/*` has none). Nothing to fail. | Can't open | Can't open |
| **Popup** (`NotificationCenter`) | Draft cards are listed, and Approve/Decline go through `approveWaiting`/`declineWaiting`, which now pass. They can only succeed or give a real content refusal (stale, changed or handled). | Draft cards are no longer listed, so none can fail. Engine › Queue still shows the same drafts with working buttons. | None are listed |
| **Notifications page** (`requireAccess("today")`) | Same cards and actions as the popup. "N waiting on you" counts only cards this viewer can answer. | Can't open | Can't open |
| **Engine › Queue** | Can't open | Approve/Reject still go through `requireAccess("engine")` (`lib/actions/engine.ts:265,272`) and pass | Can't open |
| **Record Ops** (lead/project) | Buttons, `requireAccess("today")` passes | "Waiting on approval.", no controls | "Waiting on approval.", no controls |
| **Decisions** | Unchanged: `authorityFor` on both the list and `resolve()` | same | same |

- **No dead card and no button that can only fail.** Every surface that shows Approve/Decline uses the same area check as the server action behind it. That is Today for the popup, Notifications and Ops, and Engine for Engine. The R5 DB test (`phone-push-r5-db.test.mjs:190`) now checks the rule both ways: `Engine*` paths need `engine` and every other path needs `today`.
- **"Waiting on you" wording stays true.** The popup header, badge aria-label, collapsed pill and Notifications meta all count `listPendingApprovals` for this viewer. After the move, that list holds only drafts the viewer can act on (Today) and decisions they hold authority for. An Engine-only teammate's popup count drops the drafts. That is honest, because they can't answer drafts there. They answer them in Engine.
- **Decline is more honest than before.** The popup and Notifications used to call `rejectWorkItem`, which always returned `{ ok: true }` even when the item was already handled. So a stale Decline toasted "Declined — nothing was sent." even though nothing was declined. `rejectWorkItemById` now returns the `staleDeclineError` text, and the "Decline failed" toast shows it (`NotificationCenter.tsx:164`, `NotificationsClient.tsx:90`).
- **The atomic Telegram owner check has no new screens.** It reuses the same refusal, "No active owner account. Nothing was changed." (`INACTIVE_OWNER`, `lib/commands/owner-authorization.ts:4`). The bound phone-card path now passes `code:'unauthorized'` through as the outcome instead of "stale". That doesn't change the visible text, and the label is now accurate.

### Owner layouts: unchanged

`hasArea` returns true for the owner on every area (`lib/commands/principal.ts:59`), so Joe's popup and Notifications list is the same as before. `can(owner, "today")` is true, so his Ops cards still show two buttons. The Engine markup is untouched. The mobile RPC `approvals.*` is still `ownerOnly` (`lib/mobile-rpc/today.ts:64-65`), and its reads pass no principal, so the list is unfiltered as before.

### Earlier copy fixes still in place

- `WEB_CHANGED_DRAFT` is unchanged (`lib/approved-draft-snapshot.ts:5`).
- "Approve failed" / "Decline failed" are present in `EngineClient.tsx`, `RecordOps.tsx`, `NotificationsClient.tsx:90` and `NotificationCenter.tsx:164`.
- "Only Joe can approve sends." no longer appears anywhere in `lib/`, `app/` or `components/`.
- Ops long-body rendering from R6 (`whitespace-pre-wrap break-words`, no clamp when `fullBody`) is unchanged (`RecordOps.tsx:209`).

## REQUIRED fixes

None.

## Optional (not blocking)

- O1. The popup/Notifications draft card's "Open" goes to `/leads/<slug>` or `/projects/<slug>` (`lib/work-item-draft.ts:65`). A Today-only teammate without Leads or Projects can be bounced from that page. This is the same kind of issue as R7 O4. Under the old Engine gate it affected Engine-only teammates, so it isn't new. Consider falling back to `/today` when the viewer can't open the record. Approve and Decline on the card itself work either way.
- O2. Engine › Queue Reject still ignores the result of `rejectWorkItemById` and always returns `{ ok: true }` (`lib/actions/engine.ts:272-275`). A stale Reject there finishes silently, unlike the popup, which now reports it. Return the claim error the same way `declineWaiting` now does.
- O3. Telegram text-message refusal (`lib/decisions/telegram.ts:279`) says "No active owner account — nothing was changed." (dash, lower-case). The other refusals use `INACTIVE_OWNER` ("…account. Nothing was changed."). Use the constant everywhere so the copy matches.
- O4. Carried over: R7 O1 (cap long Ops approval text at `max-h-64 overflow-y-auto`), O2 (`text-ink-2` for full approval text), O3 (Decisions intro mentions Telegram buttons to staff), O4 (popup links for staff who hold decision authority without Today/Engine), O5 (R6 O1/O2). R5's O1/O2 and R4's nine items also stay optional.

## Rulings honoured

No Face ID inside the app was required. Staff with the area may approve on the web, per Joe. "Notify me" is out of scope. Earlier optional items were not raised to required.
