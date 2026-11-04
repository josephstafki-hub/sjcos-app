# Build R5 — Design & field UX judge (in-home consult)

SCORES: design=8 completeness=8

Judged from `/tmp/sjcqa/shots/consult-r5/*` (110 shots, `log.json`, `log-b.json`): a fresh Bath + Kitchen visit on a fresh database. I checked it against plan §3, §5, §6, §8, §10 and `docs/design-tokens.md`, and against the code at `5a39b90c` (with `2924d2b2`).

These are test-harness artifacts and are not scored:
- "1954" in Permit authority
- "8 other devices haven't sent yet"
- the close finishing by itself after the held requests were released
- the `tabletL-25b/25c` shots: the script failed `tabletL-client-via-wrap`, so they show a typed PIN and nothing else
- `phone-30`: it was taken in run A, before the visit was closed, so "In progress" is correct

Facts from the logs:
- `overflow_px: 0` everywhere.
- `404 urls: []`.
- 33 answers reached the server at every width.

**Why design went up from 7 to 8.** Every round-4 blocker is fixed, and the fixes hold up on screen:
- **The visit is whole.** It has Kitchen work, Kitchen wall 1–2, the appliance and Closing, and Closing is last. All of them exist right after an interrupted start. See the DB labels and `phone-07b`.
- **Leave check:** it sits in the thumb zone.
- **Close:** it reaches a calm ◐ Needs finishing, with a "Still closing…" state on the way.
- **Before you wrap:** it uses ○ Open, not !.
- **Selection rows:** they read 0/2.
- **Tablet portrait:** one column.
- **Tablet landscape:** shows Say once.
- **Fraction keys:** they match.

What keeps design at 8 rather than 10:
- **Go back breaks the layout.** The status bar scrolls off and the action bar floats mid-screen, at three widths.
- **Kitchen work is hard to reach.** It sits below 30 selection rows.
- **Flags disagree.** The device shows no flags, but the close says 7 flags need a decision.
- **The office look-over is still alarming.** It shows the old red ⚠ banner for "Needs finishing".
- **Small keys at 320 × 700.** The keys shrink to 48 px.
- **Small mismatches:** a few counts and words still disagree.

**Why completeness went up from 6 to 8.** Every state the coordinator listed is now on screen at all four widths, apart from the close states, which are tablet portrait only. That includes:
- the client view
- the PIN (wrong PIN and handed back)
- Pick date
- the leave sheet
- the timeout and the result
- the look-over after close

Still missing:
- a Complete close
- an offline close
- the flags sheet
- the 3″ / 3′ choice
- conflict, no-signal and photo states
- the "Setting up sections…" words and their Try again state
- the close states on phone, 320 and tablet landscape

---

## Round-4 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| R4-1 | Kitchen sections / Closing missing | **FIXED** | DB labels "sections right after Start" include Kitchen work, Kitchen wall 1–2, Appliance 1 and Closing. After a reload the Kitchen presets are added. `phone-07b-2`: Closing 0/4 is the last row. "Show to client" works (`*-24`). Pick date opens Closing on the date field (`*-21`). The walk *order* is still wrong: see R5-2. |
| R4-2 | Leave check off-screen | **FIXED** | `phone-12`, `w320-12`, `tabletP-12`: a bottom sheet "House & household still needs · ○ Open: …and 13 more", with Go back / Leave for now beside the thumb. `tabletL-12`: right sheet. New defect after Go back: see R5-1. |
| R4-3 | Close result never arrives | **FIXED** | `tabletP-27` "Visit closed — sending". `tabletP-28` "◐ Still closing…", a calm info box, and Try again / Keep working. `tabletP-29` "◐ Needs finishing · 258 open", ○ per check, and 229 + 29 = 258, which matches Before you wrap. Heading wording: see R5-7. |
| R4-4 | False ⚠ Not sent | **FIXED** | `phone-10/10b`: "Sending…", with the button disabled as "Sending…" and no ⚠. `w320-10`, `tabletL-10`: "All sent ✓ · Nothing waiting to send." |
| R4-5 | Wrap blockers styled as Problems | **FIXED** | `*-20`: every card is "○ Open" on the card fill, and the header "258 Open" equals 256 price-critical + 2 record. Per-section counts still disagree: see R5-6. |
| R4-6 | Ragged tablet-portrait grid | **FIXED** | `tabletP-09`, `tabletP-12b`: one column of fields. Choice options sit in a 3-up row. |
| R4-7 | Presets start ◐ Partly | **FIXED** | Every "Bath — …" / "Kitchen — …" row reads 0/2 ○ Open. |
| R4-8 | Section names | **MOSTLY** | Fixed: "Bathroom work 1", "Kitchen work", "Electrical panel 1", "Structure check 1 — Bath". Left over: see R5-9. |
| R4-9 | Typography | **MOSTLY** | Scripts and labels are curly ("I’ll take photos…", Client’s own list (“…”)). The keypad readout goes through `prettyLength`. Left over: `ClientView.tsx:119`, "doesn&apos;t" (`phone-25b`, `w320-25b`). See R5-8. |
| R4-10 | Small items | **FIXED** | `tabletL-08`: Say is shown once. `phone-10c`: an idle bar reads "⇅ 0" with no "sending…". `owner-desktop-01b`: "○ Pick at least one template" beside a disabled Schedule. |
| C1 | 320 fraction keys | **FIXED, with a cost** | `w320-14`: both fraction rows (⅛ ¼ ⅜ ½ / ⅝ ¾ ⅞) sit above Save, in one font, and every glyph has the same build. But the keys are now 48 px and the mode chips 44 px: see R5-5. |
| C5 | Flag line / flags sheet | **Still not seen**, and now contradictory | No flag card in any `*-20`, yet `tabletP-29` and `owner-*-31-after-close` say "Every flag has a decision · 7 flags". See R5-3. |

## New issues (required)

**R5-1. Go back throws the screen out of place (required).**
- **Where:**
  - `phone-12b`, `w320-12b`, `tabletP-12b`.
  - After **Go back** in the leave sheet, the status bar (○ Notes off · ⇅ 0 · ⋯) is gone.
  - The ‹ Sections / Next › bar floats at y≈665 (phone), y≈455 (320) and y≈1020 (tablet portrait), with an empty band below it.
- **Cause:** Go back sets `focusAddr` (`VisitScreen.tsx:329`). `FieldRow.tsx:151` then calls `scrollIntoView({ block: "center" })`, which scrolls every scrollable ancestor, including the document and the app shell, not just `main`. `Pick date` survives (`*-21`) only because its target sits where no outer scroll is needed.
- **Fix:**
  - (a) Scroll only the section's own scroller: `main.scrollTo({ top: el.offsetTop - main.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" })`, with `main` passed down in `actions` or found via `el.closest('[data-scroll]')`.
  - (b) Pin the visitor shell so the document can't scroll at all: `position: fixed; inset: 0` on the app root, plus `overflow: clip` on `html` / `body` for `/consult/*`.
- **Re-shoot:** `*-12b` at all four widths. Also briefly highlight the target field (a 2 px focus ring for about 1.5 s), so the visitor sees *where* Go back took them.

**R5-2. Kitchen work sits below 30 selection rows (required).**
- **Where:** `phone-07b-1/-2`, `tabletP-20` (left).
  - The list runs: House … Era hazards, then **Bath — Vanity … Kitchen — Paint colors** (30 rows), then Kitchen work, ↳ Appliance 1, Kitchen wall 1–2, and Closing.
  - On a phone the visitor scrolls about 1,700 px of selection rows to reach the Kitchen scope and the walls. That is the second half of the walk.
  - The plan catalog puts `selections` just before `closing` (plan §8, `#### selections` then `#### closing (once, last)`).
- **Cause:** `mergeTemplateModules` (`lib/consult/template-merge.ts`) keeps first-seen order. So Kitchen's own modules (kitchen_scope, kitchen_wall, appliance) are appended after Bath's `era` and `selections`. Only `closing` is moved to the end (line 17).
- **Fix:**
  - After merging, sort by one catalog order, with the scopes and their walls/children kept together near the start: house → access → room → bath_scope → kitchen_scope → kitchen_wall → appliance → … fixtures/doors/windows → mechanicals → structure → moisture → era → **selections → closing**.
  - Add a test: for bath + kitchen (and kitchen + bath), `kitchen_scope` comes before `selections`, `selections` is second to last and `closing` is last.

**R5-3. The device and the server disagree on flags. The visitor can't see what the close blocks on (required, verify).**
- **What the shots show:**
  - Before you wrap shows no "Flags: n need a decision" card at any width. `WrapSheet` draws it only when `model.flags.length > 0`.
  - The close result says "○ Open · Every flag has a decision · 7 flags" (`tabletP-29`).
  - The look-over says "Every flag has a decision · 7 open" (`owner-desktop-31-after-close`).
  - The visitor can't act on something the device never showed.
- **Likely cause:**
  - The server builds `values` with `projection.scalar(i, f.key)` derived values before it evaluates `flag.when` (`lib/consult/protocol.ts`, in the close-check builder).
  - The device model (`lib/consult/ui/model.ts:299`, `safeCondition` on `values`) doesn't add the derivations.
  - So a flag whose `when` reads a derived or prefilled value (for example `era.pre_1978` or `footing.required_depth`) fires only on the server.
  - The harness's extra devices typed the same values, so they shouldn't explain it. But confirm against the DB.
- **Fix:**
  - One shared flag evaluator, fed the same values (answers + global + derived), used by both the device model and the close check.
  - A parity test: the same snapshot gives the same flag keys on the device and the server.
  - And never leave an open check without a way forward. Each ○ Open row on the close result gets its action: **Review flags** opens FlagSheet, **Pick the date**, **Show to client**, **Decide** / **Review** for trade walks and Renovate Right. The same buttons Before you wrap already has.

**R5-4. The office look-over after close is still the alarm style, and it says "this device" (required).**
- **Where:** `owner-desktop-31-lookover-after-close`, `owner-phone-31-lookover-after-close`.
  - A flag-red box headed "⚠ Needs finishing · 258 open".
  - Plain bullets with no state.
  - "· N open" appears only when N > 1 (`app/(os)/projects/[slug]/consult/[id]/page.tsx:105–109`). So a single-item row and a done row look the same.
  - "Everything **on this device** reached the office … · 8 open" is read by Joe on his desktop.
- **Why it's wrong:** this is the same rule round 3's C2 and round 4's R4-5 applied to the device. Needs finishing is not a Problem.
- **Fix:**
  - Reuse the field result's look: the ◐ Needs finishing heading, then one ○ Open row per open check with `checkCount()`, on the neutral card / info tone. Keep the `flag` tone for conflicts and refused answers only.
  - Give the office its own words for `close_manifests`: "8 devices haven’t sent yet" beside a recover action (if one exists), or "— the visitor can send them from the device".
  - The pill already reads "◖ Needs finishing · 258 open". Keep it.

**R5-5. Keypad at 320 × 700: keys under the 56 px floor, and two marks with no words (required).**
- **Sizes:**
  - `w320-14/14b`: at `max-height: 700px` the keys drop to `min-h-12` (48 px) and the mode chips to `min-h-11` (44 px) (`Keypad.tsx:119, 147`).
  - Plan §6 says tap targets ≥ 56 × 56 and keypad keys 64 px. Joe's rule is 56 px field targets.
  - Tablet portrait mode chips are 48 px (`md:max-lg:min-h-12`), also under the floor.
- **Marks with no words:** **⌫** and **␣** have aria labels but no visible words (`w320-14`, `phone-14`, `tabletL-14`, `tabletP-14`). A visitor wearing gloves in a client's kitchen won't read ␣ as "space between feet and inches".
- **Fix:**
  - At `max-height: 700px`, open the keypad as a full-height sheet: top 0, covering the status bar while it's open. That frees about 85 px, enough for 6 key rows at 56 px and the mode chips at 56 px.
  - Raise the tablet-portrait mode chips to 56.
  - Put a small word under each glyph: "⌫ / Delete", "␣ / Space". Use the same 0.75em ink-2 caption on both.

**R5-6. Section counts disagree between the list and Before you wrap (required, small).**
- **Where:** `phone-07`, `tabletP-07`: "Bathroom work 1 · 0/26". `tabletP-20`: "Bathroom work 1 · 27 open".
- **Cause:** the row prints `s.pc` only (`VisitScreen.tsx:70`). The wrap groups count every open item, price-critical + record (`WrapClose.tsx:74`).
- **Fix:** have the row show done/total across both tiers, the same set the wrap counts. Or have the wrap row read "26 open · 1 record". The two numbers must be the same number.

**R5-7. "Visit closed — sending" over "All sent ✓" (required, small).**
- **Where:** `tabletP-27`. The heading says sending, and the line under it says "All sent ✓ · Checking the visit with the office."
- **Fix:** when nothing is waiting, the heading reads "Visit closed — checking with the office". "— sending" stays only while ⇅ > 0.

**R5-8. Last straight apostrophe (required, small).**
- **Where:** `phone-25b`, `w320-25b`: "! That PIN doesn't match. Try again, or hold Hand back." It is written inline in `ClientView.tsx:119` with `&apos;`.
- **Fix:** move it into `words.ts` with ’ (there is already `invalid_pin`, "That PIN doesn’t match. Try again."; extend it with ", or hold Hand back."). Also add `components/consult/**` to the straight-quote test, so JSX text is covered, not just the seed and `words.ts`.

**R5-9. Leftover names (required, small, from R4-8).**
- **"+ Selections & allowances"** (`phone-07b-2`) adds a row named by the module title. A plural noun for one decision breaks "the add button and the row use the same noun". Make it **+ Selection**, which adds "Selection 31" until a decision is typed.
- **"↳ Appliance 1 — Kitchen"** is nested under Kitchen work and also repeats "— Kitchen". A child row drops the area, because the parent already says it: "↳ Appliance 1".
- **"Kitchen — Appliance package (each appliance)"**: drop the parenthetical from the decision name ("Kitchen — Appliances"). Put "one line per appliance" in its hint.

## Optional extras

- **Leave sheet:**
  - The header **Close** and **Go back** do the same thing. Drop Close, or label it Go back.
  - On tablet landscape the right sheet is 560 × 700 px holding one line. A compact docked sheet (as on the other widths) would sit nearer the left-pane thumb.
- **Client view:**
  - There are two buttons called "Hand back": the hold button and the PIN submit. Make the submit **Hand back with PIN**.
  - Disabled **This is what we went over** gives no reason. Add "Initial the box first".
  - At 320 both long labels wrap to two lines inside 56 px buttons (`w320-24b`).
  - "Not measured today: the bathroom, the kitchen" is the first thing the client reads. Put it after Still to decide.
- **Before you wrap:**
  - The Client initials card stacks its button while the others put it on the right.
  - "Why were initials skipped" is a quiet button that reads like a statement. Make it **No initials — say why**.
  - On phone the footer buttons are right-aligned and of different widths. Stack them full width.
- **Sending sheet:** "Last sent · All sent ✓" (`w320-10`, `tabletL-10`). Keep the time in Last sent and make "All sent ✓" the status line.
- **Photo hint:** "Ask “Photos okay?” in House & household first." shows while the visitor is *in* House & household. Use "Answer Photos okay? above first."
- **Duplicate hint:** "Client’s own list (“anything you want us to look at”)" repeats its own label as the hint. Drop the hint, or say "Write it in their words."
- **Orphans:**
  - At 320, "Record" and "0/2" break onto two lines in the header (`w320-07`).
  - "Living in the home during the work?" leaves its "*" alone on the next line (`phone-09d-2`).
  - Wrap the last word + "*" and each count in `nowrap`.
- **Selections:** 30 preset rows. Consider one collapsible group per area ("Bath selections · 0/15 ›") in the section list.
- **Choice options:** the empty choice circle "○ Yes" is the same glyph as the status mark "○ Open". A small radio ring or a plain button would keep ○ meaning one thing.

## States still to capture

| Shot | How to reach it |
|---|---|
| `*-12b` after R5-1 | Status bar present, bar at the bottom, the target field ringed. All four widths. |
| `07b` after R5-2 | Kitchen work / walls / appliance right after Bathroom work, selections second to last, Closing last. |
| `09-flag-line` + `flags-sheet` + `20` with the Flags card | A visit where a flag fires (alarms "Missing"; year built 1950). The device's flag count equals the close check's. |
| `22b-complete` | A full fixture: Complete, with no open rows. |
| `22c-offline-close` | Close with no signal: "closed — sending when signal returns". |
| `27/28/29` on phone, 320, tablet landscape | Only tablet portrait has them now. |
| `14c-unit-ambiguous` | Ceiling height `3`, then the two 56 px 3″ / 3′ buttons. |
| `04d-setting-up` | The "Setting up sections…" words, and the Set up sections / Try again state when some are missing. |
| `owner-31` after R5-4 | The calm ◐ look-over, with office wording for devices. |
| Unchanged from round 4 | conflict, no signal, photo, add instance, signed out, Settings › Company, staff Today / strip. |

## Required to reach 10

1. **R5-1:** Go back (and every focus jump) scrolls only the section pane. The shell can't move.
2. **R5-2:** merged modules follow the catalog order: scopes together, selections then Closing last. Add a test.
3. **R5-3:** one flag evaluator shared by the device and the close check, with a parity test. Every open close check carries its action.
4. **R5-4:** the office look-over uses the calm ◐ / ○ style with per-row counts and office words for devices.
5. **R5-5:** keypad keys and mode chips ≥ 56 px at 320 × 700 (full-height sheet). Visible words on ⌫ and ␣.
6. **R5-6 – R5-9:** count parity, the closing heading, the PIN apostrophe, and the last three names.
