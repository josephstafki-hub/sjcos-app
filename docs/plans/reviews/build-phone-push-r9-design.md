SCORES: design=10 completeness=10

# Phone alerts: build round 9, DESIGN judge

I judged from the diff (`git diff 9eb7eb30 5b5776cc`). HEAD 7ac0a588 adds only the three R8 review files. The phone app is unchanged (5b1b883). I ran nothing and built nothing.

## What changed

Commit 5b5776cc touches only the server: `lib/owner-actions.ts`, `lib/decisions/portal-replies.ts`, `lib/decisions/telegram.ts`, and two test/expectation files. No component, page, mobile screen, push payload or notification copy changed.

## New refusals a person can see

| Where | When | Text shown | Verdict |
|---|---|---|---|
| Phone: any verb (Approve, Decline, Changes, Hold, Reply) on a decision, grant, draft, reply-only child alert or portal thread | The owner was deactivated or demoted while the action waited on the card's lock | `INACTIVE_OWNER`, "No active owner account. Nothing was changed." (`lib/owner-actions.ts:115`, outcome `unauthorized`) | Plain words. It tells Joe the truth: nothing happened, so there is nothing to undo. This is the exact string and outcome the work-item path already returned in R7/R8, so the phone shows it the same way it already did. It now reaches more verbs and targets. The new test (`tests/phone-push-r8-db.test.mjs:8`) pins the text, and checks that a retry with the same answer id replays it. |
| Telegram: text reply into a portal thread | The owner was deactivated or demoted after the principal lookup | The bot replies under his message with `INACTIVE_OWNER` (`lib/decisions/telegram.ts:285`) | Same constant as the Telegram button refusal (`telegram.ts:192`) and the phone. It's consistent. |

"What to do" is implicit here: the only fix is restoring the owner account, which Joe does himself. That is the same bar as the R7/R8 refusals, which I accepted. No new wording is needed.

The work-item claim path no longer passes through `code:'unauthorized'`. `owner-actions.ts:199` now always labels a claim error `stale`. That isn't a regression: the inactive-owner case moved earlier, into `locked()`, and is caught at the top with outcome `unauthorized` (`owner-actions.ts:115`). The only errors left on line 199 are real stale-claim errors. The text the phone shows is unchanged.

## Nothing else changed for Joe or staff

- No layout, copy or flow outside the refusals above. Lock order, the advisory lock on the portal channel and the reply-only child lock are invisible when the owner is active. The test checks that a fresh answer still succeeds once, with the same visible results (approved, declined, held, reply posted).
- The web portal reply path doesn't call `recordPortalReply` (only Telegram and the phone do), so no web screen can show the new throw.
- The R8 copy and screens I verified (Ops "Waiting on approval.", Today-gated draft cards, Approve/Decline failure toasts) are untouched.

## REQUIRED fixes

None.

## Optional (not blocking)

- O1. Carried from R8 O3, and now more visible: `lib/decisions/telegram.ts:279` still says "No active owner account — nothing was changed." Six lines below, `telegram.ts:285` sends `INACTIVE_OWNER` ("No active owner account. Nothing was changed.") for the same situation in the same handler. Replace the literal on line 279 with `INACTIVE_OWNER`.
- O2. All other R8 optional items (O1, O2, O4 and the items carried into them) stay optional and unchanged.

## Rulings honoured

No earlier optional item was made required. No Face ID inside the app. Staff approval on the web follows Joe's ruling. "Notify me" stays out of scope.
