# Build R6 — Design & field UX judge (in-home consult)

SCORES: design=8 completeness=8

## How this was judged

**Screenshots:** `/tmp/sjcqa/shots/consult-r6/*`. That is 111 shots plus `log.json` and `log-b.json`, from a fresh Bath + Kitchen visit on a fresh database.

**Code:** checked at `2f30e57d`, with fix commits `c2707285`, `f5b2668a` and `2f30e57d`, against my round-5 list.

**Logs:** `overflow_px: 0` everywhere. `404 urls: []`. `held: 2`.

**Harness artifacts, not scored:**
- "N other devices haven’t sent yet"
- "1965" typed into Permit authority — city/township (`*-12b`)
- tabletL has no client-view shots
- the first tabletL keypad, 16ths and HVAC runs failed. `log-b` recovered them.

**Harness note: the "full" shots are no longer full.**
- Every `*b-…-full.png` is now just the viewport. The visitor screen is `position: fixed` (R5-1), so a page screenshot can't grow.
- To get a full shot, scroll the pane (`main` / `[data-scroll]`) in steps and take one shot per step, or stitch them.
- Right now the bottom of the client view at 320, the end of the section list and the Heating & cooling child row are not on any shot.

## Why the scores

**Design stays at 8, but round 5's blockers are gone.** Every one of them is fixed and holds up on screen:
- **Go back** keeps the shell still and rings the field. Checked at all four widths.
- **Kitchen order:** Kitchen work, the appliance and the walls now follow Bathroom work.
- **Look-over:** the office look-over is calm.
- **Keypad:** keys are 56 px, and Delete and Space have words.
- **Counts:** the list and the wrap agree.
- **Headings and words:** the closing heading, the apostrophe and the names are fixed.

**What keeps design at 8 is new:**
- **False flags (the biggest issue).** Seven code flags fire on fields nobody measured. This is the R5-3 "parity" fix, and it made the device agree with the server's wrong answer.
- **The Client initials card breaks** at 320 px and is cramped at 390 px.
- **The 1/16″ keypad at 320** hides its last key row behind the footer.
- **Skip reasons:** a measuring reason is offered for a signature.
- **Flag cards don't show the number** that tripped them.
- **Close checks** use different words from Before you wrap.

**Completeness stays at 8.** More states were captured, but five of the states the brief lists don't show what they claim:
- **Timeout:** `tabletP-28` is the same as `-27`.
- **Skipped date:** `w320-22*` skipped Client initials, not the date.
- **Right PIN:** `phone-25c` is the same as `-25b`.
- **3″ / 3′ choice:** never reached, because `3` is not ambiguous on a 24–600″ field.
- **Renovate Right read-out:** no read-out line is on any `17*` shot.

---

## Round-5 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R5-1 | Go back throws the screen out | **FIXED** | `phone/w320/tabletP/tabletL-12b`: the status bar stays, the action bar is pinned, and Photos okay? is ringed. `scrollInPane` is used, not `scrollIntoView`. |
| R5-2 | Kitchen below 30 selection rows | **FIXED** | `*-07`: Bathroom work 1, Kitchen work, ↳ Appliance 1, Kitchen wall 1–2, then fixtures. The `tabletL` list in the log ends with selections, then Closing. |
| R5-3 | Device and server disagree on flags | **PARITY FIXED, VALUES WRONG** | `*-20` and `*-29` both say 7 flags. But all 7 fire on fields that are empty or don't apply. See R6-1. The row actions are **FIXED**: `*-29` has Go to field, Go to photo, Show to client, Review, Review flags and Decide. `*-29c`: Review flags opens FlagSheet. |
| R5-4 | Office look-over alarm style | **FIXED** | `owner-*-31`: ◐ Needs finishing · 256 open on the neutral card, a ○ Open row with words per check, "4 devices haven’t sent yet" with Recover answers, and "— Abigail Stafki finishes this on the visit device." |
| R5-5 | Keypad < 56 px, ⌫ / ␣ with no words | **FIXED, one leftover** | `w320-14`: keys and mode chips are about 56 px in a full-height sheet. Delete and Space are worded at every width. Leftover: the 1/16″ field at 320. See R6-3. |
| R5-6 | Counts disagree | **FIXED** | The list shows "Bathroom work 1 · 0/27". The wrap header (256) equals the left pane (254 open price-critical + 2 record). |
| R5-7 | "sending" over "All sent ✓" | **FIXED** | `tabletP-27`, `phone-26b`: "Visit closed — checking with the office · All sent ✓ · Keep this screen open." |
| R5-8 | Straight apostrophe on PIN | **FIXED** | `phone-25b`: "That PIN doesn’t match. Try again, or hold Hand back." |
| R5-9 | Leftover names | **FIXED** | "+ Selection" (`tabletL-20`), "↳ Appliance 1" and "↳ Vented appliance 1". |
| Extras | Leave-sheet Close, Hand back with PIN, Initial the box first, Not measured after Still to decide, No initials — say why, phone footer stacked, sending sheet status line, nowrap counts | **DONE** | `*-12`, `phone-25b`, `phone-24`, `phone-20`, `w320-07` |

## Required fixes

**R6-1. Code flags fire on fields that were never measured (required, the biggest issue).**
- **State:**
  - Before you wrap says "Flags: 7 need a decision" (`phone-20`, `tabletP-20`, `w320-20`).
  - The close result says "Every flag has a decision · 7 flags" (`*-29`).
  - FlagSheet (`*-29c`) shows:
    - "⚑ Bathroom work 1 · Toilet front clearance — Less than 24 in in front of the toilet". Bathroom work 1 is 0/27.
    - "⚑ Fixture 1 — Bath · Toilet rough-in — Not the usual 12 in toilet rough-in". Fixture 1 is 0/6, and the fixture type isn't even picked.
    - "⚑ Fixture 1 — Bath · Center of toilet to side wall…"
  - A visitor in a client's kitchen is told about three plumbing-code problems in a bathroom nobody has measured.
- **Cause:**
  - c2707285 switched the flag values to `projection.scalar(i, f.key)` in both places: `lib/consult/ui/model.ts:272–316` and `lib/consult/protocol.ts` completion.
  - `scalar()` falls through to `field(instance, key)?.value` (`lib/consult/derive.ts:50`).
  - For a conditional field whose condition is false, `field()` returns `zero()` (`derive.ts:25`, "Only false conditional applicability is zero"). That 0 is meant for quantity sums, not flags.
  - So `lt('toilet_front_clearance', 24)` and `lt('rough_in', 11.5)` evaluate 0 < 24 → true.
  - `model.ts` also moved `allFlags.push` above the `!applicable` skip, so a flag on a field that doesn't apply still counts.
- **Change:**
  - Feed `evaluatedFlags` the **answered** values. For derived fields, use their formula result, never the 0 placeholder for a field that doesn't apply. In `scalar()`, return `undefined` when `field()` produced the zero for a false condition, or give flags their own value map.
  - Skip flag evaluation on fields where `applicable === false`, on both the device and the server.
  - Add a test: a fresh bath + kitchen visit with no answers gives **0 flags** on the device and on the server. With `toilet_front_clearance = 20` it gives exactly 1, on both. Keep the r5 parity test.

**R6-2. The Client initials card collapses on narrow screens (required).**
- **State:**
  - `w320-20`: "Client / initials / — / not / yet" is squeezed into a column about 55 px wide, one word per line. The "○ Open" label sits under the Show to client button.
  - `phone-20` (390): the label wraps in two lines beside a disabled button, and "→ Pick the estimate date first, so the client sees it." is crammed into small type under the label.
- **Cause:** `WrapClose.tsx:52–53` puts a two-button `grid` into the `Line` action slot, which is a side-by-side row at every width.
- **Change:**
  - Below 600 px, stack every `Line` the way the close-result rows already do on phone (`phone-29`): the mark and label on line 1, the note on line 2, then the button(s) full width.
  - Keep the side-by-side layout from 600 px.
  - Re-shoot `w320-20` and `phone-20`.

**R6-3. Keypad for a 1/16″ field at 320 × 700: the last key row is hidden (required).**
- **State:** `w320-15b` and `w320-15c`. The second fraction row is cut off behind the Save footer: 5/8 ¾ ⅞ in the 8ths view, and 9/16–15/16 in the 16ths view. The other causes:
  - The sheet title wraps to three lines ("Length corner to corner at counter height (36″)").
  - "Show 16ths" sits inside the readout box, which pushes "Type the measurement" onto two lines.
- **Change:**
  - Move **Show 16ths / Show 8ths** into the footer, left of Save. The footer's left half is empty.
  - Clamp the keypad title to one line at `max-height: 700px` (`line-clamp-1`), with the full label in `aria-label`.
  - Together these free about 70 px, which is enough for both rows at 56 px.
  - Check it on `w320-15b/15c` with both fraction rows fully above the footer.

**R6-4. Flag cards don't show the number that tripped them (required).**
- **State:** `*-29c`. The card reads "Less than 24 in in front of the toilet …" but never says what was measured or where to change it.
- **Change:**
  - Lead each card with the value: "Measured 20″ — less than 24″ in front of the toilet; code needs at least that."
  - Add a quiet **Go to field** button, so a typo can be fixed instead of priced.
  - Same words: "24 in in front" → "24″ in front", and "12 in toilet rough-in" → "12″ toilet rough-in" (`lib/consult/forms/seed/flag-hints.ts:22,23,47`).

**R6-5. Skip reasons that don't fit the field (required).**
- **State:** `w320-22`/`22a`. "Skip this field · Client initials" offers "Not on this job", "No access", "Not safe to measure" and "Sub/supplier will measure". The estimate date's Skip offers the same list. None of these mean anything for a signature or a date.
- **Cause:** `SkipSheet.tsx:42` filters only "Not on this job" for photos.
- **Change:** filter `SKIP_REASONS` (`words.ts:354`) by field type:
  - **Measurements and photos:** the full list.
  - **Signature:** Client declined, Get on return visit, Other. Better still, route it to the existing **No initials — say why** sheet.
  - **Date:** "Joe sets the date", Get on return visit, Other.
  - **Text and choice:** Client declined, Get on return visit, Not on this job, Other.

**R6-6. The close checks speak in rules, not in what's left (required, words).**
- **State:** `*-29` and `owner-*-31`. Each row is a rule sentence with ○ Open beside it, so it reads backwards: "○ Open · Every flag has a decision · 7 flags", "Every touched trade has a sub walk-through decision · 3 left", "Every required answer is in, or skipped with a reason that counts · 227 answers".
- **Problem:** one screen earlier, Before you wrap says the same things plainly: "Flags: 7 need a decision", "Trade walks: Plumber, Electrician, HVAC — needs a decision".
- **Change:** when a check is open, show the open-state words, the same ones Before you wrap uses:
  - "227 answers still open"
  - "29 photos still open"
  - "Flags: 7 need a decision"
  - "Trade walks: Plumber, Electrician, HVAC — need a decision"
  - "Client initials — not yet"
  - "Renovate Right: receipt not recorded · …"
  - Keep the rule sentence only as the done state ("✓ Every flag has a decision").
  - One map in `words.ts:371ff`, used by the field result and the office look-over.

**R6-7. Spelling and units (required, small).**
- Joe writes American English:
  - "initialled" → **initialed** (`words.ts:207, 371`). The seed already says "What the client initialed."
  - "centre" → **center** (`flag-hints.ts:23`, `template-modules.ts:45`, which says "centre-to-centre").
- Add both to the typography test.

**R6-8. Opening card 4 says its script twice (required, small).**
- **State:** `phone-06-opening-card-4`. The card quote, "I’ll take photos of the rooms…", is repeated straight below as "**Say:** I’ll take photos of the rooms…".
- **Cause:** `VisitScreen.tsx:233` renders the Photos okay? `FieldRow`, which prints its own `def.say`.
- **Change:** pass `hideSay` to that `FieldRow` (and to the client-list one on line 234) when it sits under an opening card.

**R6-9. "Filled from Year built" over an empty answer (required, small).**
- **State:** `phone-17-era-1985-prefilled`. "Built before 1978? ○ Open — *Filled from Year built. Change it if that’s wrong.*" Neither Yes nor No is picked. The 1985 is only a prefill waiting for "Still right ✓".
- **Change:** while Year built isn't answered, the hint reads "Fills in once Year built is confirmed in House & household." Once it is filled, show the pick and its source: "● No — from Year built 1985".
- **Verify:** in `17b` and `17d`, Built before 1978? is no longer on screen above "Window or door replacement…". If it hides once it's answered, the visitor can't "change it if that’s wrong". It has to stay visible.

## Re-shoots I need (completeness)

| Shot | What's wrong now | How to reach it |
|---|---|---|
| `tabletP-28` timeout | Same as `-27`. No ◐ Still closing…, no Try again. | Hold the close more than 16 s (`deadlineFetch` is 15 s), then shoot. Then shoot `28b` after Try again. |
| `w320-22*` skipped **date** | The script skipped Client initials. The date was already picked by the phone. | Use a fresh consult, or clear the date. Skip *Formal estimate promised by*, and show the Closing section with Show to client enabled, then the client view. |
| `phone-25c` handed back | Same as `25b`: PIN field empty, error still shown. | Type the right PIN, tap **Hand back with PIN**, and wait for the visit screen. If it never comes back, it's a bug. Report it. |
| `*-14c` 3″ / 3′ | `3` on a 24–600″ field is unambiguous (reads 3′ 0″). That's correct, but the choice never shows. | Type **30** in Length (wall to wall): 30″ and 30′ are both in range. Shoot the two 56 px buttons. |
| `17*` Renovate Right read-out | No read-out line on any shot. | 1965 + Built before 1978? **No** → shoot "Why is this not a pre-1978 home despite the year?" and its flag. 1985 + Yes → shoot the top of Era hazards and RrpSheet. |
| Bottom of the client view at 320 | Full shots are viewport only. | Scroll the client-view pane. Initials, This is what we went over, Hand back. |
| Heating & cooling child row | Below the fold. | Scroll to "↳ Vented appliance 1" or "Vented appliance — 0/1 · Add". |
| After R6-1 | | `*-20` with **no** Flags card on a blank visit. Then type Toilet front clearance 20″ → 1 flag, and shoot the flag card with its value. |
| **Complete close** | Not captured. **I need it.** | Use a fixture with everything answered or skipped with reasons: ● Complete, with no ○ rows. The office look-over should show the done state. |
| **Two-device conflict** | Not captured. **I need it** for a 10. | Two devices change the same field: the conflict card on the field, the ⚠ in the list, and the close result blocking on the conflict (`flag` tone only here). |

## Optional extras

- **Close-result and wrap marks:** "○ Open" is in `text-label` (about 11 px) at the far left of each row (`*-29`, `*-20`). Use `size="row"` (15 px), as in the section list, or put the mark on the row's first line.
- **Offline close heading:** `phone-26` reads "Visit closed — sending" with no signal. Use "Visit closed — will send when signal returns". Disabled Send now could also read "Send now · needs signal".
- **Sending sheet:** shows "Last sent · Not yet" over "All sent ✓" (`w320-10`). When nothing has ever been sent, use "Nothing waiting to send".
- **Field result row:** "4 other devices haven’t sent yet — Joe can recover them." If the visitor *is* Joe, make it "the office can recover them".
- **Look-over:** "The visitor’s Finish consultation to-do already exists." → "Abigail has a Finish consultation to-do." The pill's ◖ and the card's ◐ are different glyphs for the same state. Use ◐ in both.
- **Tap field:** "[ tap to enter ]" brackets read like a code placeholder. Use "Tap to measure".
- **Choice rings:** the choice "○ Yes" still uses the status glyph ○ (r5 extra).
- **Leave sheet:** on tablet landscape it is still 560 px wide for one line of text (r5 extra).
- **Show 16ths:** now that `len()` defaults to `precision: 0.0625` (c2707285 `helpers.ts`), more fields get it. Room length and width keep 1/8″ because they set it explicitly (`shared.ts:112`). But a field with no precision set, such as Ceiling height, now asks for 1/16″. Check that this is wanted.

## Required to reach 10

1. **R6-1:** flags evaluate only answered (or real derived) values on fields that apply, so a blank visit has 0 flags. Add a test on the device and the server.
2. **R6-2:** the Client initials card stacks below 600 px.
3. **R6-3:** both fraction rows of a 1/16″ field fit at 320 × 700: toggle in the footer, title on one line.
4. **R6-4:** flag cards show the measured value and a Go to field button, with ″ units.
5. **R6-5:** skip reasons are filtered by field type.
6. **R6-6:** close checks and the look-over use the open-state words Before you wrap uses.
7. **R6-7 – R6-9:** initialed and center, opening card 4 says its script once, and the honest Built before 1978? hint stays visible.
8. **Re-shoots:** timeout, skipped date, right PIN, 30 → 3″ / 3′, the Renovate Right read-out, a Complete close and a two-device conflict.
