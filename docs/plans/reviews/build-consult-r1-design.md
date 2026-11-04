# Build R1 — Design & field UX judge (in-home consult Phase 1)

SCORES: design=6 completeness=4

Judged from `/tmp/sjcqa/shots/consult-r1b/*` (plus the schedule dialog and card shots in
`consult-r1/`), against plan §3, §5.2, §5.7, §6 and the code in `components/consult/**`,
`lib/consult/ui/**` and `app/(os)/projects/[slug]/consult/[id]/page.tsx`. No page scrolls
sideways at any width (`overflow_px: 0` everywhere, w320 included).

**Why completeness is 4:** the run never opened a section. Nothing in the visit itself
was captured: no field entry, keypad, **Skip this field…** sheet, leave-section banner,
**Before you wrap**, **Show to client**, Hand back, closing or the Complete / Needs
finishing result. The step called `06-keypad` actually shows the **Sending** sheet.
That is the core of Phase 1, so at most half the screens have been judged.

**The `FAIL-*` shots are the harness's fault, not the product's.** **Skip this field…**
belongs on each field inside a section (`FieldRow.tsx:125,230`), and the plan says
there is no skip for a whole section. **Show to client** belongs on the Closing
section and in the **Before you wrap** sheet (`VisitScreen.tsx:221`, `WrapClose.tsx:54`).
Neither should appear on the section list or the opening, so not finding them there is correct.

## What works

1. **Get ready matches the §5.2 wireframe closely.** The check list uses the shared
   `ready` marks with a word beside every mark (○ Not yet / ✓ Done / ! Problem). The
   rows are in the plan's order. **Ready offline ✓** shows "Works without signal until
   Wed 11:08 am", the hint to add it to the Home Screen and keep the device, and a full-width
   56 px **Start visit**. **Not ready** shows a red heading, the problem row in `--flag`
   with its reason, the paper fallback line and **Try again**. Leaving out the
   Microphone row in Phase 1 matches D5.
2. **The status bar follows §6.2.** It is one 56 px row reading "○ Notes off · ⇅ n",
   plus "· Online" on tablet only, with ⋯ on the right. ⋯ holds only **Sun mode** and
   **Back to SJC OS** at every width; there is no ☀ icon. With no signal, a `--info` strip reads
   **No signal · saved on this device**. The **Sending** sheet lists answers and photos
   separately and has **Send now**.
3. **The section list follows §6.3.** Each row shows the name, a mono count, › and
   the mark with its word ("○ Open", "◐ Partly"), and each row is a 56 px target.
   The header shows "Price-critical n/N · Record n/N". At 320 px, long names
   ("Plumbing & water heater") wrap cleanly without pushing the mark off-screen.
4. **Tablet landscape has the §6.4 two-pane layout.** The left pane is 360 px with
   SCRIPT and SECTIONS; the right pane holds the active screen. Sheets open on the right.
5. **The words come from one place.** Everything on screen comes from `W` in
   `lib/consult/ui/words.ts`. I found none of the words the plan bans (sync, lease,
   precache, REC, exit…) on any captured screen. The tokens, fonts (Newsreader / Mulish /
   JetBrains Mono) and 8 / 6 px radii look native to SJC OS.
6. **The schedule dialog's fields and controls are right.** It is centred at 560 px.
   Who goes, Date, Time, template toggles and add-on toggles carry ☐/☑ beside each
   word, then Visitor notes. **Schedule** stays disabled until a template is ticked.

## Required to reach 10

1. **A 4-digit PIN leads to a dead end — `phone-02x-pin-4-digits-rejected.png`,
   `components/consult/field/GetReady.tsx:57-72,118-121`, `lib/consult/ui/words.ts`
   (`pinChooseHelp`, `pinShort`).**
   - The help text says "4 to 8 digits", but the offline key only accepts
     `/^\d{6,12}$/` (`lib/consult/offline.ts:89`).
   - A 4-digit PIN passes the form, and Get ready then fails with "sign-in for offline
     use failed — sign in again". The visitor is already signed in, so that advice is wrong.
   - On **Not ready**, **Try again** re-sends the same saved PIN
     (`pin ? <Btn … onGetReady(pin)>`), so it can never succeed. The only way out
     is reloading the page.

   Fix:
   - Change both regexes to `/^\d{6,12}$/` and `.slice(0, 12)`, including `UnlockCard`
     (`GetReady.tsx:131,135,137`).
   - Help text: "You type it to open this visit without signal. 6 to 12 digits."
     `pinShort`: "Use 6 to 12 digits."
   - Map the `invalid_pin` code from Get ready to an inline `! Use 6 to 12 digits.`
     under the PIN field, not to a check row.
   - When the failed check is `offline_lease` and the code is not `signed_out`, show
     `PinChoice` again instead of the bare **Try again**.

2. **Every unknown failure code reads "sign in again" — `lib/consult/ui/words.ts:233-241`
   (`readyReason`) and `:299` (`plainWords`).**
   - `device_access_denied` (a second device on the same visit, refused by design per
     §5.4) shows the sign-in text on Get ready.
   - Mid-visit, the same code reads "Your access to this visit was removed… Joe can
     recover them". That is alarming and also untrue.

   Fix:
   - Add a §5.7 reason, `READY_REASON.otherDevice`: "this visit is set up on another
     device — use that one, or ask Joe to move it here". Return it for
     `device_access_denied`.
   - Give `plainWords('device_access_denied')` its own sentence, "This visit is being
     filled in on another device. Use that device, or ask Joe to move it here.", and
     drop it from the `revoked` group.
   - Return `READY_REASON.signin` only for real sign-in codes (`signed_out`,
     `lease_*`, `unauthorized`). Any other code should fall through to the existing
     plain default: "Something went wrong… Try again".
   - Add the new row to the §5.7 table, so the plan stays the one place the words live.

3. **The office look-over page is broken with the Operator panel open —
   `owner-desktop-lookover.png`, `app/(os)/projects/[slug]/consult/[id]/page.tsx:86`.**
   - `xl:grid-cols-[240px_minmax(0,1fr)_320px]` switches on the *viewport*
     (1280 px), but the content pane is only about 634 px wide.
   - The middle column collapses to about 30 px. "No sections yet — the visit hasn't
     started." breaks one word per line and runs over the EVIDENCE heading, and the
     FEEDS box runs off the bottom.

   Fix: make the content area a container (`@container`) and switch to three
   columns at about 1040 px of container width. Below that, use two columns
   (sections | section), with evidence stacked under the section. The phone layout
   (`owner-phone-lookover.png`) already stacks correctly.

4. **FEEDS shows internal keys and zeros — `owner-desktop-lookover.png`,
   `owner-phone-lookover.png`, `page.tsx` (FEEDS block, `Scope: {x.scope} · …`).**
   - "Scope: bath.tile · Floor tile area 0" shows a raw `scope_key` and a quantity
     of 0 for something not measured yet.

   Fix:
   - Show the scope item's title and the quantity label with its unit, with the value
     in mono: "Bath tile · Floor tile area 42.5 sf", as in the §6.8 wireframe.
   - Show unmeasured rows as "○ Open", or leave them out until a value exists.
   - Never print `x.scope` as written.
   - Use the body font for the label and keep mono for numbers only.

5. **The look-over header doesn't follow §6.8 — `owner-desktop-lookover.png`, `page.tsx`
   header.**
   - The status "Scheduled" is drawn as a 48 px rounded control the same size as
     **← Project**, so it looks like a button.

   Fix: lay the header out as §6.8 does — `{client} › In-home consultation · Nov 3 ·
   Abigail Stafki`, then a status chip (non-interactive, `text-meta`, pill radius
   20 px), then the actions. Keep **← Project** as the only button there.

6. **The opening's Next button sits mid-screen — `phone-04-opening-script.png`,
   `tabletP-04-opening-script.png`, `VisitScreen.tsx:173-177`.**
   - §6.1 says the primary action goes bottom-right in the thumb zone. Here **Next ›**
     floats at mid-height.
   - A bare quiet "Sections" sits under it and reads like a stray heading.

   Fix:
   - Reuse the section view's fixed bottom bar (`VisitScreen.tsx:251`): **‹ Back** /
     **‹ Sections** on the left and **Next ›** on the right, 56 px, with the safe-area
     padding. Remove the floating quiet button.
   - Add the §6.3 opening line "Today is the detailed visit · about {duration}" above
     the card.

7. **On tablet landscape the script appears twice, or as an empty heading —
   `tabletL-04-opening-script.png`, `tabletL-05-section-list-or-first.png`,
   `VisitScreen.tsx:265-268`.**
   - During the opening, the same line shows in the left SCRIPT pane (italic) and in
     the right card.
   - On the list, SCRIPT is an eyebrow with nothing under it.

   Fix:
   - During the opening, the left pane shows the *next* line ("Next: …") or nothing.
   - Hide the SCRIPT eyebrow when there are no lines.

8. **"Sun mode ○ Off" gets its own row above Get ready and clashes with the marks —
   `phone-02-get-ready.png`, `tabletL-02-get-ready.png`, `phone-09-overflow-menu.png`,
   `ConsultApp.tsx:55,153-155`.**
   - Before the visit starts, a separate 48 px row holds only "Sun mode ○ Off",
     outside the plan's `‹ Visits · title` head.
   - ○ is the legend's **Open** mark (§3: one legend), so "○ Off" / "● On" reuses a
     coverage mark for a toggle.

   Fix:
   - Move Sun mode into a ⋯ on the right of `ScreenHead` on the Get ready, Unlock and
     blocked screens. This is the same ⋯ sheet as the status bar, which is what §6.2
     specifies.
   - Show the switch state as the word only ("On" / "Off"), with a switch-style track.
   - In the ⋯ sheet, spread the label and state apart. `justify-between` is overridden
     by `Btn`'s `justify-center`, which is why they sit together in the middle.

9. **The schedule dialog's visit length reads badly — `consult-r1/owner-desktop-02b-schedule-filled.png`,
   `lib/consult/ui/words.ts:340-345` (`visitDuration`).**
   - With Kitchen and Bath ticked it says "Estimated visit: 2 hours + 90–120 min;
     offer separate visits". The units are mixed, the sum is left to the reader, and
     the order follows how the code stores the templates.
   - With nothing ticked it says "Estimated visit: 45 min", the General fallback, for
     a template nobody picked.

   Fix:
   - Store each template's length as minutes `[min, max]` and add them up, printing to
     the nearest half hour: "Estimated visit: 3½–4 hours; offer separate visits",
     which is the §6.9 wording.
   - Add "; offer separate visits" only when the total exceeds 3 hours or `whole` is
     ticked.
   - With no template ticked, hide the line.
   - `fillScript`'s `{duration}` will get the same wording automatically.

10. **The consultation card is hard to find — `owner-desktop-01-project-overview.png`,
    `consult-r1/owner-desktop-03-card-scheduled.png`, `app/(os)/projects/[slug]/page.tsx:468`.**
    - The card is the 4th block on Overview, below the fold, at y≈844 px at 1280×860.
    - A floor-plan-stage project opens on its Floor tab, so Joe or the visitor never
      sees it.
    - The scope page (`owner-desktop-04-scope-link.png`) has no link to the visit.
    - §4 lists Overview *beside the stage card*, the Schedule entry, Ops stage
      guidance and the scope page as entry points.

    Fix:
    - While a visit is `scheduled` or `in_progress`, add a one-line strip under the
      project header, visible on every tab: "In-home consultation · Tue Nov 3, 9:00 am
      · Abigail Stafki · Scheduled [Visit page]", plus **Get ready** for the assigned
      visitor.
    - Move the card directly after the Project / stage block. It is currently placed
      there; check that it shows without scrolling on a 860 px-tall screen, or put it
      in the right-hand column beside the stage card.
    - Add the Ops stage-guidance link and the scope page's Site-visit plan link the
      plan names.

11. **"⇅ 47" while online, with "Last sent: Not yet" and no reason —
    `phone-06-keypad.png`, `tabletL-06-keypad.png`, every r1b visit shot,
    `lib/consult/ui/controller.ts:376-381`, `ConsultApp.tsx:44-52`.**
    - From **Start visit** to the end of the run, the 47 answers queued by Start
      never went out, even though the device was online.
    - `drain()` drops non-network errors silently.
    - The sheet says "Sending answers and photos first." That half sentence belongs
      to the weak-signal row in §5.7, which continues "Recordings wait for a better
      signal." It doesn't apply when the signal is fine.

    Fix:
    - Store the last send-failure code in state. Show it in the Sending sheet as a
      `Last try` row, using `plainWords(code)` with **Try again**, and as a ⚠ action
      banner under the status bar once sending has failed for more than a minute.
    - Show "Sending answers and photos first." only while sending on a weak or
      unknown connection.
    - Find out why these 47 never went out; if the cause is `device_access_denied`,
      fix 2 above covers the words.

12. **The status-bar focus ring is clipped — `phone-08-offline.png`,
    `tabletP-08-offline.png`, `ConsultApp.tsx:33-34`.**
    - After the Sending sheet closes, focus returns to the status button, which is
      correct. Its `outline-3` ring is then cut off along the top and left edges.

    Fix: use `focus-visible:outline-offset-[-3px]` on the status-bar buttons, or give
    the row 2 px of inner padding so the ring fits.

13. **The visit time is written two ways — `phone-02-get-ready.png` ("Tue 9:00 am") vs
    `phone-03c-ready-or-problem.png` ("Tue 09:00 am").**
    - The server page and the offline shell format the time differently.

    Fix: build `display.scheduled_label` once on the server with `centralTime`
    (`hour: "numeric"`), and have the shell use that stored label instead of
    formatting the time again.

14. **The visit list's header wraps at phone width — `phone-01-visit-list.png`,
    `w320-01-visit-list.png`, `components/consult/field/VisitList.tsx`.**
    - "Back to SJC OS" breaks onto two lines beside a title that also wraps.

    Fix:
    - Put the title alone on the first row, and move **Back to SJC OS** into the same
      ⋯ as fix 8, or make it a single-line `LinkBtn` under the list.
    - After Get ready, the row should read "Ready offline ✓ [Start visit]", as in the
      §6.3 list wireframe. This state wasn't captured; see the shots below.

15. **The mark column on Get ready is too wide — `w320-02-get-ready.png`,
    `GetReady.tsx:37` (`grid-cols-[minmax(7.5em,auto)_1fr]`).**
    - At 320 px, the 7.5 em mark column pushes "Saving on this device" and "Works
      without signal" onto two lines.

    Fix: use `grid-cols-[auto_1fr]` with `gap-3` so the labels stay on one line. The
    mark words then sit to the right of the 15 px marks, as §6.1 sets.

## Shots to add next round

The visitor shots are for phone, tabletL, tabletP and w320 unless a width is named.

| Shot | How to reach it |
|---|---|
| `05b-section-open` (field entry) | From the section list, tap "House & household"; then also open "Bath 1". Shows the Say: line, labels, * and marks, the 56 px rows and the fixed bottom bar. |
| `06-keypad` (real) | In Room 1, tap a length field's "tap to enter". Type `8 1 1/4` so "reads as 8′ 1¼″" shows, then `3` to bring up the 3″ / 3′ choice. Also capture tabletP with the sheet over the lower half and the field still visible. |
| `06b-saved` | Save from the keypad. Shows the ✓ beside the field and the mark changing to ✓ Covered. |
| `07-skip` | In a section, tap **Skip this field…** on a required field. Capture the reason list, then "No access" opened up to the written-assumption fields. |
| `07b-leave-banner` | With a required field still open, tap **‹ Sections**. Shows "{section} still needs · Open: …" with **Go back** / **Leave for now**. |
| `07c-add-instance` | Tap "+ Window" / "+ Add room". Shows the new "Window 1" row. |
| `07d-photo` | Tap **Take photo** with the file input stubbed. Capture "Saved on device", then "Uploaded ✓" with the thumbnail and **Retake**. |
| `09b-sun-on` | ⋯ → Sun mode On, then the section view and the list. Shows the 19 px base, 2 px borders and no tints. |
| `10-wrap` | Tap **Before you wrap** on the list: once with items still open ("Close visit — needs finishing"), and once with everything filled through a test fixture ("Close visit" and "All price-critical items checked."). |
| `10b-client` | Closing section → **Show to client**, or the wrap sheet. Shows the summary at 20 px, the initials pad, **This is what we went over** and **Hand back — hold 2 seconds** with its progress, plus **Use PIN instead**. tabletL two-column too. |
| `10c-handback-pin` | Tap **Use PIN instead**, type a wrong PIN, then the right one. |
| `11-closing` | Tap **Close visit — needs finishing**. Capture "Visit closed — sending", then "Needs finishing — n open; a Finish consultation to-do was made." Capture once more offline, to show the waiting-for-signal state. |
| `02y-no-signal` | Fresh device, set offline, open `/consult/{id}`. Shows **No signal** / "Open once with signal before the visit." |
| `02z-other-device` | A second browser context on the same visit → Get ready. Shows the words from fix 2. |
| `02w-pin-short` | Type a 4-digit PIN. Shows the inline "Use 6 to 12 digits.", with the checks not started. |
| `12-unlock` | After Get ready, clear the session cookie and reload offline. Shows `UnlockCard`. |
| `13-signed-out` | During the visit, expire the session and send. Shows the "Signed out — your answers are safe…" banner with **Sign in**. |
| `01b-list-ready` | After Get ready, go back to `/consult/`. Shows the row as "Ready offline ✓ [Start visit]", plus the "On this device · n items waiting [Send now]" row. |
| `owner-desktop-lookover-data` | After a needs-finishing close: the look-over page with sections filled, FEEDS with real quantities and units, and the Needs finishing banner. Capture once with the Operator panel open and once closed. |
| `owner-desktop-lookover-conflict` | Seed a conflict. Shows the **Pick** / **Pick** / **Enter another** row in `--flag` on `#EFD9CF`. |
| `owner-desktop-project-strip` | Project on its default Floor tab with a visit scheduled. Shows the visit strip from fix 10. |
| `owner-desktop-02c-schedule-none` | Open the schedule dialog with no template ticked. Shows that no visit length is printed. |
| `staff-today` | Abigail's Today on the visit day. Shows the "In-home consultation — M Larson, Tue 9:00" to-do linking to the visit. |
