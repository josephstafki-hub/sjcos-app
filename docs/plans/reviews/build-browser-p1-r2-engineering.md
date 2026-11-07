SCORES: design=8 completeness=7

Engineering judge, round 2; candidate ab46a364. Source is read-only. Disposable harness tag: browser-p1-ej2-1107b62. No QA :5499, live database/services, app server or browser.

## Fresh adversarial expectations (written before execution)

| # | Case | Expected |
|---|---|---|
| 1 | Join after two invisible, expired viewers without leave | Expire old viewers under task lock and admit |
| 2 | Join with two currently visible other devices | Refuse resource limit |
| 3 | Same device rejoins after attendance expiry | Renew same viewer safely |
| 4 | QA-generated website DSN connects | session_user equals table owner |
| 5 | QA-generated agent DSN connects | session_user=agent; no superuser |
| 6 | Rewrite QA env after coordinator adds vars | Preserve merged vars |
| 7 | Repeated working reseed | Each selected task active/public with coherent projection |
| 8 | Completed run → Continue | New immutable run, old run retained, live capability |
| 9 | Waiting run → Continue | Same guarantees as completed |
| 10 | Continue before reviewing new document | Refuse without new capability |
| 11 | Private → fresh reset | Same kernel boot, next generation, no old reads/capability |
| 12 | Fresh → reviewed new public turn | New immutable run and live capability |
| 13 | Master disabled on private fenced context | Tick closes context |
| 14 | Staff permission withdrawn on paused context | Tick closes context |
| 15 | Session expired on public completed context | Tick closes context |
| 16 | Paused vault-none context with vault flag off | Remains eligible |
| 17 | Discover exact new public asset | Pending durable review; zero transmit |
| 18 | Discovery repeated with stale revision | Refuse; no implicit approval |
| 19 | New same-origin path | Stages document; no duplicate origin |
| 20 | Guarded reload request through controller/service/factory | Exact epoch-bound CDP effect |
| 21 | Reuse successful navigation key | No second CDP effect |
| 22 | Change epoch while guarded send awaits | Refuse without CDP effect |
| 23 | Retention more tasks than batch | All eventually complete; no starvation |
| 24 | Cache completion acknowledged but SQL completion lost | Retry safely and advance |
| 25 | Replay after long outage and client restart | Original evidence preserved, fresh authenticated envelope |
| 26 | Replay envelope altered without resigning | Python exporter refuses |
| 27 | Valid replay re-signs changed original time at same seq | Python exporter refuses conflict |
| 28 | Pane closes before first JPEG on two viewers | Exact planned ACK before abort; independent bindings |
| 29 | Private Watch consent invalidated by context/control transition | Old consent cannot open stream |
| 30 | Private consent exists but checkpoint absent | No private stream until exact anchored ACK |

Results below were added after execution. Expectations above were not relaxed.

Additional expectations recorded before reproductions:
31. Public pause with the actual factory and gate must drain successfully and remain resumable; it must not hard-fence its own context before pausePublic.
32. Two minute checkpoints with an unchanged audit head must stay healthy; shutdown after that head must not enqueue conflicting re-signed evidence.

## Verified round 1 fixes

Read the round 1 engineering review, all three R1 slice handoffs, the QA fixture handoff, and both final root-result sections. Reviewed candidate ab46a3649af2ce7d8cadc808a31a704d2c12959f; HEAD remained there. No source edit or commit.

| R1 engineering item | Round 2 verification |
|---|---|
| 1. Initial admission/generations | Fixed. Individually reran the real admission→join→service offer→website accept→attach/capability→service.open→gate test. Trusted offered kernel boot persists, initial context generation is 1, listener generation is independently bound. No fixture boot substituted for the returned admission record in that regression. |
| 2. Continue/fresh turns | Core fix verified, with an additional public-Pause integration defect below. Fresh judge cases 8–12 exercise actual LOGIN SQL, committed createWebsiteStart, immutable old/new runs, capability issuance after attachment and old capability refusal. Completed/waiting resume rebind an existing service record; private reset preserves kernel boot, increments generation, revokes reads and needs fresh reviewed reads before a new turn. Existing production-factory tests independently cover real factory/gate public pause→resume, listener rebind, drained old Fetch and old output tickets. |
| 3. Fenced lifecycle revocation | Fixed. Real DB master, staff-rights and session-expiry transitions close private or completed/paused service records at tick, despite commandsFenced. Vault-none private context stays eligible with the vault flag off. Existing DB regressions also cover staff flag, inactive user and session revocation. |
| 4. Discovery/review | Fixed in examined path. Actual website discovery commits pending document+resource candidates without read uses or approval; stale revisions refuse; same-origin new paths stage without duplicate origins. Read-manifest DB and factory/gate regressions cover missing asset→blocked original Fetch→human review→new explicit reload. UI/API tests carry the exact path separately from origin permission. |
| 5. Guarded navigation | Fixed in examined path. Fresh schema-parsed control→controller handler→BrowserService→actual production factory→actual gate (mock CDP/root transport and trusted read authority) sends only Page.reload with ignoreCache:true. Duplicate key and epoch mutation cause no second/unauthorized CDP effect. Existing tests cover history entries, targets, expiry, C payloads and advertised controls. |
| 6. Retention starvation | Fixed. Fresh four-task cache-only batch, limit=1, advances across tasks. Lost SQL completion ACK after commit reconciles without repeating completed work. Existing real DB regression covers confirmed answers, expired session and lost cache completion ACK. Owner-only durable progress excludes completed tasks. |
| 7. >120s replay outage | Replay envelope fix verified; newly generated duplicate-head checkpoints still fail (required 4). Fresh JS outbox/client restart after a one-hour outage→actual Python exporter→pinned JS ACK verifier preserves original time/signature/boot and spool until SQL ACK. Altered replay signature and re-signed same-seq original-time conflict both refuse. Existing tests cover uncertain sink writes and audit-head jumps. |
| 8. Installer/bootstrap contract | Fixed in reviewed artifacts. Fixed phase1.json path, exact nonsecret root0644 schema, protected adapter/bridge digests and /usr/bin/node agree with nonroot loader/broker/units. Installer's 11 conformance tests, root-broker, launcher and runtime-startup tests pass; no real installer executed. |
| 9. Planned pre-frame close | Fixed in examined protocol. SSE state supplies current stream binding before JPEG; UI waits for binding and exact planned-close ACK before abort. Fresh independent two-viewer lifecycle case passes; actual-hook Chat/Canvas, delayed bootstrap, malformed ACK and two-device regressions all pass. No browser/real SSE acceptance is claimed. |
| 10. Fractional pointer/wheel | Fixed. Shared contract→final CDP adapter tests accept fractional half-open edges and reject upper/outside/nonfinite coordinates. |
| 11. Regression/audit fixtures | Route exports and deterministic egress clock fixed; both test files pass. Original production-browser private-source audit is current. Later QA/root-fixture changes leave a different private-query census failure (required 5). Both root source inventories now match every current candidate byte. |

Cross-slice parity: queried all **27 SQL_FUNCTIONS** against the disposable schema: each exists exactly once, has matching argument count, returns JSONB, is SECURITY DEFINER and has protected search_path. C requests use the strict shared ControlMessage fields; projection/types advertise the same navigation bindings. Authenticated pre-frame state and exact planned-close ACK agree across web/contracts/UI. JS replay envelope and Python exporter agree on exact keys/signatures/original sink evidence. Role manifest includes owner-only retention progress and the narrowly granted runtime-access function. Role scan returns **sjcos_browser: 0 table-write differences**; existing intentionally withheld agent/worker differences were not granted away.

## REQUIRED fixes

1. **Q1 is real: expired viewers exhaust join slots indefinitely.** `db/migrations/0115_browser_phase1_runtime.sql:201`, `db/migrations/0115_browser_phase1_runtime.sql:210`. Fresh actual website LOGIN: two initiator viewers with left_at NULL, then both visible_until in the past; a third fresh device returns **BROWSER_RESOURCE_LIMIT**. Two still-visible devices correctly refuse a third; same-device rejoin plus presence works. **Exact change:** under the existing task FOR UPDATE lock, atomically expire absent viewer rows before existing-viewer lookup/count (mark left and invalidate their stream/control bindings as appropriate), and count only current attendance. Do not depend on a later maintenance pass or relax proof/owner-consent checks. Add real LOGIN/concurrent-join regression for expired tabs/devices, still-visible limits and stale stream/control refusal. Update the matching schema snapshot.

2. **Q2 is real: generated QA URLs remain superuser, and reseeding overwrites merged environment.** `scripts/qa-seed-browser.mjs:158`, `scripts/qa-seed-browser.mjs:161`, `scripts/qa-seed-browser.mjs:164`. On a harness QA-named database whose actual table owner is sjcos_test_website, connected separately using generated DATABASE_URL and DATABASE_URL_AGENT. Both report **session_user=sjctest, current_user=sjctest, rolsuper=true**. Thus website identity checks fail, and the supposed narrow-role QA is not narrow. Added COORDINATOR_SENTINEL to side.env, reran writeQaEnvironment: sentinel disappeared. **Exact change:** generate working dedicated per-role QA LOGIN credentials/URLs, or install an explicit SET SESSION AUTHORIZATION connection hook on every QA connection; verify session_user/current_user and non-superuser status before accepting the environment. Never SET ROLE as a substitute. Preserve coordinator-merged variables, including overrides such as side-build isolation/origin/dist, on reseed (or generate fixture-owned variables in a separate file). Add connection-level identity assertions and an env-merge replay test; replace the present test that merely matches the broken session_authorization string. No QA :5499 connection was needed for this proof.

3. **Public Pause hard-fences the gate before its resumable pause hook.** `lib/browser/production-bridge.mjs:118`, `lib/browser/production-browser.mjs:148`, `lib/browser/production-gate.mjs:48`. Fresh case 31 uses the actual createServiceIO, controller handlers, BrowserService, production factory and gate, with mocked CDP/root calls. `control(pause)` calls stopInputAndCapture→api.fence→gate.fence, setting c.fenced=true. Its subsequent pausePublic throws **BROWSER_GATE_AUTHORITY_REFUSED**, because public pause explicitly rejects a fenced context. The website cannot receive its fence ACK or commit the pause, and that gate can no longer be resumed. The fake QA controller does not exercise this path. **Exact change:** use the resumable public drain path for public pause, including stopping local input/capture without setting the gate's permanent fence. Keep the hard private/terminal fence for those boundaries. Merely swapping the two current calls still hard-fences the paused context and is insufficient. Add actual factory/gate control-pause→SQL pause→Continue/new run/capability→factory/gate resume regression and assert no old input/output/Fetch survives.

4. **An unchanged audit head creates a permanently conflicting checkpoint.** `lib/browser/audit-checkpoint-client.mjs:50`, `lib/browser/audit-checkpoint-client.mjs:60`, `lib/browser/audit-checkpoint-client.mjs:61`, `deploy/browser/checkpoint-exporter.py:148`. Fresh case 32: real JS checkpoint client boots, checkpoints head seq421/digest e… successfully through the actual Python exporter, clock advances 61s with no audit-head change, then tick creates a new time/signature for the same seq. Exporter correctly returns **CONFLICT** against the stored immutable original. The conflicting record remains in the outbox and blocks subsequent beforeEffect/replay; shutdown also unconditionally reconstructs the same head. **Exact change:** durably retain/recover the original signed checkpoint identity and independently committed head; skip already anchored unchanged heads, or replay their exact original evidence with only a new replay envelope. Reconcile pending/committed records before enqueueing a newer record, including restart and lost SQL ACK. Do not weaken the exporter's immutable same-seq equality or delete conflicting evidence to recover. Add actual JS→Python tests for quiet minute ticks, shutdown, restart at unchanged head, repeated explicit checkpoint and pending same-head retries; all must remain usable without producing a second original record for one head.

5. **Private-query audit regression is still red on the committed candidate.** `tests/fixtures/ask-private-query-allowlist.json:260`, `tests/fixtures/ask-private-query-allowlist.json:268`, `tests/fixtures/ask-private-query-allowlist.json:269`. Individually running ask-private-query-scan returns 10/11: unaudited private SQL at `scripts/qa-browser-fake-controller.mjs:99` (createQaWebsiteHooks), `scripts/qa-browser-fake-controller.mjs:140` (dispatch), `scripts/qa-seed-browser.mjs:80` and `scripts/qa-seed-browser.mjs:90` (make); changed full-source audits for those two scripts and root-fixture; stale make query entry. HEAD/source did not change during this run. **Exact change:** explicitly review the changed QA SQL, enclosing triple guards and actual role separation, then update only the affected query entries/source hashes and remove stale entries. Include root-fixture's frozen-snapshot source digest after reviewing that change. Keep the scanner strict. Re-run this single file; refresh root inventories again after any required runtime-source fixes.

## Coordinator findings and root evidence

- **Q1/Q2:** independently reproduced above; required. The QA test's assertions on URL text could pass while every generated narrow URL is superuser. Screenshot success therefore does not validate role boundaries.
- **Q3:** not established as a product state-projection defect. Fresh case 7 ran five working --refresh reseeds on the harness QA database, for both owner and staff: each selected current task remained active/public, controller none, projection state_reason null. Read the coordinator's 384-entry log.json; it does not retain the authoritative task/epoch/stream projection needed to classify the reported paused image. Reseeding replaces tasks, while old selected IDs and unplanned viewer/stream closes can legitimately show paused/closed historical state. These are possible fixture/lifecycle explanations, not a proven cause. Do not claim Q3 fixed. Coordinator should retain the selected task ID and matching status/SSE payload at the next occurrence after the required fixture repairs; no speculative source fix is demanded here.
- Reviewed 35feb203: one frozen controller-event snapshot feeds measurement digest/count, ordering, derived RSS and retained observations. The quiet wait is bounded and does not waive artifact comparison. All **124 runtime** and **119 launcher** source entries hash correctly now. Runtime-boundaries 19/19, round1 69/69 and acceptance-integration 42/42 pass. Final root RESULT records p1c network **28/28** and p1c-rss **15/15**, realRuntime true, simulated false, releaseReady false. p1b event-snapshot mismatch and the contended p1c RSS gap are disclosed. These root containment results do not prove the Phase 1 production bridge, private Watch, devices or live transport.

## Fresh adversarial results

Final corrected judge construction: **26/30 pass**, failures **1,4,5,6** (Q1/Q2). Added before-repro cases **31 and 32 both fail**, required 3/4. Cases 1–3,8–19,23–24 use actual harness LOGIN SQL; 4–7,29–30 use a separately named harness QA database and unique disposable private fixture directory; 20–22/31 use actual controller/service/factory/gate code with fake CDP/root/authority I/O; 25–27/32 run actual JS/Python protocol code with in-process fake Object Lock transport; 28 exercises the real TypeScript stream lifecycle with two independent bindings, supplemented by actual-hook regressions.

Judge-only fixture construction errors were corrected without source edits or relaxed expectations: JavaScript async syntax, an impermissible direct context-generation update, attendance renewal after run_end, session expiry preserving immutable auth_at, QA writes under the actual owner identity, and Python __file__ setup. These intermediate errors are excluded from candidate failure counts. Lifecycle cases seed an existing generation-zero fixture service record directly; the separate admission regression verifies actual production generation-one creation. Only fixture I/O is mocked; no installed browser/runtime, live DB or QA :5499 is involved.

Case details beyond required failures: completed/waiting runs retain old immutable associations and issue a new live capability; private fresh starts with zero unrevoked reads; absent independent consent checkpoint denies private Watch until a locally signed QA checkpoint is verified/committed; fresh→private invalidates that previously anchored consent; document/resource discovery is pending and has no uses; stale revision fails; navigation retry and changed epoch produce zero extra effects; bounded retention completes all four old tasks and tolerates lost completion ACK; one-hour checkpoint replay retains original signed evidence until SQL succeeds. Local fake Object Lock/QA checkpoint evidence is explicitly not independent production WORM acceptance.

## Individually executed tests

Every touched test file from 12a66294..ab46a364 ran individually: **484 passed, 0 failed/skipped**. Broader R1/seam/Canvas checks also ran individually. **41 distinct files**, **42 invocations** (installer repeated once), **1,199 passed / 1 failed / 0 skipped**, counting the repeated installer invocation. Unique-file totals: **1,188 passed / 1 failed**. No npm test/full-suite command.

| tests/*.test.mjs | Pass / fail |
|---|---:|
| browser-checkpoint-exporter | 23 / 0 |
| browser-egress-gate | 27 / 0 |
| browser-installer (two invocations) | 11 / 0 each |
| browser-owner-review | 11 / 0 |
| browser-phase1-bridges-db | 24 / 0 |
| browser-phase1-bridges | 43 / 0 |
| browser-production-factory | 57 / 0 |
| browser-r1-server | 14 / 0 |
| browser-read-manifest-db | 27 / 0 |
| browser-routes | 45 / 0 |
| browser-schema-db | 31 / 0 |
| browser-ui | 134 / 0 |
| browser-website-bridge | 22 / 0 |
| qa-browser-fixture | 15 / 0 |
| ask-private-query-scan | 10 / 1 |
| browser-runtime-boundaries | 19 / 0 |
| browser-audit-checkpoint | 11 / 0 |
| browser-live-view | 13 / 0 |
| browser-round1 | 69 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |
| panel-content-pane | 40 / 0 |
| browser-contract | 40 / 0 |
| browser-controller | 101 / 0 |
| browser-flags-db | 12 / 0 |
| browser-launcher | 16 / 0 |
| browser-login-return | 5 / 0 |
| browser-multiturn-db | 5 / 0 |
| browser-outbound-data | 31 / 0 |
| browser-playwright-patch | 35 / 0 |
| browser-private | 22 / 0 |
| browser-roles-db | 12 / 0 |
| browser-root-broker | 8 / 0 |
| browser-runtime-startup | 21 / 0 |
| browser-submit-guard | 20 / 0 |
| browser-supervisor | 18 / 0 |
| browser-acceptance-integration | 42 / 0 |
| canvas-ui | 60 / 0 |
| canvas-floor-adapter | 30 / 0 |
| canvas-integration | 33 / 0 |
| canvas-poll-history | 20 / 0 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**. `node scripts/db-roles-scan.mjs --diff`: **exit 0**. `git diff --check`: exit 0. No exit137/Killed. No Next command, browser, app server, sudo/systemctl, dependency install, live DB/services or :5499 access. No subagents.

## Optional and cleanup

No extra feature work. Retain coordinator/owner gates for real production units/credentials, independent WORM behavior/attestation, private-output/consent canary, real TLS/Cloudflare SSE, guarded navigation with installed Chromium, desktop/iPhone/iPad interaction and visual checks. The scores reflect the five code/fixture fixes above, not the absence of a new judge-run browser/root acceptance.

Both disposable tagged clusters were stopped through scripts/test-db.mjs: browser-p1-ej2-1107b62 and browser-p1-ej2-1107b62-fresh each printed **stopped**, exit 0. The unique QA fixture directory browser-p1-ej2-1107b62 was removed; existing coordinator QA directory and cluster were untouched. Only this review file was deliberately written; authorized tests created/removed their own disposable artifacts. Other judges' untracked review files appeared concurrently and were not edited. No commit.
