# Build R14: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=8 completeness=8

**What I read:**
- My round-13 review (`build-consult-r13-domain.md`): items 1–3 and E1, E2, E4.
- `git show 377a8705 a47fb7cd`, in particular:
  - `db/migrations/0087_consult_rrp_margin.sql`;
  - `lib/consult/{close-errors,protocol}.ts`;
  - `lib/consult/forms/{flags,validate}.ts`;
  - `lib/consult/ui/model.ts`;
  - `scripts/qa-seed-consult.mjs`;
  - `tests/consult-r12-logic.test.mjs` and `tests/consult-r13-logic.test.mjs`.
- Seed forms:
  - `lib/consult/forms/seed/shared.ts`: house, room, water, hvac_vent and `permit_electrical`;
  - `template-modules.ts`: bath_scope and kitchen_scope;
  - `templates.ts`: the bath and kitchen derived feeds;
  - `derivations.ts` and `flag-hints.ts`.
- `lib/consult/derive.ts`, to see how template feeds resolve `room.*`.
- `approved-content.ts` and `in-home-consult-plan.md`, both the changed rows and every "Apply findings" line.
- Screenshots in `/tmp/sjcqa/shots/consult-r14/`:
  - owner-desktop-44 and 44b, cropped and read end to end: rail, House & household, Feeds, Flags, Trade walks;
  - owner-desktop-50b and 51;
  - phone-40 (staff and as Joe);
  - phone-43g, 43h, 43i, 43j, 43k, plus the after-button shots;
  - `log.json`, including the `close-failure todos` row and the harness failures.
- One web check: Woodbury's Building Inspections pages list a city electrical inspections contact.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- Every flag decided "Not an issue · Reviewed for QA fixture".
- The script-side timeouts in `log.json`:
  - `phone-rrp`;
  - `tabletL-date-client`;
  - `phone-conflict-close` and `w320-conflict-close`, where Close is disabled on purpose for an open conflict.
- The 404 selection images.

---

## Round-13 items

| # | Item | Status |
|---|---|---|
| 1 | Radon advisory names the level; it lives in the seed | **Done.**<ul><li>`house.radon_level` carries `{kind:'advisory', when: gt(3.99)}`. `FLAG_HINTS['house.radon_level']` has the measured hint, and `forms/flags.ts` fills `{value}`.</li><li>The hard-coded push in `buildModel` is gone.</li><li>The plan and approved-content rows carry "⚑ ≥ 4 pCi/L: advisory — mention mitigation (MDH)".</li><li>The test covers 4 → "Radon is 4 pCi/L" and 3.9 → no flag.</li><li>On 44b the office reads: "⚐ Radon is 5.2 pCi/L — at or over the 4 pCi/L level where the Minnesota Department of Health says to fix it. Mention mitigation, and don't seal the sump or slab in a way that blocks a future system". That is accurate, plain and useful.</li></ul> |
| 2 | Coherent Complete fixture | **Mostly done.** These are now right:<ul><li>HOA No / None known;</li><li>Pets Dog, crated in the basement;</li><li>rough-in 12″, side 16″;</li><li>vanity 36″ on a 48″ wall;</li><li>200 A;</li><li>bearing Likely not;</li><li>radon 5.2;</li><li>60 psi;</li><li>30 named selections (Cabinets … Heated floor thermostat);</li><li>short real answers ("Fix the squeaky hall floor", "Spouse — here today", "No work before 7; weekdays only");</li><li>22 lf of cabinets, 46.8 sf of tops and 33 sf of backsplash, which check against 264″ × 25.5″ and 264″ × 18″.</li></ul>Reading it as a real walk exposed a pricing bug the old numbers hid: see Fix 1. Small fixture leftovers are in Fix 5. |
| 3 | Mailing margin on re-delivery (40 CFR 745.84(a)(1)) | **Done.**<ul><li>0087 puts the reopen, the open `:rrp:delivery` and the redelivery fallback on `start − 14`. The close-time `start − 7` to-do (`protocol.ts:385`) is pulled to `start − 14` by the `consult_reconcile_rrp` call at `protocol.ts:394`.</li><li>A picked day between `start − 60` and `start − 7` still wins.</li><li>The title now says "at least 7 days before work starts".</li><li>The body keeps "Given before on Jan 20, 2027". The new start in the same sentence is printed as an ISO date (Fix 4).</li></ul> |
| E1 | invalid_command office line | **Done.** `log.json`: "Abigail Stafki's visit for Tom Tierney hasn't closed — the app couldn't read their wrap-up answers; they need to check Before you wrap and close again." The other office lines now say "the app", or "you changed it" for conflict. The device still says "The office couldn't read …" (43g, 43k). That is right from the visitor's side. owner-desktop-51 still doesn't show the row (it sits under The rest). Not blocking. |
| E2 | Server range check | **Done.**<ul><li>`protocol.ts:241` refuses out-of-range number, count, year, length and length_pair answers with `details.fields`, and the test proves nothing is stored.</li><li>The device row shows "This answer couldn't be saved in the office. Check it and enter it again." on the field.</li><li>A small gap: the server checks length pairs against the envelope `range`, not `component_ranges`. See E2 below.</li></ul> |
| E4 | Woodbury electrical | **Done: City is right.** Woodbury's Building Inspections division lists its own electrical inspections contact, and DLI does not take permits in cities with local electrical inspection authority. The `permit_electrical` hint ("Most cities use the state (DLI) … A few, like Minneapolis and St. Paul, inspect their own. Not sure? … Joe checks") is accurate. |

Changes I checked in 377a8705 and a47fb7cd:
- **Owner-only Reopen: right.**
  - `consult_reopen` checks `role='owner'` in SQL and `authorize(...,'reopen',true)` in the app.
  - The staff Complete screen (phone-40) reads "Answers are locked. Joe can reopen it from the office look-over." with no Reopen.
  - Joe's look-over has Reopen.
- **Owner-only Apply findings: not asked for, and it conflicts with the plan and a settled decision.** See Fix 3.
- **Refusal screens (43g–k): plain and right.**
  - Each says what happened and the one next step.
  - "Joe has been told this visit hasn't closed" appears only on refusals Joe must know about. It is absent on 43h, owner_required, which the visitor can fix.
  - 43k-after opens Before you wrap with "The office couldn't read these answers — check them, then close again."
- **Complete heading:** "✓ Complete", with "Closed Nov 3, 7:46 pm" on its own line. Clean.

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Every measurement needed is captured, so no return trip is needed. But two feeds hand the estimate wrong quantities.**

**What the walk captures:**
- The kitchen:
  - 1/16″ wall runs;
  - appliance cutouts and power;
  - the hood route;
  - gas;
  - countertop circuits;
  - soffits;
  - the backsplash height, now measured and closing the old gap.
- The bath:
  - toilet rough-in and clearances;
  - shower drain;
  - vanity wall and width;
  - wet wall exterior;
  - floor heat.
- Each room's length and width is on the form.

**Feed 1: room areas are summed across both templates (Fix 1).**
- Template feeds are evaluated with no instance (`derive.ts:83`, `formula(d.formula)`), so `room.floor_area` sums every Room on the visit.
- On a Bath + Kitchen visit:
  - the bath's floor tile is 240 − 9 (kept tub) − 5.25 (vanity) = 225.8 sf. That is the 225.8 on 44b, and it includes the whole kitchen floor;
  - kitchen demo and kitchen flooring are 240 sf, which includes the hall bath.
- Both feed into the scope register on Apply findings.
- The fixture's identical 12 × 10 ft rooms hid this. A real 5 × 8 ft hall bath next to a 12 × 14 ft kitchen would show a 200 sf hall bath floor.

**Feed 2: "Full wall at range" over-counts the backsplash (Fix 2).**
- The new measured height multiplies the whole base run.
- 22 lf × a 60″ range-wall height comes to 110 sf. The real figure is about 33 sf along the counters plus about 10 sf behind the range.

## Minnesota checks

- **Frost (Minn. R. 1303.1600):** unchanged and right. Zone I is 60″, Zone II 42″, and the city's figure can be edited.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)):** one-party consent. Settled and unchanged.
- **Plumbing (Minn. R. 4714):** the 24″ front and 15″ side toilet lines are unchanged and right. The fixture's 30″ and 16″ correctly raise nothing.
- **RRP (40 CFR 745):**
  - §745.84(a)(1): the 60-day window holds on a slip. Mail-by has 7 days of slack (start − 14), and mailing at least 7 days before the start is stated in every title.
  - §745.89 firm and §745.90(a)(3) renovator lines: unchanged and right.
- **MDH radon:** 4 pCi/L is the right threshold, and the hint's "says to fix it" matches MDH ("fix the home at 4 pCi/L or more"). 5.2 is a believable Woodbury basement number.
- **Woodbury inspection call:** City for building, plumbing and electrical is right.

## Plain contractor wording

Office flags on 44b and 50b read as sentences:
- "A cast-iron tub takes two people to remove or break up";
- "Pipes in an outside wall can freeze — they may need moving or insulating";
- "A window in the shower needs tempered glass and a waterproof detail";
- "Old or cracked drain stack — the plumber looks before we price";
- "Fumes could spill back into the house — the HVAC sub checks before we price".

Trade walks read: "Plumber: walk-through needed · Confirm shower drain and sink connections". Good.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

There are no new client-facing lines this round. The six lines under "Changed since approval" are unchanged and still plain.

---

## Required fixes (numbered)

1. **Price each template from its own rooms on a combined visit.**
   - **Files:**
     - `lib/consult/derive.ts:83` (template feeds call `formula(d.formula)` with no instance, so `room.*` sums every Room);
     - `lib/consult/forms/seed/shared.ts:107` (`room` module);
     - `lib/consult/forms/seed/templates.ts:96–97, 113–114` (bath `floor_tile_area`, kitchen `room_floor_area` and `floor_area`);
     - `lib/consult/forms/seed/derivations.ts:51` (bath wainscot `room.perimeter`);
     - the Room dimensions table and the bath/kitchen feed tables in `in-home-consult-plan.md` and `approved-content.ts`;
     - a new test.
   - **Change:**
     - Add `multi('part_of', 'This room is part of', <the visit's template titles>, <required only when the visit has more than one template>)` to `room`, with the hint "Pick every job this room's floor or walls belong to — e.g. a hall the kitchen floor runs into is Kitchen."
     - When a visit has one template, hide the field and keep today's behavior: every room counts.
     - In `derive.ts`, evaluate each template's derived feeds over only the `room` instances whose `part_of` includes that template. Apply the same filter to `room.perimeter` in the bath wainscot case.
     - Show "Part of: Bath" or "Part of: Kitchen" in the Room section header on the device and the look-over, so Joe can see which job each room feeds.
   - **Fixture:** room 1 Hall bath 60 × 96 (`part_of` Bath), room 2 Kitchen 144 × 168 (`part_of` Kitchen).
   - **Test:**
     - On that merged visit, bath floor tile = 40 − kept tub − vanity, and kitchen demo = kitchen flooring = 168 sf;
     - a Kitchen-only visit with an adjoining hall still sums both rooms;
     - a combined visit with a room missing `part_of` stays Needs finishing on that field.
   - **Then:** retake 44b. The Feeds should read about 26 sf of bath floor tile and 168 sf of kitchen demo and flooring.

2. **Split the backsplash when it runs full height at the range.**
   - **Files:**
     - `lib/consult/forms/seed/template-modules.ts:151, 161`;
     - `derivations.ts:57–60`;
     - `templates.ts:117` (`backsplash_area`);
     - plan row 1270 and the approved-content row;
     - a test.
   - **Change:**
     - Relabel `backsplash_measured_height` to "Backsplash height along the counters (to the uppers)" and give it `range: [4, 36]`.
     - Add `pair('range_wall_tile', 'Range wall tile — width × height above the counter', eq('backsplash_height','Full wall at range'), { range: [12, 96] })` with the hint "Measure the tiled area behind the range, counter to hood or ceiling."
     - Set `backsplash_area` = `base_run × backsplash_height_in ÷ 144` plus, for Full wall at range only, `range_wall_tile.w × (range_wall_tile.h − backsplash_height_in) ÷ 144`.
   - **Test:** base run 264″, counters 18″, range wall 36 × 60 → 33 + 10.5 = 43.5 sf, not 110.

3. **Apply findings: keep the visitor-or-Joe rule the plan states, or change every line that says otherwise.**
   - **Files:**
     - `lib/consult/protocol.ts:491` (`authorize(...,'apply',true)`);
     - `tests/consult-r13-logic.test.mjs` ("staff cannot apply findings");
     - plan line 2478.
   - **Problem:**
     - Plan lines 187, 365, 2169, 2698, 2712 and 2893 all say "the visitor or Joe taps Apply findings". Only line 2478 and the code now say Joe only.
     - The pilot starts with automatic apply switched off, so under the new rule every staff visit's findings wait for Joe to tap. That is an owner gate on staff visits, and Joe settled on no owner review.
     - Nobody asked for this in round 13. The engineering finding was about Reopen only.
   - **Change:**
     - Drop the `true` on the apply `authorize`, so the assigned visitor or Joe can apply, as before.
     - Restore line 2478 to "Reopen requires Joe".
     - Replace the test with two cases: the assigned visitor can apply; unassigned staff are refused.
     - While there, line 187 still lists **Reopen** under "Joe or the visitor". Mark it "(Joe)".
     - If Joe does want Apply to be Joe-only, he says so, and all seven plan lines change to match.

4. **Plain date in the reopened Renovate Right to-do.**
   - **Files:** `db/migrations/0087_consult_rrp_margin.sql:36`, or a 0088 if 0087 has already been applied anywhere, and `tests/consult-r12-logic.test.mjs`.
   - **Change:** in the reopened to-do's body, print the new start in the same format as the old delivery date. Today the body reads "Given before on Jan 20, 2027; the new start 2027-04-15 is more than 60 days later." Replace `start_day::text` with `to_char(start_day,'Mon FMDD, YYYY')`.
   - **Test:** also assert `/the new start Apr 15, 2027/`.

5. **Fixture leftovers that a real 2000 Woodbury walk wouldn't show.**
   - **File:** `scripts/qa-seed-consult.mjs:409–417`.
   - **Change:**
     - The generic `where:'Under tub'` also labels the bath fan, so the rail reads "Exhaust fan 1 — Under tub". Key the location by module: `hvac_exhaust_fan` → "Hall bath ceiling"; keep "Under tub" only for `moisture_check`.
     - Set `existing_tub_material: 'Acrylic-fiberglass'` (a 2000 house).
     - Set `main_stack: 'PVC-ABS'`.
     - Set `window_in_shower: false`.
   - **Then:** the Flags list on 44b should be radon 5.2, wet wall exterior, and the atmospheric water heater backdraft, which is plausible in 2000. That is what a job like this really raises.

---

## Optional extras

- **E1. Show the office to-do on screen.** Retake owner-desktop-51 with By due date or Quick ones selected, so the close-failure row is in view. Carried from R13.
- **E2. Check pairs against `component_ranges` on the server.** `protocol.ts:300` checks both numbers of a pair against `range`. The door slab (`[18,96]`, with components 18–72 × 72–96) would accept a 90″-wide slab that the keypad refuses. Use `component_ranges[i] ?? range`.
- **E3. Name the range in the refused-answer row.** For a `range:` receipt, say "Outside 9–15″ — measure again" instead of "couldn't be saved in the office".
- **E4. Don't key the radon office text on its wording.** `officeFlagText` tests `/\{value\}|Radon is/`. Key on the hint coming from a measured `FLAG_HINTS` entry, or on advisory kind, so the next measured hint doesn't need a regex edit.
- **E5. A start moved earlier after mailing.** If a mailed delivery ends up less than 7 days before a new, earlier start, §745.84(a)(1)(ii) isn't met. Record the method (hand or mail) on the done to-do, and reopen a mailed one when `start − 7 < mailed day`.
- **E6. "Take the day off" on screen, and the skipped-date close on screen.** Carried from R13 E3 and E5.
- **E7. Carried from R6:**
  - bath fixtures listed with their bath;
  - a sink-base "soft, stained or wet?" choice;
  - a hint on `flooring.worst_dip` for large-format tile;
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
