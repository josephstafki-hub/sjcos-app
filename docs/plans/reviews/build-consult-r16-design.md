SCORES: design=9 completeness=9

# Build R16 — Design & field UX judge (in-home consult)

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r16/*` — 183 PNGs and `log.json`, from the round-16 production side build.

**Code:** read at `144f72d9`.
- The R15 wording fix and the multi-line Reason box are in `c3a8d56a`.
- `144f72d9` carries:
  - the new "part of" hint;
  - "Tile behind the range" on both tiled choices;
  - a `model.ts` / `protocol.ts` change that ignores a skip on `room.part_of` on a two-template visit.

**Not run:** no servers, builds, browsers or DB.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`, `forced refusals: 1`.
- `seeded walk day` now logs the Plumber day (Dec 10) and its reason, so last round's stale-log note is closed.

**Harness artifacts, not scored:**
- **`FAIL-phone-conflict-close` / `FAIL-w320-conflict-close`:** Close is disabled with "Close visit — pick the conflict first", as intended. I judged that footer as a design under 45b.
- **`FAIL-tabletL-date-client`:** the phone run had already picked the date.
- **`FAIL-phone-rrp`:** the wrap sheet was already open. The 17–17gg RRP shots stand.
- **`w320-13b` / `w320-13c` look swapped.** The w320 run came after the phone run on the same visit:
  - "empty" opens with the phone's Bathroom already ticked;
  - "picked" is the tap that unticked it.

  For the same reason, `w320-07c` has no "· Part of" row.
- **`phone-43h-…-after-button` lands on Trade walks with no walk day.** The refusal was forced on a visit that has no day, so there is nothing to remove. `49b` shows the real state with a day.
- **The `/api/portal/selection-image/*` 404s.**

## Why the scores

**Design stays at 9.** R15-1 is fixed cleanly. So is the optional Reason box from last round. The refusal set (43g–43k) reads plainly, and each refusal lands where its button says.

One thing keeps design from 10, and it is new this round (R16-1). On a two-template visit, "This room is part of" still offers **Skip this field…**. But `144f72d9` now ignores any skip on that field. A visitor who skips it sees "Skipped" on the field, yet it stays **○ Open**, still counts in Before you wrap, and keeps the visit from closing. Nothing on screen says why. That is a dead end the page itself offers.

**Completeness stays at 9.** Most of last round's owed shots arrived:
- the 390 refusal landing;
- the Room section with "part of" at 390 and 320;
- the section-list row with "· Part of: Bathroom";
- the backsplash choice and both measure fields at 390 and 320.

Still owed, all small:
- **The range-wall pair on the keypad.** `16d` shows the field closed ("Tap to measure"), not the two-part keypad.
- **The 320 section-list row with "· Part of".** The harness unticked it before `w320-07c` (see artifacts). The 390 row wraps correctly, so this is low risk.
- **`w320-43g-note-cleared-after-sections` is the same frame as last round.** It shows the top of Closing, not the date field. I still accept the cleared note on code.

---

## R15 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R15-1 | "Take the day off" read as a day off work, under "only Joe sets it" | **FIXED** | **`phone-49b`, `w320-49b`:** the Plumber fieldset reads "⚐ Walk day Thu, Dec 10 — only Joe can set a walk day. Remove it and he'll set it from the office." Under it is a full-width 56 px **Remove the day**. The line now explains why the visitor may tap the button, so the contradiction is gone. At 320 the sentence wraps in four lines with no clipping.<br>**`phone-43h`:** the refusal reads "Only Joe can set a trade-walk day. Remove the day in Trade walks, then close again." The primary button **Trade walks** matches the place named. `words.ts:217–218`, `:619`. |
| Optional | Reason box single-line, clipped at 320 | **DONE** | **`w320-49b`:** "Look at the drain stack and the vent before pricing the new vanity location" wraps over three lines inside the box (`WrapClose.tsx:209`, `multiline`). |
| Optional | "e.g." in the "part of" hint | **DONE (reworded)** | **`phone-13b`:** "Pick the job that prices this room's floor. A hall the kitchen floor runs into is Kitchen, or Flooring if that add-on is on the visit. A bath inside a basement finish is Bathroom only." These are plain words with no "e.g.", and it is the domain judge's E1 wording. See O1 for how it sits against the checkboxes. |
| Optional | Trade walks has Close and Cancel | **Left, as advised** | No change. It stays deferred to a pass over all the sheets. |
| Re-shoot 1 | `phone-43g-…-after-button` | **ARRIVED, passes** | The visitor lands on Closing with the date field ringed. The blue note "The office couldn't read this answer — check it, then close again." sits above the label, and "✓ Covered" is now explained. The date input, **‹ Sections** and **Next ›** are in frame. |
| Re-shoot 2 | Room section on a two-template visit | **ARRIVED; see R16-1** | **`phone-13b`:** "This room is part of *", the hint, then two 56 px checkboxes, Bathroom and Kitchen (the visit's own templates, not ten).<br>**`phone-13c`:** Bathroom is ticked, the mark is "✓ Covered", and the section header becomes "Room 1 — Bath · Part of: Bathroom" with "◐ Partly".<br>**`w320-13b/13c`:** the options stack one per row, and the four-line hint wraps cleanly.<br>**`phone-07c`:** the row "Room 1 — Bath · Part of: Bathroom" wraps onto two lines in the label column. "1/13", "◐ Partly" and "›" stay on the right. That is what I asked for. |
| Re-shoot 3 | Kitchen work with "Full wall at range" | **ARRIVED, except the keypad** | **`phone-16c`, `w320-16c`:** Backsplash height = "Full wall at range" (wraps to two lines at 390 and fits on one at 320), with "✓ Covered".<br>**`phone-16d`, `w320-16d`:** "Backsplash height along the counters (to the uppers) *", then "Tile behind the range — width × height from the counter up *", whose hint says where to put the tape. Both show dashed "Tap to measure" targets and a Skip. The keypad for the pair is not shot. |
| Re-shoot 4 | Note-cleared shot with the date field in frame | **Not re-framed** | Same frame as R15. Accepted on code: `onPop`, ‹ Sections and `openSection` each clear the note. |

## New this round

- **Refusals and their landings (43g–43k), at 390:**
  - **invalid_command (43g):** names the field, offers **Go to field** and **Keep working**, then lands on the ringed field with the note.
  - **owner_required (43h):** **Trade walks** and **Keep working**. There is no "Joe has been told" line, which is right: the visitor can fix this alone.
  - **device access (43i):** one **Keep working**. It says the answers are saved and to ask Joe to move the visit, then lands on the section list.
  - **signed_out (43j):** **Sign in** and **Keep working**.
  - **unknown field (43k):** **Before you wrap**. It lands on the sheet with the blue note and "Formal estimate promised by / Thu, Nov 12 ✓" kept together.

  Every red box starts with ⚠ and has words beside it. Each primary button names a place, and each landing shows why the visitor is there.
- **Conflict footer (`45`, `45b`, both widths):**
  - "! 1 conflict to pick before you close";
  - a full-width outlined **Go to field**;
  - the greyed **Close visit — pick the conflict first**.

  The way forward reads as a button, and the disabled Close says why it is disabled. At 320 the Close label wraps to two lines inside the 56 px target. The conflict card in the list (`45`) is red-bordered, names "Access & logistics › Narrowest door or turn on that path — changed on another device", and has its own **Go to field**. Good. See O3 for contrast.
- **Backsplash:** the range-wall field now shows for both tiled choices, and its hint tells the visitor what to do for an island cooktop. Field order is in O2.

---

## Required fixes

**R16-1. "This room is part of" offers a Skip that no longer counts (required, small).**
- **State:** `phone-13b-room-part-of-empty` and `w320-13c-room-part-of-picked` (the unticked state). Both show **Skip this field…** under the Bathroom / Kitchen choices.
- **Why it is a dead end:**
  - `144f72d9` made `lib/consult/ui/model.ts:386` and `lib/consult/protocol.ts:345` drop any skip on `room.part_of` when the visit has more than one template. That is the right rule: an unclassified room zeroes its area.
  - The Skip button is still drawn (`components/consult/field/FieldRow.tsx:328`).
  - If the visitor skips, the skip is saved and the field shows "Skipped · {reason}" (`FieldRow.tsx:310`). But its mark stays **○ Open**: with `item.skip` undefined, `mark` falls to `'open'` (`model.ts:394`).
  - The room stays counted in Before you wrap, and Close stays "needs finishing". The visitor did what the page offered, and nothing says why it didn't take.
- **Change:**
  1. `lib/consult/ui/model.ts`:
     - add `noSkip?: boolean` to `FieldView` (`:56–61`);
     - set it in the view at `:398` when `m.key==='room' && f.key==='part_of' && templates.length>1`. Use the same test as `:386` and put it in one `const` so the two can't drift.
  2. `components/consult/field/FieldRow.tsx:328`: draw the Skip / Change reason button only when `!f.noSkip`. Keep the **Undo skip** button at `:329` for a skip already saved before this change, so the visitor can clear it. On that field, show "Pick at least one — every room has to belong to a job." in place of the "Skipped ·" line (`:310`). Put the string in `words.ts`.
  3. Add a test to `tests/consult-r15-design.test.mjs` or a new r16 file:
     - two-template visit → `part_of` has `noSkip` and no Skip button;
     - one-template visit → the field is hidden;
     - an existing skipped answer shows Undo skip and the new line.
- **Re-shoot:** `phone-13b` (no Skip under the choices).

## Optional extras

- **O1. The "part of" hint says one job, but the control takes several.**
  - The hint now reads "Pick the job…", "…is Kitchen, *or* Flooring…", "…Bathroom *only*". The control is still checkboxes (`shared.ts:111`, `multi`).
  - A carpenter sees checkboxes and ticks both for the hall, which is the double count the hint warns against.
  - If one job per room is the rule, make it a single choice (radio). That changes the answer shape (`derive.ts:15` reads an array; `protocol.ts:245` checks one), so the domain and engineering judges must agree first.
  - If several jobs per room stay allowed, start the hint "Tick the job that prices this room's floor — usually just one."
- **O2. Put the two backsplash measures right under the choice that opens them.**
  - "Backsplash height" is at `template-modules.ts:151`. The two measures it opens are at `:161–162`, eight fields further down, after Pantry.
  - On `16c` the visitor picks "Full wall at range" and nothing changes near the tap. The two new required fields show up a long scroll later, next to the sink photo (`16d`).
  - Move `backsplash_measured_height` and `range_wall_tile` to follow `:151` (new pins only).
- **O3. The disabled Close label is hard to read.** White on the greyed button (`45b`) is about 2:1. The line above already says the same thing, so this is not blocking. Darken the disabled label to `text-ink-2` on the muted fill so it can still be read in a bright kitchen.
- **O4. "Skip — Not applicable" in the range-wall hint** (`template-modules.ts:162`) is shorthand for two taps. Write: "Cooktop in the island? Tap Skip this field… and pick Not applicable."
- **O5. Re-shoots:**
  - the range-wall pair on the keypad (390);
  - `w320-07c` with the row ticked (shoot it before the 13c tap, or tick it back);
  - `w320-43g-note-cleared-…` scrolled to the date field;
  - `phone-43h-…-after-button` on a visit that has a walk day, so the landing shows **Remove the day** in view.
