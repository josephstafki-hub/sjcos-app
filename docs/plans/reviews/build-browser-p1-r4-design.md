SCORES: design=9 completeness=8

# Browser Phase 1 — build round 4, DESIGN judge

Reviewed at HEAD `9d2db040` (t3/browser-phase1). UI fixes are in `9b8790db`; server and QA fixes are in `ccf87ad4`.

Evidence:
- the r3 screenshots `/home/joe/qa-sjcos/browser-p1/shots/r3/*.png` (586) and `log.json`
- my round 3 review
- both R3 handoffs
- plan §1 / §6.2 / §6.3 / §6.5 / §7 Phase 1 and the state tables (§ lines 2249–2330)
- `components/panel/Browser*.tsx` and `components/panel/browser/*`

QA artifacts ignored as instructed: the repeated chat message, "QA SAMPLE", and events 503 in queued, offer, expired and off. The site row reading "City permits" over a County page is the QA fake's label, not app copy.

Every round 3 design fix is visible in the shots:
- Owner Watch now shows the page on a phone and an iPad.
- No duplicate action row sits under any dialog.
- Blocked cards say one thing.
- Staff can choose a job.
- The menu opens the right list.

What is left is evidence, not design: six recovery and edge states have still never been rendered by the QA run, and one /today click is still missed. Nothing in the UI itself is required this round.

## Round 3 items — verified or not

| # | Status | Evidence |
|---|---|---|
| 1 Owner Watch on phone/iPad | **Verified.** | `log.json` image 352×220 (B4-working-watch-w360) and 812×508 (w820), 16:10 of the width. The page, then "Abigail's answers", then the phone instruction, then [Pause agent] [Zoom] [Pause live view] (B4-working-watch-w360). Private image at 360 shows "Private — only you and Abigail see this page." over the page (B4-controlling-private-image-w360). |
| 2 No live row under dialogs | **Verified.** | Take over (B2-takeover-dialog-owner-w1280): one [Take over][Cancel]. Fresh (B2-fresh-dialog-owner-w1280): one [Open a fresh browser]. Sites (B3-sites-staff-w360): one disabled [Open browser]. Reload (B1-reload-dialog-staff-land800): no Continue/Stop beside it. Owner landscape pause dialog leaves the 128 px column empty (B4-working-pause-dialog-land800). |
| 3 Stray expiry sentence | **Verified.** | A-final_blocked-owner-w360 shows "This version stops here. Nothing was submitted." with [Close] only. A-write_blocked-owner-w1280 shows the write sentence with [Take over][Close] and nothing else. |
| 4 Staff job picker | **Verified.** | B3-jobpicker-staff-w360: "Search projects…", a PROJECTS list, no error. |
| 5 Menu "Review page addresses" | **Verified.** | B1-review-addresses-owner-w360 opens "Review page addresses" with the address and [Close], not Sites. |
| 6 Empty Sites | **Verified.** | B3-sites-staff-w360 / owner-w1280: purpose, Job, the public-only line, Page address, "Use an https website address.", "Add at least one site to start." No empty "Pages this task may read" and no review button. |
| 7 In use label | **Verified.** | "Abigail · Check public permit requirements for a residential… — Maple Ave kitchen · Agent is working [Watch]" (B5-today-owner-w360, B5-today-owner-w1280). |
| 8 Row matches pane in queue states | **Verified where rendered.** | A-offer_expired-staff/owner-w1280: "Browser · You missed your turn. ›" with "You missed your turn." [Get back in line]. queue_expired can't be judged: the events-503 artifact turns the pane into "Couldn't connect to the browser." and the row into "Browser · Stopped" (A-queue_expired-*). The failed row reads "Stopped" (code `browser/model.ts:60`). |
| 9 Meta separators | **Verified.** | "Browser is paused. · 2 windows" on one line (B1-review-addresses-owner-w360). "Agent is working · Taylor is watching." (B4-working-staff-while-watched-w1180-for-w820). "You're in control. The agent is paused. · Taylor is watching." (B4-controlling-staff-while-watched-…-w360). No lone "· 2 windows" on review cards (A-exact_path_review-owner-w360). |
| 10 Owner header | **Verified.** | "‹ Back  Abigail's browser — Maple Ave kitchen", with the title wrapping in its own box at 360 (B4-working-watch-w360). |
| 11 No "Take over to type these." without Take over | **Verified.** | Before Show the page, the answers are a plain list (B4-controlling-watch-w1280). The phone owner view shows the phone instruction instead (B4-working-watch-w360). |
| 12 Completeness | **Partly.** | Newly captured and correct: see the list below. Still missing: see Required 1. |

Newly captured and correct for item 12:
- **Owner Pause confirm.** "Pause Abigail's agent? Abigail will need to tap Continue." [Pause agent][Cancel] (B4-working-pause-dialog-w360/w1280/land800). Then "Agent paused. Abigail can tap Continue." [Take over][Zoom][Pause live view], with Pause agent gone (B4-working-paused-by-owner-w1280).
- **Watching / replace.** "You're watching. Abigail is in control." [Take over from Abigail] (B4-controlling-pending-w1280). The dialog reads "Take over from Abigail? Their control ends." [Take over][Cancel] (B4-controlling-replace-dialog-w1280/w820).
- **Private image.** "Private — only you and Abigail see this page." at every width.
- **Staff while watched.** "· Taylor is watching." and nothing invented. Staff in control shows [Done][Stop browser][Zoom][Pause live view][Keyboard] and Type it (B4-controlling-staff-while-watched-…-w360).
- **Leave confirm while in control.** "Pause browser and return to Chat?" [Pause and return][Keep browser open] (B2-leave-dialog-owner-w820).
- **B3 at 1280.** The Sites dialog opens, and so does the job picker (B3-sites-owner-w1280, B3-jobpicker-owner-w1280).
- **Staff take-over confirm** has no "Don't ask again". The owner's does (B2-takeover-dialog-staff-w820 vs owner-w1280).

## Rulings on the open questions

**The 16 `clicked:false` entries:**
- **B4-working-replace-dialog ×4: correct.** In "working" nobody controls the task, so the owner gets plain [Take over], not "Take over from Abigail". The replace dialog exists only when staff hold control (`BrowserView.tsx:57`).
- **B4-controlling-replace-dialog-w360 / land800: correct.** Phones are view-only (no Take over at all). The owner landscape column shows "Take over on a tablet or computer."
- **B4-controlling-pause-dialog ×4: correct.** While a person controls, the agent is already paused, so Pause agent is offered only in working/loading with `pause` available (`BrowserView.tsx:57`). The screen honestly shows "You're watching. Abigail is in control." instead.
- **B5-today-*-w1180 / w1280 (owner + staff): correct.** On a computer the Operator panel is docked open on /today with the Browser tab showing (B5-today-owner-w1280), so there's no pill to click.
- **B5-today-owner-w820 / staff-w820: NOT correct.** The Operator pill is on screen bottom-right ("Operator" + mic, B5-today-owner-w820), but the shooter didn't click it, so the 820 sheet is uncaptured for the second round. See Required 1.

**Owner /settings/browser "11 small targets": not a defect.** The 11 are the raw 13 px checkbox boxes:
- 2 switches
- 4 people
- "Don't ask again…"
- 4 disabled "Not available" items

Each sits inside a full-width `<label className="flex min-h-12 …">` (`BrowserSettings.tsx:8`, `:12`), or `min-h-11` for the disabled four (`:14`). The whole 48 px (or 44 px) row toggles the box (A-settings-owner-w360). The "Don't ask again" box in the take-over dialog (the `small=1` on B2-takeover-dialog-owner-*) sits in a 44 px label row and is fine for the same reason. The shooter should measure `input.closest('label') ?? input` so these stop showing up.

## REQUIRED fixes

1. **Completeness: render the states the QA run still hasn't reached.** All of these are code-verified but have no screenshot after two rounds. Scope every selector to `[data-browser-ui]` and use the exact names from the R3 UI handoff's recapture table.
   - **B5 iPad sheet.** In B5-today-owner/staff-w820, `clickedOperator:false`, yet the pill is visible. The shooter's `click(o,"button",/^Operator$/)` misses because the pill's name includes the mic button or a longer label. Click the pill by its own accessible name (check it with `getByRole('button',{name:/Operator/})`, excluding the mic), then select tab "Browser". Shoot the open sheet with the In use row and [Watch].
   - **Disconnected → Reconnect → reconnected.** A-disconnected-*, A-reconnected-* and B9-disconnected-* all render "Agent is working", because the seed is an active task, which the handoff says not to do. Seed a **paused** task, drop the event stream, and capture:
     - "Connection lost. Browser paused." [Reconnect]
     - after Reconnect, public: "Connected. Review the page before continuing." [Resume] [Take over] [Stop browser]
     - after Reconnect, private (after Keep paused): [Take over again] and no Resume, at 820/1280. At 360 there is no Take over.
   - **Couldn't pause.** A-pause_failed-* renders "Agent is working". B8-couldnt-pause-* lands on "You're in control on your other device." [Take over here], because the forced 409 is read as control held. Fail the `confirm_leave` pause with a 503 or a timeout instead, so the pane shows "Couldn't pause the browser. Keep this screen open, or stop the browser." [Try again] [Stop browser] (`useBrowserSession.ts:154`).
   - **Earlier view.** A-loading-* shows "Opening browser…" with no image. Keep a frame from a working task, then trigger a navigation, and capture "Earlier view" under the retained image.
   - **Resource 21 and expired.** B7-resource_21-* and B7-resource_expired-* both show one CSS file with an enabled [Allow these files once].
     - For 21: seed 21 pending candidates. The server keeps 25. Expect "Too many files to review at once." with Allow disabled, and [Next files].
     - For expired: wait past the server deadline in the same page, then shoot "These page addresses need a fresh review before they can be allowed." with Allow disabled.
   - **Private pending text.** B4-controlling-pending-* went straight to the authorized image. For one shot at 360 and 820, hold the private-view audit pending and capture "Waiting to show the private page…" with no image (it renders as the content heading, `BrowserView.tsx:89`).
   - **Compact keyboard row.** Capture this once at 820 landscape or 1180 if the layout triggers `compactCapture`: `[data-browser-compact-capture="true"]`, "Address ▸", Type it.
   - Owner queued and owner queue/offer expired stay blocked by the events-503 artifact I was told to ignore. Once the fixture streams events, re-shoot A-queued-owner / A-queue_expired-owner. Expect "Browser is busy. Abigail is using it." and the row "Browser · You left the line."

## Optional

- **Empty Sites heading** (B3-sites-staff-w360). "This task can use these sites." sits over no sites. When `!m.sites?.length` and there's no task, use the plan's empty-sites copy as the heading and drop the duplicate line at `BrowserView.tsx:71`:
  - heading: "Add at least one site to start."
  - drop: `{!m.sites?.length&&!m.addressReady&&<p>Add at least one site to start.</p>}`

  Keep "This task can use these sites." once a site exists or a task is open (plan table, Sites review vs Empty sites).
- **Title-row controls under a dialog.** While a dialog is open, ⋯ and "‹ Chat" stay clickable with the mouse (B2-leave-dialog-owner-w820, B3-sites-staff-w360). ⋯ swaps an open confirm for the menu. In the title slot, hide ⋯ when `m.dialog` is set (`BrowserView.tsx:81`).
- **Empty strip under dialogs.** The pane's actions container still draws its top rule and about 56 px of empty band below every dialog (B2-fresh-dialog-owner-w1280, B3-sites-staff-w360). Let the host collapse the actions area when the actions slot returns null.
- **Keyboard box has no visible prompt** (B2-keyboard-owner-w820). Below the image there is an empty bordered box. Add `placeholder="Type here"` to the `Keyboard for website` textarea (`BrowserView.tsx:101`). The line above already says "Keys go to the website · Esc to stop".
- **Landscape private label covers the page top** (B4-controlling-replace-dialog-land800 hides "County Property Information"). The status row above already carries the state. In owner landscape, put "Private — only you and Abigail see this page." in that row (" · Private — only you and Abigail see this page.") instead of overlaying the image.
- **Paused private says it twice** (B9-paused_private-owner-w1280): "Paused. The agent can't read this page." and "Private — you took over. The agent can't see this page." Both are plan copy. Consider hiding the private label when `state==='paused_private'`, since the status already says the agent can't read it.
- **Carried from round 3, still optional:**
  - On the owner's own task, when they paused the agent themselves, say "You paused the agent." instead of "Taylor paused the agent." (A-owner_paused-owner-w1280).
  - Add `size-5` to the Settings checkboxes so they're easier to see.
  - Add a count line on long file reviews.
  - Have the QA fake site label return the host so shots show the real trusted form.
