# Build R1 — Contractor & legal judge (in-home consult)

SCORES: design=7 completeness=6

Reviewed: plan §7.1–§7.11, §8.1–§8.2, §10.1–§10.3 against `lib/consult/forms/seed.ts` +
`lib/consult/forms/seed/{shared,template-modules,templates,derivations,scripts,helpers}.ts`, commit
`0fa70ed0`, `lib/consult/ui/words.ts`, `lib/consult/copy.ts`, `lib/consult/completeness.ts`, plus the
code that turns the seed into a visit (`lib/consult/ui/model.ts`, `lib/consult/ui/controller.ts`,
`components/consult/field/VisitScreen.tsx`, `components/consult/field/WrapClose.tsx`). Screenshots
`/tmp/sjcqa/shots/consult-r1b/*`, `consult-r1/owner-desktop-02*`, `consult-r1/phone-05`.
I ran nothing: no servers, builds, browsers, tsc or tests.

The seed carries the approved content well. The scores are held down by how the visit **uses** that
content: a Bathroom + Kitchen visit (the visit in the QA screenshots) drops the kitchen's panel, its
room, its sink and all 15 kitchen selections. Opening line 3 tells the client "offer separate visits".
And the Renovate Right check at close isn't connected to the Era answers. A single-template visit
(one bath, one deck) could be run tomorrow with a few workarounds. A combined visit could not.

---

## What's right

**Content fidelity (seed vs plan)**
- All 16 shared modules in §7.3, all 9 template modules and all 3 add-ons are present, in plan
  order, with the plan's own labels. Child modules (`hvac_vent`, `hvac_exhaust_fan`,
  `kitchen_appliance`, `garage_door`, `openings`) are a clean way to model the plan's "one row per …"
  tables, and `moduleParents` keeps the parent link.
- Tier rule (§7.1) is applied as written. `tierFor` makes every R/R? Price-critical. The plan's Record
  list is explicit: how they cook (`kitchen_scope.how_they_cook`), top changes/priorities, storage, mirror,
  base trim. All shots are Price-critical. Kitchen upper cabinet run stays Price-critical even though it
  is optional, which is a sensible override.
- **Scripts are verbatim.** I checked each of these word for word against §7.2/§8.1 (`seed/scripts.ts`):
  Joe's opening (1–6 including 4b, with the plan's curly apostrophes), the staff replacement for lines
  1–2, Joe's closing 1–6, the staff line added after 2, the Renovate Right pamphlet line, the panel
  "Never take the panel cover off" line, the selections line, and every section script for bath,
  kitchen, addition, basement, deck and whole.
- **Consent wording is verbatim and true.** Notice `consult-2026-11-v2`, `{tablet/phone}` as the only
  variable, no "audio is kept", and "backups keep copies for a limited time". The button words,
  recorded-confirmation line, 45 s countdown, banner, stop sheet and new-person line all match §8.1.
  Phase 1 records the manual choice and shows no consent card (`model.ts:372`). That is honest:
  nothing is recorded, so nothing needs asking.
- **MN/IRC flags are correct and cited.**
  - Smoke/CO: R314/R315 and 299F.51 (10 ft).
  - Tempered glass: R308.4.1/.2/.3/.5/.6/.7 across `window`, `door` and `openings`.
  - Toilet: rough-in ≠ 12″, under 15″ to the side, under 24″ in front, 30″ centre-to-centre, with
    4714/UPC.
  - Makeup air: hood > 300 cfm under Minn. R. 1346.0501. Every input the tables need is captured:
    year 1994+ (derived, unknown year → conservative), venting type per fuel appliance (atmospheric /
    fan-assisted / power / direct / solid), dryer, and other fans' cfm. An atmospheric appliance plus
    new exhaust fires the backdraft check. There is no IRC M1503.6 and no blanket 400-cfm rule.
  - Egress: ≥ 20″ wide, ≥ 24″ high, 5.0 sf for grade-floor/below-grade or 5.7 sf otherwise, sill
    ≤ 44″, well ≥ 36″ each way and ≥ 9 sf. "Uncertain" falls through to 5.7, which is conservative.
  - Basement: R305.1.1 76″ under beams, 84″ habitable, stair headroom 80″, R302.7 under-stair drywall.
  - Deck: 30″ guards (R312.1.1), 7¾″ risers, handrail at 4+ risers. The permit trigger is attached,
    > 30″, > 200 sf or serving a required exit door. No ledger on veneer; I-joist rim needs an
    engineered detail. Private lines that 811 won't mark. 216D/811 on digging.
  - Lead (RRP): pre-1978, more than 6 sf inside / 20 sf outside, window replacement never "minor
    repair" (745.83), certified renovator and firm cert with expiry, Renovate Right with initials and
    the 60-day re-delivery note.
  - Asbestos screen before 1981 (MDH-licensed abatement); knob & tube before 1950; vermiculite; FPE,
    Zinsco, Pushmatic and fuse panels; lead service line; Orangeburg.
- **Derivations are careful.**
  - An input that doesn't apply counts as 0; a missing input makes a gap, never zero.
  - Pitch factor uses a lookup table because `formula.ts` has no √.
  - Floor-tile area subtracts the tub footprint only when the tub stays.
  - Wall-tile area branches on shower, tub or wainscot.
  - Railing is 0 at ≤ 30″, and a non-rectangular deck is a gap.
  - The new basement labels are declared in a versioned registry rather than inserted as strings.
- **Completion (§10.3).** `completeness.ts:66–77` has exactly 11 checks in plan order, with no owner or
  review state.
  - Check 9 accepts only the four dispositions and needs actor, time and note.
  - Check 10 needs the full assumption (text, responsible trade, verification point).
  - Check 11 needs Yes/No + reason per touched trade, or an explicit "None".
  - The skip reasons and their help text (`words.ts SKIP_REASONS/SKIP_HELP`) are §10.2's, in order.
    Status labels are §10.1's.
- **The seed builder's judgment calls are sensible.**
  - Compound rows are split into separate fields (permit authority ×3, alarms ×3, fan details ×6,
    appliance details).
  - The `visit` context module lets "template ∈ …" compile against a real field.
  - "Tile floor" is read as the bath template.
  - "Large tub" is read as Freestanding tub or body sprays.
  - `garage.attached` was added so "R? attached" can be evaluated.
  - `basement_scope.new_partitions` was added because the plan's formula needs it.
  - `addition_scope.wall_height` is derived.
  - `heated_floor_area` is typed rather than drawn as a polygon (there is no drawing tool in Phase 1).
  - A "photograph a hand sketch" shot stands in for the sketch canvas until Phase 4.
- **On-screen words are mostly Joe's and plain.** Examples: "Skip this field…", "Needs a sub
  walk-through before pricing", "Not an issue — reason", "Hand back — hold 2 seconds", "Price-critical
  15/205 · Record 0/2". No sync/lease/precache jargon reaches the visitor.

---

## Wrong / missing

### A. Visits with more than one template drop required content (blocker)
Plan §5.1/§6.9 allow several templates per visit (the QA visit is Bathroom + Kitchen); §7.4 and §7.5
each list their own modules and minimums.

- `lib/consult/ui/model.ts:217–219` merges modules across templates with "first entry wins".
  `controller.ts:311` takes presets from the **first** template that lists the module.
- Result for Bathroom + Kitchen, confirmed by `consult-r1b/FAIL-tabletP-10-client.png` and
  `FAIL-tabletL-07-skip.png`:
  - **No Panel section.** The bath's conditional `panel` (heated floor or new circuits,
    `templates.ts` bath) overrides the kitchen's required `panel`. A kitchen visit without the panel
    can't price induction, circuits or a service upgrade.
  - **Only "Room 1".** The kitchen room is never required; the bath's min 1 wins.
  - **Only "Fixture 1, 2".** The bath + kitchen minimum is toilet + bath sink + kitchen sink = 3.
  - **Only the 15 bath selections.** Cabinets, countertop, appliance package, hood, backsplash and the
    rest are never created. Closing line 3 (`{open_selections}`) then leaves out the biggest open
    choices.
- Related cases with the same cause:
  - Whole-home selections are `min: 0` with no presets (`templates.ts` whole), so "union of nested
    lists" (§7.9) isn't built.
  - Basement "+ bath list if a bath" (§7.7) is only a label.
  - General's conditional `hvac` would override the bath's required one if General came first.

### B. Opening line 3 tells the client "offer separate visits" (wrong spoken words)
- §7.2: `{duration}` comes from the template and is **spoken**: "It takes about {duration}."
- `VisitScreen.tsx:34` fills it with `visitDuration()` (`words.ts:343–348`). That function returns
  "2 hours + 90–120 min; offer separate visits" (see `owner-desktop-02b-schedule-filled.png`) or
  "3–4 hours; offer separate visits". The visitor would read the office note aloud.
- As an office estimate it is also unclear:
  - It mixes minutes and hours.
  - It gives no total.
  - Its order follows the order of the clicks.
  - It ignores add-ons (Flooring, Garage, Windows & doors all add time).
  - Whole-home drops the plan's "or two scheduled visits".
  - "90–120 min" is office shorthand, not how anyone says it to a client.
- **The rule itself is right** (two templates together ≈ 3½–4 h, so offer to split). The wording and
  where it shows up are wrong.

### C. Renovate Right check at close isn't tied to the Era answers (legal)
§10.3 check 8; §7.3 `era`; §8.2.
- `WrapClose.tsx:120–131` asks three free checkboxes (pamphlet/receipt, firm current, renovator
  current) that never read the seed's Era fields:
  - `era.pamphlet_given`
  - `era.pamphlet_initials`
  - `era.renovator_expiry`
  - `era.firm_cert_expiry`
  
  So a visitor can answer "Pamphlet given: No" in Era and still tick "given" at close, or tick
  "certification is current" over an expiry date already past.
- `model.ts:319` sets `rrpApplies` = year < 1978 or unknown. The seed's rule is pre-1978 **and**
  (paint disturbed > 6/20 sf **or** window/door replacement) (`shared.ts:393`). A pre-1978 job that
  disturbs no paint (for example a freestanding deck off vinyl siding) is still blocked at close.
- `era.pamphlet_given` is a yes/no where "No" counts as answered, with no flag.

### D. Flags that fire on every answer (noise teaches visitors to click "Not an issue")
Each of these must be decided on every visit even when nothing is wrong:

| Seed location | What happens | Plan intent |
|---|---|---|
| `shared.ts:284–286` `water.main_stack` | fires on **every** cast-iron stack (most pre-1960 Twin Cities homes) | §7.3 "Cast iron *with cracks*" |
| `template-modules.ts:349` `basement_scope.water_ever` (text) | fires when the answer is "never" | §7.7 "⚑ any" |
| `template-modules.ts:552–554` `garage.separation` (text) | fires "IRC R302.6 separation **missing**" on any answer, including "all in place" | §7.11 "⚑ missing" |
| `template-modules.ts:245` `addition_scope.openings_lost_count` | says "bedroom egress lost" for any covered window, even a kitchen one | §7.6 |
| `template-modules.ts:329` `basement_scope.rim_insulated` | fires on Yes too | §7.7 |
| `shared.ts:431–433` `exterior_site.lot_line_front` | always fires with the words "under the city setback" | §7.3 "Joe checks the city" — always firing is fine; the words claim a fact nobody checked |
| `template-modules.ts:248–252` lot controls / `431–433` deck `foundation_to_footing` | always fire | acceptable only if the words read as a check, not a finding |

### E. All-electric homes can't complete the venting rows
§7.3 `hvac` "How each fuel-burning appliance vents".
- `templates.ts` `hvacVents(true)` sets `min: 1` for bath, kitchen, addition, basement and whole.
- `hvac_vent.fuel` (`shared.ts:329`) has no Electric/None option.
- So a heat-pump house with an electric water heater must invent a row or skip three fields.

### F. Half baths and baths without a fan
§7.4 `bath_scope`.
- `tub_shower_plan` (`template-modules.ts:54`) has no "None — half bath", yet Bath type offers "Half".
- The existing tub/shower footprint (`:55–56`) is R for every bath.
- The six fan-detail fields (`:31–38`) are R even when `fan_now` = None. The exit options have no
  "Into the attic / None", which contradicts `fan_now` and `hvac.fan_vents_to`.

### G. Footings: no 42″ default, and no guard on shallow footings
§7.3 `footing`; §8.2 "Decks".
- `shared.ts:456` puts "default 42 in" only in help text. No prefill derivation exists
  (`derivations.ts` has only `era.before_1978`).
- No flag fires on Floating, Frost-protected shallow or depth < 42″. §8.2 says "written AHJ
  exception/detail before pricing a shallow footing", and nothing enforces it.

### H. Egress: deep well with no ladder can read "Meets egress"
§7.7 `egress`.
- "> 44″ → ladder required" is help text only (`template-modules.ts:401`).
- `derivations.ts` `meetsEgress` ignores well depth. A 60″-deep well with no ladder reads "Meets
  egress" (R310.2.3.1).

### I. Script placeholders read wrong aloud
§7.2. Code at `VisitScreen.tsx:34–35`.
- Before a date is picked, Closing line 2 reads "You'll have the formal estimate by **the date you
  pick below**."
- With no open selections, line 3 reads "The things still to choose are: **none**. Those don't hold
  up the estimate…".
- `{helper}` is always stripped. That is acceptable for single-visitor Phase 1, but should be noted.

### J. Smaller seed issues
- `window.size` range `[12,144]` applies to the height as well; the plan says 12–120 (`shared.ts:148`).
  `door.slab_size` `[18,96]` allows a 96″-wide or 18″-tall slab (`:182`).
- Water heater capacity: "tub > 60 gal" is approximated by Freestanding tub only (`shared.ts:267`).
  A deep drop-in soaker in a new tub-shower is missed.
- `era.firm_cert_number/expiry` are typed on every visit. They should prefill from Settings, which
  also prevents typos in a legal record.
- §8.2 leaves the MDH state program (144.9505 subd. 1h) versus EPA open. Joe's attorney approval
  covered consent and retention, not RRP. The firm-cert label should not imply which agency issues it.
- Touched trades (`model.ts:197`) come only from panel, plumbing and HVAC modules. Structure (bearing
  wall or engineer flag), footing/excavation and abatement never prompt a trade-walk decision; the
  visitor must remember "+ Add trade".
- The office schedule screenshot shows a door code typed into Visitor notes. §7.3 keeps codes in
  `access.entry_code`, masked and internal. The notes field could carry a "no codes here" hint.

---

## Required to reach 10

1. **Merge templates by union, not first-wins** (`model.ts:217–227`, `controller.ts:311–321`):
   - `required` = OR of every pinned template's condition (a plain R beats a conditional).
   - `min` = the sum for per-area repeatables (`room`, `plumb_fixture`, `door`) and the max for others.
   - Selection presets = every pinned template's list. Prefix each with its area ("Bath — Sink",
     "Kitchen — Sink"), because a bath sink and a kitchen sink are different decisions. Add a `whole`
     preset built from its nested templates, and the basement bath list when `rooms_wanted` includes
     Bath.
   - Add a seed test: Bathroom + Kitchen yields Panel, ≥ 2 rooms, ≥ 3 fixtures and all 30 selections.
   - Label pre-created instances with their template ("Room 1 — bath", "Room 2 — kitchen").
2. **Split spoken duration from the office hint.**
   - Opening line 3 gets only a spoken phrase: "about an hour and a half to two hours", "about two
     hours", "about three and a half to four hours".
   - The office shows "Estimated visit: about 3½–4 hours (Kitchen 2 h + Bathroom 1½–2 h) — offer two
     visits".
   - Whole-home: "3–4 hours, or two scheduled visits".
   - Add-ons add time or show "+ add-ons".
   - Use hours throughout.
3. **Drive check 8 from the Era answers:**
   - `receipt` = `era.pamphlet_given` true **and** `era.pamphlet_initials` committed (or a reasoned skip
     that files the deliver-before-start to-do).
   - `renovator_current` / `firm_current` = the expiry dates on or after the visit date (and the planned
     start when known).
   - `rrpApplies` uses the seed's rule; unknown year stays conservative.
   - `pamphlet_given = No` fires a flag "Renovate Right not given — give before work starts". Keep the
     close sheet as a read-out with Go to field, not free checkboxes.
   - Prefill firm cert # and expiry from Settings.
4. **Give every always-firing flag a real trigger, or wording that reads as a check:**
   - `water`: add "Cracks, rust or weeping on the stack?" yes/no; flag Orangeburg, or cast iron + yes.
   - `basement_scope.water_ever`: yes/no + "When and where" (R? yes); flag on yes.
   - `garage.separation`: choice "In place / Missing / Not sure" + details; flag Missing/Not sure.
   - `addition_scope`: flag only when the room affected is a bedroom, or word it "Check: does this
     remove a bedroom's egress window?".
   - `rim_insulated`: flag on No.
   - Lot-line text: "Check the city setback for these distances."
   - Lot-controls / footing-line texts: phrase as checks.
5. **Fuel-burning appliances:**
   - Add `hvac.fuel_appliances` yes/no (R on the same templates).
   - Make `hvac_vent` min 1 only when yes.
   - Add "Electric" / "None" handling, or hide the module when no.
6. **Bath:**
   - Add "None — half bath" to `tub_shower_plan` and make the tub/shower footprint, shower and glass
     fields conditional on it.
   - Fan details: R? `fan_now` ≠ None (or relabel them as the new fan's route when there is none).
   - Add "Into the attic" and "None" to the fan exit options.
7. **Footings:**
   - Prefill `footing.required_depth` = 42 (editable; 60 when the city says northern zone).
   - Add a flag when `footing_type` ∈ {Floating, Frost-protected shallow} or `required_depth` < 42:
     "Shallow footing — written city-approved detail before pricing (Minn. R. 1303.1600)".
8. **Egress:**
   - Add "Ladder or steps in the well?" yes/no, R? `well_depth` > 44.
   - `meetsEgress` requires it when depth > 44″.
   - Add a test case: a 60″ well with no ladder → New egress needed.
9. **Placeholders:**
   - Hide Closing line 2's date clause behind a direction ("Pick the date below first") until
     `closing.estimate_promised` is set.
   - Skip Closing line 3 when no selection is open.
10. **Ranges and triggers:**
    - Per-component ranges for `length_pair` (window height 12–120, door width 18–72 / height 72–96).
    - The water-heater capacity trigger also covers a new tub-shower with a stated tub capacity
      > 60 gal (add the "New tub capacity (gal)" field, O unless soaker).
    - Map `structure` (a bearing/engineer flag fired) → "Engineer/framer" and `footing` / `era`
      asbestos → their trades in touched trades, so check 11 asks.
