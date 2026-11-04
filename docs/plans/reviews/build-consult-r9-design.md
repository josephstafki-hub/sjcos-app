# Build R9 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=9

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r9/*`. That is 136 shots plus `log.json`, from a production side build on a fresh database:
- The walk visit is on Tierney.
- The seeded Complete visit and the seeded two-device conflict visit are both on M Larson.

**Code:** checked at `f99b338c`, with commits `489490f3` and `f99b338c`, against my round-8 list.

**Logs:**
- `overflow_px: 0` on every shot.
- `held: 2`.
- `rrp_lines` has the three-part Renovate Right line for 1985 + Yes, and nothing for 1965 + No.
- `phone-conflict-close` timed out on a **disabled** Close visit button. That is the intended block, so it is not a failure.

**Harness artifacts, not scored:**
- "N other devices haven’t sent yet" (one device per width).
- No client-view date step on tabletL (`tabletL-date-client`), because the date was already picked.
- The 404s on `/api/portal/selection-image/*`.
- "243 skipped" on the seeded Complete visit.

**Coordinator observations, judged only for what they do to the screen:**
- **"Both conflict sides read ‘· earlier’":** confirmed on all five picker shots. Required as R9-1.
- **"The reopened visit closed as ‘Needs finishing · 241 open’":** the cause goes to the engineering judge. The screen result is covered under R9-3 and in completeness.

## Why the scores

**Design stays at 9.** All three round-8 fixes landed:
- The office picker is laid out correctly at every width.
- No device code is left on screen.
- The kept-toilet words now match the choices.

All six extras are in too. This round's new states are calm and mostly right.

**What keeps design from 10** is three things:
- **The conflict buttons can't be told apart again (R9-1).** Both read "Abigail · 4:33 pm · earlier", so the R8-2 goal still isn't met in the case the seed builds.
- **The close blocked by a conflict doesn't say why (R9-2).** The Close visit button is grey with no words beside it, and the wrap line drops the "›".
- **A reopened visit doesn't say it was reopened, or why (R9-3).** On the device it opens as a plain section list showing 3/244, while the office shows 19/19 Covered everywhere.

**Completeness rises to 9.** I'm counting what arrived against what's still owed.

Arrived, including three re-shoots owed for two rounds:
- the field, office (rail open and closed) and owner-phone conflict pickers;
- the close blocked by a conflict, with its ⚠ line (`phone-45`);
- the Renovate Right line on screen (`phone-17c`), and its absence (`17e`);
- opening cards 1–6;
- the toilet flag both ways;
- the skipped date with Change reason… / Undo skip;
- the drawn boxes;
- the client view;
- the Complete pill and card;
- the reopen sequence.

Still missing, for the third round: the moment a visitor's **own** close lands on **✓ Complete**. The reopen path was meant to show it, but `phone-43` lands on ◐ Needs finishing · 241 open.

---

## Round-8 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R8-1 | Office conflict picker text spills out of its buttons | **FIXED** | **Rail open** (`owner-desktop-44-conflict-lookover`):<br>• one column, labels inside the buttons;<br>• heading "! Conflict · Access & logistics › Narrowest door or turn on that path".<br>**Rail closed** (`owner-desktop-rail-closed-44c-conflict-picker`): two columns from the container query, both readable.<br>**Phone** (`owner-phone-44c-conflict-picker`): one column, fits.<br>"Enter another" is now the plain line "To use a different value, pick one, then the visitor types the new one on the visit device." |
| R8-2 | Conflict sides named by a device code | **FIXED as asked, with a new tie problem** | No "device a2b6c036" anywhere. Sides read "Abigail · 4:33 pm". **Both sides add "· earlier": see R9-1.** |
| R8-3 | Kept toilet says Joe decides, then asks the visitor | **FIXED** | **Field** (`phone-19c`): "⚐ Flag · Less than 24″ in front of the toilet. It’s staying where it is, so the code doesn’t force a change. Pick ‘Not an issue’ if it stays, or ‘Price it’ if the client wants it moved. The choices are in Before you wrap."<br>**Card** (`phone-29e`): "Measured 20″ — …", calm outline ⚐ in ink, no red.<br>**New toilet** (`phone-19b`, `29c`): stays the red code flag. Right. |
| Re-shoot 1 | Close blocked by a conflict | **SHOT, needs words (R9-2)** | `phone-45`: the red "! Conflicts: … — changed on another device" line with **Go to field**. The footer **Close visit — needs finishing** is disabled. |
| Re-shoot 2 | Field close that lands on ✓ Complete | **STILL MISSING** | `phone-48/49/43`: the reopened visit closes as ◐ Needs finishing · 241 open. See completeness. |
| Re-shoot 3 | Renovate Right line on screen | **DONE** | `phone-17c`: "○ Open · Renovate Right: receipt not recorded · firm certification not on file · renovator certification not on file" with **Review**. `phone-17e` (1965 + No) has no such line. |
| Re-shoot 4 | Fixed pickers | **DONE** | `phone-42`, `tabletL-42`, `owner-desktop-44*`, `owner-phone-44c` |
| Extra | Skipped field still offers "Skip this field…" | **DONE** | `w320-22b`: "– Skipped", **Change reason…** and **Undo skip**. |
| Extra | Drawn checkboxes | **DONE** | `phone-17d`: 20 px drawn squares that match the rings. |
| Extra | "another room" on the client view | **DONE** | `w320-24b`: "Not measured today: the bathroom, the kitchen, two more rooms." The unnamed rooms now come last. See the optional extras. |
| Extra | "checked at Before pricing" | **DONE** | `owner-desktop-44-complete`: "… · checked before pricing" |
| Extra | Office "Enter another" | **DONE** | It is now a plain line (see R8-1). |
| Extra | "✓ Covered ! Conflict" on one field | **DONE** | `phone-42` and `tabletL-42` field heads show only "! Conflict". The office row does the same. |

## New states this round, judged

| Shot | Verdict |
|---|---|
| `owner-desktop-44-conflict-*`, `-rail-closed-44c`, `owner-phone-44c` | Layout good at all three widths. **The labels tie (R9-1).** |
| `phone-42`, `tabletL-42` field conflict | Layout good, 56 px buttons, one column, field head shows "! Conflict" only. **The labels tie (R9-1).** The buttons say `18"` (straight quote) while the field above says `18″` (R9-1). |
| `phone-45` close blocked by a conflict | The line and **Go to field** are right. **The disabled close has no words, and the "›" is missing (R9-2).** |
| `owner-desktop-47` reopened in the office | "In progress" pill, plus "Reopened: Client asked to add a closet measurement." Calm and clear. |
| `phone-48` reopened visit on the device | **No sign it was reopened, or why (R9-3).** It shows "Price-critical 3/244", "House & household 1/19 ◐ Partly" and every other section ○ Open. The office shows the same visit as 19/19 ✓ Covered. Why the counts differ is for engineering. On screen, it looks to the visitor like the visit was wiped. |
| `phone-49` Before you wrap on it | The date ✓ and Client initials ✓ carried over. "241 still open". Footer enabled. Fine as a screen. |
| `phone-43/43b` own close result | ◐ Needs finishing, "241 open. A Finish consultation to-do was made.", with Answers / Photos / Trade walks lines, each with its action. Calm and correct for what it got. **Not the ✓ Complete close that was asked for.** |
| `phone-17c`, `17e` | Correct (re-shoot 3). |
| `phone-05`, `06-opening-card-2…6`, `-7` | The script cards read well, as one quote per card. Card 4 puts **Photos okay?** right under its line. Card 6 ends on the client’s own list, and Next goes to the section list. See the optional extras for the heading jump and the doubled hint. |
| `phone-19/19b/19c/29c/29d/29e` | Correct both ways (R8-3). |
| `w320-22/22b/22c` | Correct. "– Skipped" with no "N/A". The hint becomes "Joe gets a to-do to set the date." |
| `w320-24/24b` client view | "NEXT · Joe sends your formal estimate." with no date. Initials box, the disabled **This is what we went over** with "Initial the box first" beside it, then **Hand back — hold 2 seconds** and **Use PIN instead**. All fit at 320. |
| `phone-17d` | Drawn boxes. Good. |
| `owner-desktop-44-complete*`, `phone-40`, `tabletL-40`, `phone-41` | Complete pill: "✓ Complete · Nov 3, 4:33 pm · 7 estimate quantities not measured", with **Reopen** and **← Project**. The device card reads "✓ Complete · Nov 3, 4:33 pm", then "7 estimate quantities not measured", then the locked line, **Look over** and **‹ Back to visits**. Calm and honest. |
| Rest of the walk (`*-07…29`, `tabletP-27/28/29`, `w320-*`) | No regressions against round 8. |

---

## Required fixes

**R9-1. Both conflict sides read "· earlier", so the buttons can’t be told apart (required).**
- **State:** these shots show "Pick 18" · Abigail · 4:33 pm · earlier" and "Pick 19" · Abigail · 4:33 pm · earlier":
  - `phone-42` and `tabletL-42` (field);
  - `owner-desktop-44-conflict-lookover`, `owner-desktop-rail-closed-44c-conflict-picker` and `owner-phone-44c-conflict-picker` (office).
- **Why it’s wrong:** same person, same minute, same word. The visitor still can’t tell which value is newer, and that is the one thing R8-2 asked the label to answer.
- **Cause:** `conflictSideLabel` in `lib/consult/ui/words.ts:622-623` compares the two times with `<=`. When the two `created_at` are equal (as the seed writes them), each side calls itself "earlier".
- **Change:**
  1. **Order the two sides once, strictly, and hand the result to both labels.** Order by the answer’s server revision (or `created_at`, then `id` as the tie-break). Then exactly one side says "· earlier" and the other "· later".
     - Do it in the two call sites that already have both sides: `server.ts:130` and `protocol.ts:46`.
     - Or do it inside the helper, with `<` plus an id tie-break, never `<=`.
  2. **Use the same length text as the field.** Build the "Pick {value}" text with the field’s `showLength` / `show()` (both are in `FieldRow.tsx`), so the button says `18″` the way the field above it does, not `18"`. The office row already shows `18″`.
  3. Add a test that two same-minute sides get different labels.
- **Re-shoot** `phone-42` and `owner-desktop-44-conflict`. Expect "Pick 18″ · Abigail · 4:33 pm · earlier" and "Pick 19″ · Abigail · 4:33 pm · later".

**R9-2. The close blocked by a conflict doesn’t say why, and the wrap line drops the "›" (required, small).**
- **State:** `phone-45-wrap-conflict-line`:
  - The footer shows a grey **Close visit — needs finishing**.
  - That label promises a close the visitor can’t make, and there are no words beside it.
  - The only explanation is the red line further up the sheet: "! Conflicts: Access & logistics Narrowest door or turn on that path — changed on another device". That line has no "›" between section and field, and says "Conflicts" for one conflict.
  - The visitor at the bottom of the sheet sees a dead button and no reason.
- **Cause:** `components/consult/field/WrapClose.tsx:52` disables the button on `model.conflicts.length > 0` and keeps the same label. Line 63 builds the field name as `` `${s?.label} ${f?.def.label}` ``.
- **Change:**
  1. While a conflict is open, change the footer button’s label to **"Close visit — pick the conflict first"**, and put one line above the footer buttons: "! 1 conflict to pick before you close · Go to field". Use the same words as the office line "! 1 conflict to pick".
  2. Build the wrap line’s field name as `` `${s.label} › ${f.def.label}` ``, the same as the office heading.
  3. Make `conflictsLine` singular when there is one: "Conflict: {field} — changed on another device".
- **Re-shoot** `phone-45` scrolled to the line, and again at the footer.

**R9-3. A reopened visit doesn’t say it was reopened, or why (required).**
- **State:**
  - **Office** (`owner-desktop-47-reopened`): "Reopened: Client asked to add a closet measurement."
  - **Device** (`phone-48-reopened-visit`): the plain section list, "Michael Larson · Bathroom + Kitchen · Price-critical 3/244". It doesn’t say it was reopened, who reopened it, why, or what to do.
  - **The counts disagree.** The office shows 19/19 Covered in every section. The device shows 1/19 and Open. Why is the engineering judge’s question. On screen, it looks to the visitor like the visit was wiped.
  - The visitor went on to close it as ◐ Needs finishing · 241 open (`phone-43`), and Joe only wanted a closet measurement.
- **Change:**
  1. When `reopen_reason` is set and the visit isn’t closed again, show one calm line at the top of the section list, in the same style as the "What we know so far" card:
     **"Reopened by Joe · Nov 3, 4:40 pm — Client asked to add a closet measurement."**
     The person is whoever reopened it: "Joe", or the visitor’s first name.
  2. Show it on Before you wrap too, above the first line, so the visitor closes with the reason in view.
  3. Once engineering makes the device counts match the office, the reopened visit should open showing the same coverage it had at Complete, and should close back to ✓ Complete after the one added answer. That is the re-shoot below.
- **Re-shoot** `phone-48` and `phone-49` with the line showing.

## Re-shoots still owed (completeness)

1. **A visitor’s own close that lands on ✓ Complete, on the field device.** This is the third time it has been asked for.
   - Reopen the seeded Complete visit, answer the one field, close, and shoot the result (`phone-43-own-close-result`). It should read ✓ Complete, not ◐ Needs finishing.
   - If the reopen path stays blocked on engineering, answer or skip everything on a small visit instead.
2. **After R9-1:** `phone-42` and `owner-desktop-44-conflict`, showing one "earlier" and one "later".
3. **After R9-2:** `phone-45`, at the line and at the footer.
4. **After R9-3:** `phone-48` and `phone-49`.

## Optional extras

- **Opening heading jumps** (`phone-05` vs `phone-06-opening-card-2`).
  - On card 1 the heading sits about 40 px higher than on cards 2–6, because the "OPENING · N OF 6 · ‹ Back" row only gets its Back button from card 2.
  - Keep that row the same height on card 1 (an invisible placeholder), so the heading doesn’t move as the visitor taps Next.
- **Card 6 says the prompt twice** (`phone-06-opening-card-6`).
  - The label is "Client’s own list (“anything you want us to look at”)" and the hint is "Their answer to “anything you want us to look at”."
  - Drop the hint, or make the label "Client’s own list" and keep the hint.
- **Mixed inch marks in flag text** (`phone-19b`, `19c`, `29c`, `29e`): the flag text says `24"` and `20"` with straight quotes, while the field shows `20″`. Use ″ in the flag hints (`lib/consult/flags.ts`) and in `flagLead`.
- **Section-list conflict mark** (`tabletL-42` vs `owner-desktop-44-*`): the device list shows "! Conflict" alone, and the office list shows "◐ Partly ! Conflict". Either is fine, but pick one for both surfaces.
- **Office skip lines in mono** (`owner-desktop-44-complete`, `47`).
  - "Skipped · Other · QA fixture: excluded by agreement" is set in JetBrains Mono because it sits in the value cell.
  - `design-tokens.md` keeps mono for numbers, spec labels and timestamps. Set skip lines in the body face, and keep mono for measured values.
- **Client view, unnamed rooms** (`w320-24b`).
  - "Not measured today: the bathroom, the kitchen, two more rooms." A client with a bath and a kitchen may read that as four places.
  - When a room has no area but its work section names one, list it only once. The seed causes this here, but a visitor can skip the area.
