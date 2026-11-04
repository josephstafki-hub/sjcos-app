SCORES: design=9 completeness=9

# Build R18: Contractor / Minnesota domain judge (in-home consult)

**What I read:**
- My R17 review (`build-consult-r17-domain.md`), Fixes 1–3.
- `git show 0d47d625`:
  - `seed/shared.ts` (era: `lead_plan`, `lead_test_negative`);
  - `seed/template-modules.ts` (`island_new_top`, `base_run`, `new_base_run`, `cabinet_base_run`);
  - `seed/derivations.ts`, `seed/templates.ts`, `seed/flag-hints.ts`;
  - `approved-content.ts` and the plan rows;
  - `tests/consult-r17-logic.test.mjs`.
- `69a43508`: Joe approved the closing and pamphlet lines on 2026-11-03. I have not re-flagged them.
- `lib/consult/flags.ts`, and a grep for `lead_plan` / `lead_test_negative` across `lib`, `components` and `mcp`. Nothing else reads either field, so the visit records the lead plan and nothing prices it.
- Screenshots in `consult-r18`: phone 16g, 16h, 16hh, 17h1, 17h2, 17h3 and 17i. I ignored the `FAIL-*` files.

**What I ran:**
- `SJC_TEST_CLUSTER_TAG=consult-judge2 node --test tests/consult-r17-logic.test.mjs`: **18 / 18 pass**. Then `scripts/test-db.mjs stop` (it reported "no cluster running").
- A scratch script, not committed: `pinnedDerivations` on the seed kitchen with **two walls of 132″**. Before this, Codex's tests and mine had only used one 264″ wall. No DB, no server.

---

## Verified fixes (R17)

| # | Item | Status |
|---|---|---|
| 1 | "Some new": base run vs new-only run | **Done. The numbers are right.**<ul><li>`base_run` is now "whole wall, kept or new", with the hint "The countertop and backsplash follow this run" (16h, 16hh).</li><li>`new_base_run` is required only for Some new ("None? Enter 0.").</li><li>`cabinet_base_run` takes `new_base_run` for Some new and `base_run` otherwise. The cabinet run uses it. Countertop and backsplash stay on `base_run`.</li><li>Worked on two walls of 132″, 4″ backsplash:<ul><li>Some new, 36 / 0 → cabinets **3 lf**, countertop 264 × 25.5 / 144 = **46.75 sf**, backsplash 264 × 4 / 144 = **7.33 sf**;</li><li>Replace all → **22 lf**, 46.75 sf, 7.33 sf;</li><li>Paint (and Reface) → **22 lf**, which is right: every box gets painted or refaced;</li><li>Codex's single wall, 264″ / 120″ Some new → **10 lf**, 46.75 sf. Matches.</li></ul></li><li>Edge cases:<ul><li>`new_base_run` skipped on one wall → cabinet run **null**, countertop still 46.75. Null is honest and is not a wrong number.</li><li>Cabinets unanswered → cabinet run null. Fine, because it is required.</li></ul></li><li>The legacy pin keeps 22 lf (test).</li><li>`planFormulas` strings now match the plan.</li></ul> |
| 2 | Lead-test hint names the 745.82(a) tests | **Done, but the wording needs two words of tightening (Fix 1).**<ul><li>It covers all three routes: inspector or risk assessor, renovator with an EPA kit, and renovator-collected chips at an EPA lab.</li><li>It says "every painted surface we'll disturb" and "SJC has a copy".</li><li>The question now sits right after Lead: plan and shows only for Not needed (17h2 / 17h3).</li><li>The flag hint now says "answer Yes just below" (17h2).</li><li>The flag clears on Yes and holds on No or unanswered. I checked with window replacement only (`disturbs_paint` No), and the test covers it.</li><li>17i shows it as "Flags: 1 needs a decision".</li></ul> |
| 3 | Kept island keeps its own top | **Done.**<ul><li>New `island_new_top` yes/no, required for Keep (16g).</li><li>On a 264″ run, Keep 72 × 36:<ul><li>with the new top → 46.75 + 18 = **64.75 sf**;</li><li>keeping its own top → **46.75 sf**;</li><li>cabinets stay **28 lf** with Replace all.</li></ul></li><li>Some new + kept island with its own top → **10 lf / 46.75 sf**.</li><li>Two walls, Some new 36 / 0 + kept island with a new top → **3 lf / 64.75 sf**.</li><li>A new island always adds its top (64.75).</li><li>The pre-R17 pin keeps the old unconditional 18 sf.</li></ul> |

### Is the hint legally accurate? Does it overstate?

Here is §745.82(a) checked against the hint, piece by piece.

- **(a)(1), the certified inspector or risk assessor.**
  - The rule: the components were "determined to be free of" lead-based paint (≥ 1.0 mg/cm² or 0.5 % by weight) by a *certified* lead inspector or risk assessor, and the firm "has obtained a copy of the determination".
  - The hint says "an inspector's or risk assessor's report". The copy requirement is right.
  - But "inspector" on its own reads as the **home inspector** from the client's purchase. Most Twin Cities buyers have that report, and it often mentions paint. It does not count.
  - In Minnesota, lead inspectors and risk assessors are licensed by MDH (Minn. R. ch. 4761). This is the one real overstatement (Fix 1).
  - A risk assessment that didn't sample every component doesn't clear the surfaces it missed. "Covering every painted surface" already handles that.
- **(a)(2), the EPA-recognized kit used by a certified renovator.**
  - Correct.
  - The rule also says "following the kit manufacturer's instructions", and a kit is recognized only for certain surfaces. For example, 3M LeadCheck is recognized for wood, ferrous metal, drywall and plaster. That is the renovator's training, not something the visitor needs to read.
  - The rule's "integrated whole" relief (test one stair tread) is stricter in the hint. Stricter only errs toward pricing lead-safe work, so that's fine.
- **(a)(3), paint chips a certified renovator took, tested by an EPA-recognized lab.**
  - Correct. The lab is NLLAP-recognized under TSCA §405(b). "EPA-recognized lab" is the right plain phrase.
  - The user's example is the difference between this and an inspector's inspection. The hint keeps them as two separate routes, and both count. A chip test by the renovator is not an inspection, and the hint doesn't call it one.
- **"A store kit the homeowner used doesn't count."**
  - The idea is right, but the wording points at the wrong thing. 3M LeadCheck from Menards or Home Depot **is** an EPA-recognized kit. When a certified renovator uses it, it counts.
  - What disqualifies a result is **who** tested, not where the kit came from. The wording also misses chips the homeowner mailed to a lab, which don't count either. The hint excludes those only by implication.
  - Fix 1 changes it to "A test the homeowner did doesn't count."
- **"No lead".** In plain words, "no lead" stands for "below the 1.0 mg/cm² / 0.5 % threshold". That's fine for a visitor and doesn't change the answer.
- **The threshold wording** is unchanged.

### Does hiding the test question under Test kit / Lab test lose anything?

Nothing for **pricing**: under Test kit or Lab test the flag rightly doesn't fire. But the visitor has nowhere to put a result they get **at the visit**, and nothing says what to do with one.

- A certified renovator swabs the window stools with LeadCheck during the walk. The visitor picks "Test kit", because that's what they did.
  - **Negative:** the result is lost. "Test kit" reads as *still to test*, so Joe prices containment, poly, HEPA cleanup and cleaning verification on a clean job. On a window-and-trim job that is roughly $800–2,000 too high. No record of the negative test exists either, and the firm must keep one and give the client the kit results within 30 days of finishing (§745.86(b)(1)(ii) and (c)).
  - **Positive:** "Test kit" hides that lead was *found*. Pricing is the same, since lead-safe is the fallback. But Joe can't tell "pending" from "confirmed", and confirmed matters for scheduling, the kids-under-6 containment plan and the client conversation.
- The way through is already there: pick Not needed and answer Yes, or Assume lead present. The visitor only needs to be told about it (Fix 2).
- Old answers: a legacy `lead_test_negative` = Yes left behind under another plan is harmless, because the flag reads it only when the plan is Not needed, and then the question is visible.

---

## Required fixes

### 1. The lead-test hint: "licensed lead inspector … (not a home inspection)", and "a test the homeowner did"

- **Files:**
  - `lib/consult/forms/seed/shared.ts:426` (`lead_test_negative` hint);
  - `lib/consult/forms/approved-content.ts:271` and `docs/plans/in-home-consult-plan.md:1128` (the Notes cell);
  - `tests/consult-r17-logic.test.mjs:68` (the regex `/homeowner used doesn’t count/` becomes `/homeowner did doesn’t count/`). Line 65's regex still matches.
- **Exact change.** The hint, and the same text in the plan and `approved-content.ts`, is 317 characters, under the 340 cap in `consult-hints.test.mjs:43`:
  > "Yes only if SJC has a copy covering every painted surface we’ll disturb: a licensed lead inspector’s or risk assessor’s report (not a home inspection); an EPA-recognized kit used by a certified renovator; or an EPA-recognized lab test of paint chips a certified renovator took. A test the homeowner did doesn’t count."
- **Why:**
  - This Yes is the only thing that clears the lead flag, and clearing it drops lead-safe pricing on a pre-1978 job.
  - "Inspector's report" lets the visitor accept a home inspection that says "no peeling paint". §745.82(a)(1) requires a *certified* (in Minnesota, MDH-licensed) lead inspector or risk assessor.
  - "Store kit" blames the kit, not the person. A Menards LeadCheck used by Joe counts. Chips the homeowner sent to a lab don't, and the current wording doesn't say so.

### 2. "Lead: plan" needs a hint saying what Test kit / Lab test mean and where a result from the visit goes

- **Files:**
  - `lib/consult/forms/seed/shared.ts:425` (add a `hint` to `lead_plan`; it has none);
  - `approved-content.ts:270` and plan `:1127` (Notes cell: append the hint);
  - seed inventory or hint tests if they list field hints.
- **Exact change.** `hint`, 192 characters, under the 220 field cap:
  > "Test kit or Lab test means we still have to test: price lead-safe work until the result is in. Tested today and no lead on every surface? Pick Not needed. Lead found? Pick Assume lead present."
- **Why:**
  - With `lead_test_negative` now hidden unless the plan is Not needed (correct for the flag), a kit result from the visit has no home.
  - A negative is lost, Joe prices lead-safe work on a clean job, and the §745.86 test-kit record isn't started.
  - A positive is hidden as "pending".
  - The hint also gives Joe R17 O4 ("price lead-safe as the fallback") with no new field.
- **Test:** add `assert.match(plan.hint, /price lead-safe work until the result is in/)` to the R17 lead test.

---

## Optional

- **O1. Dishwasher in the base run.**
  - The new `base_run` hint says "Every base cabinet on this wall … The countertop and backsplash follow this run." A careful visitor will leave out the 24″ dishwasher gap, because it isn't a cabinet.
  - The countertop then comes up 24 × 25.5 / 144 = **4.25 sf** short, about $300–400 of quartz, and the backsplash 0.67 sf short.
  - Including the dishwasher instead makes Replace all show 2 lf too many boxes.
  - Fix: hint "… measured along the wall, dishwasher space included; leave out the range and fridge." Optionally add a `dishwasher_on_wall` yes/no that takes 24″ off `cabinet_base_run`.
- **O2. Kept island top skipped → 0 sf, silently.**
  - Skipping `island_new_top` falls to `answered('island') → 0`, so the countertop reads 46.75 when the client may want 64.75. Other skipped required lengths go to null.
  - Fix: add `{ when: all(eq('island','Keep'), not(answered('island_new_top'))), formula: null }`, or the derive equivalent, before the `0` case, so a skip shows as missing.
- **O3. "No" on the lead test still means "not tested" or "lead found"** (R17 O5). Fix 2 routes "lead found" to Assume lead present, which is enough for now.
- **O4. Test-kit photo.** On `lead_test_negative` = Yes, an optional shot of the swabs or the lab report would satisfy the §745.86 record.
- **Carried from R17:**
  - O1, egress in a stone or block foundation;
  - O2, hood type vs range on wall;
  - O3, island size including the overhang;
  - O6, painted demolition under 6 sf (§745.83);
  - O7, the carried list (Renovate Right delivery method, reopened to-do wording, the 1985-but-Yes fixture, the tub fixture, bath fixtures, sink-base condition, the `worst_dip` hint, the Renovate Right record kept 3 years).

## Final sweep: Minnesota and code checks

These are unchanged and still right:
- RRP applicability, including window replacement (§745.83);
- the 60-day pamphlet window and re-delivery to-do;
- renovator and firm expiry cards;
- asbestos ≤ 1980 → MDH-licensed abatement;
- knob & tube ≤ 1949;
- radon at 4 pCi/L (MDH);
- toilet clearances (Minn. R. 4714);
- egress R310;
- CO alarms (Minn. Stat. 299F.51);
- makeup air above 300 cfm (Minn. R. 1346);
- dishwasher opening ≥ 34½″;
- gas line questions.

Kitchen money now holds on every combination I ran:
- Replace all, Reface, Paint and Some new;
- island Keep (new top or own top), New and None;
- range on a wall or on the island;
- one wall or two.

**Score 10 needs Fixes 1 and 2.** Both are text-only. Fix 1 is the one gate on dropping lead-safe pricing, and it still lets a home inspection through. Fix 2 gives a visit-day test result somewhere to go.
