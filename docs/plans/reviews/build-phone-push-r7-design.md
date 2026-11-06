SCORES: design=9 completeness=9

# Phone alerts: build round 7, DESIGN judge

I judged from the diff (`git diff 823a273c 6bae654b`; HEAD 96ec1fc4 adds only the R6 review files) and the code around it. The phone app is unchanged (5b1b883). I ran nothing and built nothing.

Joe's decision (2026-11-05) replaces R5's owner-only rule. Staff who hold the matching area get their buttons back: Engine access for Engine and popup drafts, Today access for record Ops, and decisions follow the approval authority Joe hands out. I re-judged my R6 items against that decision.

## What I checked

### My R6 items under the new rule

| R6 item | Now | Verdict |
|---|---|---|
| Fix 1a. Engine › Queue staff card had no buttons | The `canAssign ? … : null` gate is gone (`EngineClient.tsx:733`). Anyone who can open `/engine` (that takes `requireAccess("engine")`) gets Approve/Reject. The actions only check `requireAccess("engine")` (`lib/actions/engine.ts:265,272`), so these buttons can succeed. The assignee picker stays owner-only, which is right. | Resolved |
| Fix 1b. Lead/Project › Ops staff card had no buttons | `canApprove={can(viewer, "today")}` (`leads/[slug]/page.tsx:395`, `projects/[slug]/page.tsx:840`), and this matches `requireAccess("today")` in `approveRecordWorkItem` / `rejectRecordWorkItem`. Staff with Today get working buttons. **Gap:** a staff login with Leads or Projects but no Today can still open the page (`staffMayOpen`, `lib/permissions.ts:150`). That login sees the red flag card with a "needs approval" chip and an empty action column (`RecordOps.tsx:222`). This is the dead card from R6, now for a smaller group. Test case 11 in `phone-push-r6-expectations.md` makes "no controls" the intended state. Having no controls is fine. Having no words in their place is not. | **Fix 1** |
| Fix 2. Decisions page offered staff buttons the server refused | The server now uses the same rule as the page. `resolve()` checks `authorityFor` (`lib/decisions/actions.ts:52-57`), and the page sets `canResolve` from `authorityFor` (`decisions/page.tsx:73`). Staff only see decisions they hold authority for (`:72`), so every enabled button can succeed. Grant decisions: `grant` is `ownerOnly` / "Never delegable" (`lib/authority/catalog.ts:51`), so a staff login never passes `authorityFor` on one. The page never shows staff a grant button that ends in "Owner only." | Resolved |
| Fix 2. Header "N waiting on you" | Each card a staff member sees is one they can answer, so "waiting on you" is true for staff and for Joe. No change needed. | Resolved |
| O4. "Only Joe can approve sends." on Reject | That string no longer appears anywhere in `lib/`, `app/` or `components/`. The grant refusal is "Owner only." and other refusals give `authorityFor`'s plain reason. | Resolved |

### Popup and Notifications for staff

- `listPendingApprovals({ principal })` lists decisions only when `authorityFor` passes, and never lists grant decisions for non-owners (`lib/approvals.ts:51-55`). It lists draft cards only when the viewer holds the `engine` area (`:108`). Because of that, `approveWaiting` → `approveWorkItem` → `requireAccess("engine")` never runs for a viewer who can't pass it. The popup's Approve/Decline can only succeed or give a real content refusal (stale or handled).
- On the Notifications page, "N waiting on you" now counts real answerable items for staff. My R6 O3 is no longer relevant.

### Long Ops approval text

- When the duplicate draft box is hidden, the card body is now the only approval text. It is unclamped, with `whitespace-pre-wrap break-words` (`RecordOps.tsx:209`). Line breaks are kept, and long URLs and words wrap without pushing the card sideways. Non-approval cards keep `line-clamp-2`, so the Ops list stays compact.
- Crowding: the buttons sit in their own `flex-none` column (`:215`). At `@xl/page` and wider they stay at the top right, next to the title, however long the text is. In a narrow container they wrap under the text. That keeps them clear of the text but pushes them below a long body (see O1). The text is readable and does not overlap the buttons.

### R5 copy still in place

- Stale draft: `WEB_CHANGED_DRAFT` = "This draft changed since you opened it. Nothing was sent. Read the new version and approve again." (`lib/approved-draft-snapshot.ts:5`), unchanged.
- "Approve failed" appears in `EngineClient.tsx:733`, `RecordOps.tsx:194` and `NotificationsClient.tsx:90` (with "Decline failed"), all unchanged.
- Telegram with no owner: "No active owner account. Nothing was changed." (`lib/decisions/telegram.ts`) is plain words and says the outcome.

### Owner layouts: unchanged

- Engine: Joe always got the approval branch before. The markup is identical, and the assignee picker is still gated by `canAssign`.
- Ops: `can(owner, …)` is always true, so Joe gets the same two buttons. The only visible change for Joe is the intended one: full approval text when the draft box is hidden.
- Popup, Notifications page and Decisions page: `authorityFor` returns `ok` for the owner on every decision, grant decisions included, so Joe's list and markup are the same as before.

## REQUIRED fixes

1. **Ops card for staff without Today: say what is happening where the buttons would be.**
   `components/engine/RecordOps.tsx:222`: replace `) : null) : (` with
   `) : <span className="text-meta text-ink-3">Waiting on approval.</span>) : (`
   Use "Waiting on approval." and not "Waiting on Joe". Under the new rule, a teammate with Today can also approve. This keeps the flag frame and chip honest and fills the empty column. It does not add a control. Test case 11 ("no controls") still holds. If that test checks for an empty column, update the assertion to look for no `<button>` instead.

## Optional (not blocking)

- O1. Long Ops approval text in a narrow container: cap it like the draft box, e.g. add `max-h-64 overflow-y-auto` when `fullBody` (`RecordOps.tsx:209`). Then Approve/Reject stay near the top on a phone-width page. The draft box already does this (`WorkItemDraft.tsx:8`).
- O2. When `fullBody`, consider `text-ink-2` in place of `text-ink-3`. This text is now the thing being approved, not a teaser.
- O3. Decisions page intro (`decisions/page.tsx:85`) says "Approve here or from the Telegram buttons". Staff have no Telegram buttons. For non-owners, consider "Approve here; the first answer wins…".
- O4. Popup for staff who hold decision authority but not the Today or Engine area: "All decisions" goes to `/notifications` (needs Today) and "Open" goes to `/engine/decisions` (needs Engine). Either link can bounce them. This only happens when a grant is handed to someone without those areas. Hide the link, or point it at a page they can open.
- O5. Carried over: R6 O1 (staff "Edit" on approval-bucket Engine items) and O2 (`|| item.draft.note` in the draft-box guard). R5's O1/O2 and R4's nine items stay optional.

## Rulings honoured

No Face ID inside the app was required. "Notify me" is out of scope. Earlier optional items were not raised to required.
