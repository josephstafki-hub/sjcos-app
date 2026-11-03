# Build R1 — Design & field UX judge (discovery calls Phase 1)
SCORES: design=6 completeness=7

Judged from the 49 shots in `/tmp/sjcqa/shots/calls-r1/` + `log.json`, against `docs/plans/discovery-call-plan.md` §3/§4/§6/§7 and the code in `components/calls/`, `components/ui/CoverageMark.tsx`, `components/shell/LiveCallBar.tsx`, `components/leads/StartDiscoveryCall.tsx`, `components/settings/DiscoveryChecklistSettings.tsx`. No horizontal overflow at any width (log: 0 px everywhere); the only console errors are the expected `ERR_INTERNET_DISCONNECTED` in the offline shots.

## What works

- **Words are the plan's words.** "Discovery checklist", "Start checklist", "Finish checklist", "By hand — AI can't hear this call", "Link later", "Call: none", "Saved / Not sent", the offline banner sentence, "Still right ✓", "Checklist only — I'll call from my cell", the §325E.66 warning: all exact. No "session", "coverage", "nudge" leaked onto a screen.
- **CoverageMark is right.** Symbol + word on every row (○ Open, ◐ Partly, ✓ Covered, — N/A), 15 px words right-aligned, 17 px labels; the aria-label on the state button says the current word and the next one ("Budget: Open. Mark Covered"). State never depends on colour alone.
- **Tap targets.** Rows, state words, session-line pickers, sheet buttons and live-bar actions are all ≥48 px; the sheet's state buttons are 56 px (`min-h-14`) as §1.1 asks.
- **Row sheet layout** fits the field: bottom sheet on phone/tablet, right-hand 440 px panel on desktop (desktop-04), Undo/Save pinned at the bottom under the thumb, "Why we ask · Questions to try" collapsed.
- **Live-call bar** looks native on tablet/desktop (`--ai-soft`, 48 px, mono timer, "+3 more", per-tab ✕) and hides itself for the call that's open in Calls.
- **Staff path is clean.** Staff get one primary "Checklist only" and no "Call now" (staff-phone-lead-confirm); Settings redirects them out (staff-phone-settings-redirect).

## Required to reach 10

1. **Phone: "Finish checklist" is hidden under the bottom tab bar — the hand-ticked flow can't be finished on a phone.**
   Evidence: phone-02, phone-03, phone-13, w320-checklist (dark bar edge peeking at y≈720 / 640), log `phone-06-finish` timeout. Settings' sticky Save on the same width is fine (phone-12).
   Likely cause: `components/shell/MobileNav.tsx` reserves the tab bar's space with the rule `div:has(> [data-mobile-more]) + [class~="@container/page"] { margin-bottom: … }` — an **adjacent-sibling** selector. `LiveCallBar` is now mounted between the Topbar and the page container (`components/shell/Shell.tsx:78`), so whenever a call or open checklist exists the rule stops matching on every page.
   Change: stop depending on adjacency — put the reservation on the page container itself in `Shell.tsx` (`max-sm:mb-[calc(3.5rem+env(safe-area-inset-bottom))]` on the `@container/page` div) and delete the `<style>` hack, or at minimum change `+` to `~`. Acceptance: at 360×780 and 320 px with the live bar showing, the whole 48 px Finish bar sits above the tab bar, and phone-06 summary shots can be taken.

2. **Phone: the page header eats the call screen — only 5 rows visible at 360 px, 2 at 320 px.**
   Evidence: phone-02/03 (rows start at y≈465), w320-checklist (Work + Budget only), desktop-02 with the Operator panel open (container is phone width, same problem).
   Change in `components/calls/CallsClient.tsx`: below `@3xl/page`, when `mobileDetail` is true (a call or checklist is open), don't render the Calls `PageHeader` block (title, meta, Start checklist); the pane header already carries "← Calls". In `ChecklistPane.tsx` tighten the top: session line and the "By hand" chip on one wrapping line, `mt-3` between chip and the "Discovery checklist" heading (it currently touches it — tablet-02 at y≈342/352). Target: ≥8 rows visible at 360×780 with the live bar showing, ≥5 at 320.

3. **Two "Start checklist" buttons that do different things.**
   Evidence: phone-07, tablet-07, desktop-07 — the header button starts an **unlinked** checklist; the one under "No checklist for this call yet." starts one **linked to Alex's call**. Mid-call, Joe hits the big top one and loses the link. Also phone-02/desktop-02: header "Start checklist" stays above an already-open checklist, inviting a second session.
   Change in `CallsClient.tsx`: show the header "Start checklist" only when nothing is selected or the list is showing; when a call detail or a checklist is open, hide it (the detail's own button is the only one). Plan §4.2's "Calls header" entry stays true for the empty state.

4. **Live-call bar on phone cuts off the timer and the number — the two things it exists to show.**
   Evidence: phone-01 "Alex Smith — 0…", phone-02…13 "Call from (612) …", w320 "Call from …".
   Change in `components/shell/LiveCallBar.tsx`: split the text into a name/number span (`min-w-0 truncate`) and a timer span (`flex-none font-mono tabular-nums`) so only the name truncates. Below `@sm/shell` drop "Call from" and "—" (show `☎ (612) 555-0199 03:08` / `☎ Alex Smith 06:07`). "+N more" is hidden on phone, so the other live calls are unreachable from the bar: show a compact "+2" link to `/calls` instead of hiding it.

5. **Row sheet: picking an answer that covers the row leaves it Open — two extra taps mid-sentence.**
   Evidence: phone-05 ("Insurance claim" picked, state still "○ Open"); phone-04/tablet-04/desktop-04 budget quick picks; per §3.1, "No budget yet" and "Rather not say" **cover** Budget.
   Change in `components/calls/checklist/RowSheet.tsx` `set()`: if Joe hasn't touched the state buttons in this sheet and the state is Open, move it to Covered when a choice is picked or an answer is typed (Partly for The property when only 1–2 of 3 parts are filled). A state Joe tapped himself is never overridden. Clearing the answer doesn't drop it back.

6. **The Budget placeholder looks like a saved answer.**
   Evidence: phone-04, tablet-04, desktop-04 — "around $40–50k" sits in the field in mid-grey with state Open; it reads as "he already told me".
   Change in the field spec (`lib/checklist-coverage/answers.ts` `fieldsFor`): placeholder "e.g. around $40–50k", or no placeholder; same check for every row's placeholders.

7. **Unknown caller and live call headers: duplicated number, broken number, wrong button, no timer.**
   Evidence: phone-08, tablet-01, desktop-08 "(612) 555-0199 (612) 555-0199"; phone-08 card title breaks "555-/0199" over two lines; phone-07/08, desktop-07/08 show "Call back" on a call that is **on the line**; desktop-07 has no call timer anywhere, because the bar hides the open call and the timer only renders after a checklist exists.
   Change in `CallsClient.tsx` detail header: skip the secondary number when `name(c)` is already the number; while status is ringing/bridged, hide "Call back" and show `● On the line 06:07` (reuse `CallState` from `ChecklistPane.tsx`) next to the name, per §6.4's header. In the unknown-caller card wrap the number in `whitespace-nowrap`.

8. **Lead confirm sheet offers "Call now" while calling is off.**
   Evidence: phone-11, desktop-11 vs the "Finish voice setup — Calling is off" box on Calls (phone-01, tablet-01).
   Change in `components/leads/StartDiscoveryCall.tsx`: pass voice-configured state; when off, hide "Call now", show one line "Calling is off — call from your cell." and make "Checklist only — I'll call from my cell" the primary. Also on phone the two-line "Checklist only — I'll call from my cell" button is cramped against its border (phone-11, staff-phone-lead-confirm): `py-2 leading-5`.

9. **The Operator pill covers sticky actions on tablet.**
   Evidence: tablet-02/02b/13 (pill over the right third of "Finish checklist"), tablet-06 (over the summary), tablet-12b (over "Restore default wording").
   Change: `ChecklistPane.tsx` sticky footer — from `@3xl/page` up make the button `w-auto min-w-64` left-aligned (as desktop already is), so it never runs under the pill; `DiscoveryChecklistSettings.tsx` footer — put "Restore default wording" beside Cancel on the left, or give the footer right padding equal to the pill's width at the breakpoints where the pill shows.

10. **Summary: wrong title, unexplained disabled toggles, buried "Back".**
    Evidence: tablet-06, desktop-06/06b.
    Changes in `ChecklistSummary.tsx`: (a) with no call, the title is "Checklist summary · started 7:34 PM" — never "Call summary · 0 min"; with a call under one minute, "under 1 min". (b) After three picks the other "Ask in email" toggles fade with no words — put "Ask up to 3 in the email · 3 picked" under the Open heading (the "3 of 3" line is far below in the draft column). (c) Move "Back to checklist" to the top, beside the title (or the pane header), not under Answers.

11. **The offline state scrolls away on a phone, and "not sent" rows depend on a dotted underline.**
    Evidence: phone-13 — banner and "Not sent" are above the scroll position; only dotted underlines remain, and the "Dotted = not saved yet" legend sits below the last row, out of view.
    Change in `ChecklistPane.tsx`: make the session line + banners `sticky top-0` in the scroll area on phone (or repeat "Offline — 3 not sent" in the sticky footer above Finish); put a word under the mark on a pending row ("not sent", 13 px `text-ink-3`) instead of the underline-plus-legend.

12. **Choice pills: duplicate legend and a reused symbol.**
    Evidence: phone-04 ("Budget" legend under the "Budget" sheet title), phone-05 ("Paying for it" twice); the pills use ○/● while ○ means "Open" in the coverage word set beside them (§6.0: one meaning per symbol).
    Change in `RowSheet.tsx`: when the legend equals `spec.label`, make it `sr-only` (or use "Their answer"); drop the ○/● glyph and show a ✓ only on the picked pill (`aria-pressed` already carries the state).

13. **Settings: "Edit wording" doesn't look like something you tap.**
    Evidence: phone-12, tablet-12b, desktop-12b — it is grey meta text in the middle of "Always on · Reminders on · Edit wording".
    Change in `DiscoveryChecklistSettings.tsx`: make "Edit wording" a 48 px secondary button (or make the whole row a button with a chevron) and leave the meta line for status only.

## Shots to add next round

- **phone-06 summary** (blocked by fix 1): Open/Partly lists, Ask-in-email at the 3 limit, draft with email, "Confirm their email first / Add email", "Link to a lead first", "Everything covered.", submitted state.
- **On lead / Still right ✓** — the fixture's known address fact on Alex's checklist never appears in any shot (no checklist was linked to Alex). Show the row before and after Still right ✓ at 360 px (the button goes full width under 420 px).
- Lead picker and call picker sheets, and the "Link to Alex Smith? Facts from this checklist will be saved to that lead." confirm.
- Row sheet: N/A with the missing-reason error; mic recording/"Writing…"; Undo after a saved change; "Changed by hand".
- Insurance warning **in the list row** (not only in the sheet), at 360 px.
- Conflict banner (Keep mine / Use the saved one), recovered edits (Send now / Discard), storage denied, loading skeleton, load error + Retry.
- Ringing ("Incoming call" / "Your cell rings first") in the bar and in the pane; ended call; "Finished · edits still allowed".
- Live bar's manual variant "☑ Discovery checklist open — Alex [Open]", and the bar with only one live item.
- Cold deep link at phone width (`?open=…&view=checklist` straight from Telegram) — phone-01/desktop-01 show the list, phone-08 shows the detail for the same URL; confirm the first paint opens the detail.
- Keyboard focus rings on row label, state word, sheet state buttons and live-bar actions; 200% zoom; tablet landscape (1180×820).
- Settings: the four optional rows' On/Off switches, global options ("Reminders go to", "Send me a link when a call starts"), the edit-wording sheet with length errors, a dirty-form Save/Cancel, and the version-conflict message.
- Staff on `/calls` with a checklist open (no Settings link, same pane).
