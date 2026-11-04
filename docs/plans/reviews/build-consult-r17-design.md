SCORES: design=9 completeness=9

# Build R17 — Design & field UX judge (in-home consult)

## How this was judged

**Screenshots:**
- `/tmp/sjcqa/shots/consult-r17/*`: 191 PNGs and `log.json`.
- `/tmp/sjcqa/shots/consult-r17b/*`: the supplementary phone run on the same visit (16g, 17h/17hh, 17i).

**Code:** read at `8e3aeab8`. That covers `898d44ce` (R16-1, O1–O3), `c9392136` (the domain fixes: range-on-wall question, kept island size, lead-test field and lead-plan flag) and `8e3aeab8` (seed inventory).

**Not run:** no servers, builds, browsers or DB.

**Logs:**
- `overflow_px: 0` on every shot in both runs.
- `held: 2`, `forced refusals: 1`.
- The conflict-close steps log "close disabled by conflict (expected)" with the label "Close visit — pick the conflict first" at both widths.

**Harness artifacts, not scored:**
- **`FAIL-phone-r16-island-lead`:** r17b re-shot it.
- **`FAIL-o-schedule` (r17b):** the visit was already scheduled.
- **The `/api/portal/selection-image/*` 404s.**
- **`phone-17e` wrap with no RRP line** for 1965 "No" + reason: intended.
- **`w320-13b` and `w320-13c` are the same frame.** The phone run had already ticked Bathroom, so both show the ticked state. At 320 the Kitchen option and whatever sits under it are behind the footer.
- **`phone-43h-…-after-button` still lands on Trade walks with no walk day.** The refusal is forced on a visit with no day. `49b` shows the real landing.

---

## Verified fixes (R16)

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R16-1 | "This room is part of" offered a Skip that didn't count | **FIXED** | **`phone-13b` / `phone-13c`:** under Bathroom / Kitchen the next thing is the rule and then **Level**. There is no "Skip this field…", and Room name above still has its Skip, so the gap is specific to this field.<br>**Code:** `model.ts` adds one `roomMustPickJob()` test (`:318`), used by the skip rule (`:406`), the view's `noSkip` (`:419`) and the section label (`:440`), so they can't drift. `FieldRow.tsx:329` draws Skip / Change reason only when `!f.noSkip`, and Undo skip at `:330` stays for a skip saved earlier. `:311` swaps that skip's line for "Pick at least one — every room has to belong to a job." (`words.ts:98`). That is what I asked for.<br>**320:** not proven on screen (see artifacts). Accepted on code plus `tests/consult-r16-design.test.mjs`. |
| O1 | Hint said "one job" while the control is checkboxes | **DONE** | **`phone-13b`, `w320-13b`:** "Tick the job that prices this room's floor — usually just one. …" "Tick" matches the boxes, and "usually just one" heads off the double count. At 320 it wraps in five lines with no clipping. |
| O2 | Backsplash measures a long scroll from their choice | **DONE** | **`phone-16c`:** "Full wall at range" is picked, and right under it is "Backsplash height along the counters (to the uppers) *" with a dashed **Tap to measure**.<br>**`phone-16f`:** under that comes "Range or cooktop on a wall (not in the island)? *" with Yes / No.<br>**`w320-16d`:** Yes is picked and "Tile behind the range — width × height from the counter up *" follows, with its hint. The page changes where the visitor tapped. It is display order only (`backsplashOrder`, `model.ts:121`), so the pinned forms are not touched. |
| O3 | Disabled Close was white at about 2:1 | **DONE** | **`phone-45b`, `w320-45b`:** "Close visit — pick the conflict first" is now dark ink on a muted tan fill. It reads at arm's length, and it is plainly not the white outlined **Go to field** above it. At 320 it wraps to two lines inside the target. `primitives.tsx:20` applies this to disabled primaries only, so secondary and quiet buttons are unchanged. |
| O4 | "Skip — Not applicable" shorthand for an island cooktop | **DONE (by the form change)** | The question "Range or cooktop on a wall (not in the island)?" replaces the shorthand (`16f`). The range-wall hint now only says where to put the tape (`w320-16d`). It is plainer than what I proposed. |
| O5 | Re-shoots | **Mostly ARRIVED** | **Range-wall keypad (`phone-16e`, `w320-16e`):** the title "Tile behind the range — width × height from the counter up" wraps over two lines at 390, and the **×** key sits in the bottom number row. At 320 (short screen) the title is clamped to one line and "width × height from the counter …" shows in the display box until typing starts, as designed in r6/r7. See O1 below.<br>**`w320-07c`:** "Room 1 — Bath · Part of: Bathroom" wraps onto three lines in the label column, and "1/13", "◐ Partly" and "›" keep their column. **`phone-07c`** does the same on two lines.<br>**`w320-43g-note-cleared-after-sections`:** now framed on "Formal estimate promised by *", "✓ Covered", 11/12/2026. The blue note is gone. Verified on screen this time.<br>**`43h` after-button with a day:** not re-shot (see artifacts). `49b` covers it. |

## New this round (domain fixes, judged for the field)

- **Kept island asks its size (`r17b/phone-16g`).** Island = Keep is now followed by "Island size — length *" and "— depth *", each a dashed **Tap to measure**. It reads plainly, and a carpenter expects to measure a kept island they will top. Good.
- **Range on a wall (`16f`, `w320-16d`).** This is a 56 px Yes / No in plain words, and "(not in the island)" says what No means. Good.
- **Lead test + Lead: plan (`r17b/phone-17h`, `17hh`, `17i`).** The flag shows as a calm ⚐ advisory under the choice, and Before you wrap counts it in "Flags: 2 need a decision". The placement and wording of the new test question are a problem, though. See R17-1.
- **Trade walks with a day (`phone-49b`, `w320-49b`):** unchanged from R16 and still right. "⚐ Walk day Thu, Dec 10 — only Joe can set a walk day. Remove it and he'll set it from the office." Then a full-width **Remove the day**, and the multi-line Reason.
- **Refusal `43h`:** "⚠ Only Joe can set a trade-walk day. Remove the day in Trade walks, then close again." **Trade walks** is the primary button and **Keep working** sits under it. Unchanged and right.

---

## Required fixes

**R17-1. The lead-test question comes before the plan it qualifies, is required on every pre-1978 house, and the flag points to a note that isn't there (required, small).**

- **State:** `r17b/phone-17h`, `phone-17hh`.
  - The Era section reads, in order:
    1. "Recorded lead test shows no lead on the affected surfaces? *" (Yes / No / Skip);
    2. "Lead: plan *".
  - Pick "Not needed" and the flag under it says "…Pick a plan **or note the test result**."
- **Why it is a problem in the field:**
  1. **It is a required question that almost never applies.** It is asked on every pre-1978 house (`shared.ts:425`, condition `before1978`). At a consult nobody has tested anything, so the visitor taps No every time, or skips a required field. It only matters when the plan is "Not needed" (the flag condition at `:426`). On "Assume lead present", "Test kit" or "Lab test" it asks a result question that means nothing.
  2. **It sits above the choice that makes it matter.** The visitor answers a test-result question before saying whether a test is planned. Then "Not needed" raises a flag about a question they already scrolled past.
  3. **"Note the test result" misdirects.** The way to clear the flag is the Yes / No question, not a note. A carpenter reading "note" looks for a notes box. The nearest one is the flag note in Before you wrap, and writing there does not clear the flag.
- **Change:**
  1. `lib/consult/forms/seed/shared.ts:425–426`:
     - Put `lead_plan` first and `lead_test_negative` right after it.
     - Make `lead_test_negative` conditional on `all(before1978, eq('lead_plan', 'Not needed'))`. Picking "Not needed" then opens the question directly under the tap, which is the same pattern as O2.
     - Plainer label: "Has a lead test already shown no lead where we'll work?" Keep the hint "Only answer Yes with a recorded certified renovator test or lab result."
     - The flag `when` stays as it is. Unanswered and No still raise it.
  2. Flag hint, in both places (`shared.ts:426` `flag.hint` and `flag-hints.ts:39`): "Lead-safe work can only be skipped after a lead test shows none. Pick another plan, or answer Yes just below if a test already showed no lead."
  3. The domain judge should confirm that narrowing the question's condition is fine. The flag logic and the server rule are unchanged. A visit that already saved an answer keeps showing it, because `applicable` keeps any saved answer (`model.ts:404`).
  4. Tests:
     - `tests/consult-r16-logic.test.mjs`: with `lead_plan: 'Assume lead present'`, `lead_test_negative` is not applicable or required. With `'Not needed'` it is applicable and its view comes directly after `lead_plan`.
     - Update the era inventory string in `tests/consult-seed.test.mjs:29` if its condition code changes.
- **Re-shoot:**
  - `phone-17h` with "Assume lead present": no test question.
  - Then "Not needed": the question opens under it, and the flag reads the new hint.
  - Then Yes: the flag is gone.

## Optional extras

- **O1. Pair keypad: say the order while it's empty.**
  - `Keypad.tsx:144`: for `length_pair`, the empty status reads "Type the measurement".
  - At 320 (`w320-16e`) the title is clamped to "Tile behind the rang…", and the tail "width × height from the counter …" is cut off too.
  - Use "Width, tap ×, then height" as the empty status for pairs. "Add the height after ×" already follows once typing starts.
- **O2. "Lead: plan" reads like a form code.** Use "Lead-safe plan" (`shared.ts:426`). It is internal wording, not counsel-approved.
- **O3. Trade walks has both Close and Cancel** (`49b`). Carried; leave it for a pass over all the sheets.
- **O4. Re-shoots:**
  - `w320-13b` on an unticked room, scrolled so Kitchen and the absence of Skip are in view;
  - a room whose `part_of` was skipped before this change, showing Undo skip and "Pick at least one — every room has to belong to a job.";
  - `phone-43h-…-after-button` on a visit with a walk day.

Score 10 needs R17-1.
