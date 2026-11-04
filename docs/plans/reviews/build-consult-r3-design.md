# Build R3 — Design & field UX judge (in-home consult)

SCORES: design=8 completeness=7

Judged from `/tmp/sjcqa/shots/consult-r3b/*` (`log.json`, `log-wrap.json`) and
`consult-r2c/` for the schedule dialog, against plan §3, §5, §5.7, §6, §8 and §10, and
the code at `82dbf71b` (with `b3b54399` and `f8ec621d`).

The QA build is the right one:
- `.next-qa-consult/BUILD_ID` was written at 13:34.
- The offline shell `precache.json` is build `b133aacc…`, the same build named in the shot URLs.
- `capture.js` contains the fixed strings, for example `Nothing went out — your answers are safe on this device.` and the prime replacement.

Other facts:
- `overflow_px: 0` in every entry.
- There are no 404s.
- The `*-opening` / `*-sections` "fails" are the harness reaching the section list straight from a persisted visit, not product bugs.

**Why design is 8:** round 2's two big problems are fixed.
- **Hints:** fields now read like a person talking. Examples: "If no, leave the camera off and write down what you saw instead.", "DLI is the state electrical inspector.", "Not a rectangle? Measure each leg and photograph a hand sketch.", "Goes to Joe only. The client never sees it."
- **Client summary:** it no longer claims work that wasn't done.

Other round-2 fixes that landed:
- The sticky Next on tablet landscape.
- The lower-half keypad on tablet portrait.
- The grouped Before you wrap.
- The second-device screen.

What keeps it from 9–10 is a short list:
- The 320 px keypad's fraction row is broken.
- The close result reads like an error page, and its count disagrees with Before you wrap.
- The leave banner dumps every open field into one run-on sentence.
- The Sending sheet says **Last sent · Not yet** while ⇅ 0 and the server holds the answers.

**Why completeness is 7:** this is the first round with the inside of the visit at all four widths: section, answered, Sending sheet, Skip, room, keypad, Before you wrap, close result, Closing, client view and hand-back PIN. Still missing:
- the leave banner at three widths
- opening step 2 and later (which is where the N3 fix is visible)
- the 3″ / 3′ choice
- photos
- Sun mode on
- the offline, signed-out and conflict states
- a wrong hand-back PIN and the hold progress
- a fully complete close
- the schedule dialog on this build (`FAIL-o-schedule`)

---

## Round-2 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| N1 | Planning notes printed as field help | **FIXED** | `*-08/09`, `*-13`, `tabletP-14`, `phone-23`: every visible hint is a plain visitor sentence. No `→`, `R?`, `§`, `Phase` or scope keys. `tests/consult-hints.test.mjs` guards it. Left over: the **flag** line still carries code citations; see new issue C5. |
| N2 | Client summary claims work not done | **FIXED** | `tabletL-24`, `tabletP-24`, `w320-24`: there is no "Measured and looked over". It reads "We'll come back to: Room 1, Room 2, Bath 1, Kitchen." Still to decide is grouped under **Bath** / **Kitchen** with 5 items, then "+ 10 more for the estimate". Kitchen walls aren't listed as rooms. Copy details are in C6. |
| N3 | ‹ Sections unreachable after opening line 1 | **FIXED (code), shot owed** | Every section bar shows **‹ Sections** + **Next ›** (`phone-08/12/13/23`, `w320-12`, `tabletP-12`). Opening step 2+ wasn't captured, because the visit resumed into the list. |
| N4 | tabletL primary not in thumb zone | **FIXED** | `tabletL-09`: the right pane scrolls under a sticky bar with a top rule, and **Next ›** sits bottom-right. |
| N5 | Hand-back PIN capped at 8 | **FIXED (code)** | `*-25` shows **Visitor PIN** + **Hand back** under the hold button. The wrong-PIN line wasn't captured. |
| N6 | Stuck send invisible | **PARTLY** | `*-09b/09c`: the sheet reads "Nothing waiting to send." and **Send now** is disabled at ⇅ 0, which is correct. The stuck state can't be reproduced now the blocker is fixed, so the ⚠ / Last try path is unproven on screen. **Last sent · Not yet** is shown at every width while ⇅ 0 and the server holds 34 answers; see C4. |
| N7 | tabletP keypad covers the field | **FIXED** | `tabletP-14`: a lower-half sheet, with "Length (wall to wall, longest) * ○ Open [tap to enter]" visible above it. The fraction row is clipped by about 4 px at the sheet footer; see C12. |
| N8 | Keypad details | **PARTLY** | Primes: the bundle runs the `′`/`″` replacement (`ct()` in `capture.js`) and Mulish draws the primes almost upright, so this is fine. 48 px keys on short screens: in effect at w320 (`w320-14`). **But** at w320 the fraction labels overflow their keys and run together as "1/81/43/81/25/83/47/8" (C1). The 3″ / 3′ buttons were not captured. |
| N9 | Second device: wrong action, dashes | **FIXED** | `phone-18`: **Not ready**, then "! Problem · Works without signal" with "This visit is set up on another device. Use that one, or ask Joe to move it here." as its own sentence. **‹ Back to visits** is primary and **Try again** is quiet. |
| N10 | Look-over details | **FIXED** | `owner-desktop-move-dialog`: the **STATUS** eyebrow, and Who goes [Abigail Stafki] with "Abigail Stafki (goes now)" below. Panel open (`owner-desktop-panel-open-lookover`) is two clean columns with real answers: "Yes typed · Abigail Stafki ✓ Covered". `owner-phone-lookover` stacks. A small wording problem is in C11. |
| N11 | Before you wrap flat 241 rows | **FIXED** | `*-20`: "House & household · 15 open [Go to section]", one row per section, with no repeated prefix. The footer has **Keep working** / **Close visit — needs finishing**. Layout details are in C7. |
| N12 | Minor | **FIXED** | Skip (`phone-11`): "Get on return visit — Stays Open; one return-visit to-do is made.", with no repeated chip. The N/A dash and the template-tick hover are fixed in code. The schedule dialog wasn't re-shot. |
| r2 #14 | Empty band on visit list | **FIXED** | `phone-03`: one rule under **Open visit**, then **‹ Back to SJC OS**. |

## New issues

**C1. The 320 px keypad fraction keys are unreadable (required).**
- Where: `w320-14`. The seven fraction keys are about 36 px wide and their mono labels spill into each other: "1/81/43/81/25/83/47/8".
- This is a primary input in the field, and the visitor can't tell which key is ¼ and which is ¾.
- Fix: under 360 px, draw the fraction keys with the single glyphs (⅛ ¼ ⅜ ½ ⅝ ¾ ⅞), which `prettyLength` already uses, or split them into two rows of 4 + 3. Keep each key at least 44 px wide.

**C2. The close result reads as an error, and its count disagrees with Before you wrap (required).**
- Where: `*-22`.
- Every unmet check carries a red "! Problem" under a red display heading. §5.5 and §6.3 treat "Needs finishing" as a normal outcome. Per §6.1, ! Problem is for conflicts and failures, not for "not done yet".
- The line repeats the heading word for word: "**Needs finishing** / Needs finishing — 264 open…".
- "264 open" sums things of different kinds: 212 answers + 29 photos + 10 devices + 8 flags + 5 one-off checks. Before you wrap, seconds earlier, said "241 Open". The visitor sees two different totals for the same visit.
- "Everything on this device reached the office… · 10 open" counts *other* devices. That is partly the QA database's set-aside devices, but "10 open" can't be read as "10 devices".
- Fix:
  - Use ○ Open for unmet checks, and keep ! Problem for conflicts and rejected sends only.
  - Use an ink heading, not flag red, or drop the repeated sentence.
  - Make the headline count the same number Before you wrap showed. Put the per-check counts in the check rows.
  - Write the device line in words, for example "10 other devices haven't sent yet — Joe can recover them".

**C3. The leave banner is a wall of text (required).**
- Where: `tabletP-12`. "House & household still needs · Open: Permit authority — electrical, Smoke and CO alarms now — hardwired/battery, …, Front of house photo" is 15 names in one comma run. Labels that end in "?" produce "?,".
- §6.3 specifies "Kitchen still needs · Open: ceiling · Partly: water history".
- Fix: show at most 3 names per group, then "and 12 more". Keep Open and Partly as separate groups. Put each name in its own `<li>` or join them with " · ", never ", ".

**C4. The Sending sheet says "Last sent · Not yet" when everything is sent (required, verify).**
- Where: `phone/tabletL/tabletP/w320-09b` and `-09c`. ⇅ 0, Online, "Nothing waiting to send.", **Last sent · Not yet**. The coordinator confirmed 34 answers on the server.
- `last_send` is only stamped from this device's 2xx receipts (`offline-engine.ts:41`), and `get-ready.ts:26` starts it at `null`.
- So one of two things is true:
  - The answers went out from this device and the stamp was lost. That is a bug.
  - This device never sent anything. Then "Not yet" is technically true, but next to ⇅ 0 it reads as "your work hasn't gone anywhere".
- Fix:
  - Persist `last_send` on every acknowledged drain.
  - When the queue is empty and nothing was ever sent from this device, show "All sent ✓" instead of "Not yet".
- Re-shoot as follows: answer one field at that width, wait for ⇅ 0, then open the sheet. Expected: "Last sent 1:42 pm".

**C5. The flag line shows code citations to the visitor.**
- Where: `phone-09/12`, `w320-12`.
- The line reads "⚑ Flag · permitted work: review R314/R315; CO within 10 ft of sleeping rooms (299F.51) — decide in Before you wrap".
- That is fine for Joe on the look-over (`owner-desktop-move-dialog` FLAGS), but the visitor needs a sentence: "Alarms may need updating for permitted work — decide in Before you wrap".
- Fix: give flags a visitor `hint` and an office `note`, the same split as N1. Extend the hints test to flags, and catch `R\d{3}` and `\d{3}[A-Z]\.\d+`.
- (Domain judge: the flag fired on the answer "Two dogs", so check its condition.)

**C6. Client view copy.**
- `*-24`: "NEXT / formal estimate" is lower-case, with no date or verb. §6 has "Next · formal estimate Nov 16". With no date set, write "Joe will send the formal estimate", capitalised.
- "We'll come back to: … Bath 1" while Still to decide says "Bath". Use the same name in both.
- The generic "Room 1 / Room 2" reach the client when the room name is blank. Either list them as "two more rooms" or use the Level answer ("Main floor room").

**C7. Before you wrap layout.**
- `phone-20`, `w320-20`: on rows with longer names (House & household, Access & logistics), **Go to section** drops under the name, while shorter rows keep it on the right. The button jumps from row to row. Fix it to one position: the name and count on the left and the button on the right on every row, or the whole row as the tap target with a trailing ›.
- The non-section blockers (flags, trade walks, promised date, client ack; `WrapClose.tsx:73…`) render after 20+ section rows, below the fold at every width. Put them at the top of the sheet. They are what stop a Complete close.

**C8. Tablet-landscape resume shows an empty right pane.**
- `tabletL-05`: "Pick a section on the left to start." Instead, open the first Open section, or show "Next open: House & household [Open]" as a primary button.

**C9. Phone section-list row order.**
- `phone-05`: the row reads "4/19 › ◐ Partly", with the chevron between the count and the mark.
- §6.1 puts the mark in a right-aligned column. Use "4/19 · ◐ Partly ›", with the chevron last.

**C10. Tablet portrait: the first House field is half width.**
- `tabletP-12`: "Say:" + "Photos okay?" sit in the left column with the right column empty, while the fields below span both columns.
- Fix: script-bearing fields span both columns (`col-span-2`).

**C11. Look-over wording.**
- "Sent from device · not yet" shows while answers typed on that device are listed right beside it. It is tied to `closedAt`, so it should read "Closed on device · not yet".
- "Kitchen wall 1 — Kitchen" repeats itself. Use "Kitchen wall 1".

**C12. Tablet-portrait keypad.**
- The fraction row is clipped by the sheet footer by about 4 px (`tabletP-14`). Give the sheet its natural height up to 55 vh, or pad the scroll area by the footer height.

**C13. Typography.**
- The label `Wall used as "Ahead"` uses straight quotes. Use “Ahead”, the same rule as the primes.

## Required to reach 10

1. **C1**: the 320 px fraction keys are readable: single glyphs or 4 + 3 rows, at least 44 px each.
2. **C2**: the close result uses ○ Open for unmet checks, ! Problem only for conflicts and rejected sends, and no red heading. Its count matches Before you wrap, and the device line is in words.
3. **C3**: the leave banner shows at most 3 names per Open/Partly group, then "and n more".
4. **C4**: the Sending sheet shows the real Last sent time, or "All sent ✓", whenever ⇅ 0.
5. **C5**: flags have a plain visitor sentence, codes go to an office note, and the test covers flags.
6. **C7**: Before you wrap has a stable button position and the blockers at the top.
7. **C6, C8–C13**: small copy and layout fixes, as listed.

## States still to capture

All four widths unless noted.

| Shot | How to reach it |
|---|---|
| `12-leave-banner` (phone, w320, tabletL) | Only tabletP has it. Phone/w320: in House, scroll to top, then **‹ Sections**. The shot must show the banner, not the field. TabletL: tap another section in the left pane. |
| `06-opening-2` (phone, tabletP, w320) | Proves N3: reset the visit to un-started, Next once. Shows **‹ Sections** + **‹ Back** + **Next ›** (Back above the card under 420 px). |
| `14b-keypad-ambiguous` | Ceiling height → type `3`. Shows the 56 px **3″ · inches / 3′ · feet** buttons. Then `8 1 1/4` → "reads as 8′ 1¼″" → Save → ✓ Covered. |
| `09d-send-fresh` | Answer one field at that width, then wait for ⇅ 0 and open the sheet. Shows "Last sent h:mm" (C4). |
| `13-send-stuck` | Block `/api/consult/*/ops` (return 200 with no receipts, or 503) and wait 2 min. Shows ⚠ Not sent, Last try "Nothing went out…", **Try again** and the banner. |
| `07c-add-instance` | Tap **+ Window** (tabletL left pane). Shows the new "Window 1" row. |
| `07d-photo` | **Take photo** with a stubbed file. Shows Saved on device → Uploaded ✓ + thumbnail + **Retake**. |
| `09e-sun-on` | ⋯ → Sun mode **On**, then a section and the list. |
| `17b-handback-wrong-pin` / `17c-hold` | Wrong PIN (shows the error line and clears the field), right PIN (back to the visitor preview), the declined-initials reason; hold **Hand back** 1 s (progress) and release (reset). |
| `22b-close-complete` | A fixture with everything answered. Shows "Complete" with Price-critical/Record/skip counts. Also take `22c` offline ("closed — sending when signal returns"). |
| `flags-sheet` | Before you wrap → **Review flags**. Shows the flag decision sheet. |
| `02y-no-signal`, `13-signed-out`, `08-offline-strip`, `conflict` | Unchanged from round 2. None captured yet. |
| `owner-desktop-01/02-schedule` | `FAIL-o-schedule` this round; re-shoot on this build (General tint fix). |
| `owner-desktop-07-settings` | Settings → **Company** (the shot still shows Profile). |
| `owner-desktop-lookover-closed` | After the wrap run's needs-finishing close: the look-over with the Needs-finishing banner and the "Closed on device ✓" status. |
| `owner-strip-as-visitor`, `staff-today` | As Abigail: **Get ready** on the project strip, and her Today with the consultation to-do. |
