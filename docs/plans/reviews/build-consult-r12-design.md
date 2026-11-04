# Build R12 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r12/*`. That is 158 shots plus `log.json`, from a production side build on a fresh database:
- The walk visit is on Tierney.
- The seeded Complete visit and the seeded conflict visit are on M Larson.

**Code:** checked at `03ddd36a`, with `cff2ee60` and `03ddd36a`, against my round-11 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- The sign-in link is `/login?next=%2Fconsult%2F<id>`.
- `close-failure todos`: "Abigail Stafki's visit for Tom Tierney hasn't closed — the office turned the close down; open the visit".
- `phone-conflict-close` timed out on the disabled Close visit button. That block is intended.

**Harness artifacts, not scored:**
- "N other devices".
- No `tabletL-date-client` step.
- The `/api/portal/selection-image/*` 404s.
- `FAIL-phone-rrp`: the 1965 + No shots were not retaken. Round 11's `phone-17d/e` stand.
- `phone-43j`: "Joe has been told" under a signed-out refusal. Only the close was forced. A really signed-out device can't post `report_close_failure`, so it would not show that line.
- The fixture text "Existing locations retained; durable neutral finishes requested." used as room names and answers.

## Why the scores

**Design stays at 9.** This is the best round yet:
- **R11-1 is fixed.** Every refusal's button now goes where its line says, and each was shot after the tap.
- **R11-3 is fixed.** The certification warning names Joe as the one who acts.
- **The walk reaches ◐ Needs finishing again.** It reads the same at 320, 390, tablet portrait and tablet landscape.
- **The extras landed:**
  - the Reload refusal in the calm blue banner;
  - the own ✓ Complete with its time and "‹ Back to visits";
  - "Joe applies the findings in the office." for a staff visitor;
  - one Price-critical count (322/322 on `43`, `43d`, `43f`, `40` and `48c`);
  - the toilet flag in two sentences;
  - the office flags as sentences.

Three small things keep design from 10. Each is about who acts, said in words:
1. **The office to-do falls back to "the office turned the close down" (R12-1).** That happens for known codes, including the one code where Joe himself has to act (`owner_required`).
2. **The Renovate Right sheet tells a staff visitor "Settings › Company fills it in" (R12-2).** The visitor can't reach Settings › Company. The same answer can be typed on this device in Era hazards.
3. **The two ✓ Complete screens disagree about reopening (R12-3).** The visitor's own close offers **Reopen**. The same visit opened a minute later says "Joe can reopen it from the office look-over."

**Completeness stays at 9.**
- **Arrived:**
  - the walk's close result at all four widths;
  - all four forced refusals, three of them with the screen after the button;
  - the Renovate Right sheet with the warning and the re-delivery day (owed since r10);
  - the office close card on a 1985 + Yes close with ⚐ (`owner-desktop-31`, `owner-phone-31`, owed since r10);
  - the own ✓ Complete after a reopen;
  - the calm conflict refusal;
  - the flag sentences in the office and on the device.
- **Still owed:**
  - **`owner-desktop-51` doesn't show the to-do.** The shot stops at "Up next" and the top of "The rest". The row is only in `log.json`.
  - **`phone-45` at 320.** Owed since r10, third round.

---

## Round-11 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R11-1 | A refused close's button must do what its line says | **FIXED** | **`43g` `invalid_command`:**<br>• line "…Check Before you wrap, then close again." over **Before you wrap** / Keep working;<br>• after the tap, `43g-after-button` is the Before you wrap sheet.<br>**`43h` `owner_required`:**<br>• line "Only Joe can set a trade-walk day. Take the day off in Trade walks, then close again." over **Trade walks**;<br>• after the tap, `43h-after-button` is the Trade walks sheet.<br>**`43i` `device_access_denied`:**<br>• line ends "keep working and ask Joe to move the visit to this device";<br>• **Keep working** is the single primary button;<br>• after the tap, `43i-after-button` is the section list.<br>**`43j` `signed_out`:**<br>• **Sign in** + Keep working;<br>• the href is `/login?next=…` (log).<br>`CLOSE_FIX_CUE` ties every code's line to its button, and it is tested. `details[].field` focuses the field the office named. |
| R11-2 | Joe's "hasn't closed" to-do ends in a raw code | **FIXED for the raw code; the office wording has gaps (R12-1)** | **Fixed:**<br>• `officeCloseFailure()` builds the title on the server;<br>• the raw code moves to the body ("Close refusal code: …");<br>• the test checks that no title contains `_` or `http_`.<br>**Gaps:**<br>• The logged row reads "…hasn't closed — the office turned the close down; open the visit". That is the fallback line.<br>• `owner_required`, `rebase_required`, `evidence_too_large`, `batch_too_large`, `person_required`, `access_denied`, `complete_locked`, `json_required`, `csrf` and `consult_key_unavailable` all get it.<br>**Also fixed (my r11 extra):** `conflict` and `stale_snapshot` are no longer reported at once. `43c` has no "Joe has been told" line, which is correct. |
| R11-3 | The certification warning doesn't say who acts | **FIXED** | **`17bb`:** under the expiry field, "⚐ Dana Kowalski's renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Joe renews it or puts another certified renovator on the job."<br>**`17f`:** the same line in a calm card at the top of the Renovate Right sheet.<br>**`owner-desktop-31` / `owner-phone-31`:** the same card at the foot of the office's Needs finishing card.<br>The firm line adds "Apply at least 90 days before it runs out". |
| Re-shoot 1 | The walk's close result | **DONE** | **`phone-29` / `29b`, `w320-29b`, `tabletL-29b`, `tabletP-29b`, `phone-26b`:**<br>• "◐ Needs finishing";<br>• "258 open. A Finish consultation to-do was made.";<br>• six rows, each with an Open mark and a word.<br>The rows add up: 225 + 29 + initials + devices + Renovate Right + trade walks = 258.<br>The office agrees, 258 open (`owner-desktop-31`).<br>On tablets each button sits at the end of its row, with no overflow. At 320, "Finish consultation to-do" hyphenates "to-do" at the line end. That is acceptable. |
| Re-shoot 2 | Renovate Right sheet with the warning | **DONE** | **`17f` / `17g` / `17gg`:**<br>• the reason it applies;<br>• the ⚐ warning card;<br>• two **! Problem** rows and one **✓ Done** row;<br>• Go to Era hazards;<br>• the re-delivery check.<br>**With re-delivery checked:** "Re-deliver on — Between 60 and 7 days before the start, so the pamphlet still counts. Pick a day from Dec 3, 2026 to Jan 25, 2027." The dates are in words and kept on one line, over a 56 px date field.<br>**The firm row's words: R12-2.** |
| Re-shoot 3 | Office close card on a 1985 + Yes close | **DONE** | `owner-desktop-31`, `owner-phone-31`. Each row says who finishes it ("— Abigail Stafki finishes this on the visit device."). |
| Re-shoot 4 | `phone-45` at 320 | **MISSING** (third round) | Only the 390 shot exists. It still reads well there: "! 1 conflict to pick before you close", a quiet Go to field, and a disabled "Close visit — pick the conflict first". |
| Re-shoot 5 | `phone-43g-refused-wrap` | **DONE** | See R11-1. |
| Re-shoot 6 | `owner-desktop-51-close-failure-todo` | **SHOT, BUT THE TO-DO IS NOT IN THE FRAME** | It shows the Today page down to "The rest · Tierney · Kitchen 1". The to-do row is only in `log.json`. |
| Extra | Own ✓ Complete matches the opened one | **MOSTLY** | **The same as the opened one now:**<br>• the time in the heading ("✓ Complete · Nov 3, 7:01 pm");<br>• "‹ Back to visits";<br>• the counts line (322/322 · 2/2 · 34 skipped);<br>• "Joe applies the findings in the office." for a staff visitor.<br>**Still different:** Reopen. See R12-3. |
| Extra | Notify Joe only when the visitor can't fix the refusal | **PARTLY, and I accept that** | `conflict` and `stale_snapshot` wait. `invalid_command` still reports at once. That is defensible, because it usually means the office has a bug. |
| Extra | Calmer banner for Reload refusals | **DONE** | `43c` / `43cc`: a blue status banner. "…reload to get the office's copy, then close again." over **Reload** / Keep working. |
| Extra | 324 vs 325 Price-critical | **FIXED** | 322/322 everywhere for M Larson. |
| Extra | Office flag fragments | **FIXED** | `owner-desktop-50b`:<br>• "A cast-iron tub takes two people to remove or break up.";<br>• "Not the usual 12″ toilet rough-in — the new toilet has to match it.".<br>`29c`: "Measured 20″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code)."<br>`29e`, the kept toilet: "Measured 20″ in front of the toilet. It's staying where it is, so the code doesn't force a change. …". |

---

## Required fixes

**R12-1. The office to-do must say what happened for every known code, especially the one Joe acts on (required, small).**
- **State:** `log.json` → `close-failure todos`: "Abigail Stafki's visit for Tom Tierney hasn't closed — the office turned the close down; open the visit".
  - `officeCloseFailure()` (`lib/consult/close-errors.ts:16`) covers only the conflict, device, manifest, `invalid_command` and transient codes. Ten known codes fall through to that line.
  - **The worst case is `owner_required`.** The visitor put a trade-walk day on the visit, and only Joe can set it. Joe is the one person who can act, and his to-do tells him nothing.
  - "the office turned the close down" reads oddly in Joe's own queue, because he is the office.
- **Change:** add office-voice lines for the remaining known codes, and soften the fallback:
  - `owner_required`: "they put in a trade-walk day only you can set — set it in the look-over, or tell them to take it off"
  - `rebase_required`: "you reopened it after they typed answers; they need to pick which value to keep"
  - `evidence_too_large` / `batch_too_large`: "the notes were too long to send at once; open the visit and look over the notes"
  - `signed_out`: "their device was signed out; they need to sign in and close again"
  - `access_denied` / `person_required`: "their access to the visit changed; open the visit"
  - `complete_locked`: "it was already Complete; nothing to do"
  - `json_required` / `csrf` / `consult_key_unavailable`: "the app on their device was out of date or the server wasn't ready; they need to reload and close again"
  - fallback: "the app didn't take the close; open the visit"
- **Test:** for every `CLOSE_ERROR_ACTIONS` code, `officeCloseFailure(code)` is not the fallback line.
- **Re-shoot:** `owner-desktop-51-close-failure-todo`, scrolled (or filtered) so the to-do row is in the frame. Force `owner_required` last, so the shot shows that line.

**R12-2. The Renovate Right sheet's firm row sends a staff visitor to a place they can't reach (required, small).**
- **State:** `phone-17f` / `17g`.
  - The row reads **! Problem · SJC firm certification is current** — "Firm certification expiry is missing or before the visit day. Settings › Company fills it in."
  - Abigail can't open Settings › Company.
  - The same answer is a field on this device: "SJC firm certification on file" / "— cert #" / "— expiry (verify)" in Era hazards (`17bb`, `shared.ts:410-412`). The **Go to Era hazards** button is right under the row.
  - The renovator row ("Certified renovator expiry is missing or before the visit day.") has no action at all.
  - The pamphlet row is the model to follow: it says where to go.
- **Change** (`lib/consult/ui/words.ts:252-253`):
  - `rrpFirmOpen`: "Firm certification expiry is missing or before the visit day. Enter it in Era hazards, or Joe adds it in Settings › Company."
  - `rrpRenovatorOpen`: "Certified renovator expiry is missing or before the visit day. Enter it in Era hazards."
- **Re-shoot:** `phone-17f`.

**R12-3. The two ✓ Complete screens disagree about who can reopen (required, small).**
- **State:**
  - `phone-43` / `43d` / `43f`, the visitor's own close: "✓ Complete · Nov 3, 7:01 pm", the counts, "Answers and photos sent ✓", "Joe applies the findings in the office.", **Reopen**, **‹ Back to visits**.
  - `phone-40`, the same kind of visit opened from the list: "✓ Complete · Nov 3, 6:48 pm", the counts, "**Answers are locked. Joe can reopen it from the office look-over.**", **Look over**, **‹ Back to visits**.
  - So the same staff visitor is offered Reopen on one screen and told only Joe reopens on the other.
  - Every reopen in this run was Joe's ("Reopened by Joe", `48c`, `49`, `owner-desktop-47`).
- **Change:** one answer on both screens, from the same role check (`staffUser`).
  - **Recommended:** for a staff visitor, the own-close screen drops **Reopen** and shows the CompleteCard line, "Answers are locked. Joe can reopen it from the office look-over." This matches "Joe applies the findings in the office."
  - For Joe on his own device, both screens offer **Reopen**.
  - If staff reopening is meant to stay, then CompleteCard offers **Reopen** too, and its line becomes "Answers are locked. Reopen it if something was missed."
  - Either way, the own-close screen also says "Answers are locked."
- **Re-shoot:** `phone-43` (staff) and `phone-40`.

## Re-shoots owed (completeness)

1. `owner-desktop-51-close-failure-todo`, with the row in the frame (after R12-1).
2. `phone-45` at 320 (owed since r10).
3. `phone-17f` (after R12-2).
4. `phone-43` and `phone-40` (after R12-3).

## Optional extras

- **Say why Before you wrap opened.** After **Before you wrap** with no `details[].field` (`43g-after-button`), the sheet opens on "257 still open" and nothing says which answer the office couldn't read. A one-line calm note at the top would help: "The office couldn't read these answers — check them, then close again." The same goes for Trade walks after `owner_required`: scroll to the trade that has a day.
- **One back label on both close results.** ◐ Needs finishing says **Back to SJC OS**, while ✓ Complete now says **‹ Back to visits**. Use "‹ Back to visits" on both.
- **Heading widow.** "✓ Complete · Nov 3, 7:01 / pm" leaves "pm" alone on the second line at 390 (`43`, `40`). Keep the time together with `whitespace-nowrap` on "7:01 pm".
- **Office flag punctuation.** A sentence that ends in "." followed by " — not an issue" reads "break up. — not an issue". Drop the period before the dash, or put the decision on its own muted line.
- **Mark on decided flags in the office.** Every decided flag still carries the red ⚑, including "not an issue". A muted ⚐ for decided flags would match the device's calm "kept" card (`29e`).
