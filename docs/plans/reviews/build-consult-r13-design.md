# Build R13 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r13/*`. That is 158 shots plus `log.json`, from a production side build on a fresh database. The harness is `/tmp/sjcqa/shoot-consult13.mjs`.

**Code:** checked at `23b125ac`, with `13b83a4e` and `23b125ac`, against my round-12 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- The sign-in link is `/login?next=%2Fconsult%2F<id>`.
- `close-failure todos`: "Abigail Stafki's visit for Tom Tierney hasn't closed — the office could not read the wrap-up answers; open the visit and check Before you wrap". That is the real `invalid_command` line, not the fallback.

**Harness artifacts, not scored:**
- "N other devices".
- `FAIL-tabletL-date-client`.
- The `/api/portal/selection-image/*` 404s.
- `FAIL-phone-rrp`: the 1965 + No shots were not retaken. Round 11's `phone-17d/e` stand.
- `phone-conflict-close` timed out on the disabled Close visit button, which is intended.
- The fixture's "Reviewed for QA fixture" notes and its two kitchen walls both named "Wall A".

## Why the scores

**Design stays at 9.** All three round-12 fixes landed, and so did most of the extras:
- **The office to-do says what happened for every code (R12-1).**
- **The Renovate Right rows say "Enter it in Era hazards" (R12-2).**
- **One reopen answer on every Complete screen (R12-3).** A staff visitor reads "Answers are locked. Joe can reopen it from the office look-over." with no Reopen, on both the own close (`43`, `43d`) and the opened visit (`40`, `40-as-staff`, `tabletL-40`). Joe's visit URL goes to the office look-over, which has **Reopen** (`40-as-joe`).
- **The certification warning says who acts:** "Dana takes the refresher course before then, or Joe puts another certified renovator on the job." It reads the same on `17f`, `owner-desktop-31` and `owner-phone-31`.
- **"‹ Back to visits" on both close results** (`29b`).
- **The office flags are calm:** a muted ⚐ on every decided flag, and no more "break up. —".

Three small things keep design from 10:
1. **A dangling "·" in the Complete heading and in the counts line (R13-1).** This is the coordinator's catch, and I agree with it.
2. **The new "couldn't read these answers" note doesn't appear in the shot it was built for (R13-2).**
3. **The office radon flag lost its subject (R13-3).** It reads "Mention mitigation to the client" and doesn't say mitigation of what.

**Completeness stays at 9.**
- **Arrived:**
  - both Complete screens, as staff and as Joe;
  - all four refusals, with the screen after each button;
  - `17f` / `17g` with the new row words;
  - the office flags with ⚐;
  - "Needs finishing" with "‹ Back to visits".
- **Still owed:**
  - **`phone-45` at 320.** This is the fourth round it has been asked for.
  - **The trade-walk-day row in Trade walks**, which is new code that was never shot. The walk visit has no day.
  - **The Before you wrap note** (see R13-2).
- **`owner-desktop-51`: I don't need it shot while the to-do is open.** The `log.json` row is the real office line, and the unit test covers every code. Marking the to-do done on the later successful close is right.

---

## Round-12 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R12-1 | The office to-do must say what happened for every known code | **FIXED** | **Code:** `officeCloseFailure()` (`lib/consult/close-errors.ts:16-30`) now has a line for every known code, in the office voice. The fallback is "the app didn't take the close; open the visit".<br>**Test:** `tests/consult-r12-logic.test.mjs:29` checks that no `CLOSE_ERROR_ACTIONS` code gets the fallback.<br>**Logged row:** the `invalid_command` line.<br>**`owner_required`:** it now waits up to 30 minutes, the same as a conflict, before it tells Joe. That is right, because the visitor can take the day off. `43h` correctly has no "Joe has been told" line. |
| R12-2 | The Renovate Right firm row sends staff where they can't go | **FIXED** | **`17f` / `17g`:** "Firm certification expiry is missing or before the visit day. Enter it in Era hazards, or Joe adds it in Settings › Company." **Go to Era hazards** sits right under the rows. |
| R12-3 | The two ✓ Complete screens disagree about reopening | **FIXED** | **Staff:** `43`, `43d`, `40`, `40-as-staff` and `tabletL-40` all have the same lock line and no Reopen.<br>**Joe:** `40-as-joe` is the office look-over, with **Reopen** and **← Project**.<br>**One role check:** `CompleteCard` (`GetReady.tsx:170`) and `ClosingScreen` (`WrapClose.tsx:344,385`) both decide from `staffUser`. |
| Extra | Say why Before you wrap opened | **IN CODE, NOT ON SCREEN** | See R13-2. |
| Extra | Trade walks scrolls to the trade with the day | **IN CODE, NOT SHOT** | The `TradeSheet` `toDay` scroll, plus the line "Walk day {day} — only Joe sets it." with **Take the day off** beside it. `43h-after-button` is the plain sheet, because the walk visit has no day. This is owed (re-shoot 2). |
| Extra | One back label on both close results | **DONE** | `29b`: **Keep working** / **‹ Back to visits**. |
| Extra | Heading widow "7:01 / pm" | **FIXED, but the dot now dangles** | See R13-1. |
| Extra | Office flag punctuation | **DONE** | "…remove or break up — not an issue · …". See the optional extra on chained dashes. |
| Extra | Muted ⚐ on decided office flags | **DONE** | `owner-desktop-50b`: all 12 decided flags carry a muted ⚐ in ink-2. `OfficeFlags.tsx` keeps the red ⚑ only for a flag still waiting for a decision. This matches the device's "Flags: all 12 decided ✓" (`49`). |
| Re-shoot | `owner-desktop-51` with the row in frame | **NOT NEEDED** | See above. |
| Re-shoot | `phone-45` at 320 | **MISSING** (fourth round) | Only the 390 shot exists. |

---

## Required fixes

**R13-1. The ✓ Complete heading leaves "·" at the end of its first line, and the counts line starts its second line with "·" (required, small).**
- **State:** `phone-40`, `40-as-staff`, `43` and `43d` (390 px).
  - The heading reads "✓ Complete ·" over "Nov 3, 7:15 pm". The `whitespace-nowrap` from r12 keeps "7:15 pm" together, but the " · " is outside the span, so the 1.8 em serif heading breaks right after the dot.
  - The mono line under it reads "Price-critical 352/352 · Record 2/2" over "· 64 skipped".
  - Both read as a typo on the screen the visitor sees last. On `tabletL-40` both fit on one line and look fine.
- **Change:**
  - **Heading** (`GetReady.tsx:175` and `WrapClose.tsx:338`): drop the time from the `<h1>`. The heading is just "✓ Complete". Under it, a plain line in ink-2 says "Closed Nov 3, 7:15 pm". That is words beside the time, with no separator to strand. Use the same markup on both screens. (The office pill "✓ Complete · Nov 3, 7:15 pm" is short and can stay as it is.)
  - **Counts line** (`completeCountsLine`, `lib/consult/completeness.ts:94`, used in `GetReady.tsx:177` and `WrapClose.tsx:340`): render it as separate pieces. Each piece is one `whitespace-nowrap` span that ends with its own separator ("Price-critical 352/352 ·", "Record 2/2 ·", "64 skipped"). A line can then break only after a dot, the way it would after a comma, and never before one. The string helper can stay for tests and the office.
- **Re-shoot:** `phone-40`, `phone-43` and `w320-43`, or any 320 Complete shot.

**R13-2. Before you wrap opened from a refusal shows no reason when the office names a field the app can't place (required, small).**
- **State:** `phone-43g-refused-invalid-command-after-button`.
  - The sheet opens on "Before you wrap · 257 still open", then "Formal estimate promised by Thu, Nov 12 ✓". The new calm note ("The office couldn't read these answers — check them, then close again.") is missing.
  - **Why:** the harness's 422 named `closing.estimate_promised`. So **Before you wrap** went to `focus:closing.estimate_promised`. `refusalFocus()` has no `closing` case and returns `null`. The default branch then calls `setSheet("wrap")` without `setWrapWhy(true)` (`VisitScreen.tsx:232`). The same happens for `{ sheet: "wrap" }` (the `skips` case).
  - So the note only shows when the office names no field at all. In the case the visitor will really meet, the office names a field the app doesn't know, and the sheet opens with no reason given.
- **Change:**
  - Every way the refusal lands on the wrap sheet sets the note: the default branch's `!target`, `"sheet" in target && target.sheet === "wrap"`, and the `openSection` fallback to `"wrap"`.
  - Also add `case 'closing': return key === 'estimate_promised' ? { closing: 'estimate_promised' } : null;` to `refusalFocus()`, so a named closing field goes to that field.
  - Add a test: `runAction("focus:unknown.path")` shows `W.wrapRefusedNote`.
- **Re-shoot:** `phone-43g-…-after-button`, as it is now. Then the harness can send a details field the app doesn't know (for example `evidence.zzz`), and one it knows (`closing.estimate_promised`) should land on the date field.

**R13-3. The office radon flag doesn't say what it is about (required, small).**
- **State:** `owner-desktop-50b`, FLAGS: "⚐ Mention mitigation to the client — not an issue · …".
  - `OfficeFlags.tsx` prints `f.hint` for an advisory flag. The radon advisory added in `23b125ac` (`lib/consult/ui/model.ts:392`) has the hint "Mention mitigation to the client." So the office loses "Radon 36 pCi/L" and the action level.
  - On the device the hint sits under the radon level field, so it makes sense there. In the office list it stands alone, and Joe can't tell mitigation of what, or how high.
  - The HOA advisory gets away with it only because its hint names its subject.
- **Change:** make the radon hint stand alone: `` `Radon ${v} pCi/L — at or above the action level of 4. Mention mitigation to the client.` ``
  - Or, better for every future advisory: `OfficeFlags` uses `officeFlagText(f.issue, f.hint)` for advisories too, and keeps the hint only when it names its subject.
  - Add a test that the office text for the radon flag contains "Radon" and the level.
- **Re-shoot:** `owner-desktop-50b`, FLAGS block.

## Re-shoots owed (completeness)

1. `phone-45` at 320 (owed since r10).
2. Trade walks with a trade-walk day on the visit: the `owner_required` refusal → **Trade walks**. It should be scrolled to the trade with "⚐ Walk day … — only Joe sets it." and **Take the day off** at 56 px, at 390 and 320. Seed one trade walk with a `day` on the walk visit.
3. `phone-43g-…-after-button` with the note showing (after R13-2).
4. `phone-40` / `phone-43`, plus one 320 Complete shot (after R13-1).
5. `owner-desktop-50b` FLAGS (after R13-3).

## Optional extras

- **"Joe applies the findings in the office." looks like a button.** On `43` and `43d` it sits in a `rounded-lg border-2 border-rule` box with the same outline and height as **‹ Back to visits** just below it, so a visitor will tap it. For the staff line, drop the border (a plain ink-2 line), or use the calm `bg-paper` status card that the lock line could share.
- **Chained dashes in the office flags.** "The new loads may need a bigger electrical service — the electrician runs the load numbers — not an issue · Reviewed…" has three dash clauses, and the decision blurs into the hint. Put the decision on its own muted line under each flag ("Not an issue · Reviewed for …"). This also helps at phone width (`owner-phone-*`).
- **"Decide" on a decided line.** In `49`, "Trade walks: all decided ✓" still offers **Decide**. Flags says **Review flags** in the same state. Use **Review** once every trade is decided.
- **The Renovate Right renovator row says ✓ Done while the warning above it says the certificate runs out before the finish** (`17f`). Both are true: it is current on the visit day. Adding "on the visit day" to the Done title ("…is current on the visit day") would stop a reader thinking the two disagree.
