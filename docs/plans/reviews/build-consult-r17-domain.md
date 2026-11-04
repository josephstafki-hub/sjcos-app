SCORES: design=9 completeness=9

# Build R17: Contractor / Minnesota domain judge (in-home consult)

**What I read:**
- My round-16 review (`build-consult-r16-domain.md`), Fixes 1–3.
- `git show c9392136`:
  - `derive.ts` (the legacy `range_on_wall` fallback);
  - `flags.ts` (`lead_plan` kept advisory);
  - `seed/template-modules.ts`, `seed/derivations.ts`, `seed/shared.ts`, `seed/flag-hints.ts`;
  - `approved-content.ts` and the plan rows;
  - `tests/consult-r16-logic.test.mjs`.
- Also: `lib/consult/rrp.ts`, `trades.ts`, `findings.ts` (how flags reach Joe), `seed/templates.ts` (kitchen derived rows, `planFormulas`), the `kitchen_wall` and `egress` modules, and `components/consult/field/FieldRow.tsx` / `WrapClose.tsx` (how advisory flags show).
- Screenshots:
  - `consult-r17b`: 16g, 17h / 17hh, 17i;
  - `consult-r17`: 16c, 16e, 16f.

**What I ran:**
- `SJC_TEST_CLUSTER_TAG=consult-judge2 node --test tests/consult-r16-logic.test.mjs` → **11 / 11 pass**. I stopped the cluster afterwards (`scripts/test-db.mjs stop`).
- A scratch Node script, not committed, with no DB and no server. It calls `pinnedDerivations` on the seed kitchen (two walls of 132″) and `conditionMatches` on the `lead_plan` flag. `findings.ts` uses `conditionMatches`, so this is the path that feeds Joe.

**Ignored:** the `FAIL-*` harness shots. Also the 17hh fixture that answers "Built before 1978? Yes" with "Client has the 1981 permit card" (carried R16 E3).

---

## Verified fixes (round 16)

| # | Item | Status |
|---|---|---|
| 1 | Island cooktop blanks the backsplash | **Done. The numbers are right.**<ul><li>New `range_on_wall` yes/no (16f). It is asked for To the uppers and Full wall at range, right after the height.</li><li>`range_wall_tile` is now required only when `range_on_wall` is Yes. The "Skip — Not applicable" hint is gone.</li><li>Worked on 264″ of base run with an 18″ height:<ul><li>To the uppers, range **not** on a wall: 264 × 18 / 144 = **33 sf** (it was `null`).</li><li>Full wall, 36 × 60: 33 + 15 = **48 sf**.</li><li>To the uppers, 30 × 18: 33 + 3.75 = **36.75 sf**.</li><li>4″: 264 × 4 / 144 = **7.33 sf**.</li></ul>The test and my script agree on all four.</li><li>Edge cases I ran:<ul><li>`range_on_wall` **skipped** → 33 sf. A skip no longer empties the number.</li><li>Legacy answers (a tile pair with no `range_on_wall`): the `derive.ts` fallback reads Yes → 48 sf.</li></ul></li><li>Plan 1280 and `approved-content.ts` carry the new row and the condition.</li></ul> |
| 2 | Kept island has no countertop or size | **Done.**<ul><li>Island size is now required for Keep and New (16g shows both fields under "Keep").</li><li>`island_top_area` covers Keep and New.</li><li>`island_run` counts New, and Keep only with Replace all, Reface or Paint.</li><li>Worked: Keep 72 × 36, 264″ run:<ul><li>top 72 × 36 / 144 = **18 sf** → countertop 46.75 + 18 = **64.75 sf**;</li><li>cabinet run (264 + 72) / 12 = **28 lf**;</li><li>"Some new" → **22 lf**, top still 64.75 sf.</li></ul></li><li>The script matches. A legacy pin keeps its old 0.</li></ul> |
| 3 | "Lead: plan — Not needed" on an RRP job | **Done.** The logic is right; the hint needs tightening (Fix 2).<ul><li>The flag: `all(rrpApplies, lead_plan = Not needed, lead_test_negative unanswered or No)`.</li><li>On the findings path:<ul><li>disturbs paint + Not needed → **raised**, with `lead_test_negative` unanswered or No;</li><li>window replacement only (`disturbs_paint` No) + Not needed → **raised**;</li><li>negative test Yes → not raised;</li><li>plan Test kit / Lab test / Assume lead → not raised.</li></ul></li><li>17hh shows it calm (⚐) under Lead: plan.</li><li>It reaches Joe in the findings as "… — undecided". The visitor's Flag sheet offers the usual choices, the same as the kept-toilet advisory.</li></ul> |

### Is the kept-island cabinet rule right?

Yes.
- **Replace all:** the island gets new boxes, so count it.
- **Reface or Paint:** the island is refaced or painted to match, and that work is priced per lf of boxes. Count it.
- **Some new:** the island is not one of the new boxes, so 0 is right.

The length is the top length, so it can run 1–3″ long over the boxes where an end overhangs. At about 0.25 lf, that doesn't matter.

There are two real gaps nearby: a kept island that **keeps its own top** (Fix 3), and the base run under "Some new" (Fix 1).

### Is the lead flag right under 40 CFR 745.82(a)?

The trigger is right. Window replacement raises it on its own: `rrpApplies` ORs `window_door_replacement`, and §745.83 excludes window replacement from minor repair at any size.

These results lift RRP under §745.82(a):
1. a written determination by a **certified lead inspector or risk assessor**, which the firm must hold a copy of;
2. a **certified renovator** using an **EPA-recognized test kit**, following the kit's instructions, on **each component** the job affects;
3. paint chips that a **certified renovator collected** from each affected component, tested by an **EPA-recognized (NLLAP) lab**.

These do not count:
- a homeowner's store-bought swab;
- a kit that isn't EPA-recognized, or used on a surface the kit isn't recognized for;
- a lab result on chips the homeowner took;
- one negative spot standing in for every surface.

**Kit vs. lab:** either counts when done by the right person. A kit positive isn't the last word, because chips can follow. So the plan choices "Test kit" and "Lab test" correctly raise no flag: the test is the plan. Joe should still price lead-safe work as the fallback (Optional O4).

**Gap:** the current hint "Only answer Yes with a recorded certified renovator test or lab result" leaves out the inspector's or risk assessor's report. It lets a lab result on homeowner-taken chips count. It also doesn't say every disturbed surface must be covered. A visitor can clear the flag on evidence that doesn't qualify, and the estimate then leaves out containment, poly, HEPA cleanup and cleaning verification. That is Fix 2.

---

## Required fixes

### 1. "Base cabinet run (new)" feeds the countertop and backsplash, so "Some new", Paint and Reface kitchens get the wrong numbers

- **Files:**
  - `lib/consult/forms/seed/template-modules.ts:219` (`base_run`, labelled "Base cabinet run (new)") and `:220` (`upper_run` "(new)");
  - `lib/consult/forms/seed/templates.ts:115–117` (cabinet run, countertop and backsplash all read `kitchen_wall.base_run`);
  - plan row 1300 and `approved-content.ts:443`; plan 1309 and `approved-content.ts:452` (Cabinet run).
- **Why:**
  - One measurement does two jobs.
  - Countertop sf and backsplash sf need the **whole** counter run on each wall, kept or new. Cabinet lf needs only the boxes being **bought**.
  - "Some new" is the common Twin Cities kitchen refresh: keep most boxes, add a few, new quartz and tile everywhere. On that job one of the two numbers is always wrong:
    - The visitor enters the new boxes only (what "(new)" says), say 36″ on one wall and 0″ on the other. Then the countertop is 36 × 25.5 / 144 = **6.4 sf** instead of **46.75 sf**, and the backsplash is 4.5 sf instead of 33. That is about $3,000 of quartz and $500 of tile missing.
    - The visitor enters the whole run (what Codex's 22 lf "Some new" case assumes). Then the cabinet run is **22 lf** when 3 lf is being bought, and the boxes are overpriced by about $5,000–8,000.
  - On Paint or Reface, "(new)" reads as 0. The visitor enters 0 or skips: the countertop goes to 0, or a skip makes it `null`.
- **Change:**
  - `base_run`:
    - label: "Base cabinet run on this wall — all of it, kept or new";
    - hint: "Every base cabinet on this wall, kept or new, measured along the wall. The countertop and backsplash follow this run."
  - `upper_run`: label "Upper cabinet run on this wall".
  - Add to `kitchen_wall`, after `base_run`:
    `len('new_base_run', 'New base cabinets on this wall — length', eq('kitchen_scope.cabinets','Some new'), { precision: 0.0625, hint: 'Only the new boxes on this wall. None? Enter 0.' })`.
  - Add a `kitchen_wall` case field, `cabinet_base_run` (`derivations.ts`):
    - `{ when: eq('kitchen_scope.cabinets','Some new'), formula: 'new_base_run' }`;
    - `{ when: answered('kitchen_scope.cabinets'), formula: 'base_run' }`.
  - `templates.ts:115`: cabinet run = `kitchen_wall.cabinet_base_run / 12 + kitchen_scope.island_run / 12`. Countertop and backsplash stay on `base_run`.
  - Plan rows and `approved-content.ts`:
    - rename the Base run row;
    - add the New base cabinets row ("R? cabinets = Some new");
    - Cabinet run: "Σ base run ÷ 12, or Σ new base cabinets ÷ 12 when Some new (+ island …)".
  - Fix the matching `planFormulas` strings at `templates.ts:244–246` too. They still carry the pre-R16 text: no Keep rule and no "range on wall".
  - Legacy pins keep `base_run` for all three.
- **Test:** two walls with `base_run` 132 / 132.
  - Some new, `new_base_run` 36 / 0, no island → cabinet run **3 lf**, countertop **46.75 sf**, backsplash 4″ **7.33 sf**.
  - Replace all → **22 lf**, 46.75 sf.
  - Some new + kept 72 × 36 island → **3 lf**, **64.75 sf**.

### 2. The "Recorded lead test" hint must say which tests count

- **Files:**
  - `lib/consult/forms/seed/shared.ts:425` (`lead_test_negative` hint);
  - `approved-content.ts:270` and plan 1127 (the Notes cell);
  - optionally the `lead_plan` flag issue at `shared.ts:426`.
- **Why:** Yes on this field is the **only** thing that clears the lead-plan flag, and it then drops lead-safe pricing from a pre-1978 job. Under §745.82(a), only these clear it:
  - an inspector's or risk assessor's written report;
  - an EPA-recognized kit used by a certified renovator;
  - a lab result on chips a certified renovator collected.

  Each must cover every component the job disturbs. Today's hint lets two things through: a homeowner's hardware-store swab described as "a test", and a lab result on chips the homeowner mailed in. Either one clears the flag. These are internal visitor rows, not counsel-approved client wording.
- **Change:** the hint, plus the same text in the plan and `approved-content.ts` Notes cell:
  > "Yes only if SJC has a copy of one of these, covering every painted surface this job disturbs: a lead inspector's or risk assessor's report; an EPA-recognized test kit used by a certified renovator; or paint chips a certified renovator took, tested by an EPA-recognized lab. A homeowner's store kit doesn't count."

  Flag issue (optional wording):
  > "… unless an inspector's report, or a certified renovator's EPA-recognized kit or lab test, shows no lead on every disturbed surface (745.82(a))".
- **Test:** none new; `consult-hints.test.mjs` still passes. Add the hint text to the seed inventory if it lists hints.

### 3. A kept island that keeps its own top has no right answer

- **Files:**
  - `lib/consult/forms/seed/template-modules.ts:142–144`;
  - `lib/consult/forms/seed/derivations.ts:65–66` (`island_top_area`);
  - plan 1274 / 1310 and `approved-content.ts:417 / 453`.
- **Why:** R16 Fix 2 made a kept island always get the new top. Some islands keep theirs: a butcher-block island the client loves, or a furniture piece. For those the visitor has two choices, and both are wrong:
  - enter the size → 72 × 36 adds **18 sf** of quartz that won't be bought (about $1,300–1,800 too high);
  - skip the size → I ran it: `cabinet_run` **and** `countertop_area` both go to **null**, because a skipped required length nulls the formula.

  This is the same failure as R16 Fix 1.
- **Change:**
  - Add after `island_depth`:
    `yesno('island_new_top', 'Kept island gets the new countertop?', eq('island','Keep'))`.
  - `island_top_area`:
    - `{ when: eq('island','New'), formula: 'island_length * island_depth / 144' }`;
    - `{ when: all(eq('island','Keep'), eq('island_new_top', true)), formula: 'island_length * island_depth / 144' }`;
    - `answered('island') → 0`.
  - Leave `island_run` as it is; its cabinet rule is right.
  - Add the row ("R? Keep") and "(Keep with a new top, or New)" to the Countertop area row.
- **Test:** 264″ run, Keep 72 × 36:
  - with Replace all and `island_new_top` true → **64.75 sf / 28 lf**;
  - with `island_new_top` false → **46.75 sf / 28 lf**;
  - with `island_new_top` false + Some new → **46.75 sf** (cabinet run per Fix 1).

---

## The R16 optional items: required or not?

- **E1 Countertop inside-corner overlap: not required.**
  - `base_run × 25.5` counts each inside corner twice: 25.5 × 25.5 / 144 = **4.5 sf** per corner.
  - That is about 10% high on an L (46.75 vs 42.25) and about 15% high on a U.
  - It errs high, and it sits inside the slab-yield waste a fabricator charges anyway. The plan already says the fabricator templates after install.
  - Still worth one word: the Countertop label could read "… counts inside corners on both walls (≈ 4.5 sf each)", so Joe knows not to add waste on top.
- **E2 Window over the sink: not required.**
  - About 3 sf high on a 36″ window with its sill 12″ above an 18″ backsplash.
  - It errs high and falls inside 10–15% tile waste.
- **E6 Concrete cutting for egress: not required as a trade walk.**
  - Cutters price by phone from wall type, thickness and opening size, and `house.foundation` is already a required answer (`shared.ts:373`).
  - What is worth adding is a flag (O1 below).

## Optional

- **O1. New egress in a stone or block wall.**
  - On `egress.result` = New egress needed with `house.foundation` Stone or Block, raise: "Block: lintel and rebuilt jambs; stone/rubble: engineer before price".
  - Rubble foundations in old Minneapolis and St Paul houses often make a cut egress impractical.
  - Also add "Concrete cutting" to `touchedTrades` (`trades.ts`) on New egress so the sub is on the list.
- **O2. Hood vs range location.** `hood_type` = Island with `range_on_wall` = Yes (or Wall chimney / Under-cabinet with No) is a contradiction. Flag it so the backsplash and hood ducting agree.
- **O3. Island size hint.** "Measure the top, including the seating overhang." Then the 18 sf is the slab that gets cut.
- **O4. Lead plan "Test kit" / "Lab test."** A one-line note to Joe: "price lead-safe work as the fallback until the result is in". Joe holds test-kit results, and gives them to the client within 30 days of finishing (§745.86(c)). A photo of the result on `lead_test_negative` = Yes would prove it.
- **O5. "No" on `lead_test_negative` means two things:** "not tested" and "tested positive". A three-way choice (Not tested / Lead found / No lead, recorded) would tell Joe which.
- **O6. Painted demolition under 6 sf.** §745.83 also excludes "demolition of painted surface areas" from minor repair, at any size. Consider the `disturbs_paint` label "…disturb more than 6 sq ft of painted surface in a room (20 sq ft outside), or demolish any painted surface?". This is internal visitor wording; confirm with counsel if it is reused client-side.
- **O7. Carried:**
  - R15 E2: Renovate Right delivery method on screen (`record_rrp_delivery`);
  - R15 E5: plainer reopened to-do;
  - R16 E3: the 1985-but-Yes reason (the 17hh fixture shows "1981 permit card" with Yes);
  - R16 E4: the tub fixture;
  - R14 / R6 list: bath fixtures with their bath; sink-base "soft, stained or wet?"; `flooring.worst_dip` hint; Renovate Right printed name and date, kept 3 years (§745.86, for counsel).

## Minnesota and code checks (unchanged and right)

These are unchanged from R16: RRP dates and the re-delivery window (60–7 days), the renovator and firm expiry cards, asbestos ≤ 1980 (29 CFR 1926.1101), radon 4 pCi/L (MDH), toilet clearances (Minn. R. 4714), egress R310 (5.7 / 5.0 sf, 44″ sill, ladder > 44″, 36″ / 9 sf well), CO alarms (299F.51) and trade walks. No client-facing wording changed this round.

Score 10 needs Fixes 1–3. Fix 1 is a countertop, backsplash or cabinet number off by thousands on the most common partial kitchen. Fix 2 is the only gate on dropping lead-safe pricing. Fix 3 is a kept island with no right answer.
