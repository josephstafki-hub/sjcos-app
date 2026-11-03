# Build R5 — Design & field UX judge (discovery calls Phase 1)
SCORES: design=9.5 completeness=9.5

I judged this from the following:
- `/tmp/sjcqa/shots/calls-r5/` with `log-checklist.json` (46 shots) and `log-live.json` (29 shots, fixture calls on the line, 4–7 approvals waiting).
- The accessibility pass in `/tmp/sjcqa/shots/calls-a11y/`.
- Commits 53140dd9 (product fix) and db5aee40 (regression tests).
- My round-4 list, plan §4, §6 and §15, and `docs/design-tokens.md`.

Every logged shot has 0 px horizontal overflow, including the 200%-zoom checklist. The only console errors are the expected `ERR_INTERNET_DISCONNECTED` in the three offline shots.

All three round-4 product items are fixed, at every width shot:
- The round-4 blocker (N1) is gone. With 7 approvals waiting and a live call, the live bar and the lead page's **Start a discovery call** are fully visible on Today and on the lead page at 360, 820 and 1280 with the dock open. The approvals fold into a badge beside the bell.
- The manual checklist header is one row.
- The phone call header no longer gives the badge a row of its own.

The two scripted failures are harness defects, not product defects (see below).

One new layout defect keeps this from a 10. Between 640 and ~790 px wide, the floating **Operator** pill sits on top of the full-width **Finish checklist** button. That range covers 200% zoom at 1280 and an iPad mini in portrait (744).

## Round-4 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Live bar and lead page go compact (N1) | **FIXED** | **phone-13 (Today):** the full live bar shows ("(612) 555-0199 04:02 +10 Open ✕"), the 44×44 chip "⚑ 7" sits beside the bell, and there are no cards over the page or the tab bar. **phone-14 (lead):** the live bar, "Move to Qualified", **Start a discovery call** and Call/Email/… are all clear. **tablet-13/14** and **desktop-13/14 (dock open):** "Decisions 7" sits in the top bar beside Search and the bell; the live bar shows timer, "+10 more", **Open checklist** and ✕ in full; the lead header row shows **Start a discovery call** in full. No floating corner badge appears anywhere. The live log has no step-14 failure. **phone-15:** the confirm sheet sits over a clean page and the cards stay closed under the modal claim. The code matches the prescription: the claim in `LiveCallBar.tsx` is keyed on `showing` and released when the bar empties or unmounts; `StartDiscoveryCall.tsx` claims only for `variant === "button"`; the topbar slot is `empty:hidden`; the `fixed right-28` branch is deleted. `tests/approval-compact-entry.test.mjs` covers the mounted cases. **Not shot:** the cards opened from the topbar badge, and the corner stack coming back after hangup. The code path is simple and tested, so this does not block |
| 2 | Manual checklist header on one row, no "·" at a line end (N2) | **FIXED** | **phone-01:** "← Checklist · 11:15 AM [⚑ 4]" in one 48 px row. **w320:** "← Checklist · 11:16 AM [⚑ 7]" in one row; Back is icon-only with the `aria-label` "Back to Calls". **tablet-01 and zoom200 (640):** "Checklist · started 11:15 AM [Decisions 5]" and "← Calls Checklist · started 11:17 AM [Decisions 7]". No line breaks before or after the "·". The rows start about 28 px higher at 360 than in round 4 |
| 3 | No badge row on the phone call header (N3) | **FIXED** | **phone-12/12b:** the header is one row, "← ☏ (612) 555-0204 ● On the line 04:01", and the tab row reads "Discovery checklist \| Call notes [⚑ 7]". **phone-11:** with the name and number, the header has two rows and the chip still sits in the tab row. **desktop-12:** "Decisions 7" stays at the right end of the header, as it should |
| 4 | Harness gaps | **PARTLY** | Done: the picker is shot. **desktop-picker-open:** Recent leads lists Alex Smith first, then Pat Noemail; a11y.json shows focus on `INPUT:search`, so desktop focus lands on the search field. **desktop-picker-typed-pat:** Pat Noemail ranks above Tyler Lillemo (scope-only match), with ✕ in the field and **New lead** below. **phone-17b** is dirty: Save is enabled and the footer sits above the tab bar. Still open: **desktop-17b** is still clean (Save and Cancel disabled), and the staff submitted state is still not shot (see FAIL notes) |

### The two scripted failures (both harness)

- **FAIL-d-settings** (`getByRole('dialog').getByRole('textbox')` timed out):
  - "Edit wording" opens an inline disclosure inside the row card. It is not a dialog, so the locator can never match.
  - The shot shows the editor open and working, with Label "Work 4/40", Reminder sentence and Question 1 fields.
  - This is also why desktop-17b isn't dirty.
  - Fix the harness: use `page.getByLabel('Label').first().fill('Work scope')`, then blur.
- **FAIL-s-submit** (`…getByRole('textbox')` timed out):
  - The picker field is `<input type="search">` (`Pickers.tsx:98`). Its role is `searchbox`, not `textbox`.
  - The shot shows the staff phone picker correctly: "Link to a lead", the "Name, project or phone" field, Recent leads in the right order, and ✕.
  - Fix the harness: use `getByRole('searchbox')` or `getByLabel('Name, project or phone')`.
  - The staff copy itself is driven by `copy.submitted` with the "Open Today" link kept to the owner only (`ChecklistSummary.tsx:233–235`). The code looks right, but no shot shows it yet.

## Accessibility

- **axe (WCAG 2.1 AA):** the feature's own UI has zero violations on every screen: /calls with a call open, the checklist, the lead picker, the row sheet, Settings › Calls and the lead page. Two kinds of violation remain, and both are pre-existing shell items outside this feature's scope:
  - The sidebar section labels and role line are 4.11:1 (`#8d8e81` on `#283021`, 12 px). This feature did not touch them or make them worse.
  - On the phone, the Operator tab's `aria-controls="mobile-operator-sheet"` points at a sheet that exists only while open (`PanelHost.tsx:231`). This is pre-existing.
  - Worth a separate shell ticket. Neither blocks this feature.
- **Keyboard:** desktop focus starts in the Operator dock (tab3–tab14 walk Auto/Claude/Qwen/Hermes, then the model selects), because of the shell order. That is out of scope.
  - The walk never reached the feature, so it gives no evidence either way about focus order inside the checklist.
  - Inside the feature's sheets: picker focus lands on search on desktop. The row sheet (desktop-rowsheet) shows the Open/Partly/Covered/N-A segmented control with a clear ring on the selected "Open", an "Answer" field with a mic button, chips, "Why we ask", and Undo/Save pinned. All targets are ≥ 44 px.
  - The `button`/`a` `focus-visible:outline-focus` wrapper is still on `CallsClient`.
- **200% zoom (640×430):** reflow is clean, with no horizontal scroll, the header on one row and the chips wrapping. The usable row area is tight: only about two rows show between the sticky header stack and the Finish bar. That is acceptable, because everything scrolls. The Operator pill overlap is the one problem here (R1 below).
- **Target size and labels:** the phone chip is 44×44 and keeps the `aria-label` "N waiting on you — show decisions", plus `aria-expanded` and `aria-controls`. The icon-only Back is labelled "Back to Calls".

## New issues

- **R1 — Between 640 and ~790 px, the Operator pill covers the Finish checklist button (required).**
  - The cause:
    - `PanelHost.tsx:219` floats the pill at `fixed bottom-5 right-4 z-40` from `sm` to `lg` (640–1023 px viewport).
    - The checklist's sticky Finish button is `w-full` until `@3xl/page` (a 768 px page container).
    - Below that width the pill sits on the right ~140 px of the primary action.
  - **zoom200-checklist:** the pill covers "Finish checklist" from x 483 to 624 of 640.
  - **zoom200-summary:** it also covers the "Ask in email" button of the second Open row until you scroll.
  - Real devices this hits: an iPad mini in portrait (744), iPad split view, and a desktop browser at 150–200% zoom.
  - The tablet layout already avoids the pill. **tablet-01** (820): Finish is `w-auto min-w-64` on the left, and the pill is clear on the right.
  - So this is a missing breakpoint in the feature's own Finish bar, not a shell bug.
- **Nits (not required):**
  - **Two bells side by side on a phone.** The approvals chip uses `BellRing` (the approval cards' own icon, so it is consistent), right next to the notifications `Bell` with its red count (phone-13/14: "⚑ 7" next to "🔔 10"). Joe will learn it, but the two counts read as one idea. If it's ever revisited, use `ListChecks` or `Gavel` for the chip, or the flag-colored count alone in a pill.
  - **Phone call header, 8 px extra.** phone-12's single-row header is 80 px tall where desktop is 72 px. The now-empty `ml-auto` div (badge moved, no link) still wraps to a second flex line and adds the row gap. Fix: render that div only when it has a child.
  - **The breadcrumb truncates sooner on a phone** now that the chip sits in the top bar: "TUESDAY, NOVEMBE" and "LEADS / ALEX SMI" at 360. That's acceptable, because the page title repeats it.
  - **Settings badge on a phone** sits alone under the title (phone-16/17b). Carried and accepted.
  - **Repeat follow-ups** (carried): Today lists 7× "Discovery call follow-up" for Alex. That's a harness artefact, plus the next-phase "already waiting" hint.
  - **On /calls the live bar names a different call than the one open** (phone-12: the bar shows 0199, the pane shows 0204, with +9). That's correct with 11 fixture calls and unlikely in real use.

## Required to reach 10

1. **Keep the Finish bar clear of the floating Operator pill (R1).**
   - **Shots:** zoom200-checklist and zoom200-summary.
   - **File:** `components/calls/checklist/ChecklistPane.tsx:398–406`.
   - **Fix:** in the 640–1023 viewport range where the pill floats, reserve its width on the sticky bar. Either:
     - add `sm:max-lg:pr-40` to the sticky `div` (the pill is about 140 px plus its 16 px inset), or
     - make the button `sm:w-auto sm:min-w-64` so it sits left as on tablet.
   - Prefer the padding. It keeps the full-width target at 640–767, where Joe holds a small tablet.
   - Give the summary's scroll area the same bottom padding (`ChecklistSummary.tsx`, about `sm:max-lg:pb-20`), so the last row's "Ask in email" can scroll clear of the pill.
   - **Acceptance:** at 640×430, 744×1133 and 768×1024, no part of the Finish checklist / Summary button, and no row control at the end of the scroll, sits under the Operator pill. Phone (<640) and ≥1024 are unchanged.

### Harness only (no product change, does not block the score)
- Settings: fill `getByLabel('Label').first()`, not a dialog textbox. Re-shoot desktop-17b dirty.
- Staff submit: use `getByRole('searchbox')` in the picker. Shoot `staff-phone-07` showing "Joe approves it in Today; approval sends it." with no "Open Today".
- After the R1 fix: re-shoot zoom200-checklist and zoom200-summary, and add a 744×1133 (iPad mini) checklist shot.
- Optional: the cards opened from the topbar badge, plus a Today shot after hangup with the corner stack back.
