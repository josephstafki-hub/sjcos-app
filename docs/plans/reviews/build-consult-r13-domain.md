# Build R13: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=9

**What I read:**
- My round-12 review (`build-consult-r12-domain.md`). I checked items 1–4 and extras E1–E7.
- `git show 13b83a4e 23b125ac`, in particular:
  - `db/migrations/0086_consult_rrp_slip.sql`;
  - `lib/consult/{close-errors,rrp,evidence-chunks}.ts`;
  - `lib/consult/ui/{controller,model,ops}.ts`;
  - `components/consult/office/OfficeFlags.tsx`;
  - `scripts/qa-seed-consult.mjs`;
  - `tests/consult-r12-logic.test.mjs`.
- Seed forms: `lib/consult/forms/seed/{shared,template-modules,flag-hints}.ts`. I read the radon, plumbing-fixture, vanity, panel and bearing-wall fields.
- `lib/consult/forms/approved-content.ts`, both the counsel block and the two reworded flag rows, and the same parts of `docs/plans/in-home-consult-plan.md`.
- Screenshots in `/tmp/sjcqa/shots/consult-r13/`:
  - owner-desktop-44, 44b and 50b. I cropped and read the full left rail, House & household, Feeds, Flags and Trade walks;
  - phone-40 (staff), phone-40 as Joe, phone-41;
  - phone-17f, 17g;
  - phone-43g, 43h, 43i, 43j and their after-button shots;
  - owner-desktop-51, plus the `close-failure todos` row in `log.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- Every flag decided "not an issue · Reviewed for QA fixture".
- The firm-certification Problem row on 17f (no firm expiry in the QA DB).

---

## Round-12 items

| # | Item | Status |
|---|---|---|
| 1 | Re-delivery when the start slips after the pamphlet was given | **Done.**<ul><li>0086 reopens a done `:rrp:delivery` or `:rrp:redelivery` to-do when `completed_at` (Central) falls before `start − 60`. It clears `completed_at`, retitles it "Start moved — give Renovate Right again; get initials or mail with a certificate of mailing" and sets the due day to `start − 7`.</li><li>`queued` is a real `work_items` status, so the reopened row shows on Today.</li><li>The test has both cases I asked for: start moved to 03-01 → stays done; moved to 04-15 → queued, due 04-08, "Start moved —" title.</li><li>One practical gap: the only reminder now arrives on the last legal mailing day. See Fix 3.</li></ul> |
| 2 | Plain office words for every close code | **Done.**<ul><li>owner_required: "they put in a trade-walk day only you can set — set it in the look-over, or tell them to take it off". That is exactly the action Joe needs.</li><li>rebase_required, evidence_too_large, batch_too_large, signed_out, access_denied, person_required, complete_locked, json_required, csrf and consult_key_unavailable each have their own line.</li><li>The catch-all is now "the app didn't take the close; open the visit".</li><li>The test asserts that no key of `CLOSE_ERROR_ACTIONS` falls to the catch-all.</li><li>evidence_conflict and owner_required wait 30 minutes like conflict, which also covers my R12 E2. 43h shows no "Joe has been told" line, which is right for a visitor-fixable refusal.</li><li>owner-desktop-51 still doesn't show the row; it sits under The rest. log.json has the row, so I'm not blocking on the screen. Its wording is E1.</li></ul> |
| 3 | Office flag line falls back to the plain hint | **Done.**<ul><li>`officeFlagText` keeps the issue only for detail, a `Minn. R.` cite or a full sentence. Otherwise it uses the hint.</li><li>Both seed issues are reworded in the seed, `approved-content.ts` and the plan.</li><li>On 44b and 50b the list reads "Old or cracked drain stack — the plumber looks before we price" and "Pipes in an outside wall can freeze — they may need moving or insulating". No `;` and no "MN".</li></ul> |
| 4 | The sixth counsel line under its heading | **Done.** It now follows the unknown-year pamphlet line in both files. The test asserts that all six lines come after `### Changed since approval`. |

R12 extras:
- **E1. Renovator wording: done.** 17f reads "Dana Kowalski's renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Dana takes the refresher course before then, or Joe puts another certified renovator on the job." That is right under 40 CFR 745.90(a)(3). The firm tail is unchanged and still right.
- **E2. owner_required wait: done** (see item 2).
- **E3. Realistic fixture: partly done, and it now creates false findings.** See Fix 2.
- **E4. Skipped-date screen: still owed.** Not blocking.
- **E5. Radon advisory: added, but the office can't read it.** See Fix 1.
- **E6. Mailing margin: not taken.** It is now required because of the reopen path; see Fix 3.
- **E7 (carried from R6): still open, not blocking.**

Changes in 13b83a4e:
- **Era hazards wording: right.** On 17f and 17g the firm row reads "Enter it in Era hazards, or Joe adds it in Settings › Company".
- **Joe-only Reopen: right.** Staff see "Answers are locked. Joe can reopen it from the office look-over." with no Reopen (phone-40). Joe's look-over has Reopen.
- **"‹ Back to visits": present.**
- **Complete heading: right.** The time stays with the date.
- **"Take the day off": not shown on screen.** 43h-after-button opens Trade walks at Plumber with nothing set and no day in view. I can't confirm on screen that it scrolls to the trade with the day or shows "Take the day off". See E3.

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes.** Nothing that prices the job changed this round.

- The kitchen still captures:
  - 1/16″ runs;
  - appliance cutouts and power;
  - the hood route;
  - gas;
  - countertop circuits;
  - soffits;
  - the ceiling below a moved sink.
- The bath still captures:
  - toilet rough-in and clearances;
  - shower drain;
  - vanity wall and width;
  - wet-wall-exterior;
  - floor heat and its circuit.
- Trade walks are still derived on the server.
- On phone-40 the Complete close reads Price-critical 352/352 · Record 2/2 · 64 skipped, and "Answers are locked".
- The Feeds block on 44b (224 sf floor tile, 80 sf wall tile, 240 sf demo and floor, 6 lf cabinets, 12.8 sf tops, 2 sf backsplash) holds the numbers a kitchen and bath estimate needs.
  - The quantities themselves are thin for a real kitchen: 6 lf of cabinets and 2 sf of backsplash. Those come from the fixture defaults; see Fix 2.

## Minnesota checks

- **Frost (Minn. R. 1303.1600):** unchanged and right. Zone I is 60 in, Zone II 42 in, and the city's figure can be edited.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)):** one-party consent. Settled and unchanged.
- **Plumbing (Minn. R. 4714):** the 24″ front and 15″ side toilet lines are unchanged and right.
- **RRP (40 CFR 745):**
  - **§745.84(a)(1):** the 60-day window now holds when the start slips after a handover. A hand delivery due by `start − 7` is legal. For mailing, `start − 7` is the last legal day, with no slack (Fix 3).
  - **§745.89(b)(1) firm:** the 90-day line is right.
  - **§745.90(a)(3) renovator:** the refresher line is right.
- **MDH radon:** 4 pCi/L is the right threshold. MDH says to fix the home at 4 pCi/L or more, and to consider it from 2 to 4. The issue sentence ("Radon 36 pCi/L — at or above the Minnesota Department of Health action level (4). Mention mitigation to the client.") is accurate. But the office shows only the hint (Fix 1).
  - **The value:** 36 pCi/L is possible in Minnesota but extreme. Minnesota's average is about 4.5. 36 is not what a "realistic" fixture should show. It is the generic number fallback in `qa-seed-consult.mjs`, not a chosen value (Fix 2).

## Office flag sentences (owner-desktop-50b)

All the seeded flags now read as plain sentences:
- "The HOA may need to approve the work before the permit"
- "A cast-iron tub takes two people to remove or break up"
- "Their only bathroom — plan a working toilet every night, or a portable one"
- "Not the usual 12″ toilet rough-in — the new toilet has to match it"
- "Fumes could spill back into the house — the HVAC sub checks before we price"

The double punctuation is gone, and decided flags carry ⚐.

The radon line is the exception. It reads only "**Mention mitigation to the client**", with no level, no threshold and no word "radon". `OfficeFlags.tsx:22` renders `f.hint` for every advisory, and the radon hint is that bare instruction. See Fix 1.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

All six are plain and accurate, and they are now all under the heading.

---

## Required fixes (numbered)

1. **Radon advisory: name the level on the office look-over, and move it into the seed.**
   - **Files:**
     - `lib/consult/ui/model.ts:392` (the hard-coded push in `buildModel`);
     - `lib/consult/forms/seed/shared.ts:61` (`house.radon_level`);
     - `lib/consult/forms/seed/flag-hints.ts`;
     - the radon row in `approved-content.ts` and `in-home-consult-plan.md`;
     - `tests/consult-r12-logic.test.mjs`.
   - **Problem:**
     - Advisories render their hint on the office (`OfficeFlags.tsx:22`). 44b and 50b show "⚐ Mention mitigation to the client". Joe can't tell from that line that it is radon or that the level is 36.
     - The flag is also hard-coded in the view model. It is not in the seed form, the plan table or `approved-content.ts`, so the form version doesn't record it. And it fires only where `buildModel` runs.
   - **Change:**
     - Give `radon_level` a seed flag: `{ kind:'advisory', when: gt('radon_level', 3.99), issue: 'Radon at or above 4 pCi/L (MDH)' }`. The helpers have `gt` but no `gte`.
     - Add a measured hint to `flag-hints.ts` under `'house.radon_level'`: "Radon is {value} pCi/L — at or over the 4 pCi/L level where the Minnesota Department of Health says to fix it. Mention mitigation, and don't seal the sump or slab in a way that blocks a future system." Fill `{value}` the way `flag-lead` fills the toilet measurement.
     - Delete the hard-coded push in `buildModel`.
     - Add `⚑ ≥ 4 pCi/L: advisory — mention mitigation (MDH)` to the plan and approved-content row.
   - **Test:**
     - radon_level 4 → one advisory whose office text contains "Radon is 4 pCi/L";
     - radon_level 3.9 → none;
     - `OfficeFlags` text for the advisory contains "pCi/L".

2. **Make the "realistic" Complete fixture match a real Woodbury kitchen and hall bath.**
   - **File:** `scripts/qa-seed-consult.mjs`, lines 69–80.
   - **Problem:** the look-over is the proof Joe reads, and this one contradicts itself and sets off flags a real visit wouldn't:
     - **HOA:** "HOA or condo association? Yes", then "HOA rules: No HOA". The HOA flag then fires. Every yesno is `true`.
     - **Pets:** "Pets: None", but "Who lives here: Two adults, one dog".
     - **Toilet rough-in:** recorded as 36″. The key is `rough_in`, not `toilet_rough_in`, so it falls back to 36. The field's range is 9–15″, and the device keypad refuses 36. That sets off "Not the usual 12″ toilet rough-in".
     - **Vanity:** the wall is 36″ and the vanity 48″, so "The vanity they want is wider than the wall" fires.
     - **Main breaker:** `60 A` (options[0]) in a 2000 house. That sets off the service-upgrade flag.
     - **Bearing wall:** "Likely bearing", which sets off the engineer flag. The Engineer/framer trade walk's reason then reads "Confirm bath exhaust route".
     - **Radon:** 36 pCi/L, the unit-less number fallback.
     - **Selections:** the rail lists "Selections & allowances 1 … 30" with no names, because `decision` is copied from the empty instance label.
     - **Text fields:** a dozen read "Client confirmed <field label>", for example "Client confirmed Days or times we must not work (shift sleep, naps, events)".
     - **Quantities:** cabinets 6 lf, backsplash 2 sf.
   - **Change:**
     - Key the numbers by real field keys:
       - `rough_in: 12`, `side_clearance: 16`, `toilet_front_clearance: 30`;
       - `vanity_wall: 48`, `vanity_width: 36`;
       - `radon_level: 5.2` (so Fix 1's advisory shows in a believable way);
       - `water_pressure: 60`.
     - Set the yesno and choice values per field:
       - `hoa: false` (drop `hoa_rules`);
       - `pets: 'Dog'` with where during work "Crated in the basement";
       - `main_breaker: '200 A'`;
       - `bearing: 'Likely not'`;
       - `only_bathroom: false` (there's a main-floor half bath).
     - Name the 30 selections from a fixed list: Cabinets, Cabinet hardware, Countertop, Backsplash tile, Kitchen sink, Kitchen faucet, Range, Hood, Refrigerator, Dishwasher, Microwave, Kitchen flooring, Kitchen lighting, Paint, Vanity, Vanity top, Bath faucet, Toilet, Shower valve and trim, Shower wall tile, Shower floor tile, Shower glass, Mirror, Bath fan, Bath lighting, Towel bars and accessories, Bath flooring, Door and trim, Grab bar blocking, Heated floor thermostat. Use them as both `decision` and the label.
     - Replace the "Client confirmed …" fallback with short answers on the fields the look-over shows: "Weekdays only; no work before 7", "Fix the squeaky hall floor", "None known", "Spouse — here today".
     - Kitchen numbers: kitchen wall lengths that give about 22 lf of cabinets, and `backsplash_height` 18″, so the backsplash comes to about 30 sf, so the Feeds look like a kitchen.
   - **Then:** retake owner-desktop-44b and 50b. The Flags list should show only the flags a job like this really raises: cast-iron tub, wet wall exterior if kept, radon 5.2, and fuel-burning venting.

3. **Leave mailing time on the re-delivery to-do (40 CFR 745.84(a)(1)).**
   - **Files:** `db/migrations/0087_consult_rrp_margin.sql` (new; replaces `consult_reconcile_rrp`) and `tests/consult-r12-logic.test.mjs`.
   - **Problem:**
     - The 0086 reopen and the 0085 fallback both set the due day to `start − 7`. The scheduling trigger snoozes the to-do until that day, so Joe first sees it on the last legal day to mail it.
     - After a start slips, the client usually isn't on site, so Joe will mail it. Any delay that day makes the start non-compliant.
   - **Change:**
     - In the reopen `UPDATE` and in the redelivery fallback, set the due day to `greatest(start − 60, start − 14)` at 00:00 Central.
     - A picked day still wins when it falls inside the window.
     - Add "at least 7 days before work starts" to the reopened title: "Start moved — give Renovate Right again: get the owner's initials, or mail it with a certificate of mailing at least 7 days before work starts".
     - Before clearing `completed_at`, append the old date to the body: "Given before on {date}; the new start {start} is more than 60 days later." That keeps the history in front of Joe.
   - **Test:** the 04-15 case becomes due 04-01, and the body contains "Given before on Jan 20, 2027".

---

## Optional extras

- **E1. The invalid_command office line.** "the office could not read the wrap-up answers; open the visit and check Before you wrap" — Joe is the office, and Before you wrap lives on the visitor's device. Suggest: "the app couldn't read their wrap-up answers; they need to check Before you wrap and close again". Then retake owner-desktop-51 with the row in view (By due date or Quick ones).
- **E2. Server-side range check.** The fixture saved a 36″ rough-in that the keypad would refuse. `lib/consult/length.ts` checks ranges only on the device. If the answer API checked `def.range` too, an old cached app or a script couldn't store an impossible length.
- **E3. Screen proof for "Take the day off".** Retake 43h-after-button with a trade-walk day actually set, so the shot shows the sheet scrolled to that trade with "Take the day off" in view.
- **E4. Woodbury electrical permit.** The fixture says "City". In most Minnesota cities, electrical inspection is done by the State (DLI), not the city. Use whichever Woodbury actually uses, and consider making State (DLI) the first option in that choice.
- **E5. Skipped-date close on screen.** Still owed from R10 3(a).
- **E6. Carried from R6:**
  - bath fixtures listed with their bath;
  - a sink-base "soft, stained or wet?" choice;
  - a hint on `flooring.worst_dip` for large-format tile flatness;
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
