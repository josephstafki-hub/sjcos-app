SCORES: design=6 completeness=5

Engineering review, build round 1. Candidate b101150a; diff 3cd54cc3..b101150a. Dark, flags-off, not installed. Source remains unchanged. Concurrent payment-card plan amendment is excluded.

## Adversarial expectations written before execution

These are fresh judge cases, distinct from rerunning the touched tests. All DB cases use tests/_harness/testdb.mjs, explicit harness URLs and tag browser-p1-ej1-1794044694057. No installed runtime, browser or live database is involved.

| # | Case | Expected result |
|---|---|---|
| 1 | Two actual website connections admit different keys for the same person concurrently | One live task; one refusal |
| 2 | Two actual service connections offer the same queued task concurrently | One offer |
| 3 | Attach a new run with stale control epoch | Refuse; run remains unattached |
| 4 | Repeat accepted command with same key/digest | Same command ID, no second command |
| 5 | Repeat command key with different digest | Refuse |
| 6 | Input proof with stale control/document epochs | Refuse |
| 7 | Continue metadata cursor after content changes at same revision | Refuse stale |
| 8 | Reuse metadata cursor for another viewer | Refuse |
| 9 | Begin privacy transition with delayed task read | Fence closes synchronously before await |
| 10 | Privacy persistence fails after public drain | No private ACK, fence stays closed |
| 11 | Consume exact reviewed read without independent audit ACK | Refuse; no use row |
| 12 | Consume while master flag is off | Refuse |
| 13 | Modify a correctly signed metadata reply | Refuse |
| 14 | Signed binary frame delivered under another task binding | Refuse |
| 15 | Alter JPEG bytes after binary signature | Refuse |
| 16 | Staff directly admits invoice task with only ai area | Refuse, cannot spoof required areas |
| 17 | Staff creates owner Watch claim | Refuse |
| 18 | Owner not on pilot allowlist admits a task | Refuse |
| 19 | Active public context loses flags between ticks | Close context |
| 20 | Paused private context loses flags between ticks | Close context too |
| 21 | Fresh reset returns skipped context generation | Refuse |
| 22 | Fresh reset returns same browser boot | Refuse |
| 23 | Narrow service invokes owner retention executor | Refuse before scrub |
| 24 | Two bounded retention batches with limit 1 and two old tasks | Both tasks eventually scrubbed |
| 25 | Production service factory exposes fixed guarded navigation hooks | Hooks present, no arbitrary CDP fallback |
| 26 | Retry the same guarded navigation key | One effect only |
| 27 | Canonical IME Unicode commit reaches CDP adapter | Exact Input.insertText payload |
| 28 | Canonical fractional pointer coordinates at right/bottom edge | Accepted consistently by contract and adapter |
| 29 | JS checkpoint record passed directly to Python exporter core, then ACK verified in JS | Exact cross-language interoperability |
| 30 | Fsynced checkpoint retried after an outage exceeding 120 seconds | Replay remains possible without dropping evidence |

Results and findings follow after execution.

## Verified good

- Read AGENTS.md, shared context, plan §12 Phase 1/dependencies, breakdown, all eleven requested handoffs and the final root RESULT. The last coordinator entry records real p1a network 28/28 and RSS 15/15 on 386ad6cf, with releaseReady false. I do not demand another root run merely to judge this dark candidate, nor treat those containment results as production-bridge/privacy/device acceptance.
- Strict client-safe contracts, nullable pre-run IDs, type-derived C API requests, exact public manifests, anonymous header policy and independent consume/checkpoint boundaries are substantial foundations. The metadata and binary signatures reject substitution; paging binds both content and viewer scope. No final-step release or vault bypass was found in the examined Phase 1 paths.
- Actual harness LOGIN cases verify admission serialization, offer serialization, capability boundaries, command dedupe, stale input refusal, staff area derivation, owner Watch denial to staff, explicit owner pilot membership, and no read-use row without independent checkpoint evidence.
- Executed parity check against the disposable schema: all **27** SQL_FUNCTIONS entries exist exactly once, argument counts match repository keys, return JSONB, and use SECURITY DEFINER with protected search_path. The TS aliases derive frozen Zod types; navigation response/request consumption is the exception described below. Existing schema tests pass fresh/upgrade/replay checks; no old migration checksum was changed by this review.
- A3a JS request → A3b Python Exporter.accept → JS verifyExporterAck succeeds using independent freshly generated Ed25519 keys and an in-process fake Object Lock sink. No socket or external sink was started. This checks exact canonical bytes and fields, not real S3/systemd behavior.
- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0. `node scripts/db-roles-scan.mjs --diff`: exit 0, browser 0 tables; existing conservative/withheld agent/worker results remain. No forbidden table grant is proposed to silence them.
- Against **Git objects at b101150a**, all **123** runtime-lock and **118** launcher inventory entries hash correctly. Working-tree inventory failure after concurrent QA edits is excluded from the candidate judgment.

## REQUIRED fixes

1. **Initial admission cannot reach the production context.** `lib/browser/web.ts:129`, `db/migrations/0115_browser_phase1_runtime.sql:664`, `lib/browser/service.mjs:25`, `lib/browser/production-gate.mjs:34`. Repro: actual website admission/join, actual service offer, then the exact B-style accept proof `{boot_id:task.controller_boot_id}` yields **boot=null, context_generation=0, listener_generation=1**. BrowserService.open rejects it with BROWSER_REVOKED; gate also assigns binding generation from context_generation rather than the durable listener_generation D checks. **Change:** obtain and persist the trusted supervisor/controller boot when accepting, define initial context creation consistently in 0115/contracts/service, bind listener_generation independently, and exercise B accept → SQL attach/capability → service.open → production gate using those actual returned records. Do not substitute fixture boot/generation constants. Keep controller/task boot semantics consistent with the root broker's kernel boot proof.

2. **Public Continue and fresh-browser restart have no coherent attached-turn path.** `lib/browser/production-bridge.mjs:112`, `lib/browser/production-bridge.mjs:171`, `lib/browser/production-bridge.mjs:177`, `db/migrations/0115_browser_phase1_runtime.sql:493`, `db/migrations/0115_browser_phase1_runtime.sql:377`. Normal run_end retains current_run_id; createWebsiteStart rejects paused tasks and any existing current_run_id. Fresh deletes the service context, leaves a public paused SQL task with no run/reads, then every control handler rejects before reaching resume because the context is absent. B's resume subsequently revokes all task capabilities even if afterControl attached a new one. **Change:** implement one committed resume/fresh continuation adapter that preserves historical run IDs, attaches a new immutable run, creates/rebinds a fresh context when needed, obtains new reviewed reads, and issues capability after the final control fence. Reconcile random fresh boot versus broker kernel boot explicitly. Add actual DB + service integration tests for completed→Continue, waiting→Continue, and private→fresh→new attended public turn; no capability resurrection or state copying.

3. **Master/staff/rights shutdown skips every fenced context.** `lib/browser/service.mjs:180`. Fresh case 20: open a context, mark it private/paused/commandsFenced, withdraw eligibility and advance 5 seconds; tick leaves it open (close count 0, expected 1). Done, absence and normal turn end also set commandsFenced. **Change:** perform current lifecycle eligibility checks for every context, independently of revoked model capability; disabled master/staff, session or rights must fence/close affected contexts within the prescribed interval, including human-private and public-paused ones. Preserve the intentional vault-off/manual-none exception. Test this with real DB flag/user/session transitions as well as service ticks.

4. **Public/resource discovery is implemented only as uncalled primitives.** `lib/browser/production-gate.mjs:53`, `lib/browser/read-manifest.mjs:72`, `lib/browser/repository.mjs:87`, `components/panel/useBrowserSession.ts:108`. No production caller stages the durable candidates. An unreviewed resource fails Fetch and invokes the fatal whole-gate shutdown; the Sites flow adds only an origin and reloads an empty candidate list. **Change:** wire a trusted exact-public discovery adapter before fatal transport authorization, persist browserWebReadCandidates through an authenticated website proof, expose the original revision/deadlines to C, and publish a document-plus-resources review for deliberate reload. Block the original flow without replay; keep containment/binding faults fatal. Add an integrated first navigation → missing public asset → human review → explicit new reload test, plus new-site/path review. This is needed code, not evidence a real Chromium canary can supply.

5. **Guarded navigation is still missing from the shipped factory and UI.** `lib/browser/production-browser.mjs:85`, `lib/browser/production-bridge.mjs:88`, `components/panel/BrowserView.tsx:57`, `components/panel/browser/api.ts:32`, `lib/browser/web-types.ts:31`. Fresh case 25 finds navigationState/prepareNavigation/guardedNavigation absent. C hard-disables every history/reload/window button and has no action handler; its control method cannot send the required document/context/read epochs or target, and BrowserStatus omits the returned navigation projection. **Change:** implement the three fixed guarded operations in the factory, bind them in createServiceIO, type the response projection, carry all exact request bindings through C, and enable only server-advertised actions. Test C request → B proof → service → actual factory mock send, review/new epoch, stale targets and no generic click/Enter fallback. A handoff asking the installer to author these hooks does not complete Phase 1.

6. **Bounded retention starves all tasks beyond the first batch.** `lib/browser/retention.mjs:14`. Fresh case 24 uses two old terminal tasks with real owned-message confirmed answers, limit=1 and two committed retention invocations: answer lengths remain **[0,1]**. Already scrubbed tasks are always selected again; at the default limit all tasks after the first 100 can retain payloads indefinitely. **Change:** maintain durable completed/progress state or a safely advancing bounded cursor, including cache-only work and crash reconciliation, so completed tasks cannot occupy every subsequent batch. Test >batch-size tasks, repeated runs, expired sessions, and SQL-commit/cache-completion crashes.

7. **Checkpoint replay becomes permanently blocked after a two-minute outage.** `deploy/browser/checkpoint-exporter.py:125`, `lib/browser/audit-checkpoint-client.mjs:54`, `lib/browser/audit-service.mjs:106`. Fresh case 30 submits a valid signed checkpoint with time 181 seconds old: exporter returns STALE and client rejects. The client replays the exact stored time/signature forever; its optional older-format expires_at refresh does not apply to this protocol. **Change:** add authenticated replay/refresh that retains the exact seq/digest/install/boot identity and original durable evidence, reconciles an uncertain sink write, and commits SQL before spool removal. Keep timestamp/replay/rollback protection. Test outage >120 seconds, exporter/controller restart, lost sink ACK and lost SQL ACK through both real protocol implementations, without deleting or skipping the old record.

8. **The installer and nonroot bootstrap disagree on their executable/configuration contract.** `deploy/browser/phase1-installer.mjs:20`, `deploy/browser/phase1-installer.mjs:78`, `lib/browser/protected-bootstrap.mjs:25`, `deploy/browser/root-broker.py:10`. Installer stages production.json as root0600, while every nonroot controller/runner/retention loader requires phase1.json and rejects group-readable configuration. Broker also hardcodes `/opt/sjcos-browser/node/bin/node`, while units/provisioned launch use `/usr/bin/node` and this installer does not provide that private binary. **Change:** reconcile fixed paths and nonroot delivery via purpose-specific credentials or a nonsecret root-owned config with narrow, checked readability; pin/use the actual supplied Node path. Add a disposable installation-artifact conformance test covering loader paths/modes and every fixed ExecStart/broker executable. Provisioning credentials/accounts and running the real installer remain owner gates; contradictory source paths are a code fix.

9. **A planned pane switch before the first frame pauses the task accidentally.** `components/panel/useBrowserSession.ts:44`, `components/panel/useBrowserSession.ts:48`, `components/panel/useBrowserSession.ts:53`, `lib/browser/phase1-contracts.mjs:34`. Stream binding is learned only from the first JPEG. Until then cleanup directly aborts GET without the authenticated planned-close ACK, so ordinary Browser→Chat/Canvas causes accidental initiator loss. C2 explicitly acknowledges the gap. **Change:** supply authenticated pre-frame stream binding (typed response/header/state extension) and close it through the existing exact planned-close proof before aborting; retain accidental-loss behavior when ACK fails. Add a no-frame Chat/Canvas switch integration fixture, two-device variant and coordinator transport checklist row. Runtime/device QA alone cannot add this missing protocol.

10. **Canonical pointer coordinates are rejected by the final adapter.** `lib/browser/phase1-contracts.mjs:37`, `lib/browser/production-browser.mjs:16`. Fresh case 28: pointer x=1279.5,y=799.5 passes InputEvent but cdpInput throws BROWSER_BAD_INPUT; C's letterbox mapping generates fractional coordinates. **Change:** use the same finite half-open 0≤x<1280, 0≤y<800 bounds at the adapter (or consistently quantize before validation/send). Test pointer and wheel at fractional edges and outside bounds through contract → authority → factory. A valid edge event must not disconnect private control.

11. **Repair candidate regression/audit fixtures; do not report all named checks green.** `tests/browser-routes.test.mjs:26`, `tests/browser-egress-gate.test.mjs:6`, `tests/fixtures/ask-private-query-allowlist.json:4`. The route fixture lacks website-bridge navigation exports and deterministically fails test 40 with “navigationControls is not a function or its return value is not iterable.” The egress fake clock is captured before makeManifest records approved_at; it intermittently rejects a future-dated approval (failed first run, passed rerun). Candidate-only private-query census has one genuine violation: stale full-source audit for lib/browser/production-browser.mjs. **Change:** import the real website bridge exports into the route fixture, inject one deterministic clock into authority and manifest creation, and explicitly review/update only the changed private-source audit entry. Add the seam regressions in fixes 1–10. Keep root source inventories refreshed after final code changes; the current b101150a inventories themselves are valid.

## Fresh judge results

After correcting judge fixture construction (refreshing the task's SQL-updated origins in memory and creating a real owned user message for confirmed answers), **25/30 passed, 5 failed**. Failures: **20,24,25,28,30**, reproduced above. Initial judge-fixture errors in 1,2,11,16,18 were corrected and rerun with unchanged expectations; none is counted as a candidate failure. Additional actual-DB initial-generation integration repro failed as described in fix 1. Expectations were written in this file before any case execution. Judge scripts ran through inline Node stdin and Python -I -B; no new test/source file was written.

## Individually executed touched tests

Each command was `SJC_TEST_CLUSTER_TAG=browser-p1-ej1-1794044694057 node --test tests/<file>`; no full-suite command. All 31 files touched by the requested diff ran, one at a time. First pass **789 passed, 2 failed, 0 skipped**.

| File | Pass / fail |
|---|---:|
| browser-audit-checkpoint.test.mjs | 11 / 0 |
| browser-checkpoint-exporter.test.mjs | 12 / 0 |
| browser-contract.test.mjs | 40 / 0 |
| browser-controller.test.mjs | 101 / 0 |
| browser-egress-gate.test.mjs | 26 / 1; isolated rerun 27 / 0 |
| browser-flags-db.test.mjs | 12 / 0 |
| browser-installer.test.mjs | 8 / 0 |
| browser-launcher.test.mjs | 16 / 0 |
| browser-live-view.test.mjs | 13 / 0 |
| browser-login-return.test.mjs | 5 / 0 |
| browser-multiturn-db.test.mjs | 5 / 0 |
| browser-outbound-data.test.mjs | 31 / 0 |
| browser-owner-review.test.mjs | 8 / 0 |
| browser-phase1-bridges-db.test.mjs | 13 / 0 |
| browser-phase1-bridges.test.mjs | 43 / 0 |
| browser-playwright-patch.test.mjs | 35 / 0 |
| browser-private.test.mjs | 22 / 0 |
| browser-production-factory.test.mjs | 25 / 0 |
| browser-read-manifest-db.test.mjs | 26 / 0 |
| browser-roles-db.test.mjs | 12 / 0 |
| browser-root-broker.test.mjs | 8 / 0 |
| browser-routes.test.mjs | 40 / 1 |
| browser-runtime-startup.test.mjs | 21 / 0 |
| browser-schema-db.test.mjs | 31 / 0 |
| browser-submit-guard.test.mjs | 20 / 0 |
| browser-supervisor.test.mjs | 18 / 0 |
| browser-ui.test.mjs | 114 / 0 |
| browser-website-bridge.test.mjs | 22 / 0 |
| db-roles-manifest-db.test.mjs | 7 / 0 |
| db-roles-paths-db.test.mjs | 4 / 0 |
| panel-content-pane.test.mjs | 40 / 0 |

Additional single-file checks: browser-run-profile 14/14; ask-thread-access-db 33/33; ask-thread-recovery-db 43/43; browser-network 94/94; browser-runtime-gate 61/61; browser-response-budget 13/13; browser-round1 69/69; browser-round2 26/26. No skips.

Working-tree browser-runtime-boundaries returned 18/19 after concurrent changes; candidate-only inventory verification above isolates all hashes as matching. Working-tree ask-private-query-scan returned 10/11 with untracked QA script/changed sources; repeating the exact scanner over candidate Git objects excludes those concurrent changes and isolates the single production-browser source audit failure in fix 11. The reviewed b101150a source was not modified to make either check pass.

## Optional / coordinator gates retained

No additional optional feature work is requested. Independent WORM sink provisioning, real conditional PUT/Object Lock behavior, signed installation evidence, real installer execution, accounting/identity/service sandbox measurement, installed Chromium privacy canary, resolved Claude/MCP environment isolation, real TLS/Cloudflare SSE, iPhone/iPad/desktop and visual QA remain explicit coordinator/owner gates. No missing real-runtime evidence by itself lowered the scores. The code defects and missing fixtures above did.

Concurrency note: HEAD advanced to 43d78eb3 for the excluded payment amendment. During review other actors also introduced uncommitted phase-flags.mjs/web-rpc.ts/web.ts and qa-browser-fake-controller.mjs changes, and another review file. They were not edited, reverted, staged, or included as candidate defects. Candidate source/census checks used b101150a Git objects where needed.

No Next process, browser, sudo/systemctl, install, live database/service action or dependency install was run. No exit137/Killed occurred. Only this review file was deliberately written; disposable harness/fixture artifacts were used by the authorized tests. No commit.

Cleanup verified: `SJC_TEST_CLUSTER_TAG=browser-p1-ej1-1794044694057 node scripts/test-db.mjs stop` exited 0 and printed **stopped**. No judge cluster is left running.
