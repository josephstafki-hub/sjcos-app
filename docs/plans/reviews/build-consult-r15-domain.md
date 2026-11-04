# Build R15: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=8

**What I read:**
- My round-14 review (`build-consult-r14-domain.md`): items 1–5 and E1–E7.
- `git show 1dc74373 6c209472 04b07e00`, in particular:
  - `db/migrations/0088_consult_r14.sql`;
  - `lib/consult/derive.ts` (`roomAllowed`, `activeTemplate`);
  - `lib/consult/protocol.ts` (pair `component_ranges`, `part_of` check, `record_rrp_delivery`, apply authorize);
  - `lib/consult/ui/model.ts` (`decisionAllowed`, `officeFlagText`, "Part of:" label);
  - `lib/consult/forms/seed/{shared,template-modules,templates,derivations}.ts`;
  - `scripts/qa-seed-consult.mjs`;
  - `tests/consult-r14-logic.test.mjs`;
  - `components/consult/office/OfficeFlags.tsx` and `app/api/consult/[id]/route.ts`.
- `approved-content.ts` and `in-home-consult-plan.md`: every Reopen and Apply findings line, the Room table (§7 `room`), the bath and kitchen feed tables, and the Round 14 note at the end.
- Screenshots in `/tmp/sjcqa/shots/consult-r15/`:
  - owner-desktop-44b and 50b, cropped and read end to end;
  - phone-07b and tabletL-20b (walk section list and Before you wrap);
  - `log.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- "Not an issue · Reviewed for QA fixture" on decided flags.
- The `phone-rrp` script timeout.

---

## Round-14 items

| # | Item | Status |
|---|---|---|
| 1 | Price each template from its own rooms | **Done in code. The plan tables are not done (Fix 3).**<ul><li>`room.part_of` "This room is part of" is required when `visit.template_count > 1` and hidden on a one-template visit. The device options are the visit's own template titles (`model.ts`), and the server refuses any other value (`invalid_room_template`).</li><li>`derive.ts` evaluates each template's feeds over only its own rooms. The bath wainscot and ceiling-height cases are filtered to Bathroom.</li><li>The test covers 40 / 168 / 43.5, floor tile 25.75, wainscot 78, and a kitchen-only visit summing 208 with the hall.</li><li>On 44b the rail reads "Room 1 — Hall bath · Part of: Bathroom" and "Room 2 — Kitchen · Part of: Kitchen". The Feeds read: bath floor tile **25.8 sf** (40 − 9 kept tub − 5.25 vanity), kitchen demo **168 sf**, kitchen flooring **168 sf**. That is right.</li><li>The walk list (phone-07b, tabletL-20b) shows Room 1 and Room 2 at 0/13, one more than before, which is the new field. No r15 shot opens a Room section, so I checked the field on screen through the test (`part.required`, in `model.open`, options `['Bathroom','Kitchen']`) rather than a picture. See E6.</li></ul> |
| 2 | Split the backsplash at the range | **Done as I asked, but what I asked for was wrong.** See Fix 1.<ul><li>The field is relabeled "Backsplash height along the counters (to the uppers)", range 4–36.</li><li>`range_wall_tile` was added for Full wall at range only.</li><li>The test proves 33 + 10.5 = 43.5.</li><li>44b shows **33 sf**, because the fixture is "To the uppers" (`qa-seed-consult.mjs:86`), so the screenshot does not show the range wall. That is fine as a fixture, but it is not the 43.5 the brief expected.</li></ul> |
| 3 | Apply findings: visitor or Joe | **Done in code. Five plan lines still disagree (Fix 2).**<ul><li>`protocol.ts` drops the `true` on the apply `authorize`. `findings.ts` notes that SQL accepts an active owner or the assigned visitor.</li><li>`consult-r14-logic` proves the assigned staff visitor and the owner can apply, and that other staff are refused with nothing written, both over HTTP and directly.</li><li>Reopen stays owner-only. The plan rows I named (187, 365, 705, 2169, 2478, 2560, 2698, 2712, 2893) now match the coordinator's decision.</li></ul> |
| 4 | Plain date in the reopened Renovate Right to-do | **Done.**<ul><li>0088 prints both dates with `to_char(...,'Mon FMDD, YYYY')`.</li><li>The test asserts `/the new start Apr 15, 2027/`.</li></ul> |
| 5 | Fixture leftovers | **Done.**<ul><li>"Exhaust fan 1 — Hall bath ceiling".</li><li>Acrylic-fiberglass tub, so no cast-iron flag.</li><li>PVC-ABS stack.</li><li>No shower window.</li><li>The 44b and 50b Flags are now exactly radon 5.2, wet wall exterior, and atmospheric backdraft. That is what a 2000 Woodbury job raises.</li></ul> |
| E2 | Pairs checked against `component_ranges` | **Done.** `protocol.ts:241` uses `component_ranges[i] ?? range`. |
| E3 | Name the range in the refused row | **Done.** The receipt carries "Outside 12–96″ — measure again" (or the component ranges for a pair). |
| E4 | Don't key radon text on its wording | **Done.**<ul><li>`officeFlagText` keys on `kind === 'advisory'`, or on a measured `FLAG_HINTS` template match.</li><li>`OfficeFlags` passes `f.kind`.</li><li>50b's radon line has **no decision line**, and the other two flags keep theirs. Correct: radon is something to tell the owner about, not a pricing decision.</li></ul> |
| E5 | Mailed delivery when the start moves earlier | **Backend done, nothing on screen yet (E2 below).**<ul><li>0088 adds `rrp_delivery_method` and `rrp_delivered_on`, and reopens a mailed delivery whose mail day is after `start − 7`.</li><li>The test proves mail reopens and hand doesn't.</li><li>`record_rrp_delivery` is on the route, but no screen calls it. A to-do ticked done in Today leaves the method NULL, so the margin check never fires on a real job.</li></ul> |
| E1, E6, E7 | Carried | Still open. All optional. |

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes. Every number the estimate needs is captured, and with Fix 1 every feed is right.**
- **Rooms now feed only their own job.** A real 5 × 8 ft hall bath beside a 12 × 14 ft kitchen gives:
  - about 26 sf of bath floor tile;
  - 168 sf of kitchen demo and flooring.
- **Bath:**
  - toilet rough-in and the 24″ front / 15″ side clearances;
  - shower drain;
  - vanity wall and width;
  - wet wall exterior;
  - floor heat;
  - tile height.
- **Kitchen:**
  - 1/16″ wall runs;
  - appliance cutouts and power;
  - hood route;
  - gas;
  - countertop circuits;
  - soffits;
  - measured backsplash height;
  - range wall.
- **One quantity is still low:** the backsplash, by the strip behind the range (Fix 1). Without that fix, the tile sub's number and ours won't match.

## Minnesota checks

- **Frost (Minn. R. 1303.1600):** unchanged and right. Zone I is 60″, Zone II 42″, and the city's figure can be edited.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)):** one-party consent. Settled and unchanged.
- **Plumbing (Minn. R. 4714):** toilet 24″ front and 15″ side clearance lines unchanged and right. The fixture's 30″ and 16″ correctly raise nothing.
- **RRP (40 CFR 745):**
  - §745.84(a)(1): the 60-day window holds when the start moves. Mail-by is `start − 14`.
  - §745.84(a)(1)(ii): a mailing must go out at least 7 days before work. 0088 reopens a mailed delivery when the start moves inside that, once the method is recorded.
  - Every title says "get the owner's initials, or mail it with a certificate of mailing at least 7 days before work starts". That is accurate.
  - §745.89 firm and §745.90 renovator lines unchanged. The "certification runs out before the planned finish" card on tabletL-20b is right and plain.
- **MDH radon:** 4 pCi/L, worded "where the Minnesota Department of Health says to fix it", with no decision line. Right.
- **Woodbury:** City for building, plumbing and electrical. Unchanged and right.

## Plain contractor wording

- **Office flags (50b):**
  - "Radon is 5.2 pCi/L — at or over the 4 pCi/L level where the Minnesota Department of Health says to fix it. Mention mitigation, and don't seal the sump or slab in a way that blocks a future system";
  - "Pipes in an outside wall can freeze — they may need moving or insulating";
  - "Fumes could spill back into the house — the HVAC sub checks before we price".

  All plain.
- **Trade walks:** "Plumber: walk-through needed · Confirm shower drain and sink connections". Good.
- **"This room is part of" hint:** plain. E1 covers one case it gets wrong.
- **The reopened to-do body:** "Given before on Jan 20, 2027; the new start Apr 15, 2027 falls outside the delivery window." Fine. E5 has a plainer version.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

There are no new client-facing lines this round. The six "Changed since approval" lines are unchanged and still plain.

---

## Required fixes (numbered)

1. **Backsplash: count the tile behind the range. My round-14 formula was wrong.**
   - **Files:**
     - `lib/consult/forms/seed/template-modules.ts:162` (`range_wall_tile`);
     - `lib/consult/forms/seed/templates.ts:117` (`backsplash_area`) and `:246` (`planFormulas['kitchen.backsplash_area']`, which still says "− windows over counters");
     - plan rows 1270 and 1300, and the matching `approved-content.ts` rows (~413 and 443);
     - the plan's Round 14 note (line 2922);
     - `tests/consult-r14-logic.test.mjs`.
   - **Why:**
     - `kitchen_wall.base_run` is "Base cabinet run (new)". It excludes the range opening, which is right for cabinet lf and countertop sf.
     - So `base_run × counter height` never covers the wall behind the range.
     - Subtracting the counter height from the range wall, as I asked in R14, makes it worse. On the test kitchen, 36 × 60 is a 15 sf range wall, and only 10.5 sf is counted.
     - With "To the uppers", the strip behind the range (about 30″ × 18″ ≈ 3.75 sf) is not counted at all.
   - **Change:**
     - Make `range_wall_tile` apply to both tiled choices: `isIn('backsplash_height', ['To the uppers','Full wall at range'])`.
     - Label: "Tile behind the range — width × height from the counter up".
     - Hint: "The range isn't in the cabinet run. Measure the tile behind it, counter to the hood (or ceiling for a full wall). Cooktop in the island? Skip — Not applicable."
     - Formula: `kitchen_wall.base_run * kitchen_scope.backsplash_height_in / 144 + kitchen_scope.range_wall_tile.w * kitchen_scope.range_wall_tile.h / 144`, with no subtraction.
     - Plan and approved-content row: "Σ base run × counter height ÷ 144 + range wall W × H ÷ 144".
   - **Test:**
     - base run 264″, counters 18″, Full wall at range, 36 × 60 → 33 + 15 = **48 sf**;
     - To the uppers, 30 × 18 behind the range → 33 + 3.75 = **36.75 sf**;
     - 4″ → 7.33 sf with no range term.

2. **Plan: make every Reopen and Apply findings line match the coordinator's decision.** That decision is: Apply is for the assigned visitor or Joe; no other staff; Reopen is Joe only. File: `docs/plans/in-home-consult-plan.md`.
   - **Line 2095–2096:** "**Reopen** — by Joe or the assigned visitor, with a reason …" → "**Reopen** — by Joe, with a reason …".
   - **Line 2503–2504:** "a deliberate Reopen (Joe or the assigned visitor)" → "a deliberate Reopen (Joe)".
   - **Line 2591** (`POST /api/consult/[id]/actions`): "Joe or the assigned visitor, except `delete_transcript` (owner only)" → "Joe or the assigned visitor, except `reopen` and `delete_transcript` (owner only)".
   - **Line 2668:** "pick its conflicts, Reopen it with a reason, keep/dismiss …" → "pick its conflicts, tap Apply findings while automatic apply is off, keep/dismiss …". Then add: "Reopen is Joe's."
   - **Line 2916:** "Round 13 implementation: reopening and applying findings require Joe's owner authorization." → "Round 13–14: Reopen requires Joe; Apply findings (while automatic apply is off) is the assigned visitor or Joe; other staff are refused."

3. **Plan and approved content: put the round-14 fields in the form tables, not only in a note.**
   - **Files:** `docs/plans/in-home-consult-plan.md` and `lib/consult/forms/approved-content.ts`.
   - **Change:**
     - **§7 `room` table (after the Room name row, ~968):** add `| This room is part of | multi: the visit's templates | R when the visit has more than one template; hidden otherwise | each template's feeds use only its rooms; hint "Pick every job this room's floor or walls belong to …" |`.
     - **`visit` module table:** add `Number of templates | number | server-filled, never asked`.
     - **Kitchen table (after row 1270):** add the `range_wall_tile` row from Fix 1.
     - **Bath feed rows 1226–1227, kitchen row 1297, and `planFormulas` `bath.*` / `kitchen.*` room rows (`templates.ts:239–243`):** "room.length × room.width ÷ 144" → "Σ length × width ÷ 144 of the rooms marked part of this job (every room on a one-template visit)".
     - **The orphan "Server context: …" line at 2924:** delete it once the rows above exist.

---

## Optional extras

- **E1. "This room is part of" hint, for overlapping jobs.**
  - **Basement finish + Bathroom:** a bath inside the basement ticked as both counts its floor twice, once as basement flooring and once as bath tile. The basement ceiling drywall uses `room.floor_area` too.
  - **Kitchen + Flooring add-on:** the hint's example ("a hall the kitchen floor runs into is Kitchen") points the wrong way.
  - **Suggested hint:** "Pick the job that prices this room's floor. A hall the kitchen floor runs into is Kitchen, or Flooring if that add-on is on the visit. A bath inside a basement finish is Bathroom only."
- **E2. Put Renovate Right delivery on screen.**
  - When the RRP to-do is marked done, ask "Hand-delivered (initials) / Mailed (certificate of mailing)" and the day, then call `record_rrp_delivery`.
  - Without this, `rrp_delivery_method` stays NULL on every real job, and the 0088 mail-margin reopen never runs.
- **E3. Fixture realism for the kept tub.**
  - The bath keeps a **36 × 36** tub (`existing_length` / `existing_width` fall to 36) in a 5 × 8 ft room that also has a "Fixture 3 — Shower".
  - Use 60 × 30 and drop the separate shower fixture. Floor tile becomes 40 − 12.5 − 5.25 = **22.25 sf**, and tub wall tile (2 × 30 + 60) × 60 ÷ 144 = **50 sf**.
  - Also set one fixture kitchen to "Full wall at range", so 44b shows the range wall.
- **E4. Room filter beyond the bath.**
  - Outside template feeds, `derive.ts` only maps `bath_scope` to Bathroom. `basement_scope.drywall_ceiling_area` shown on a field sums every room. The feed itself is right, because `activeTemplate` is set there.
  - Map each scope module to its template (`kitchen_scope → kitchen`, `basement_scope → basement`, …).
  - Separately, `room.ceiling_height` for "To ceiling" bath tile sums heights when a one-template bath visit has two rooms. Take the bath room's value, or the max, instead of the sum.
- **E5. Plainer reopened to-do body.** Say which rule broke:
  - "Given on Jan 20, 2027 — more than 60 days before the new start, Apr 15, 2027."
  - "Mailed Jan 2, 2027 — less than 7 days before the new start, Jan 5, 2027."
- **E6. Shoot one Room section on the walk.** For example "Room 1 — Bath" on phone and tabletL, so "This room is part of", its hint and the Bathroom / Kitchen choices are on screen.
- **E7. Carried:**
  - R14 E1: show the close-failure to-do row on owner-desktop-51.
  - R14 E6: "Take the day off" and the skipped-date close on screen.
  - R6:
    - bath fixtures listed with their bath;
    - sink-base "soft, stained or wet?";
    - a `flooring.worst_dip` hint for large-format tile;
    - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
