SCORES: design=9 completeness=9

# Round 5 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

I judged committed HEAD `1a9e936a`, which is where the Browser plan was last changed. The host file `_ask-pane-host.md` was last changed at `85a7a5c6`, and the plan adopts that commit (§6.2). I ignored the Codex builder's uncommitted `components/panel/*` edits.

I read the plan against:
- the context file
- my round-4 review
- the plan's "Round-4 fixes" appendix
- host H1–H5, including the round-4 short-landscape shell
- the Canvas plan's §3.1 800 × 360 frame (Canvas passed 10/10)
- the round-5 Canvas design review
- Joe's words rule

I walked these flows:
- Joe's Asked to finish, from a phone notice to finishing on an iPad or computer
- private Watch → Show the page
- waiting-screen exits
- the resting state after public Done
- the 800 × 360 landscape Browser layout
- a sweep for stale copy and contradictions

## Round-4 items: verified / not fixed

All 4 are **verified fixed**. What I found new is outside those items: the landscape shell and the definition of "phone" (required items 1–2). Item 3 is a copy bug in templates I suggested myself in round 4.

| # | Status | Where / note |
|---|---|---|
| 1 Joe's side of the hand-off | **Verified (a)–(f).** (a) Invitation card at the top of a new-chat preview; nothing is created before Open. (b) Phone/native copy: Don't finish / Close, no Open browser; native gets a 48 px Open in Safari, and Don't finish there says "Open in Safari to tell Abigail." (§10.2). (c) Asked to finish list beside In use: it persists past bell-read, sign-in and a closed destination, reachable under a live task, and its empty state reads "No requests to finish." (d) Exact busy copy. (e) Outcome controls on the status row and chat card, both confirms, Escape = Cancel, registered in §6.2. (f) `browser-staff-handoff-db` and `browser-ui` cases. Restart attempts and the uncertain-effect "Check the site" path are a strong addition. **Edge:** the phone test (<1024 viewport) catches iPad portrait (item 2). | §6.4, §6.5, §10.2, §12 Phase 2 |
| 2 Private Watch | **Verified.** "Abigail took over. The agent can't see this page. [Show the page]" at 48 px, with no frame before the explicit join. Private label, "Joe is watching." lifecycle, "Agent paused. Abigail can tap Continue." only after the fence. Delegated-secret pre-image copy "Login from Joe…". The 360 Watch frame no longer has a placeholder. §6.5 rows and owner-review tests are present. | §6.2, §6.3, §6.5, §12 Phases 1/3 |
| 3 Waiting-screen exits | **Verified.** Stopped / left / turn finished, updated in place with a polite announcement and [‹ Back]. The precedence is sensible: final/unknown, then closed/failed, then absence, then turn end. "Nothing is waiting" never covers an executing or unknown effect. §6.5 rows and tests are present. | §6.3, §6.5, §12 Phase 3 |
| 4 Public Done resting state | **Verified.** "Paused. The agent can't read this page. [Take over again] [Open a fresh browser] [Stop browser]" after Keep paused and on pane return, with no resting Keep paused. The phone instruction is exact. It appears in §5.2 step 6, §6.5 and the `browser-ui` test. | §5.2, §6.5, §12 Phase 1 |

These round-4 optional items were taken: H3 Watch wording (host `85a7a5c6`), "Abigail is waiting for you" in the 1280 frame, ‹ Back in Words, and the phone lapse copy. Not taken: silent Telegram while Joe already watches (still optional), and the host H5 `89b1bd6e` hash (host owner's file).

## What's strong

- **The hand-off is now a complete, honest loop on both sides.** Staff get one confirmed button and a paused state. Joe gets an invitation that creates nothing until Open, a durable list it can't fall out of, a busy message, and restart attempts that never reuse a failed task. Outcome buttons say exactly what they record ("Tell Abigail you finished this?") and never claim a portal result.
- **Private Watch is a deliberate act with visible consequences.** Joe has to ask to see a private page. Abigail is told "Joe is watching." Pausing her agent is confirmed and reported only after it succeeds.
- **No screen dead-ends.** The waiting screen, the public Done rest, closed destinations and unknown effects each have a defined resting state with a real next action.
- **The plan works with the real code.** It names the native bell path (`notifications.tsx:283–296` → `targets.ts:247–278`), Telegram edit vs send, and the PanelHost/PanelDock gaps. It does not invent new mechanisms.

## Required to reach 10

### 1. §6.2 / §6.3 — draw Browser's 800 × 360 landscape screen and its right column (own task and owner layer)

**What's missing.**
- §6.2 adopts H3's short-landscape shell in one sentence: "Browser owns its center and right action column."
- H3 says "Browser draws its own content and right column inside this same shell." The Canvas plan draws its frame (§3.1) and says "Browser … places its own controls in its own right column."
- The Browser plan never says what goes in that column. There is no frame. The portrait Browser view stacks four rows above the image (‹ Chat/Browser · city.example · ‹ › Reload Pause · state/Stop), roughly 176 px. At 360 tall that leaves under 100 px of image.

**Why it matters.** The plan itself tells Joe at 360: **"Turn your phone sideways for a bigger view."** Landscape is therefore a path the plan recommends, and it is undrawn for:
- the own-task viewer
- Joe's own review sheet
- the cross-person owner layer, which has no selector, so it's unclear whether the strip shows at all

A builder cannot place ‹ › Reload, Stop, Zoom, Pause live view, the popup-window switch, the phone instruction or the sticky decision buttons from the current text.

**Add to §6.3, after the 360 viewing frame:**

```text
800 × 360 Browser, phone landscape (H3 shell; own task, viewing)
┌────────┬──────────────────────────────────────────────┬──────────────┐
│   ×    │ ‹ Chat · city.example · ⋯             48 px │ [Stop        │
│ Queue  │ Agent is working                      20 px │  browser]    │
│ Chat   │                                              │ [Zoom]       │
│ Canvas │      live image (contain/letterbox)          │ [Pause live  │
│ Browser•│          stage ≥200 px                     │  view]       │
│        │                                              │ Take over on │
│        │                                              │ a tablet or  │
│        │                                              │ computer     │
└────────┴──────────────────────────────────────────────┴──────────────┘
 ≥64 px   center 48 title / 20 meta / stage              128 px
```

**Rules.**
- **Title row (48 px):** **‹ Chat · {trusted origin} · ⋯**. ⋯ holds ‹ / › / Reload (same request guard), Saved logins, and the window switch "city.example / Payment window" when a second window exists.
- **Meta row (20 px):** the fixed state line ("Agent is working", "Paused", "Waiting for Joe · 0:48 left"), plus "· 2 windows" when there are two.
- **Right column (128 px, ≥48 px controls, top to bottom):** the state's primary action, then the rest.
  - Working: Stop browser.
  - Public paused: Continue, then Stop browser.
  - Then Zoom and Pause live view.
  - On a phone, end with the non-button text **"Take over on a tablet or computer"**.
- **Own review sheet (Joe's own task) in landscape:** the card scrolls in the center. The right column holds the sticky decision buttons, e.g. **[Pay $125.00 once] [Don't pay]**, which may wrap to two lines inside 48 px+. [Review image] opens the zoom view. Staff waiting template: the card is in the center and **[See request] [Cancel request]** sit on the right.
- **Owner layer in landscape:**
  - It is still the top layer with no Operator strip or selector.
  - One 48 px header **"‹ Back · Abigail's browser · Larson bath"** spans the full width.
  - The center holds the scrolling status/review card. The right 128 px column holds the sticky decision buttons, or on Watch **[Show the page] [Pause agent]**.
  - After Show the page, the image fills the center, the status moves to a 20 px meta row, and [Pause agent] stays on the right.
- **Short computer window (sheet mode, height <600):** the same frame. The right column's primary action is Take over / Done. While keys are captured, §6.3's 44 px keyboard row replaces the title and meta rows.
- **Tests:** add 800 × 360 Browser own-task, review and owner-layer cases to `browser-ui` and `browser-owner-review`. Assert:
  - stage ≥200
  - no second strip in the owner layer
  - decision buttons visible without scrolling

### 2. §6.2 (new paragraph), §6.4 hand-off "Phone", §6.5 — define "phone" once; iPad portrait must not be told to "finish on your iPad"

**What's undefined.** About 20 places switch on phone vs tablet/computer, including:
- Take over
- Take over again
- the instructions
- first-fill mapping
- the hand-off invitation

None of them defines what "phone" means.

**Where it contradicts itself.**
- The only definition is in the hand-off: **"Phone (<1024 viewport, or the native app)"**.
- That catches the **820 iPad portrait** sheet, which §6.3 explicitly allows to take over.
- So Joe opens the notice on his iPad in Safari and reads **"Finish this on your iPad or computer."**
- He is then told to "open the wider web view", which means rotating the iPad.

**What breaks if it stays undefined.**
- A width-based guess fails in the landscape that the plan recommends: an 800 × 360 phone is wider than a 744 iPad mini.
- Without a rule, a sideways phone would show Take over.

**Add to §6.2:** **"Phone" = the native app, or a web view whose screen's shorter side is <600 CSS px (`Math.min(screen.width, screen.height) < 600`). Evaluate it on load and keep it through rotation. Everything else (any iPad orientation, Split View or not, and computers) is tablet/computer.** This one helper gates:
- every Take over / Take over again / first-fill control
- every "Take over on a tablet or computer" instruction
- the hand-off Open button

Viewport width still decides layout only (H1/H3).

**Then:**
- In §6.4 replace "Phone (<1024 viewport, or the native app)" with **"Phone (§6.2 rule, or the native app)"**.
- Delete "On an iPad at a narrow viewport, open the wider web view to accept".
- An 820 iPad portrait shows **[Open] [Don't finish]** and accepts into the 820 full-height Sites review.
- Add 820 portrait (accept allowed), 800 × 360 (phone) and 744 iPad mini portrait (tablet) cases to `browser-ui` and `browser-staff-handoff-db`.

### 3. §5.2 / §6.2 / §6.3 / §6.4 / §6.5 — templated copy must not guess staff pronouns

The staff name is a variable: the plan already shows "Shared with Abigail, **Mark**". Several fixed strings hard-code "she/her":
- §6.2 "Pause Abigail's agent? **She'll** need to tap Continue."
- §6.3 / §6.5 "…Nothing more will come until **she** opens it again."
- §6.4 / §6.5 "**Her** answers come with it."
- §5.2 / §6.4 "…Joe signs in for **her**."

The same section also says "until **they** open it again", so the plan is inconsistent with itself. Mark's hand-off would read "Her answers come with it."

Owner strings ("He'll finish this in his own browser", "Let him know", "Ask him to open SJC OS") have the same problem once the owner name is configured, which the plan explicitly supports.

**Replace with the name or a neutral form** (the exact copy changes once, in every table/frame/test that repeats it):
- **"Pause Abigail's agent? Abigail will need to tap Continue. [Pause agent] [Cancel]"**
- **"Abigail left the browser. Nothing more will come until Abigail opens it again."** Also change the absent-initiator line to "…until Abigail opens it again."
- **"Abigail asked you to finish: Apply for Larson permit · city.example · Larson bath. Abigail's answers come with it."**
- **"…City permit office: not supported yet — Joe signs in instead."**
- **"Sent to Joe. Joe will finish this in a separate browser. [Close browser]"**
- **"…Let Joe know before you start."**
- **"Couldn't alert Joe on Telegram. Ask Joe to open SJC OS."**

Add to §1 Words or the token rules: **"Copy names people; never he/she/her/his for a staff or owner name."** Add a copy-lint case to `browser-ui`.

## Optional

- **Strip label width (shared with Canvas round-5 optional 1).** "Browser•" is about 66–72 px at `text-label` with `px-2.5`. Ask the host owner to make the vertical selector `w-max min-w-16`, `px-2` and drop `overflow-x-auto`, so no label clips at 800 × 360.
- **Short landscape always single view (Canvas round-5 optional 2).** A ~915 × 412 Android landscape could measure ≥840 next to the strip and split. That would leave Browser's right column with roughly a 350 px stage beside Chat. The host should say short-landscape sheet = single view.
- **Staff status row overflow at 360.** "Browser · You're in control · Joe is watching ›" can exceed one line. Say the row is `min-h-11` and wraps to two lines, or that "Joe is watching." takes the place of the chevron hint. Never truncate the watching notice.
- **Silent Telegram while Joe already watches** (carried from round 4): send the in-place page-4 replacement with `disable_notification` while Joe's owner layer for that task is visible.
- **Native hand-off buttons.** In the native app, Don't finish and Open in Safari both just open Safari. Consider showing only **[Open in Safari] [Close]** there, with "Open in Safari to tell Abigail or finish on your iPad."
- **Host H5 / Canvas appendix hash.** These still say Browser adopted the host at `89b1bd6e`. Ask the host owner to record `85a7a5c6`.
