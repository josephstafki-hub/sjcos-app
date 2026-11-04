# Build R2 — Contractor & legal judge (in-home consult)

SCORES: design=8 completeness=8

**What I read:**
- My round-1 review and `build-consult-r1-logic-handoff.md`.
- `git show 29ecd58d b3b54399 82dbf71b`.
- All of `lib/consult/forms/seed/*`, plus `lib/consult/rrp.ts`, `lib/consult/template-merge.ts`,
  `lib/consult/completeness.ts`, `lib/consult/ui/words.ts` (timing), `VisitScreen.tsx` (script fill),
  `ScheduleDialog.tsx` and the Settings cert fields.
- Screenshots in `/tmp/sjcqa/shots/consult-r3b/`: tabletL 05/08/09/20/22/23/24, phone 05, and the
  owner-desktop shots.

**What I couldn't see:** the schedule dialog's estimate and the opening line 3 screen. Both captures
failed (`FAIL-o-schedule.png` is a timeout, and the opening shots are `FAIL-*`), so I judged them
from the code only.

**What I ran:** nothing. No servers, builds, browsers, tsc or tests.

The big round-1 blockers are fixed:
- Bathroom + Kitchen now gets a Panel, 2 rooms, 3 fixtures and all 30 selections.
- The spoken time is spoken words.
- The Renovate Right gate reads the Era answers.
- The noisy flags have real triggers.

Most of the 55 new hints are true and useful. What still keeps this from a 10:
- Two holes in the RRP gate, where it can come out non-conservative.
- Closing line 3 can't be read aloud on a combined visit.
- The client summary uses names a homeowner won't recognise.
- Flag text is still the plan's shorthand on the visitor's screen.
- About eight hints are incomplete or misleading.

---

## Round-1 items

| # | Item | Status |
|---|---|---|
| 1 | Merge templates by union | **Done.** `template-merge.ts` ORs required conditions, sums room/fixture/door/selection minimums, takes the max for shared systems and prefixes presets ("Bath — Sink", "Kitchen — Sink"). The basement Bath answer adds the bath list. The screenshots confirm Panel 1, Room 1–2, Fixture 1–3 and the Kitchen — … selections. **Not done:** pre-created instances aren't labelled with their area. The rail and client view say "Room 1", "Room 2", not "Room 1 — bath" / "Room 2 — kitchen" (tabletL-08, tabletL-24). See N3. |
| 2 | Spoken duration vs office hint | **Done.** `spokenDuration` → "three and a half to four hours" for bath + kitchen, "an hour and a half to two hours" for a bath, "forty-five minutes" for general. The office line includes add-ons with a per-part breakdown and "offer separate visits". One nit: whole-home **speaks** ", or two scheduled visits". By the time of the visit that's already decided. Speak "about three to four hours" and keep "or two scheduled visits" on the office line only. Not checked visually (capture failed). |
| 3 | RRP check driven by Era | **Mostly done.** `rrp.ts`: receipt = given **and** initials; both expiries ≥ max(visit, planned start); redelivery to-do; Settings prefill exists (`SettingsClient.tsx:266–267`); "Pamphlet given = No" flags. **Two logic holes remain** (N1, N2). |
| 4 | Always-firing flags | **Done.** Stack cracks yes/no; Water ever yes/no + "When and where?"; separation is In place / Missing / Not sure; rim flags on No; the bedroom-egress, setback and undisturbed-soil flags read as checks. One small fix: the "Not sure" separation answer says "IRC R302.6 separation **missing**". Use "separation missing or not confirmed (IRC R302.6)". |
| 5 | All-electric homes | **Done.** "Any fuel-burning appliances?" is required; vent rows are only needed when it isn't No; the fuel list has "Electric — no venting" and venting has "None". |
| 6 | Half bath, fan | **Done.** "None — half bath" is an option and makes the footprint conditional. Fan details apply only when fan ≠ None. Exit options include "Into the attic" and "None". |
| 7 | Footings | **Done.** 42 is prefilled and editable. Floating, frost-protected shallow or a depth under 42 flags "written city-approved detail". The hint wording needs a fix (H2). |
| 8 | Egress | **Done.** Ladder question when depth > 44. `meetsEgress` requires a ladder or steps, and grade-floor openings skip the well checks. Small fix: `well_ladder` sits **above** `well_depth` in the field order, so the question appears above the answer that triggers it. Move it below. |
| 9 | Placeholders | **Half done.** The empty-selections line is dropped. But "Pick the date below first." shows up **as a quoted script line** (tabletL-23, inside SCRIPT with quotes), so a visitor reading the script aloud will say it to the client. It must look like a direction (no quotes, different style, e.g. "→ Pick the estimate date below, then read this line"). |
| 10 | Ranges, tub capacity, trades | **Done.** Per-part ranges for window (12–144 × 12–120) and door (18–72 × 72–96). `new_tub_capacity` > 60 triggers the water-heater check. Structure, footing and asbestos add Engineer/framer, Excavation/foundation and Abatement to the touched trades. |

---

## Hints check

I checked every one of the 55 hints. All of these are true and useful as written:
- Photos "No"
- County record for year built
- Entry code stays internal
- Ahead wall / doorway facing in
- Casing clearance
- "Type both at once"
- Jamb width
- Tub drain end
- Floor continues into
- Soffit per wall
- Wall letters clockwise
- Protected trees
- Drafting-package to-do
- Gravity drain "Unknown"
- Grade class "Uncertain"
- Egress width ≥ 20 in with the sash open (R310.2.1)
- Wells ≥ 36 in each way and ≥ 9 sf (R310.2.3)
- Guards over 30 in (R312.1.1)
- Total rise
- Shape sketch
- Rooms / stairs 0
- Roof pitch x/12
- Water-heater label
- Exhaust fans that count
- Joist size example
- Attic hatch
- Firm cert expiry
- Kids / pregnant with no names
- Before 1978 prefill (but see N1)
- City prefill
- Real product, never "or equal"
- Their budget words, never a price
- Summary prefill
- Estimate date to-do
- "Goes to Joe only"

These are wrong, misleading or missing the useful part. Each has suggested wording:

| # | Field | Current | Problem | Use instead |
|---|---|---|---|---|
| H1 | `house.permit_electrical` | "DLI is the state electrical inspector." | It's true but only half the answer, and it doesn't help the visitor choose. DLI (Minnesota Department of Labor and Industry) inspects electrical work statewide **except** in cities that run their own electrical inspection (Minneapolis and St. Paul do). The licensed electrician files the inspection request. A staff visitor can't know which applies, and neither can the client. | "Most cities use the state (DLI, the Dept. of Labor and Industry). A few, like Minneapolis and St. Paul, inspect their own. Not sure? Pick Not sure — Joe checks." Add a **Not sure** option, and prefill all three permit-authority fields from `exterior_site.city` in the office. The QA run shows "Owner lives here" typed into the building/plumbing field, which shows visitors don't know what goes there. Give that field a hint too: "Usually the city building department. Write the city, or Not sure." |
| H2 | `footing.required_depth` | "Usually 42 in in the metro and 60 in up north." | "Metro" undersells it. Minn. R. 1303.1600 sets 42 in for **all of southern Minnesota** (Zone I) and 60 in for the listed **northern counties** (Zone II). Rochester, Mankato and St. Cloud are 42, not "up north". | "42 in across southern Minnesota, metro included. 60 in in the northern counties. The city's handout is the final word." |
| H3 | `egress.clear_height` | "Egress needs at least 24 in." | True, but misleading by omission. 20 × 24 meets both minimums and is only 3.3 sf. The opening also needs **5.7 sf** of clear area, or 5.0 sf at grade or below (R310.2.1 and its exception). A visitor who sees both minimums met will think the window passes. | "Egress needs at least 24 in high **and** at least 5.7 sf open (5.0 sf at or below grade). 20 × 24 alone is not enough." |
| H4 | `egress.floor_to_sill` | "Egress needs 44 in or less." | Doesn't say where to measure. R310.2.2 measures to the **bottom of the clear opening**, not to the stool or trim. | "Floor to the bottom of the open sash, not the trim. Egress needs 44 in or less." |
| H5 | `egress.well_depth` | "Deeper than 44 in needs a ladder." | R310.2.3.1 requires a **permanently attached** ladder or steps. | "Deeper than 44 in needs a permanent ladder or steps in the well." |
| H6 | `room.out_of_level` | "The biggest gap under a long level laid across the floor." | This describes **flatness** (dips), not **level**. Measured this way, a floor that's flat but 1 in low across the room reads 0. Level matters for cabinets, and the kitchen is one reason this field is required. | "With a laser, or a level held level, how much lower the low side is than the high side." If tile flatness is also wanted, add a separate field: "Biggest dip under a 10 ft straightedge" (tile needs about ¼ in in 10 ft). |
| H7 | `basement_scope.must_stay_reachable` | "The panel needs 30 in wide by 36 in clear in front of it." | Leaves out height, and that it must stay empty. NEC 110.26 (adopted in MN): 30 in wide (or the width of the panel), 36 in deep, 6½ ft high, with nothing stored or built in that space. A soffit or a finished wall in that space breaks the rule. | "In front of the panel: 30 in wide, 36 in deep and 6½ ft tall, kept empty — no shelves, soffits or walls in it." |
| H8 | `deck_scope` post spacing | "Posts no more than 8 ft apart on each beam line." | Reads as a code rule. It's SJC's starting layout. Real post spacing comes from the beam size and joist span (IRC R507.5 tables) and footing size. | "Start with posts about 8 ft apart. Joe sets the final spacing from the beam size." |
| H9 | `deck_scope.hot_tub_dry_weight` | "From the spec sheet or the client." | Dry weight isn't what the engineer designs for. **Filled** weight (water plus people) is, and it's typically 3–5× the dry weight. | "From the spec sheet. Also write the gallons — the engineer needs the filled weight." |
| H10 | `hvac_vent.venting` | "…Power-vent: fan on top, plastic pipe out the wall…" | "Fan on top" describes a power-vent **water heater**. A single-pipe 90 % furnace has its fan inside and one plastic pipe, so it doesn't match any choice as written. A visitor will guess "Fan-assisted" (metal flue) or "Direct-vent" (two pipes). | "Power-vent: one plastic pipe out the wall or roof, fan on top (water heater) or inside (furnace). Direct-vent sealed: two plastic pipes, or one pipe inside another." |
| H11 | `era.pamphlet_given` | "It has to reach the client within 60 days before work starts." | True (40 CFR 745.84(a)), but "within 60 days before" reads two ways. | "Give it no more than 60 days before work starts, and get their initials. If work starts later, we give it again." |
| H12 | `exterior_site.will_dig` | "If yes, call 811 (Gopher State One Call) before anyone digs." | It's missing the lead time and the private-lines warning that the plan already has. | "Whoever digs calls 811 at least 2 business days ahead (Minn. Stat. 216D). 811 doesn't mark private lines — yard lights, sprinklers, gas to a grill." |
| H13 | `bath_scope.elec_gfci` | "The electrician will check it." | Doesn't tell the visitor how to answer. | "Is there an outlet or breaker with Test/Reset buttons? The electrician confirms." |
| H14 | `kitchen_scope.circuits_countertop_20a` | "Count the 20 A breakers that feed the countertop outlets." | A visitor can't trace circuits, so this invites a guess. | "From the panel labels. Can't tell? Skip it with Can't tell — the electrician counts." |

A note on code numbering: I've cited 2018-IRC section numbers (the 2020 MN Residential Code, Minn. R. ch. 1309). If the 2024-based MN code is in effect for these permits, egress moves to a new section number, but the requirements cited here (20 / 24 / 5.7 / 5.0 / 44 / 36 / 9 / ladder) are unchanged. Keep the citations in the internal `note` and the numbers in the hint, as the builder did.

---

## New issues

**N1. The "Built before 1978?" override doesn't work the way its hint says (legal).**
- The hint says "Filled from Year built. Change it if that's wrong."
- `rrp.ts:4` computes `before = era.before_1978 !== false && (year is not a number || year < 1978)`.
- So a typed year of 1985 changed to **Yes** still gives `applies = false`. The conservative override
  is ignored, and the close gate passes while the seed's `rrpApplies` (`shared.ts:396`) is asking for
  renovator and pamphlet fields. The gate and the form disagree.
- A 1965 year changed to **No** is honoured silently. That's the non-conservative override, and it
  has no reason attached.
- **Fix:**
  - Use `era.before_1978` when it is answered, and the year rule only when it isn't.
  - Make **No** against a year before 1978 a flag that needs a note ("year says 19xx — why not
    pre-1978?").
  - Use one definition for both `rrp.ts` and the seed's `rrpApplies`.

**N2. If "disturbs more than 6/20 sf" is unknown, RRP is treated as not applying (legal).**
- `applies` needs `disturbs_paint === true`. If the visitor skips that field with a counting reason,
  check 8 passes and the renovator/pamphlet fields stop being required, even on a 1954 kitchen gut.
- **Fix:** treat it as applying unless the answer is explicitly **No** (pre-1978 and disturbs ≠ false,
  or window/door replacement). Do this in both `rrp.ts` and the seed condition. A whole-room bath or
  kitchen tear-out could also prefill it to **Yes**.

**N3. The client summary uses names the homeowner won't recognise, and promises a return visit
(tabletL-24).**
- "We'll come back to: Room 1, Room 2, Bath 1, Kitchen." The homeowner doesn't know what "Room 1" is.
  "We'll come back to" reads as a promise to come back to the house, which may not happen (the
  Finish-consultation to-do can be done by phone).
- **Fix:**
  - Label pre-created instances by area (round-1 item 1, last bullet) and use the room's name when it
    has one.
  - Write it as "Not measured today: the bathroom, the kitchen."
  - "NEXT / formal estimate" is lowercase and has no date. Make it "Next: Joe sends your formal
    estimate by Tue, Nov 17", or "Next: Joe sends your formal estimate" when no date is set.
- The grouped "Still to decide" (5 shown, then "+ 10 more for the estimate") and "It is not a contract
  or a price" read well.

**N4. Closing line 3 can't be read aloud on a combined visit (tabletL-23).**
- `{open_selections}` fills with 30 items: "Bath — Vanity, Bath — Vanity top, Bath — Sink, … Kitchen —
  Appliance package (each appliance), …". Nobody can read that to a client.
- **Fix:** speak it grouped and capped, in the same order as the client view: "for the bathroom: the
  vanity, top, sink, faucets and toilet, and ten more; for the kitchen: the cabinets, finish, hardware,
  countertop and edge, and ten more". Drop the "Bath —" prefixes and anything in parentheses. Keep the
  full list on the summary.

**N5. Flag text on the visitor's screen is still the plan's shorthand.**
- `FieldRow.tsx:226` and `WrapClose.tsx:103` render `issue` verbatim, and the hint pass didn't cover
  flags. A staff visitor sees text such as:
  - "⚑ Flag · any → moisture plan"
  - "> wall available"
  - "Orangeburg; Cast iron with cracks"
  - "1322 wall/rim insulation; sub verifies required R-values"
  - "10″/14″ rough — check toilet model"
  - "<24″; 4714/UPC; also 15″ each side, 30″ centre-to-centre"
  - "window replacement never minor repair at any size (745.83); door disturbance assessed separately,
    conservative RRP review"
  - "clear path out R310"
- **Fix:** apply the same split as the hints. Plain `issue` text the visitor reads, with the citation
  moved to a note Joe sees. Examples:
  - "Water got in before — we'll need a plan to keep it dry"
  - "Cracked cast-iron stack — plumber looks before we price"
  - "Rim joist not insulated — insulation sub confirms"
  - "Window replacement on a pre-1978 house — lead-safe rules apply"
- Extend `consult-hints.test.mjs` to cover `issue`.

**N6. "Before you wrap" and the close result give different totals (tabletL-20 vs tabletL-22).**
- The wrap sheet says "241 Open". The close result says "264 open". The 264 adds 10 unsent items,
  8 flags and 5 failed checks to the 241 answers and photos.
- **Fix:** show the same count in both places, or have the close result say "212 answers, 29 photos,
  8 flags, 10 not sent".
- The grouping itself makes sense: one row per section with "n open" and Go to section.
- I couldn't see the RRP read-out in the wrap sheet in any capture, so its wording is unchecked.
- QA follow-up: the close result shows "Every room and item the template needs" failing on this
  barely-started visit. That may be correct (vent rows not yet created), but QA should confirm it
  passes once a real combined visit is filled in.

**N7. Smaller items**
- The rail on a combined visit runs 50+ sections, because each of the 30 selections is its own
  section. Consider one "Selections — Bath" and one "Selections — Kitchen" group that expand. This
  overlaps with the design judge.
- `Kitchen wall 1 — Kitchen` repeats the word. Use "Kitchen wall A" from the wall letter.
- The footing flag uses `required_depth < 42`, but there's no "planned depth" field, so a shallow
  pier under a 42-in city rule can't be flagged unless "Frost-protected shallow" or "Floating" is
  picked. Add "Planned footing depth" (R on deck/addition/garage) and flag when planned < required.

---

## Required to reach 10

1. **RRP gate:**
   - The `era.before_1978` answer wins over the year (N1), and No against a pre-1978 year needs a note
     or flag.
   - Unknown or skipped "disturbs paint" counts as applies (N2).
   - Use one shared definition in `rrp.ts` and `shared.ts` `rrpApplies`, and add tests for:
     - 1985 + Yes → applies.
     - 1954 + disturbs skipped → applies.
     - 1954 + No without a note → flag.
2. **Closing script:**
   - Line 3 spoken grouped by area and capped, with no "Bath —" prefixes (N4).
   - "Pick the date below first" shown as an unquoted direction, not a script line (item 9).
   - Whole-home spoken duration without ", or two scheduled visits".
3. **Client summary:**
   - Area-labelled or named rooms; "Not measured today: …" instead of "We'll come back to".
   - "Next: Joe sends your formal estimate by {date}" (N3).
4. **Flag text:**
   - Plain `issue` wording, with citations moved to notes, extending the hint test (N5).
   - Separation "Not sure" says "not confirmed".
5. **Hints:**
   - Apply H1–H12 as worded above. At minimum: H3 (egress area), H6 (level vs flat), H2 (zone
     wording), H1 (+ Not sure option and office prefill of permit authorities), H7, H8 and H10.
   - H13–H14 are nice-to-have.
6. **Order and counts:**
   - Put `well_ladder` after `well_depth`.
   - Make the wrap and close totals agree (N6).
   - Add a planned footing depth with a planned-vs-required flag (N7).
7. **QA proof:**
   - Re-capture the schedule dialog (office estimate with add-ons) and opening line 3 with a
     Bathroom + Kitchen visit.
   - Capture the wrap sheet's RRP read-out on a pre-1978 visit.
   - Show check 3 passing on a filled combined visit.
