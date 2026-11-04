SCORES: design=10 completeness=10

# Build R19 — Design & field UX judge (in-home consult)

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r19/*`. This was a targeted run of 16 PNGs plus `log.json`: the lead and kitchen screens at phone 390 and at 320. R18's full set in `consult-r18/` stands for everything else.

**Code:** read at `c4814058`. The diff covers:
- `FieldRow.tsx:322`
- `shared.ts:425–426`
- `flag-hints.ts:39`
- `approved-content.ts:270–271`
- the tests: `consult-r18-wording`, `consult-r17-logic`, `consult-r8-design`

I also read `lib/consult/ui/model.ts:395–430` to rule on the coordinator's question.

**Not run:** no servers, builds, browsers or DB.

**Logs:** `overflow_px: 0` and `errors: []` on every shot.

---

## Verified fixes (R18)

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R18-1 | The lead flag's generic tail "The choices are in Before you wrap." contradicted its own on-screen ways out | **FIXED** | **`phone-17h2`:** the flag line now reads "⚐ Flag · Lead-safe work can only be skipped after a lead test shows none. Pick another plan, or answer Yes just below if a test showed no lead. If not, decide it in Before you wrap." Nothing comes after it. The order is now: two ways to clear it here, then Before you wrap as the fallback. That is the order I asked for.<br>**`w320-17h2`:** the same text wraps cleanly at 320; the frame cuts off at "If not,". `phone-17h2b` shows the whole line in context.<br>**Code:** `FieldRow.tsx:322` adds the tail only when `!fl.hint.includes(W.beforeYouWrap)`. `fl.hint` is typed `string` (`model.ts:62`) and always set (`model.ts:418` falls back to `visitorFlagText`), so the call can't throw. No other flag hint contains "Before you wrap" (grepped `seed/` and `flags.ts`). So the kept toilet and radon keep "The choices are in Before you wrap.", and `consult-r8-design.test.mjs:59` still pins that path.<br>**Elsewhere:** the hint is identical in `shared.ts:425` and `flag-hints.ts:39`, and `consult-r18-wording.test.mjs` checks the ending and the 180-character limit. |
| Domain | Test hint names what counts | **Reads well** | **`phone-17h3`, `17h2b`:** the hint says "…a licensed lead inspector's or risk assessor's report (not a home inspection); … A test the homeowner did doesn't count." At 390 it is seven lines, the longest hint on this screen. It is still one sentence plus a short close, and Yes / No sit right below it. It suits a visitor who stops to check a document. |
| Domain | "Lead: plan" hint | **Reads well** | **`phone-17h1`, `w320-17h1`:** the hint reads "Test kit or Lab test means we still have to test: price lead-safe work until the result is in. Tested today and no lead on every surface? Pick Not needed. Lead found? Pick Assume lead present." It answers the one question the four choices raised: what do I pick once I've tested here? It sits under the label and above the choices, where the eye goes before tapping. At 320 it runs five lines, with the four choices stacked full width and no clipping. It doesn't name Before you wrap, so it doesn't interfere with the R18-1 rule. |

**After Yes:**
- **`phone-17h3` / `w320-17h3`:** the flag line is gone. The test question reads ✓ Covered with Yes selected.
- **`phone-17i`:** Before you wrap shows "Flags: 1 needs a decision". That is the same count as R18, so the lead flag cleared on Yes.

**Kitchen (`16g`, `16h`, `16hh`, at both widths):** unchanged from R18.
- The whole-run / new-only pair and the kept-island question render as before.
- At 320 the run labels wrap to two lines and nothing clips.
- O1 and O2 below are carried over from R18.

## Coordinator's question: `w320-17h1` shows the lead-test question as "Covered" under "Assume lead present"

**Ruling: this is intended product behaviour. It doesn't mislead, so nothing is required.**

**Why it is intended:**
- `model.ts:404`: `applicable = !conditional || required || (a !== undefined && a.status !== 'cleared')`.
- That has been the rule for every conditionally required field since Phase 1 (`ee7ad0d4`). Once a conditional field has a stored answer, it stays on screen even after its condition turns false. A field the visitor answered never disappears with its answer still stored, and they can still see and change it.
- That is right for an offline field form. The alternative is a hidden answer that syncs to the office with nobody seeing it.
- On a fresh visit (`phone-17h1`) the question is not asked, which is what R17-1 required.

**Why it is harmless here:**
1. **It can't lower the price.** The flag fires only when `lead_plan = 'Not needed'` (`shared.ts:425`, `when: all(rrpApplies, eq('lead_plan','Not needed'), …)`). Under Assume lead present, Test kit or Lab test, the stored answer changes nothing, and Assume lead present is already the lead-safe price. `lead_test_negative` is read nowhere else in `lib/`, `components/`, `app/` or `mcp/`.
2. **It isn't counted.** The condition is false, so `required` is false and the row doesn't count toward progress or completeness (`model.ts:423`). It can't make the section look more finished than it is.
3. **It's a true fact.** A remembered "a test showed no lead" next to "Assume lead present" doesn't contradict the choice. A carpenter may assume lead anyway, for example when the report doesn't cover every surface being disturbed. The office sees both facts, and both are true.
4. **It's reversible.** If the visitor switches back to Not needed, the remembered answer applies at once, and that answer is the one they gave.

**What would make it required:** a hidden or orphaned answer that lowered the price or cleared a flag. Neither happens here.

## Required fixes

None.

## Optional extras

- **O1 (carried from R18). Ask the island question as a question.**
  - "Kept island gets the new countertop?" (`phone-16g`) drops its verb.
  - Change it to "Does the kept island get the new countertop?" in `lib/consult/forms/seed/template-modules.ts:145` and `approved-content.ts:418`.
  - Optionally add the hint "No = its top stays."
- **O2 (carried from R18). "Upper cabinet run on this wall" is ambiguous on Some new.**
  - If it measures the whole wall, label it "Upper cabinet run — whole wall" to match the base runs.
  - If it counts only new uppers, say so in a hint.
- **O3 (new, polish). Mark answered fields that are no longer asked.**
  - When a conditional field is shown only because it has a stored answer (`conditional && !required && a?.status === 'answered'`), the row could show a muted "Not asked now · kept" in place of "✓ Covered". That tells the visitor why a question they skipped past is still on screen, for example after switching from Not needed to Assume lead present.
  - This applies to every conditional field, not just this one, so it is outside the scope of R19.
