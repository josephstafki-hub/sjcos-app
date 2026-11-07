SCORES: design=9 completeness=9

Engineering judge, build round 5, candidate c7ce2675526340408cbe77c614ea13e3c93edbc2, branch `t3/browser-phase1`. Read the round 4 engineering review and R4/R4b/R4c/R4d handoffs. No source edit, commit or subagent. One REQUIRED fix remains.

## Fresh adversarial expectations (written before execution)

1. Delayed committed join survives active off/on plus effect replay with one current lease.
2. Delayed A→B→empty→A cleanup leaves only departed B.
3. Repeated host collapse/return while Leave ACK is outstanding never reacquires before ACK.
4. A changed conversation scope waits for old same-task retirement before joining.
5. A lost committed join reply across repeated returns preserves the request key and device identity.
6. Two independent mounts never share device UUIDs or retirement ownership.
7. A paused public joined task opens SSE.
8. A paused private initiator joined task opens SSE.
9. Zero, negative, fractional and missing stream generations never subscribe.
10. An active task disabled by authoritative detail never subscribes.
11. Paused public stream closed with STREAM_STALE stays disconnected across presence/detail polls until explicit reconnect.
12. Paused private stream closed with STREAM_STALE stays disconnected across polls until explicit reconnect.
13. Unexpected clean EOF stays disconnected across polls.
14. Unexpected fetch/reader rejection stays disconnected across polls.
15. Loading retains existing pixels while stale-epoch frames cannot replace them.
16. A new document loading episode ends on its accepted replacement and can start again after loading=false.
17. A pending read review retains presentation priority over loading.
18. Privacy transition while loading clears pixels and rejects late old callbacks.
19. Context replacement while loading clears pixels and rejects late old callbacks.
20. Stream binding replacement while loading clears pixels and rejects late frames.
21. Valid current public loading metadata returns true without granting navigation controls.
22. A viewer departing during loading RPC yields false/absent loading.
23. Attendance expiry during loading RPC yields false/absent loading.
24. Control epoch movement during loading RPC yields false/absent loading.
25. Run replacement during loading RPC yields false/absent loading.
26. Controller boot replacement during loading RPC yields false/absent loading.
27. Stream rotation during loading RPC yields false/absent loading.
28. Page fields or nonboolean values in loading metadata are rejected.

## REQUIRED fixes

1. **UI owner: retain transport-loss state across ordinary detail/presence updates.** `components/panel/useBrowserSession.ts:38`, `components/panel/useBrowserSession.ts:51`, `components/panel/useBrowserSession.ts:53`, `components/panel/useBrowserSession.ts:98`, `components/panel/useBrowserSession.ts:125`–126. The hook correctly detects the dropped stream, but `apply()` unconditionally derives a paused/working state from the next successful detail response, clears the error, and restores controls. This removes **Connection lost. Browser paused. / Reconnect** even though the SSE subscription has ended and has not been restored. A paused SQL task can continue to answer metadata/presence normally; those responses are not transport recovery. **Exact change:** add connection-loss state scoped to the current authenticated task/viewer lifecycle. Set it on unexpected SSE EOF, STREAM_STALE terminal close, and transport failure; clear pixels/control immediately. Preserve disconnected presentation and Reconnect across ordinary status/presence responses, including responses already in flight when the stream failed. Clear that state through successful explicit reconnect with a fresh accepted stream binding, task/lifecycle departure, or a stronger authoritative terminal/auth/access outcome. Keep planned close, hidden-pane cleanup and reauthentication rotation distinct; do not automatically resume the task or weaken the active/paused, joined-stream, privacy or authorization gates. Add actual-hook regressions for public and private paused tasks, unexpected EOF/rejection/terminal close, several unchanged-revision polls and a delayed pre-drop detail response. Assert persistent loss copy, Reconnect, blank pixels and no restored control capture until explicit recovery; after release/reconnect assert the existing public review/Resume and private no-Resume behavior. Fix the UI; the server and QA drop recipe do not need a behavior change for this finding. After fixing it, update `docs/plans/build/browser-phase1-QA-FIXTURE.md:244` to remove the instruction to capture a transient error before polling overwrites it.

## Verified round 4 item

**The round 4 departed-lifecycle cleanup race is fixed in the tested paths.** Ownership tokens transfer the pending/accepted lease when its binding returns, and cleanup rechecks its token after acquisition, immediately before retirement. Already-sent Leave is an acquisition barrier; accepted replacement credentials cannot be retired by the old cleanup.

Individually reran `tests/browser-ui.test.mjs`, including `R4 real website/SQL retirement orderings with a second attended device`: active off/on, task empty/return, A/B/A, delayed Leave ACK with repeated returns, and lost committed join reply. These execute the actual hook/API, HTTP validation, website adapter, independent non-superuser `sjcos_test_website` LOGINs, session checks and guarded SQL. Accepted viewers remain unleft, stream ID/generation remain current, presence returns 200, the second device stays attended, and the task remains active with no pause actor. The A/B/A case uses owner Watch across two valid staff tasks. Fresh cases 1–6 additionally stress compound returns, effect replay, host-scope changes, repeated ACK blocking and independent devices through the actual hook with deferred boundary IO. No viewer-limit expansion or automatic resume was introduced.

SSE subscription gating also passes: queued/offer/expired/off/starting/closed/failed metadata does not open SSE; a joined public or private paused initiator does. Missing or invalid stream bindings refuse subscription. The disconnect finding is not caused by the new active/paused gate.

## Coordinator disconnect finding: independent reproduction

Used a newly seeded QA-named database **inside my disposable harness cluster**, not either coordinator cluster. The final probe ran `seedBrowser` for both recipes, connected as real non-superuser `sjcos`, loaded the real QA website hooks and fake protocol, and ran the actual `useBrowserSession`/`browserAPI` through the actual HTTP handler and website adapter. Signed RPC requests/responses and signed binary packets were validated; SQL/session/viewer checks were real. Only socket IO and tick delivery were adapted in memory, so no server or browser was started. Invoked the fake protocol at sequence 0, 1 and 2 rather than waiting on its one-second socket timer.

| Recipe | SQL / initial hook state | Fake protocol and website SSE | Hook immediately after close | After normal presence/detail poll | After release file + explicit reconnect |
| --- | --- | --- | --- | --- | --- |
| disconnected_public | paused, public / paused | Two valid signed frame packets; third call throws STREAM_STALE; website emits terminal closed and ends SSE | disconnected | paused; loss copy false; Reconnect false | reconnected; SQL still paused; next signed packet succeeds |
| disconnected_private | paused, private / paused_private | Same two-packet/drop/terminal behavior | disconnected | paused_private; loss copy false; Reconnect false | reconnected; SQL still paused; next signed packet succeeds |

Initial accepted viewer IDs were `dfbfe553-6c23-44cf-b14c-d2257485c5e8` (public) and `27d561bb-d162-4ad5-9dbe-7f863b85247a` (private). The probe verified received/decoded packets, not their display timing or pixels.

The fake really drops: `scripts/qa-browser-fake-controller.mjs:188` throws on sequence >=2 until the private regular `release-disconnect` file exists; the socket wrapper at line 203 catches and destroys that socket. `lib/browser/web-rpc.ts` forwards socket end/close/error to its error callback. `lib/browser/web.ts:223` maps that callback to `closed/BROWSER_STREAM_STALE`; `lib/browser/live-view.mjs:26` and `:31` enqueue the terminal event and close the SSE response. The real adapter probe exercised that callback → SSE → API parser → hook path. The server does not hide the failure. The UI initially detects it, then `presence → reload → apply` erases it. A delayed successful detail response can erase it sooner than the next timer tick. The fixture documentation already acknowledges this transient behavior; it is a product defect, not an acceptance criterion.

Probe setup corrections, not candidate failures: the first attempt awaited SSE before driving the deterministic hook's render; I stopped that evaluator. Reusing its pinned QA directory after database recreation correctly refused the changed database binding. A fresh attempt initially omitted `SJC_BROWSER_ENABLED=1`, so the real per-frame readiness check correctly refused SSE. The final run used a new directory/tag and the isolated feature flag and completed both recipes as above. No failed setup was counted among the 28 fresh cases. Final SQL and directory cleanup completed; the completed evaluator was then terminated because mocked interval cleanup left real timeout handles alive.

## Fresh adversarial results

**24/28 pass. Cases 11–14 fail for REQUIRED 1.** The numbered expectations above were written before execution. Probes ran from stdin; module-load adapters exposed existing test helpers and suppressed their test registration without changing source files.

- **1–6 pass:** one acquisition through compound lifecycle returns/replay; only departed B is left; four repeated returns cannot overtake a held Leave ACK; a changed conversation drains the predecessor; lost committed reply keeps request key/device; independent mounts have distinct UUIDs and one genuine departure each. These six are actual-hook/deferred-boundary cases; real SQL evidence is separately identified above.
- **7–10 pass:** paused public/private subscription allowed; missing, zero, negative and fractional stream generations excluded; authoritative disabled task excluded.
- **11–14 fail:** all immediately reach disconnected, then a normal poll replaces it with paused or paused_private and removes Reconnect. Case 14 injects a typed `BrowserAPIError(BROWSER_STREAM_STALE)` rejection; arbitrary network TypeError classification was not independently tested. The complete QA/SQL probe confirms both terminal-close variants independently.
- **15–20 pass:** retained loading pixels survive a stale-epoch frame; accepted new-document replacement completes loading; loading=false resets the episode; pending review wins; privacy, context and stream-binding changes clear pixels and reject late old callbacks. These use metadata/frame events through the actual hook, not injected final presentation states.
- **21–28 pass:** actual website detail adapter with explicit deterministic DB/controller boundaries: current public loading works without granting reload/navigation; viewer disappearance, attendance expiry, control/run/boot movement and stream rotation suppress loading; page fields and string/number/null loading are rejected. No cached loading or navigation-hook authority is inferred. Existing R4c regressions additionally cover stale remote epoch/generation/boot/run, private/delegated contexts, malformed/missing metadata and changes during the read.

## Individually executed regression files and checks

All touched test files ran alone, sequentially. The shared private-query allowlist ran through its scanner; the related live-view file also ran. **8 files, 414 passed, 0 failed, 0 skipped/cancelled.** Fresh adversarial probes are separate from that count.

| tests/*.test.mjs | Passed |
| --- | ---: |
| browser-ui | 217 |
| browser-owner-review | 18 |
| panel-content-pane | 42 |
| browser-routes | 53 |
| browser-contract | 41 |
| qa-browser-fixture | 19 |
| ask-private-query-scan | 11 |
| browser-live-view | 13 |

- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0, no diagnostics. Exactly one judge tsc process.
- `node scripts/db-roles-scan.mjs --diff`: exit 0; `sjcos_browser` has **0 table-write differences**. Existing agent/worker differences and documented intentional withholding remain; no grants changed.
- Independently recomputed all **124 runtime** and **119 launcher** SHA-256 entries: **0 mismatches**.
- Read the committed p1f/p1f-rss root result: network 28/28 and RSS 15/15 at be74231f, realRuntime true, simulated false, releaseReady false. The first RSS run's sample-gap contention failure and separate idle-box rerun remain disclosed. I did not execute or independently attest root runtime acceptance. Production bridge/privacy/device and independent-custody release gates remain outside this review.
- `git diff --check`: exit 0; HEAD remains c7ce2675526340408cbe77c614ea13e3c93edbc2.

## Optional and cleanup

No optional feature change requested. Coordinator visual check after REQUIRED 1: leave each disconnected recipe open across several five-second polls, verify persistent exact loss copy and Reconnect, then release and reconnect; check public Resume versus private no Resume at the supported widths. No pixel/device acceptance is claimed here.

Every SQL connection came from `tests/_harness/testdb.mjs` or its derived LOGIN URLs. Ambient DATABASE_URL and SJC_TEST_DATABASE_URL were unset. Regression tag: `browser-p1-ej5-7b92d1`; fresh non-SQL tag: `browser-p1-ej5-7b92d1-fresh`; disconnect setup/final tags: `browser-p1-ej5-7b92d1-disconnect`, `browser-p1-ej5-7b92d1-disconnect2`, `browser-p1-ej5-7b92d1-disconnect3`. Regression clusters were stopped after each file (the UI/QA tests stop their own); each disconnect cluster's cleanup returned true, and the final stop audit for all five tags returned false/no cluster remaining. My QA fixture directories were removed. No live DB, :5499/:5498 QA cluster, service, sudo/systemctl, Next command, browser, server other than the explicitly requested disposable PostgreSQL harness, npm install, source edit, subagent or commit. No resource-limit kill/exit 137. Only this review was deliberately written; tests created/removed their own disposable artifacts. Concurrent design/security review files were left untouched.
