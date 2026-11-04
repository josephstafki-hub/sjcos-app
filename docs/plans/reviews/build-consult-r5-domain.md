# Build R5 — Contractor / Minnesota domain judge (in-home consult)

SCORES: design=8 completeness=8

**What I read:**
- My round-3 review (`build-consult-r3-domain.md`). I checked every item in it.
- `git show 2924d2b2 5a39b90c`.
- `lib/consult/forms/seed/{shared,template-modules,templates,scripts,flag-hints,derivations,helpers}.ts`,
  `lib/consult/{rrp,frost,template-merge}.ts`, `forms/conditions.ts`, `ui/words.ts`, the `ui/model.ts`
  summary code, `ui/controller.ts` (`ensureRequiredInstances`, `answer`), `Keypad.tsx`, and
  `tests/consult-r4-logic.test.mjs`.
- Screenshots in `/tmp/sjcqa/shots/consult-r5/` (Bath + Kitchen, fresh DB): tabletP-05, 07b, 13, 14b, 20b, 21,
  24b and 29, plus `log.json` and `log-b.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:** "1954" in Permit authority, and "8 other devices".

---

## Round-3 items

| # | Item | Status |
|---|---|---|
| R1 | Unknown year counts as pre-1978; the asbestos and knob & tube questions show | **Done.** `rrpBefore = before_1978 = Yes, or (unanswered and not(year > 1977))`. `conditions.ts` returns false for an unknown field, so `not(gt …)` is true when the year is unknown. Asbestos uses `not(gt year 1980)` and knob & tube uses `not(gt year 1949)`. The test covers `{}`, an undefined value, and year and before-1978 both *skipped*. The wrap screen (tabletP-20b, year unknown) shows "Renovate Right: receipt not recorded · firm certification not current · renovator certification not current", so the conservative rule now reaches the screen. **One hole remains in the other direction: see Fix 5.** |
| R2 | The Closing section exists on every visit | **Done.** "Closing" is in the DB section list right after Start and after reload. tabletP-21 shows Pick the date opening the Closing section with the date field focused. `ensureClosing()` covers damaged old visits. |
| R3 | No silent southern frost default | **Done.** The footing default is gone. `answer('frost_zone')` writes the depth only for a real zone. The test checks that `frost_zone` and `required_depth` are both required and unanswered. The wrap shows "County frost zone: …" once a zone is picked (`WrapClose.tsx:59`). The zone labels and the 34 + 53 county lists still match Minn. R. 1303.1600 (Zone I 60 in in the north, Zone II 42 in in the south). |
| F1 | Kitchen-wall lean sentence | **Done.** "…a corner at its end leans. Plan to scribe the cabinets." |
| F2 | Split watershed out of "Near water" | **Done.** `lot_shoreland` fires only on shoreland or floodplain = Yes. `lot_watershed` has its own rule and sentence. |
| Nits | Moisture Signs, lowest beam, stair headroom, service size, hot tub, vermiculite, dumpster, rough-in tolerance (11½–12½), H14 exclusion ("by the electrician") | **All done** as written. The large-format-tile flatness nit is still open; it's optional (Extra E3). |
| R4 | QA proof | **Partly done.** The client view is now captured (tabletP-24b) and so is the close result (tabletP-29). **Still not captured:** the opening and closing script lines (tabletP-05 "opening" is the section list), closing lines 2–3 with a date picked, and the RRP read-out for 1985 + Yes and 1965 + No. See Fix 8. |

---

## The kitchen-and-bath walk: can a carpenter price it without coming back?

Mostly, yes. Here is what I checked against the seed:

- **Measurements and keypad.**
  - Room L × W at ⅛ in, L-shape legs, ceiling height and type, and out-of-level (level, not flatness).
  - Kitchen walls: length at counter height and at the ceiling (with the lean flag), ceiling height at the
    wall, base and upper runs, wall items with offsets, and corner square.
  - Window and door left offsets and casing widths in kitchens.
  - Appliance cutouts W × H × D.
  - Vanity wall vs. vanity width (flags when it doesn't fit), toilet rough-in, side clearance (15 in) and
    front clearance (24 in), shower drain center, and threshold build-up.
  - The keypad reads a bare "81" as 6′ 9″ and has ft, in, and fractions from ⅛ to ⅞. **But the 1/16 fields
    can't be typed in 1/16. See Fix 4.**
- **Era / RRP.**
  - The pre-1978 logic is right in the conservative direction.
  - "More than 6 sq ft in a room or 20 sq ft outside" matches the minor-repair exclusion in 40 CFR 745.83.
  - Window replacement is never minor repair.
  - The pamphlet has to be given no more than 60 days before work starts, with written acknowledgment
    (745.84(a)).
  - The firm and renovator certification expiry dates are checked against the later of the visit and the
    start.
  - Kids under 6 / pregnant asks yes/no only.
  - **Two wording/logic holes: Fixes 5 and 6.**
- **Permit authority.**
  - City/township and building/plumbing inspector are free text. Electrical is City / DLI / Not sure.
  - The hints are true for Minnesota: DLI inspects electrical except where a city runs its own program,
    like Minneapolis and St. Paul.
- **Mechanicals.**
  - Panel: size, brand (flags FPE, Zinsco, Pushmatic and fuse boxes), open spaces, wiring, new loads,
    door-only photos, and "never take the cover off".
  - Water heater: type, year and label photo, with capacity when there's a big tub or body sprays. Lead
    service line and stack material are also asked.
  - Hood: exit, route, joist direction, length, elbows and duct size. Over 300 cfm triggers the Minn. R.
    1346.0501 make-up-air inputs (dryer, other fans, pre/post-1994).
  - **The vented-appliance rows don't appear on their own when the visitor is offline: Fix 3.**
- **Moisture and structure.**
  - The bath gets a structure check (joists, floor feel where tile goes, foundation, attic and its
    insulation) and a moisture check.
  - The kitchen gets a structure check only when walls open or there's a new island, and moisture is
    optional there. That's acceptable; see Extra E1.
- **Selections and allowances.** There are 15 bath and 15 kitchen rows, each with exact product / a
  direction / no idea yet, real products only ("never or equal"), who buys it, and the client's budget in
  their own words ("never give a price"). The script says unpicked items "show as allowances". That's right.
- **Client summary.**
  - The client view says "This is what we talked about today. It is not a contract or a price."
  - "Still to decide" is grouped Bathroom / Kitchen with "+ 10 more for the estimate".
  - "Next: Joe sends your formal estimate."
  - The wording is good. **The order and the stored record are wrong: Fixes 1 and 2.**
- **Recording (626A).** The consent script asks permission and doesn't claim the law requires it. That's
  accurate under Minn. Stat. 626A.02 subd. 2(d) (one party may record) and is the more careful practice.
  Settled; I didn't reopen it.

---

## Required fixes (numbered)

1. **Closing › "Walk-through summary text": it's required, but nothing fills it.**
   - The problem:
     - `shared.ts:498` makes it required.
     - Its hint says "Filled from today's answers. Edit as needed."
     - No code writes `closing.summary`. I grepped `lib/consult`, `components/consult` and `app`.
     - On tabletP-21 it's an empty box. The client view builds its own text from `summaryInput`, so the
       visitor is asked to retype something the app already shows.
     - The text the client initialed is also never stored with the initials.
   - **Change:**
     - When the client taps **This is what we went over**, write the rendered summary as plain text into
       `closing.summary`, as one answer committed with the initials blob.
     - Make the field derived or not required on the visitor screen, or keep it editable but prefilled.
     - Change the hint to "What the client initialed. Filled when they tap This is what we went over."
   - Then the office has an exact record of what was initialed.
2. **Closing: the client can initial before a date is picked, and the date field comes after the initials.**
   - The problem:
     - The field order (`shared.ts:497–500`) is summary, then **client initials (Show to client)**, then
       **Formal estimate promised by**.
     - The visitor reaches Show to client first, so the client initials a sheet that says only "Joe sends
       your formal estimate." with no date (tabletP-24b).
     - The promised date is the commitment the visit ends on.
   - **Change:**
     - Move `date('estimate_promised', …)` above `signature('client_initials', …)` in the `closing` module.
     - When the date is unanswered and not skipped, show a one-line direction on the visitor side next to
       Show to client: "→ Pick the estimate date first, so the client sees it."
     - Keep Show to client usable when the date is skipped with a reason (a staff visitor may not know
       Joe's date).
3. **Heating & cooling: the vented-appliance rows are created only after a server refresh.**
   - The problem:
     - `hvac_vent` is required (min 1) once "Any fuel-burning appliances?" is answered Yes. It's a child of
       `hvac`.
     - `controller.answer()` re-runs `ensureRequiredInstances()` only for `rooms_wanted`
       (`controller.ts:403`). Otherwise it runs on load, Start and online `refresh()`.
     - The section list hides missing child slots (`VisitScreen.tsx:58`, `!s.parent`).
     - So a visitor who is offline in the basement answers Yes and sees no "Vented appliance" row, and
       nothing marks it as missing.
     - The gas water heater's and furnace's venting is exactly what the backdraft and make-up-air checks
       need. Today it only surfaces at close, as check 3 "needs finishing".
   - **Change:**
     - After any answer, call `ensureRequiredInstances()` when the answered field appears in any template
       module's `required` condition. At minimum add `hvac.fuel_appliances`, `hvac.other_exhaust_fan_count`
       and `hvac.hood_cfm`.
     - In the Heating & cooling section, list a missing required child as "Vented appliance — 0/1 · Add",
       the way top-level slots are listed.
4. **Keypad: fields ask for 1/16 in, but the keypad has no 1/16 keys.**
   - The problem:
     - `precision: 0.0625` is set on kitchen wall lengths (counter and ceiling), base and upper runs, sink
       base width, island L × D, and the appliance cutouts W × H × D.
     - `Keypad.tsx:15` offers ⅛ to ⅞ only, and there's no "/" key. A carpenter can't enter 36 1/16 except
       as "36.0625".
   - **Change (pick one):**
     - When `precisionOf(def) === 1/16`, show a second fraction row: 1/16, 3/16, 5/16, 7/16, 9/16, 11/16,
       13/16, 15/16. On phones under 400 px it can be a "16ths" toggle that swaps the row.
     - Or drop those fields to `precision: 0.125`. Cabinet field measure at ⅛ with fillers is normal
       practice.
   - The form and the keypad have to agree.
5. **Era hazards: "Built before 1978? No" with an unknown year turns RRP off with no reason.**
   - The problem:
     - `rrpYearConflict` (`rrp.ts`) fires only when year < 1978. With the year blank or skipped and the
       visitor tapping No, `rrpApplies` is false.
     - The pamphlet, initials and certifications stop being required, and no reason is asked.
     - That's the non-conservative direction R1 was meant to close.
   - **Change:**
     - Use `rrpYearConflict = before_1978 = No AND not(year > 1977)`. That covers year < 1978 and an
       unknown year.
     - Relabel `year_override_reason` "How do we know it's 1978 or newer?" so it reads right in both cases.
     - Add the test row "year unknown + No → reason required, flag until written".
6. **Era hazards › the Renovate Right line says "was built before 1978" when the year isn't known.**
   - The problem: `PAMPHLET_LINE` and `LEAD_SAFE_PAMPHLET.text` (`shared.ts` / `scripts.ts`) are read aloud.
     When RRP applies only because the year is unknown, the visitor states something as fact that nobody
     knows.
   - **Change:** when `house.year_built` isn't answered, show this line instead:
     > "We don't know for sure the house was built after 1978, so we give you this pamphlet about lead-safe work — it's called Renovate Right. Could you initial here that you got it?"

     Keep the current line when year < 1978 or before-1978 = Yes.
7. **Section list: the kitchen sections sit below all 30 selection rows.**
   - The problem:
     - `mergeTemplateModules` (`template-merge.ts:17`) moves only `closing` to the end.
     - On a Bath + Kitchen visit, **Kitchen work, Appliance 1 and Kitchen wall 1–2 come after "Kitchen —
       Paint colors"** (tabletP-07b).
     - The visitor walks the kitchen by scrolling past 30 decision rows. Easy to miss the walls, which feed
       the cabinet run, the countertop and the backsplash.
   - **Change:** return `[...rest, ...selections, ...closing]`, with selections moved to just before
     Closing. Then each area's measuring sections stay together and the selections are read through at the
     table as one block, as the script does.
8. **QA proof still owed (carried from R4):**
   - The opening card with line 3 ("{duration}") and line 4b.
   - Closing lines 2–3 on Bath + Kitchen with a date picked: "by {date}" and the grouped, capped
     selections line.
   - The client view after a date is picked (and after Fix 2).
   - The wrap RRP read-out at year 1985 + Yes and at 1965 + No with a reason.

---

## Optional extras

- **E1. Kitchen moisture.** Add one required yes/no to `kitchen_scope`: "Sink base and dishwasher floor:
  soft, stained or wet?". On Yes, require a moisture check. Rot under the sink and dishwasher is the most
  common kitchen surprise.
- **E2. Tile subfloor.** In `structure`, when there's a tile floor, add "Subfloor: plank / plywood / OSB
  and thickness (seen at a vent or from below)". It's needed to price underlayment, and natural stone needs
  more stiffness than ceramic.
- **E3. Large-format tile flatness.** From R3: 1/8 in in 10 ft for tile 15 in or bigger (ANSI A108.02),
  versus ¼ in in 10 ft otherwise.
- **E4. Client view "+ 10 more for the estimate".** Use "and 10 more — listed on your estimate". A client
  can read the current wording as 10 more things they owe.
- **E5. Permit city.** Prefill it from the address city, as a choice with "Other". That's already noted.
- **E6. Selection label.** Change "Kitchen — Appliance package (each appliance)" to "Kitchen — Appliances".
  The parenthetical is office shorthand.
- **E7. Renovate Right acknowledgment.** EPA's sample acknowledgment form has a printed name, a signature
  and a date. Initials on the pad are workable. Saving the client's printed name and the date with the
  initials blob would make the record match the sample form. Keep it for 3 years (745.86). Joe's counsel
  may want to look at this together with the walk-through-initials item they already have open.
