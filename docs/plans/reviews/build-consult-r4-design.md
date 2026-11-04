# Build R4 — Design & field UX judge (in-home consult)

SCORES: design=7 completeness=6

Judged from `/tmp/sjcqa/shots/consult-r4/*` (`log.json`, `log-wrap.json`): a fresh Bath + Kitchen visit on a fresh database. I checked it against plan §3, §5, §6, §8, §10 and `docs/design-tokens.md`, and against the code at `a8a15b67` (with `a22d7edc`).

Coordinator facts, confirmed in the logs:
- `overflow_px: 0` in every entry.
- `404 urls: []`.
- Answers reached the server at every width.

**Why design went down from 8 to 7.** Most of round 3's screen-level fixes landed, and they hold up on screen:
- **Fraction keys:** the glyphs replace the "1/81/43/8" mess.
- **Before you wrap:** the blockers are at the top, and the button sits in one column on every row.
- **Tablet landscape:** a resumed visit opens a real pane.
- **Section rows:** they read count · mark ›.
- **Sending sheet:** it shows a real "Last sent 1:14 pm" or "All sent ✓".
- **Look-over:** it says "Closed on device · not yet".
- **Tablet-portrait keypad:** the fraction row fits.

But the fresh visit exposes a defect that breaks the second half of the walk:
- The pinned **Kitchen** template never got its required sections. There is no Kitchen scope, no Kitchen walls and no appliance rows.
- **Closing** is missing. Only "+ Add closing" shows.

With Closing missing, these all go dead:
- "Show to client" from Before you wrap does nothing.
- There is no "Pick date" button.
- The client view and the hand-back PIN can't be reached.

Separately, the leave check fires, but it fires off-screen, so **‹ Sections** looks dead at three widths. And the close result never showed at any width.

A visitor can't finish a Bath + Kitchen visit screen-for-screen. That caps design at 7.

**Why completeness went down from 7 to 6.** These states can't be shown this round, because of the regression or the harness:
- the client view: `tabletL-16` and `-24` show the visit, not the client view
- the hand-back PIN: `tabletL-17` shows a room section
- the close result: all four `*-22` shots are stuck on "Visit closed — sending"
- the leave banner: `phone/w320/tabletP-12` show the field, not the banner
- Closing

Round 3 had all of these except the leave banner at three widths. New this round: opening step 2 and the tablet-landscape resume.

---

## Round-3 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| C1 | 320 px fraction keys unreadable | **PARTLY** | `w320-14`: single glyphs ⅛ ¼ ⅜ ½ / ⅝ ¾ ⅞ in 4 + 3 rows, each key about 64 px wide. Readable. **But** at 320×700 the second row (⅝ ¾ ⅞) is cut in half by the Save footer, so the visitor has to scroll inside the keypad to reach ¾. `phone-14` (390) shows both rows in full. Also, ¼ ½ ¾ come from Mulish and ⅛ ⅜ ⅝ ⅞ from a fallback font, so the keys visibly differ in weight (clear on `tabletP-14` and `phone-14`). |
| C2 | Close result reads as an error; counts disagree | **FIXED (code), not seen** | `WrapClose.tsx` now has an ink heading with ◐, ○ per check, `checkCount()` per row and one shared total. Not seen on screen: `phone/tabletL/tabletP/w320-22` all show only "Visit closed — sending · ⇅ 0 · Keep this screen open.", with Online and nothing waiting. See R4-3. |
| C3 | Leave banner wall of text | **FIXED (code), not seen**, and there is a new placement defect | The code now has a ○ Open / ◐ Partly list, at most 3 names, then `leaveLine`. **None** of `phone-12`, `w320-12`, `tabletP-12` show the banner. It renders at the *top* of the section (`VisitScreen.tsx:236`), and `setLeave` (`:124`) doesn't scroll. The visitor taps ‹ Sections at the bottom of a long section and sees nothing happen. See R4-2. |
| C4 | "Last sent · Not yet" when all is sent | **FIXED** | `phone-09b/09c`: "Last sent 1:14 pm". `tabletL/tabletP/w320-09b`: "All sent ✓", "Nothing waiting to send." New side effect: see R4-4 (a false ⚠ Not sent). |
| C5 | Flag line shows code citations | **FIXED (code), shot owed** | `flag-hints.ts` gives every seed flag a hint, `FlagSheet` shows `f.hint`, and `consult-hints.test.mjs` covers flags and code citations. No flag fired on this visit ("Two dogs" went into the alarm-locations field), so neither the ⚑ line nor the flags sheet was captured. |
| C6 | Client view copy | **FIXED (code), not seen** | `ClientView.tsx` / `client-summary.ts` now say "Not measured today: the bathroom, the kitchen", list rooms by name / area / level, and say "Joe sends your formal estimate by …". The client view could not be opened this round (R4-1). |
| C7 | Before you wrap layout | **FIXED** | `phone-20`, `tabletL-20`: estimate date, client initials and trade walks come first, and **Go to section** is right-aligned on every row. New: the blockers use the flag-red ! style (R4-5). |
| C8 | Tablet-landscape resume: empty pane | **FIXED** | `tabletL-05`: opens House & household with **Next ›** in the thumb zone (`resumeSection`). |
| C9 | Phone row order | **FIXED** | `phone-07`: "0/19 ○ Open ›", with the chevron last. |
| C10 | Script field half width | **FIXED** | `tabletP-08`: "Say:" + "Photos okay?" span both columns. A wider ragged-grid problem remains (R4-6). |
| C11 | Look-over wording | **FIXED** | `owner-desktop-move-dialog`: "Closed on device · not yet". There is no "Kitchen wall 1 — Kitchen" (but there are also no Kitchen walls at all, see R4-1). |
| C12 | Tablet-portrait keypad clipped | **FIXED** | `tabletP-14`: 56 px keys, and the whole fraction row is visible above Save. |
| C13 | Straight quotes | **FIXED (that label)** | `tabletL-17`: Wall used as “Ahead”. Others remain (R4-9). |
| N3 | ‹ Sections at opening step 2+ | **FIXED, shot taken** | `phone-06`, `tabletL-06`: "OPENING · 2 OF 6", ‹ Back above the card, ‹ Sections + **Next ›** in the bar. |

## New issues

**R4-1. Fresh Bath + Kitchen visit: Kitchen's required sections and Closing are never created (required, blocker).**
- **What the shots show:**
  - `phone-07b` (and the left pane of `tabletL-20/24`) has no "Closing" row. It shows a placeholder row "Closing 0/1 ○ Open [+ Add closing]".
  - Kitchen gets the same placeholder treatment: "Kitchen 0/1 [+ Add kitchen]" and "Kitchen wall 0/2 [+ Add kitchen wall]".
  - There are no Kitchen appliance rows.
  - In round 3 the visit had "Closing 0/4".
  - The placeholder Closing row sits *above* the Kitchen rows, not last.
- **What follows from it:**
  - The Kitchen half of the walk (cabinet runs, countertop, appliances) has nowhere to go.
  - "Show to client" in Before you wrap is a no-op. `ConsultApp.tsx:179` only opens the client view when `closingSection` exists. So `tabletL-24` shows the visit, not the client view.
  - "Formal estimate date — not picked yet" has no **Pick date** button, because `onPromised` is `undefined` without Closing (`VisitScreen.tsx:324`).
  - Client initials and the promised date can't be cleared, so a Complete close is impossible.
- **Cause, from the code:**
  - `ensureRequiredInstances()` (`lib/consult/ui/controller.ts:325`) is one long loop of sequential client commits, about 50 here: one per Bath + Kitchen selection preset, plus each preset's answer.
  - It runs only from `start()` (`:322`) and on a `rooms_wanted` answer (`:354`). It never runs on load or resume.
  - `phone-07b` caught it mid-loop: ⇅ 1, "Selections & allowances 3/30", sections still appearing.
  - When the walk moves on and the page reloads or the context changes (in the field: the phone sleeps, or the tab is reloaded), the loop dies after the selection presets and never comes back.
  - Closing, Kitchen scope, Kitchen walls and appliances come after the 30 presets in the merged order, so they are the ones lost.
- **Separate ordering bug:** `mergeTemplateModules` (`lib/consult/template-merge.ts`) appends the second template's own modules after the first template's `closing`. Closing should always be last.
- **Fix:**
  - (a) Call `ensureRequiredInstances()` on every snapshot load / resume. It is already idempotent, because `need = minimum − live`. Guard it against running twice at once.
  - (b) Create the single and minimum-count instances (closing, kitchen_scope, kitchen_wall ×2, appliance, room…) *before* the selection presets. Ideally commit all instance ops as one batch, so a reload can't leave half a visit.
  - (c) In `mergeTemplateModules`, move `closing` to the end after merging (and keep `selections` and `era` before it).
  - (d) Never render a dead button. If Closing is somehow missing, "Show to client" and "Pick date" should create it and then open it.
  - (e) Add a test: pin bath + kitchen, start, interrupt the loop after N ops, rebuild the model. Expect exactly one closing (last), one kitchen_scope, ≥ 2 kitchen_wall, ≥ 1 kitchen_appliance.

**R4-2. The leave check is invisible: ‹ Sections looks dead (required).**
- **Where:** `phone-12`, `w320-12`, `tabletP-12`. The visitor is scrolled to the Smoke/CO fields, taps **‹ Sections**, and the screen doesn't change.
- **Cause:** the banner mounts at the top of the section (`VisitScreen.tsx:236`), far above the viewport. Round 3's `tabletP-12` only showed it because that section happened to be scrolled near the top.
- **Fix:** show the leave check as a bottom sheet (same pattern as Skip), with **Go back** / **Leave for now** in the thumb zone. Or scroll `main` to the top and focus the banner when `setLeave` fires. A bottom sheet is better: the decision belongs next to the thumb that asked for it.

**R4-3. The close result never arrives on screen (required, verify).**
- **Where:** all four `*-22` shots stop at "Visit closed — sending · ⇅ 0 · Keep this screen open." The bar shows "⇅ 0 · Online · sending…".
- **Possible cause:** `close()` calls `drain(true)`. If a timer drain is already running, it returns at once with `send_in_progress` (`controller.ts:386–389`), and the close then depends on that drain reaching its close-intent check at the end (`:409`).
- **What the visitor needs:** a "sending" state with nothing waiting and signal present has to turn into Complete / Needs finishing within a few seconds. If it can't, it has to say why and offer **Try again**.
- **Fix:** keep the in-flight drain promise, have `close()` await it, then call `resumeClose()` directly. Give the closing screen a timeout state ("Still closing… [Try again]") after about 20 s.
- **Re-shoot:** wait up to 30 s for the result heading.

**R4-4. A false "⚠ Not sent" when Send now overlaps a background send.**
- **Where:** `phone-09b`.
  - The status bar says "⇅ 2 · ⚠ Not sent · sen…".
  - The sheet says "Last try ⚠ 1:14 pm · A send is already running. Wait for it to finish." with "For Joe: send_in_progress".
- **Why it's wrong:** this is normal behaviour shown as a failure. The `drain()` early return records `send_in_progress` as `lastSendFailure` (`controller.ts:387`), and `offline-engine.ts:46` does the same.
- **Fix:** treat `send_in_progress` as "Sending…", never as ⚠. Send now should join the running send.

**R4-5. Before you wrap draws not-done-yet items as Problems.**
- **Where:** `phone-20`, `tabletL-20`. "! Formal estimate date — not picked yet", "! Client initials — not yet" and "! Trade walks … needs a decision" all use the flag-red border, the soft fill and the "!".
- **Why it's wrong:** this is the same rule C2 fixed on the close result. §6.1 keeps ! Problem for conflicts and rejected sends.
- **Fix:** use the action/info tone with ○ for undecided items. Keep `warn` for conflicts and refused answers only.
- **Related:** the header reads "195 Open · 0 Partly", while the list right behind it shows dozens of ◐ Partly sections (R4-7). Make the two counts agree.

**R4-6. Tablet portrait: ragged two-column grid.**
- **Where:** `tabletP-08/09/12`.
  - "Permit authority — electrical" (a choice field with a hint) sits alone in the left column with the right column empty.
  - Full-width text and multi fields come next.
  - Then "missing/unknown" and "Water pressure" pair up.
- **Why it matters:** the eye zig-zags, and the half-width rows look like a missing field.
- **Fix:** let any field with a hint, or with 3+ options, span both columns. Or use one column at md and keep two columns for xl.

**R4-7. Selection rows start as ◐ Partly.**
- **Where:** `owner-desktop-move-dialog` and the button log. Every preset row ("Bath — Vanity", "Kitchen — Sink" …) reads 1/3 ◐ Partly before anyone touches it.
- **Cause:** the preset `decision` name is counted as a price-critical answer.
- **What it does:**
  - It inflates progress ("Price-critical 32/226").
  - 30 rows look half-done.
  - It contradicts "0 Partly" in Before you wrap.
- **Fix:** don't count `decision` (or `name` / `level`, the same exclusion already used in `summaryInput`) toward the section's progress count or mark.

**R4-8. Section names don't tell the visitor which is which.**
- **What the shots show:**
  - "Room 1 — Bath" and "Bath 1" are separate rows.
  - The add button says "+ Bathroom", but the row is "Bath 1".
  - "+ Room dimensions" adds a row called "Room n".
  - "Panel 1 — Kitchen": the electrical panel serves the house, not the kitchen.
  - "Structure check 1" has no area, while "Moisture check 1 — Bath" does.
- **Fix:**
  - The add button and the row use the same noun.
  - The bath scope row reads "Bathroom work" (or "Bath — scope").
  - The panel reads "Electrical panel" with no area.
  - Each repeat carries its area when one template is the only reason it exists.
- Also, the zero-instance placeholder rows crush at 390 px and in the 360 px tablet pane: "Selections & allowan[ces]" wraps one word per line under its button, and the Kitchen-wall hint runs 5–6 lines. Stack them: name and count, the hint at full width, then the button at full width. After R4-1 these rows should be rare.

**R4-9. Typography leftovers.**
- **Straight apostrophes inside curly-quoted scripts:** "I'm", "We'll", "I'll" in `phone-05/06`.
- **Straight quotes in a look-over label:** Client's own list ("anything you want us to look at") in `owner-desktop-panel-closed-lookover`.
- **Keypad readout:** "reads as 6' 9"" in `w320-14` looks like straight marks. Check that `ct()` runs on the readout.
- **Fraction glyph weights don't match** (C1).
- **Fix:** run the same smart-punctuation pass over seed scripts and labels, and test for `'` and `"` in seed strings that the visitor or client sees.

**R4-10. Small items.**
- **Tablet landscape shows the script twice:** the left pane shows the section's script line and the right pane shows it again under "Say:" (`tabletL-09/24`). On ≥ 1024 px, show the inline Say only in the left pane, or only in the right one.
- **"⇅ 0 · sending…" in the bar** (`phone-05/07/10`, `*-22`): nothing is waiting, yet the bar says it is sending. Count the in-flight operations, or say "checking…".
- **Schedule dialog with nothing ticked:** **Schedule** is disabled with no reason given (`owner-desktop-01`). Add "Pick at least one template" under the buttons.

## Required to reach 10

1. **R4-1:** every required instance of every pinned template exists after a start, even one interrupted or reloaded. Closing comes last. "Show to client" and "Pick date" always work. Add a test for this.
2. **R4-2:** the leave check shows in the thumb zone (a bottom sheet), at every width.
3. **R4-3:** the close reaches Complete / Needs finishing within seconds when nothing is waiting and the device is online. A stalled close gets a "Try again" state.
4. **R4-4:** `send_in_progress` is never shown as ⚠ Not sent.
5. **R4-5 / R4-7:** Before you wrap blockers use ○ / action tone, not !. Selection presets don't count as answers. The header counts match the list.
6. **C1 remainder:** both fraction rows are visible without scrolling at 320×700, in one consistent fraction font.
7. **R4-6, R4-8, R4-9, R4-10:** grid, naming, punctuation and the small copy fixes.

## States still to capture

All four widths unless noted. Most of these are blocked by R4-1 / R4-3 until those are fixed.

| Shot | How to reach it |
|---|---|
| `07-section-list` after the fix | Fresh Bath + Kitchen visit. Expect Kitchen, Kitchen wall A/B, the appliance rows and **Closing last**. Take a second shot after a reload in the middle of start. |
| `12-leave-section-banner` | Scroll deep into House, then tap ‹ Sections. The shot must show the leave check next to the thumb. |
| `15/16-closing` + `client-view` + `17-hand-back-pin` | Closing section → **Show to client**. Then a wrong PIN (error line, field cleared), the right PIN, and the hold progress. |
| `22-close-result` | Needs finishing, with the ◐ heading and ○ check rows, and the count equal to Before you wrap. `22b` Complete from a full fixture. `22c` offline ("closed — sending when signal returns"). |
| `flags-sheet` + `09-flag-line` | A visit where a flag fires, for example the alarms field set to "Missing". Shows the visitor hint, with no code citations. |
| `14b-keypad-ambiguous` | Ceiling height → `3` → the 3″ / 3′ choice; then `8 1 1/4` → reads as 8′ 1¼″. |
| `13-send-stuck`, `09e-sun-on`, `07d-photo`, `07c-add-instance` | Unchanged from round 3. |
| `02y-no-signal`, `13-signed-out`, `08-offline-strip`, `conflict` | Unchanged from round 3. None captured yet. |
| `owner-desktop-07-settings` | Settings → **Company** (still shows Profile). |
| `owner-desktop-lookover-closed` | After a needs-finishing close: the banner and "Closed on device ✓". |
| `owner-strip-as-visitor`, `staff-today` | As Abigail: **Get ready** on the strip, and the consultation to-do on Today. |
