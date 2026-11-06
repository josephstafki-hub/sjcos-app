SCORES: design=10 completeness=10

# Phone alerts — build round 11, DESIGN judge

Scope: `git diff c405469c 9d59df11` (HEAD b1043d6e adds only the R10 review files). The phone app has not changed (5b1b883). I judged only what Joe or staff could see.

## What I checked

Changed code outside docs and tests: `app/api/cron/dispatch/route.ts`, `db/migrations/0092_phone_push.sql`, `deploy/db-roles.manifest.json`, `lib/approve-work-item.ts`, `lib/approved-draft-send.ts`, `lib/approved-draft-snapshot.ts`, `lib/decisions/telegram.ts`, `lib/dispatch/db.ts`, `lib/owner-actions.ts`. There are no screen, component or phone changes.

New or changed text Joe can see:

| Where | Text | Verdict |
|---|---|---|
| Approve retapped while a send is in flight or was interrupted (web/Telegram reply, `lib/approve-work-item.ts:37`) | "Your answer was recorded, but completion needs a check. Open the record before taking another action." | Uses the phone's existing needs-review sentence word for word (`app/api/mobile/push/[...path]/route.ts:66`). Plain words, says what to do next, no ids or enums. |
| Work item after a recovered send can't be confirmed (`blocked_reason`, `lib/approve-work-item.ts:61,66`), shown in the flag/warn line on Engine (`components/engine/RecordOps.tsx:213`, `EngineClient.tsx:731`) | Same sentence + " Do not resend." | Good. It stays on the card and tells Joe not to send it a second time, which is the risk here. It reads the same as the phone copy. |
| Portal post receipt (`0092_phone_push.sql`, helper) | "Approved reply posted in the client portal" | Plain words. It no longer says "for <client>", but the receipt sits on that client's work item, so nothing is lost. |
| Missing or deleted decision tapped in Telegram | "That decision no longer exists." (unchanged, `lib/decisions/telegram.ts:219`) | It now actually reaches Joe after commit. The wording is the same as before. |
| Telegram approve on a draft card | Refusals use the existing `claimApprovalInTransaction` errors (`staleApprovalError`, `CHANGED_DRAFT`, `INACTIVE_OWNER`). The success toast and card edit are still `describeApproval(r).message` / `[SJC OS] <reply>` | Same text as before. |
| Dispatch cron JSON gains `approved_drafts` | Machine output | Not shown to Joe. |

The portal post body, author name and initials, the activity log and the "done" state are the same as before. Only the code path that writes them moved into the database helper.

## REQUIRED fixes

None.

## Optional (not blocking)

- O1. If Telegram redelivers an approve tap, Joe sees `Already handled: work item approve: dispatch pending` (`lib/decisions/telegram.ts:140` + `:205`). This reuses the internal outcome string, and the same pattern already showed "…: dispatched" before this round. Something like "Already handled: approved." would read better. It's optional because it's an existing pattern and redelivery is rare.
- O2. All optional items from R8–R10 stay optional and unchanged.

## Rulings honoured

No earlier optional item was made required. No Face ID inside the app. Staff approval on the web follows Joe's ruling. "Notify me" stays out of scope.
