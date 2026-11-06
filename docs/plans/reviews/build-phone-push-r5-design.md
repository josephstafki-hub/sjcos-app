SCORES: design=9 completeness=10

# Phone alerts — build round 5, DESIGN judge

Backend `sjcos-app`: the R4 security fix is `git diff 50cb82b1 717686a6` (18 files, judged from the diff and the code around it). Phone `sjcos-mobile`: `phone-push` @ 5b1b883 has 0 commits after the R4 build and a clean worktree (`~/.t3/worktrees/sjcos-mobile-push`), so **the phone app has not changed**. No new screenshots this round, as briefed.

## What I checked

| Surface | What Joe sees now | Where | Verdict |
|---|---|---|---|
| Engine work-item card (`EngineClient.tsx:730-733`) | New grey draft box (To / Subject / body / note) above Approve. A stale Approve shows `WEB_CHANGED_DRAFT` in a runAction toast titled **"Something went wrong"**, then `router.refresh()` re-renders the card with the new draft. | toast | Box is a real improvement (he sees what he approves). The refusal copy and title need work (Fix 1). The box repeats the body on approvals with no draft (Fix 2). |
| Lead/project Ops card (`RecordOps.tsx:190,206`) | Same box, same toast ("Something went wrong"), same `router.refresh()`. | toast | Same as above. |
| Corner popup / Notifications page (`NotificationCenter.tsx:158-165`, `NotificationsClient.tsx:84-91`) | Toast titled "Approve failed" with the same message. `tick()` re-polls the list. | toast | Title is fine. Copy issue is the same (Fix 1). |
| **iPhone/iPad Today Approve** (`sjcos-mobile src/app/(tabs)/index.tsx:342-343`, via `approvals.approve` → `approveWaiting` → `claimApproval`) | The phone app code is unchanged, but `claimApproval` now maps `CHANGED_DRAFT` to the web text, so the phone shows toast "Not sent", detail **"This draft changed since you opened it — reload to see the new version"**, and then calls `approvals.refresh()` itself. | native toast, 2-line detail | The comment at `approve-work-item.ts:84` ("phone/Telegram retain card copy") is true for push cards but not for the phone's Today card. "Reload" isn't a word for a native app, and the list has already refreshed (Fix 1). |
| Phone push cards / bound Telegram cards (`owner-actions.ts:119,130`) | Unchanged: "This draft has changed. Open the current card." | — | Fine, as in R4. |
| Legacy Telegram draft card Approve (`owner-actions.ts:219`) | Callback popup plus the card edited to `[SJC OS] This old card cannot approve a draft. Open Today to review the draft and approve it there. Nothing was sent.` followed by a tappable `…/today` link (`owner-actions.ts:48-50`). 113 chars, so it fits Telegram's 200-char callback limit. | Telegram popup + edited card | Reads well on a phone. It says why, what to do, gives a link to do it, and says nothing went out. Decline is unchanged. "cannot" → "can't" is optional (O1). |

Wording rules: no ids or enums appear in any new string. The Telegram reply is fully plain. The web string fails "tells him what to do next" in two of its three places, and on the phone (below).

## REQUIRED fixes

1. **Stale-draft refusal on web and the phone's Today card: right instruction, say nothing went out, don't call it a crash.**
   - `lib/approved-draft-snapshot.ts:5`: every surface that shows this string has already refreshed by the time Joe reads it (Engine/Ops `router.refresh()`, popup `tick()`, phone `approvals.refresh()`). So "reload to see the new version" tells him to do something already done, and on the iPhone there is nothing to "reload". It is also the only approval refusal without **"Nothing was sent."** (compare `CHANGED_DRAFT` on `:4` and the Telegram line). For a send button, that is the line he needs most. It also has no closing period. Exact copy:
     `export const WEB_CHANGED_DRAFT = "This draft changed since you opened it. Nothing was sent. Read the new version and approve again.";`
     (≈95 chars, so it fits the phone toast's 2-line detail at `toast.tsx:73`. A page opened before this deploy still recovers: the refreshed card carries a binding.)
   - `components/engine/EngineClient.tsx:733` and `components/engine/RecordOps.tsx:190`: pass a title to `runAction` so this deliberate safety stop isn't labelled "Something went wrong" (the `DEFAULT_TITLE.error` at `Toast.tsx:52`). Match the popup: `runAction(() => …, { title: "Approve failed", onSuccess: … })`.

2. **The draft box repeats the body on approval cards that have no staged draft.** `phone_push_draft_source` returns a row for every work item. So `item.draft` is set for every approval-bucket card. With no draft content, `draftPreview` falls back to `body = r.body.slice(0, 600)` (`lib/work-item-draft.ts:61`). The Engine card then prints the same text twice: the `<p>` at `EngineClient.tsx:729`, then the grey box at `:730`. On Ops it shows twice too: the line-clamped body at `RecordOps.tsx:205`, then the box at `:206`. Render the box only when it adds something. In both files:
   `{item.bucket === "approval" && item.draft && (item.draft.to || item.draft.subject || !item.body.startsWith(item.draft.body ?? "")) && <WorkItemDraft draft={item.draft} />}`
   Keep passing `item.draft?.binding` to Approve whether or not the box shows. The binding still protects the item.

## Optional (not blocking)

O1. `owner-actions.ts:219`: "This old card cannot approve a draft" → "This older card can't approve drafts." This uses the contraction the rest of the alert copy uses.
O2. `WorkItemDraft.tsx`: a small "Draft" eyebrow (`text-meta uppercase text-ink-3`) at the top of the box, so it reads as the thing being approved and not as more notes.
O3. Fix the `approve-work-item.ts:84` comment so it says the phone's Today card also gets the web string (as intended after Fix 1).
O4–O12. The nine optional items from R4 stay optional (settings caption, permission body order, thread duplicate note, meridiem case, nudge spacing, title press feedback, portal title, Notifications row copy, Hold auth).

## Rulings honoured

No Face ID inside the app was required. "Notify me" is out of scope. The R4 optional items were not raised to required.
