# Build R4 — Design & field UX judge (discovery calls Phase 1)
SCORES: design=8.5 completeness=8.5

I judged this from the shots in `/tmp/sjcqa/shots/calls-r4/`, `log-checklist.json` (pass 1) and `log-live.json` (pass 2, five fixture calls). I checked them against my round-3 list, commits 9ff32c13 and 89fa0b09, `docs/plans/discovery-call-plan.md` §4/§6 and `docs/design-tokens.md`. Every logged shot has 0 px horizontal overflow. The only console errors are the expected `ERR_INTERNET_DISCONNECTED` in the offline shots.

The round-3 blocker is fixed where it was reported. Every checklist screen now has its approvals folded into a "Decisions N" badge, at all widths, even with 1–4 approvals waiting:
- the checklist
- the row sheet
- the unknown-caller card
- the summary
- the submitted state
- Settings › Calls

Finish checklist, the row sheet's Save, the unknown-caller buttons and the Settings footer are all fully visible. The summary title and the submitted copy are right.

Three problems keep this from a 10:
1. **(blocker)** Outside the checklist, the uncapped approval stack still covers the live-call bar and the lead page's **Start a discovery call**. That button is the feature's entry point, and the coordinator's FAIL-14 shots show the result.
2. The new badge pushes the manual checklist header onto two lines. At 320 the line ends on "·", which is the same defect round 3 fixed in the summary title.
3. On a phone call's header, the badge takes a row of its own.

## Round-3 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Approvals stay out of the checklist's way | **FIXED** (on the screens it covered) | phone-01/02/04b/18, w320: no cards; "Decisions 1/2/4" sits in the checklist header and Finish checklist is clear. phone-04, tablet-04, desktop-05: no card over an open sheet, and Save is visible. phone-12/12b, desktop-12: all four unknown-caller buttons are clear. phone-07, desktop-07: the submitted state is clear. phone-16/17/17b, desktop-17b: the Settings header holds the badge and the footer is clear. tablet-15, staff-phone-lead-confirm: the lead-page confirm has no cards over it and Cancel is visible. The badge never lands on the breadcrumb. **Not covered by this fix:** the lead page itself and every other page during a live call (N1) |
| 2 | Picker ordering | **FIXED in code, not shot** | `lib/checklist-coverage/lead-search-sql.ts`: untyped search orders by `GREATEST(created_at, last_contact_at)`; typed search ranks name prefix › word › contains › phone › scope-only. `tests/checklist-lead-search-db.test.mjs` covers both. The harness picked "Alex Smith" by typing (phone/tablet/desktop-02 show "Lead: Alex Smith"), but `linkLead` never shoots the open picker, so there is still no visual check (R4 below) |
| 3 | Picker search gets focus on desktop | **FIXED in code, not shot** | `Sheet.tsx` takes `initialFocus` as a ref and focuses it once on open. `Pickers.tsx` passes the search field under `(pointer: fine)`. No shot of the open picker |
| 4 | Summary title | **FIXED** | phone-06: "Checklist summary", then the meta line "Alex Smith · started 8:58 PM". phone-10 (no lead): "started 8:58 PM", with no leading "·". No line starts or ends on "·". (The same defect now shows in the manual header; see N2) |
| 5 | Submitted state copy | **FIXED** (owner) | phone-07, desktop-07 show one line: "Waiting for your approval — it's in Today. Open Today". No duplicate line. The staff variant is not shot |
| 6 | Harness | **PARTLY** | Done: a fresh unknown caller per width (phone 0201, desktop 0203); the Save tap (all `04b-budget-saved` shots show "Budget · No budget yet · ✓ Covered"); an approval seeded before the first shot. Still open: no picker shot; desktop-17b still isn't dirty (Save and Cancel disabled, Label still "Work 4/40", where phone-17b *is* dirty); step 14 fails at phone and desktop (N1) |
| r2-7 | Settings footer on a phone | **FIXED** | phone-17b: [Save][Cancel] on one line above the tab bar. phone-16 (clean): no footer |

Spec check, §6.4a: the hand-ticked checklist, row states, Still right ✓, the sticky Finish bar and the offline line ("Offline — 3 changes not sent", phone-18) all match. §6.6 unknown caller matches at all widths. §6.8 "Everything covered." shows (phone-10).

## New issues

- **N1 — Off the checklist, approvals still bury the live bar and the lead page's entry point (blocker).** Compact mode applies only on `/calls`, `/settings/calls`, `/inbox` and inside sheets. Everywhere else the default stack (`NotificationCenter.tsx`, non-compact branch) shows up to `MAX_CARDS = 3` full cards plus "+1 more", with no height cap, at z-60.
  - **FAIL-phone-14 / phone-14:** the three cards cover the whole 360×780 screen: the §6.1 live bar ("Alex Smith 04:59 … Open ✕"), the lead header with **Start a discovery call**, and the tab bar. The harness timed out clicking the button.
  - **phone-13 (Today):** the same. The live bar, which §6.1 puts on *all pages* during a call, is invisible.
  - **FAIL-desktop-14 / desktop-14 (dock open):** the stack runs from y 48 to the bottom. It covers the live bar's timer, **Open checklist** and ✕, and cuts **Start a discovery call** off at "Start a d…".
  - **tablet-14:** passes only because 1180 px of height lets the stack start at y 368.

  **Decision: fix it with compact approvals, not a cap.** Compact mode exists for screens where a card would cover the action Joe came to take. The lead header's Start a discovery call, and the live bar during a call, are exactly that.
  - A count cap alone doesn't fix desktop. Even a height-capped three-card stack at 1280×860 with the dock open still reaches the lead header row.
  - Capping the stack to one card would change approval behaviour on every page of the app. That is Joe's call and outside this feature.
  - So: claim compact (a) while the live bar shows a call and (b) while the lead header's Start a discovery call is mounted.
  - Give the badge one fallback home in the Topbar beside the bell, so the fixed `right-28` corner position is never used.
  - A separate, optional note for Joe: the default stack (three cards over the phone tab bar, ~830 px tall) is heavy app-wide. One card at `<sm`, sitting above the tab bar, would help every page. That is not required here.
- **N2 — The manual checklist header wraps, and at 320 it ends a line on "·".** The badge slot (`ChecklistPane.tsx:433–434`) now shares the 48 px header row.
  - phone-01/02/04b/07/18 (360) read "← Calls **Checklist** · started" / "8:58 PM".
  - w320 reads "**Checklist** ·" / "started 8:59 PM". The line ends on "·", the defect round 3 fixed in the summary title.
  - §6.4a draws `[‹ Calls] Checklist · started 10:42` on one line at 360.
  - The two-line header also adds ~28 px above the rows on the field screen.
- **N3 — On a phone call's header, the badge takes a row of its own.** phone-12/12b: "← ☏ (612) 555-0201 ● On the line 04:01" fills row 1, and "Decisions 4" sits alone on row 2 (`CallsClient.tsx:279`). That costs ~56 px of a 780 px live-call screen to show one pill. phone-11 is fine, because the shorter number lets the badge share row 2 with "On the line".
- Minor, not blocking:
  - **Repeat follow-ups.** The run left three identical "Discovery call follow-up" cards for Alex, one per width. In real use a second call with the same lead could do the same. Next phase: the summary could say "A follow-up to Alex is already waiting in Today" before Submit.
  - **"· 0 answers" with 13 covered** (phone-10). This is a fixture artefact (states set without answers), but the count reads oddly.
  - **Settings badge on a phone.** phone-16: "Decisions 4" drops to its own line under the page title. Acceptable on a desk screen.
  - **Two manual checklists look alike** (carried). With two open, the live bar ("Checklist · 8:38 PM") points at the *other* one than the header ("started 8:58 PM"). Correct, but the two read alike. Acceptable in Phase 1.

## Required to reach 10

1. **The live bar and the lead page go compact (N1).** Shots: FAIL-phone-14, FAIL-desktop-14, phone-13, desktop-14. Files: `components/shell/LiveCallBar.tsx`, `components/leads/StartDiscoveryCall.tsx`, `components/shell/Topbar.tsx`, `components/shell/NotificationCenter.tsx`, `lib/notification-placement.ts`.
   - **`LiveCallBar.tsx`:** while `entries.length > 0`, call `claimCompactApprovals("live-call", true)`. Release it on unmount or when the bar empties. This is a surface claim, not modal.
   - **`StartDiscoveryCall.tsx`:** the header-button instance (not `variant="menu"`) calls `claimCompactApprovals(useId(), true)` while mounted. Keep the existing modal claim from its confirm `Sheet`.
   - **`Topbar.tsx:53`:** render the fallback slot `<span id="approval-badge-topbar" className="shrink-0 empty:hidden">` beside the bell on every route, not only `/inbox`. Inbox keeps its current `#approval-badge-slot`.
   - **`NotificationCenter.tsx` / `approvalPlacement`:** the badge goes to the page's `#approval-badge-slot` if one exists, else to `#approval-badge-topbar`. Never use the `fixed right-28` corner; delete that branch. While a modal claim is active the badge may stay in the topbar, and the cards still stay closed.
   - **Below `@sm`:** the badge renders as a 44×44 chip, a `BellRing` icon plus the count ("⚑ 4"), with the current `aria-label` ("4 waiting on you — show decisions"). That keeps it from forcing the breadcrumb or the bell off the top bar at 320/360. From `@sm` up it keeps "Decisions N".
   - **Acceptance:** re-run with 4 approvals waiting and a live call. phone-13, phone-14, tablet-14 and desktop-14 (dock open) show the full live bar (number or name, timer, +N, Open checklist, ✕) and the lead header with **Start a discovery call** fully visible and clickable. Step 14 passes at every width. Tapping the badge opens the cards at z-35 under the top bar, and Escape closes them. When the call ends on a page that isn't compact, the corner stack comes back.
2. **The manual checklist header stays on one line, with no "·" at a line end (N2).** Shots: phone-01/02/04b/18, w320. File: `components/calls/checklist/ChecklistPane.tsx` `ManualHeader` (~:425–436).
   - Wrap the time part in one `whitespace-nowrap` span that *includes* its "·". Below `@md/page`, read "· 8:58 PM" ("started" drops, matching the live bar's "Checklist · 8:58 PM").
   - Below `@sm/page`, the Back button is icon-only (44×44, `aria-label="Back to Calls"`), and the badge is the icon+count chip from fix 1.
   - **Acceptance:** at 320 and 360 the header is one 48 px row: `← Checklist · 8:58 PM [⚑ 1]`. At ≥ `@md`, it is `← Calls Checklist · started 8:58 PM [Decisions 1]`, as today on tablet and desktop.
3. **The badge doesn't take its own row on a phone call header (N3).** Shots: phone-12/12b. File: `components/calls/CallsClient.tsx:279`.
   - Below `@sm/page`, render the `ApprovalBadgeSlot` at the right end of the tab row, after "Call notes", not in the call header. Use the icon+count chip from fix 1. The tabs end at ~285 px at 360, so the 44 px chip fits.
   - From `@sm` up, leave it where it is (desktop-12 is right).
   - **Acceptance:** phone-12/12b with "(612) 555-0201": the call header is two rows at most, and the tab row shows `Discovery checklist | Call notes [⚑ 4]`.
4. **Harness gaps, so the remaining checks are actually seen (no product change).** File: `/tmp/sjcqa/shoot-calls.mjs`.
   - In `linkLead`, shoot the open picker twice at each width: before typing (`-02a-picker-recent`, "Alex Smith" first under Recent leads, with the search field focused on desktop) and after typing "Pat" (`-02a2-picker-typed`, Pat Noemail above Tyler Lillemo).
   - Make desktop-17b actually dirty: type into Label and blur, so Save is enabled.
   - Add the staff-view submitted state (`staff-phone-07`: "Joe approves it in Today; approval sends it.").

## Shots to add next round

- After fix 1, with 4 approvals and a live call:
  - Today, Leads, a lead page and Projects at 320, 360, 820 and 1280 (dock open and closed).
  - The badge opened from the topbar.
  - The same pages after hangup, where the corner stack is back.
- After fix 2: phone-01 and w320 headers, and a tablet header at `@md` for comparison.
- After fix 3: phone-12/12b.
- Picker shots from fix 4: desktop focus ring on the search field, plus phone (✕ focused, Recent leads fully visible).
- Still carried from rounds 1–3:
  - ringing ("Incoming call" / "Your cell rings first")
  - the row sheet's N/A missing-reason error, mic "Writing…", Undo after a save, "Changed by hand"
  - the insurance warning at 360
  - conflict (Keep mine / Use the saved one), recovered edits (Send now / Discard), storage denied, loading skeleton, load error + Retry
  - focus rings, 200% zoom, tablet landscape 1180×820
  - Settings extra-row switches, length errors, version conflict
