# Browser Phase 1 A2a — partial integration, disabled

## A2b factory interface (frozen for this round)

`BrowserService` accepts installation-owned `io.browser()` returning one managed
browser with `newContext({acceptDownloads:false,serviceWorkers:'block',
viewport:{width:1280,height:800}})` and `close()`. A context exposes `id`, `close()`;
its factory must attach guarded targets/listeners BEFORE releasing page requests.
A2a owns task/authority, A2b owns Chromium/CDP/gate containment. No raw CDP RPC.

Factory hooks, always receiving the service record `{task,context,tabs,...}`:
`fence(record)` stops listeners and pending commands; `capturePublic(record,{signal})`
returns D's trusted visible extraction shape; `deliverInput(record,resolved)` sends
only the already-resolved event; `cancelAndDrainCommands(record)`,
`cancelObservations(record)`, `stopAndAckScreencast(record)`,
`drainPublicOutputs(record)`, `ackPrivate(record,binding)` each resolve **true**
after completion. `rotatePrivateHandles(record,savedTask)` returns
`{stream_generation}` from the SQL-committed viewer generation, without increment.
`stopInputAndCapture(record)` resolves true. `release(record)` removes guarded
listeners/targets. All hooks fail closed; none writes SQL or grants control.
`io.privacyIO(record)` may supply those hooks already bound; A2a installs its own
per-context fence, registry, non-recursive held-lock adapter and committed
`readTask`/`persistPrivate` when assembling them. Privacy fencing must preserve
human input availability while disabling model commands. Pressure calls
`service.pressure()` (fence/close all contexts); it never restarts another app.

Production read gate must use `createProductionReadBridge` (A2a,
`lib/browser/production-bridge.mjs`) returning D's `phase:1` authority and
`createGateAuthority({phase:1,...})`; never the fixture signer. The bridge requires
an explicit transaction adapter resolving only after COMMIT, independently
anchored audit, durable journal, keys and fresh server `contextFor`.

Metadata paging: A2a will export `PageRequest` / `MetadataPage` and
`pageMetadata`. Requests carry optional `cursor` (opaque <=256 UTF-8 bytes) and
`limit` (1..20, default 20). Results are `{items,next_cursor:null|string,revision}`.
Revision changes refuse with `BROWSER_REVIEW_STALE`; no mixed-revision assembly.
The signed response INCLUDING its envelope stays <=32768 bytes. B2 owns clients.

The final sections below record the partial delivery and outstanding installation/code gaps.

## New integration exports available now (A2b/B2)

- `createProductionReadBridge` returns `.phase === 1` and all four authority
  methods directly (also `.authority` alias). Only constructs `.handle` when
  `gate.networkConfig` is supplied; A2b may construct its guarded handler itself.
- `createServiceIO({factory,db,common})` binds factory callbacks. DB adapter
  supplies `readTask(record)`, committed `persistPrivate(record,args)`,
  `committedPrivateStream(record,savedTask)` (returns actual committed
  `stream_generation`), and fresh `authorizeHuman`/`resolveInput`. It adds the
  stream generation to factory `rotatePrivateHandles`'s TaskSafe argument and
  `privacy_mode:'private'` to `ackPrivate` binding for A2b's current factory.
- `createControllerHandlers` installs fixed paging/heartbeat/control/stream
  callbacks. `createWebsiteStart` performs owner-side immutable run insert,
  attach/capability SQL, supervised reservation and held runner release. Its
  runner broker hooks are `spawnHeld`, `register`, `bindCapability`, `release`,
  `cancel`; registration returns actual `{pid,start_ticks,cgroup,boot_id}`.
  `spawnHeldBrowserRunner` is the fixed dedicated executable + private fd3 gate.
  The root broker must install registration before release; no ordinary runner.
- `browserWebReadCandidates` / SQL `browser_web_read_candidates` are installed
  in 0115 (website-only). Candidate parent epoch is **task.document_epoch+1**
  matching D (doc plus exact resources on deliberate reload). Candidates retain
  original <=60s expiry; approval must use their exact URL/role/source set.
- `browserWebPresence` returns `{present_until,control_expires_at:null|ISO}`;
  current exclusive device+viewer epoch only, never expired control revival.
- `browserWebModelBudget` records monotonic per-run samples, summed across task
  runs. Runner now requires `modelBudget`, `chargeModelBudget`,
  `appendPublicMessage` in its protected bridge; missing hooks refuse startup.
- Controller now requires `deps.mcp={key,handle}` and independent 32-byte RPC
  response key. Fixed root relay entry:
  `scripts/sjcos-browser.mjs --mcp-peer-relay`; credential
  `/run/credentials/sjcos-browser-mcp-relay.service/peer-key` (32 raw bytes).
  SO_PEERCRED identity is signed into the internal
  `/run/sjcos-browser-runtime/mcp.sock` envelope. Nonroot endpoint checks purpose,
  freshness and one-use nonce, then existing per-call process/claim authority.
  Root relay gets no DB, launch or CDP callbacks. No unit is started here.

A2b owns deploy inventories: please refresh launcher-files/runtime-lock for all
changed A2a imports after this slice freezes; A2a must not edit A2b-owned files.

## Delivered / commits

- **e0c2dfd4** — only migration 0115 extended (unapplied live), schema tombstone /
  cumulative budget columns, exact function catalog + manifest, pending review
  storage, task control renewal and owner retention executor/CLI. Actual generator
  output for browser_read_manifests and browser_task_runs is empty; both remain
  website-only tables with no narrow grants. Existing narrow restrictions stay.
- Service/agent bridge commit: obtain with
  `git log -1 --format=%H -- lib/browser/production-bridge.mjs` (this handoff
  accompanies it). No push. Other builders' paths were not staged or committed.

Item → implementation:

1. Admission → `createAttendedAdmission` serializes starts, rechecks attendance,
   enforces 20s cancellation, orders reservation/run/capability/process/activation
   commits, compensates uncertain launch by task + reservation. `createWebsiteStart`
   inserts only Claude/browser/panel_web runs and uses existing website attach /
   capability functions. `spawnHeldBrowserRunner` + fd3 script gate hold the
   dedicated runner before credentials/model work. Ordinary Ask/Claude admission
   still refuses Browser. **Default website installation is not wired (below).**
2. Privacy → one fence/registry per context; D `observePublic`, no private capture;
   D take-over barrier before web grant, nonrecursive already-held context lock,
   failed hook pauses, fresh human authority independent of revoked MCP capability,
   reread task epoch after SQL takeover, read cancellation and ref registry.
   Model observation is fenced again after the final awaited authorization.
   `createServiceIO` supplies D's exact factory/committed-stream adapters. Factory
   pressure during asynchronous context creation refuses before installation.
3. MCP/facts/questions → root stdlib SO_PEERCRED relay plus bounded signed internal
   envelope and replay-fenced nonroot endpoint. Exact four schema projections
   and initiator-bound human question adapter; reauthorization after readers.
   Relay encodes the original JSON request bytes as base64url inside its signed
   envelope to avoid Python/JS floating-point canonicalization disagreement.
4. Audit → actual-login-checked owner attestation writer verifies event HMAC and
   installation/sink Ed25519 before writing exact settings. Fsynced bounded
   checkpoint outbox keeps records until SQL checkpoint commit, retries after
   restart, refuses forged/missing ACK, optionally refreshes expired signatures
   without changing the original checkpoint identity. It is explicitly not an
   independent sink. SQL read consume still refuses missing independent proof.
5. Retention → owner-only bounded task scrub; expired pending reviews become
   terminal, owner claims purge at expiry+24h, terminal read/command/web-command /
   confirmed-answer payloads scrub at 30d. Approved reads retain revision/digest /
   counters/audit. Protected ID-only cache tombstone → listener invalidation →
   purge → SQL COMMIT → completion. No Ask deletion or evidence-chain deletion.
6. Timers/budget → signal-aware 30s model read/capture cancellation, 20s start,
   5s runner budget propagation, original ≤60s review activity, current control
   renewal from heartbeat. SQL records monotonic per-run model time/turns/cost
   summed across immutable task turns; CLI receives remaining turns/cost/time.
7. Web/controller → signed reply envelope checked against the 32KiB ceiling,
   including signed failures after an authenticated request; scoped HMAC cursor
   paging on server; fixed control/heartbeat/stream handlers. Pause returns a
   capture-fenced ACK and lets B perform the single SQL control transition.
   `createWebsiteProjection` gives configured owner label/controller provenance
   and current runtime-only reason/window metadata. Unknown reasons stay null.

## Paging contract as implemented

`PageRequest={cursor?:string,limit?:integer}`: cursor ≤256 UTF-8 bytes, limit1..20,
20 default. `MetadataPage={items:unknown[],next_cursor:string|null,revision:positive
integer}`. Typed exports: ReadManifestPage (ReadEntry), ReadCandidatePage,
ConfirmedAnswerPage. `read_manifest`, `read_review`, `read_answers`, `read_in_use`
RPC payloads accept these page fields; read_review also requires action_id|null.

`pageMetadata` / service.page bind cursor HMAC to task, viewer, method and optional
review association, revision, offset and full collection digest. A changed
revision **or collection** returns BROWSER_REVIEW_STALE; changed scope/tampering
refuses. Pages contain at most20 items and30,000 encoded JSON bytes (headroom for
signed RPC). A single item that cannot fit refuses BROWSER_FRAME_TOO_LARGE.
The whole signed response/request is ≤32768 bytes. No metadata base64 frames;
separate binary channel stays unchanged. B2 implements its website/client page
assembly. B's independent cursor format need not match A's opaque cursor bytes.

## Remaining gaps — this is NOT completed A2a / activation acceptance

1. **Concrete installation assembly is still required.** B2's default
   `requireBrowserWebRequest` constructs createWebsiteAdapter without websiteHooks.
   Connect `createWebsiteStart`, trusted catalog task classification,
   `confirmedFactsFromCatalog` and `createWebsiteProjection` there through a
   protected website bridge. No automatic fallback classifier is supplied.
   Current trusted public catalog must enumerate exact public URLs, and all known
   company/private values must populate facts. The confirmed-only record readers
   and question adapter still need the actual SJC record/question backend.
2. **Production root broker/authority assembly remains incomplete.** The new
   relay entry/credential/internal socket must be included in the reviewed A2b
   unit/installer set. Nonroot authority cannot read root0600 registry files:
   installation must supply its protected readClaim/registration adapter and the
   exact runner spawnHeld/register/bindCapability/release/cancel implementation.
   `createWebsiteStart` is concrete owner SQL/orchestration, not a substitute for
   the missing root registration broker. Durable supervisor queue/root-latch
   reconciliation is still a required callback, not proven end to end here.
3. **Sink and replay installation remains external.** Provision purpose keys,
   installation signer, independently administered append-only sink and its
   pinned exporter; call replay on boot/shutdown and commit owner attestations /
   service append/checkpoint in order. Missing ACK refuses. The code does not
   provision or contact an independent sink, and no installation can be called
   ready solely from the local fsynced outbox tests.
4. **Retention scheduling/loader not yet connected.** The new CLI requires
   `adapter.retentionDependencies(config)`; A2b's current production-adapter only
   forwards service/agent dependencies. Add the owner bridge forwarding and
   bounded minute scheduling outside the narrow controller DB identity.
   Tombstone purge must include all installation-specific provider/cache roots;
   no arbitrary filesystem path is accepted. Claim-expiry audit/reconciliation
   and abnormal-run budget accounting need full installation fault acceptance.
5. **Observed B2 input integration defect (not edited):** in
   web.ts input_private, both the viewer and frame projections passed to D's
   authorizeManualInput omit `task_id:t.id`; D requires those associations and
   will refuse before RPC. Add both in B ownership. The factory must also perform
   final current input authority checks immediately after its page/session awaits
   and before actual CDP send; service-side resolve alone does not prove this.
6. Guarded back/forward/reload/tab-switch UI controls remain disabled; no generic
   click/Enter/navigation bypass was added. Actual service/web run attachment,
   queue/offer/crash races, heartbeat/cancellation physical latency and complete
   output-sink drain still require end-to-end acceptance on the installed bridges.
7. **Final source inventories are stale** after A2b's parallel freeze. Do not
   activate or claim green runtime gates. A2b/coordinator must run the owned
   source-only `node deploy/browser/refresh-production-sources.mjs`, review its
   delta and rerun check + runtime-boundaries, then new root acceptance. A2a did
   not edit A2b-owned deploy files. Latest checks explicitly retain this failure.

No browser, server, Next dev/build/start, sudo/systemctl, runtime install, package
install, live database/service, /opt-/etc-/run-browser write, or deploy was run.
No exit137/Killed. All DB connections came through explicit disposable harness
URLs; test cluster tag browser-p1-a2a-1107q was explicitly stopped.

## Verification (one test file at a time)

The first27 new adversarial expectations were written before implementation;
additional service/audit/retention/MCP and DB cases brought the new files to
43 +13 =56 passing. Tests use fake factory/CLI boundaries, no actual Chromium.
| File | Pass | Fail |
|---|---:|---:|
| ask-private-query-scan.test.mjs | 11 | 0 |
| ask-thread-access-db.test.mjs | 33 | 0 |
| ask-thread-recovery-db.test.mjs | 43 | 0 |
| browser-acceptance-drivers.test.mjs | 11 | 0 |
| browser-acceptance-integration.test.mjs | 42 | 0 |
| browser-contract.test.mjs | 40 | 0 |
| browser-controller.test.mjs | 101 | 0 |
| browser-flags-db.test.mjs | 12 | 0 |
| browser-launcher.test.mjs | 15 | 0 |
| browser-multiturn-db.test.mjs | 5 | 0 |
| browser-parser-adapter.test.mjs | 44 | 0 |
| browser-playwright-patch.test.mjs | 30 | 0 |
| browser-response-budget.test.mjs | 13 | 0 |
| browser-roles-db.test.mjs | 12 | 0 |
| browser-root-runner.test.mjs | 17 | 0 |
| browser-round1.test.mjs | 69 | 0 |
| browser-round2.test.mjs | 26 | 0 |
| browser-run-profile.test.mjs | 14 | 0 |
| browser-runtime-startup.test.mjs | 21 | 0 |
| browser-schema-db.test.mjs | 31 | 0 |
| browser-supervisor.test.mjs | 18 | 0 |
| browser-transport.test.mjs | 1 | 0 |
| db-roles-manifest-db.test.mjs | 7 | 0 |
| db-roles-paths-db.test.mjs | 4 | 0 |
| browser-phase1-bridges.test.mjs | 43 | 0 |
| browser-phase1-bridges-db.test.mjs | 13 | 0 |
| browser-private.test.mjs | 22 | 0 |
| browser-read-manifest-db.test.mjs | 26 | 0 |
| browser-submit-guard.test.mjs | 20 | 0 |
| browser-outbound-data.test.mjs | 31 | 0 |
| browser-egress-gate.test.mjs | 27 | 0 |
| browser-network.test.mjs | 94 | 0 |
| browser-runtime-gate.test.mjs | 61 | 0 |
| browser-runtime-boundaries.test.mjs | 18 | 1 |

Total: 975 passed, 1 failed across 34 files. No skips.

The single final failure is runtime-boundaries test16: exact installed-source
manifest hashes. It was19/19 at the earlier A2b freeze, then18/19 after later
A2a edits. `node deploy/browser/refresh-production-sources.mjs --check` exits1
with BROWSER_SOURCES_STALE:deploy/browser/playwright-patch/launcher-files.json.
This is a real final gate failure, not waived by an earlier green run.

Locked tsc (`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`): **exit0**.
`node scripts/db-roles-scan.mjs --diff`: **exit0**, sjcos_browser **0 tables**;
existing agent179/worker163 conservative/withheld inventories remain. No broad
or forbidden narrow grants were introduced. `git diff --check`: exit0.
Private SQL/source census refreshed with explicit query/function/source hashes
for A2a SQL/repository/retention/launch and reviewed B2 website/current manifest /
queue/frame/answer SQL; A2b extraction-string match is marked static non-SQL.

## Root-hashed files changed by A2a

lib/browser/{agent-runtime,audit-service,cli-launch,controller-mcp,controller-rpc,
phase1-contracts,repository,service,production-bridge,retention,timers}.mjs;
scripts/{run-browser-agent,sjcos-browser,browser-retention}.mjs (new retention CLI
must join the install allowlist). The latter bridges/new imports need inclusion
where not already covered by A2b's all-browser-module source inventory.

At the last read-only hash check, these existing lock entries mismatched:
agent-runtime.mjs, controller-mcp.mjs, controller-rpc.mjs, service.mjs. Later
audit/production-bridge changes also require refresh. Old 0b source-lock/root
acceptance evidence does not attest this candidate; rerun exact-candidate root
network28/RSS15, real1248 hostile privacy canary, real CLI/MCP/history/credential
isolation, staff parity, Cloudflare/TLS/SSE/device/IME and UI visual acceptance.
