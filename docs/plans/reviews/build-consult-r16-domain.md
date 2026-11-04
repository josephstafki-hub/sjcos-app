SCORES: design=9 completeness=8

# Build R16: Contractor / Minnesota domain judge (in-home consult)

**What I read:**
- My round-15 review (`build-consult-r15-domain.md`): Fixes 1–3 and E1–E7.
- `git show c3a8d56a 144f72d9`:
  - `derive.ts` (`membership`, `scopeTemplate`, max ceiling height);
  - `seed/template-modules.ts`, `seed/templates.ts`, `seed/shared.ts`, `seed/derivations.ts`;
  - the plan and `approved-content.ts` rows;
  - `qa-seed-consult.mjs`;
  - `tests/consult-r14-logic.test.mjs` and `tests/consult-r15-logic.test.mjs`.
- `lib/consult/rrp.ts`, `lib/consult/trades.ts` and `seed/flag-hints.ts`.
- Plan §7 kitchen and era tables.
- Screenshots in `/tmp/sjcqa/shots/consult-r16/`:
  - 13b/13c, 16c/16d, 17a/17b/17bc/17gg, 18b, 20b (cropped), 24b and 49b;
  - owner-desktop-44b, cropped and read end to end.

**What I ran:** a scratch Node script (no DB, no server) that calls `pinnedDerivations` on the seed kitchen. It is not committed. No builds, browsers or tests.

**Ignored:** the `FAIL-*` harness shots, and "Not an issue · Reviewed for QA fixture" on the decided flags.

---

## Verified fixes (round 15)

| # | Item | Status |
|---|---|---|
| 1 | Count the tile behind the range | **Done. The numbers are right.**<ul><li>`range_wall_tile` now applies to both tiled choices. Its label is "Tile behind the range — width × height from the counter up", and the hint is the one I gave.</li><li>The formula is `base_run × backsplash_height_in / 144 + range_wall_tile.w × range_wall_tile.h / 144`, with no subtraction.</li><li>I checked it on the test kitchen (two walls of 132″ = 264″ base run, 18″ to the uppers):<ul><li>Full wall at range, 36 × 60: 264 × 18 / 144 = 33, plus 36 × 60 / 144 = 15, gives **48 sf**. My script agrees, and 44b's Feeds show "Backsplash tile · Backsplash area **48 sf**".</li><li>To the uppers, 30 × 18 behind the range: 33 + 3.75 = **36.75 sf**. The script agrees.</li><li>4″: 264 × 4 / 144 = **7.33 sf**, with no range term. The script gives 7.3334 because it rounds per wall. That is immaterial.</li></ul></li><li>16c and 16d show "Full wall at range" picked, then both measured fields: "Backsplash height along the counters (to the uppers)" and "Tile behind the range …" with the plain hint.</li><li>The plan (1279, 1309), `approved-content.ts` (422, 452) and `planFormulas` all read "Σ base run × counter height ÷ 144 + range wall W × H ÷ 144". The old "− windows over counters" text is gone.</li></ul> |
| 2 | Plan Reopen / Apply findings lines | **Done.** Lines 2101, 2508, 2595, 2672 and the Round 13–14 note now say: Reopen is Joe's; Apply findings is the assigned visitor or Joe. |
| 3 | Round-14 fields in the form tables | **Done.**<ul><li>The Visit module table has "Number of templates".</li><li>The `room` table has the "This room is part of" row.</li><li>The kitchen table has the range-tile row.</li><li>The bath and kitchen floor-area rows say "Σ … of the rooms marked part of this job".</li><li>`planFormulas` matches.</li><li>The orphan "Server context" line is deleted.</li></ul> |
| E1 | "This room is part of" hint | **Done.** 13b/13c show "Pick the job that prices this room's floor. A hall the kitchen floor runs into is Kitchen, or Flooring if that add-on is on the visit. A bath inside a basement finish is Bathroom only." The options are Bathroom / Kitchen, and the rail updates to "Room 1 — Bath · Part of: Bathroom". |
| E3 | Fixture kept tub | **Mostly done.**<ul><li>The tub is 60 × 30. 44b reads floor tile **22.3 sf** (40 − 12.5 − 5.25 = 22.25) and wall tile **50 sf** ((2 × 30 + 60) × 60 / 144).</li><li>The kitchen is Full wall at range.</li><li>"Fixture 3 — Shower" is still a separate fixture beside a kept tub (E4 below).</li></ul> |
| E4 | Room filter beyond the bath | **Done.**<ul><li>`scopeTemplate()` maps every `*_scope` module to its template.</li><li>`room.ceiling_height` now takes the max. The test proves 96″ / 108″ rooms give 90 sf, not a summed height.</li><li>Legacy pins without `part_of` keep every room (140 / 140).</li></ul> |
| E6 | Shoot a Room section | **Done** (13b/13c on phone and w320). |
| E2 | Renovate Right delivery method on screen | **Still open.** `record_rrp_delivery` is only on the route; no component calls it. Carried as optional. |
| E5, E7 | Plainer reopened to-do; carried R6 items | Still open. Optional. |

### The test kitchen and bath, end to end (44b)

| Feed | Shown | Worked | OK |
|---|---|---|---|
| Bath floor tile | 22.3 sf | 5 × 8 = 40 − 60 × 30 tub (12.5) − 36 × 21 vanity (5.25) = 22.25 | ✓ |
| Bath wall tile (kept tub, 60″ tile) | 50 sf | (60 + 60) × 60 / 144 | ✓ |
| Kitchen demo / flooring | 168 / 168 sf | 12 × 14 | ✓ |
| Cabinet run | 22 lf | 264 / 12 + kept island **0** | see Fix 2 |
| Countertop area | 46.8 sf | 264 × 25.5 / 144 = 46.75 + kept island **0** | **low, Fix 2** |
| Backsplash | 48 sf | 33 + 15 | ✓ |

The fixture's island is **Keep** (`qa-seed-consult.mjs` picks "Keep" for any choice that offers it). So the test kitchen's countertop number has no island top in it. That is Fix 2.

---

## Minnesota and code checks (unchanged and right)

- **RRP (40 CFR 745):**
  - The era section prefills "No · From Year built (1985)" and collapses to one field (17a). On Yes it opens the renovator, firm, kids, 6 sf / 20 sf, pamphlet and initials fields (17bc).
  - The renovator-expiry card is right: "runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027 …".
  - The firm tail is right: "Apply at least 90 days before it runs out" (§745.89(c)).
  - The re-deliver sheet (17gg) limits the day to 60–7 days before the start. That is conservative for hand delivery and correct for mail (§745.84(a)(1)(ii)).
  - Window replacement is never minor repair (§745.83). Its flag is unchanged.
- **Asbestos:** asked when Year built ≤ 1980. That matches OSHA's presumed-asbestos cutoff (29 CFR 1926.1101, "constructed no later than 1980"). The MDH and counsel caveat stays on the flag.
- **Radon (MDH 4 pCi/L)**, **toilet 24″ / 15″ (Minn. R. 4714)**, **egress (R310: 5.7 / 5.0 sf, 44″ sill, ladder at > 44″ well)**, **CO within 10 ft (299F.51)**, and **Woodbury City electrical:** unchanged and right.
- **Trade walks (49b, 44b):**
  - "Walk day Thu, Dec 10 — only Joe can set a walk day. Remove it and he'll set it from the office." The "Remove the day" button and the multi-line Reason box both work.
  - Plumber, Electrician and HVAC each have a one-line reason a sub can act on.
- **Closing (18b, 24b):** the script reads plainly. The client recap "Still to decide" lists five items per job, then "and 10 more — listed on your estimate". "It is not a contract or a price." No client-facing wording changed this round.

---

## Required fixes

### 1. A cooktop in the island empties the whole backsplash number

- **Files:**
  - `lib/consult/forms/seed/template-modules.ts:162` (`range_wall_tile`);
  - the same module, beside `backsplash_height` (`:151`);
  - plan row 1279 and `approved-content.ts:422`.
- **What happens:** the hint tells the visitor "Cooktop in the island? Skip — Not applicable." But `derive.ts` `field()` returns zero only when the field's condition is false. A **skipped** field whose condition is true returns `null`, and `formula()` then returns `null` for the whole expression.
  - I checked it on the seed kitchen: To the uppers, 264″ run, 18″ height, `range_wall_tile` skipped "Not applicable" → `backsplash_area` = **null**.
  - The answer should be **33 sf**.
  - Every island-cooktop kitchen, which is common in Twin Cities remodels, sends Joe no backsplash quantity at all.
- **Change:** make "no range on a wall" a false condition, not a skip.
  - Add, after `backsplash_height`:
    `yesno('range_on_wall', 'Range or cooktop on a wall (not in the island)?', isIn('backsplash_height',['To the uppers','Full wall at range']))`
  - Make `range_wall_tile` required only when `all(isIn('backsplash_height',['To the uppers','Full wall at range']), eq('range_on_wall', true))`.
  - Drop "Cooktop in the island? Skip — Not applicable." from its hint. The hint becomes: "The range isn't in the cabinet run. Measure the tile behind it, counter to the hood (or ceiling for a full wall)."
  - Add the new row and the changed condition to plan 1279 and `approved-content.ts:422`. These are internal visitor rows, not counsel-approved client lines.
- **Test** (`tests/consult-r15-logic.test.mjs`): To the uppers, 264 / 18, `range_on_wall: false` → **33 sf**. The three existing cases (48 / 36.75 / 7.33) still pass with `range_on_wall: true`.

### 2. A kept island gets no countertop, and its size is never asked

- **Files:**
  - `lib/consult/forms/seed/template-modules.ts:143–144` (`island_length`, `island_depth`, required only for `eq('island','New')`);
  - `lib/consult/forms/seed/derivations.ts:61–66` (`island_run` and `island_top_area`, which are `0` for any other answer);
  - plan row 1273 and `approved-content.ts:416` ("Island size … R? New").
- **Why:**
  - "Keep" means the island stays in the layout. On a kitchen remodel it still gets the new countertop.
  - It also gets the same cabinet work as the rest of the kitchen (replaced, refaced or painted) unless the cabinets are "Some new".
  - Today a kept 72 × 36 island adds **0** to countertops. The right figure is 18 sf, about $1,300–1,800 of quartz.
  - The test kitchen shows it: the fixture island is Keep, and 44b's countertop is 46.8 sf, base run only.
- **Change:**
  - `island_length` and `island_depth`: required for `isIn('island',['Keep','New'])`.
  - `island_top_area`: `{ when: isIn('island',['Keep','New']), formula: 'island_length * island_depth / 144' }`, then `answered('island') → 0`.
  - `island_run`, in this order:
    - `{ when: eq('island','New'), formula: 'island_length' }`;
    - `{ when: all(eq('island','Keep'), isIn('cabinets',['Replace all','Reface','Paint'])), formula: 'island_length' }`;
    - `answered('island') → 0`.
  - Plan row 1273 and `approved-content.ts:416`: "R? Keep or New". In the Countertop area and Cabinet run rows, change "island" to "island (Keep or New; cabinet run only when the island's cabinets are replaced, refaced or painted)".
- **Test:** Keep island 72 × 36, cabinets Replace all, 264″ run:
  - countertop 46.75 + 18 = **64.75 sf**;
  - cabinet run 22 + 6 = **28 lf**;
  - the same island with cabinets "Some new" → run 22 lf, top still 64.75 sf.

### 3. "Lead: plan — Not needed" on a job where lead-safe rules apply raises nothing

- **Files:**
  - `lib/consult/forms/seed/shared.ts:425` (`lead_plan`);
  - `lib/consult/forms/seed/flag-hints.ts` (beside `'era.asbestos'`, line 39).
- **Why:**
  - `lead_plan` is asked on every pre-1978 house, and "Not needed" is right when the work disturbs ≤ 6 sf a room.
  - But nothing stops "Not needed" when `rrpApplies` is true: more than 6 sf, or window replacement.
  - Under §745.82(a), skipping lead-safe practices needs a written finding that the parts are lead-free: a certified renovator's EPA-recognized test kit or paint-chip sample, or a licensed inspector or risk assessor. Nobody has tested anything at a consult.
  - So "Not needed" there makes the estimate leave out containment, poly, HEPA cleanup and cleaning verification. On a kitchen tear-out in a 1950s rambler that is about a day of labor plus materials.
- **Change:**
  - Add a flag to `lead_plan`: `{ when: all(rrpApplies, eq('lead_plan','Not needed')), issue: 'RRP applies (pre-1978, >6 sf or windows) but lead plan is "Not needed" — price lead-safe work unless a certified renovator\'s test or a lab result shows no lead (40 CFR 745.82(a))' }`.
  - Add the visitor hint `'era.lead_plan': 'This job disturbs paint in a pre-1978 house — plan on lead-safe work unless a test shows no lead.'`. `consult-hints.test.mjs` requires a hint for every flag.
  - Import `rrpApplies` into `shared.ts` next to `rrpBefore`.
- **Test:** pre-1978, `disturbs_paint: true`, `lead_plan: 'Not needed'` → flag raised. With `disturbs_paint: false` → no flag.

---

## Optional extras

- **E1. Countertop corner overlap.**
  - `base_run × 25.5` on two walls that meet counts the 25.5 × 25.5 corner square twice, about **4.5 sf per inside corner**. If the test kitchen is an L, 46.75 is really about 42.25.
  - Cabinet lf along the wall is normal practice. Countertop sf is not.
  - Either add `kitchen_wall.inside_corners` (count) and subtract `corners × 25.5 × 25.5 / 144`, or say "includes corner overlap" in the Countertop row so Joe knows the number runs high.
- **E2. The window over the sink.** The old "− windows over counters" is gone. A 36″ window with its sill 12″ above an 18″ backsplash adds about 3 sf of tile that isn't there. Tile waste covers it. An optional `window_over_counter` W × (sill height above counter) per wall would make it exact.
- **E3. Built after 1977 but answered Yes to pre-1978** (17a → 17b: Year built 1985, answer Yes). That is conservative and fine. A one-line optional "Why? (older part of the house, records disagree)" would help Joe trust the year.
- **E4. Fixture.** Drop "Fixture 3 — Shower" beside the kept 60 × 30 tub, or make the bath "Tub → shower". Otherwise the look-over lists shower glass and a shower fixture on a tub-surround job.
- **E5. Skip offered on "This room is part of"** (13b). The server refuses a skip as completion on a multi-template visit, so "Skip this field…" there only leads to a refusal. Hide it on that field when `template_count > 1`.
- **E6. New egress trade.** When `egress.result` is "New egress needed", add "Concrete cutting / excavation" to `touchedTrades` (`lib/consult/trades.ts`). A foundation cut and a new well are a separate sub, and in block walls they often need a header detail.
- **E7. Carried:**
  - R15 E2: Renovate Right delivery method on screen, calling `record_rrp_delivery`.
  - R15 E5: plainer reopened to-do body.
  - R14 E1 / E6 and the R6 list: bath fixtures listed with their bath; sink-base "soft, stained or wet?"; a `flooring.worst_dip` hint for large-format tile; the printed name and date with the Renovate Right initials, kept 3 years (§745.86, for counsel).

Score 10 needs Fixes 1–3. Each is a quantity or a lead-safe cost that would otherwise go to Joe wrong or missing.
