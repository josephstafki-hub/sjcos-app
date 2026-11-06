SCORES: design=8 completeness=9

# Phone alerts: build round 6, DESIGN judge

I judged from the diff (`git diff 5e97c12e 6c82d5aa`, HEAD 823a273c) and the code around it. The phone app has not changed (5b1b883). I ran nothing and built nothing.

## What I checked

### My two R5 items: both fixed

| R5 item | Now | Verdict |
|---|---|---|
| 1a. Stale-draft copy | `lib/approved-draft-snapshot.ts:5` = "This draft changed since you opened it. Nothing was sent. Read the new version and approve again." This is the exact copy I asked for. The comment at `approve-work-item.ts:84` was corrected too (my O3). | Fixed |
| 1b. Toast title | `EngineClient.tsx:733` and `RecordOps.tsx:190` both pass `title: "Approve failed"`. This matches the popup and the Notifications page. | Fixed |
| 2. Draft box only when it adds something | Both cards use the guard as written (`EngineClient.tsx:730`, `RecordOps.tsx:206`). The binding still goes to Approve when the box is hidden. `body` is typed `string` in `lib/engine.ts:18` and `lib/record-ops.ts:19`, so `.startsWith` can't throw. | Fixed. Small edge case below (O2). |

### Owner layouts: unchanged

- Engine: `canAssign = user.role === "owner"` (`engine/page.tsx:67`). The owner's branch renders the same Approve/Reject markup as before. The only change is the toast title.
- Record Ops: `canApprove={viewer?.role === "owner"}`. On both pages `viewer` comes from `getCurrentUser()` (`leads/[slug]/page.tsx:62`, `projects/[slug]/page.tsx:102`), so Joe always gets `true` and the same two buttons.
- Popup, Notifications page and Decisions page (owner): no markup change.

### What a staff login now sees

| Surface | What staff see | Verdict |
|---|---|---|
| Corner popup (`NotificationCenter`) | `pollNotificationCenter` gives staff `approvals: []` (`approvals.ts:47`), and the component returns `null` when that list is empty. No "Decisions" pill, no gap. | Clean |
| Notifications page | Staff get `approvals = []` (`notifications/page.tsx:13`), so they see no approval cards, only their own rows. The header still reads "N unread · 0 waiting on you". This was already true before this commit (O3). | Clean |
| Today | Today has no Approve/Decline controls (none in `components/today/*`). | Unchanged, clean |
| Engine › Queue, "Needs approval" bucket | Expanding the card shows the body, the draft box, and an action row with only "Open job ↗"/"Open lead ↗". On an item with no record the row is an empty `mt-3` strip above "Close details". Nothing says the card is waiting on Joe, so it looks like an approval card with its buttons missing. | **Fix 1** |
| Lead/Project › Ops | The card still has the red "flag" frame and a "needs approval" chip. The action column is now empty. That makes it a call-to-action card with no action and no word on whose move it is: a dead card. | **Fix 1** |
| Engine › Decisions (`/engine/decisions`) | A staff login holding an `authority_grant` for that kind of decision still gets the card with **enabled** Approve, Request changes, Hold and Reject. `view(d, auth.ok, …)` at `page.tsx:73` sets `canResolve` from the grant, not from the owner rule. Every click now comes back with "Only Joe can approve sends." (`decisions/actions.ts:52`). That message is also wrong for Reject or Request changes. The header says "N waiting on you" to someone who can't answer any of them. This is the one surface where staff can still reach a refusing control, which contradicts "staff no longer see Approve/Decline controls". | **Fix 2** |

The refusal text "Only Joe can approve sends." is plain words, and it only shows up when someone reaches a control they shouldn't have. Fixes 1 and 2 make that rare.

## REQUIRED fixes

1. **Show staff a clear "waiting on Joe" line where the Approve/Reject buttons used to be (Engine card and Ops card).**
   - `components/engine/EngineClient.tsx:733`: replace the `:null` in the staff branch (`canAssign?<>…</>:null`) with
     `<span className="text-meta text-ink-3">Waiting on Joe to approve.</span>`
   - `components/engine/RecordOps.tsx:213`: replace `) : null) : (` (the staff branch) with
     `) : <span className="text-meta text-ink-3">Waiting on Joe to approve.</span>) : (`
   This keeps the flag frame and chip honest ("needs approval… waiting on Joe") and fills the empty action spot. The copy is the same on both surfaces.

2. **Decisions page: don't offer staff controls that the server now refuses.**
   - `app/(os)/engine/decisions/page.tsx:73`: base `canResolve` on the owner rule, and give staff the reason in plain words:
     `pending.push(view(d, owner && auth.ok, owner ? (auth.ok ? null : auth.reason) : "Waiting on Joe. Only Joe can approve sends."));`
     The existing `!auth.ok && !owner` filter on `:72` stays. Staff still see only the decisions they used to answer. The existing disabled-button state and the flag line at `DecisionsClient.tsx:157` then show the reason without any new markup.
   - `app/(os)/engine/decisions/page.tsx:82`: the header must not say "waiting on you" to staff:
     `{ready.length} waiting on {owner ? "you" : "Joe"}`

## Optional (not blocking)

- O1. Engine card for staff: hide "Edit" on approval-bucket items for staff, or make the staff editor read-only. Otherwise staff can change a draft Joe is about to approve. The binding already makes Joe's Approve refuse a changed draft, so this is only about tidiness.
- O2. Draft-box guard: add `|| item.draft.note` to the condition in both files. Then a "won't email anything because…" note still shows when there is no To/Subject and the body repeats.
- O3. Notifications header for staff: drop the "· 0 waiting on you" half when `approvals` is empty for a non-owner (`NotificationsClient.tsx:100`).
- O4. `decisions/actions.ts:52` and `approvals.ts` decline: when the staff refusal is for a Reject/Decline, "Only Joe can answer this." reads better than "approve sends". This is moot once Fix 2 lands.
- O5. Carried over from R5: O1 ("This older card can't approve drafts."), O2 ("Draft" eyebrow on `WorkItemDraft`), and R4's nine optional items stay optional.

## Rulings honoured

No Face ID inside the app was required. "Notify me" is out of scope. Earlier optional items were not raised to required.
