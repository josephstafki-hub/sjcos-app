# Build R2 — Design & field UX judge (discovery calls Phase 1)
SCORES: design=8 completeness=8

Judged from the 55 shots in `/tmp/sjcqa/shots/calls-r2/` + `log.json`, against my round-1 list, commit 1769f390 (design fixes), Codex's 201c8aea (engineering), `docs/plans/discovery-call-plan.md` §3/§4/§6 and `docs/design-tokens.md`. The log shows 0 px horizontal overflow at every width. The only console errors are the expected `ERR_INTERNET_DISCONNECTED` in the offline shots. Desktop 02–07 and 09 are missing (see N1).

Round 1 did most of what it needed to. The phone call screen now works end to end: Finish sits above the tab bar, 9 rows show at 360 px and 5 at 320, and the summary, draft and offline states are all reachable. The header, timer, row sheet, lead confirm and settings fixes all show in the shots. What's left is one phone live-bar width problem, two dead ends in the call flow (unknown caller, a lead already on the line), the desktop lead picker, and some copy on the summary.

## Round-1 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Phone Finish hidden under tab bar | **FIXED** | phone-01/02/03, w320: 48 px Finish sits fully above the tab bar; phone-18 has the offline line above it too. Summary shots 06–10 could be taken. `Shell.tsx:83` reserves the space on the page container itself |
| 2 | Header eats the call screen | **FIXED** | phone-01: 9 rows visible at 360×780 (target ≥8); w320: 5 rows (target ≥5). Page header hidden with a detail open (phone-11/12). Chip no longer touches the heading |
| 3 | Two "Start checklist" buttons | **FIXED** | phone-11, tablet-11, desktop-11: only the detail's "Start checklist" while a call is live; no header button over an open checklist (phone-01, desktop-01) |
| 4 | Live bar cuts off timer and number | **PARTLY** | The timer never truncates now (all shots), and "Call from"/"on the line" drop on phone. But with a second live item the **number still truncates** at 360: phone-13/14/15/16/17 show `(612) 555... 05:44 +1 Open checklist ✕`. Desktop with the dock open truncates too: desktop-15/16 `Call from (612) 555-0... — on the line 13:22` |
| 5 | Picking an answer leaves row Open | **FIXED** | phone-04, tablet-04: "No budget yet" → state moved to ✓ Covered |
| 6 | Budget placeholder looks like an answer | **FIXED** | phone-04, tablet-04: "e.g. around $40–50k" |
| 7 | Duplicate/broken number, Call back on a live call, no timer | **FIXED** | phone-12, desktop-12: number once, `whitespace-nowrap` in the card; phone-11, tablet-11, desktop-11: `● On the line 08:43`, no Call back |
| 8 | "Call now" while calling is off | **FIXED** | phone-15, desktop-15: "Calling is off — call from your cell." with Checklist only as the primary; the two-line button has proper padding (phone-15, staff-phone-lead-confirm) |
| 9 | Operator pill over sticky actions (tablet) | **FIXED** | tablet-02: Finish is `w-auto` left and ends well before the pill; tablet-17: Restore default wording sits beside Cancel on the left; tablet-07: Submit is clear of it |
| 10 | Summary title, unexplained toggles, buried Back | **FIXED** | (a) phone-08, tablet-08, desktop-08 "Checklist summary · started 8:14 PM" (the "under 1 min" case had no shot); (b) "Ask up to 3 in the email · 3 picked" under the counts; (c) Back to checklist beside the title (desktop-08) or right under it (phone) |
| 11 | Offline state scrolls away; dotted underline | **FIXED** | phone-18, desktop-18: "Offline — 3 changes not sent" in the sticky footer; pending rows say "not sent" under the mark; no legend |
| 12 | Duplicate legend, reused ○/● on pills | **FIXED** | phone-04: no "Budget" legend under the "Budget" title; the picked pill shows ✓ and the others show no glyph |
| 13 | "Edit wording" not tappable-looking | **FIXED** | phone-16, tablet-17, desktop-16: 48 px secondary button with a chevron; the meta line is status only |

## New issues

- **N1 — Desktop: the lead picker step failed and took 03–07 and 09 with it.** Log `desktop-02-link`: `getByText('Alex Smith').last()` resolved to `<span class="break-words text-subheading text-ink-2">`. That is the **calls-list row** (`components/calls/CallsClient.tsx:240`), which is `hidden` at this width: with the Operator dock open, the page container is below `@3xl/page`, so `mobileDetail` hides the list. The picker renders after the list in the DOM, so `.last()` would have found its "Alex Smith" result if one had been there. When the click was tried, the picker had **no result rendered** (still "Loading leads…" or "No leads match"). Its `fixed inset-0` overlay then stayed open over the checklist, so each later row click (Budget, The property, Finish) waited out its 20 s. desktop-18 shows row taps work on desktop when no picker is open, so 03–07 and 09 are a cascade from 02, not separate defects. Nothing in the code covers the dialog: desktop-15 shows the same `Sheet` dimming the sidebar and dock, with the dialog on top. Two things to fix:
  - the picker shows nothing useful straight away. Its search is a server action, and on this page server actions run one at a time behind the checklist sync's own calls (`useChecklistSync.ts` load, validate and retry).
  - the dialog is centred on the **viewport**. With the dock open it lands across the dark sidebar seam (x≈420–860, desktop-15) instead of over the Calls pane it acts on.
- **N2 — An unknown caller can't get a checklist without first naming a lead.** phone-12, desktop-12: the card offers only Link to a lead / New lead / Not a lead call. A brand-new prospect on the line is the main discovery-call case, and §4.2.1 says the first tick should be possible within a second, with the lead set to "Link later". `CallChecklistTab.tsx` renders `Start checklist` only when `leadId || linked`.
- **N3 — "Start a discovery call" on a lead who is already on the line starts a second checklist that isn't tied to the call.** phone-14/15, desktop-15: Alex's call is live (one of the two bridged fixtures), but the confirm offers only "Checklist only". That loses the call link, which is the same failure round-1 item 3 fixed on Calls. On Alex's page the bar also leads with the *other* caller, `(612) 555... +1`.
- **N4 — Summary copy.**
  - "Answers (0)" sits over a list of all 13 rows (tablet-07 lists The property / Paying for it as "○ Open · Edit"), because the count is typed answers and the list is every row (`ChecklistSummary.tsx:175`).
  - phone-10 and desktop-10 say "✓ Covered Everything covered.", the same word twice.
- **N5 — Summary title wraps badly at 360.** phone-06 ends a line on "Alex Smith ·", and phone-08 and phone-10 split "8:11 / PM".
- **N6 — A no-lead manual entry in the live bar reads only "Discovery checklist open".** tablet-02/08 and desktop-01/08 show it, and the fixture had three such entries, indistinguishable from each other. w320 truncates it to "Discovery checklist o…". The query already returns `started_at`.
- **N7 — Settings on a phone: the sticky footer wraps to two lines (~130 px).** phone-16/17: [Save][Cancel] on one line, "Restore default wording" on the next, and Save is disabled. With the live bar and the section picker on top, about one checklist row is visible. That makes Edit wording hard to use (phone-17 shows only "Label 4/40").
- Minor, not blocking:
  - w320: "Saved" sits alone on its own line between the Lead/Call line and the chip.
  - phone-05: the legend "HOA" sits over a pill also called "HOA". "Has an HOA" would read better.
  - tablet-08/06b: the Operator pill sits over the last visible "Ask in email" toggle. Make sure the summary's scroll area ends with ≥72 px bottom padding at `@3xl/page`, so the last toggle can scroll clear.

## Required to reach 10

1. **Live bar number on a phone (round-1 item 4, finish it).** Evidence: phone-13/14/15/16, desktop-15/16. File: `components/shell/LiveCallBar.tsx`.
   - Below `@md/shell`, the action text becomes **Open**, with `aria-label="Open checklist — {label}"`, since "Open checklist" alone is ~120 px.
   - When `text` is a phone number (no `who`), render it `flex-none whitespace-nowrap`; only a name gets `min-w-0 truncate`.
   - When `pathname` is `/leads/<slug>` and one live call belongs to that lead, sort that call first.
   - Acceptance: at 360 and 320 with `+1` showing, `(612) 555-0199 05:44` is complete. On desktop with the dock open (634 px pane), `Call from (612) 555-0199 — on the line 13:22` is complete. If not, drop "Call from" below `@xl/shell` as well.
2. **Desktop lead picker (N1).** Evidence: log `desktop-02-link`…`desktop-07-submit` and `desktop-09-noemail`, desktop-15. Files: `components/calls/checklist/Pickers.tsx`, `components/calls/checklist/Sheet.tsx`, `lib/actions/discovery-checklist-ui.ts`.
   - (a) Load the picker's first page without waiting on the server-action queue. Pass the 12 most recent leads into `ChecklistPane` with the snapshot, or fetch them from a GET route handler, so results show at once. Keep the server action only for typed search.
   - (b) Put the lead whose phone matches the session's call number first, marked "On this call".
   - (c) Give each result button `aria-label="Link {name}"` so the harness (and screen readers) target the picker, not the hidden list row.
   - (d) `layout="dialog"`: centre inside the app view, not the viewport. Portal into `[data-app-view]` and use `absolute inset-0` there, or use `layout="side"` on `lg` so it sits over the checklist like the row sheet.
   - (e) The harness takes a screenshot on any failed step.
   - Acceptance: desktop 02–07 and 09 shots exist with the Operator dock open **and** collapsed.
3. **Start a checklist for an unknown caller (N2).** Evidence: phone-12, desktop-12. File: `components/calls/checklist/CallChecklistTab.tsx`.
   - In the unknown-caller card, add a primary **Start checklist** as the first button. It calls `start(null)`: session tied to the call, lead "Link later".
   - Keep Link to a lead / New lead / Not a lead call as secondaries.
   - Once the session exists, the pane's `Lead: Link later ▾` handles linking (§4.2.2).
4. **Lead already on the line (N3).** Evidence: phone-14/15, desktop-15. Files: `components/leads/StartDiscoveryCall.tsx`, `app/(os)/leads/[slug]/page.tsx`.
   - Pass the lead's live call (from `liveCallBarData`, matching on lead id or phone).
   - When there is one, the confirm says "On the line with Alex now." and its primary is **Open checklist for this call**, linking to `/calls?open=<id>&view=checklist`. "Checklist only" goes away.
5. **Summary copy (N4, N5).** Evidence: phone-06/08/10, tablet-07, desktop-10. File: `components/calls/checklist/ChecklistSummary.tsx`.
   - Title: render the parts as separate `whitespace-nowrap` spans joined by " · ", so a line never ends on "·" and the time never splits. Or make "Checklist summary" the title and "Alex Smith · started 8:11 PM" a meta line under it.
   - The disclosure heading becomes "All rows (13) · 1 answer". Or list only rows with an answer and keep "Answers (1)".
   - "Everything covered.": drop the CoverageMark word ("✓ Everything covered.") or the duplicate sentence.
6. **Manual entry in the live bar (N6).** Evidence: tablet-02/08, desktop-01, w320. File: `LiveCallBar.tsx`. With no lead: `Discovery checklist · started 8:11 PM` (use `chicagoTime(m.started_at)`).
7. **Settings footer on a phone (N7).** Evidence: phone-16/17. File: `components/settings/DiscoveryChecklistSettings.tsx`.
   - Below `@sm/page`, show the sticky footer only while the form is dirty.
   - Move "Restore default wording" out of the footer to a ghost button under the last row (and keep it in the footer from `@sm/page` up).
   - Footer on a phone = one 72 px line: [Save][Cancel].

## Shots to add next round

- **Desktop 02–07 and 09** (blocked by N1), with the dock open and collapsed. Include the picker open with results, and the "Link to Alex Smith? Facts from this checklist will be saved to that lead." confirm.
- **Submitted state.** phone-07 and tablet-07 show "Write the email first." because the body was empty. Type a body (or tap "Add these questions to the draft"), submit, and capture "Follow-up submitted — Waiting for approval".
- "Confirm their email first / Add email" (no-email lead) and "Link to a lead first" (no lead). phone-09 and tablet-09 stop above the draft column, so take `-scrolled` shots of the draft area.
- Call summary for a call: "Call summary · Alex Smith · under 1 min" and "· 12 min".
- Unknown caller → Start checklist (after fix 3) → New lead sheet filled → checklist relinks.
- Lead page with that lead on the line (after fix 4); phone bar at 360 and 320 with `+1` (after fix 1).
- Still carried from round 1:
  - ringing ("Incoming call" / "Your cell rings first") in the bar and in the pane
  - the row sheet's N/A missing-reason error, mic "Writing…", Undo after a save, "Changed by hand"
  - the insurance warning in the list row at 360
  - conflict (Keep mine / Use the saved one), recovered edits (Send now / Discard), storage denied, loading skeleton, load error + Retry
  - keyboard focus rings, 200% zoom, tablet landscape 1180×820
  - Settings: the extra rows' On/Off switches, global options, wording length errors, dirty Save/Cancel, version conflict
  - staff on `/calls` with a checklist open
