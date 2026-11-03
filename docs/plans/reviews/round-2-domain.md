# Round 2 — Contractor & legal judge
SCORES: sub-agreements design=10 completeness=9 | discovery-call design=9 completeness=9 | in-home-consult design=10 completeness=9

Lens unchanged from round 1: would a seasoned remodeling owner/estimator and a Minnesota construction
attorney call this content complete and right? Re-checked 2026-11-02 on revisor.mn.gov: **337.10**
(subd. 3 ten-day clock; subd. 4(b) 5% retainage cap, 4(d) 10-day pass-through, 4(f) no warranty
retainage), **326B.805** (subd. 1 license types; subd. 6(5) $15,000 exemption, 6(8) one special
skill), **Minn. R. 1346.0501** (makeup air in existing dwellings: >300 cfm, pre-/post-1994 tables,
appliance-venting columns), **626A.13 subd. 5** (two-year civil limit), **325E.66** (residential
contractors and insurance claims). I am not counsel; items deferred to the attorney are not held
against any score.

All three plans took round 1 seriously. Almost every item is fixed in the plan text, and several
fixes are better than what I asked for. What is left is short and exact.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | PARTLY | Cl. 4 is my text word for word, with interest, the lower-tier 10 days and no cash. Cl. 5 retainage release is added, and the "up to 5%" cap matches 337.10 subd. 4(b). The §13 pay-by formula and the milestone → client-invoice link are both there. One problem is left: the fallback when no milestone is linked can show a date later than the law allows (New 1). |
| 2 | FIXED | Cl. 15A, plus SJC's own receipts named as trust money. There is a payment-screen line, a "Trust-money risk" flag, and counsel q.3. |
| 3 | FIXED | Cl. 10 pass-through by 327A category. Warranty class per line and the warranty date are in §6.9. Completed-ops is 2 / 3 / as long as obtainable. |
| 4 | FIXED | Cl. 2 rewritten. The 14-factor card (§7.3) has evidence, a 12-month currency rule and a readiness code. Changes are lump sum only and the caps are removed. The sole-proprietor question went to counsel. |
| 5 | FIXED | Cl. 13 has the WC certificate or no-employees statement, the removal rule and the 176.215 cite. It also has CG 20 10 + 20 37 for SJC and the owner, primary/non-contributory, waiver of subrogation, 30-day notice and endorsement ticks. |
| 6 | PARTLY | The per-trade table, required rows and blocking are all built. The roofer row cites the definitions section, and the "General" row names the wrong license (New 2). |
| 7 | FIXED | The rules sheet is page 1 and the sub initials it. The upsell words are identical in cl. 7, the rules sheet and a template test. Item 9 now states the real pay-by rule. |
| 8 | FIXED | Cl. 10A added. Cl. 11 adds lien-free materials and passes manufacturer warranties through. |
| 9 | FIXED | Cl. 12 GSOC text, a `digging` + ticket field, and a "Before digging" warning. **I agree** with narrowing this from a start block to a warning two working days ahead. A locate ticket is requested 48 h before digging and is only good for a limited time, so it can't exist when Joe confirms a start weeks out. |
| 10 | FIXED | **I agree** with the evergreen agreement, 30-day ending, Yearly check, and re-signing only on a new counsel-approved version (D2, cl. 1, §8.6). Cl. 1 also keeps signed scopes running through completion, payment and warranty after notice, which is right. |
| 11 | FIXED | Counsel questions 1–9 cover 181.723, 337.10, 514.02, 327A, 176.215, licenses, 514.011 and indemnity. 181.165 is recorded as considered and excluded. |

Joe's three asks are still met exactly:
- **Scope:** cl. 3 and the §6 "Included / Not included" sections, with named "by others".
- **Changes go to Joe first:** cl. 6 and rules 2–3.
- **Every upsell named to the client as an upsell:** cl. 7, rule 4, the client document label and §8.5 step 5. An upsell can't be approved for the sub before the client accepts that exact priced document.

### New issues
1. **The unlinked-milestone fallback is not conservative (§13, first bullet).** "Any settled client
   payment on the job received **after the sub's invoice** starts the 10-day clock" misses the common
   remodel case. The client pays the rough-in draw the day the sub finishes, and the sub invoices a week
   later. Under 337.10 subd. 3 the clock runs from SJC's receipt of payment for the sub's *undisputed
   services provided*. It does not wait for an invoice. The app would show a pay-by date about a week
   later than the statutory one, which is the error round 1 asked to remove.
2. **License table citations (§6 item 8).**
   - *Roofing:* 326B.802 is the definitions section. The license requirement is **326B.805 subd. 1**,
     and a residential building contractor or residential remodeler license also covers roofing.
   - *General:* a remodeling sub offering two or more special skills needs a **residential remodeler
     *or* residential building contractor** license (326B.805 subd. 1). The exemptions are one special
     skill (subd. 6(8)) or ≤ $15,000 gross annual receipts with a **certificate of exemption**
     (subd. 6(5)).

   (Round 1's own wording caused both slips; I'm correcting it here.)

### Required to reach 10
1. **§13 first bullet — replace the fallback sentence with:**
   > "If Joe hasn't linked a milestone, the conservative default applies: the 10-day clock starts on
   > the earliest settled client payment on the job received on or after the day the sub's work for
   > that milestone was done (the earlier of the sub's invoice date and the day the work was recorded
   > complete). The bill says 'Pay-by date estimated — link the client draw to confirm.'"

   Add the case "client draw received before the sub invoices" to `tests/sub-pay-by.test.mjs`.
2. **§6 item 8 license table — two rows:**
   - Roofing → `Residential roofer, remodeler or building contractor license (Minn. Stat. § 326B.805 subd. 1)`.
   - General → `Residential remodeler or residential building contractor license (§ 326B.805 subd. 1) if Sub offers two or more special skills; otherwise exemption basis: one special skill (subd. 6(8)) or ≤ $15,000/yr with DLI certificate of exemption # [ ] (subd. 6(5))`.

   Cl. 18 and counsel q.6: cite 326B.805 subd. 1 and 6 instead of 326B.802.

---

## 2. Discovery call (`discovery-call-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | Recorded confirmation line, `consent_evidence_segment_id`, the "Consent not on the recording" stop and the decline line are all in §5.1. A code check sets the evidence segment, which is better than a human tap. One wording bug in that check (New 1). |
| 2 | FIXED | SJC's next-step phrases are the default wrap-up words, there is a no-model fast path, and the ≥10 s acceptance test is in §10.3 and §15. |
| 3 | FIXED | All four optional rows are written in full and off by default; Joe question 5 is added. **I agree** with the partial rejection on Photos. `qualification.ts:81` derives `photos` from the uploaded-file count, so a separate `photos_request` value is correct. |
| 4 | NOT FIXED | §14 claims "one table for both plans", but consult §8.3 has a different table (Cross-plan 1). |

Joe's ask still holds. The nine items are exactly his, in any order, with coverage only. There is no
scoring of Joe ("Out of scope: scoring Joe or coaching"). Reminders fire on a genuine skip only, at
most 3 per call. The summary of covered vs missed feeds a follow-up email that Joe approves.

### New issues
1. **The consent check rejects the most common Minnesota yes (§5.1 step 5).** The positive list has
   "no problem", but the negative list has `\bno\b` and `\bdon't\b`. So "Yeah, no problem", "Not a
   problem", "I don't mind" and "No, go ahead" all count as a refusal and stop capture. Failing closed is
   legally safe, but on real calls Joe will get "Consent not on the recording" on maybe one call in three
   and stop trusting the feature.
2. **Optional row 13 "Paying for it" has no guard for insurance claims (§3.2).** "Never suggest a lender,
   rate or insurance outcome" is right but incomplete for MN. Under **325E.66 subd. 1(a)(1)** a residential
   contractor may not promise to pay or rebate any part of the deductible. Under **subd. 1(a)(3)** it may
   not interpret the policy, advise on coverage or adjust the claim for the homeowner without a public
   adjuster license. Under **subd. 1(b)** written notice of the section goes with the initial estimate.
   "We'll deal with your insurance company for you" is the natural thing to say on a call, and it is
   prohibited.
3. **Consent evidence is deleted before a claim could be brought (§14).** The recorded "yes" lives in the
   audio and transcript, which are purged at 90–180 days. A civil action under 626A can be brought up to
   **two years** after discovery (**626A.13 subd. 5**). The one record that proves consent should outlive
   that window, while the rest of the audio is still deleted on schedule.

### Required to reach 10
1. **§5.1 step 5 — replace the matcher rule with:**
   > "Affirmative if the segment matches `\b(yes|yeah|yep|sure|fine|okay|ok|of course|go ahead|no problem|not a problem|no worries|don't mind|that's fine)\b`. Negative only if it matches `\b(no|nope|don't|not okay|rather not|stop)\b` **after** removing the phrases `no problem`, `not a problem`, `no worries`, `don't mind`, `no, (that's )?fine`, `no, go ahead`. Both or neither → ambiguous: capture pauses (not discarded), Joe sees the segment text and taps **That was a yes** or **Stop notes**; his tap is recorded with the segment id."

   Add these phrases to `tests/call-consent.test.mjs`.
2. **§3.2 row 13 — add under the table:**
   > "Insurance claim answered → on screen for Joe: 'Don't offer to cover the deductible, don't explain their coverage, don't deal with the adjuster for them (Minn. Stat. § 325E.66).' The rough estimate for this lead gets a to-do: include the § 325E.66 written notice (counsel supplies wording)."
3. **§14 — adopt the single table in Cross-plan 1**, including its consent-evidence row, and say in the
   heading that the consult plan points here and carries no copy.

---

## 3. In-home consult (`in-home-consult-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | Truthful disclosure, recorded confirmation, and a photo line plus `house.photos_ok`. **I agree** with rejecting my sentence "It's never posted or shared with anyone else". It contradicted my own Wrong 1, because Anthropic gets the text and B2 holds backups. The reviser was right. |
| 2 | FIXED | Permit authority (prefills the sub table), smoke/CO with the 299F.51 cite on all templates, and conditional psi. |
| 3 | FIXED | Window/door screening, firm and renovator certificates (expiry blocks paint trades), the household-risk field, asbestos text and the MDH program check. **I agree** with rejecting blanket door = window equivalence. EPA's minor-repair interpretation names *window replacement* and *demolition of painted surfaces*, not every door. Recording it and doing a conservative RRP review is right, and a jamb or casing tear-out still trips the demolition branch. |
| 4 | FIXED | All 13 bath additions are present. Water-heater capacity moved to `water`, and heated floor area is net. |
| 5 | FIXED | Appliances, hood route, gas, circuits, island, soffits, kitchen window/door offsets, level and dishwasher height are all there. Makeup air is now re-cited to **1346.0501**. I verified the >300 cfm trigger and the pre-/post-1994 tables, so the IRC M1503.6 / 400 cfm removal is correct. One input is missing (New 1). |
| 6 | FIXED | Insulation, rim, slab, sump, gravity drain, combustion air, furnace capacity, reroutes, R302.7 and egress. The area rule is right, and the reviser added an outside-grade capture instead of a "basement" label, which is better than my fix. |
| 7 | FIXED | Ledger rim, flashing, backfill, private lines, egress under the deck, stairs, existing framing, hot tub, floating footing with a city/1303.1600 check, and the exit-door trigger. |
| 8 | FIXED | Soils, tie-in, lost egress, lot controls and survey, septic/well, utilities, HVAC/Manual J, roof tie-in, energy, trees. |
| 9 | FIXED | Temporary kitchen/bath plan; a pre-1981 survey screen worded as screening, not as a legal claim. |
| 10 | FIXED | §10.3 conditions 9–11. §10.2 makes an unwritten no-access skip not count, routes adjustments through Pre-con change vs change order, and says recap initials ≠ acceptance. |
| 11 | FIXED | Price-critical / Record tiers, separate counts, the staff rule, and honest durations (kitchen 2 h, whole-home 3–4 h or two visits). |

Joe's ask still holds:
- The visit comes after the pre-con agreement and the signed rough estimate (§5.1, opening line 2).
- Questions, plus measurement forms for bath, kitchen, addition, basement, deck, whole-home, general
  and add-ons.
- Completion tracking that checks the record and never scores the person.
- Joe-or-staff scripts on a tablet or phone.

### New issues
1. **The makeup-air check has no input for appliance venting (§7.3 `hvac`, `water`).** Under
   1346.0501 the right table column depends on how the home's combustion appliances vent:
   atmospheric/draft-hood, fan-assisted, power-vent/direct-vent, or solid fuel. §8.2 says "record …
   combustion appliances", but no field does. `water` only has "Gas tank". This is also the real-world
   risk: a 600 cfm hood in a house with an atmospherically vented water heater back-drafts. The HVAC sub
   can't size makeup air from the record as written.
2. **The tempered-glass check misses two common hazardous locations (§7.3 `window`).** Missing are large
   panes (**IRC R308.4.3**: a single pane > 9 sf, bottom < 18″ above the floor, top > 36″, walking surface
   within 36″) and glazing at stairs and landings (**R308.4.6 / R308.4.7**). Picture windows in additions,
   basements and whole-home window jobs hit R308.4.3 all the time, and tempered units are priced
   differently.
3. **Retention contradicts the discovery plan (§8.3).** The consult says audio is kept 90 days and text
   180 days *from capture end, without waiting for a construction agreement*. Discovery §14 says audio
   and text are kept *180 days after the construction contract is signed or the job is lost* and 90 days
   for unlinked calls, and its audio row explicitly includes "consult audio". §8.3 also says the
   discovery draft "already says 90/180 days", which it doesn't. Both plans claim to have the one shared
   table. The attorney would get two different answers.
4. Consent evidence has the same problem as discovery New 3: the audio holding the recorded "yes" is
   purged at 90 days, inside the two-year 626A.13 window.
5. Non-blocking: the door script ("We transcribe the audio on our server, send the words to our AI
   provider, and keep secure offsite backups…") is accurate but long for a doorway. Counsel may prefer the
   discovery wording plus "details are on our privacy page". I'm not requiring it.

### Required to reach 10
1. **§7.3 `hvac` — add these fields:**

   | Field | Type | Req | Notes |
   |---|---|---|---|
   | How each fuel-burning appliance vents (furnace, boiler, water heater, fireplace/stove) | per appliance: Atmospheric (draft hood / metal flue into chimney) / Fan-assisted / Power-vent / Direct-vent sealed / Solid fuel / None | R? kitchen, bath, basement, addition, whole | photo of each flue connection **R?** same; feeds the 1346.0501 table column |
   | Other exhaust in the house | dryer (yes/no), other fans over 100 cfm (cfm each) | R? hood > 300 cfm | 1346.0501 sums the largest exhausts |
   | Year built ≥ 1994? | derived from `house.year_built` | — | picks Table 501.4.3(1) vs (2) |

   Change the hood ⚑ text to: "> 300 cfm in an existing home: HVAC sub calculates makeup air under Minn. R. 1346.0501 (table by year built and appliance venting); atmospheric appliances present → depressurization/backdraft check".
2. **§7.3 `window` — add two fields:**
   - **Large pane:** "Any single pane larger than 9 sf with its bottom under 18″ from the floor and top above 36″?" yesno, R? Replace or New. ⚑ "tempered (IRC R308.4.3) unless walking-surface/barrier exceptions apply".
   - **Stairs:** "Within 36″ of stairs or a stair landing, bottom under 36″ above the walking surface?" yesno, R? Replace or New. ⚑ "tempered (IRC R308.4.6/R308.4.7)".

   Also apply both to `openings`.
3. **§8.3 — delete the consult's own table and the sentence about discovery's draft.** Replace them with:
   "The retention table is discovery plan §14 (shared, single source). Consult-only addition: local
   synced content on the device is deleted 30 days after server acknowledgement or on earlier owner
   deletion; unsynced data is never aged away silently." Keep §8.4's purge graph and backup rules, since
   that is consult mechanics, not a second clock. `consult-retention-db.test.mjs` asserts the §14 values.

---

## Cross-plan

1. **One retention table, pasted once in discovery §14 and pointed to from consult §8.3.** Recommended
   values (counsel sets the final numbers):

   | Data | Kept until | Client asks to delete |
   |---|---|---|
   | Consent evidence: the recorded "yes" (≤ 20 s audio clip + its segment text), notice version, who/when | **2 years after capture** (Minn. Stat. § 626A.13 subd. 5), or longer under legal hold | Kept; this is the record that the request was lawful (counsel confirms) |
   | Other audio (calls under this feature, consult audio) | **90 days after capture end** | Purged now |
   | Transcript text, segments, evidence quotes, raw transcript payloads, rejected AI text | **180 days after capture end**; raw `source_events` payloads emptied 30 days after reconcile | Purged now; quotes show "[removed]" |
   | Confirmed checklist answers, measurements, notes, photos, lead facts, summaries | With the lead/project record | Kept (a person confirmed them); quotes removed |
   | Telnyx's stored recording | Deleted via API once our copy is saved | — |
   | Backups (B2) | Deleted objects age out within a stated maximum of **90 days**; rollout fails if the bucket setting is unknown | Same |
   | Device cache (consult only) | 30 days after server ack | Deleted on reconnect |

   One clock from capture end means it never waits on a contract that may never come. The 90-day
   unlinked-call row disappears because it becomes the general rule. Both plans' retention tests check
   these exact values.
2. Consult → sub scope: **closed.** `consultScopeFacts` v1 is defined once (consult §10.9) and consumed
   by name (sub §7.1). It carries flags, assumptions, exclusions, trade walks, permits, RRP and new-work
   origin, with a shared fixture.
3. Upsell vs required labelled at the source: **closed.** `origin` is captured at the consult. The
   **Upsell — optional addition / Scope change — required work** labels carry through to Pre-con change,
   change order and sub scope, and before the contract it is never a change order.
4. RRP and licensing flow down: **closed.** Era "RRP applies" adds a required Lead row; permit authority
   pre-fills "Inspected by".
5. Discovery facts pre-fill the consult: **closed.** "What we know so far" shows them with **Still right
   ✓ / Correct**, and prefill never counts as a new measurement.
6. Same words: **closed.** All three Words tables match, "proposal"/"bid" are banned toward clients, and
   all three use the 48/56 px rule and `CoverageMark`.

Sources checked this round: [337.10](https://www.revisor.mn.gov/statutes/cite/337.10),
[326B.805](https://www.revisor.mn.gov/statutes/cite/326B.805),
[Minn. R. 1346.0501](https://www.revisor.mn.gov/rules/1346.0501/),
[626A.13](https://www.revisor.mn.gov/statutes/cite/626A.13),
[325E.66](https://www.revisor.mn.gov/statutes/cite/325E.66). Taken from round 1 and still
flagged for counsel: 176.215, 326B.46, 299F.51, 1322 R-values and bath-exhaust minimums, 40 CFR
745.83/.84, the status of MDH's state RRP program, MDH asbestos residential rules.
