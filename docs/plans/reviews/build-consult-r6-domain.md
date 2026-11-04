# Build R6 — Contractor / Minnesota domain judge (in-home consult)

SCORES: design=8 completeness=9

**What I read:**
- My round-5 review (`build-consult-r5-domain.md`). I checked every required item in it.
- `git show c2707285 f5b2668a 2f30e57d`.
- `lib/consult/forms/seed/{shared,template-modules,templates,scripts,derivations,helpers}.ts`, `lib/consult/rrp.ts`,
  `lib/consult/derive.ts` (`scalar`), `lib/consult/template-merge.ts`, `lib/consult/ui/{words,model,controller}.ts`,
  `components/consult/field/{Keypad,ClientView,SkipSheet}.tsx`, and the new R5 tests in
  `tests/consult-r4-logic.test.mjs`.
- Screenshots in `/tmp/sjcqa/shots/consult-r6/` (Bath + Kitchen, fresh DB): phone-05/06-*, 07b, 14, 15c, 16b, 17–17e,
  18b, 20/20b, 21, 24/24b, 29c; tabletP-15b, 18b, 20b, 29b; tabletL-07b; w320-22a/22b/24b;
  owner-desktop-31b. Also `log.json` and `log-b.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- "1965" typed into Permit authority (tabletL-07b).
- The w320 run skipped the **client initials** instead of the date (w320-22b shows the date as Covered).

---

## Round-5 items

| # | Item | Status |
|---|---|---|
| 1 | Summary text is required but nothing fills it | **Mostly done.** `closing.summary` is now optional. When the client taps This is what we went over, the client view's text is saved as the summary answer, in the same commit as the initials blob (`controller.photo`, `offline-engine.captureBlobWrite`). The test checks it. The hint now reads "What the client initialed." **One hole: the visitor can still type into it. See Fix 4.** |
| 2 | Date before initials | **Done.** `estimate_promised` now comes before `client_initials`. The wrap shows "→ Pick the estimate date first, so the client sees it." and Show to client stays grey until the date is picked (phone-20). tabletP-18b reads "You'll have the formal estimate by Thursday, November 12." phone-24 reads "Joe sends your formal estimate by Thu, Nov 12." |
| 3 | Vented-appliance rows only after a server refresh | **Done.** `answer()` now runs `ensureRequiredInstances()` after every answer. The test answers Yes offline and gets the row. The log shows "Vented appliance 1" on phone and tabletL. Missing child slots are listed in their section. |
| 4 | No 1/16 keys | **Done, but too wide. See Fix 7.** The 16ths row is right: eight keys beside the 8ths from 768 px (tabletP-15b), and a Show 16ths / Show 8ths swap on phones (phone-15c). Room length stays at 8ths (phone-14). But `len()`/`pair()` now default every length to 1/16. |
| 5 | Year unknown + "No" turns RRP off without a reason | **Logic done, words not.** `rrpYearConflict` is now `before_1978 = No AND not(year > 1977)`, and the test checks year unknown + No. The relabel was not made. **See Fix 2.** |
| 6 | Pamphlet line when the year is unknown | **Partly done.** `PAMPHLET_UNKNOWN_YEAR_LINE` is shown when `house.year_built` isn't a number. It drops "the law requires us", which is right. **It also shows when the visitor tapped Yes, and "after 1978" is the wrong boundary. See Fix 3.** |
| 7 | Kitchen sections sat below the 30 selection rows | **Done.** The catalog sort puts selections second to last and Closing last. The test checks that the order doesn't depend on which template comes first. On tabletL-07b, Kitchen work, Appliance and Kitchen walls come right after Bathroom work. See Extra E1 for the bath fixtures. |
| 8 | QA proof | **Mostly done.** Captured: opening lines 1–5 with {duration} filled in as "three and a half to four hours" (phone-06-2); line 4b; closing lines 2–3 with a date picked (tabletP-18b); the client view after a date was picked (phone-24); the 16ths keypad; the vented row; the close result; and the office look-over. **Still not captured: see Fix 9.** |

---

## The kitchen-and-bath walk: can a carpenter price it without coming back?

Yes. All the fields I listed in R5 are still there:
- room, wall and cabinet-run measurements;
- appliance cutouts;
- vanity wall vs. vanity width;
- toilet rough-in and clearances;
- shower drain center and threshold build-up;
- panel, water heater, hood and make-up air;
- structure and moisture;
- 15 + 15 selections with who buys them.

New this round:
- **Cabinet measurements at 1/16.** Kitchen wall lengths, base and upper runs, sink base, island and cutouts can now
  be typed in 16ths. That's right for a cabinet layout.
- **Vented appliances right away.** A fuel-burning Yes now creates the vented-appliance row on the spot, even offline.
  That's what the backdraft and make-up-air checks (Minn. R. 1346.0501) need.
- **A record of what was initialed.** The office now gets the exact text the client initialed, stored with the
  initials.

**Minnesota checks:**
- **Frost (Minn. R. 1303.1600).** Unchanged and still right: Zone I (northern counties) 60 in, Zone II (southern,
  metro included) 42 in. There's no silent default, and the city's handout is the final word.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** The consent script is unchanged. It asks permission and doesn't
  claim the law requires it. Settled.
- **RRP (40 CFR 745).** The logic is now conservative in both directions. A year that's unknown, or a "No" against a
  pre-1978 or unknown year, needs a written reason. The pamphlet window ("no more than 60 days before work starts",
  745.84(a)) and the 6 sq ft / 20 sq ft minor-repair limits (745.83) are right. Window replacement is never minor
  repair. The wording holes are Fixes 1–3.
- **Toilet clearance.** "Less than 24 in in front of the toilet" (phone-29c) and 15 in to the side match the
  Minnesota Plumbing Code (Minn. R. 4714, 402.5).

---

## Required fixes (numbered)

1. **Era hazards › "Built before 1978?": the logic uses the year, but the screen shows the question unanswered.**
   - The problem:
     - Since c2707285, the global values come from `projection.scalar()`. For an unanswered field, `scalar()`
       returns the `era.before_1978` prefill from `derivationCases`: No for 1978 or later, Yes for before 1978.
     - So on a 1985 house, the logic already treats the house as 1978 or newer. The window question, renovator,
       certifications and pamphlet are all hidden ("Not on this job · 15", phone-17).
     - But the field itself reads **○ Open**, with neither Yes nor No picked, under the hint "Filled from Year
       built". It still counts as 1 open price-critical item (0/1).
     - The visitor sees an open question that the app has already answered. The office can't see that the
       answer came from the year rather than from someone looking at the house.
   - **Change:** when `before_1978` has no answer of its own but `scalar()` gives a value, show that choice
     picked, marked "From Year built (1985) — change it if that's wrong", and count it as done. Simpler
     alternative: when Year built is saved, write the prefill as a real answer, with the source noted. Either
     way, what the screen shows has to match what the RRP gate uses.
2. **Era hazards › `year_override_reason`: relabel it for the unknown-year case (carried from R5 Fix 5).**
   - The problem: it is now required when the year is **unknown** and the visitor taps No. But it still reads
     "Why is this not a pre-1978 home despite the year?", and the flag still says "Year and pre-1978 answer
     disagree". There is no year to disagree with.
   - **Change:**
     - Label: "How do we know it was built in 1978 or later?"
     - Flag issue: "No year on record and the pre-1978 answer is No — write how we know before closing".
     - Keep the current flag text only when the year is known and before 1978.
3. **Era hazards › Renovate Right line: when it shows, and one word.**
   - The problem:
     - `model.ts:354` swaps in `PAMPHLET_UNKNOWN_YEAR_LINE` whenever the year isn't a number. That includes when
       the visitor tapped "Built before 1978? Yes". Then the visitor says "we don't know for sure" about
       something they just recorded as known.
     - "built after 1978" is also the wrong boundary. RRP covers houses built *before* 1978, so a 1978 house is
       outside it, and "after 1978" leaves 1978 out.
   - **Change:**
     - Condition: `typeof year !== 'number' && global['era.before_1978'] !== true`.
     - Text: "We don't know for sure the house was built in 1978 or later, so we give you this pamphlet about
       lead-safe work — it's called Renovate Right. Could you initial here that you got it?"
     - Update `LEAD_SAFE_PAMPHLET` in `scripts.ts` to list both lines, so the plan copy and the screen agree.
4. **Closing › "Walk-through summary text": make it read-only.**
   - The problem:
     - phone-21 and tabletP-18b show it as an editable box with Save and "Skip this field…". It sits above
       the date.
     - The visitor can type in it before the client initials, and that text is then overwritten without
       warning. Worse, they can edit it after the client initials, and then the stored text no longer matches
       what the client initialed.
     - This is the only record of what the client agreed they were told.
   - **Change:**
     - Render it as display-only text below the initials: "Saved with the client's initials: …", collapsed to
       its first lines.
     - Before initials, hide it, or show "Filled when the client initials."
     - No Save and no Skip.
     - The server should refuse a `capture_answer` on `closing.summary` that isn't committed with an initials
       blob.
5. **Skip sheet: the skip reasons don't fit the client-initials or estimate-date fields.**
   - The problem:
     - `SkipSheet.tsx` offers the same list for every field: Not on this job, No access, Not safe to measure,
       Client declined, Get on return visit, Sub/supplier will measure, Other.
     - On "Client initials" (w320-22a), "Not safe to measure" and "Sub/supplier will measure" make no sense,
       and **"Client absent" isn't offered**, though `W.noInitialsAbsent` exists.
     - Fix 2 of R5 lets Show to client go ahead when the estimate date is "skipped with a reason". A staff visitor
       who doesn't know Joe's date has no fitting reason and has to pick Other.
   - **Change:** pick the reasons by field type.
     - **Signature fields** (client initials, pamphlet initials): Client absent · Client declined · Other (note).
       Make these the same reasons the wrap's "No initials — say why" uses.
     - **Closing › estimate date:** "Joe sets the date" (it files Joe's to-do with no due date and says so on
       the client view: "Joe will tell you the date for your formal estimate.") · Other (note).
     - **Measurement fields:** keep the current list.
6. **Closing script, staff visit: line 2 says "I price this", and the next line says Joe does.**
   - The problem: `CLOSING_STAFF = [...CLOSING_JOE.slice(0, 2), 2b, …]`. On tabletP-18b the staff visitor reads:
     > "Next, I price this with our trade partners and suppliers. …"

     and then:
     > "Joe prices the estimate from everything I measured today …"

     The client hears two different people pricing the job.
   - **Change:** give staff its own line 2:
     > "Next, Joe prices this with our trade partners and suppliers. You'll have the formal estimate by {estimate_date}. It shows each part of the work, the allowances for the things you're still choosing, and what isn't included."

     Line 2b then becomes "Joe works from everything I measured today, and he may call you with a question or
     two."

     This doesn't touch the consent or RRP wording the attorney approved. If Joe counts the closing lines as part
     of what counsel approved, send them this one-word change.
7. **`helpers.ts`: `len()` and `pair()` now default every length to 1/16.**
   - The problem:
     - c2707285 set `precision: 0.0625` in both helpers. About 70 fields without an explicit precision went from
       ⅛ to 1/16, including ceiling height, window and door sizes, toilet side clearance, hood duct size and
       length, slope across the work area, deck heights, stair rise and egress dimensions.
     - That's precision nobody measures to. On phones every one of those fields now shows the Show 16ths button.
     - The R5 fix only needed 16ths where the form already asked for them.
   - **Change:**
     - Take `precision` back out of the `len`/`pair` defaults, so `precisionOf()` falls back to ⅛.
     - Keep the explicit `precision: 0.0625` already on the kitchen wall lengths, base and upper runs, sink base,
       island, appliance cutouts and worst dip.
     - Add a seed test that lists exactly which fields are 1/16.
8. **Opening card 4b: the line appears twice.**
   - The problem: phone-06-opening-card-4 shows the photo line in the script card, then again in italics under
     "Say:" above "Photos okay?". The visitor reads the same sentence twice on one card.
   - **Change:** on the opening card that carries `answer_to: 'house.photos_ok'`, leave out the field's Say
     line, because the card already shows it. Keep the Say line when the field is shown inside House &
     household.
9. **QA proof still owed:**
   - **The wrap's Renovate Right read-out at 1985 + "Built before 1978? Yes", and at 1965 + No with a reason.**
     - phone-17b/c and 17d/e show only the top of Era hazards. The "full" shots are clipped to the screen now
       that the visitor screen is pinned.
     - In 17d/e the harness answered **No on "Window or door replacement"**, not on "Built before 1978?".
     - Capture the Before you wrap sheet for both cases. Scroll it down, or capture tabletP, where the RRP row
       is visible (tabletP-20b).
   - **A date skipped with a reason, then the client view.** w320-22b skipped the initials instead. Capture it
     after Fix 5.
   - **Opening card 6** ("anything you want to make sure we look at today?").
   - **Era hazards at year 1985 after Fix 1,** with the prefilled No visible.

---

## Optional extras

- **E1. Bath fixtures with the bath.** On tabletL-07b, "Fixture 1 — Bath" and "Fixture 2 — Bath" come after the
  kitchen walls, because the catalog sorts by module type. Within the measuring sections, sort by area first:
  Room 1 — Bath, Bathroom work, its fixtures, windows and doors; then the kitchen group. Keep house-wide sections
  (panel, water, HVAC, era, site) after the rooms. This matches how the rooms get walked.
- **E2. "Photo · Each suspect material" on a 1985 house.** phone-17 shows it (not required) even though the
  asbestos question is hidden. Hide the shot when its condition field isn't asked.
- **E3. Kitchen moisture (from R5 E1).** Add a required yes/no to `kitchen_scope`: "Sink base and dishwasher floor:
  soft, stained or wet?". On Yes, require a moisture check.
- **E4. Tile subfloor in bath (from R5 E2).** A subfloor question exists only in the flooring add-on. Add
  "Subfloor: plank / plywood / OSB and thickness (seen at a vent or from below)" to `structure` when there's a
  tile floor.
- **E5. Large-format tile flatness (R5 E3).** 1/8 in in 10 ft for tile 15 in or bigger (ANSI A108.02).
- **E6. Renovate Right acknowledgment record (R5 E7).** Save the client's printed name and the date with the
  pamphlet initials, to match EPA's sample form. Keep it 3 years (745.86). This is for counsel, together with the
  walk-through initials item that's still open.
- **E7. Initials skipped.** When the client initials are skipped (absent or declined), save the client-view text in
  `closing.summary` anyway, marked "Shown, not initialed". The office then knows what the visitor read back.
