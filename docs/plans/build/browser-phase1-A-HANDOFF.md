# Browser Phase 1 A1 handoff — partial, disabled

Implementation commit: **63b1381e** (`Build disabled Browser A1 lifecycle and isolated agent foundations`). The follow-up commit containing this document updates only the owned manifest/migration comments, query census and this handoff; obtain its SHA with `git log -1 --format=%H -- docs/plans/build/browser-phase1-A-HANDOFF.md`. No push. **This is not a completed A1 slice or an activation candidate.**

No subagents, Next dev/build/start, Chromium/Playwright browser, sudo, systemctl, runtime install, live DB access or service changes were performed. Only fake CLI, mock CDP and disposable database tests ran. Test cluster tag: `browser-p1-a1-1107n`; final explicit stop completed. No dependency changes. Other builders' files were not staged or committed.

## Item → change

- Supervisor → `deploy/browser/supervisor.py`: stdlib state machine, fixed peer-credential RPC, flock serialization, two durable reservations, FIFO eight/one person, five-minute queue expiry, 30-second offers, bounded idempotency, generation checks, fsync/rename state, missing/corrupt/uncleared-running latch, pressure suspension. One-second housekeeper also runs under sustained RPC traffic. The trusted registration adapter accepts only task/person IDs and current presence, never client priority/limits. The DB reconciliation/atomic offer bridge remains missing (below).
- Accounting/latch → `accounting.py`, `browser-latch.py`, `supervisor-entry.py`: common 24 GiB/800% ancestor checks and `/proc` UID/cgroup census, headroom admission, cgroup OOM counter, marker before execution, root-only incident reset with independent fsynced reset audit. No reset socket method. Templates only; these have not been executed as root.
- Controller → `service.mjs`: one browser factory/two anonymous non-default contexts, one task/person, two tracked tabs per context/four total, tab close/reuse, generation fences across awaits, serialized commands with durable begin/finish adapters, unknown outcome on lost finish, wait versus crash, absence pause, five-minute idle/last-minute warning, 60-second empty-process shutdown, explicit fresh generation fence and reconcile-before-admission. No saved state/profile restore. Actual pinned-browser factory is still missing.
- Controller web RPC → additive production methods in `controller-rpc.mjs`: frozen strict method envelope, purpose HMAC, five-second validity, body digest, boot/nonce/proof checks, bounded inflight/replay cache, 32 KiB metadata ceiling. Optional independent response-key signing matches B's response binding. A separate binary frame server/channel caps header at 4 KiB and frame/review image at 160/300 KiB; per-frame and per-second authority checks, latest pending frame only and 60-second connection rotation.
- Nonroot split → separate production bootstrap and `scripts/sjcos-browser.mjs`; production refuses root and acceptance config. Fixed stdlib `production-relay.py` owns public web sockets and verifies kernel peer UID and nonroot target UID. It exposes no launch/SQL/CDP or arbitrary path. Existing root 0b acceptance APIs remain separate. Production MCP peer relay wiring is not complete.
- Agent → `agent-runtime.mjs`, `run-browser-agent.mjs`: actual narrow runner LOGIN before work, protected admitted-run reread, Claude/panel_web/presence only, strict CLI capability checks, existing generated argv/environment/history partition, protected process registration before stdin, 20-minute/60-turn bounds, bounded output, suppressed raw stderr, website-bridge browser-tagged message writes, authenticated finish and cache-purge callbacks. All 13 Browser tools retain their names; prepare/upload return read-only, vault fill unavailable, login/download lists empty. Exact-read navigation and fixed local action adapters are required; no arbitrary CDP execution.
- MCP → SJC/interact browser entry branch runs before ordinary DSN/env fallback and registration. `browser-profile-tools.mjs` exposes four strict SJC projections, one bounded human-question tool and an always-deny permission helper. Kernel process/claim validation now covers all three server kinds; project/lead/work item IDs are checked against the bound task before projection, and profile authority is rechecked after awaits. Actual confirmed-facts and human-question bridge implementations are not supplied here.
- History → ordinary `getTurns`, `getThreadMessages`, transcript/attachments, last-agent fallback, ordinary CLI unseen transcript/provider resume and Hermes gateway conversation reuse reject/exclude Browser trust. `model-history.mjs` filters unknown provenance, task-binds Browser history and writes protected provenance through the website client only. Ordinary admission/CLI reject tainted conversation reuse with `BROWSER_NEW_CONVERSATION_REQUIRED`; Browser never uses `ai_conversations.claude_session_id`.
- Audit → `audit-service.mjs` adds purpose-specific canonical event HMAC and independent Ed25519 checkpoint verification plus anchor orchestration callbacks. It does not implement the installation owner-only attestation bridge or independent sink.
- Units → reviewed-source **templates**, not installable acceptance: controller, minimal supervisor, fixed relay, gate, DNS and child/supervisor slices. Common-account caps remain the accounting prerequisite. Gate/bridge executables/config and namespace setup are incomplete. `phase1-install-plan.json` is only a reversible journal *plan*, not an executable installer.

## Seam changes

No A0 exported name/shape/result code/SQL signature/column was removed or changed. No new SQL function, table or migration number. 0115 has only an additional comment identifying the website-only history write path; its existing exact grant output is unchanged. Manifest note documents that path; no narrow grant was added.

Additive exports:

- `launcher.mjs`: `validateProductionNamespace`, `assertProductionNamespace` (fixed `sjcos-browser` identity and inode match; disposable `b0b-*` names refuse).
- `protected-bootstrap.mjs`: `loadProductionBootstrap` (fixed root-owned production config/adapter/hash, separate from acceptance bootstrap).
- `controller-rpc.mjs`: `createProductionRpc`, `encodeBinaryFrame`, `decodeBinaryFrame`, `serveProductionController`, `serveProductionFrames`.
- `controller-mcp.mjs`: `readBrokerClaim(runId,kind='browser')` accepts optional filtered server kind; original one-argument callers retain behavior. `createMcpAuthority` additionally accepts `profile_invoke`; it requires the matching per-kind kernel registration and strict schema.
- New modules export `BrowserService`, `phase1Hooks`, `supervisorCall`, `admissionRequest`, `runBrowserAgent`, `createTaskMcpHandler`, `filterModelHistory`, `assertOrdinaryConversation`, `appendBrowserMessage`, `eventAttestation`, `checkpointAttestation`, `createAuditService`, `PROFILE_TOOLS`, `registerProfileTools`, `startFilteredProfileMcp`, `runFilteredProfileEntry`.

## D/B hook signatures and installation dependencies

D's frozen exports are imported directly, without editing D's files:

- `enterPrivate({taskId,bootId,expectedEpoch,contextGeneration,reason:'manual',io})` → `{privacy_mode:'private',context_generation,control_epoch,stream_generation,drained:true}`.
- `authorizeManualInput({task,viewer,control,frame,event,now})` → `{allowed:true}`. Input carries a consumed SQL proof and fresh resolved authority; no input is delivered on failed drain, stale generation or revoked authority.
- `sanitizePublicObservation({raw,task,observationId,now})` → bounded ObservationV1; capture completion is fenced before sanitization.
- `submitGuard({operation,observation,actualRequest,phase:1})` → fixed refusal or known local operation. Exact reads use D's independently bound gate, never a click bypass.
- `prepareReadDispatch({task,entry,actualRequest,flow,binding,repository,audit})` → ReadDispatchV1. `audit.anchorReadIntent({task_id,binding})` must commit the independently checkpointed exact intent before D's repository transaction consumes a use.

`BrowserService.io.privacyIO(record)` must supply D's exact outputFence, synchronous fenceCommands, withContextLock, readTask, cancelObservations, stopAndAckScreencast, drainPublicOutputs, committed persistPrivate, rotatePrivateHandles, ackPrivate and pauseAfterFailure hooks. The privacy lock must not recursively acquire the service's already-held input mutex. `resolveInput(record,proof)` must return fresh viewer/control/frame/event after the drain and atomically consume its one-use input sequence. `deliverInput` receives that resolved in-memory event. No raw event body is stored/logged.

Other mandatory production I/O: browser, authorize, transition, fence, reconcile, audit, release, runEnd, begin, finish, commandResult, confirmFresh. `runEnd` persists the frozen SQL dispositions waiting/completed/crashed/stopped; normal ends revoke capability and pause. `confirmFresh` must consume the website's completed old-context fence and return a strictly newer context generation/boot; service cannot clear privacy by itself.

B public sockets are `/run/sjcos-browser/{control,frames}.sock`, root-owned by the fixed peer relay. Internal nonroot endpoints are `/run/sjcos-browser-runtime/{web,frames}.sock`. Metadata requests use the existing `browser-phase1-web-rpc\0` purpose. Response is `{command_id,boot_id,sequence,result,signature}`; signature is HMAC-SHA256 over canonical response without signature under the independent response key. Set `createProductionRpc.responseKey` in production. Binary handshake matches B's `{v:1,purpose:'browser-web-frame-open',task_id,viewer_id,boot_id,stream_id,stream_generation,context_generation,issued_at,expires_at,nonce,signature}`; HMAC uses the web request key over canonical unsigned handshake. Binary header/frame HMAC uses `browser-phase1-frame\0` and independent frame key. Header/payload layout matches B. No frame goes through metadata RPC. B accepts metadata up to 64 KiB, while A intentionally caps at 32 KiB; large manifest/read responses still need an agreed bounded transfer path rather than exceeding this limit.

`production-adapter.mjs` loads only the root-hashed `/etc/sjcos-browser/phase1-bridge.mjs` and requires separately verified Phase 1 evidence plus common accounting. It does not create that bridge. `supervisor-entry.py` similarly requires a separately reviewed `/etc/sjcos-browser/supervisor-bridge.py` with bounded registration/reconcile/pressure methods. Missing adapters/evidence refuse startup. Neither config nor callback is selected from model/RPC JSON.

## What is NOT done — implementation blockers, not runtime checks

1. **Production admission-to-launch is not wired.** The website `/start` currently queues/accepts through A0 SQL but does not create/attach a Browser run, issue/register its capability, coordinate durable reservation/offer commits or spawn the dedicated runner. Ordinary `admitAskRun`/`startClaudeRun` still refuse Browser. The missing concrete installation bridges must implement this trusted attended path; do not bypass those refusals.
2. **Concrete Chromium/gate factory is missing.** `BrowserService` owns tested lifecycle policy but delegates actual pinned nonroot launch, per-context guarded targets/listeners, CDP input/capture and pressure shutdown to required I/O. Production namespace validation alone does not implement production namespace setup. No acceptance launcher may be used as a production root bypass. The gate unit's `phase1-gate-entry.py` does not exist yet.
3. **Production MCP and facts/question wiring is incomplete.** Kernel authority primitives and filtered branches exist; the nonroot service is not yet connected to a production MCP SO_PEERCRED relay, confirmed-record projections or an initiator-bound question bridge. No arbitrary SJC callback/proxy may substitute for the four exact projections.
4. **Audit installation and independent sink are missing.** Pure verification/orchestration helpers do not implement a protected owner-only SQL attestation writer, key provisioning, independent durable sink/ACK or crash-safe outbox replay. Without them exact read consume must continue refusing.
5. **Phase 1 retention/deletion executor is not implemented.** Owner claim expiry+24h scrub, 30-day read/command/confirmed-answer payload cleanup, protected journal browser-cache purge and tombstone/listener invalidation still require concrete implementation. Existing Ask deletion remains off; this work does not enable it.
6. **Timer/budget gaps remain.** Five-second heartbeat production propagation, bounded review activity, hard 20-second start/30-second read cancellation, persisted cross-turn model budget and durable queue/root latch reconciliation are not implemented end to end by these primitive tests. Idle/absence/pressure policy cannot be treated as measured shutdown latency.
7. **Installation is only templates/plan.** No runnable reversible installer journal, production namespaces/CA/credential isolation or full common-workload placement exists in this change. Unit source and root relay/frame server have not been exercised as services.
8. **B integration defect observed during query census:** prepared-answer source SQL reads `ai_messages.content`; the canonical column is `body`. Do not edit B's file here. Website task_kind derivation also still uses the request proposal; authoritative catalog classification is a required follow-up. Query census records current guards; passing it does not certify these flows.

Do not activate, expose take-over or claim Phase 1 completion until these code gaps are closed and A–D are integrated.

## Verification

Thirty fresh adversarial expectations were written before the implementation: 18 supervisor + 12 mocked lifecycle cases (the latter are now in browser-controller). Additional RPC/binary, namespace, filtered-registration and disposable multi-turn cases were added afterward. Initial startup regression encountered the A0 harness's already-created Browser role; test now verifies that actual LOGIN role instead of creating it again. Initial multi-turn test used the wrong disposition/property; corrected to frozen completed/capability_revoked_at. Initial source-lock mismatch was fixed by inventory refresh. Final results below have no skips.

Each command was `SJC_TEST_CLUSTER_TAG=browser-p1-a1-1107n node --test tests/<name>.test.mjs`, **one file at a time**. Logs are `/tmp/browser-p1-a1-<name>.log` (ephemeral, not deployment evidence).

| Test file stem | Pass | Fail | Skip |
|---|---:|---:|---:|
| ask-private-query-scan | 11 | 0 | 0 |
| ask-thread-access-db | 33 | 0 | 0 |
| ask-thread-recovery-db | 43 | 0 | 0 |
| browser-acceptance-drivers | 11 | 0 | 0 |
| browser-acceptance-integration | 42 | 0 | 0 |
| browser-contract | 40 | 0 | 0 |
| browser-controller | 101 | 0 | 0 |
| browser-flags-db | 12 | 0 | 0 |
| browser-launcher | 15 | 0 | 0 |
| browser-multiturn-db | 5 | 0 | 0 |
| browser-parser-adapter | 44 | 0 | 0 |
| browser-playwright-patch | 30 | 0 | 0 |
| browser-response-budget | 13 | 0 | 0 |
| browser-roles-db | 12 | 0 | 0 |
| browser-root-runner | 17 | 0 | 0 |
| browser-round1 | 69 | 0 | 0 |
| browser-round2 | 26 | 0 | 0 |
| browser-run-profile | 14 | 0 | 0 |
| browser-runtime-boundaries | 19 | 0 | 0 |
| browser-runtime-startup | 21 | 0 | 0 |
| browser-schema-db | 31 | 0 | 0 |
| browser-supervisor | 18 | 0 | 0 |
| browser-transport | 1 | 0 | 0 |
| db-roles-manifest-db | 7 | 0 | 0 |
| db-roles-paths-db | 4 | 0 | 0 |

Total: **639 passed**, 0 failed, 0 skipped across 25 files. Transport is one Node wrapper; its underlying pinned Python cases are not counted again.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: final **exit 0**. An earlier run saw B's in-progress TypeScript errors; B fixed its owned source, and the later shared-worktree check passed.

`node scripts/db-roles-scan.mjs --diff`: **exit 0**, `sjcos_browser (0 tables)`. Existing agent/worker conservative/withheld findings remain (179/163 table inventories); this is not an empty diff. No narrow table grant was added to silence it. The new tagged history path is website-only. `node scripts/db-roles-sql.mjs ai_messages` prints the same output already present in 0115:

```sql
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT (id, conversation_id, role, body, page_context, cost_usd, created_at, run_id), UPDATE (id, conversation_id, role, body, page_context, cost_usd, created_at, run_id)', 'ai_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_messages');
```

Private-query census was refreshed with explicit per-function query hashes and source explanations for A's changes/A0 catalog and the inspected B website snapshot. No wildcard audit or removed guard. A subsequent B/source fix must update the census again.

Both `deploy/browser/playwright-patch/launcher-files.json` and `deploy/browser/runtime-lock.json` were refreshed, including required production/filtered-MCP imports. Provisioning's fixed source allowlist now includes exactly `mcp/browser-profile-tools.mjs` alongside the existing browser-tools exception. No patch/parser pin changed; acceptance remains false. `/usr/bin/python3 -I -B deploy/browser/provision_acceptance.py --check-sources` passes without root or installed-runtime writes. Runtime-boundaries passes 19/19 after refresh. This snapshot includes D's committed bytes; re-freeze after any further fixes. A new source lock invalidates older installed/runtime acceptance evidence.

`git diff --check`: passed. `SJC_TEST_CLUSTER_TAG=browser-p1-a1-1107n node scripts/test-db.mjs stop`: completed (last check reported no cluster running). No exit 137/resource kill occurred.

## Coordinator-only runtime acceptance after code blockers are fixed

- Freeze/reprovision exact source lock and re-run root **28 network + 15 RSS**; older 0b results do not attest this candidate.
- Verify real common ancestor census and persistent latch/kill/reboot/ExecStopPost faults, simultaneous durable FIFO admission and measured pressure/idle shutdown. No moving/restarting another app without Joe's deploy authorization.
- Actual patched Chromium 1248 one/two-person and hostile manual canary; privacy stop/ACK/drain before pointer/wheel/key/IME/Type it, no secret in model/history/log/receipt/error/frame outputs, fresh no-cookie context without restarting another person's browser.
- Real Claude argv/resolved policy, three MCP hops/actual LOGIN, provider-store isolation, narrow credential mounts/descriptors absent from Chromium/CLI and no ambient plugin/hook/owner DSN.
- Real TLS nginx/Cloudflare SSE, latest-only binary frame bounds/slow-reader behavior, revocation/consent/two-device input and actual Safari iPad/phone/desktop capture+IME. Visual UI/build checks remain coordinator-only; no visual verification was performed here.
- Only after all code and acceptance gates pass: owner-authorized named Joe pilot, then separately named staff parity. No flag or release readiness was changed by this builder.
