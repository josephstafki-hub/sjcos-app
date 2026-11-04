# Build R11 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r11/*`. That is 150 shots plus `log.json` and `log-refused.json`, from a production side build on a fresh database:
- The walk visit is on Tierney.
- The seeded Complete visit and the seeded conflict visit are both on M Larson.

**Code:** checked at `19bafac8`, with `6d62e067` and `19bafac8`, against my round-10 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- `rrp_lines`:
  - 1985 + Yes reads "receipt not recorded · firm certification not on file";
  - 1965 + No is empty.
- `phone-conflict-close` timed out on the disabled Close visit button. That block is intended.

**Harness artifacts, not scored:**
- "N other devices".
- No `tabletL-date-client` step.
- The `/api/portal/selection-image/*` 404s.
- `FAIL-w320-refused-persistent`: the second device was stopped by the lease limit. Its "Not ready · Works without signal" screen was judged and accepted in r3.
- The fixture text "Client requests durable neutral finishes; existing locations retained." used as room names and permit answers.

## Why the scores

**Design stays at 9.** All three round-10 fixes landed on the states that were shot, and so did every extra:
- A refused close now says **Not closed yet**, says what happened, and offers one fix.
- The certification warning:
  - names the renovator and both dates in words;
  - sits under the expiry field;
  - is gone after 1965 + No.
- The blocked-close footer has no dangling dot, and Keep working steps aside.
- The visitor's own close finally lands on **✓ Complete**, both from a fresh phone and from the same phone after a second reopen.

Three things keep design from 10. All three are words:
1. **A refused close can offer a button that doesn't do what its line says (R11-1).** This is now seen on the main walk at every width: "Check Before you wrap, then close again" over **Go to field**, and Go to field lands on a flagged toilet field.
2. **Joe's "hasn't closed" to-do ends in a raw code (R11-2).** For example "— invalid_command" or "— conflict".
3. **The certification warning doesn't say who acts (R11-3).** On the visitor's device it tells Abigail to "Renew it or put another certified renovator on the job".

**Completeness stays at 9.**
- **Arrived:**
  - the own close to ✓ Complete (owed for four rounds);
  - the same-device re-close;
  - the persistent refusal with Reload;
  - the auto-retried one-off refusal;
  - the certification warning in three places;
  - `phone-45`;
  - the office reopen card with the In progress pill, three times;
  - the office after the re-closes.
- **Lost this round:** the main walk's close never reaches a result. `phone-26b`, `phone-29`, `w320-29`, `tabletL-29` and `tabletP-29` all end in an `invalid_command` refusal. Round 10 showed **◐ Needs finishing** there. The office agrees: `owner-desktop-31` shows the Tierney visit **In progress**, "Closed on device · not yet". The Needs-finishing result screens, the main path's last screen, were not seen this round. See the defect note below.
- **Still owed from R10-2, second round:**
  - the Renovate Right sheet with the warning;
  - the office close card on a 1985 + Yes close (`owner-desktop-31` is the 1965 + No walk);
  - `phone-45` at 320.

---

## Round-10 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R10-1 | A refused close says "Visit closed — sending" and a generic error | **FIXED on the codes that were shot; the code-to-button map has gaps (R11-1)** | **`phone-43c-close-refused-conflict`:**<br>• "Not closed yet";<br>• "The office changed this visit since this device last checked. Your answers are saved here.";<br>• **Reload**, **Keep working**.<br>**`phone-29`, `w320-29`, `tabletL-29`, `tabletP-29`, `phone-26b`:**<br>• "Not closed yet";<br>• "The office couldn't read the wrap-up answers. Check Before you wrap, then close again.";<br>• "Joe has been told this visit hasn't closed.";<br>• **Go to field**, **Keep working**.<br>The heading is honest, the line says what happened, and Try again only appears for `consult_key_unavailable` and unknown codes. **The button doesn't always match the line: R11-1.** |
| R10-2 | Certification warning: date, wording, when it shows, where | **FIXED where shot; the wording leaves out who acts (R11-3)** | **`phone-17bb` / `17bc`:** under **Certified renovator assigned — expiry**: "⚐ Dana Kowalski's renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Renew it or put another certified renovator on the job." Both dates stay on one line.<br>**`phone-17c`:** the same line on Before you wrap, in a calm paper card under the Renovate Right Open row.<br>**`phone-17e`:** absent after 1965 + No, and `rrp_lines` is empty.<br>**`CertWarning.tsx`:** one component, shared with the office close card and the look-over. |
| R10-3 | Blocked-close footer leaves a "·" | **FIXED** | `phone-45`: "! 1 conflict to pick before you close", then a quiet **Go to field** under it. No dot. **Keep working** is gone while a conflict is open, so the footer drops from about 230 px to about 180 px. Not shot at 320. |
| Re-shoot 1 | Own close lands on ✓ Complete | **DONE** | `phone-43` / `43b`: "✓ Complete · Price-critical 325/325 · Record 2/2 · 33 skipped · Answers and photos sent ✓". `phone-43d` shows the same after a second reopen on the same phone. `phone-43c` / `43f` show a one-off refusal auto-retried through to the same screen. |
| Re-shoot 2 | Office reopened line after refresh | **DONE** | `owner-desktop-47-reopened-1/2/3`: the **In progress** pill, then "Reopened by Joe · Nov 3, 6:13 pm — Client asked to add a closet measurement." in a calm card above the sections. Each reopen shows its own reason. `owner-desktop-50`: back to "✓ Complete · Nov 3, 6:13 pm" with **Reopen**, "Client initialed ✓", "Closed on device ✓". |
| Re-shoot 3 | Certification warning shots | **PARTLY** | `17bb`, `17c` and `17e` are done. The Renovate Right sheet and the office close card on a 1985 + Yes close are still not shot. |
| Re-shoot 4 | `phone-45` at 390 and 320 | **390 done; 320 missing** | — |
| Extra | Office heading mark during a conflict | **FIXED** | `owner-desktop-44-conflict`: "Access & logistics 1/11 ! Conflict" in the heading, matching the list. |
| Extra | Section totals differ office vs device | **FIXED** | Bathroom work 1 is 0/27 and Kitchen work is 0/26 in both the office (`owner-desktop-31`) and on the device (the `tabletL-date-client` log). |
| Extra | Wrap count leaves out conflicts | **FIXED** | It is counted once per conflict line (`phone-45`). |
| Extra | Footer height while blocked | **FIXED** | Keep working steps aside. See R10-3. |

## The two missing shots, and whether they matter for a 10

- **"Joe has been told": already captured, and it doesn't need 30 minutes.**
  - `controller.ts:585` reports **at once** for any code that `transientClose()` doesn't treat as transient. Only `no_signal`, 408, 429 and 5xx wait the 30 minutes.
  - The walk's `invalid_command` refusal shows the line on `phone-26b`, `phone-29`, `w320-29`, `tabletL-29` and `tabletP-29`. It is muted ink-2 text under the banner. Calm and right.
  - It is absent on `phone-43c-close-refused-conflict`, although `conflict` is also reported at once. Most likely the harness's persistent 409 caught the `report_close_failure` POST too. The coordinator should confirm. No extra shot is needed for the line itself.
  - What does matter is the **office side**, Joe's to-do (R11-2). One owner Today/Engine shot of that to-do is owed after the fix.
- **The 320 unknown-code refusal does not matter for a 10.**
  - The fallback line is fixed text, covered by `tests/consult-r10-design.test.mjs`.
  - The layout is the one `w320-29` already shows at 320: a three-line banner, the muted line and two 56 px buttons, with no overflow.
  - The fallback is one line longer. That is not a new layout risk.

## Known defect for engineering (judged only for how the screen presents it)

**The main walk's close is refused with `invalid_command` at every width** (`phone-26b`, `phone-29`, `w320-29`, `tabletL-29`, `tabletP-29`). Round 10 reached ◐ Needs finishing on the same path.
- `invalid_command` is the route's catch-all: any error whose message is not in the list at `app/api/consult/[id]/route.ts:41`, or any `ZodError`, ends up as a 422 with that code.
- **Suspects, in the commits since r10:**
  - `consult_reconcile_rrp` and the `0084_consult_multi_validation.sql` checks from `44d76fff`. The walk goes 1985 + Yes with a renovator entered, then 1965 + No. RRP evidence left over from the first answer is a candidate.
  - `closeAgain()` / `clearCloseRequest()` from `6d62e067`, after the offline close on phone and the timeout on tabletP.
- If the harness injected this refusal, say so, and re-shoot the walk's close result without the injection.
- Either way, the walk's ◐ Needs finishing screens (`*-29`, `29b`) must be shot again.

---

## Required fixes

**R11-1. A refused close's button must do what its line says (required).**
- **State:** `phone-29`, `w320-29`, `tabletL-29`, `tabletP-29`.
  - The line reads "…Check Before you wrap, then close again."
  - The primary button is **Go to field**.
  - `phone-29d-after-go-to-field` shows where that lands: the Toilet front clearance field. That is not Before you wrap, and nothing there says why the close was refused.
- **Cause:** `CLOSE_ERROR_ACTIONS` (`lib/consult/close-errors.ts`) maps seven codes to `go_to_field`. `ConsultApp.tsx:184` turns that into `setAfter("go_conflict")`. That only makes sense for `rebase_required`. The other six lines tell the visitor to do something else:

  | Code | What the line says | Today's button | Change to |
  |---|---|---|---|
  | `invalid_command` | Check Before you wrap, then close again | Go to field | **Before you wrap** (opens the wrap sheet) |
  | `owner_required` | Take the day off, then close again | Go to field | **Trade walks** (opens the trade-walk sheet, where the day is) |
  | `device_access_denied` | ask Joe to move the visit to this device | Go to field | **Keep working** only (as in my r10 table) |
  | `missing_device_manifest_required` | Close it on that device, or ask Joe to set it aside | Go to field | **Keep working** only |
  | `evidence_too_large`, `batch_too_large` | ask Joe to look over the visit | Go to field | **Keep working** only |
  | `signed_out` | sign in, then close again | Reload | **Sign in** (the same `/login?next=` link the signed-out banner uses) |
  | `rebase_required` | Pick which value to keep, then close again | Go to field | Keep. It is right. |

  - Add `before_you_wrap`, `trade_walks` and `sign_in` to `CloseFix`.
  - Where the only honest action is to wait for Joe, the screen shows **Keep working** as the single (primary) button. No dead button.
- **Test:** for every `CLOSE_ERROR_ACTIONS` code, the fix's label names a place or action that appears in that code's line.
- **Re-shoot:** after engineering fixes the walk, the walk's `phone-29` should reach ◐ Needs finishing, not this screen. To see R11-1 itself, force one `invalid_command` and shoot it after tapping **Before you wrap**, as `phone-43g-refused-wrap`.

**R11-2. Joe's "hasn't closed" to-do ends in a raw code (required, small).**
- **State:** not shot, but certain from the code. `protocol.ts:487` writes the title as `` `${visitor}'s visit for ${client} hasn't closed — ${v.reason}` ``. The reason is the raw `rawCode` the device posts (`controller.ts:586`). After this run Joe's Today reads:
  - "Abigail Stafki's visit for Tom Tierney hasn't closed — invalid_command";
  - "…Michael Larson hasn't closed — conflict".

  The codes Joe would see in his queue include `manifest_sequence_gap`, `device_access_denied` and `http_503`.
- **Change:**
  - Add an office-voice table next to `CLOSE_REFUSED_LINES`, keyed by the same codes. It describes the problem in the third person and never shows the code:
    - `conflict` / `stale_snapshot`: "this device was behind the office";
    - `invalid_command`: "the office couldn't read the wrap-up answers";
    - `device_access_denied`: "it's being filled in on another device — move the visit or set that device aside";
    - `missing_device_manifest_required`: "another device hasn't closed — close it there or set it aside";
    - transient codes: "the office didn't answer for 30 minutes";
    - unknown codes: "the office didn't take the close".
  - Build the title from that table on the server, from the posted code. Keep the raw code in the to-do's detail or metadata for engineering only.
- **Test:** the to-do title for every `CLOSE_ERROR_ACTIONS` code, and for an unknown code, contains no `_` and no `http_`.
- **Re-shoot:** one owner Today (or Engine) shot of the to-do after a forced refusal: `owner-desktop-51-close-failure-todo`.

**R11-3. The certification warning doesn't say who acts (required, small).**
- **State:** `phone-17bb`, `phone-17c`. On the visitor's device the line ends "Renew it or put another certified renovator on the job."
  - Abigail can't renew Dana's certification or assign a renovator. Those are Joe's.
  - In the office the same line is fine.
  - My r10 change named Joe: "Joe renews it or assigns another renovator." The reason given then was "The line doesn't say who acts", and it still applies on the device.
- **Change:** in `certWarningParts` (`lib/consult/rrp.ts`), name who acts:
  - Renovator: "Joe renews it or puts another certified renovator on the job."
  - Firm: "Joe renews it before then."

  One wording for both surfaces is fine, since it reads correctly in the office too.
- **Re-shoot:**
  - `phone-17bb`;
  - the Renovate Right sheet (`phone-17f-rrp-sheet`);
  - `owner-desktop-31` on a 1985 + Yes walk close, showing the card on the close summary.

## Re-shoots owed (completeness)

1. **The walk's close result** (`phone-29`, `29b`, `w320-29`, `tabletL-29`, `tabletP-29`), reaching ◐ Needs finishing after the engineering fix or with the injection removed.
2. **The Renovate Right sheet with the warning** (`phone-17f-rrp-sheet`), owed since r10.
3. **The office close card on a 1985 + Yes close, with the ⚐ warning** (`owner-desktop-31`), owed since r10.
4. **`phone-45` at 320**, owed since r10.
5. **After R11-1:** `phone-43g-refused-wrap`.
6. **After R11-2:** `owner-desktop-51-close-failure-todo`.

## Optional extras

- **The own-close ✓ Complete (`phone-43`) differs from the opened Complete (`phone-40`).**
  - `phone-40` reads "✓ Complete · Nov 3, 5:59 pm", "Answers are locked. Joe can reopen it from the office look-over.", **Look over**, **‹ Back to visits**.
  - `phone-43` reads "✓ Complete" with no time, "Answers and photos sent ✓", **Apply findings** alone in a box, **Reopen**, **Back to SJC OS**.
  - Add the time to the heading, and use "‹ Back to visits" as the back label, so the two read alike.
  - **Apply findings** is the most prominent button on the screen and has no words beside it. Add one line in its box saying what it does (for example "Puts today's measurements and flags into the job's scope"). Or, for a staff visitor, say "Joe applies the findings in the office" and drop the button.
- **Notify Joe only when the visitor can't fix the refusal.**
  - `conflict`, `stale_snapshot`, `evidence_conflict`, the `send_now` codes and `invalid_command` are fixed on the device in a tap or two. Telling Joe about them at once adds a to-do that clears itself seconds later.
  - Report those after the same 30 minutes as the transient codes. Report at once only for `device_access_denied`, `missing_device_manifest_required`, `access_denied`, `evidence_too_large` and `batch_too_large`.
- **The refusal banner's tone.**
  - My r10 line "use the action banner, not alarm red" was wrong about the system. `kind="action"` **is** the red-tinted ⚠ banner (`primitives.tsx:38`). Using it for "act now" states is consistent with the rest of the app, so I accept it.
  - For the Reload codes, where nothing is wrong and one tap fixes it, the blue `status` banner would be calmer. Your call.
- **Price-critical 324/324 vs 325/325.** On the same visit, the reopened view (`phone-48c`) shows 324/324 and the close result (`phone-43d`) shows 325/325. Engineering should check whether one count includes a field the other drops.
- **Office flag lines that aren't sentences** (`owner-desktop-50b`): "⚑ > wall available", "⚑ cast iron: 2-person demo / break-up". By design the office shows `issue`, but these two read as fragments. Give the bare-fragment issues a short office sentence, or show the hint after the issue.
