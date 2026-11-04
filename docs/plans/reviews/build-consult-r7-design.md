# Build R7 — Design & field UX judge (in-home consult)

SCORES: design=9 completeness=8

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r7/*`. That is 131 shots plus `log.json` and `log-b.json`, from a production side build on a fresh database. The walk visit is on Tierney. There is also a seeded Complete visit and a seeded two-device conflict visit, both on M Larson.

**Code:** checked at `23d720f8`, with fix commits `94e670cc`, `80a679eb` and `23d720f8`, against my round-6 list.

**Logs:** `overflow_px: 0` everywhere. `held: 2`.

**Harness artifacts, not scored:**
- **"N other devices haven’t sent yet":** the script registers one device per width.
- **404s on `/api/portal/selection-image/*`:** the fresh database has no selection images.
- **Section and room names on the seeded Larson visits:**
  - The kitchen walls are named "one per wall with cabinets, clockwise from the entry: A, B, C, D 1" (`phone-41-conflict-open`, `owner-desktop-44b-complete-*`).
  - The rooms are "Room 1" with no area.
  - The client view lists "another room".
  - Cause: `scripts/qa-seed-consult.mjs:42` names each required instance from `slot.label`, which is the slot's hint text, not its name. The app's own walk visit gets "Kitchen wall 1" and "Room 1 — Bath" (`tabletL-15b`).
  - Fix the seed to use `slot.module.title`, so the next round's seeded shots read right.
- **tabletL failures:** the keypad, 16ths, HVAC and date steps failed in `log.json`. `log-b` recovered the 16ths step only.

## Why the scores

**Design is up to 9.** Every round-6 required fix is in and holds up on screen:
- **Flags:** a blank visit has no flags. One real measurement gives exactly one flag, and its card leads with the number.
- **Narrow screens:** the wrap stacks at 320 and 390 px.
- **Keypad:** both fraction rows fit at 320 × 700.
- **Words:** skip reasons fit the field, and close checks say what is left.
- **Small items:** the spelling, the opening card and the Built before 1978? hint are fixed.

**What keeps design from 10:** three states that are new on screen this round are not calm or not honest:
- A Complete visit opened on a new device shows a red **Not ready** with a PIN form.
- A slow close shows a red **Something went wrong**, not the calm "Still closing" that was built for it.
- The conflict picker offers "Pick · this device" with no value, and the value didn't come from this device anyway.

There is also one keypad clip.

**Completeness stays at 8.** Most of the re-shoots came in: the timeout, the right PIN, 30 → inches or feet, the skipped date through to the client view, the Renovate Right lines (in the log), the Complete look-over and the conflict picker. Four are still missing:
- **Complete field result (`*-42/43-complete`):** it never got past Get ready, because of R7-1. I asked for this one by name last round.
- **Conflict blocking the close:** not captured. Neither is the ⚠ line on Before you wrap.
- **Office conflict picker:** `owner-desktop-44-conflict-*` opens on House & household, not on Access & logistics, where the conflict is.
- **Renovate Right read-out:** it is below the fold in `phone-17c`. The log has the text, but no shot shows it.

---

## Coordinator's three observations

| # | Observation | Verdict |
|---|---|---|
| 1 | The flag card shows straight " for inches (`phone-29c`) | **Not a defect.** The text really is ″ (U+2033):<br>• `flagLead` builds it with `inchesText`.<br>• The hint in `flag-hints.ts:47` says "24″".<br>• `formatLength` writes ′ ″.<br>Mulish has the glyph (`fc-query` on the Latin subset in `.next-qa-consult` lists `2032-2033`), but it draws the double prime as two upright ticks, so it looks like a straight quote. The same glyph shows in "reads as 1′ 8″" (`phone-19`) and on the conflict buttons. Newsreader and JetBrains Mono draw it slanted (`tabletL-15b` title, the keypad readout). It reads as inches either way. No change required. |
| 2 | The conflict picker's "Pick · this device" has no value (`phone-42-conflict-picker`, `tabletL-42`) | **Real defect. See R7-3.** |
| 3 | The Complete visit on a new device shows a red "Not ready … Problem: This visit is Complete, so answers are locked" (`*-40/41/42/43-complete`) | **Real defect. See R7-1.** |

## Round-6 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R6-1 | False code flags on fields nobody measured | **FIXED** | **Blank visit:** `phone-20`, `w320-20` and `tabletP-20` have no Flags card. The close results (`*-29b`) have no flag row.<br>**One measurement:** after Toilet front clearance 20″ (`phone-19`/`19b`), the wrap says "Flags: 1 needs a decision" (`phone-20c`). |
| R6-2 | Client initials card collapses on narrow screens | **FIXED** | `w320-20` and `phone-20`: the mark and words are on line 1, the note is on line 2, and the buttons are full width. |
| R6-3 | 1/16″ keypad at 320 × 700 | **FIXED** | `w320-15b`/`15c`: the title is on one line ("Length corner to…"), Show 16ths / Show 8ths is in the footer, and both fraction rows clear Save. **New clip in the inches-or-feet state: see R7-4.** |
| R6-4 | Flag cards don't show the number | **FIXED** | `phone-29c`: "Measured 20″ — less than 24″ in front of the toilet — the plumbing code needs at least that." There is a quiet **Go to field**, and `phone-29d` rings the field. |
| R6-5 | Skip reasons that don't fit the field | **FIXED, one leftover** | **Date** (`w320-22`): Joe sets the date, Other.<br>**Initials** (`w320-22c`): Client absent, Client declined, Other.<br>**Leftover** (R7-5): the notes under the reasons still talk about measuring. |
| R6-6 | Close checks speak in rules | **FIXED** | `phone-29b`: "Answers: 217 open", "Photos: 29 open", "Client initials — not yet", "Trade walks: … — need a decision".<br>`owner-desktop-31` uses the same words. |
| R6-7 | initialed / center | **FIXED** | None left on screen. `approved-content.ts:340` still says "centre-to-centre", but that is plan text, never shown. |
| R6-8 | Opening card 4 says its script twice | **FIXED** | `phone-06-opening-card-4`: the quote shows once and there is no Say line. |
| R6-9 | "Filled from Year built" over an empty answer | **FIXED** | **No year yet** (`phone-17`): "Fills in once Year built is confirmed in House & household."<br>**1985** (`17a`): "● No · From Year built (1985)", and it stays on screen.<br>**Changed** (`17b`): changed to Yes and still visible.<br>**1965 + No** (`17d`): asks "How do we know it was built in 1978 or later?" |
| Extras | Tap to measure, offline heading, Send now · needs signal, "{visitor} has a Finish consultation to-do", ◐ in the pill, compact leave sheet | **DONE** | `*-14c`, `phone-26`, `owner-desktop-31`, `*-12` |
| Extra | Choice rings still use the status glyph ○ | **NOT DONE** | `phone-17d`, `phone-29c`. Still optional. |

## Re-shoots from round 6

| Shot | Verdict |
|---|---|
| `tabletP-28` timeout | **Captured, but it shows the wrong state.** See R7-2. |
| `phone-25c` right PIN after a wrong one | **Captured.** The visit screen is back (Closing, ◐ Partly), and the log shows the visit buttons. |
| `*-14c` 30 → inches or feet | **Captured.** "30″ · inches" and "30′ · feet" are 56 px buttons at every width. See R7-4 for the clip. |
| `17c`/`17e` Renovate Right | **Logic captured.** With 1985 + Yes, the log has "Renovate Right: receipt not recorded · firm certification not current · renovator certification not current". With 1965 + No there is no line. **The line is below the fold on the shot,** so shoot the wrap scrolled to it. |
| `w320-21/22/22b/24*` skipped date | **Captured.** The client view reads "Joe sends your formal estimate." with no date, and the initials card and Hand back are at the bottom. See R7-5 for the words on the skipped row. |
| Complete close | **The office side is captured** (`owner-desktop-44*-complete`). **The field side is not,** because R7-1 blocks it. |
| Two-device conflict | **Captured:** the field card (`*-42-conflict-picker`) and the list mark "◐ Partly ! Conflict" (`phone-41-conflict-open`).<br>**Not captured:** the close blocking on it, and the office picker. |

---

## Required fixes

**R7-1. Opening a Complete visit on a device shows a red "Not ready" and asks for a PIN (required).**
- **State:** `phone-40/41/42/43-complete` and `tabletL-40…43-complete`, all the same screen:
  - A red serif **Not ready**.
  - Four ✓ Done rows, then "! Problem · **Works without signal** — This visit is Complete, so answers are locked. Reopen it to change anything."
  - Then "Or use paper and enter the answers here after the visit."
  - Then **Choose a PIN for this device**, **Type the PIN again** and **Get ready**.
- **Why it's wrong:** nothing is wrong. The visit is finished, which is the best state there is. The screen treats it as a failure, offers paper capture for a visit that is over, and asks the visitor to set a PIN that can't open anything.
- **Cause:** the offline lease refuses a Complete visit (`lib/consult/protocol.ts:373` returns `complete_locked`). Get ready shows any refused check as a Problem and still renders the PIN form.
- **Change:**
  - When `snapshot.consult.status === 'complete'`, skip Get ready entirely. Show a calm, read-only screen instead:
    - "✓ Complete · Nov 3, 3:16 pm"
    - "Price-critical 250/250 · Record 2/2 · {n} skipped"
    - "Answers are locked. Joe can reopen it from the office look-over."
  - Add **‹ Visits**, and **Look over** for Joe or the visitor (a link to `/projects/{slug}/consult/{id}`).
  - Show no PIN form, no paper line and no red.
  - Use the green ✓ Complete heading the close result already uses (`WrapClose.tsx`, `closing.step === "done" && r.complete`).
  - Re-shoot `*-40…43-complete`. Also capture the field close result on a visit closed Complete in the same session.

**R7-2. A slow close lands in the red generic error, not the calm "Still closing" (required).**
- **State:** `tabletP-28-close-timeout` (close held 45 s):
  - The heading is "Visit closed — sending".
  - Under it is a red alarm banner: "⚠ Something went wrong. Your answers are still saved on this device. Try again."
  - The heading says it is sending while the banner says it failed.
- **Cause:**
  - `deadlineFetch` aborts every request at **15 s** and throws `http_408` (`lib/consult/transport.ts:13`).
  - `resumeClose`'s catch sets `closing:{step:'error',code:'http_408'}` (`controller.ts`, the catch at the end of `resumeClose`).
  - `plainWords('http_408')` falls to `default` ("Something went wrong…"), and WrapClose renders the `Banner kind="action"` branch.
  - The calm state exists (`close_timeout` → "◐ Still closing…" with a status banner, `WrapClose.tsx:228–233`), but its timer is **20 s** (`controller.ts`, `close()`). By then the step is already `error`, so the timer never fires.
  - The controller also auto-retries `http_408` (`transientClose`), so the red "Try again" shows while a retry is already scheduled.
- **Change:**
  - In `resumeClose`'s catch, map any `transientClose(code)` other than `no_signal` (that is `http_408`, `http_429` and `http_5xx`) to `{step:'error', code:'close_timeout'}`, so it renders "◐ Still closing… The office hasn’t answered yet. Nothing is lost — your visit is saved on this device."
  - Add `case 'http_408'` to `plainWords` with the same words, for any other surface.
  - Make the close timer shorter than the request deadline, or drop it, so only one path decides.
  - Re-shoot `tabletP-28`, and `28b` after Try again.

**R7-3. The conflict picker's second button has no value, and "this device" is untrue (required).**
- **State:** `phone-42-conflict-picker` and `tabletL-42`, on "Narrowest door or turn on that path":
  - **Pick 1′ 6″ · office**
  - **Pick · this device** (empty)
  - **Enter another**
- **Why it's wrong:**
  - The visitor can't choose between a value and a blank.
  - Neither value was typed on this device, so "this device" is wrong too. Both came from field devices: the seed answered 18″ on device 1 and 19″ on device 2.
  - "office" is wrong as well: the current value was also typed on a visit device, not in the office.
- **Cause:** `openConflicts` (`lib/consult/ui/model.ts:144–147`) builds every *server* conflict with `proposed: { value: undefined }`. `ConflictPicker` (`FieldRow.tsx:153–154`) then hard-codes "· office" and "· this device".
- **Change:**
  - Carry the proposed answer's value, status, device and person in the snapshot conflict row, the same shape as `current`. Fill `proposed.value` from it.
  - Name each side by where it came from:
    - **this device:** only when `device === state.device`.
    - **another device:** "{person}’s other device", or "another device".
    - **office:** only for an office look-over pick.
  - The result should read, for example, "Pick 1′ 6″ · Abigail’s phone", "Pick 1′ 7″ · this tablet", "Enter another".
  - If a value truly can't be loaded, hide that Pick button rather than show it blank.
  - Use the same naming in the office `OfficeConflict` picker.
  - Re-shoot `*-42-conflict-picker`, and the office look-over with `?s=<Access & logistics instance>`, so the office picker is on screen.

**R7-4. The inches-or-feet question pushes the last fraction row behind Save on phones (required).**
- **State:**
  - `phone-14c` (390 × 844) and `w320-14c` (320 × 700): after typing 30, the 56 px "30″ · inches / 30′ · feet" row appears above the mode chips. The 5/8 ¾ ⅞ row is cut off behind the footer.
  - `tabletP-14c` fits, because 7 fractions sit on one row there.
  - Typing "30 5/8" is common, and that is exactly when 5/8 is hidden.
- **Change:**
  - While the question is showing (`amb !== null && !unitPick`), hide the laser-mode row (ft-in / decimal ft / m). The question is already about units, and that frees exactly the 56 px it costs.
  - Or put the two choice buttons in the mode row's place.
  - Check `phone-14c` and `w320-14c` with every fraction row fully above Save.

**R7-5. Skipped-field words that still assume a measurement (required, small).**
- **Date row** (`w320-22b`): "– N/A … N/A · Joe sets the date — **assumption written** · Joe sets the date after the lumber quote comes back."
  - No assumption is written for a date, and "N/A" shows twice.
  - Change it to "Skipped · Joe sets the date · after the lumber quote comes back."
  - Drop " — assumption written" for date and signature fields (`FieldRow.tsx:275`).
- **Initials skip sheet** (`w320-22c`): "Client declined — Needs a written assumption or exclusion if it prices the job." That doesn't mean anything for initials.
  - Give signature fields their own notes: "Client declined — say why in the note", and "Client absent — Joe gets their initials later".
  - The notes live in the `words.ts:370–372` map. Key them by field type the way the reasons now are.
- **Office look-over** (`owner-desktop-44b-complete`): the Status block says "Client **ack** ✓ initials" (`page.tsx:168`). Joe wouldn't say "ack". Change it to "Client initialed ✓" / "Client initials · {reason}" / "Client initials · not yet".

## Optional extras

- **Office answer rows on the Complete look-over** (`owner-desktop-44b-complete`): every skipped field shows "N/A · Other — assumption written", then "— N/A" in the right column, then the assumption line. That is N/A twice per row. Drop the right-hand "— N/A" when the row already starts with N/A.
- **"Go to section" vs "Go to field"** (`owner-desktop-31`): Photos uses "Go to section" in the office, but "Go to photo" on the device. Pick one.
- **Wrap heading:** "Before you wrap · 246 Open" has a capital O mid-sentence. Use "246 still open", the phrasing the close checks use.
- **Offline close** (`phone-26`): no signal is said three times (strip, heading, banner). The heading and the button are enough, so drop the banner.
- **"not current"** in the Renovate Right line: on a fresh database it means "not on file". "firm certification not on file" is calmer and truer until an expiry is entered.
- **Choice rings:** "○ Yes" and "○ Price it" still use the status glyph ○ (carried from r5/r6).
- **Keypad title at ≤700 px:** "Length corner to…" hides the words that tell walls apart ("at counter height (36″)"). Consider showing the tail in the readout's placeholder line ("Type the measurement · at counter height") instead of losing it.
- **Flag card frame** (`phone-29c`): the two-line ⚑ title sits on the card's top border like a legend, and the border breaks around it. Put the title inside the card.

## Required to reach 10

1. **R7-1:** a Complete visit opens to a calm read-only ✓ Complete screen, with no PIN and no red. Re-shoot `*-40…43-complete`.
2. **R7-2:** a slow close (408/429/5xx) shows "◐ Still closing…", not the red generic error. Re-shoot `tabletP-28`/`28b`.
3. **R7-3:** both conflict values show, each named by where it came from. Re-shoot the field picker and the office picker.
4. **R7-4:** every fraction row fits while inches-or-feet is asked, at 390 and 320.
5. **R7-5:** skipped-date and initials words, and "Client initialed".
6. **Re-shoots:**
   - the Complete close result on the field device;
   - the close blocked by a conflict, with the ⚠ line on Before you wrap;
   - the office conflict picker;
   - the Renovate Right line on screen.
7. **Seed:** name required instances from `slot.module.title` (`qa-seed-consult.mjs:42`), so seeded visits don't show hint text as section names.
