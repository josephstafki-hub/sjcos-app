# Build R8 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=8

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r8/*`. That is 124 shots plus `log.json` and `log-c.json`, from a production side build on a fresh database. There is no `log-b.json` in the folder, although the brief names one. The walk visit is on Tierney. The seeded Complete visit and the seeded two-device conflict visit are both on M Larson.

**Code:** checked at `44c52288`, with commits `a4dcce49`, `a75e8e71` and `44c52288`, against my round-7 list.

**Logs:** `overflow_px: 0` on every shot, and `held: 2`. `rrp_lines` has "Renovate Right: receipt not recorded · firm certification not on file · renovator certification not on file" for 1985 + Yes, and nothing for 1965 + No.

**Harness artifacts, not scored:**
- **"N other devices haven’t sent yet":** the script registers one device per width.
- **404s on `/api/portal/selection-image/*`:** the fresh database has no selection images.
- **"243 skipped" on the Complete visit:** that is how the seed fills it.
- **tabletL in `log.json`:** the keypad, 16ths, HVAC and date steps failed again. `log-c` recovered all of them except the date step (`tabletL-date-client`). The w320 run covers the date flow.
- **"No ‘this device’ on the conflict buttons":** this is correct. The seed typed both values on two other devices, not on the device that took the shot.

## Why the scores

**Design stays at 9.** All five round-7 fixes are in and hold up on screen. That includes the three states I called not calm or not honest, which are now calm and true:
- the Complete visit opened on a device;
- the slow close;
- the conflict values.

**What keeps design from 10:** one new layout break and two wording problems.
- The office conflict picker spills its text out of its buttons (R8-1).
- The conflict buttons name each side by a device code (R8-2). This is the coordinator's question.
- The flag on a kept toilet says Joe decides, then asks the visitor to decide (R8-3).

**Completeness stays at 8.** Most of the new states came in:
- Complete on a device;
- the slow close;
- both conflict pickers;
- 30 → inches or feet;
- the skipped date through to the client view;
- the toilet flag both ways;
- the offline close.

Three re-shoots I asked for in round 7 are still missing. Two of them are missing for the second time:
- **The close blocked by a conflict, with the ⚠ line on Before you wrap.** No shot shows it. The only sign of it is the office line "! 1 conflict to pick" (`owner-desktop-44b-conflict`).
- **The field close result on a visit closed Complete in the same session.** `*-40` opens a visit the seed already completed. No shot shows the moment a visitor's own close lands on ✓ Complete.
- **The Renovate Right line on screen.** `phone-17c` still shows the top of Before you wrap, and the line is below the fold. The text is right in the log.

---

## Coordinator's question: "Abigail Stafki · device a2b6c036"

**Not plain enough. See R8-2.** The words in front of the code work, but the code doesn't:
- **"device a2b6c036" means nothing to a visitor or to Joe.** It is the first 8 characters of a UUID. Nobody can tell which phone or tablet that is, and nobody will remember it.
- **In the case that matters, it is the only thing that tells the two buttons apart.** When one person used two devices, both buttons say "Abigail Stafki". The visitor ends up choosing between two hex codes.
- **What the visitor actually needs is which value is newer, and whose it is.** The time the value was typed answers that in words Joe would use: "Abigail · 3:52 pm" vs "Abigail · 3:58 pm".
- **Full names are longer than the job needs.** In the field, the first name is how Joe talks about his people. The full name is why the office buttons overflow (R8-1).

## Round-7 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R7-1 | Complete visit opened on a device shows a red Not ready and a PIN form | **FIXED** | `phone-40` and `tabletL-40`:<br>• the green serif "✓ Complete · Nov 3, 4:01 pm";<br>• "Price-critical 245/245 · Record 2/2 · 243 skipped";<br>• "Answers are locked. Joe can reopen it from the office look-over.";<br>• **Look over** and **‹ Back to visits**.<br>No PIN form, no paper line, no red. `phone-41` opens the office look-over with the "✓ Complete · Nov 3, 4:01 pm" pill. |
| R7-2 | A slow close lands in the red generic error | **FIXED** | `tabletP-27`: "Visit closed — checking with the office · All sent ✓ · Keep this screen open."<br>`tabletP-28` (held 45 s): "◐ Still closing…", with a blue status banner "The office hasn’t answered yet. Nothing is lost — your visit is saved on this device.", then **Try again** and **Keep working**. No red.<br>`tabletP-29` then lands on ◐ Needs finishing. |
| R7-3 | Conflict picker: one side has no value, and "this device" is untrue | **FIXED as asked, with a new wording problem** | `phone-42` and `tabletL-42`: "Pick 18″ · Abigail Stafki · device a2b6c036", "Pick 19″ · Abigail Stafki · device 01ad4b24", "Enter another". Both values show, and nothing claims "this device" or "office". **The naming is a device code: see R8-2.** The office picker is on screen now, but it overflows: see R8-1. |
| R7-4 | Inches-or-feet pushes the last fraction row behind Save | **FIXED** | `phone-14c` and `w320-14c`: the "30″ · inches / 30′ · feet" row takes the laser-mode row's place. Both fraction rows (⅛ ¼ ⅜ ½ / ⅝ ¾ ⅞) sit fully above Save. `tabletP-14c` and `tabletL-14c` are fine too. |
| R7-5 | Skipped-field words that assume a measurement | **FIXED** | **Date row** (`w320-22b`): "Skipped · Joe sets the date · Joe sets the date after the lumber quote comes back." with one "– N/A" mark and no "assumption written".<br>**Initials sheet** (`w320-22c`): "Client absent — The client wasn’t here to initial." and "Client declined — The client chose not to initial. Write what they said."<br>**Office** (`owner-desktop-44b-complete`): the Status block reads "Client initialed ✓", and skipped rows read "Skipped · Other · …" with N/A said once, by the mark. |
| Extra | "Before you wrap · N still open" | **DONE** | `phone-20c` and `w320-20` |
| Extra | Renovate Right "not on file" | **DONE** | In the log only (see completeness). |
| Extra | "Go to photo" on device and office | **DONE** | `*-29`, `owner-desktop-31` |
| Extra | Offline close says no signal once | **DONE** | `phone-26`: the strip, then the heading "will send when signal returns", then "Send now · needs signal". The banner is gone. |
| Extra | Keypad label tail on short screens | **DONE** | `w320-15b`: the readout's placeholder line says "at counter height (36″)". |
| Extra | Flag title inside the card | **DONE** | `phone-29c` |
| Extra | Drawn choice rings | **DONE** | `phone-16`, `phone-17*` and `phone-29c` draw the radio rings. Checkboxes still use a small "□" text glyph (`phone-17d`, Possible asbestos seen). See the optional extras. |
| Extra | Year-override hint | **DONE** | `phone-17a`: "Change it if that’s wrong." |
| Extra | Office "— N/A" said twice | **DONE** | `owner-desktop-44b-complete` |
| Seed | Instance names from hint text | **FIXED** | Seeded sections read "Room 1", "Fixture 1", "Kitchen wall 1" (`phone-41`, `owner-desktop-44*`). The seeded rooms have no area, which is why the client view says "another room". See the optional extras. |

## Captured this round, judged

| Shot | Verdict |
|---|---|
| `*-40/41` Complete on a device | Calm and correct (R7-1). |
| `tabletP-27/28/29` slow close | Calm and correct (R7-2). |
| `*-42` field conflict picker | Values are right. The naming fails (R8-2). |
| `owner-desktop-44/44b-conflict` office picker | Opens on Access & logistics as asked. **The layout is broken (R8-1).** |
| `*-14c` 30 → inches or feet | Fits at every width (R7-4). |
| `w320-21/22/22b/22c/24*` skipped date → client view | **Before the skip** (`w320-21`): the initials row says "→ Pick the estimate date first, so the client sees it."<br>**After the skip:** the client view reads "NEXT · Joe sends your formal estimate." with no date. The initials box, **This is what we went over** and **Hand back — hold 2 seconds** fit at 320. |
| `phone-19/19b/20c/29c/29d` toilet 20″, new toilet | **Good.**<br>• `19`: the keypad readout says "reads as 20″".<br>• `19b`: the field says "⚑ Flag · Less than 24″ in front of the toilet — a new toilet needs at least 24″ (Minnesota plumbing code). Decide in Before you wrap."<br>• `20c`: "Flags: 1 needs a decision".<br>• `29c`: the card leads with "Measured 20″".<br>• `29d`: **Go to field** rings the field. |
| `phone-19c/29e` toilet 20″, keep | The card is quiet, with an outline ⚐ and no red, which is right for advice. **The words contradict the card (R8-3).** |
| `phone-17*` Renovate Right | The logic is right in the log. The line is still not on screen. |
| `phone-26/26b` offline close | Calm, with one "No signal". Back online, it lands on ◐ Needs finishing. |
| `owner-*-31*` look-over after close | "◐ Needs finishing · 246 open · Abigail Stafki has a Finish consultation to-do.", with Go to field / Go to photo / Recover answers. Fine at desktop and phone. |
| `owner-desktop-44-complete*` | "✓ Complete · Nov 3, 4:01 pm", Reopen, "Client initialed ✓", "Closed on device ✓", **Apply findings**. Fine. |

---

## Required fixes

**R8-1. The office conflict picker's text spills out of its buttons (required).**
- **State:** `owner-desktop-44-conflict-lookover` and `owner-desktop-44b-conflict-lookover-full`, on Access & logistics › Narrowest door or turn on that path, with the Operator rail open:
  - The two Pick buttons sit side by side in a column about 330 px wide.
  - Their text runs on one line past the button edges and over each other: "Pick 18″ · Abigail Pick 19″ a… · device 01ad4b…".
  - The text runs out past the card's right border.
  - Neither button can be read, so Joe can't pick.
- **Cause:**
  - `OfficeConflict` (`components/consult/office/LookOverActions.tsx`) lays the buttons out with `grid sm:grid-cols-2`. That breakpoint follows the *viewport* (1280 px), not the narrow section column the card lives in.
  - The shared `Button` keeps its label on one line.
  - The heading is also built as `` `${section.label} ${f.def.label}` `` with no separator, so it reads "Access & logistics Narrowest door…".
- **Change:**
  - Stack the picks in one column here: `grid gap-2`, with no `sm:grid-cols-2`. If you want two columns, use a container query on the card (`@container` + `@[520px]:grid-cols-2`, the same pattern the row above it uses).
  - Let the labels wrap: `whitespace-normal text-left h-auto py-3` on these buttons, keeping at least 48 px height.
  - Build the heading as `` `${section.label} › ${f.def.label}` ``.
  - Shorter side names from R8-2 help as well, but they don't replace the layout fix.
  - Re-shoot `owner-desktop-44-conflict`, with and without the Operator rail, and also at owner-phone width.

**R8-2. Conflict sides are named by a device code (required).**
- **State:** `phone-42`, `tabletL-42` and `owner-desktop-44-conflict`: "Pick 18″ · Abigail Stafki · device a2b6c036" vs "Pick 19″ · Abigail Stafki · device 01ad4b24".
- **Why it's wrong:**
  - The code is not a word. No one can match "a2b6c036" to a phone or a tablet.
  - When one person used two devices, which is the common way a conflict happens, the code is the only difference between the buttons.
- **Cause:** both SQL queries build `u.name || ' · device ' || left(a.device_id::text,8)`:
  - `lib/consult/ui/server.ts:125`;
  - `lib/consult/protocol.ts:44`.
  - The `model.ts:147` fallback does the same.
- **Change:** name each side by who typed it and when, in plain words:
  - **On this device:** "this device · 3:58 pm". `FieldRow` already detects this case.
  - **Typed in the office:** "office · Joe". Keep it as it is now.
  - **On another device, different people:** "{first name}", for example "Pick 18″ · Abigail" and "Pick 19″ · Joe".
  - **On another device, same person:** "{first name} · {time typed}", for example "Pick 18″ · Abigail · 3:52 pm" and "Pick 19″ · Abigail · 3:58 pm". If the two times fall in the same minute, add "earlier" / "later".
  - **How to build it:**
    - Return `person` and the answer's `created_at` from the two queries, and drop the `· device …` text.
    - Build the label in one helper in `words.ts`, used by both `ConflictPicker` and `OfficeConflict`, so the field and the office say the same thing.
    - Use the first name the way the rest of the visit does ("Abigail Stafki has a Finish consultation to-do" can stay as it is; the buttons need to be short).
  - Re-shoot `*-42` and `owner-desktop-44-conflict`.

**R8-3. The kept-toilet flag says Joe decides, then asks the visitor to decide (required, small).**
- **State:**
  - **Field** (`phone-19c`): "⚐ Flag · Less than 24″ in front of the toilet. It’s staying where it is, so Joe decides whether it needs to change. Decide in Before you wrap."
  - **Card** (`phone-29e`): the same "…so Joe decides whether it needs to change.", and then the visitor gets Price it / Allowance / Sub must look before pricing / Not an issue — reason, with Save.
- **Why it's wrong:** the screen tells the visitor it's Joe's call, then asks the visitor to make it. They won't know whether to pick something or leave it.
- **Change:** the hint override is at `lib/consult/flags.ts:24`. Say what the visitor does:
  - **Hint:** "Less than 24″ in front of the toilet. It’s staying where it is, so the code doesn’t force a change. Pick Not an issue if it stays, or Price it if the client wants it moved."
  - **Card lead:** keep "Measured 20″ —" in front, as now.
  - If the plan really is that Joe decides in the office, then don't count this flag in "needs a decision" on the device. Show it as a note with **Go to field** only, and no choices.
  - Re-shoot `phone-19c` and `phone-29e`.

## Re-shoots still owed (completeness)

1. **The close blocked by a conflict.** Shoot the Before you wrap ⚠ line, and the close result that names the conflict and offers **Go to field**, on the seeded conflict visit at phone width.
2. **A Complete close on the field device.** Answer or skip everything on a visit, take initials, close, and shoot the "✓ Complete" close result (`*-43-complete-close`).
3. **The Renovate Right line on screen.** Scroll Before you wrap to the line (`phone-17c-wrap-rrp-1985-yes` scrolled) and shoot it there.
4. **After R8-1/R8-2:** re-shoot `*-42`, `owner-desktop-44-conflict` and `owner-phone-44-conflict`.

## Optional extras

- **A skipped field still offers "Skip this field…"** (`w320-22b`). Under "Skipped · Joe sets the date · …" the date box and "Skip this field…" still show. For a skipped field, label the button "Change reason…" and add **Undo skip**, so it's clear the skip took.
- **Checkboxes vs rings** (`phone-17d`, Possible asbestos seen): "□ None", "□ 9×9 floor tile" use a small text glyph next to the drawn radio rings. Draw a 20 px square box the same way the rings are drawn.
- **"another room" on the client view** (`w320-24b`): "Not measured today: another room, the bathroom, the kitchen." A room with no area reads oddly to the client, and it is listed first. Say "one more room", or list it last. The seed causes this here, but a visitor can add a room without an area too.
- **"checked at Before pricing"** (`owner-desktop-44b-complete`, assumption lines): the capital B mid-sentence reads like a code. Use "checked before pricing".
- **Office "Enter another"** (`owner-desktop-44b-conflict`): the button only opens a line saying the office can't enter a value. Replace the button with that line as plain text under the picks: "To use a different value, pick one, then the visitor types the new one on the visit device."
- **"✓ Covered ! Conflict" on the same field** (`phone-42`, field head): a field in conflict isn't settled. While a conflict is open, show only "! Conflict", the way the section list shows "◐ Partly ! Conflict".

## Required to reach 10

1. **R8-1:** the office picker's buttons wrap inside the card, in one column, and the heading has a "›" between section and field.
2. **R8-2:** conflict sides are named by person and time, never by a device code, the same on the field and in the office.
3. **R8-3:** the kept-toilet words match what the visitor is asked to do.
4. **Re-shoots:**
   - the close blocked by a conflict, with the ⚠ wrap line;
   - a field close that lands on ✓ Complete;
   - the Renovate Right line on screen;
   - the fixed pickers.
