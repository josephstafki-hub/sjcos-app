SCORES: design=10 completeness=10

# Build R19: Contractor / Minnesota domain judge (in-home consult)

**What I read:**
- My R18 review (`build-consult-r18-domain.md`), Fixes 1–2.
- `git show c4814058`:
  - `lib/consult/forms/seed/shared.ts:425–426` (`lead_plan` hint and flag, `lead_test_negative` hint);
  - `seed/flag-hints.ts`;
  - `approved-content.ts` and plan rows 1127–1128;
  - `components/consult/field/FieldRow.tsx:322` (the advisory tail is dropped when the hint already names Before you wrap);
  - `tests/consult-r17-logic.test.mjs`, the new `tests/consult-r18-wording.test.mjs`, and `tests/consult-r8-design.test.mjs`.
- `lib/consult/flags.ts`: the `lead_plan` flag is still advisory, and still the only reader of either field.
- `template-modules.ts:145, 220–221`, to decide on the R18 optional kitchen items.
- Screenshots in `consult-r19`: phone 17h1, 17h2, 17h2b, 17h3 and 17i, plus w320 17h1.

**What I ran:**
- `SJC_TEST_CLUSTER_TAG=consult-judge2 node --test tests/consult-r18-wording.test.mjs`: **3 / 3 pass**. Then `scripts/test-db.mjs stop` ("no cluster running").
- I measured the hint lengths from the seed:
  - `lead_plan` hint: **192** characters (cap 220);
  - `lead_test_negative` hint: **317** (cap 340);
  - flag hint: **172** (the test caps it at 180).
- The new test-hint text appears exactly once each in `shared.ts`, `approved-content.ts` and the plan. The three copies match.

---

## Verified fixes (R18)

| # | Item | Status |
|---|---|---|
| 1 | Lead-test hint: a licensed inspector's or risk assessor's report, not a home inspection; a test the homeowner did doesn't count | **Done, word for word.**<ul><li>17h2b and 17h3 show: "…a licensed lead inspector's or risk assessor's report (not a home inspection); an EPA-recognized kit used by a certified renovator; or an EPA-recognized lab test of paint chips a certified renovator took. A test the homeowner did doesn't count."</li><li>"Store kit" is gone. The test asserts it stays gone.</li><li>The R17 regexes were updated, not deleted.</li></ul> |
| 2 | "Lead: plan" says what Test kit / Lab test mean and where a test done at the visit goes | **Done, word for word.**<ul><li>The hint shows under the label in every state: 17h1, 17h2b and 17h3.</li><li>It is exact-matched in `consult-r18-wording.test.mjs`.</li></ul> |
| — | Design judge's flag change: "…answer Yes just below if a test showed no lead. If not, decide it in Before you wrap." | **Correct for this domain.**<ul><li>Dropping "already" is right. A negative test the certified renovator does at the visit is a valid §745.82(a)(2) determination, so the flag shouldn't suggest only older tests count.</li><li>The question still says "already shown". For a test done minutes earlier that is still true, and the Lead: plan hint sends the visitor there.</li><li>"If not, decide it in Before you wrap" sends a No or blank answer to the right place. 17i shows "Flags: 1 needs a decision".</li><li>The `issue` Joe sees there is unchanged: "price lead-safe work unless a recorded negative lead test shows no lead (745.82(a))".</li></ul> |

### Is the wording legally accurate? (40 CFR 745.82(a), 745.107)

- **§745.82(a)(1): "a licensed lead inspector's or risk assessor's report (not a home inspection)".**
  - The rule asks for a written determination by a *certified* inspector or risk assessor, and the firm must have a copy.
  - EPA runs RRP in Minnesota. MDH certifies lead inspectors and risk assessors under its EPA-authorized program (Minn. Stat. §144.9505; Minn. R. ch. 4761) and calls this a **license**. So "licensed" is the right word for this state, and it is plainer than "certified".
  - "(not a home inspection)" shuts out the most common trap. That is the purchase inspection, which often says "no peeling paint" and is not a lead determination.
  - "Covering every painted surface we'll disturb" still covers the partial risk assessment: surfaces it didn't sample aren't cleared.
- **(a)(2) and (a)(3): the kit and the chips, both by a certified renovator.** Both are correct and unchanged.
  - "EPA-recognized lab" is the plain name for an NLLAP-recognized lab.
- **"A test the homeowner did doesn't count."**
  - This now blames who did the test, which is the real disqualifier. The rule lets only a certified renovator use the kit or take the chips.
  - It also covers chips the homeowner mailed to a lab, and a LeadCheck swab they did themselves.
  - It no longer wrongly excludes the same LeadCheck kit when Joe's certified renovator uses it.
- **§745.107 (seller and lessor disclosure).**
  - The client's purchase file may hold the Lead-Based Paint Disclosure, and the seller often checked "no knowledge of lead-based paint". That is not a determination, and the hint's "Yes only if… [three routes]" list doesn't include it. A visitor reading the list can't mistake a disclosure for any of the three.
  - If the seller passed on a real licensed inspector's report under §745.107(a)(4), that report counts under (a)(1). The hint's first route covers it.
  - A disclosure that says lead *is known* means "Lead found", and the Lead: plan hint routes that to Assume lead present.
  - So nothing in §745.107 makes the wording wrong. Naming the disclosure form in the hint is optional (O1 below).
- **"No lead"** still stands for "below 1.0 mg/cm² / 0.5 % by weight". That is fine for a visitor.
- **Overstatement check.** The hint is stricter than the rule in one place: it has no "integrated whole" relief for testing one stair tread. Stricter only means lead-safe pricing on a job that strictly didn't need it, so that is acceptable.

### Can Joe price correctly from each lead path?

All of these assume a pre-1978 house where RRP applies (more than 6 sq ft inside, more than 20 sq ft outside, or window replacement).

| What the visitor records | Flag | What Joe should price | Does the record get him there? |
|---|---|---|---|
| **Assume lead present** (17h1) | none | Lead-safe: containment, poly, HEPA, cleaning verification | **Yes.** This is also where a positive at-visit test goes now, so "lead found" no longer hides as "pending". |
| **Test kit** | none | Lead-safe until the result is in | **Yes.** The hint says so in plain words. This also closes R17 O4 (lead-safe as the fallback). |
| **Lab test** | none | Lead-safe until the lab result. If it comes back negative on every surface, revise | **Yes.** "Until the result is in" fits chips sent off at the visit. |
| **Not needed + Yes** (17h3) | clears | No lead-safe line | **Yes, and only on a qualifying test.** The hint names the three §745.82(a) routes, excludes home inspections and homeowner tests, and asks for SJC's copy. |
| **Not needed + No** | holds (advisory) | Lead-safe, or Joe decides | **Yes.** The flag shows on the field and in Before you wrap, and the issue text tells Joe to price lead-safe. |
| **Not needed, question blank** (17h2) | holds | Same as No | **Yes.** |
| **Not needed, RRP doesn't apply** (minor repair, ≤ 6 / 20 sq ft, no windows) | none | No RRP practices required | **Yes.** This is correct under §745.83, and the question still shows if the visitor wants to record a test. |
| **Mixed at-visit result** (some surfaces negative, some positive) | none | Lead-safe where lead was found | **Yes, conservatively.** "Lead found? Pick Assume lead present" prices lead-safe for the whole job. That can be high on a mixed job, but it is never non-compliant. |
| **Some surfaces tested negative, others not tested** | none | Lead-safe on the untested ones | **Yes.** Neither "no lead on every surface" nor "lead found" fits, so the visitor stays on Test kit, which prices lead-safe. |

- On w320 17h1, the test question shows as "Covered" from an earlier run on the same visit. That is the design judge's call.
- For my domain, a stale `lead_test_negative` = Yes under another plan is harmless. The flag reads it only when the plan is Not needed, and then the question is on screen again (R18 finding, still true in `flags.ts`).

---

## Required fixes

None.

### R18 optional items: is any now required?

None. Reasons:

- **R18 O1, dishwasher gap in `base_run`** (`template-modules.ts:220` hint is still "Every base cabinet on this wall…").
  - Worst case, the countertop comes up 4.25 sf short (about $300–400 of quartz) and the backsplash about 0.67 sf short.
  - That is inside the contingency on a kitchen, and the fabricator's template measures before any top is cut. It is not a code or compliance error.
  - Still the best next text change. It stays optional.
- **R18 O2, a skipped `island_new_top` reads as 0.** The field is required when the island is Keep, so a skip shows up as open in Before you wrap rather than slipping through silently. It stays optional.
- **R18 O3 and O4** (what "No" means; a photo of the test kit) are now mostly handled by the Lead: plan hint. O4 is still a nice-to-have for the §745.86 record (below).

## Optional

- **O1. Disclosure form (§745.107).** If Minnesota visits keep turning up purchase paperwork, add "(not a home inspection or a seller's disclosure)". That adds 25 characters, making 342, which is over the 340 cap. Cutting "an " before "EPA-recognized lab test" brings it to 339. The current exhaustive "only if" list already excludes the disclosure, so this is only a belt to go with the braces.
- **O2. Test-kit record (R18 O4).** When `lead_test_negative` = Yes, offer an optional shot of the swabs or the lab report. §745.86(b)(1)(ii) requires the firm to keep the result, and §745.86(c) to give it to the client within 30 days of finishing.
- **O3. Dishwasher gap (R18 O1).** Hint: "…measured along the wall, dishwasher space included; leave out the range and fridge."
- **O4. Kept island top skipped (R18 O2).** Make a skip read as null, not 0.
- **O5. A lab result that arrives after the visit.** When the lab result comes back, Joe or the office moves Lead: plan to Not needed with the test question at Yes, or to Assume lead present. A one-line note in the to-do or runbook, "update Lead: plan when the lab result arrives", would keep the record matching the price.
- **Carried from R17:**
  - O1, egress in a stone or block foundation;
  - O2, hood type vs range on wall;
  - O3, island size including the overhang;
  - O6, painted demolition under 6 sf (§745.83);
  - O7, the carried list (Renovate Right delivery method, reopened to-do wording, the 1985-but-Yes fixture, the tub fixture, bath fixtures, sink-base condition, the `worst_dip` hint, the Renovate Right record kept 3 years).

## Final sweep

These are unchanged since R18 and still right:
- RRP applicability, including window replacement;
- the 60-day Renovate Right window and the re-delivery to-do;
- renovator and firm expiry cards;
- asbestos ≤ 1980 → MDH-licensed abatement;
- knob & tube ≤ 1949;
- radon at 4 pCi/L;
- toilet clearances (Minn. R. 4714);
- egress R310;
- CO alarms (Minn. Stat. 299F.51);
- makeup air above 300 cfm (Minn. R. 1346);
- dishwasher opening;
- gas line questions.

Kitchen money is unchanged from R18 (`c4814058` touches no derivations).

**Score 10.** Both R18 fixes landed word for word. The test hint is accurate under §745.82(a) and Minnesota's licensing, and is not tripped by §745.107 paperwork. Every lead path leaves Joe a record he can price from correctly.
