SCORES: design=10 completeness=10

# Phone alerts — build round 10, DESIGN judge

Scope: `git diff 7ac0a588 687bb315` (HEAD c405469c only adds the R9 review files). Phone app unchanged (5b1b883). Only what Joe could see is judged.

## What I checked

Code outside docs/tests that changed: `app/api/telegram/webhook/route.ts`, `lib/decisions/telegram.ts`, `lib/owner-actions.ts`. Nothing else Joe sees changed: no screens, no app copy, no phone code.

Every Telegram toast and card edit in `handleTelegramUpdate` is now saved as a reply (`answer(...)` / `edit(...)` push onto `replies`). `finishOwnerAction` sends them in order after the commit. I compared each string with the 7ac0a588 version:

| Situation | Toast / card text | Same? |
|---|---|---|
| Replayed update | `Already handled: <outcome>` / `Already handled.` | yes |
| Wrong chat / bot sender | `Not allowed.` | yes |
| Forwarded card | `Forwarded cards cannot be used. Open the original.` | yes |
| Unknown button | `This button is not recognised.` | yes |
| No owner (before the lock) | `INACTIVE_OWNER` = "No active owner account. Nothing was changed." | same characters as the old literal |
| Owner inactive after the lock | `INACTIVE_OWNER` | yes |
| Decision gone | `That decision no longer exists.` | yes |
| Stale card | `This card is out of date — the package changed. Open the current card in SJC OS.` | yes |
| Changes, not pending | `Already <status>.` | yes |
| Changes | `Reply with what should change.`, then the `askWhatShouldChange` prompt | yes, same order (toast first, then prompt) |
| Hold | `Held for 4 hours.` / `Cannot hold — already <status>.`; card edit `cardText(...)+"\n(held 4h)"` only when held and the card message exists | yes |
| Approve (first) | Still deferred through `pendingAnswer`: toast `Approved ✓ … + effect lines`, card + effect lines | yes. The route always passed `deferApproveAnswer: true`, so making it the only path changes nothing |
| Other resolve results (reject, already approved, etc.) | `r.reply` toast + `cardText(shown)` edit | yes |
| Work-item / owner-reply / portal paths | untouched post-commit code | yes |

- Edits still go out only when the tap has a card message (`cq?.message`), as before (`deps.edit && cq.message`).
- Toasts are still cut to 190 characters in the route's `answer`.
- Order didn't change: reply toasts and edits go out before the approval, work-item, changes and owner-reply steps. So no situation now gets a second toast or loses one.
- Better than before: if the transaction fails, Joe no longer gets a toast for an action that was rolled back (R9 expectation 10). A slow Telegram call can no longer hold the Profile or target locks, so the Profile screen won't hang on a save.

Wording cleanup (R9 O1): `handleOwnerMessage` now replies with `INACTIVE_OWNER` instead of "No active owner account — nothing was changed." Joe now sees one wording for this case on both the button and text-reply paths. Done.

## REQUIRED fixes

None.

## Optional (not blocking)

- O1. Every optional item from R8 and R9 (other than R9 O1, which is now done) stays optional and unchanged.

## Rulings honoured

No earlier optional item was made required. No Face ID inside the app. Staff approval on the web follows Joe's ruling. "Notify me" stays out of scope.
