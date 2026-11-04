# Build R15 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r15/*`. That is 169 shots plus `log.json`, from a production side build on a fresh database.

**Code:** checked at `04b07e00`. The UI changes are in `1dc74373`; `6c209472` carries the template changes ("This room is part of" and the range-wall tile); `04b07e00` passes the advisory `kind` to `OfficeFlags`.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`, `forced refusals: 1`.
- `close-failure todos` reads the same as in round 14 (plain, and it says who acts).

**Harness artifacts, not scored:**
- "N other devices".
- `FAIL-phone-rrp`: round 11's 1965 + No shots stand.
- `FAIL-tabletL-date-client`.
- `FAIL-phone-conflict-close` and `FAIL-w320-conflict-close`: the disabled Close visit button, which is intended.
- The `/api/portal/selection-image/*` 404s.
- `seeded walk day {"tw": []}` logs an empty list. The 49b shots still show the day, so I take the seed as having worked and the log line as stale.

## Why the scores

**Design stays at 9.** R14-1 is fixed, and so are all three round-14 extras:
- **The refusal names the field.** Its button says **Go to field**.
- **The field it lands on says why**, in the calm blue note.
- **The conflict footer's Go to field is outlined.**
- **"Thu, Nov 12 ✓" stays together.**
- **The radon advisory has no decision line.**

One thing keeps design from 10. It is in the walk-day state I asked to see last round, now shot for the first time (R15-1). The button **Take the day off** reads as the idiom for a day off work. The refusal that sends the visitor there says "Take the day off in Trade walks, then close again", which reads like "go home". The line above the button also says "only Joe sets it", right over a button that changes it.

**Completeness stays at 9.**
- **Arrived:**
  - the 320 refusal, its landing with the note, and the after-‹ Sections shot;
  - the 320 Complete screen;
  - Trade walks with a day, at 390 and at 320;
  - the outlined footer button at both widths;
  - the date and ✓ on one line (`43k-after-button`, `49`);
  - the office advisory with no decision line.
- **Still owed:**
  - **`phone-43g-refused-invalid-command-after-button` is not in the folder or in `log.json`.** The brief lists it as present. Only `phone-43g-refused-invalid-command` exists, so the 390 landing is unshot. The 320 landing passes, and 390 is wider, so this is small.
  - **No shot shows the new "This room is part of" field.** It is a new required field on every two-template visit, and the visitor answers it on every room. The only sign of it is the office rail on `owner-desktop-50b` ("Room 1 — Hall bath · Part of: Bathroom").
  - **No shot shows the new range-wall tile field.** It appears only with Backsplash = "Full wall at range". The office feed on `50b` shows "Backsplash area 33 sf", but not the field the visitor fills.
  - **`w320-43g-note-cleared-after-sections` doesn't show the field.** It shows the top of Closing, with Formal estimate promised by out of frame. It proves the visitor got back to Closing, not that the note is gone. The code path is simple and clears the note in three places (VisitScreen `onPop`, ‹ Sections, and `openSection` for another section), so I accept it on code.

---

## Round-14 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R14-1 | A refusal on a known field said "Before you wrap", landed on a field that looked finished, and gave no reason | **FIXED** | **`phone-43g`, `w320-43g`:** "Not closed yet". The red box reads "⚠ The office couldn't read one answer: Closing › Formal estimate promised by. Check it, then close again." Under it: "Joe has been told this visit hasn't closed." The primary button is **Go to field**, with **Keep working** under it. At 320 everything wraps cleanly, and there is no overflow.<br>**`w320-43g-…-after-button`:** the visitor lands on Closing with the date field focused (accent-soft ring). The blue status note "The office couldn't read this answer — check it, then close again." sits inside the ring, above the label, so the "✓ Covered" mark beside it is explained. The date input is in frame, with **‹ Sections** / **Next ›** below.<br>**Code:** `refusedAt()` in `VisitScreen.tsx` uses the same places as the focus branch. `RefusedNote` is in `FieldRow.tsx` and `PhotoRow`. The note clears when that field saves, on ‹ Sections, on browser Back, or when another section opens. `closeRefusalPlace` is in `words.ts`. Tests: `consult-r14-design.test.mjs`. |
| Extra | The conflict footer's Go to field looked like a label | **DONE** | **`phone-45b`, `w320-45b`:** a full-width outlined **Go to field** under "! 1 conflict to pick before you close", above the greyed "Close visit — pick the conflict first". It now reads as the way forward. The footer is about 190 px of 700 at 320, and the list above still shows three rows. |
| Extra | "12 ✓" wrapped alone | **DONE** | **`phone-43k-after-button`:** "Formal estimate promised by" over "Thu, Nov 12 ✓".<br>**`phone-49`:** "Thu, Dec 10 ✓". The date and ✓ move as one piece. |
| Extra | The radon advisory carried a decision | **DONE** | **`owner-desktop-50b`, FLAGS:** the ⚐ radon line stands alone. The two ⚐ flags that can be decided (pipes, fumes) keep their muted "Not an issue · Reviewed for QA fixture" line. `officeFlagText(…, kind)` reads advisories by their hint. |
| Re-shoot | 320 Complete | **ARRIVED, passes** | **`phone-40-complete-screen-as-staff-w320`:** "✓ Complete" on one line, "Closed Nov 3, 8:18 pm" under it. "Price-critical 354/354 ·" breaks over "Record 2/2 · 64 skipped", with the dot ending the line. The locked line is followed by **Look over** (primary) and **‹ Back to visits**. Nothing strands, and the header's long name truncates with "…". |
| Re-shoot | Trade walks with a walk day | **ARRIVED; see R15-1** | **`phone-49b`, `w320-49b`:** the Plumber fieldset opens with "⚐ Walk day Thu, Dec 10 — only Joe sets it.", a full-width 56 px **Take the day off**, then the Yes/No question and Reason. The layout is right at both widths: the mark has words beside it, nothing overflows, and the sheet scrolls to the trade. The words are the problem (R15-1). |
| Re-shoot | `phone-43g` and `-after-button` | **PARTLY: the 390 after-button shot is missing** | See Completeness. |

## New this round

- **"This room is part of"** (`shared.ts:111`, `model.ts`). The code is sound for design:
  - It shows only when the visit has more than one template.
  - Its options are the visit's own template titles ("Bathroom", "Kitchen"), not the full list of ten.
  - It is a multi-pick, so a hall the kitchen floor runs into can be both.
  - The section label gets "· Part of: Bathroom".

  Not seen on a phone. The hint says "e.g.", which isn't a word Joe uses (see the extras).
- **Backsplash split** (`template-modules.ts:161-162`):
  - "Backsplash height along the counters (to the uppers)" (4–36″);
  - "Range wall tile — width × height above the counter" (12–96″), with the hint "Measure the tiled area behind the range, counter to hood or ceiling."

  Both are plain and say where to put the tape. Not seen on a phone.
- **For the domain / engineering judges, not scored here:**
  - The area formula adds `range_wall_tile.w × (range_wall_tile.h − backsplash_height_in)`. The pair's floor (12″) is below the counter backsplash ceiling (36″). A range wall measured lower than the counter backsplash, say 16″ against 18″, gives a negative term and quietly shrinks the area. Clamp that term at 0, or refuse h < counter height in the field.
  - On a two-template visit, a room with no "part of" answer drops out of every template's floor area (`roomAllowed`). The field is required, so the close gate catches it, but a skipped answer zeroes the room's area.

---

## Required fixes

**R15-1. "Take the day off" reads as a day off work, and it sits under "only Joe sets it" (required, small).**
- **State:** `phone-49b-trade-walks-with-day`, `w320-49b-trade-walks-with-day`.
  - The Plumber fieldset reads "⚐ Walk day Thu, Dec 10 — only Joe sets it.", then the button **Take the day off**.
  - The refusal that sends the visitor here (`words.ts:619`, `owner_required`) reads "Only Joe can set a trade-walk day. Take the day off in Trade walks, then close again."
  - **Two problems:**
    - **The idiom.** "Take the day off" is the everyday phrase for not working. A staff visitor in a client's kitchen reads the refusal as an odd joke, or as being sent home. It is not what the button does.
    - **The contradiction.** "Only Joe sets it" sits right over a button that changes it, so the visitor can't tell whether they're allowed to tap it.
- **Change** (`lib/consult/ui/words.ts`):
  1. `tradeWalkDay`: "Walk day {day} — only Joe can set a walk day. Remove it and he'll set it from the office."
  2. `tradeWalkDayOff`: "Remove the day".
  3. `owner_required` (`:619`): "Only Joe can set a trade-walk day. Remove the day in Trade walks, then close again."
  4. Update the tests that assert the old strings. No layout change is needed; the button already goes full width under `sm` at 56 px.
- **Re-shoot:** `phone-49b` (or `w320-49b`), plus the `owner_required` refusal screen (`phone-43h`) so the refusal line matches.

## Re-shoots owed (completeness)

1. `phone-43g-refused-invalid-command-after-button` (390, with the note).
2. **The Room section on a two-template visit,** at 390 and at 320. Show "This room is part of" with its options, one picked, then the section list row showing "· Part of: Bathroom". At 320, make sure the longer row label wraps under the counts and mark rather than pushing them.
3. **Kitchen work with Backsplash = "Full wall at range"** at 390. Show both height fields and the range-wall pair on the keypad.
4. *(Optional)* `w320-43g-note-cleared-…` with the date field in frame, so the shot proves the note is gone.

## Optional extras

- **"e.g." in the "part of" hint.** Write "Pick every job this room's floor or walls belong to. For example, a hall the kitchen floor runs into is Kitchen." Joe writes "for example", not "e.g.".
- **The Reason input in Trade walks is a single line.** At 320 (`w320-49b`), "Look at the drain stack before…" is clipped at the field edge. A reason is a sentence, so use `multiline` the way the Flags note does (`WrapClose.tsx:173`).
- **Trade walks has both Close (header) and Cancel (footer).** They do the same thing. This has been true of every sheet since round 9, so leave it unless the sheets get a pass together.
