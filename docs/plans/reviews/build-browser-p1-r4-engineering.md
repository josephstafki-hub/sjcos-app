SCORES: design=9 completeness=9

Engineering judge, build round 4. Candidate 9d2db04043c8dd1e85b558c12e274a2e68d8d421. Only this review is deliberately written. No source edit, commit or subagent.

## Fresh adversarial expectations (recorded before execution)

1. Knowing another person's device UUID cannot join their initiator task or mutate their attendance.
2. A valid viewer ID with an incorrect device secret refuses without replacing credentials.
3. A viewer credential for another task cannot authorize this task.
4. Staff cannot reuse an initiator UUID to obtain owner-review authority.
5. Missing/invalid UUIDs and injected fields refuse strict join validation.
6. Simultaneous first joins for one device reuse exactly one viewer.
7. Concurrent retries for that device with a second slot occupied succeed without consuming another slot.
8. Lost committed reply retried with the same request key returns the same viewer and secret.
9. Same request key with a changed device UUID refuses rather than replaying unrelated identity.
10. A revoked web session cannot retry a successful join or renew attendance.
11. A rotated session generation refuses the old identity.
12. A fresh valid web session using the same device UUID gets distinct session-bound credentials; revoked-session attendance retires.
13. An expired attended viewer is retired before same-device rejoin; the replacement has a new stream/viewer identity.
14. Retired viewer credentials cannot renew presence after replacement.
15. A supplied valid viewer credential remains authoritative when the join body has another UUID; it cannot mint a different device using that credential.
16. Two distinct real devices exclude a third and retain their original credentials.
17. Anonymous project search refuses without project data.
18. Owner project search returns only project name/slug/kind, at most 20.
19. Staff with AI and Projects can search; removing Projects immediately refuses.
20. Staff with Projects but no AI refuses.
21. Inactive staff with both permissions refuses.
22. Client with spoofed owner cookie role refuses.
23. Revoked signed project-search session refuses.
24. Wildcards/backslashes are literal, SQL-like text cannot broaden results, non-string/overlong input refuses.
25. Delayed presentation identity does not cause another join or leave.
26. StrictMode replay before/after join completion shares one lease and leaves once on genuine departure.
27. Superseded task's late join is cleaned up without changing the accepted new task.
28. Returning A→B→A while A's original reply is delayed must not let old cleanup retire the newly accepted A viewer.
29. Inactive→active with an outstanding join must not let old cleanup retire the replacement's viewer.
30. Independent genuine mounts have independent device IDs, with one join per mount and one leave per accepted departed lifecycle.

## Verdict and verified round 3 items

**One REQUIRED fix remains.** The original presentation-identity/StrictMode duplicate join is repaired, but the new same-device reuse exposes a separate departed-lifecycle cleanup race. The QA refresh and private-source hash findings are fixed.

| Round 3 item | Round 4 evidence |
|---|---|
| 1. Device identity / redundant mount joins | The actual hook now performs one join through delayed identity and StrictMode replay, preserving its device UUID and initial request key. Real non-superuser LOGIN routes serialize five concurrent fresh same-device joins to one viewer and handle occupied-second-slot retries without 429. Two distinct devices still exclude a third. Revocation, generation rotation, cross-person/task secrets and expired attendance behave correctly. **Not fully closed:** cases 28–29 and the additional real hook→website→SQL repro below demonstrate cleanup retiring a newly accepted same-device viewer. |
| 2. QA refresh with both slots occupied | **Fixed.** Independently seeded a fresh QA-named harness database and connected as actual non-superuser `sjcos` LOGIN. Attached two still-visible initiator viewers to a working staff task with guarded SQL. Two successive `seedBrowser({state:'working',refresh:true})` calls succeeded. Old task closed; old stream UUIDs changed and generations advanced; attendance/consent/control fenced; old run stopped with capability revoked and ended_at set; replacement IDs differed; an unrelated sentinel's state/revision stayed identical. The individually rerun QA file additionally covers private attendance/control, every recipe, malformed membership refusal, six actual narrow/website LOGIN URLs, and production/overlay separation. |
| 3. Stale seed audit hash | **Fixed.** Reviewed final QA-only fencing/scenario membership guards and join changes. `node --test tests/ask-private-query-scan.test.mjs` now passes **11/11**, with scanner strictness unchanged. Both source inventories also independently hash clean. |

## REQUIRED fixes

1. **A departed lifecycle can leave the replacement's reused viewer and pause its current task.** `components/panel/useBrowserSession.ts:18`, `components/panel/useBrowserSession.ts:51`, `components/panel/useBrowserSession.ts:61`, `components/panel/useBrowserSession.ts:74`–76. The UUID is shared across the hook, but a disposed/mismatched binding starts an independent lease. Its predecessor's asynchronous cleanup remains scheduled against the same server-side identity. A new join correctly reuses that identity before the old response arrives; the old cleanup then posts Leave against the replacement's viewer. This affects actual close/reopen (`active:true→false→true`) and route/task selection (`task→null→same task`), as well as the deterministic A→B→A probe. **Exact change:** coordinate acquisition and retirement per authenticated task/device binding. Retain the pending/successful lease across a return to that binding and transfer cleanup ownership to the current lifecycle; immediately before posting Leave, check that the departing lifecycle still owns retirement. If its Leave has already been sent, drain that retirement before acquiring the replacement. Do not allow a new same-device join to complete while a superseded lease can still leave its viewer. Preserve one request/promise through StrictMode, stable identity through retries, genuine departure cleanup, distinct-device slot limits, session/secret checks and attended-only pause; do not solve this by suppressing all leaves, increasing limits or automatically resuming. Add actual-hook + real website/SQL regressions for delayed committed replies across active off/on, task A→empty→A, A→B→A and delayed Leave ACK, with a second real device occupied too. Assert the accepted current viewer remains unleft/renewable and old cleanup never pauses or invalidates it.

### Committed-SQL reproduction of required 1

Executed the actual `useBrowserSession` using the repository's deterministic React dispatcher, actual website adapter/HTTP handler and independent `sjcos_test_website` LOGIN connections. No browser or app server. The fixture adapter controls only boundary IO; Join/Leave/presence, device hashing, auth, transactions and guarded SQL are real.

1. Join commits for device D; hold its HTTP result before delivering it to the old hook lifecycle.
2. Close the Operator (`active=false`) or clear the selected task (`taskId=null`); allow the cleanup microtask to run.
3. Reopen/reselect the same task before releasing the first reply. The replacement join returns 200 with the **same viewer ID** and device secret, and the actual hook accepts `working`.
4. Release the old join reply. Its queued cleanup sends Leave, returning 200 against that same viewer.
5. SQL is now **paused/system**, the accepted viewer has **left_at set / stream_generation=2**, and the replacement's next presence request returns **403 BROWSER_FORBIDDEN**. The hook still says `working` until a further authoritative update/error.

| Real SQL variant | Reused viewer | State before old reply | State after old cleanup | Replacement presence |
|---|---|---|---|---|
| active→inactive→active | `3c8775b8-513a-4845-a7aa-1861eeca04c6` | active, no pause actor | paused/system, left | 403 |
| task→null→same task | `707ef234-4d77-4f8a-b7b0-b1a719df2ade` | active, no pause actor | paused/system, left | 403 |

This is not an incorrect SQL deduplication or absence timer: the old explicit Leave invalidates the viewer after the replacement has committed. Normal cleanup before a genuine later reopen may correctly pause the task; the failing sequence has already accepted the replacement before that Leave. The additional deterministic A→B→A probe also reports `acceptedViewerLeft=true` while the current model is `working`.

The first integration attempt used event-loop polling that finished before the second database response; it was corrected to await the actual second commit signal. The final two reproductions above await database completion and assert SQL results, not a timing guess. No candidate expectation was changed.

## Fresh adversarial results

**28/30 pass; cases 28 and 29 fail, with one shared required fix.** Expectations above were written before executing the probes.

- **1–16 pass:** real LOGIN-backed routes and guarded SQL, except case 5 which directly tests the shared strict request schema. Five simultaneous first joins use independent LOGIN connections; four concurrent retries with a second occupied slot all return the original viewer. Lost committed reply with the same key replays the same identity; changed UUID under that key returns 409 BROWSER_IDEMPOTENCY_CONFLICT. Revoked identity and old session generation return 401. A new sid derives a different device secret and retires revoked attendance. Expired viewer replacement changes viewer/stream IDs and old presence refuses. Valid supplied credentials remain authoritative despite a different body UUID; no third device is admitted.
- **17–24 pass:** actual signed-cookie project-search action with real LOGIN-backed DB/session checks. Owner/staff permitted paths minimize fields and bound results; anonymous, client with spoofed cookie role, inactive staff, AI removal, Projects removal and revocation refuse. Literal `%`, `_` and backslash each match only their planted project; SQL-like input returns no rows. Non-string and 121-character input refuse. No per-project ACL is invented: current app Projects-area access is the documented record model.
- **25–27, 30 pass:** actual hook with deferred API boundary responses. Delayed identity and repeated rendering do not rejoin; StrictMode replay before/after completion shares one request and genuinely unmounting leaves once. A late A result after accepting B cleans only A. Independent real hook mounts get distinct UUIDs and each leaves once.
- **28–29 fail:** same-device-aware boundary reproduces stale cleanup invalidating the accepted current viewer. The independent real website/SQL reproductions above confirm the server identity reuse and destructive Leave effect for actual off/on and task-clear/return paths. The A→B→A three-task sequence itself uses deterministic boundary IO, not three real SQL tasks.

All fresh SQL fixtures used `tests/_harness/testdb.mjs`, explicit tags, and harness-minted URLs. No ambient/live DB connection was used. Concurrent validation reads through the shared fixture client emitted pg's future-major deprecation warning; route transactions used independent real LOGIN clients and all assertions completed.

## Individually executed tests

Every touched test file since e741ccf2 ran alone: **6 files, 310 passed / 0 failed**. Changed shared fixtures ran through their consumers. Further Phase 1 and panel/Canvas regressions ran one file at a time, for **22 files total, 749 passed / 0 failed / 0 skipped or cancelled**. Fresh adversarial probes above are separate and are not hidden in this regression count.

| tests/*.test.mjs | Pass / fail |
|---|---:|
| browser-r3-server | 4 / 0 |
| browser-outbound-data | 33 / 0 |
| browser-owner-review | 17 / 0 |
| browser-routes | 52 / 0 |
| browser-ui | 185 / 0 |
| qa-browser-fixture | 19 / 0 |
| ask-private-query-scan | 11 / 0 |
| browser-contract | 40 / 0 |
| browser-phase1-bridges-db | 29 / 0 |
| browser-production-factory | 62 / 0 |
| browser-read-manifest-db | 27 / 0 |
| browser-runtime-boundaries | 19 / 0 |
| browser-website-bridge | 22 / 0 |
| browser-multiturn-db | 5 / 0 |
| browser-checkpoint-exporter | 29 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |
| panel-content-pane | 41 / 0 |
| canvas-ui | 60 / 0 |
| canvas-floor-adapter | 30 / 0 |
| canvas-integration | 33 / 0 |
| canvas-poll-history | 20 / 0 |

- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**, empty diagnostics. No other judge tsc was started.
- `node scripts/db-roles-scan.mjs --diff`: **exit 0**, `sjcos_browser` **0 table-write differences**. Pre-existing agent/worker findings and intentional withholding remain; no grants changed.
- **Contract parity:** all **27 SQL_FUNCTIONS** exist exactly once in the migrated disposable schema, match repository argument counts, return JSONB, are SECURITY DEFINER and have protected `search_path=public,pg_temp`. `BrowserJoinRequest` is inferred from the same strict RequestSchemas.join that now requires device_id; actual hook/API payload and website route regressions pass. Shared control/read/projection and real JS→Python exporter regressions pass. Production/QA leaf exports match in the QA regression.
- Independently recomputed SHA-256 for **124 runtime** and **119 launcher** entries: **0 mismatches**. Read the recorded p1e result for fd02a1ec: one run, network **28/28**, RSS **15/15**, realRuntime true, simulated false, releaseReady false. This review did not run or independently attest the installed root runtime.
- `git diff --check`: **exit 0**. HEAD remained **9d2db04043c8dd1e85b558c12e274a2e68d8d421**.

## Coordinator evidence and optional follow-up

Read the coordinator's existing log.json only: **586 records and 586 image files**, no logged data crossover, overflow or clipping. The supplied coordinator observations cover positive image heights, landscape stage ≥200 px, staff settings refusal, two devices plus owner Watch and both owner dialogs. No new pixel/device acceptance is claimed here. The log retains the disclosed queued-fixture events 503 limitation; no production endpoint or release gate is inferred from the fake controller.

No optional feature changes requested. After required 1, coordinator should recapture close/reopen and route-return with a delayed first join result and delayed Leave ACK, recording task ID, viewer ID, left_at, stream generation, current lifecycle and pause actor. Existing production Phase 1 bridge/privacy/transport/device and independent-custody release gates remain as disclosed in the root result and handoffs.

## Cleanup and boundaries

Stopped all four disposable tags through the harness: `browser-p1-ej4-1107d9`, `browser-p1-ej4-1107d9-fresh`, `browser-p1-ej4-1107d9-race`, `browser-p1-ej4-1107d9-qa`. Each cluster's final active stop reported true/stopped; subsequent stop checks for the first three reported no cluster running. The independent QA fixture directory was removed; the QA test cleaned its own fixture/overlay. No live DB/service, coordinator QA cluster (:5499/:5498), source edit, subagent, Next command, browser, sudo/systemctl, npm install or commit. No exit 137/Killed. Only this review was deliberately written; tests created and removed their disposable artifacts. Other judges' review files were left alone.
