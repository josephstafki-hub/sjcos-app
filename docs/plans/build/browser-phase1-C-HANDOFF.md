# Browser Phase 1 C — UI / shared host handoff

This file ships in the C commit; identify its SHA with `git log -1 --format=%H -- docs/plans/build/browser-phase1-C-HANDOFF.md`. No push, dependency installation, runtime, browser, screenshot, DB, build, migration, service or deployment action was performed. Other builders' files were left untouched.

## Implementation map

| Component / state | Files |
|---|---|
| One identity lifetime independent of Canvas/Browser flags; thread/background/closed Operator revocation | `components/panel/askPaneHooks.ts`, `BrowserIdentity.tsx`, `PanelChat.tsx` |
| Atomic per-kind rows, per-kind cancellation (Canvas availability does not clear Browser attendance), stale claim rejection | `askPaneRegistry.ts`, `canvas/store.ts`, `canvas/useCanvasFeed.tsx` |
| Shared split / dock / sheet / landscape / popout; suspended underlying host during Watch | `AskContentPane.tsx`, `PanelDock.tsx`, `PanelHost.tsx`, `PanelWindow.tsx` |
| Pure rendered empty/off/unsupported, Sites, queue/full/expired/offer/missed, loading/working/fence, takeover confirmation, other-device, controlling, Done, persistent private rest, fresh confirmation, idle/disconnect/reconnect/absence/turn-ended/crash/latch/access/auth/closed/uncertain | `BrowserView.tsx`, `browser/model.ts` |
| Cookie/CSRF adapter, header-bound fetch SSE, frozen frame/input schemas, private controls, explicit read decisions/Close-only notices, human answers | `browser/api.ts`, `useBrowserSession.ts` |
| Stable screen-side/native device hint, independent of pane/keyboard/rotation; no device-derived authority | `browser/device.ts` |
| 44px compact capture row / local IME; Escape stops capture first; letterbox input; local Zoom/Pause live view; 48px actions and 56px takeover | `BrowserView.tsx`, `AskContentPane.tsx`, `BrowserPane.tsx` |
| Owner-only In use → Watch; separate owner claim/session; explicit private Show the page; no staff transcript; private consent reset on generation change; passive exit and confirmed Pause agent | `BrowserPane.tsx`, `BrowserOwnerLayer.tsx`, `useBrowserSession.ts`, `PanelHost.tsx`, `PanelWindow.tsx` |
| Own chat status row below existing header; explicit Open may create an owned Claude thread, not on preview | `PanelChat.tsx`, `useAgentChat.ts` |
| Owner settings, explicit pilot UUID list, own-confirm preference, later flags permanently disabled | `BrowserSettings.tsx`, `app/(os)/settings/browser/page.tsx` |

Private frame bytes, input, device secrets and control tokens stay in hook-local memory. No Browser private data was added to panelBus, panelStore, history, localStorage or registry snapshots. History carries task/review UUIDs only. The new `BrowserIdentity.tsx` server action checks the existing thread principal/ownership boundary; it confers no Browser authorization and works with Canvas disabled. `/today` mounts a null Suspense-wrapped BrowserRoute notifier for same-path Next query navigation; its existing PanelHost supplies the independent top layer. Owner Watch also works from the existing detached window through the same host hook.

Initial 27 new cases/expectations were written before renderer/device/API implementation (the initial owner test failed with the expected missing-module error). Three further cases exercise per-kind publication, actual shell rendering and the real adapter against fake fetch. Tests render actual TSX with React SSR, not screenshots or browser automation. They cannot attest actual CSS dimensions, Safari focus/IME, network privacy or live transport.

## The single route seam

All UI route knowledge is in `components/panel/browser/api.ts`; no client imports controller/Node/Playwright code or server `web.ts`. Wire `idempotency_key` is minted per explicit mutation; input is never replayed. All routes are prefixed `/api/agent-browser`.

| Function | B route |
|---|---|
| internal request CSRF | GET `/csrf` |
| availability | GET `/availability` |
| tasks | GET `/tasks?conversation_id=UUID` |
| inUse | GET `/in-use` (owner only) |
| create | POST `/tasks` (`task_kind: public_research`) |
| detail | GET `/tasks/UUID` |
| start | POST `/tasks/UUID/start` (explicit new Open / offer acceptance) |
| join / leave | POST `/tasks/UUID/join`, `/leave` |
| presence | POST `/sessions/UUID/presence` |
| control | POST `/sessions/UUID/control`; take_over/fresh_browser add B's optional `confirmed:true` extension only after explicit confirm (or owner-only own-confirm preference; barrier still mandatory) |
| sites | POST `/tasks/UUID/sites` |
| reads / decideRead | GET / POST `/tasks/UUID/reads` |
| answers / decideAnswers | GET / POST `/tasks/UUID/answers` |
| action / closeNotice | GET `/actions/UUID`, POST `/actions/UUID/decision` with **deny only** |
| input | POST `/sessions/UUID/private-input` with frozen ManualInput parsing |
| events | GET `/sessions/UUID/events`, fetch ReadableStream + viewer/device/claim headers; no EventSource or token queries |
| settings / saveSettings | GET / POST `/settings` |

The settings UI accepts short flag keys emitted by B and prefixed keys from the planning fixture. Viewer/device/claim headers are memory only. A retained review URL uses the joined owner viewer/claim when reading its immutable outcome. Public-read controls refuse empty/expired candidates and >20 resource candidates. Phase 1 final-blocked cards have exactly Close; no send/pay/submit/grant control exists.

## Requests for A/B — activation blockers / final integration work

These are deliberately not patched in another builder's files. Route/controller integration must be reconciled by the coordinator before exposure:

1. **Planned hidden-view stream close:** B's current SSE cancel/abort closes with `planned=false`; there is no client route to acknowledge planned close. Chat/Canvas switches must stop frames while retaining initiator attendance. Supply a reviewed acknowledgement path/header protocol (or keep a bounded authenticated presentation subscription without frames) and adapt only `api.ts`. Do not infer planning from an attacker-chosen unauthenticated query. The UI currently aborts hidden Browser streams; do not claim real attendance preservation until this seam is fixed.
2. **Control renewal:** presence currently renews viewer presence; A's SQL must also renew the current task's exclusive control expiry under viewer/device/epoch checks. Return an authoritative control expiry so the UI can extend its in-memory token deadline after successful 5s heartbeat. The current UI conservatively expires local control after the supplied deadline; it never silently resumes the agent. Do not fix this by extending tokens locally without server proof.
3. **Read candidates:** B's current `reads_get` returns `candidates:[]`. Return the pending D-validated public/resource proposal and original expiry/revision so the rendered Read once / Don't open and Allow these files once / Keep blocked decisions can operate. Unknown/empty proposals stay disabled. Origin consent must stay separate. Add-site must not implicitly approve new exact paths.
4. **State/copy provenance:** frozen TaskUI/state events cannot distinguish queue expiry, idle-close, turn-ended, owner pause, other-device versus owner controller, window count, or retained uncertain outcome from generic paused/closed. Supply a bounded safe reason projection (not page strings), authoritative deadlines and controller provenance. Renderer states exist; do not invent those reasons from timers or generic failure. `browser/model.ts` includes owner_paused copy but does not infer it from generic pause.
5. **Owner label:** staff status requires the configured owner's name. Current contracts expose `watching_owner:boolean` but no owner display label; staff fallback remains Joe. Owner Watch obtains the initiating person's trusted name/project from owner-only In use and its own owner name from the authenticated identity action. Supply trusted owner label for staff; never derive pronouns.
6. **Available controls / private pause:** B's current private `available_controls` omits pause and public paused controls omit resume. Include only actually permitted pause/resume actions; the UI checks available_controls and never bypasses them. Owner Pause agent must be a fenced ACK, not a private agent resume. Expose durable closed/failed tasks safely without requiring a viewer join if terminal joins are refused.
7. **Guarded history/reload/window navigation:** the Phase 1 control enum has no back/forward/reload/window-switch operation. Menu entries are explicitly unavailable with Review page addresses; no generic click/CDP bridge was invented. Supply a reviewed exact-read navigation operation before enabling those controls. Public Page up/down likewise needs a proven read control; the UI does not relay unproven public input.
8. **New-task start/run attachment:** explicit Open creates/joins/requests start, then adopts the same viewer into the persistent hook (no temporary last-viewer leave). Confirm A/B attaches and launches the intended attended Claude Browser turn, and exposes FIFO offer status correctly. No undocumented agent-launch route was invented. Fresh-browser response must return new context_generation; current control response only has task/revision, so the next authoritative detail/state must synchronize it before first frame.
9. **Next navigation / notice following:** Initial canonical links, same-path Next queries, local Watch, Back and popout Watch are wired. Integration QA must verify client-side bell/permissions navigation to a new query on already-mounted `/today`, next-notice replacement/focus, immutable old-link outcomes and login-return. The owner host listens to local Watch, popstate, initial URL and the Today BrowserRoute notifier for same-path Next navigation. No Phase 3 notification dispatcher was added.

D's actual hostile-page privacy canary and runtime/network/SSE evidence remain mandatory before exposing any takeover. UI tests are not substitutes.

## Verification

Each test file was run separately; no full suite. No DB test was needed for the edited UI/store files; no test cluster was started. `canvas-provenance-db` only mentions PanelChat in a comment and does not import any edited file.

| Command | Pass | Fail / skip |
|---|---:|---:|
| `node --test tests/browser-ui.test.mjs` | 43 | 0 / 0 |
| `node --test tests/browser-owner-review.test.mjs` | 7 | 0 / 0 |
| `node --test tests/panel-content-pane.test.mjs` | 40 | 0 / 0 |
| `node --test tests/canvas-ui.test.mjs` | 60 | 0 / 0 |
| `node --test tests/canvas-floor-adapter.test.mjs` | 30 | 0 / 0 |
| `node --test tests/canvas-integration.test.mjs` | 33 | 0 / 0 |
| `node --test tests/canvas-poll-history.test.mjs` | 20 (10 parent rows) | 0 / 0 |

Locked tsc: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` — **exit 0** on the final candidate. Earlier passes were exit 0 after C fixes; an early run observed B's in-progress web.ts errors, which were not edited by C. **233 tests passed**, with zero failures/skips. `git diff --check` was clean. No exit 137/Killed occurred.

## Coordinator QA shots — not performed here

Use disposable owner/staff accounts, public fixtures, rollout flags still off outside the disposable fixture. No production QA seed bypass was added. Real component seed shape is `BrowserModel` in `browser/model.ts`; tests' `base`/`view` fixtures show deterministic rendered seeds. For runtime shots seed corresponding B task/state/notice/stream responses through the coordinator's disposable transport. Never put frames/private values into a URL.

URLs: own thread `/panel?c=OWN_THREAD_UUID` (popout), `/today` → Operator › Browser (sheet/dock); owner Watch `/today?browser=STAFF_TASK_UUID`; retained read-only notice `/today?browser=STAFF_TASK_UUID&review=NOTICE_UUID`; settings `/settings/browser`. Use actual lowercase UUIDs from the disposable seed, not text placeholders. Actual notifications keep their original deadlines.

Shoot **owner and staff at 320/360/820/1180/1280** for every applicable seed below. Also **420 dock**, measured **839/840** and **1000 content**, popout above/below840, and **800×360** all five `browserLandscapeRows` variants (own task, own read, own final-blocked, owner Watch before/after consent). Safe areas ≤80 total applied once, 8 padding, stage204 default / compact physical-keyboard228, 48/20 rows, 128 right column. Own views have one ≥64 strip; owner views none. Screens599/600, Safari820/744 and360px iPad Split View, rotated800×360 phone versus computer, native unavailable path. Rotation/keyboard/resize must not reclassify device.

Seed/state list:

- `off`, `unsupported`, `empty` (owner In use versus staff), `dialog:sites` empty/address added/areas/exact public addresses, Sites cancel.
- `queued` position2 (staff no identity), `queue_full`, `queue_expired`, `offer`30s, `offer_expired`, `starting`, `loading` with Earlier view, `working` with canonical letterboxed frame.
- `dialog:takeover` owner/staff, own Don't ask again, `taking_over` fence, `controlling` desktop/iPad and narrow iPad, Keyboard capture/IME/Escape, compact keyboard-open44px row/answers strip, local Zoom/pan/Fit, Pause/Resume live view. Confirmed answers source/Type it without local keyboard.
- `other_device`, owner replacement confirmation, owner-controlled staff status, `done` first prompt → `paused_private` Keep paused, pane leave/return, no private Continue, `dialog:fresh` cancel/confirm/reset private consent.
- `read_review` exact public address Read once/Don't open, `resource_review` exact files (1/20/21 items, expired), `write_blocked` phone/tablet, `final_blocked` Close only, `unknown` retained uncertain result. Review replaces stage, right/pinned actions remain visible.
- `dialog:leave` Chat/Canvas/app, cancel, slow fence, `pause_failed` Try again/Stop (retain mounted pane); explicit popout/redock and browser Back with one history exit.
- `idleSeconds:60` through expiry, `idle_closed`, `disconnected`, `reconnected`, `absent`, `turn_ended`, `owner_paused` public Continue versus private rest, `crashed`, `latched`, `auth_expired`, `access_removed`, `closed`, `service_unavailable`. Assert blank pixels on revoked/terminal paths and no automatic mutation retry.
- Owner private `privateConsented:false` with a fake old frame supplied (must still render no image), Show the page explicit POST, `privateConsented:true` human-only label; context-generation replacement clears image/consent. Public Watch. `dialog:pause_owner` cancel/failure/ACK, `ownerPaused:true` after ACK only. Passive Back/Escape/Close leaves staff task running. Staff watching indicator persists alongside fixed state, drops window count first.
- Underlying own Chat draft/scroll/selected Canvas stays mounted inert under Watch; no local thread returns Today without a dummy/staff conversation. Test next notice replacement and saved old URL separately after B seam resolution.
- Browser↔Canvas selection/attention/composer focus; Canvas-only and Browser-only flags; availability revision only cancels that feature; logout/thread/background clears both. Run prior Canvas Diagram/Page/Floor visual acceptance.
- Settings pilot list empty/named owner/named staff, own-confirm checkbox, revision conflict, unavailable backend, all later flags visibly off/disabled; runtime-named Abigail/Mark/Sam with owners Joe/Alex/Taylor, no gendered third-person pronouns.

## Not done / limits

This is a dark UI implementation and deterministic rendering/adapter test slice, **not release acceptance**. The A/B integration requests above remain open; several renderer states require their missing server reason/candidate/renewal projections. Guarded remote navigation is disabled. No actual network writes, final approvals, vault/files/login persistence, handoff, native changes, Telegram/bell dispatcher, live privacy canary, real device/IME/focus/geometry/SSE testing, screenshots, runtime readiness attestation, deployment, flag enabling or push was performed. Do not describe the whole Phase 1 feature as ready until coordinator acceptance and the listed seams pass.
