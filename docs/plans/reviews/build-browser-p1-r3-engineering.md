SCORES: design=8 completeness=8

Engineering judge, build round 3. Candidate 16d0f0f4b207bede17b9d111d3cc1fbcf2fe8b95. Source read-only; no commit or subagents. Disposable harness tag browser-p1-ej3-1107c92. Results pending below.

## Fresh adversarial expectations (recorded before execution)

1. Two expired initiator viewers do not block a fresh device; their old streams cannot renew.
2. Two currently attended devices exclude a third.
3. Sequential same-session/same-device joins with different request keys reuse one viewer.
4. Concurrent same-session/same-device LOGIN joins consume one slot.
5. Same-device join with mismatched device secret refuses without replacing authority.
6. A real session revoke retires the old viewer; a fresh valid session can join.
7. Leaving one of two attended initiator viewers keeps the task active.
8. Leaving the last attended viewer pauses safely with system attribution; a subsequent join alone does not silently resume.
9. Viewer joins for the same real web session/device remain stable through delayed identity arrival in the actual React hook (one join per mounted lifecycle).
10. A second actual device can join while the first remains attended; no redundant mount join consumes a third slot.
11. Repeated public SQL Pause/Continue cycles keep immutable old runs and issue new capabilities; old capabilities refuse.
12. Service attendance does not pause at 14,999 ms, and pauses at 15,000 ms with absent reason.
13. Renewed attendance before expiry postpones pause; a paused public context remains lifecycle-revocable.
14. Runtime pause transition persists system actor for attended-only expiry.
15. Repeated explicit checkpoint at unchanged head retains exact original identity and creates no second sink original.
16. Quiet minute ticks at unchanged head stay usable.
17. Shutdown and restart with a new boot at unchanged head retain the original signed identity.
18. A sink success followed by SQL ACK loss retries exact original evidence before advancing.
19. Same-sequence changed digest refuses while the original evidence remains recoverable.
20. Actual website projection derives task_label/job_label/project_id from trusted task/project records.
21. Pause actor and label follow persisted owner/initiator/system attribution.
22. Candidate suggested_by distinguishes agent/person/page_link, with trusted person label.
23. Settings people include named eligible owner and staff with reasons.
24. Staff cannot obtain owner-only busy_with_label or In use.
25. List snapshot and detail agree at the same task revision and task ID.
26. The actual hook rejects an older detail revision and preserves the accepted state.
27. A fresh create validates project visibility/existence before catalog classification or admission.
28. Production runtime-endpoints stays fixed/protected despite QA environment; no production graph QA selector.
29. QA overlay substitutes exactly the one runtime-endpoints leaf and refuses unsafe output boundaries.
30. QA refresh retires its own previously attended tasks without consuming another viewer slot or touching unrelated tasks.

## Verdict and verified fixes

**Required work remains: 3 fixes below.** Read the round 2 engineering review, all three R2 SERVER/FACTORY/UI handoffs and QA fixture instructions. HEAD stayed at 16d0f0f4 throughout this review. No source edits, commit, subagents, Next commands, browser, app server, sudo/systemctl, install, live database/service or coordinator QA cluster (:5499/:5498) access. Tests used only explicitly tagged harness clusters. No exit 137/Killed.

| Round 2 required item | Round 3 evidence |
|---|---|
| 1. Expired attendance consumes viewer slots | Fixed for expired/invalid-session attendance. Fresh cases 1–6 execute real website LOGIN SQL: stale attendance retires, stale streams cannot renew, two visible devices still exclude a third, stable same-device joins serialize to one viewer, mismatched secrets refuse, and revoked sessions cannot retain attendance. F1 below concerns how the website/hook assigns and preserves that device identity. |
| 2. QA superuser URLs and lost environment | Fixed. The individually run QA fixture file verifies independent connections for all six actual non-superuser LOGIN URLs, protected-write refusal and coordinator environment merge/replay, not URL text. It passed 19/19. Fresh QA case 30 also connected as real sjcos after explicit harness-only QA preparation. |
| 3. Public Pause permanently fences its gate | Fixed in examined paths. Actual controller/service/factory/gate regressions pass, including two full public pause/resume cycles, old input/output/Fetch/read/capture cancellation and permanent private/terminal fencing. Fresh case 11 additionally performs three committed SQL Pause/Continue/new-run/capability cycles: four immutable run rows remain, each old capability refuses and the new one authorizes. Factory CDP/root IO remains mocked; no installed runtime acceptance is claimed. |
| 4. Same-head checkpoint conflict | Fixed in examined paths. Fresh cases 15–19 produce three originals and four sends (one exact retry after SQL ACK loss), despite explicit repeat, four quiet minute ticks, shutdown, a new-boot restart and a one-hour retry delay. Changed same-seq digest refuses without losing the original. Individually reran actual JS→Python exporter integrations and all 28 Python scenarios via the exporter test file (29/29 Node tests); immutable time/boot/digest conflict rules remain strict. |
| 5. Private-query census | Mostly repaired, but still red on this HEAD: only the QA seed's full-source hash is stale after the final seed-status commit. Required 3. The previous unaudited-query/fake-controller/root-fixture failures no longer appear. |

New projection/seam checks also pass: actual website adapter with real LOGIN-backed DB rows derives named task/job and stored project association, persisted owner/initiator/system pause actors and labels, all three suggested_by variants, named eligible people, owner-only busy identity, and matching list/detail revision and task state. The actual hook retains revision 42/working after receiving revision 40/paused. Missing projects (tested as owner) and missing projects-area permission (staff) refuse before catalog classification. These checks validate data/protocol behavior, not visual geometry.

## REQUIRED fixes

1. **F1 is real: mounted session churn creates new device identities and exhausts attendance slots.** `components/panel/useBrowserSession.ts:35`, `components/panel/useBrowserSession.ts:41`, `components/panel/useBrowserSession.ts:47`; `components/panel/BrowserPane.tsx:36`, `components/panel/BrowserPane.tsx:63`; `lib/browser/web.ts:135`. The actual hook, with immediate API replies and delayed identity arrival, performs **2 joins and 1 leave** for one mounted task. The async identity changes `identity?.ownerName`, which changes apply→reload→the join effect dependencies; cleanup leaves the first viewer and the new effect joins without its credential. The website derives a new device secret from each new idempotency key. In a separate real-LOGIN-backed website-adapter/hook reproduction with old cleanup still outstanding, both joins create distinct viewer hashes; the following join returns **BROWSER_RESOURCE_LIMIT** with two unleft rows. **Exact change:** keep the mounted task/session's join and in-flight join identity stable through identity-only presentation updates (use refs or split effects), with one successful join per mounted lifecycle and correct cleanup of a genuinely superseded lifecycle. Preserve/adopt its in-memory viewer/device credential for retries and owner renewals; make the website resolve repeated joins for that same authenticated session/device to the existing viewer under the task lock before counting slots. The SQL lookup at `db/migrations/0115_browser_phase1_runtime.sql:211` already reuses a supplied stable hash (fresh sequential and concurrent LOGIN tests pass); fix the route/hook identity flow rather than assuming that SQL alone solves per-request hashes. If the join binding changes, update its strict contract and matching schema/migration as necessary. Keep two distinct devices, proof/secret/role checks, stale-stream fencing and owner consent intact; do not deduplicate all devices by sid or raise the limit. Add actual-hook delayed identity/in-flight cleanup and real website-route concurrent same-device/different-device regressions, including the occupied-second-device 429 race.

2. **F2 is real: --refresh cannot retire an attended fixture when both initiator slots are full.** `scripts/qa-seed-browser.mjs:81`, `scripts/qa-seed-browser.mjs:84`, `scripts/qa-seed-browser.mjs:85`. Fresh isolated QA-named harness DB: seed working, attach two valid attended staff viewers using real sjcos LOGIN and signed fixture proofs, then call seedBrowser with `{state:'working',refresh:true}`. It throws **BROWSER_RESOURCE_LIMIT** while trying to join a third random cleanup device; the previous staff task remains active. Existing tests refresh unattended seeds, so 19/19 does not cover this. **Exact change:** inside the existing QA isolation guards and seed advisory lock, identify previous tasks from this fixture's scenario and QA principals, lock and retire their existing attendance/stream/control/consent bindings before requesting a cleanup viewer slot, then stop their task/run through the existing guarded transition and admit replacements. An equivalent slot-independent QA-only retirement is acceptable. Refuse to retire an unrelated task; never change production admission limits or lifecycle protections. Add a regression with two still-visible viewers, repeat --refresh, assert old task/viewers/runs are retired, replacements are valid and unrelated rows survive. Refresh the seed's private-source audit only after this fix.

3. **Round 2 item 5 remains red: seed source audit hash is stale.** `tests/fixtures/ask-private-query-allowlist.json:268`. Individually running `node --test tests/ask-private-query-scan.test.mjs` gives **10 passed / 1 failed**, with exactly `Private SQL/guard source changed; review audit: scripts/qa-seed-browser.mjs`. Stored digest is `36e4d403362e6c04a64734b82f69fdb0ebef06d4e478ab755e0853bd54e7ac7c`; current seed digest is `1ceb53c9952263580ebdf14a845a8fecbbf7667d23e924466d8616c1245a8b83`. Commit 16d0f0f4 changed the QA project status after the audit was pinned. **Exact change:** review the final seed changes and enclosing QA/role guards (including required 2), update only the corresponding audited hash/query entries that actually changed, keep the scanner strict, and rerun this single test file. This is a committed-candidate failure, not concurrent source drift during the judge run.

## F3: explicit leave versus heartbeat absence

Confirmed with real LOGIN SQL: leaving one of two attended initiator viewers leaves the task **active** with no pause actor (fresh case 7). Leaving the last viewer changes it immediately to **paused/system** (case 8); merely joining again does not resume it. This is the explicit-leave path at `db/migrations/0115_browser_phase1_runtime.sql:239`–241, not a 15-second timer. The plan's attended-only rule and “hiding/closing one viewer leaves the other intact” are respected when the other viewer has actually joined; Join alone must not silently resume an old turn.

Separately, fresh service-clock cases 12–13 verify no absence pause at 14,999 ms, pause/absent at 15,000 ms, renewal postponing that deadline, and lifecycle revocation of the paused context. SQL runtime expiry records system attribution (case 14). Therefore do not describe explicit leave as waiting 15 seconds. A redundant cleanup leave before its replacement join is committed can expose a real moment with no attendance and pause the task; that is part of required 1, not grounds to add unattended execution grace or automatic resume. No separate F3 code fix is required based on this evidence.

The coordinator's existing log.json was read without opening a browser: 596 records, 34 with error arrays, including a recorded 429 on A-other_device-staff-w360. Screenshots/logs are supporting product observations; the causal findings above come from independent code/LOGIN/hook reproductions. No new visual/device acceptance is claimed.

## Fresh case results and limits

**27/30 pass; failures 9, 10, 30.** Expectations above were recorded in this review before execution. Cases 1–8, 11 and 14 use the harness fixture's actual non-superuser website LOGIN and independent service LOGIN where appropriate; concurrent joins use independent LOGIN connections. Cases 9 and 26 run the actual React hook via the deterministic hook dispatcher. Case 10 couples the actual hook to the actual website adapter and real SQL, retaining outstanding cleanup to exercise the overlap; the route mints distinct hashes for fresh request keys. Cases 12–13 run the actual service with a controlled clock and fake boundary IO. Cases 15–19 use the actual checkpoint client/fsynced outbox and real signatures with an in-process strict fake sink; the separately rerun exporter file supplies actual Python protocol coverage. Cases 20–25 and 27 execute the actual website adapter against real LOGIN-backed records with an explicit trusted projection callback. Project association is checked in SQL and job/task labels in their advertised response locations; no unadvertised project_id field in TaskUI is asserted. Case 28 executes the production leaf with mocked filesystem/protected-loader IO and scans the production graph; the existing QA test additionally proves refusal with an actual QA-named DB. Case 29 creates a disposable source overlay, compares **2,357** source files byte-for-byte against source (exactly the documented leaf substitution), checks its marker/dependency symlink and unsafe path/reuse refusal, then deletes it. Case 30 uses only a separately named harness QA DB and unique private fixture directory, removed afterward.

Judge construction errors were corrected, not counted as candidate defects: initial case 11 retained the fixture's deliberately pending manifest, so it properly refused attach until that unused fixture manifest was revoked; one hook probe called an unexported reload helper and was rerun using actual presence polling; initial nonexistent-project probing used staff without projects permission, so the expected earlier area refusal was verified and the existence branch rerun as owner. No expectations were relaxed.

## Individually executed tests and parity

Every changed `.test.mjs` between 157b15fd and HEAD ran as a separate sequential invocation: **11 files, 465 passed / 0 failed / 0 skipped**. The touched Python test file ran through its individual Node wrapper, which invokes each scenario separately with `python3 -I -B`; no duplicate Python count is added. Shared changed fixtures were exercised by their consuming files. Additional regressions also ran one file at a time. Overall **23 files, 769 passed / 1 failed / 0 skipped/cancelled**.

| tests/*.test.mjs | Pass / fail |
|---|---:|
| browser-audit-checkpoint | 12 / 0 |
| browser-checkpoint-exporter | 29 / 0 |
| browser-owner-review | 14 / 0 |
| browser-phase1-bridges-db | 29 / 0 |
| browser-production-factory | 62 / 0 |
| browser-r1-server | 16 / 0 |
| browser-read-manifest-db | 27 / 0 |
| browser-routes | 52 / 0 |
| browser-ui | 164 / 0 |
| panel-content-pane | 41 / 0 |
| qa-browser-fixture | 19 / 0 |
| ask-private-query-scan | 10 / 1 |
| browser-runtime-boundaries | 19 / 0 |
| browser-contract | 40 / 0 |
| browser-phase1-bridges | 43 / 0 |
| browser-schema-db | 31 / 0 |
| browser-roles-db | 12 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |
| browser-website-bridge | 22 / 0 |
| browser-multiturn-db | 5 / 0 |
| browser-round1 | 69 / 0 |
| browser-acceptance-integration | 42 / 0 |

- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**; no concurrent judge tsc.
- `node scripts/db-roles-scan.mjs --diff`: **exit 0**, sjcos_browser **0 table-write differences**. Existing agent/worker differences and intentional withholding remain; no grants were added to silence them.
- Contract parity: queried all **27 SQL_FUNCTIONS** against the disposable schema; each exists once, argument count matches repository keys, returns JSONB, is SECURITY DEFINER and has protected search_path. Shared route/schema, advertised control/navigation, projection and JS/Python checkpoint regressions pass. The production/QA endpoint leaves expose matching names in the fixture regression; production graph has no QA import/environment selector.
- Independently hashed **124 runtime** and **119 launcher** source entries: **0 mismatches** on this HEAD. Reviewed the recorded p1d uninterrupted network **28/28** + RSS **15/15** result at faee0245, realRuntime true / simulated false / releaseReady false. It re-attests changed containment bytes; it does not attest production Phase 1 bridges, independent WORM custody, privacy canary, devices or SSE.
- `git diff --check`: exit 0.

## Optional and cleanup

No optional feature work. After required fixes, coordinator should recapture second-device entry and first mount while recording task ID, revision, viewer identities, left_at/visible_until, pause actor and join/leave response timing; verify same-revision row/pane state and no spurious busy/stopped copy. Existing production runtime/privacy/transport/device release gates remain as disclosed in the handoffs and root result.

All seven disposable tags were stopped through tests/_harness/testdb.mjs or scripts/test-db.mjs: browser-p1-ej3-1107c92, and its -fresh, -web, -projection, -qa, -cycle and -create variants. Each active cluster reported stopped; test-owned QA fixture/overlay and checkpoint directories were removed. No coordinator QA directory or cluster was changed. Only this review file was deliberately written; authorized tests generated and cleaned disposable artifacts. Other judges' untracked review files were left alone. No commit.
