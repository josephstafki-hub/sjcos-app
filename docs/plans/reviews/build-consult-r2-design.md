# Build R2 — Design & field UX judge (in-home consult)

SCORES: design=7 completeness=6

Judged from `/tmp/sjcqa/shots/consult-r2e/*` (field walk at phone 390, tabletL 1180,
tabletP 820 and w320, plus the owner shots) and `consult-r2c/` (the schedule dialog and
Overview), against plan §3, §5, §5.7, §6 and the code at `a9dfaa71`. No page scrolls
sideways at any width (`overflow_px: 0` in every log entry).

**Why design is 7, not higher:** round 1's layout and wording fixes landed well. The
look-over page, the visit strip, Sun mode, the PIN and the opening are clearly better.
Two problems the visitor or client would hit on every visit remain:

- **Planning notes are printed as help text under the fields.** They are full of
  shorthand from the plan.
- **The client summary says "Measured and looked over" for rooms nobody measured.**

On top of those, the phone opening traps the visitor, and the send queue sits stuck
with nothing on screen to say so.

**Why completeness is 6:** the inside of the visit was captured this time, but only
at tablet landscape: a section, Skip, the keypad, Before you wrap, the client view and
the hand-back PIN. At phone, tabletP and w320 the walk stalled inside the opening
(see new issue N3; that is a product bug, not a harness bug). So there are no shots at
those widths of:

- the section list or House & household
- Skip, the leave-section banner, Before you wrap, or the client view

At no width are there shots of:

- the leave banner or "No access" opened
- closing and its result, Sun mode on, or photos
- the offline, signed-out and conflict states
- a look-over page with data

The send blocker stops that last one.

---

## Round-1 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | 4-digit PIN dead end | **FIXED** | `phone-01-pin-too-short`, `w320-01`: help reads "…6 to 12 digits.", an inline `! Use 6 to 12 digits.` sits under the field, and every check stays `○ Not yet`, so nothing ran. All three inputs in `GetReady.tsx` slice to 12. The one regression is in the hand-back PIN; see N5. |
| 2 | Unknown codes read "sign in again" / other device | **FIXED** | `phone-18-second-device`: "! Problem · Works without signal — this visit is set up on another device — use that one, or ask Joe to move it here". The blocked screen maps `device_access_denied` to its own words (`ConsultApp.tsx:105`). The leftover problems with the button and the dashes are in N9. |
| 3 | Look-over page broken with the Operator panel open | **FIXED** | `owner-desktop-panel-open-lookover`: two columns, with the section and FEEDS side by side and nothing one word per line. `panel-closed`: SECTIONS / main column. `owner-phone-lookover` stacks. |
| 4 | FEEDS shows internal keys and zeros | **FIXED** | Rows read "Kitchen cabinetry (supply + install) · Cabinet run  ○ Open". There are no `scope_key`s and no 0s. |
| 5 | Header doesn't follow §6.8 | **FIXED** | "Michael Larson › In-home consultation · Nov 3 · Abigail Stafki" plus a non-interactive "Scheduled" pill. **← Project** is the only button. (Small problem with the SECTIONS heading: see N10.) |
| 6 | Opening Next sits mid-screen | **PARTLY** | Phone, tabletP and w320 (`*-05-opening-1`): there is a fixed bottom bar with **‹ Sections** on the left and **Next ›** bottom-right, plus "Today is the detailed visit · about 3½–4 hours". **tabletL** (`tabletL-05-opening-1`): **Next ›** still floats mid-pane under the card, because `BottomBar` is `lg:static` (`VisitScreen.tsx:41`). In a section it sits after the last field, about 4,300 px down (`tabletL-15b-…-full`). See N4. |
| 7 | Script twice / empty SCRIPT on tabletL | **FIXED** | `tabletL-05`: the left pane shows "**Next:** *“It takes about three and a half…”*" and the card shows line 1. On the list (`tabletL-13`) there is no SCRIPT eyebrow when no lines are left. |
| 8 | Sun mode row / ○ used as a toggle | **FIXED** | `*-04-more-sheet`: ⋯ → **More** sheet, with "Sun mode" on the left and "Off" plus a switch track on the right, then **Back to SJC OS**. There is no separate row above Get ready. |
| 9 | Visit length in the schedule dialog | **FIXED** | `r2c/owner-desktop-01`: no length line while nothing is ticked. `02`: "Estimated visit: about 3½–4 hours (Kitchen 2 h + Bathroom 1½–2 h); offer separate visits". The opening script speaks it as "three and a half to four hours". |
| 10 | Consultation hard to find | **FIXED** | `owner-desktop-04-default-tab-with-strip` (Floor tab), `05-ops` and `06-scope` all show the `--info` strip "In-home consultation · Tue, Nov 3, 9:00 am · Abigail Stafki · **Scheduled** [Visit page]". On Overview (`r2c/03`) the card sits directly under the Project block. The visitor's **Get ready** on the strip isn't shown, because no shot was taken as Abigail. |
| 11 | "⇅ 47" online with no reason | **PARTLY** | The code is in place: a `Last try` row, a ⚠ banner after one minute, and "answers and photos first" only on a weak link (`ConsultApp.tsx:23-63`). But under the current send blocker nothing records a failure, so the visitor sees "⇅ 80 · Online" and **Last sent: Not yet** indefinitely, with no reason and no banner. The design must not depend on a failure being reported. See N6. |
| 12 | Clipped focus ring on the status bar | **FIXED (code)** | `focus-visible:outline-offset-[-3px]` on both status-bar buttons. The focus-return state wasn't captured. |
| 13 | Visit time written two ways | **FIXED** | "Tue 9:00 am" in every visitor header and "Tue, Nov 3, 9:00 am" in the list and strip. There is no "09:00" anywhere. |
| 14 | Visit list header wraps | **FIXED** | `phone-03-visit-list-ready`: the title is on its own line, the row reads "Ready offline ✓" with a full-width **Start visit**, and **‹ Back to SJC OS** is one line. One small problem: there is an empty band between two rules under the card, where the "On this device" row would sit. Drop it when nothing is waiting. |
| 15 | Mark column too wide | **FIXED** | `w320-01`: "○ Not yet  Saving on this device" and "Works without signal" each fit on one line. |

## New issues

**N1. Planning notes appear under the fields as visitor help text (most important).**
- Where: `tabletL-08/09/10/13/14/15b`, `phone-13`.
- Source: `lib/consult/forms/seed/shared.ts` and `template-modules.ts`, about 125 `help:` strings, rendered as is by `FieldRow.tsx:215`.
- What the visitor reads includes:
  - "No disables camera/upload and creates explicit photo alternatives/assumptions; no hidden completeness bypass"
  - "prefill sub scope permits"
  - "all templates including add-ons"
  - "not Rectangle → sketch R + leg length/width R"
  - "Sketch canvas is Phase 4 (§6.7); until then…"
  - and, in the seeds, dozens of "R? kitchen; O otherwise", "→ structure", "→ set_design_path exact / defined / undefined", "shown masked, internal only"
- This breaks §3 (one plain vocabulary, no internal terms) and makes every section look unfinished.
- Fix:
  - Rename the seed field `help` → `note` (office/plan only; never rendered in the field).
  - Add an optional `hint` holding a plain visitor sentence, written only where it helps. Examples: "Facing the room from the main door, which wall is ahead?"; "Hand sketch with each leg measured — photograph it."
  - `FieldRow` renders `hint` only.
  - Add a test that fails if any rendered hint contains `→`, `R?`, `§`, `Phase`, `_` or a scope key.

**N2. The client summary claims work that wasn't done (client-facing honesty).**
- Where: `tabletL-16-client-view`, `ClientView.tsx:71`.
- Every room shows "Measured and looked over" when `r.work` is empty, including Room 1 at 0/14, Room 2 at 0/14 and Bath 1 at 0/26. Two rooms are titled just "WALL".
- "Still to decide" is a single run-on paragraph of about 30 "Bath — X · Kitchen — Y" names. §6 shows "Still to decide · faucet".
- Fix:
  - Only print a room once it has something covered. A room with nothing shows nothing, or "We'll come back to this room" if it is still open.
  - Never print the fallback sentence.
  - Give repeat instances their names, such as "Kitchen wall 1" and "Kitchen wall 2", or leave out `wall` modules as rooms.
  - Group Still to decide under each room as a short list, at most 5 per room, then "+ n more for the estimate".

**N3. Phone and tablet portrait: once past opening line 1 you can't reach Sections.**
- Where: `phone-06-opening-2`, the `FAIL-phone-sections` log ("‹ Back | Next ›"), `VisitScreen.tsx:179`.
- On step 2 or later the left button becomes **‹ Back**, and the only route to the list is tapping **Next** through all 6 lines. If the client walks off toward the kitchen, the visitor is stuck. This is also why the harness walk stalled at three widths.
- Fix:
  - Keep **‹ Sections** on the left at every step.
  - Put **‹ Back** beside it as a quiet text button, or make "Opening · 2 of 6" a tappable back link.
  - At ≤360 px the bar can hold **‹ Sections** and **Next ›** with Back moved above the card.

**N4. Tablet landscape: the primary action isn't in the thumb zone.**
- Where: `tabletL-05`, `tabletL-15b`.
- With `lg:static` on `BottomBar`, **Next ›** sits under the card (opening) or after the last field (section).
- Fix: on `lg`, make the bar `sticky bottom-0` inside the scrolling right pane, with a `bg-paper` and a top rule, so **Next ›** stays bottom-right as §6.1 requires.

**N5. The hand-back PIN can't take a 9–12 digit PIN.**
- Where: `ClientView.tsx:100`, `.slice(0, 8)`.
- Get ready now allows 12 digits, so a visitor with a 10-digit PIN can never hand back by PIN.
- Fix: `.slice(0, 12)`. Also add the wrong-PIN line and its state shot (see the table below).

**N6. The status bar shows no sign that sending is stuck.**
- Where: every visit shot ("⇅ 80 · Online", **Last sent: Not yet**).
- The coordinator's blocker is being fixed, but the UI should be honest even when the failure is silent.
- Fix: treat "online, unsent > 0, and no successful send for 2 minutes after a Send attempt or Start" as a failure in itself. Show:
  - a `Last try` row reading "Nothing went out — your answers are safe on this device"
  - **Try again**
  - the ⚠ banner after a minute

  **Send now** must show "Sending…" and then either **Last sent** or that line. It must never do nothing.

**N7. The tablet-portrait keypad is a centred modal that covers the field.**
- Where: `tabletP-14-keypad`.
- §6 says: a bottom sheet over the lower half, with the active field scrolled above it and still visible ("Ceiling * [active input]").
- Fix: on tabletP, use the same bottom sheet as the phone at about 50 vh, and scroll the field into the top half.

**N8. Keypad display details.**
- "reads as 6' 9"" uses straight quotes. §6.6 writes "reads as 8′ 0″"; use ′ ″.
- At w320 (`w320-14`) the fraction rows sit below the fold inside the sheet. Reduce the key height to 48 px on screens under 700 px tall, or put the fractions in a strip under the readout.
- The "3″ / 3′" ambiguity buttons were not captured (see the table below).

**N9. Second device: the action is wrong and the dashes run on.**
- Where: `phone-18`.
- **Try again** is the primary action, but trying again can't succeed.
- Fix:
  - Make the primary **‹ Back to visits** and make Try again quiet.
  - Write the reason as its own sentence under the row: "Works without signal" / "This visit is set up on another device. Use that one, or ask Joe to move it here." That is two sentences, not three em-dash clauses.

**N10. Look-over and Overview details.**
- The **SECTIONS** eyebrow sits over "Client ack · not yet / Sent from device · not yet / Notes · off", which are status facts. The "No sections yet" line is in the other column. Rename it **STATUS**, or put the facts under the header chip.
- "Recover answers from this device" reads "11 set-aside devices may still hold unsent answers": "this device" next to "11 devices" contradicts itself. Use "Recover answers from a set-aside device · n waiting".
- In the Move form, "Abigail Stafki — goes" is clipped in the select at 220 px. Use the name only and say "(goes now)" in the helper line.

**N11. Before you wrap is a flat list of 241 rows.**
- Where: `tabletL-15`.
- §5.5 and §6.9 say "grouped by section". Every row repeats "House & household · …".
- Fix: add section headers with "n open", and drop the prefix from each row. Collapse sections that have more than 5 open into "Room 2 · 14 open [Go to section]" (Go to section). Put "Close visit — needs finishing" and its count in the footer, as now.

**N12. Minor.**
- "Get on return visit · ⤳ Return visit" in Skip (`tabletL-10`) repeats itself. Drop the chip.
- "— N/A · Not on this job (3)" has a stray leading em-dash.
- `r2c/owner-desktop-01`: "General / other" shows a tinted background while unticked. If that is hover, fine. If it is a default, it reads as selected; check it.

## Required to reach 10

1. **N1**: move every seed `help` to an internal `note`, write plain `hint`s, and add a test that fails on `→ R? § Phase _`.
2. **N2**: the client summary lists only what was covered, names repeat rooms, and groups Still to decide by room.
3. **N3**: **‹ Sections** reachable at every opening step on phone and tablet portrait.
4. **N6**: the stuck-queue state (no successful send for 2 min while online) shows Last try, the banner and **Try again**. **Send now** always gives feedback.
5. **N4**: sticky bottom bar in the tablet-landscape right pane.
6. **N5**: hand-back PIN up to 12 digits.
7. **N11**: Before you wrap grouped by section.
8. **N7**: tablet-portrait keypad as a lower-half sheet with the field visible.
9. **N9**: the second-device screen with a primary action that works, in plain sentences.
10. **N8, N10, N12** and the empty band on the visit list (item 14).

## States still to capture

All four widths unless noted. The harness should open sections from the section list
(after the N3 fix, via **‹ Sections**; until then, via **Next** ×6), not by searching
the opening for "Sections".

| Shot | How to reach it |
|---|---|
| `07-section-list` (phone, tabletP, w320) | Opening → **‹ Sections**. Shows rows with marks, counts and the Price-critical / Record header. |
| `08/09-house` (phone, tabletP, w320) | Tap "House & household"; answer Photos okay = Yes and one text field. Shows ✓ Covered and "✓ Saved · on this device". |
| `11-skip-no-access` (all) | Skip this field… → tap **No access**. Shows the written-assumption fields opened, and **Save** enabled once filled. The tabletL shot repeated step 10. |
| `12-leave-banner` (all) | In House with a required field open, tap **‹ Sections** (tabletL: tap another section on the left). Shows "House & household still needs · Open: …" with **Go back** / **Leave for now**. |
| `14b-keypad-ambiguous` | In Ceiling height type `3`. Shows the two 56 px **3″ / 3′** buttons. Then type `8 1 1/4` → "reads as 8′ 1¼″" → Save → ✓ Covered on the field. |
| `07c-add-instance` | Tap "+ Window". Shows the new "Window 1" row in the list. |
| `07d-photo` | **Take photo** with a stubbed file. Shows "Saved on device", then "Uploaded ✓" plus a thumbnail and **Retake**. |
| `09b-sun-on` | ⋯ → Sun mode **On**, then a section and the list. Shows the 19 px base, 2 px rules and no tints. |
| `15-wrap` (phone, tabletP, w320) | List → **Before you wrap**. Once with items open, and once with a fixture that fills everything ("Close visit", "All price-critical items checked."). |
| `16-client` (phone, tabletP) | Closing → **Show to client**. Shows the single-column order from §6. Capture it after N2 with some rooms answered. |
| `17b-handback-wrong-pin` | **Use PIN instead** → wrong PIN (shows the error line), then the right PIN (back to the visitor preview), then the declined-initials reason after Hand back. |
| `17c-hold` | Press and hold **Hand back** for 1 s (shows progress), then release (shows the reset). |
| `11-closing` | **Close visit — needs finishing**: shows "Visit closed — sending", then "Needs finishing — n open; a Finish consultation to-do was made". Once more offline (waiting for signal). |
| `13-send-stuck` | The current build, online, on the Sending sheet two minutes after Start. Shows what N6 should show. After the blocker fix: **Send now** → "Last sent 12:05 pm", ⇅ 0. |
| `02y-no-signal`, `13-signed-out`, `08-offline-strip` | As in round 1. None were captured. |
| `owner-desktop-07-settings-company-cert` | Settings → Section **Company**. The shot shows Profile. |
| `owner-desktop-lookover-data` / `-conflict` | After the send fix: a needs-finishing close, then the look-over with sections, FEEDS quantities, evidence and the Needs-finishing banner. Seed a conflict for the **Pick / Pick / Enter another** row. Capture with the panel open and closed. |
| `owner-strip-as-visitor` | Sign in as Abigail on the project. Shows **Get ready** on the strip. |
| `staff-today` | Abigail's Today on the visit day. Shows the consultation to-do linking to the visit. |
