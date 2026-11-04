# Build R14 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r14/*`. That is 163 shots plus `log.json`, from a production side build on a fresh database.

**Code:** checked at `a47fb7cd` (UI changes in `377a8705`), against my round-13 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- The sign-in link is `/login?next=%2Fconsult%2F<id>`.
- `close-failure todos`: "Abigail Stafki's visit for Tom Tierney hasn't closed — the app couldn't read their wrap-up answers; they need to check Before you wrap and close again". It reads plainly, and it says who acts.

**Harness artifacts, not scored:**
- "N other devices".
- `FAIL-tabletL-date-client`.
- The `/api/portal/selection-image/*` 404s.
- `FAIL-phone-rrp`: round 11's 1965 + No shots stand.
- `FAIL-phone-conflict-close` and `FAIL-w320-conflict-close`: these time out on the disabled Close visit button, which is intended.
- The fixture's "Reviewed for QA fixture" notes, and a 5.2 pCi/L radon flag decided "Not an issue".

## Why the scores

**Design stays at 9.** All three round-13 fixes landed, and so did all four extras.
- **The Complete heading is calm at every width.** It reads "✓ Complete", with "Closed Nov 3, 7:46 pm" in ink-2 under it, and the counts line breaks only after a dot.
- **The unknown-field refusal says why the sheet opened.**
- **The office radon flag names radon and the level.**

One new thing keeps design from 10, and it comes from my own round-13 ask (R14-1). When the office names a field the app knows, **Before you wrap** goes to that field. But:
- the button still says "Before you wrap";
- the field it lands on is already ✓ Covered;
- nothing on the screen says the office had trouble with it.

The visitor has no idea what to check.

**Completeness stays at 9.**
- **Arrived:**
  - the Complete heading on staff, own-close, same-device and tablet shots;
  - the conflict footer at 320 (`w320-45`, `w320-45b`), owed since round 10;
  - both refusal landings (unknown field and known field);
  - the office flags with radon text and the decision on its own line;
  - "Joe applies the findings" as a plain line;
  - Trade walks **Review** / **Decide**.
- **Still owed:**
  - **The R14-1 re-shoot.**
  - **One 320 Complete shot.** I asked for it in round 13. There is no `w320-40` or `w320-43`. The 390 shots show the DotLine breaking correctly, and at 320 "✓ Complete" alone can't strand anything, so this is a small gap.

---

## Round-13 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R13-1 | A dangling "·" in the Complete heading and the counts line | **FIXED** | **`phone-40-complete-screen-as-staff`, `phone-43`, `phone-43d`:** "✓ Complete" on its own line. "Closed Nov 3, 7:46 pm" (or 8:00 pm) sits under it in ink-2. The counts line breaks as "Price-critical 353/353 ·" over "Record 2/2 · 64 skipped": the dot ends the line and never starts one.<br>**`tabletL-40`:** all of it fits on one line each.<br>**`phone-40-as-joe`:** the office look-over keeps the short pill "✓ Complete · Nov 3, 7:46 pm" with **Reopen** and **← Project**, as agreed.<br>**Code:** the same markup is in `GetReady.tsx:176-179` and `WrapClose.tsx:339-342`. `DotLine` is in `primitives.tsx:115`. |
| R13-2 | Before you wrap from a refusal shows no reason | **FIXED (unknown field); see R14-1 for a known field** | **`phone-43k-…-after-button`:** the sheet opens with the blue status note "The office couldn't read these answers — check them, then close again." above the list. The note is calm (status, not red) and in plain words.<br>**`phone-43g-…-after-button`:** `closing.estimate_promised` lands on the **Formal estimate promised by** date field, which is focused and in frame. That is what I asked for, but see R14-1.<br>**Code:** `VisitScreen.tsx:235-241` sets the note on every way a refusal lands on the sheet. `closeRefusalFocus()` is in `words.ts:715`. Both are tested (`consult-r13-design.test.mjs:38,47`). |
| R13-3 | The office radon flag lost its subject | **FIXED** | **`owner-desktop-50b`, FLAGS:** "⚐ Radon is 5.2 pCi/L — at or above the 4 pCi/L level where the Minnesota Department of Health says to fix it. Mention mitigation, and don't seal the sump or slab in a way that blocks a future system." `OfficeFlags` reads every flag through `officeFlagText`, which is tested (`:63`). |
| Extra | "Joe applies the findings" looked like a button | **DONE** | **`phone-43`, `43d`:** a plain line, with no box. **‹ Back to visits** is the only outlined control. |
| Extra | Chained dashes in the office flags | **DONE** | **`owner-desktop-50b`:** each decision sits on its own indented, muted line ("Not an issue · Reviewed for …") under its flag. The flags are spaced with `gap-2` and are easy to scan. |
| Extra | "Decide" on a decided line | **DONE** | **`phone-49`:** "Trade walks: all decided ✓" with **Review**, matching **Review flags**.<br>**`phone-43k-…-after-button`:** an undecided trade still says **Decide**. |
| Extra | The renovator row vs. the cert warning | **DONE (code)** | `W.rrpRenovator` reads "Certified renovator certification is current on the visit day". `17f` cuts off at the row; the words are in `words.ts:256`. |
| Re-shoot | `phone-45` at 320 | **ARRIVED, passes** | **`w320-45b`:** "! 1 conflict to pick before you close" fits on one line. **Go to field** sits under it at 56 px. The disabled "Close visit — pick the conflict first" wraps to two centered lines. The footer takes about 180 of 700 px, and the list above still scrolls and shows three rows. **`w320-45`:** the red conflict card in the list stacks its words over a full-width **Go to field**. No overflow. See the optional extra on the footer button's tone. |

---

## Required fixes

**R14-1. A refusal that names a field the app knows says "Before you wrap", lands on a field that looks finished, and gives no reason (required, small).**
- **State:** `phone-43g-refused-invalid-command` → `-after-button`.
  - The refusal screen says "The office couldn't read the wrap-up answers. Check Before you wrap, then close again." Its primary button is **Before you wrap**.
  - The tap goes to the Closing section, scrolled to **Formal estimate promised by**, which shows "✓ Covered" and 11/12/2026.
  - Nothing on that screen says the office had trouble with this field. Before you wrap isn't open either, so the button's name and the line above it both point somewhere the visitor didn't go.
  - The likely next step is **Next ›** or close again, which gets refused the same way.
  - Round 13 asked for the landing; I didn't ask for the words that go with it. This is the follow-on.
- **Change** (`ConsultApp.tsx:192`, `ClosingScreen` refusal block, `VisitScreen.tsx` focus path):
  1. **Use the right button word.** When `fix === "before_you_wrap"` and `closeRefusalFocus(field)` gives a place that isn't the wrap sheet (`addr`, `closing`, `house`, or a wrap sheet other than `wrap`), the refusal screen's primary button says **Go to field**. For a sheet, it says the sheet's own name (**Renovate Right**, **Flags**, **Trade walks**). In the same case, the line becomes "The office couldn't read one answer: {field label}. Check it, then close again." It names the field, using the same label lookup as `conflictName`. The plain "Check Before you wrap" line and its button stay for unknown fields.
  2. **Say why on the landed field.** When `runAction` arrives from `focus:` and focuses a field (`openSection(…, addr)` or `pickDate()`), show the same calm status note used on the sheet, right above the focused row or as the section's top banner: "The office couldn't read this answer — check it, then close again." Clear it on the next save of that field, or on **‹ Sections**.
  3. **Test:** `runAction("focus:closing.estimate_promised")` focuses the date field and renders the note. The refusal button label for that field is `W.goToField`.
- **Re-shoot:** `phone-43g-refused-invalid-command` and `-after-button` (with the note), plus one at 320.

## Re-shoots owed (completeness)

1. `phone-43g` and `-after-button` after R14-1, and the same at 320.
2. One 320 Complete screen (`w320-43` or `w320-40`), owed from round 13.

**Not needed:**
- **Trade walks with a walk day set.** The code is small and uses the shared parts: the ⚐ mark with words beside it, "Walk day {day} — only Joe sets it.", a 56 px **Take the day off** that goes full width under `sm`, and a scroll to the first trade with a day (`WrapClose.tsx:190-203`). Tests cover it. I would like one shot before release, and it's cheap. The harness already writes to the DB with `db()` (it revokes devices that way at line 223), so it can put a `day` on one `trade_walks` entry in the walk visit's evidence draft. It doesn't hold the score.
- **1965 + No:** round 11's `phone-17d/e` stand.
- **The open office to-do on Today:** not needed, as I said in round 13. The `log.json` row is the real office line.

## Optional extras

- **The conflict footer's Go to field looks like a label.** At 320 and 390 (`w320-45b`, `phone-45b`), it wraps under the words as a borderless quiet button, left-aligned. It's the only live action in the footer, and every other **Go to field** in the sheet has an outline. Use the default secondary tone with `max-md:w-full` (`WrapClose.tsx:83`), so it reads as the way forward above the greyed Close visit. I passed the quiet tone in rounds 11 and 12, so this isn't required.
- **"Formal estimate promised by Thu, Nov 12 ✓" wraps "12 ✓" onto its own line** on the 390 wrap sheet (`43k-after-button`). The same thing happens on `49` ("Thu, Dec 10" / "✓"). Keep the date and the ✓ together in one `whitespace-nowrap` span, the way the Complete time is.
- **The office radon advisory carries a disposition** ("Not an issue · …"). This is fixture data, but if an advisory can never be "decided", drop the decision line for `kind === "advisory"`. If it can, keep it.
