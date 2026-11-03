# Build R3 — Design & field UX judge (discovery calls Phase 1)
SCORES: design=8 completeness=7

I judged this from the 79 shots in `/tmp/sjcqa/shots/calls-r3/`, `log-checklist.json`, `log-live.json` and the harness `/tmp/sjcqa/shoot-calls.mjs`, checked against my round-2 list, commit eae388f9, `docs/plans/discovery-call-plan.md` §4/§6 and `docs/design-tokens.md`. Every logged shot has 0 px horizontal overflow. The only console errors are the expected `ERR_INTERNET_DISCONNECTED` in the offline shots.

The round-2 fixes are good, and most show in the shots:
- the phone live bar
- the lead already on the line
- the unknown caller's Start checklist
- the live-bar wording for manual entries
- the desktop picker's position and instant first page

What keeps this from a 10 is one new problem that touches every checklist screen. Once the checklist's own follow-up draft is submitted, the app's corner approval popup (`NotificationCenter`, `fixed … z-[60]`) sits on top of Finish checklist, the row sheet's Save, the unknown-caller buttons, the picker results, the lead confirm's Cancel and the Settings footer, at every width. The checklist creates the very approval that then blocks it. That caused most of this round's FAIL shots. The rest is lead-picker ordering, one summary title wrap and duplicated "submitted" copy.

## Round-2 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Live bar number on a phone | **FIXED** | phone-11/13/16: `(612) 555-0199 04:02 +4 Open ✕` complete at 360. desktop-11/17b with the dock open: `(612) 555-0199 — on the line 04:57` complete ("Call from" drops). tablet-13/17b keep "Call from". On the lead page Alex's own call comes first (phone-14, desktop-14) |
| 2 | Desktop lead picker | **PARTLY** | (d) FAIL-desktop-02: the dialog is centred over the main column (x 743–1183 inside 646–1280), clear of the sidebar and dock. (a) "Recent leads" is populated with no loading state. (c) The phone-09 log resolves `button aria-label="Lin…"`, so the harness now hits the picker, not the hidden list row. **Still open:** (1) "Recent leads" leaves out the lead created minutes ago (Alex Smith). `lib/checklist-lead-search.ts` orders by `last_contact_at DESC NULLS LAST`, and a new lead has no contact yet, so it sorts last and falls outside the 12. (2) A typed search ranks a scope match above a name match: FAIL-phone-09, "Pat" shows *Tyler Lillemo* first (scope "…fenced **pat**io") and pushes Pat Noemail down under the popup. (3) Opening the dialog focuses ✕, not the search field (`Sheet.tsx:41` focuses the first focusable), which is why the harness's typing went nowhere (FAIL-desktop-02, empty field). (4) The acceptance criterion, desktop 02–07 and 09 shots, is still not met |
| 3 | Unknown caller: Start checklist | **FIXED** | phone-12: card "Unknown caller — (612) 555-0199 / Start the checklist now and link the lead later." with **Start checklist** primary, then Link to a lead / New lead / Not a lead call. phone-12b: `Lead: Link later · Call: this call · Saved`, 0 of 13. **Tablet/desktop "button not found" is a harness artefact, not a defect.** FAIL-tablet-12, tablet-12-unknown-caller and desktop-12-unknown-caller all show that same call's checklist already running (Lead: Link later · Call: this call · 0 of 13), because the phone pass started it first on the shared fixture call. A call has one checklist, so the card correctly isn't offered again |
| 4 | Lead already on the line | **FIXED** | phone-15, tablet-15, desktop-15: "On the line with Alex now." + **Open checklist for this call** + Cancel; "Checklist only" is gone. (On a phone the popup covers Cancel; see N1) |
| 5 | Summary copy and title wrap | **PARTLY** | In code: "All rows (13) · 1 answer" (`ChecklistSummary.tsx:184`) and "✓ Everything covered." (`:146`). No shot shows either, because 10-allcovered failed everywhere. **Title:** phone-06/06b now wrap as "Checklist summary · Alex Smith / **· started 8:32 PM**". The line no longer ends on "·", it starts with one, which is just as wrong (`:72–73` glue the "·" to the following span) |
| 6 | Manual entry in the live bar | **FIXED** | tablet-02/06c, desktop-01/03: "Discovery checklist · started 8:33 PM". phone-01, w320: "Checklist · 8:15 PM", complete at 320 |
| 7 | Settings footer on a phone | **NOT VERIFIABLE** | phone-16/17/17b: the bottom 300 px, where the footer and Restore default wording would be, is under the popup. tablet-17b shows [Save][Cancel][Restore default wording] on one line at `@sm` and up, as specified. desktop-17b shows Save and Cancel disabled in the "dirty" shot, so the harness's edit probably didn't register; retake it |

## New issues

- **N1: the approval popup covers the checklist's main actions (blocker).** It appears once the follow-up is submitted, and from then on on every page (the first submit happened on the phone pass, so tablet-01…18 and desktop-01…18 all start with it showing). Where it covers what:

  | Shot | Covered |
  |---|---|
  | FAIL-tablet-06, tablet-02/03/06c | Finish checklist; the last 3 rows' state column |
  | tablet-04, tablet-05 | the row sheet's **Save** (why tablet-06c shows Budget still Open) |
  | desktop-05 | the side sheet's Save |
  | desktop-01/06c, FAIL-desktop-07 | Finish; Photos / The property / Paying for it |
  | phone-12 | New lead / Not a lead call |
  | FAIL-phone-09 | the picker's later results |
  | phone-15 | the confirm's Cancel |
  | phone-16/17/18 | the Settings footer; the offline line |
  | w320 | the whole checklist below the header; "Approve & send" wraps to a second line |

  On a phone it also covers the tab bar on every page (phone-13/14). This is a field screen used during a live call: the primary action can't be hidden by a different task. The app already has the right pattern. `lib/notification-placement.ts` puts Inbox into **compact** mode: a "Decisions N" badge that opens the cards only when tapped, at z-35, below sheets. The checklist screens should use the same mode.
- **N2: lead picker ordering** (see item 2). A brand-new lead, the common case for a discovery call, is missing from "Recent leads", and name matches sort below scope matches.
- **N3: the picker doesn't focus its search field** (see item 2). With a mouse and keyboard the main action is typing a name.
- **N4: "submitted" says the same thing twice and talks about Joe to Joe.** phone-07 shows "Follow-up submitted — waiting for approval in Today." (`ChecklistSummary.tsx:207`) and right under it "Submitted for approval. Joe approves it in Today; approval sends it." (`:218`). Joe is the one reading it. The §6.8 line fits a staff user, not the owner.
- **N5: harness gaps (no product change).**
  - The unknown-caller fixture call is shared across widths, so only the first width sees the card.
  - Escape after picking "No budget yet" discards the pick (`shoot-calls.mjs:67`), so no shot shows a saved Budget row. That's correct behaviour, but untested.
  - The 08/09/10 steps fail behind the popup.
- Minor, not blocking:
  - w320: "Saved" still sits alone on its own line (carried over).
  - The Has an HOA pills read "HOA / No HOA / Not sure". "Yes / No / Not sure" would read better now that the legend asks the question.
  - phone-11: with Alex's call open on /calls, the bar shows the *other* live call. That is acceptable (it's a different call), but the shots should confirm it never shows the call already open on screen.

## Required to reach 10

1. **Approvals stay out of the checklist's way (N1).** Shots: FAIL-tablet-06, tablet-04/05, desktop-05, FAIL-desktop-07, phone-12/15/16, w320. Files: `lib/notification-placement.ts`, `components/shell/NotificationCenter.tsx`, `components/calls/checklist/ChecklistPane.tsx` (or `CallsClient.tsx`), `components/settings/DiscoveryChecklistSettings.tsx`.
   - In `approvalPlacement`, return `compact: true` for `/calls` and `/settings/calls`, and whenever a checklist surface is mounted. Signal that the same way Inbox does: generalise `sjc:inbox-surface` into a `sjc:compact-approvals` event, dispatched by `ChecklistPane` and `StartDiscoveryCall`'s confirm on mount and cleared on unmount. That covers the lead page while the confirm is open.
   - In compact mode the badge needs a slot that doesn't collide with the header at 320–360. The fallback `fixed right-28 top-0` lands on the breadcrumb at 360. Rename `#inbox-approval-badge` to `#approval-badge-slot` and render one in the Calls detail header row (beside the call timer / "Checklist · started …") and in the Settings page header.
   - In any mode, no approval card may sit above an open checklist `Sheet`: the sheet layer wins. With compact at z-35 under the Sheet, this follows automatically.
   - Acceptance: re-run with one approval already waiting before the pass starts. Finish, row-sheet Save, the unknown-caller buttons, picker results, the confirm's Cancel and the Settings footer are all fully visible and clickable at 320, 360, 820 and 1280 (dock open). "Decisions 1" shows in the slot and opens the cards on tap.
2. **Picker ordering (N2).** Shots: FAIL-desktop-02, FAIL-phone-09. File: `lib/checklist-lead-search.ts`.
   - Untyped: `ORDER BY GREATEST(created_at, COALESCE(last_contact_at, created_at)) DESC`, so a lead created or touched today comes first.
   - Typed: rank name matches first: `ORDER BY (name ILIKE $1 || '%') DESC, (name ILIKE '%' || $1 || '%') DESC, <phone match> DESC, GREATEST(…) DESC`. Scope-only matches come last.
   - Keep `orderForCall` putting the on-call lead on top.
   - Acceptance: right after creating "Pat Noemail", the picker shows it first under Recent leads, and typing "Pat" shows it above "Tyler Lillemo".
3. **Picker search gets focus on desktop (N3).** Shot: FAIL-desktop-02. Files: `components/calls/checklist/Sheet.tsx`, `Pickers.tsx`.
   - Add an `initialFocus` ref prop to `Sheet`.
   - The lead picker passes its search input when `matchMedia('(pointer: fine)')` matches. Keep ✕ on touch so the keyboard doesn't cover Recent leads.
4. **Summary title (item 5).** Shots: phone-06/06b. File: `components/calls/checklist/ChecklistSummary.tsx:60–75`.
   - Title = "Checklist summary" (or "Call summary").
   - Under it, a `text-meta text-ink-2` line: `Alex Smith · started 8:32 PM` (or `· 12 min`), in nowrap spans.
   - No "·" may start or end a line at 320 or 360.
5. **Submitted state copy (N4).** Shot: phone-07. File: `ChecklistSummary.tsx:207, 218`.
   - Right after submit, show one status line only. Drop the `drafts` list item for a draft submitted in this view, or drop the `:218` line.
   - Owner: "Waiting for your approval — it's in Today." with a link to Today.
   - Staff: keep "Joe approves it in Today; approval sends it."
6. **Harness (N5), so the next round can actually reach the remaining screens.** File: `/tmp/sjcqa/shoot-calls.mjs`.
   - One unknown-caller fixture call per width, or end the previous width's session.
   - In step 04, tap **Save**, not Escape, and shoot the saved row ("Budget · No budget yet · ✓ Covered").
   - Seed one waiting approval *before* the first step, so every shot is taken with it present (acceptance for 1).

## Shots to add next round

- **Every checklist shot with one approval waiting** (after fix 1): phone-01/12/15/16/18, w320, tablet-04/05/06, desktop-05/06/07. Also "Decisions 1" opened from the slot.
- **Desktop 02–07 and 09** with the dock open and collapsed: picker with "Alex Smith" first under Recent leads, the search focused, and the "Link to Alex Smith? …" confirm.
- Summary at 360 and 320 after fix 4. "All rows (13) · 1 answer" expanded. All-covered "✓ Everything covered." (phone/tablet/desktop 10). "Call summary · Alex Smith · under 1 min" and "· 12 min".
- The submitted state as owner and as staff (after fix 5). The no-email "Confirm their email first / Add email" and no-lead "Link to a lead first", with `-scrolled` shots of the draft column.
- Settings on a phone (round-2 item 7): clean (no footer, Restore default wording under the rows) and dirty ([Save][Cancel] on one 72 px line). Retake desktop-17b actually dirty.
- Unknown caller on tablet and desktop with a fresh call → Start checklist → New lead filled → checklist relinks ("Lead: Pat Noemail").
- Still carried from rounds 1–2:
  - ringing ("Incoming call" / "Your cell rings first")
  - the row sheet's N/A missing-reason error, mic "Writing…", Undo after a save, "Changed by hand"
  - the insurance warning at 360
  - conflict (Keep mine / Use the saved one), recovered edits (Send now / Discard), storage denied, loading skeleton, load error + Retry
  - focus rings, 200% zoom, tablet landscape 1180×820
  - Settings extra-row switches, length errors, version conflict
  - staff on `/calls` with a checklist open
