SCORES: design=9 completeness=9

# Build R18 — Design & field UX judge (in-home consult)

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r18/*` (206 PNGs + `log.json`).

**Code:** read at `69a43508`. That covers `0d47d625` (R17-1, plus the two new kitchen questions) and `69a43508` (Joe approved the closing and pamphlet wording; that commit only changes text and the "Joe approved 2026-11-03" comment).

**Not run:** no servers, builds, browsers or DB. One read-only check in node: `parseLength('0')` returns `{ok:true, inches:0}`, so the "None? Enter 0." hint on the new-only run is a value the keypad will save.

**Logs:**
- `overflow_px: 0` on every shot.
- `errors: []` on every shot.
- `held: 2`, `forced refusals: 1`.

**Harness artifacts, not scored:**
- **`FAIL-w320-r17-island-lead`:** this frame shows Year built "1955" with **Save** disabled. The phone run had already saved that year, so there was nothing to change. That is correct behaviour, not a defect. The 320 shots up to `16hh` exist, and the 320 lead screens are covered by the phone run plus the code.
- **`phone-17i` vs `phone-20c`:** `17i` (after "Yes") shows "Flags: 1 needs a decision". `20c`, taken at another point in the run, shows 2. In r17 the same `17i` step showed 2. That fits the lead flag clearing on Yes, and `tests/consult-r17-logic.test.mjs:31` proves it. The shot name "with-lead-flag" is the harness's name, not what the frame shows.

---

## Verified fixes (R17)

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R17-1 | The lead-test question came before the plan, was asked on every pre-1978 house, and the flag said "note the test result" | **FIXED (one leftover, see R18-1)** | **`phone-17h1` (Assume lead present):** "Lead: plan" is followed directly by "Possible asbestos seen". The test question is not asked.<br>**`phone-17h2` / `17h2b` (Not needed):** the ⚐ flag appears under the choice, then "Has a lead test already shown no lead where we'll work? *" with its hint (inspector/risk-assessor report, EPA-recognized kit by a certified renovator, or lab chips; "A store kit the homeowner used doesn't count."). Then Yes / No and Skip. It opens right where the visitor tapped.<br>**`phone-17h3` (Yes):** the flag line is gone and the question reads ✓ Covered.<br>**Code:** `shared.ts:425–426` has the new order. `lead_test_negative` is conditional on `all(before1978, eq('lead_plan','Not needed'))`, and the flag `when` is unchanged. The hint matches in both places (`shared.ts:425`, `flag-hints.ts:39`). The approved table (`approved-content.ts:270–271`) matches. `tests/consult-r17-logic.test.mjs:56–62` covers visibility by choice and the flag count. |

## New this round (judged for the field)

- **"Kept island gets the new countertop?" (`phone-16g`, `w320-16g`):**
  - It shows only for Keep, directly under the island depth. It is a 56 px Yes / No, and at 320 the label wraps to two lines next to "○ Open" without clipping.
  - The place and control are right. The label reads like a note to yourself, not a question; see O1.
- **Whole run vs. new-only run (`phone-16h`, `16hh`, `w320-16h`):**
  - Order on the wall: "Base cabinet run — whole wall, kept or new *" ("Every base cabinet on this wall, kept or new. The countertop and backsplash follow this run."), then "Base cabinet run — new cabinets only *" ("Only the new boxes on this wall. None? Enter 0.").
  - The pair reads clearly. The shared "Base cabinet run —" start keeps them together, and the tail after the dash tells them apart. That tail also becomes the keypad's sub-title through `labelTail` (`Keypad.tsx:70`).
  - The hint says why the whole run matters (top and splash follow it), so a carpenter won't enter only the new boxes in the first field.
  - At 320 both labels wrap to two lines. "None? Enter 0." is cut by the footer only because of where the frame stops.
  - `16hh` shows "Price-critical 0/7" with "Upper cabinet run on this wall" now unqualified. See O2.
- **Approved wording (`69a43508`):** the text change is confined to the closing and pamphlet lines. The "Say:" pamphlet line in `17h2b` reads as before. Nothing to judge on layout.

---

## Required fixes

**R18-1. The lead flag tells the visitor to fix it here, then sends them to Before you wrap (required, small).**

- **State:** `phone-17h2`. The flag line reads:
  > ⚐ Flag · Lead-safe work can only be skipped after a lead test shows none. Pick another plan, or answer Yes just below if a test already showed no lead. **The choices are in Before you wrap.**
- **Where the last sentence comes from:** it is not in the hint. It is the generic advisory tail: `W.advisoryTail` (`lib/consult/ui/words.ts:109`), added after every advisory hint at `components/consult/field/FieldRow.tsx:322`. It was written in r8 for the kept-toilet card. That hint ends "Pick 'Not an issue' if it stays, or 'Price it'…", and those choices really are in the flag sheet in Before you wrap, so the tail made sense there.
- **Why it contradicts here:**
  1. The lead hint now names two ways to clear the flag on this screen: another plan, or Yes on the question just below.
  2. The tail then says "the choices" are elsewhere. A visitor reads that as a third, competing instruction, or as "the real choice is in Before you wrap".
  3. In Before you wrap the flag sheet offers Price it / Allowance / Sub must look / **Not an issue** (`words.ts:533`). Picking "Not an issue" there records an opinion about the flag in place of the test fact. That is the misdirection R17-1 removed ("note the test result"), coming back through the tail.
  4. The tail does have one true job here. When the answer is "Not needed" + No, the flag stays and must be decided in Before you wrap. The sentence should say that, and say it as the fallback.
- **Change:**
  1. `components/consult/field/FieldRow.tsx:322`: add the tail only when the hint doesn't already name Before you wrap:
     ```tsx
     <MeasureText text={fl.hint} />{fl.hint?.includes(W.beforeYouWrap) ? null : <> {W.advisoryTail}</>}
     ```
     Today no other flag hint names Before you wrap (checked `flag-hints.ts`, `lib/consult/flags.ts`), so only the lead flag changes. The kept toilet and radon keep their tail.
  2. Lead hint, in both places (`lib/consult/forms/seed/shared.ts:425` `flag.hint` and `lib/consult/forms/seed/flag-hints.ts:39`), and in the approved table if it quotes it:
     > Lead-safe work can only be skipped after a lead test shows none. Pick another plan, or answer Yes just below if a test showed no lead. If not, decide it in Before you wrap.

     That is 172 characters, under the 180 limit in `tests/consult-hints.test.mjs:66`.
  3. Tests:
     - `tests/consult-r8-design.test.mjs:59` matches the exact JSX `Flag · <MeasureText text={fl.hint} /> {W.advisoryTail}`. Update it to the conditional form, and keep the kept-toilet assertion: a hint without "Before you wrap" still gets the tail.
     - Add one assertion to `tests/consult-r17-logic.test.mjs`: the `era.lead_plan` hint contains `W.beforeYouWrap` exactly once.
- **Re-shoot:** `phone-17h2`. The flag line should end "…If not, decide it in Before you wrap." with no second sentence after it. A kept-toilet field line (e.g. `phone-19c`) should still end with "The choices are in Before you wrap."

## Optional extras

- **O1. Ask the island question as a question.** "Kept island gets the new countertop?" drops its verb.
  - Use "Does the kept island get the new countertop?" (`template-modules.ts:145`, and `approved-content.ts:418`).
  - Add a short hint saying what No means: "No = its top stays."
  - It still wraps to two lines at 320.
- **O2. "Upper cabinet run on this wall" is now ambiguous on Some new.** The base runs now say "whole wall" vs. "new cabinets only", but the upper run says neither.
  - If it is the whole run, label it "Upper cabinet run — whole wall" to match.
  - If it only counts new uppers, say so in a hint.
  - The domain judge should say which the price uses (it is `price_critical`, `template-modules.ts:223`).
- **Carried from R17:**
  - pair-keypad empty status "Width, tap ×, then height" (`Keypad.tsx:144`);
  - "Lead: plan" → "Lead-safe plan" (`shared.ts:425`; internal wording, not counsel-approved);
  - Trade walks having both Close and Cancel;
  - the re-shoots of `w320-13b` unticked, a pre-r16 skipped `part_of`, and `43h` after-button with a walk day.

Score 10 needs R18-1.
