SCORES: design=6 completeness=4

# Browser Phase 1 — build round 2, DESIGN judge

Reviewed at HEAD `ab46a364` (t3/browser-phase1). Evidence: all 384 shots in
`/home/joe/qa-sjcos/browser-p1/shots/r1/`, `log.json`, the shooter
`/home/joe/qa-sjcos/browser-p1/shoot-p1.mjs`, plan §1/§5.2/§6.2/§6.3/§6.5/§7/§8.1/§12 Phase 1,
the context file, C/C2/R1-UI handoffs, and `components/panel/Browser*.tsx`,
`components/panel/browser/*`, `components/panel/PanelDock.tsx`,
`components/panel/BrowserSettings.tsx`. QA artifacts ignored as instructed: repeated chat
message, staff 503 on `/canvases`.

## How much of the state list the shots actually show

The shooter never clicks anything. It reseeds a server state, opens the URL, and takes a
picture. Many state names therefore show some other state. I hashed the same-width files
to check (360 px, where the timer in the chat column can't change the hash):

| Group of byte-identical owner 360 shots | What they all actually show |
|---|---|
| working, controlling, taking_over, done, leave_confirm, paused, public_watch, in_use | "Browser is paused." + Continue |
| takeover_confirm, disconnected, pause_failed, reconnected, sites_added | "Agent is working" (no dialog) |
| fresh_confirm, owner_watch_before/after, paused_private, watch_audit_pending | persistent private Paused state |
| resource_review, resource_20?, resource_21, resource_expired | one file, enabled (20/21/expired not distinguished) |
| ownerwatch: owner_watch_before = owner_watch_after = watch_audit_pending = paused_private | "Abigail took over…" before Show the page |
| queued (owner + staff) | "Couldn't connect to the browser." (events 503) |
| offer_expired-owner | "Your access changed. Browser stopped." (403) |
| queue_expired-staff | the offer state |
| sites_empty, guarded_menu, reload_confirm, starting(1280), loading | the empty state or plain paused/working; no sheet, menu, dialog, "Earlier view" |

So none of these were ever rendered and judged: Sites review, take-over confirm (owner with
Don't ask again / staff without), You're in control + 56 px toolbar + Keyboard row, Finishing
the last step, Done prompt, fresh confirm, leave confirm, Pause agent confirm, replace-staff
confirm, ⋯ menu, reload warning, Loading + Earlier view, queued (both), queue/offer expired,
connection lost / reconnected / couldn't pause, the "after Show the page" private image with
"Private — only you and Abigail see this page.", "Waiting to show the private page…",
"You're watching. Abigail is in control.", and staff "Taylor is watching." (the owner never
watched during a staff capture). The owner layer has **no 800×360 shots** (`ownerwatch` used
ALL_WIDTHS without `EXTRA`). The plan's Phase 1 acceptance names that fixture explicitly. Every own-task shot is the
`/panel` pop-out; the 420 dock and the 360/820 `/today` sheet were never captured. Staff
`settings-staff-*` loaded `/panel`, not `/settings/browser`.

Also, `smallTargets` counts every element on the page, including the inert `/today`
under the owner layer and the chat column. Those counts can't tell whether a Browser target
is too small.

## Verified good

- **§6.5 copy matches exactly** in the states that did render: No task, Starting "Opening
  browser…", Admission offer [Open browser][Leave line], Queue full, Idle warning "Browser
  closes in 53 seconds. [Keep open]", Idle close [Open again], Crash [Open again], Resource
  cap [Close], Auth expired [Sign in], Access removed [Close], Service unavailable [Try
  again][Close], Agent turn finished [Continue][Stop browser], Attendance lost
  [Continue], Unknown result (no retry), Other device "You're in control on your other
  device." (phone hides Take over here), Joe paused (staff) "Taylor paused the agent.
  [Continue]", Phase 1 final card "This version stops here. Nothing was submitted." with
  **only [Close]** (final_blocked-*-w360/w1280/land800), and Phase 1 write. The phone
  variant "This version reads public pages only. Sending information isn't available
  yet. [Close]" is exact (write_blocked-owner-w360). Read review "Read this page?
  [Read once] [Don't open]" and "This page needs these files [Allow these files once]
  [Keep blocked]" are exact.
- **Public-page take-over rest state** (paused_private-owner-w360/w1280): "Paused. The agent
  can't read this page." + "Private — you took over. The agent can't see this page." +
  [Take over again] [Open a fresh browser] [Stop browser]. No Continue and no resting Keep paused. On a phone the
  exact §6.2 instruction replaces Take over again.
- **Device rule is right.** The 360/320/800×360 phones never show Take over and show the exact
  instruction "Take over on a tablet or computer. Open SJC OS on your iPad or computer, then
  Operator › Browser." In landscape the right column carries only the first sentence. 820 iPad portrait keeps
  Take over (working-owner-w820).
- **Owner Watch, private, before Show the page** (owner_watch_before-ownerwatch-*): no image,
  "Abigail took over. The agent can't see this page." + 48 px [Show the page]. No staff
  transcript or Operator selector in the owner layer. Header "‹ Back · Abigail's browser".
- **Staff vs owner basics:** staff empty state has no In use list (empty-staff-w360). The
  settings route is `requireRole('owner')` (`app/(os)/settings/browser/page.tsx`). The owner
  Don't ask again checkbox only renders for `isOwner` (`BrowserView.tsx:65`). No staff shot shows any
  owner-only control.
- **Copy lint:** no gendered pronouns in any Browser template ("Their control ends." is
  neutral). Names are substituted from runtime labels (Taylor/Abigail).
- **Buttons** are 48 px tall (`min-h-12`), with 56 px for Take over, and every visible
  Browser button in the rendered shots is ≥44 px. Landscape keeps every action
  reachable in the right column (working-owner-land800, read_review-staff-land800).

## REQUIRED fixes

1. **The pane and the status row disagree about whether the agent is running.**
   takeover_confirm-owner-w1280: the status row says "Browser · active ›", the chat says
   "Claude is working · 23s", and the pane says "Browser is paused." with [Continue]. working-*-w360 and
   controlling-*-w360 render "Browser is paused." too. This is the coordinator's smoke
   symptom. It is not only reseeding: the hook takes its state from `state_reason` /
   task detail (`useBrowserSession.ts` `apply` → `browser/session.ts:34`), while the row takes
   the registry snapshot. Derive both from the same task revision. Then re-shoot
   working/controlling/taking_over so that "Agent is working" (no Continue) and "You're in
   control. The agent is paused." [Done] [Stop browser] actually appear.

2. **Raw status words in the chat status row.** "Browser · paused ›" / "Browser · active ›"
   (working-owner-w1280, takeover_confirm-owner-w1280). `BrowserPane.tsx:63` prints
   `task.status`. Map it: `active`→"Agent is working", `paused`→"Paused",
   `queued`→"Browser is busy.", `starting`→"Opening browser…", `failed`→"Browser stopped.". Hide the
   row for `closed` (§6.3: the row disappears after "Browser closed."). Keep
   "Browser · Needs you" for attention.

3. **Raw task kind on screen.** In use rows read "Taylor · public_research · Agent is
   working [Watch]" (empty-owner-w360, sites_empty-owner-w1280, empty-owner-land800).
   `BrowserView.tsx:81`. Render the plan's form **"Abigail · {task label} — {job} · Agent is
   working [Watch]"**. Use the task's purpose/title when there is one. Otherwise map
   `public_research`→"Public pages". Never print a `task_kind` value. Also, the owner's own
   task appears in the owner's own In use list with [Watch]. Show it as "You · … [Show
   browser]" (select own pane), or leave it out. Watching yourself through the owner layer is
   confusing.

4. **The same sentence appears two or three times in one pane.** Whenever no image shows,
   the status is printed in the meta row (`BrowserView.tsx:72`), again as the h3
   (`:78`), and a third time as the `role=alert` error (`:94`). Examples:
   auth_expired/access_removed/closed/service_unavailable/queued-*-w360 (3×),
   final_blocked/crashed/latched/idle_closed/offer/empty-*-w360 (2×), and
   owner_watch_before-ownerwatch-w1280 (3×: meta, left column, right pane). Fix: when the h3
   is shown, render the meta row without the status text (keep only "· N windows" / "Taylor
   is watching."), or drop the h3 and give the meta row the `text-heading` size. Skip the alert when
   `m.error===status`. In the owner split, show the status once (see 6).

5. **Owner Watch shows "Taylor is watching." about Taylor.** Every ownerwatch shot ("Browser
   is paused. · Taylor is watching."). The indicator is for staff only (§6.5 "Staff, owner
   viewer present"). At `BrowserView.tsx:72` change to
   `m.watchingOwner&&!m.ownerView&&…`.

6. **Invented copy in the owner split.** "Watch the page. The agent stays with this task."
   (working/paused/owner_paused-ownerwatch-w1280; `BrowserOwnerLayer.tsx:18`). This copy is
   not in the plan, and on paused/private pages it is wrong. Replace it with the trusted state line in
   `text-heading`: `browserStatus(m)` (e.g. "Agent is working", "Agent paused. Abigail can
   tap Continue."). Put the owner actions directly under it, and remove the separate meta-row
   status in the owner layer.

7. **Wrong owner copy after Joe pauses staff.** owner_paused-ownerwatch-w1280 shows
   "Taylor paused the agent." to Taylor. §6.5 says Joe sees **"Agent paused. Abigail can tap
   Continue."** In `browser/model.ts:15`, return
   `` `Agent paused. ${m.personName} can tap Continue.` `` when `m.ownerView` (keep
   `` `${m.ownerName} paused the agent.` `` for staff).

8. **[Pause agent] is offered when there is no running agent to pause.** It appears when
   the browser is paused (paused-ownerwatch-*), Abigail took over
   (owner_watch_before-ownerwatch-*, where "the agent is paused" is already true), and right after Joe paused it
   (owner_paused-ownerwatch-w1280). `BrowserView.tsx:49`: render Pause agent only when
   the agent is live (`state==='working'||state==='loading'`) **and** `pause` is in
   `availableControls`.

9. **The owner layer never names the site.** Joe watches "Abigail's browser" with no
   trusted origin anywhere (all ownerwatch shots; the title slot is not rendered in
   `BrowserOwnerLayer.tsx:16–18`). Put the trusted origin in the owner meta row, for
   example "city.example · Agent is working". The label must never come from the page (§1, §6.3).

10. **"Your answers" in Joe's Watch view are Abigail's.** ownerwatch shots list "Your
    answers · Project address … · From chat" with a disabled Type it.
    `BrowserView.tsx:92`: in `ownerView` use the heading **"{personName}'s answers"**, and
    show Type it only while Joe has control.

11. **Disabled "Type it" with no reason, and answers in states where they don't belong.**
    Every own and owner shot shows a disabled Type it (phone: it can never be enabled).
    §6.5 says "Disabled controls have visible explanation." Fix at `BrowserView.tsx:92`:
    render Type it only when `controlled`. Otherwise show the answers as a plain list (on
    desktop add the line "Take over to type these."). Hide the whole answers block when the
    state is in `blankBrowserStates` or the review states. It currently sits under "This
    version stops here. Nothing was submitted." (final_blocked-owner-w360/w1280/land800:
    the plan says the card is that sentence and [Close] "only"), under "Your access
    changed. Browser stopped." (access_removed-owner-w360), queue full, crashed, closed and
    idle closed.

12. **Media controls and the phone instruction show with no image.**
    service_unavailable-owner-w360 and queued-*-w360 show [Zoom] [Pause live view] and the
    phone take-over instruction under "Couldn't connect to the browser.".
    pre_frame_close-owner-w360 shows Zoom/Pause live view before the first frame. Add
    `'service_unavailable'` to `blankBrowserStates` (`browser/model.ts:6`). At
    `BrowserView.tsx:98` render Zoom/Pause live view only when `m.frameUrl` is set (keep
    Resume live view while `livePaused`).

13. **The action row clips at 320 px.** working-owner-w320 and
    paused/turn_ended/absent/owner_paused-*-w320/w360: the "Continue" and "Zoom" text overflows
    its button, and "Pause live view" is cut off at the right edge (the row scrolls
    sideways). `BrowserView.tsx:96`: in portrait use `flex-wrap` (or a 2-column grid when
    `m.width<400`) instead of `overflow-auto`, and let labels wrap inside the button.

14. **State sentences are cut off on phones.** The meta row is `truncate`
    (`BrowserView.tsx:72`). When an image is showing, it is the only place the state
    appears, e.g. unknown-owner-w360 "The site may have received it. Check the site before
    trying ag…". The same happens to write_blocked/queue_full/latched/empty at 360, and owner
    private "Abigail took over. The agent can't see this …". Use `line-clamp-2` with full
    wrapping, not single-line truncation. The unknown-result sentence must be fully readable.

15. **Starting offers Take over / Stop browser, not Cancel.** §6.5: Starting →
    **Cancel**. starting-owner-w360 shows [Stop browser], and on desktop the default branch
    (`BrowserView.tsx:52`) would also show [Take over] while nothing is open yet. Add
    `if(m.state==='starting')return act('Cancel','stop');` before the default return.

16. **Phase 1 write card has an extra sentence.** write_blocked-owner-w1280 adds "Sending
    information isn't available in this version." under the exact §6.5 tablet/computer text
    (`BrowserView.tsx:82`). Delete that line. The card should be exactly "This version can only read pages. This
    button sends information to the site. [Take over] [Close]".

17. **Read review doesn't say who suggested the page.** §8.1: the "Read this page?" sheet
    shows the full URL **and who supplied it**. read_review-*/exact_path_review-* show only
    the URL. Under each URL at `BrowserView.tsx:80`, add "Suggested by the agent" or "You
    entered this", from the candidate's `source`. Resources over 20 currently just
    disable [Allow these files once] with no reason. The plan says to review "≤20 at a time".
    Page them in groups of 20, or show the visible reason "Too many files to review at
    once." beside the disabled button.

18. **"Review page addresses" is plain text that does nothing.** In the ⋯ menu
    (`BrowserView.tsx:58`) and the Sites sheet (`:63`) it is a `<p>`, and the reload dialog says
    "Review page addresses before reloading." In the plan it is a button,
    **[Review page addresses]**. In the menu, replace `<p>Review page addresses</p>{act('This
    task’s sites','sites')}` with `{act('Review page addresses','sites')}`. Do the same in the Sites sheet. In
    the reload dialog use "Reloading may clear what you've entered. Nothing will be sent."
    For error `BROWSER_READ_PROVENANCE_UNKNOWN` (`browser/model.ts` errorCopy), use "Read
    this page?" (the read-review state), not a bare instruction.

19. **Settings asks Joe to paste user IDs.** settings-owner-w1280: "Pilot user IDs /
    One user ID per line. Add the owner's ID too." over a textarea of UUIDs. That is not
    Joe's vocabulary, and Joe can't find these values anywhere in the app.
    `BrowserSettings.tsx:16`: replace it with **"Who can use Browser"** and one checkbox per
    active person by name (owner listed and ticked first). Save their ids. Delete the
    "user ID" help text.

20. **The attention dot is squashed into a bar at phone widths.** final_blocked-owner-w360,
    write_blocked-owner-w360: "Browser▮". `PanelDock.tsx:251`: add `shrink-0` to the dot
    span.

21. **Owner queue copy.** §3.3: Joe sees **"Browser is busy. Abigail is using it."** and the
    In use list. The model only has the staff-style "You're number N in line." Add an owner
    branch to `browserStatus` (`browser/model.ts:13`) that uses the trusted person label
    from In use. Staff keep the identity-free copy. (Not captured yet; queued-* rendered
    "Couldn't connect to the browser.")

22. **Private reconnect says "Take over" instead of "Take over again".** §6.5 Reconnected:
    private, no-adapter → "Take over again / Stop browser". `BrowserView.tsx:52`: label
    `m.privatePage&&['reconnected','absent','turn_ended','owner_paused'].includes(m.state)?'Take over again':…`.

23. **Letterboxing wastes the phone and iPad screen.** working-owner-w820 shows about 380 px of black
    above and below the page. working-owner-w360 shows about 200 px of black and pushes the answers and
    instruction below the fold. In landscape, idle_warning-owner-land800 shrinks the stage to
    about 160 px (below the ≥200 px §12 minimum) because the idle row and answers stack in the
    center column. In portrait (`BrowserView.tsx:83`), size the image box to the frame
    (`aspect-[16/10] w-full max-h-full`, top-aligned, not `flex-1`) so that the answers and
    instruction sit right under the image. In landscape, move the idle warning
    and [Keep open] into the right action column and collapse the answers behind one 44 px
    "Answers" toggle, so the stage keeps ≥200 px.

24. **Sites review lacks the Job field.** §6.3 Sites review shows Task and **Job [Larson bath ▾]
    (reuse JobPicker)**. The sheet at `BrowserView.tsx:63` has no job, and every In
    use row and owner header renders without "— Larson bath". Add the existing JobPicker,
    prefilled from the chat's job, and send it with the create request.

25. **Recapture with interactions (completeness).** Extend `shoot-p1.mjs` so that it
    clicks, and re-shoot owner + staff at w320/w360/w820/w1180/w1280/land800:
    - Sites review: empty, with a site added, Add-a-site inline errors, and Cancel.
    - Take-over confirm: owner with Don't ask again, staff without.
    - You're in control: Keyboard row, compact keyboard-open row, Done → "The agent can't
      read this page anymore." prompt, Keep paused, fresh confirm, and the leave confirm from
      ‹ Chat.
    - ⋯ menu (two windows), reload warning, Loading with "Earlier view", queued #2, both
      queue/offer expired states, disconnected/reconnected/pause_failed, and resources
      1/20/21/expired.
    - Owner layer: Show the page → pending audit ("Waiting to show the private page…") →
      authorized image with "Private — only you and Abigail see this page."; the Pause agent
      confirm, its failure and its success; the replace-staff confirm; "You're watching.
      Abigail is in control."; and all of these at **800×360**.
    - A staff capture taken **while the owner is joined**, so it shows "Taylor is watching.".
    - `/today` 420 dock and the 360/820 sheet, not only `/panel`.
    - Staff opening `/settings/browser` (expect a refusal, not settings).

    Also fix `smallTargets` so it counts only `[data-browser-state]`/owner-layer
    descendants.

## Optional

- Owner "Take over from Abigail" when the agent (not Abigail) is in control reads as if
  Abigail holds control. Plain "Take over" is clearer there. Keep "Take over from Abigail?
  Their control ends." for the replace confirm.
- Put [Show the page] directly under "Abigail took over…" instead of at the bottom of a
  tall empty column (owner_watch_before-ownerwatch-w1280).
- Owner meta/content rows touch the screen edge (x=0) at 360 and 1280. Add `px-3`.
- Page loading has no "Stop loading" action (§6.5); add it if a guarded server control exists.
- "Browser isn't available yet." never appears: with the flag off the Browser tab is simply
  hidden (off-owner-w360). That is acceptable ("no dead control"). Capture the copy on a
  deep link if one can reach it.
- Generic "Browser is paused." (no reason) is fine as a fallback, but the plan's word in the
  status vocabulary is "Paused".
