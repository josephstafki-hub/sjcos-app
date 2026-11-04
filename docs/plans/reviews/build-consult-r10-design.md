# Build R10 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r10/*`. That is 138 shots plus `log.json`, from a production side build on a fresh database:
- The walk visit is on Tierney.
- The seeded Complete visit and the seeded conflict visit are both on M Larson.

**Code:** checked at `41b49456`, with `b842ae6e`, `8732cf8e` and `41b49456`, against my round-9 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- `rrp_lines` for 1985 + Yes now reads "receipt not recorded · firm certification not on file". The renovator part is gone because the renovator was entered. For 1965 + No it is empty.
- `phone-conflict-close` timed out on the **disabled** Close visit button. That block is intended.

**Harness artifacts, not scored:**
- "N other devices haven't sent yet".
- No `tabletL-date-client` step.
- The `/api/portal/selection-image/*` 404s.
- **`owner-desktop-47-reopened` caught the page before it refreshed.** It was shot at 18:25:19 and shows "✓ Complete · Nov 3, 5:14 pm" with **Reopen**. `phone-48`, shot in the same minute, says "Reopened by Joe · Nov 3, 5:25 pm". `ReopenButton` closes its form and then calls `router.refresh()`, so the shot landed between the two. The office reopened line is still unseen; it is listed under re-shoots.

**Known engineering defect, judged only for how the screen presents it:**
- The visitor's own close after a reopen was refused (`phone-43`). Engineering owns the cause. The screen that shows the refusal is R10-1.

## Why the scores

**Design stays at 9.** All three round-9 fixes landed cleanly, and so did five of the six extras:
- The conflict sides now read "earlier" and "later".
- A blocked close says why on its button.
- A reopened visit says who reopened it, when and why.

The new states are calm. Three things keep design from 10:
- **A refused close says the visit closed (R10-1).** The screen says "Visit closed — sending" over a red generic error. The visitor is told it closed when it didn't, and isn't told what happened or what to do.
- **The certification warning (R10-2):**
  - It uses an ISO date that breaks across lines.
  - It doesn't name the planned finish or say what to do.
  - It shows when Renovate Right doesn't apply.
  - It never reaches Joe in the office.
- **A dangling "·" in the blocked-close footer (R10-3, small).**

**Completeness stays at 9.**
- **Arrived:**
  - all the round-9 re-shoots (`phone-42`, `tabletL-42`, the three office pickers, `phone-45`, `phone-48`, `phone-49`);
  - the certification warning at phone and tablet width;
  - the opening cards 1–6;
  - the mono inch marks.
- **Still missing, for the fourth round:** a visitor's own close that lands on **✓ Complete**. It is now blocked by the engineering defect.
- **Also missing:** the office reopened line (harness race), and the Renovate Right sheet with its new warning.

---

## Round-9 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R9-1 | Both conflict sides read "· earlier" | **FIXED** | **Field:** "Pick **18″** · Abigail · 5:14 pm · earlier" and "Pick **19″** · Abigail · 5:14 pm · later" on `phone-42` and `tabletL-42`.<br>**Office:** the same on `owner-desktop-44-conflict`, `-rail-closed-44c` (two columns) and `owner-phone-44c`.<br>The value is set in mono with ″, matching the field. The order is strict: time, then revision, then id. |
| R9-2 | Blocked close gives no reason; the wrap line has no "›" | **FIXED, one wrap glitch (R10-3)** | **Button** (`phone-45`): "Close visit — pick the conflict first".<br>**Above the footer:** "! 1 conflict to pick before you close · Go to field".<br>**Wrap line:** "! Conflict: Access & logistics › Narrowest door or turn on that path — changed on another device". It is singular, and has the "›". |
| R9-3 | Reopened visit doesn't say so | **FIXED on the device; office not seen** | **Section list** (`phone-48`): "Reopened by Joe · Nov 3, 5:25 pm — Client asked to add a closet measurement." in a calm card.<br>**Counts:** now Price-critical 244/244 · Record 2/2, with every section ✓ Covered. The visit no longer looks wiped.<br>**Before you wrap** (`phone-49`): the same card heads the sheet.<br>**Office** (`owner-desktop-47`): caught before its refresh (see the harness notes). |
| Re-shoot 1 | Own close lands on ✓ Complete | **STILL MISSING (4th round)** | `phone-43` ends in the red generic error. See R10-1. |
| Re-shoots 2–4 | `phone-42`, `owner-desktop-44-conflict`, `phone-45`, `phone-48/49` | **DONE** | As above. |
| Extra | Opening heading jumps on card 1 | **FIXED** | `phone-05` and `phone-06-opening-card-2…6`: the heading stays on the same line on every card, and the Back slot is reserved. |
| Extra | Card 6 says the prompt twice | **FIXED** | `phone-06-opening-card-6`: only the label "Client's own list ("anything you want us to look at")" is left. |
| Extra | Straight inch marks in flag text | **FIXED** | **Field:** `phone-19c` "Less than **24″** in front of the toilet".<br>**Flag card:** `phone-29e` "Measured **20″** — less than **24″**".<br>Both use mono with ″, like the field. |
| Extra | Section-list conflict mark differs | **FIXED** | The office list shows "! Conflict" alone (`owner-desktop-44-conflict`), the same as the device. |
| Extra | Office skip lines in mono | **FIXED** | `owner-desktop-47`: "Skipped · Other · QA fixture: excluded by agreement" is now in the body face. |
| Extra | "two more rooms" on the client view | **FIXED** | `w320-24b`: "Not measured today: the bathroom and the kitchen." |

## New this round, judged

| Shot | Verdict |
|---|---|
| `phone-42`, `tabletL-42`, `owner-*-44*` | Good. One "earlier", one "later". 56 px field buttons, and the office buttons fit at all three widths. |
| `phone-45` | Words on the button and a line above the footer. Right. **The "·" dangles at the end of the line (R10-3).** |
| `phone-48`, `phone-49` | Calm, honest and in the right place. Coverage matches what was closed. |
| `owner-desktop-47` | Not judgeable (harness race). Re-shoot. |
| `phone-43` / `43b` | **Wrong heading and a generic line (R10-1).** |
| `phone-17bb`, `17bc` (Era) | The renovator name, cert # and expiry 03/01/2027 are each ✓ Covered. **No word beside the expiry field** that it runs out before the finish (R10-2). |
| `phone-17c`, `phone-20b`, `tabletL-20` (wrap) | "⚐ Renovator certification expires 2027-03-01, before the planned finish". It is calm, a light card, and never blocks the close. Those parts are right. **The wording, date format, when it shows, and its missing office copy are all R10-2.** On phone the date breaks as "2027-" / "03-01". `tabletL-20` and `phone-20b` (after 1965 + No) show it with no Renovate Right line at all. |
| Opening cards 1–6 | Good. One quote per card. Card 4 puts **Photos okay?** under its line, card 6 ends on the client's list, and the heading stays steady. |
| `phone-19*`, `29*` mono marks | Good. Numbers in mono with ″ read as measurements inside the sentence. |
| Rest of the walk (`*-07…29`, `tabletP-27/28`, `w320-*`) | No regressions against round 9. |

---

## Required fixes

**R10-1. A refused close says "Visit closed — sending" and a generic error (required).**
- **State:** `phone-43-own-close-result` and `43b`, the visitor's own close after a reopen. The screen shows:
  - heading **"Visit closed — sending"**;
  - red banner "⚠ Something went wrong. Your answers are still saved on this device. Try again.";
  - **Try again** and **Keep working**.
- **Why it's wrong:**
  - The office refused the close, so the visit is **not** closed, and nothing is sending (⇅ 0).
  - The heading tells the visitor the opposite of what happened.
  - The banner doesn't say what happened or what to do. "Try again." repeats the button under it, and a second try fails the same way.
  - The visitor is in the client's home and can't tell whether to leave.
- **Cause (screen side):**
  - `components/consult/field/WrapClose.tsx:282-286`: the `closing.step === "error" && !slow` branch always uses `W.visitClosedSending` as its heading and always offers **Try again**.
  - `plainWords` (`lib/consult/ui/words.ts:568`) falls through to the generic line for any code it doesn't know.
- **Change:**
  1. **Heading:** add `W.visitNotClosed: 'Not closed yet'` and use it for the error branch. Keep "Visit closed — sending" only for the sending, closing and waiting-signal steps.
  2. **What happened and what to do:** every code that `close()` (`lib/consult/protocol.ts:328-341`) and `deviceGate()` can throw gets its own line and its own primary button. Try again is only for codes where retrying can work:

     | Code | Line | Primary button |
     |---|---|---|
     | `conflict`, `stale_snapshot` | "The office changed this visit since this device last checked. Your answers are saved here." | **Reload** |
     | `complete_locked` | "This visit is already Complete in the office. Nothing was lost." | **‹ Back to visits** |
     | `manifest_sequence_gap`, `unresolved_rejections`, `manifest_blob_missing`, `manifest_initials_missing` | Keep the current lines. | **Send now**, then close again (always shown, not only when `unsent > 0`) |
     | `rebase_required` | Keep the current line. | **Go to field** |
     | `device_access_denied`, `missing_device_manifest_required` | Keep the current lines. | **Keep working** |

     Whatever code engineering finds behind `phone-43` must get its own row, written the same way.
  3. **The fallback, for an unknown code only:** "The office didn't take the close. Nothing was lost — your answers are saved on this device. Try again in a minute; if it says this again, tell Joe." Use the action banner, not alarm red. Keep **Try again** and **Keep working**.
  4. **Test:** every error string `close()` throws maps to a non-default `plainWords` line.
- **Re-shoot:**
  - `phone-43` with the engineering fix in. It should land on **✓ Complete**.
  - One forced refusal (for example a stale `expected_revision`), shot as `phone-43c-close-refused`. Expect "Not closed yet", a line saying what happened, and **Reload**.

**R10-2. The certification warning: date, wording, when it shows, and where (required).**
- **State:**
  - `phone-17c`, `phone-20b` and `tabletL-20` show "⚐ Renovator certification expires 2027-03-01, before the planned finish". On phone the date breaks as "2027-" / "03-01".
  - The Era field where the date is typed (`phone-17bb`, `17bc`) says nothing.
  - `tabletL-20` and `phone-20b` show it after 1965 + No, when Renovate Right doesn't apply and no renovator is needed.
  - The office look-over never shows it (`owner-desktop-31b`). `certification_warnings` is built in `protocol.ts:84`, but `page.tsx` doesn't render it.
- **Why it's wrong:**
  - An ISO date isn't a word Joe uses.
  - "the planned finish" doesn't say when that is.
  - The line doesn't say who acts.
  - It shows when it doesn't matter.
  - It is advice for Joe, but only the visitor sees it.
- **Change:**
  1. **`certificationWarnings` (`lib/consult/rrp.ts:17-22`):**
     - Format both dates the way the rest of the screen does ("Mar 1, 2027", "Jun 30, 2027").
     - Use the field's own words and say what happens next. Firm: "⚐ SJC firm certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Joe renews it before then." Renovator: "⚐ Certified renovator (Dana Kowalski) runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Joe renews it or assigns another renovator."
     - Keep the date in one unbreakable span (`whitespace-nowrap`).
  2. **Show it only when it matters:** when `rrpApplies` is true. Don't show it after 1965 + No.
  3. **Beside the field:** show the same ⚐ line as the hint under **Certified renovator assigned — expiry** and **SJC firm certification — expiry (verify)** once the date is saved. Words go beside the mark where the date was typed.
  4. **Office:** render `snap.certification_warnings` on the look-over close card, under the open lines, in the same calm ⚐ style. Never as a block.
- **Re-shoot:**
  - `phone-17bb` (the line under the expiry field);
  - `phone-17c`;
  - `phone-20b` after 1965 + No (no line);
  - the Renovate Right sheet (`phone-17f-rrp-sheet`, never shot);
  - `owner-desktop-31` on a 1985 + Yes close.

**R10-3. The blocked-close footer leaves a "·" at the end of the line (required, small).**
- **State:** `phone-45`. The footer reads "! 1 conflict to pick before you close ·", and **Go to field** wraps to its own line below. The separator dot is left hanging.
- **Change:** in `WrapClose.tsx:214-218`, drop the `·` span. Lay the line out as `justify-between`: the words on the left, **Go to field** (quiet, at least 56 px tall) on the right, wrapping under them when it doesn't fit.
- **Re-shoot:** `phone-45` at the footer, at 390 and 320.

## Re-shoots still owed (completeness)

1. **A visitor's own close that lands on ✓ Complete** (`phone-43`), after the engineering fix. This is the fourth round. Also the forced refusal (`phone-43c`) from R10-1.
2. **`owner-desktop-47-reopened` after the page refreshes.** Wait for the "In progress" pill before shooting. Expect the "Reopened by Joe · … — Client asked to add a closet measurement." card.
3. **After R10-2:** `phone-17bb`, `17c`, `20b`, the Renovate Right sheet, and the office close card with the warning.
4. **After R10-3:** `phone-45` at the footer.

## Optional extras

- **"0 still open" beside an Open line** (`phone-49`).
  - The sheet header reads "Before you wrap · 0 still open". The trade-walk line under it is ○ Open, and the button says "needs finishing".
  - Count the close checks too: "· 0 fields · 1 to decide". Or say "Fields all done · 1 to decide".
- **Office header mark during a conflict** (`owner-desktop-44-conflict`): the section list says "! Conflict", while the section heading beside it says "◐ Partly". Show "! Conflict" in the heading too, to match the list and the device.
- **Section totals differ by one between office and device.**
  - Bathroom work 1 shows 0/26 in the office and 0/27 on the device.
  - Kitchen work shows 0/25 and 0/26 (`owner-desktop-44-conflict` vs `tabletL-42`, and again in `owner-desktop-47` vs `phone-48`).
  - Engineering should check whether one surface counts a field or photo the other hides. Both should show the same totals.
- **Blocked-close footer height** (`phone-45`).
  - The footer now takes about 230 px of an 844 px screen, which leaves little room for the list.
  - When there is a conflict, consider dropping **Keep working** from the footer, since the sheet's Close does the same.
