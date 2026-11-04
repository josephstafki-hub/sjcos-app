# Build R3 — Contractor & legal judge (in-home consult)

SCORES: design=9 completeness=8

**What I read:**
- My round-2 review.
- `git show a22d7edc a8a15b67`.
- `lib/consult/rrp.ts`, `frost.ts`, `forms/seed/{shared,template-modules,derivations,flag-hints}.ts`,
  `forms/conditions.ts` (`lt`), `ui/model.ts` (`spokenSelections`, `clientPlace`, `summaryInput`),
  `ui/words.ts`, `VisitScreen.tsx` (closing script) and `ClientView.tsx`.
- `tests/consult-r3-logic.test.mjs` and `tests/consult-hints.test.mjs`.

**What I dumped:** every seed flag (rule, trigger, office issue, visitor sentence) through a one-off
`node` import of `seed.ts`. There are **75** flag rules and 75 sentences in `flag-hints.ts`, not 69.
All 75 have a sentence.

**What I checked on the web:** Minn. R. 1303.1600 on revisor.mn.gov. Zone I = 5 ft (60 in): Aitkin,
Becker, Beltrami, Carlton, Cass, Clay, Clearwater, Cook, Crow Wing, Douglas, Grant, Hubbard, Itasca,
Kanabec, Kittson, Koochiching, Lake, Lake of the Woods, Mahnomen, Marshall, Mille Lacs, Morrison, Norman,
Otter Tail, Pennington, Pine, Polk, Red Lake, Roseau, St. Louis, Todd, Traverse, Wadena, Wilkin. Zone II
= 3½ ft (42 in): every other county. An engineer competent in soil mechanics may allow less.
`frost.ts` matches the rule exactly: all 34 + 53 counties, the right depths and the right zone
numbers.

**My round-2 citation was wrong.** I had the zone numbers backwards: I called southern Minnesota
"Zone I". Codex was right to correct it. The depths and the wording I asked for still hold.

**Screenshots** (`/tmp/sjcqa/shots/consult-r4/`): tabletL-09, 15b, 16, 20, 22 and 24.
- **The client view was not captured.** tabletL-16 and tabletL-24 both show the visit screen, and every
  `FAIL-*-client` shot failed. I judged the client view from the code.
- **The Closing section isn't created** on this visit, as the coordinator said. I judged the script from
  the code.

**What I ran:** nothing else. No servers, builds, browsers, tsc or tests.

---

## Round-2 items

| # | Item | Status |
|---|---|---|
| 1 | RRP: an answered `era.before_1978` wins over the year | **Done.** `rrpBefore = before_1978 = Yes, or (unanswered and year < 1978)`. 1985 + Yes → applies. 1965 + No → doesn't apply, but `year_override_reason` becomes required and raises a flag until it's written. The form and the close gate now use one definition (`rrpApplies` is imported by `shared.ts` and used by `rrpFacts`), and the test covers 1985/Yes, 1954/skipped, 1965/No + reason. **One hole remains. See R1 below.** |
| 2 | RRP: unknown "disturbs paint" counts as applying | **Done.** `not(disturbs_paint = No) OR window/door replacement`. A skipped answer applies. Tested. |
| 3 | Closing line 3 grouped and capped | **Done in code.** `spokenSelections`: up to 5 per area, "(asides)" dropped, "/" → "and", "and ten more" in words, areas joined with ";". Example: "for the bathroom, the vanity, vanity top, sink, faucets and toilet, and ten more; for the kitchen, …". That can be read aloud. Not seen on screen (Closing section missing). |
| 4 | "Pick the date below first" as a direction, not a quote | **Done.** `needsDate` → an unquoted, info-styled "→ Pick the estimate date below, then read this line." Closing line 2 is the only line with `{estimate_date}` and gets this treatment. |
| 5 | Whole-home spoken duration | **Done.** ", or two scheduled visits" is gone from `spokenDuration`, and the docblock explains why. |
| 6 | Client summary names and "Not measured today" | **Done.** `clientPlace`: the room's own name, else its area ("the bathroom", "the kitchen"), else its level ("a main-floor room"). Duplicates are removed, and a place listed as gone over is never also "not measured". "Next: Joe sends your formal estimate by {date}." / "Joe sends your formal estimate." Groups use "Bathroom", not "Bath". Not seen on screen. |
| 7 | Plain flag text, citations moved to the office | **Done.** Every rule has a `hint`. FieldRow and WrapClose render `hint` only (tested), and the office `issue` keeps its citations. There's a fallback `visitorFlagText` strips codes from a flag added later without a hint. Garage "Not sure" → "isn't confirmed", tested to never say "missing". Two of the sentences are wrong. See "Flag sentences". |
| 8 | Hints H1–H14 | **All applied.** I spot-checked each one against the source below. H1 has its Not sure option and the inspector hint, but the office still doesn't prefill permit authorities from the city. That's acceptable, since the note routes Not sure to Joe. |
| 9 | `well_ladder` after `well_depth` | **Done.** It's renamed "Permanent ladder or steps in the well?". |
| 10 | Wrap and close counts agree | **Done in code** (one `openItemCount`, tested equal to `m.open.length`). The close screenshot (tabletL-22) only shows "Visit closed — sending · ⇅ 0 · Keep this screen open", so the count wasn't visible. "⇅ 0" with "sending…" still on screen looks stuck. QA should re-capture it once sending finishes. |
| 11 | Planned footing depth vs required | **Done.** There's a County frost zone choice. Picking a zone writes the required depth (60 or 42), which can still be changed. Planned depth is required, `depth_margin = planned − required`, and a negative margin flags. A 48-in pier in a 60-in county flags (tested). The default needs one change. See R3. |
| 12 | QA proof (schedule dialog, opening line 3, RRP read-out, check 3 passing) | **Not done.** None of it is in r4. The client view and the Closing section weren't captured either. |

### Hint spot-check (each H-item against the source)

| # | Now reads | Verdict |
|---|---|---|
| H1 | Electrical: "Most cities use the state (DLI…). A few, like Minneapolis and St. Paul, inspect their own. Not sure? Pick Not sure — Joe checks." + a **Not sure** option. Inspector: "Usually the city building department. Write the city, or Not sure." | ✓ True and usable. tabletL-09 still shows "1954" typed into Permit city and "Owner lives here" in the inspector field. That's QA test data, but it shows free text takes anything. Optional: make the city field a choice prefilled from `exterior_site.city`. |
| H2 | "42 in across southern Minnesota, metro included. 60 in in the northern counties. The city's handout is the final word." | ✓ Matches 1303.1600. |
| H3 | "…at least 24 in high and at least 5.7 sq ft open (5.0 sq ft at or below grade). 20 × 24 alone is not enough." | ✓ R310.2.1 and its exception. |
| H4 | "Floor to the bottom of the open sash, not the trim. Egress needs 44 in or less." | ✓ |
| H5 | "Deeper than 44 in needs a permanent ladder or steps in the well." | ✓ R310.2.3.1. |
| H6 | "How much lower the floor's low side is than its high side — with a laser, or a level held level. Not dips under a straightedge." | ✓ Level and flatness are now separate. Flatness is the flooring add-on's worst-dip field. |
| H7 | "30 in wide, 36 in deep and 6½ ft tall, kept empty — no shelves, soffits or walls in it." | ✓ NEC 110.26. |
| H8 | "Start with posts about 8 ft apart. Joe sets the final spacing from the beam size." | ✓ |
| H9 | Dry: "…Fill in the water weight too — the engineer designs for the filled weight." Water: "Gallons on the spec sheet × 8.3 lb." | ✓ |
| H10 | "Power-vent: one plastic pipe out, fan on top or inside. Direct-vent: two plastic pipes, or one inside another." | ✓ |
| H11 | "Give it no more than 60 days before work starts, and get their initials. If work starts later, we give it again." | ✓ 40 CFR 745.84(a). |
| H12 | "Whoever digs calls 811 at least 2 business days ahead. 811 doesn't mark private lines…" + a new private-lines hint | ✓ Minn. Stat. 216D (48 hours, excluding weekends and holidays). |
| H13 | "Is there an outlet or breaker with Test/Reset buttons? The electrician confirms." | ✓ |
| H14 | "From the panel labels. Can't tell? Skip it with Sub/supplier will measure — the electrician counts." | ✓ Usable. Nit: that skip writes the exclusion "Field measure by supplier: Existing circuits — count of 20 A countertop circuits" (`findings.ts:74`). For an electrical count it should read "by the electrician", or use a trade-neutral "Field check by the trade: …". |

---

## Flag sentences

I read all 75 rules against their triggers. I asked of each one: is it true for every answer that
triggers it, is it plain, is it calm enough for a client reading over the visitor's shoulder, and is it
written for the visitor? **69 pass as written.** Good examples:
- The safety-glass set says "has to be tempered", plus "The supplier confirms" on the large-pane
  exceptions.
- "Possible lead water line — tell the client. The city may have a replacement program."
- "A long or bent fan duct — the sub checks the fan still moves enough air." This keeps the r1
  "not a universal length-code failure" nuance.
- "Fumes could spill back into the house — the HVAC sub checks before we price."
- "Less than 24 in in front of the toilet — the plumbing code needs at least that." (MN 4714 / UPC 402.5.)
- "Footings near the house have to sit on undisturbed soil, not backfill."
- The garage pair: "is missing" / "isn't confirmed".

**Wrong — must fix:**

| # | Rule | Sentence | Problem | Use instead |
|---|---|---|---|---|
| F1 | `kitchen_wall.length_ceiling` (fires when ceiling length − counter-height length is more than ±¼ in) | "This wall leans more than ¼ in top to bottom." | Not true. If a wall is longer or shorter at the ceiling than at counter height, the **corners at its ends** lean or are out of square, not this wall. A visitor will put a level on the wrong wall. | "This wall is ¼ in+ longer or shorter at the ceiling — a corner leans. Plan to scribe the cabinets." |
| F2 | `addition_scope.lot_shoreland` (fires on shoreland Yes, floodplain Yes, **or any answer to the required watershed-district text**) | "Near water — Joe checks the shoreland, floodplain and survey rules." | It fires on **every** addition. `lot_watershed` is a required text field, and nearly every Minnesota lot sits in a watershed district or WMO. So "Near water" shows for dry lots. That's wrong, and it alarms a client reading along. | Split it. Shoreland or floodplain = Yes: keep "Near water — Joe checks the shoreland, floodplain and survey rules." Watershed answered: a separate rule that says "Joe checks the watershed district's rules and the city's survey requirement." |

**Small accuracy nits (worth doing, not blockers):**
- `moisture.signs` and `basement_scope.water_ever` both say "Water got in before". That fits Water ever,
  but Signs also fires on **Active leak**, Musty smell and Soft subfloor. Use "Signs of water — we'll
  need to find the source and keep it dry." for Signs.
- `basement_scope.lowest_beam`: "too low for a finished room" overstates it. Only the beam or duct
  projection must clear 6 ft 4 in (R305.1.1 exception). Use "Under 6 ft 4 in below a beam or duct — it
  has to be raised or moved for a finished room."
- `basement_scope.stair_headroom`: "Stair headroom is under 6 ft 8 in." That's a fact with no
  consequence. Add "— if we rebuild the stairs, the headroom has to be fixed."
- `panel.main_breaker`: "will likely need a bigger electrical service" overstates it. A 100 A service
  with one induction range often passes a load calculation. Use "may need a bigger electrical service —
  the electrician runs the load numbers."
- `deck_scope.uses` (Hot tub): "its own 240 V circuit". Use "usually its own 240 V circuit" — 120 V
  plug-in tubs exist.
- `structure.attic_insulation` (vermiculite): EPA guidance is to assume vermiculite is contaminated,
  because a test can miss it. Use "Don't disturb this insulation — treat it as asbestos until a
  specialist says otherwise."
- `access.dumpster_spot`: "needs a city permit". Use "usually needs a city permit" — it varies by city.
- **Trigger nit:** `plumb_fixture.rough_in` flags on `≠ 12` with ¼-in precision. A 12¼ in reading (which
  is a 12-in rough taken off the baseboard) flags as "not the usual 12 in". Flag outside 11½–12½ instead.
- **Trigger nit:** `flooring.worst_dip` at more than 3/16 in in 10 ft fits LVP and tile under 15 in (¼
  in). Large-format tile (15 in or bigger) needs 1/8 in in 10 ft (ANSI A108.02). Add a large-format
  question or use the lower threshold when the floor is tile.

---

## New issues

**R1. If the year built is unknown and the pre-1978 answer isn't given, RRP doesn't apply (legal).**
- `conditions.ts:38`: `lt` is false when the value isn't a number.
- So with `house.year_built` blank or skipped and `era.before_1978` unanswered or skipped,
  `rrpBefore` is false. `applies` becomes false, the pamphlet, initials and renovator fields stop being
  required, and no redelivery to-do is filed.
- A "Close visit — needs finishing" closes in that state with no RRP item open.
- `words.ts:191` (`rrpWhy`) tells the visitor "Built before 1978 (or the year isn't known)…", so the
  screen promises the conservative rule and the code doesn't apply it.
- The same blind spot hides the asbestos question (`lt year 1981`) and knob & tube (`lt year 1950`)
  when the year is unknown.
- **Fix:**
  - Use `rrpBefore = before_1978 = Yes, or (before_1978 unanswered and not(year > 1977))`.
  - Show the asbestos and knob & tube questions when the year is unknown.
  - Add test rows for undefined year with undefined before, and undefined year with a skipped before.

**R2. The Closing section doesn't exist on a fresh visit (engineering is fixing this).**
- On this visit there's no promised-date picker. The wrap row "Formal estimate date — not picked yet"
  has no Pick the date button (`onPromised` is undefined without a closing instance).
- There's no closing script, no "Formal estimate promised" to-do and no client questions. The client
  view then says "Joe sends your formal estimate." with no date.
- For a real visit tomorrow this is the main blocker in my area: the estimate promise is the legal and
  commercial commitment the visit ends on.

**R3. A northern-county visit silently gets 42 in.**
- `controller.ts:340` pre-answers `frost_zone = Southern (42 in)` and `required_depth = 42` when the
  footing section is made.
- A visitor in Crow Wing, Douglas or St. Louis county who doesn't touch it closes with a 42-in
  requirement. A planned 48-in pier then passes when the code needs 60. That's the non-conservative
  direction.
- **Fix (either):**
  - Leave `frost_zone` unanswered (it's required) so the visitor has to pick.
  - Or prefill it only when the address county is known and is in Zone II. `frostZones` already has the
    county lists.
- Show the chosen zone in the wrap read-out.

**R4. QA proof is still missing (carried from round 2).**
- The client view, opening line 3 and closing line 3 on a Bathroom + Kitchen visit.
- The wrap RRP read-out on a pre-1978 visit.
- Check 3 passing on a filled visit.
- The close result after sending finishes (tabletL-22 is stuck at "sending, ⇅ 0").

---

## Required to reach 10

1. **R1:**
   - Unknown year with no pre-1978 answer counts as pre-1978 for RRP, and shows the asbestos and
     knob & tube questions.
   - Add the test rows.
2. **R2:** the Closing section exists on every visit, so the promised date, its to-do, the script
   (lines 2 and 3) and the client view's date all work.
3. **R3:** no silent southern default for the frost zone. Make the visitor pick, or prefill by county.
4. **F1 and F2:**
   - Fix the kitchen-wall lean sentence.
   - Split the watershed rule out of "Near water".
5. **The nits** (strongly recommended, about 20 minutes):
   - Moisture Signs wording.
   - The lowest-beam, stair-headroom, service-upgrade, hot-tub, vermiculite and dumpster sentences.
   - Rough-in tolerance.
   - The H14 exclusion wording.
6. **QA re-capture (R4):**
   - Client view.
   - Closing lines 2 and 3 on Bathroom + Kitchen, with and without a date.
   - Wrap RRP read-out at 1954, at 1985 with Yes, and at an unknown year.
   - Close result after sending.
