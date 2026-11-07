# Browser Phase 1 R3 — UI handoff

UI implementation only, on `t3/browser-phase1`. Find this slice's commit with
`git log -1 --format=%H -- docs/plans/build/browser-phase1-R3-UI-HANDOFF.md`.
No push, subagents, dependency installation, Next commands, browsers, live DB or
service operations. Other builder changes were left alone. The Canvas history
regression used only the tagged disposable harness cluster
`browser-p1-r3ui-1107u`, with DATABASE_URL/SJC_TEST_DATABASE_URL unset; stopped
through `node scripts/test-db.mjs stop` (reported `stopped`). No exit 137/Killed.

Read AGENTS.md, both R3 reviews (engineering F1), plan §6.3/§6.5, R2 UI handoff,
and the installed Next use-client guide. Re-read the TOP of
`browser-phase1-R3-SERVER-HANDOFF.md` before finishing; its two integration
contracts below are wired. No screenshot or real-device acceptance is claimed.

## Item → change → test

UI = `tests/browser-ui.test.mjs`; Owner =
`tests/browser-owner-review.test.mjs`. New R3 rendered/hook expectations were
added before the corresponding renderer/session changes. Initial runs reproduced
11 UI failures (164 passing) and 3 Owner failures (14 passing). Server-contract
expectations then reproduced 2 failures before device/job-access wiring. Stronger
read-expiry and reconnect assertions also failed before their fixes. Additional
integration coverage was added afterward; the real picker test mocks the server
action boundary, while executing the real JobPicker and BrowserJobField.

| Item | Change | Regression |
|---|---|---|
| ENG 1 | Presentation identity is read through a ref, so identity changes do not restart the join effect. A mounted lease shares its initial join promise through StrictMode effect cleanup/setup; actual departure retires attendance once, including late replies. Retry retains device UUID and failed initial request key; reconnect retains viewer/device credentials. | UI `R3 ENG1 mount joins once…`, `reconnect preserves…`, `superseded task late reply…`, `a failed initial join…`, `owner attendance renews…`, `actual join adapter…`. Real hook, replay before/after reply, late superseded reply after new task acceptance, and real fetch body assertions. |
| Design 1 | Meta/title BrowserView roots have no h-full. Content/actions/all keep their height contract. Owner phone/iPad meta no longer consumes the flex column, leaving the image and private-audit wait visible. | Owner `R3 1 Watch portrait meta…`: 360/820, public/private states, aspect/shrink/height classes and pending text; title/meta/content/actions/all roots checked. Pixel height requires recapture. |
| Design 2 | Actions slot returns null under any dialog; all-slot omits its action row too, including media controls and landscape actions. | UI `R3 2 dialogs suppress…` covers all 9 dialogs in portrait/landscape. Owner `R3 2 owner dialogs…` covers 360/820/1280 and landscape, with exactly one decision button. |
| Design 3 | Expired-address text and candidate lists only render for read/file cards. Accepted non-read detail clears expiry and loaded candidates, and invalidates their pending request when clearing. Final/write cards cannot inherit read-card text/URLs. | UI `R3 3 only read and file cards…`, `accepted transition…` includes the expiry timer after the transition. |
| Design 4 | Projects-access identity controls the chooser. JobPicker receives the SERVER projects-only search; no Projects access shows plain No job without button/chevron. | UI `R3 4 no Projects access…`; `real JobPicker uses Browser projects search…` opens the real picker, searches, renders Maple Ave kitchen and resolves its selected slug to a project ID. |
| Design 5 | Menu Review page addresses calls review_addresses, opening the address list or pending read/file decision. | UI `R3 5 menu address button…` clicks the real rendered button handler, runs the real session action and checks the named address dialog. |
| Design 6 | Empty Sites hides approved-page heading/list/review button. Field order is purpose, Job, sites, Page address, approved-page list/review button. | UI `R3 6 Sites hides empty…`, existing exact Sites-copy tests. |
| Design 7 | SERVER owns shortening task labels at a word boundary. UI keeps consuming task_label and wrapping it. No lib edit by this slice. | Existing R2 In use label/fallback tests remain green; SERVER owns new truncation coverage. |
| Design 8 | Queue ready/expired labels are explicit in the accepted snapshot; expired states need attention while retaining their specific row words. Failed row reads Stopped. | UI `R3 8 queue snapshot…`, `actual chat status row…` renders the actual BrowserStatusRow. |
| Design 9 | Meta is an array of present parts joined with spaced dots. Review cards omit window count. | UI `R3 9 meta joins…`: lone watching/windows, ordered full line and review suppression. |
| Design 10 | Owner header has gap-2 and a separate min-w-0 wrapping title, without the leading dot in the title span. | Owner `R3 10 owner header…` at 360/820/1280. |
| Design 11 | Answer hint requires an offered take_over control, visible page/control context and non-phone layout. No hint before Show the page or while audit is pending. | UI `R3 11 answers only suggest…`; existing owner/plain-answer and phone tests. |
| Design 12 | Existing exact dialog/button/status names are reachable through real actions. Reconnected paused-task copy now survives detail/SSE updates until explicit control; public Resume and private Take over again remain distinct. | UI `R3 12 recapture paths…`, `owner Pause confirm…`, `Earlier view and reconnect…`; existing owner audit/privacy, resource expiry, queue, keyboard and host leave tests. The coordinator must supply attended/authorized fixtures and click paths below. |

## SERVER contracts and limits

- `searchBrowserProjectsAction` from `@/lib/actions/browser-projects` is passed
  as JobPicker's search through a stable lazy callback. It returns
  `AskResult<{jobs:{kind:'project';slug:string;name:string}[]}>`. Its permission
  and project-only query are SERVER-owned. Browser identity also checks current
  Projects access before offering a chooser; project selection resolves through
  the existing authenticated browserProject action. Existing task jobs remain
  read-only because Sites does not accept project_id.
- Every join carries the hook-local `device_id: UUID`: initial, retry, owner
  renewal, Show the page, and create/adoption. Different hook mounts get distinct
  UUIDs. One initial failed/in-flight join keeps its request key; a successful
  rejoin uses the current viewer/device credential and a fresh request key.
  No viewer/control credential is persisted. Identity updates do not leave/join.
  Genuine lifecycle cleanup waits for its initial join promise and leaves once;
  StrictMode replay cancels that cleanup before its microtask executes.
- The reconnect label is presentation only. It applies to accepted paused own
  tasks; active/terminal updates remain authoritative. It does not resume a task,
  grant control or bypass the private-page fence.
- Pending private owner audit keeps the image hidden. The rendered integration
  supplies an authorized server result before asserting the private image; it
  does not claim the installed QA controller can authorize that fixture.

## Validation

Requested files ran one at a time, all **386 passed, 0 failed, 0 skipped**.

| File | Pass | Fail / skip |
|---|---:|---:|
| browser-ui.test.mjs | 185 | 0 / 0 |
| browser-owner-review.test.mjs | 17 | 0 / 0 |
| panel-content-pane.test.mjs | 41 | 0 / 0 |
| canvas-ui.test.mjs | 60 | 0 / 0 |
| canvas-floor-adapter.test.mjs | 30 | 0 / 0 |
| canvas-integration.test.mjs | 33 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |

Copy lint: Owner C26 renders runtime staff/owner name combinations and every
Browser state, including pending/authorized/private states; **passed**.
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: initial and final
checks **exit 0**, empty diagnostics. Owned `git diff --check`: **exit 0**.
No app server, Next build or browser was started. SERVER/QA is responsible for
its real website/SQL concurrency, projection, isolation and private-audit checks.

## Coordinator recapture targets — exact names and setup

Scope visible controls to `[data-browser-ui]`; use role + exact accessible name.
Resolve the named dialog first where a button shares a name with its opener.
The examples use seeded Abigail/Taylor; substitute the actual runtime names.
Use 320/360/820/1180/1280 and 800×360, plus /today 420 dock and 360/820 sheet.
Measure real portrait image height >0 (16:10 of available width), pending text
visibility, 360 header wrapping, short-landscape stage >=200 px, touch targets,
keyboard/focus return and no active action row outside dialogs.

| Re-shoot | Exact selector names / prerequisite |
|---|---|
| B4 Watch phone/iPad public and controlling | Button `Watch`, then section `Abigail's browser`; image group `Website view`; public image name `Live view of city.example. Agent is working.`. Staff must remain attending. Check 360/820 image height >0. |
| B2 leave confirm | While actually controlling, click button `‹ Chat` on narrow host or `Close browser` on desktop pane (working host × remains `Close Operator`). Dialog `Pause browser and return to Chat?`; buttons `Pause and return`, `Keep browser open`. App exit uses `Pause browser and return to app?`; Canvas switch uses `Pause browser and return to Canvas?`. |
| B4 Pause confirm + success | Keep a staff viewer attending and agent active; click `Pause agent`. Dialog `Pause Abigail's agent? Abigail will need to tap Continue.`; inside it click `Pause agent`. Exact success text `Agent paused. Abigail can tap Continue.` only after ACK. |
| B4 replace / watching | Staff takes control first. Owner shows `You're watching. Abigail is in control.` only after private authorization. Button `Take over from Abigail`; dialog `Take over from Abigail? Their control ends.`; dialog buttons `Take over`, `Cancel`. Tablet/computer only. |
| B4 Show the page → pending → private image | Button `Show the page`; exact pending text `Waiting to show the private page…`; no image while pending. Complete the trusted private-view audit before expecting image group `Website view`, exact label `Private — only you and Abigail see this page.` and image name `Live view of city.example. You're watching. Abigail is in control.`. The permanently pending fixture alone cannot reach authorized pixels. |
| A loading with previous frame | Retain a frame while loading. Exact text `Earlier view`; image name `Live view of city.example. Loading city.example….` (existing name appends a period after the ellipsis). |
| Disconnect/reconnect public and private | Exact text `Connection lost. Browser paused.`; button `Reconnect`; accepted paused task text `Connected. Review the page before continuing.`. Public button `Resume`; private button `Take over again`, no Resume. Do not seed an active task and expect paused recovery. |
| Couldn't pause | Fail the leave pause ACK. Exact text `Couldn't pause the browser. Keep this screen open, or stop the browser.`; buttons `Try again`, `Stop browser`. |
| Compact keyboard | Tablet/computer after confirmed control: button `Keyboard`; textarea name `Keyboard for website`; `[data-browser-compact-capture="true"]`, button `Done`, answer button `Address ▸`, then `Type it` (seeded answer). Compact portrait answer row has `aria-label="Your answers"`; landscape has summary `Answers`. No phone control. |
| B3 Sites / job picker | Exact button `Open browser` inside Browser scope; dialog `This task can use these sites.`; field `What should the agent read?`; button `Choose job`; nested dialog `Choose Browser job`; input `Search projects…`; button `Maple Ave kitchen`. Without Projects: exact `No job`, no chooser or chevron. Empty Sites has no Review page addresses button. |
| B1 menu review / reload | Button `Browser options`; dialog `Browser options`; button `Review page addresses` opens dialog `Review page addresses` or read/file card, never Sites. `Reload` opens dialog `Reload this page?`; buttons `Reload`, `Cancel`. |
| Fresh confirmation | Button `Open a fresh browser`; dialog `Starts a new browser for this task on the same sites. Pages you signed in to will need signing in again.`; inside it `Open a fresh browser`, `Cancel`. Underlying action row is absent. |
| Queue / offer / expiry (owner + staff) | Text `Browser is ready. Open within 30 seconds.` → button `Open browser`; `You missed your turn.` / `You left the line after 5 minutes.` → `Get back in line`. Chat labels `Browser · Browser is ready.`, `Browser · You missed your turn.`, `Browser · You left the line.`. Owner queue names current person; staff queue stays anonymous. |
| Resource expiry / blocked cards | Heading `This page needs these files`; wait through actual server deadline, then exact `These page addresses need a fresh review before they can be allowed.` with disabled `Allow these files once`. Final text `This version stops here. Nothing was submitted.` and `Close` only; no address expiry/candidate list on write/final cards. |
| B5 /today 820 sheet | Click `Operator` to open the host before selecting tab `Browser`; don't capture the resting page as an open sheet. Keep owner/staff attendance alive through captures. |
