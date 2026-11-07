# Browser Phase 1 R4 — UI handoff

Implementation sub-agent on `t3/browser-phase1`; no subagents and no push.
Find this slice's commit with `git log -1 --format=%H --
docs/plans/build/browser-phase1-R4-UI-HANDOFF.md`.
The parallel QA commit `b45fe1fa` was left untouched and is the parent of this
slice. No edits to lib, routes, migrations, deploy, scripts or QA files.

Read AGENTS.md, both R4 reviews, R3 UI handoff, R3 SERVER integration contracts,
plan §6.5 (including Empty sites), and the installed Next use-client guide.
No Next commands, app servers, browsers, live database or service operations.
Only tagged disposable SQL harnesses ran; both were stopped. No exit 137/Killed.

## Item → change → test

UI = `tests/browser-ui.test.mjs`; Owner =
`tests/browser-owner-review.test.mjs`; Pane =
`tests/panel-content-pane.test.mjs`.

| Item | Change | Regression |
|---|---|---|
| ENG REQUIRED 1: cleanup after a returning lifecycle | Hook-local leases are retained per task/conversation/role/local-thread/auth-signal binding. Each effect lifecycle receives a distinct ownership token. Cleanup waits for its acquisition, then checks that token immediately before starting Leave. A return transfers ownership and shares the pending/successful lease, so an old cleanup cannot leave the current viewer. | UI `R4 cleanup during committed join` covers active off/on, task empty/return, A/B/A and two quick returns. Asserts one A acquisition, no stale A Leave/pause, renewable current attendance, and exactly one Leave on genuine departure. Existing R3 StrictMode, delayed identity, genuine unmount, independent-device and superseded-task tests remain green. |
| ENG REQUIRED 1: Leave already sent | Once Leave starts, its promise becomes an acquisition barrier. After its ACK, credentials are discarded and the request key advances before reacquisition. A different binding for the same task also waits for its predecessor's drain instead of reusing credentials across scopes. An uncertain Leave failure blocks replacement acquisition; reconnect can retry the retirement. | UI `R4 already-sent Leave drains...` holds Leave ACK across two quick returns; no replacement join before ACK, fresh viewer afterward, same device UUID, no retired credential reuse. `R4 same task with a changed host scope...` checks the cross-binding barrier. |
| ENG REQUIRED 1: retry and other joins | Failed/lost initial replies retain the request key and device UUID. Owner-claim renewals and Show the page acquisitions also belong to the lease's pending promise, so cleanup drains them. Viewer/control credentials remain in memory. | UI `R4 lost committed join reply...`, existing R3 retry/owner-renewal/explicit-device-adapter tests; existing R1 private-audit stream tests use realistic join stream fields. |
| ENG REQUIRED 1: real website/SQL | The actual hook and browserAPI run through actual HTTP request validation, website adapter, non-superuser `sjcos_test_website` LOGIN connections, session checks, and guarded SQL. Only response delivery and the controller boundary are fixtures. | UI `R4 real website/SQL retirement orderings...`: five subtests for active off/on, task empty/return, A/B/A, delayed Leave ACK with repeated returns, and a committed join reply lost before retry. Another attended device is present. Accepted viewer has null left_at, unchanged accepted stream identity/generation, presence HTTP 200, and task active with null pause actor. A/B/A uses owner Watch across two real staff tasks, respecting the one-live-task-per-person and one-owner-review-viewer limits. |
| Events 503 | SSE requires an accepted viewer with a nonempty stream ID and positive integer generation, an active/paused task, enabled detail, frame-gate readiness and existing private-watch authorization. Queue metadata/presence polling continues; reaching an active session enables SSE. | UI `R4 no SSE before a joined session` covers queued, offer, both expiries, off, starting, closed and failed. Missing binding also refuses SSE. `R4 queue polling starts SSE...` verifies the positive transition. Existing public/private stream, rotation and navigation tests remain green. |
| Dialog title controls | Hide ⋯ and compact Done under any dialog. Suppress the compact-capture layout marker while a dialog is open, preventing its fixed empty action row from surviving. | UI `R4 dialog options are inert...` checks all nine dialogs with compact capture enabled. |
| Empty strip | BrowserPane returns null for the actions slot under dialogs, including its wrapper. The shared shell hides an empty Browser actions container and removes its landscape column; Canvas keeps its row contract. Owner landscape dialogs omit their action column too. | Pane `R4 Browser shell collapses...` renders the actual BrowserPane in the shared shell for portrait/landscape, verifies empty markup and scoped collapse rules, and checks Canvas. Owner `R4 owner landscape dialog...`; existing Canvas regression files. CSS/pixel dimensions still require coordinator recapture. |
| Keyboard prompt | Add the visible placeholder `Type here to send keys to the page.` | UI `R4 dialog options are inert...`; existing keyboard/input/IME/capture tests. |
| Paused-private duplicate | Hide the redundant private label in paused_private; keep the exact planned paused status. | UI `R4 dialog options are inert...` and existing paused-private/reconnect/owner copy cases. |
| Empty Sites heading | Without sites or a task, use the plan's `Add at least one site to start.` as dialog name/heading and remove its duplicate paragraph. Keep `This task can use these sites.` with sites or an existing task. | UI `R4 dialog options are inert...`, R3 Sites order/empty-list tests. |

The first 16 new UI expectations ran before the implementation and reproduced
16 failures with all 185 existing tests passing. Separate scope, host-collapse,
owner-landscape and compact-dialog expectations also failed before their fixes.
The real website/SQL coverage was added after the initial deterministic fix.
No expectation was weakened to permit retirement of the accepted viewer.
The SQL fixture respects production task, pilot and viewer constraints; the
second attended initiator keeps the task active during genuine departure too.
No auto-resume, wider viewer limit or server authorization bypass was added.

## Events-503 root cause and server boundary

The old stream effect treated successful attendance join as proof that a
controller session existed. A queued task can return viewer/stream identifiers
without having a controller session. It then requested
`GET /api/agent-browser/sessions/:task/events` and replaced valid queue copy
with the resulting connection failure.

Read-only server trace: `lib/browser/web.ts:194`–199 builds the stream binding
and calls `rpc('stream_open', ...)`; `lib/browser/web.ts:85` explicitly throws
BROWSER_SERVICE_UNAVAILABLE when `controller_boot_id` is absent. Separately,
`lib/browser/web-transport.mjs:100` rejects disabled flags with BROWSER_DISABLED
(503) before dispatch. These server refusals remain correct and unchanged.
The UI now avoids opening SSE for queue/offer/expired/off and other non-session
states even if attendance identifiers exist; absence of join stream identifiers
also prevents subscription. Existing private audit gating remains mandatory.

A request already in flight when access/readiness changes can still fail
normally. This change does not assert controller readiness beyond the public
active/paused session projection or turn a queue into a streamable session.

## Validation

Ran individual files sequentially: **412 passed, 0 failed, 0 skipped**.

| File | Pass | Fail / skip |
|---|---:|---:|
| browser-ui.test.mjs | 209 | 0 / 0 |
| browser-owner-review.test.mjs | 18 | 0 / 0 |
| panel-content-pane.test.mjs | 42 | 0 / 0 |
| canvas-ui.test.mjs | 60 | 0 / 0 |
| canvas-floor-adapter.test.mjs | 30 | 0 / 0 |
| canvas-integration.test.mjs | 33 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |

Copy lint: Owner C26 renders all Browser states and runtime name combinations,
including private audit states; **passed**. Existing exact §6.5 wording remains;
no optional own-pause copy rewrite or other state-copy rewrite was made.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**, no
diagnostics. Owned `git diff --check`: **exit 0**.
Browser SQL uses the process-specific `browser-p1-r4-ui-<pid>` tag; Canvas
history uses `browser-p1-r4-ui-canvas-history`. Both disposable clusters stopped.
No production database URL is needed; final DB-bearing test commands unset
DATABASE_URL/SJC_TEST_DATABASE_URL.

## Coordinator recapture / limits

No screenshots or real-device acceptance claimed. Recheck dialog bottom strips
and full-width landscape dialogs, compact keyboard → dialog transitions, Sites
heading, keyboard prompt, paused-private duplication, and queue/offer/expired
after the SSE gate. Reproduce close/reopen and route-return with delayed join
reply and delayed Leave ACK; record task/viewer IDs, stream generation, left_at,
current lifecycle and pause actor. The SQL regression proves the replacement
attendance remains renewable; pixels and device behavior remain coordinator work.

An unacknowledged/failed Leave deliberately keeps reacquisition blocked rather
than accepting a viewer which a remote cleanup might still retire. A lost
committed Leave ACK can require authoritative recovery if a retry cannot be
acknowledged. A join whose reply is permanently lost on genuine final unmount
has no returned credentials to leave; normal server attendance expiry remains
its fence. Retrying that acquisition in the mounted hook retains its request
key, and the regressions cover the committed-reply recovery path.
