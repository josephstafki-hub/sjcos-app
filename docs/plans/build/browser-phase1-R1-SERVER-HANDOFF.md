# R1 SERVER contract (published before implementation)

## Guarded navigation — UI / FACTORY seam

POST `/api/agent-browser/sessions/:id/control`, JSON:
```json
{"action":"reload","viewer_id":"UUID","device_secret":"base64url43","expected_epoch":4,"idempotency_key":"UUID","expected_document_epoch":2,"context_generation":1,"read_manifest_revision":3}
```
`action`: `back|forward|reload|switch_tab`; `switch_tab` additionally requires `target_id` from the response. Every navigation requires all four numeric epoch/revision bindings. Response: existing BrowserStatus plus
```json
{"navigation":{"context_generation":1,"document_epoch":2,"read_manifest_revision":3,"target_ids":["target-id"]},"available_controls":["stop","back","reload"]}
```
`navigation` is null unless guarded public navigation is available. Enable only actions in `available_controls`. Refresh status/review after each action; missing reviewed reads must prompt deliberate review and a NEW action, never automatic replay. Factory exports fixed `navigationState(record)`, `prepareNavigation(record,request)`, `guardedNavigation(record,{action,target_id,prepared,reauthorize})`; service binds those hooks. `reauthorize` is mandatory immediately before the fixed CDP send; no arbitrary click/Enter.

## Checkpoint replay — FACTORY exporter seam

Original durable record stays byte-for-byte in the spool:
```json
{"v":1,"seq":42,"digest":"64hex","time":"2026-11-07T00:00:00.000Z","install_id":"UUID","boot_id":"UUID","sig":"base64-Ed25519"}
```
Replay wire envelope adds ONLY `replay_at` and `replay_sig`:
```json
{"v":1,"seq":42,"digest":"64hex","time":"2026-11-07T00:00:00.000Z","install_id":"UUID","boot_id":"UUID","sig":"original-signature","replay_at":"2026-11-07T00:03:01.000Z","replay_sig":"base64-Ed25519"}
```
`sig` signs canonical original payload excluding sig. `replay_sig` signs canonical envelope excluding replay_sig, INCLUDING original sig and fresh replay_at, with the same pinned controller key. Exporter verifies BOTH signatures, original time <= replay_at, replay_at within 120s of now, and unchanged install/boot/seq/digest continuity (same seq/digest reconciles uncertain sink ACK). Old time accepted only with valid fresh replay envelope. Sink object retains original record, not refresh fields, so retries are identical. JS verifies sink ACK, commits SQL, then removes spool. No skipped/dropped record.

Implementation and validation results will be appended below.

## Additional live seams (for concurrent builders)

Pre-frame stream binding: authenticated SSE `state` has optional `stream_id:UUID` and `stream_generation:positive integer` (both emitted by SERVER from the current viewer before the first frame). UI captures these immediately and uses existing stream-close POST before aborting. BrowserJoin also includes those two fields, but each event connection's state is authoritative after rotation.

FACTORY discovery agreement: `authority.discoverFetch(request,{targetId})` rechecks binding/lifecycle then classifies exact-public provenance and invokes trusted `stageDiscovery({task,proposal})`; resolves `true` only after website proof + pending candidate COMMIT. Gate should try this ONLY on `authorizeFetch === false` (not exceptions), fail the original Fetch with BlockedByClient, and return without fatal. Binding/transport errors remain fatal. `createProductionReadBridge` accepts protected `stageDiscovery` callback and `confirmedFactsFor`; website `createWebsiteDiscovery` supplies the proof + durable candidates. No transmit or replay occurs during discovery. Gate preparation can stage discovery and return reviewed:false for a missing reviewed document. Listener generation must use `task.listener_generation`, independently of `context_generation`.

Kernel boot identity is stable across fresh anonymous contexts. `new_boot_id` in the legacy fresh proof equals the trusted kernel boot; context_generation and listener_generation rotate instead. No random UUID is passed as broker kernel proof. Initial SQL queue offer persists the trusted service boot; accept validates that offered identity and sets context_generation=1.

Continuation: createWebsiteStart checks reviewed next-document reads itself under the website transaction, attaches a distinct immutable run, issues capability after SQL resume fence, and sends a new authenticated control/resume proof after activation to bindAttachedContext before held runner release. No additional runner hooks are required. SQL retains historical current_run_id after normal turn end for Watch claims; attachment permits it only after its immutable run ended/capability was revoked. active_run_id is null while paused. Public pause drains through factory.pausePublic; resume rotates listener generation at attachment and calls factory.resumePublic with fresh full task/capability authorization. Fresh destroys the old private context and stages new human review before any new public turn.

## Final private Watch UI signal

`private_view_status: 'required'|'pending_audit'|'authorized'|'unavailable'` is emitted on BrowserStatus/Join and SSE state. `required`: no current post-transition consent (including invalidated old consent). `pending_audit`: current consent staged but exact independently checkpointed audit ACK not committed. `authorized`: exact owner/sid/viewer/context/stream/generation consent is independently anchored (initiator can view own private context). `unavailable`: unsupported secret/vault mode. Public task reports required; it cannot pre-authorize private viewing. Join returns pending during sink/SQL outage; reconnect/retry never treats callback success as proof. Frames remain forbidden until SQL verifies the binding. Poll status during pending/recovery; a failed private stream does not grant viewing.

Sites accepts exact `proposal` and reuses existing allowed origins for new paths. It never duplicates the OriginManifest entry. Both new origin and same-origin new path stage a new pending candidate revision; neither navigates or approves.

Checkpoint seq is the AUDIT head, not a consecutive checkpoint counter. Minute/100-event checkpoints may advance 42→142. The FACTORY exporter now accepts monotonic advancement or exact same seq/digest reconciliation; the client still drains every stored record in order.

## Implemented judge fixes and regression evidence

| Judge item (original finding locations) | Final server change | Regression files |
|---|---|---|
| Engineering 1 (`web.ts:129`, `0115:664`, `service:25`, gate generation) | Trusted queue offer persists kernel boot; accept rejects missing/mismatched offered boot and creates context generation 1. Runtime access returns independently bound listener generation and safe person/attendance metadata. | browser-phase1-bridges-db: actual admission→offer→accept→attach/capability→service.open→gate |
| Engineering 2 (`production-bridge:112,171,177`, `0115:493,377`) | Committed Continue checks reviewed reads before reserving; retains ended run IDs, attaches a distinct immutable run, rotates listener at attachment, issues capability after control fence, sends fresh persisted RPC proof, binds/reopens context before held runner release. Public pause drains factory/gate; resume reauthorizes new run before/after rebind. Private fresh destroys old context and needs new reviewed reads. | browser-phase1-bridges-db (waiting, completed, private→fresh→new turn), browser-production-factory integrated service/factory/gate, browser-r1-server |
| Engineering 3 (`service:180`) | Tick checks lifecycle eligibility even for private/paused/fenced contexts, independent of revoked capability. Dedicated function checks session, flags, active person, areas and owned thread; vault-none manual mode remains independent of vault flag. | browser-phase1-bridges-db (master/staff/session/rights/inactive), browser-r1-server |
| Engineering 4 (gate:53/read-manifest:72/repository:87) | Exact-public discovery rechecks trusted catalog/private facts and binding, commits authenticated website candidate revision, exposes original deadlines and durable review notice. Original Fetch fails without replay/fatal; exact new-site/path proposals reuse origins and stage document+resources. | browser-read-manifest-db integrated missing asset→review→explicit reload; browser-routes Sites schema |
| Engineering 5 SERVER/TYPES | Fixed hooks bound in createServiceIO, strict epoch/target schemas, typed navigation projection and advertised controls. Known recoverable RPC outcomes preserved. | browser-r1-server, browser-routes, browser-website-bridge, browser-production-factory |
| Engineering 6 (`retention:14`) | Owner-only durable completed ledger excludes scrubbed tasks, including cache-only tasks. Cache complete ACK precedes durable completion; SQL/cache crashes replay idempotently. | browser-phase1-bridges-db (>batch-size, expired session, cache ACK loss), browser-phase1-bridges |
| Engineering 7 CLIENT (`checkpoint-client:54`, audit-service:106) | Original signed record remains fsynced; every send signs fresh replay envelope; verified sink ACK → SQL checkpoint commit → spool removal. Exact duplicate committed checkpoint is idempotent. | browser-r1-server (>181s, client restart, SQL ACK loss), browser-audit-checkpoint; FACTORY cross-language protocol tests |
| Engineering 8 adjacent executable seam | cli-launch uses provisioned `/usr/bin/node` matching factory/broker installer contract. | browser-run-profile, browser-runtime-startup; FACTORY installer conformance |
| Engineering 9 SERVER (`phase1-contracts:34`) | Join and authenticated SSE state expose stream identity before JPEG. Planned close remains exact viewer+stream proof and ACK-before-abort. | browser-routes/browser-live-view; UI no-frame/two-device regression in UI commit |
| Engineering 10 CONTRACTS (`phase1-contracts:37`) | Canonical finite half-open fractional pointer/wheel coordinates retained through factory. | browser-r1-server and FACTORY adapter tests |
| Engineering 11 (`routes:26`, egress:6, privacy census) | Real bridge exports restored to route fixture; one injected clock creates/verifies manifest; changed private SQL and enclosing sources explicitly reviewed. QA-owned entries merged only from their supplied exact audit hashes. | browser-routes, browser-egress-gate, ask-private-query-scan |
| Security 1 (`0115:200,207,462`, web:64,173) | Public advance consent rejected; takeover clears consent atomically; new private consent binds post-transition generation/stream. | browser-phase1-bridges-db plus UI invalidation/re-ask |
| Security 2 (`controller-rpc:107–108`) | Claim nonce synchronously after validation, before await; failures burn nonce; expiry/closure/current authority checked before subscription. | browser-r1-server (concurrent, delayed expiry, disconnect, failed-first replay) |
| Security 3 (`0115:200–209`, web:64,173–175, bridge:131) | Signed content-free owner/sid/viewer/context/stream consent audit must be appended AND independently checkpointed. SQL predicate gates stream-open, production frame handshake/per-frame and website frame recording. Outbox/callback success gives no authority. | browser-phase1-bridges-db (wrong binding, outage, recovery, stream rotation), browser-routes status signal, UI no pending subscriptions |

Additional safety: public output tickets belong to one fence instance. Replacing a fence for a new public turn cannot revive any old observation ticket. `readTask` remains strict TaskSafe for privacy; `readRuntimeTask` returns the extended safe runtime metadata for factory reauthorization, without URLs, page strings or capability material.

## Database/roles

0115 remains the sole unapplied migration. New `browser_retention_progress` is owner-only. Exact output of `node scripts/db-roles-sql.mjs browser_retention_progress` is **empty** (no grants to paste). Matching manifest note added. New narrowly scoped `browser_runtime_access(uuid,uuid,bigint,uuid,uuid,bigint)` has SECURITY DEFINER SET search_path=public,pg_temp; PUBLIC revoked; only sjcos_browser EXECUTE, mirrored in manifest. No narrow table writes or approval authority were granted.

## Coordinator checks retained

No root inventory refresh, installation, browser/server, Next build, live database, QA :5499 cluster or service action was performed. No exit 137/Killed. Flags stay off. Coordinator must refresh combined root/launcher source inventories and re-attest exact bytes, then perform actual WORM/transport/privacy/navigation and device/visual acceptance. In particular check Browser→Chat and Browser→Canvas before first JPEG on two devices: planned-close ACK precedes abort, attendance remains, no unintended pause; failed ACK retains accidental-loss handling.


Private-consent race detail: join proofs bind the observed private context AND task revision. A proof staged before takeover is stale afterward, even if the join waits on the task lock. Each explicit Show the page consent also advances a per-viewer consent serial in the audit binding, so renewed consent cannot reuse an older ACK or depend on sub-millisecond timestamp ordering.

## Final verification

All files executed individually, with `SJC_TEST_CLUSTER_TAG=browser-p1-r1s-7f41`; final run has no failed/skipped/cancelled tests. Earlier failures were corrected fixtures or development regressions and were rerun. Test DB was recreated through the harness after 0115 edits, never against live or QA clusters.

| File (`tests/*.test.mjs`) | Pass / fail |
|---|---:|
| ask-private-query-scan | 11 / 0 |
| browser-audit-checkpoint | 11 / 0 |
| browser-checkpoint-exporter | 23 / 0 |
| browser-contract | 40 / 0 |
| browser-controller | 101 / 0 |
| browser-egress-gate | 27 / 0 |
| browser-flags-db | 12 / 0 |
| browser-live-view | 13 / 0 |
| browser-login-return | 5 / 0 |
| browser-multiturn-db | 5 / 0 |
| browser-network | 94 / 0 |
| browser-outbound-data | 31 / 0 |
| browser-phase1-bridges-db | 24 / 0 |
| browser-phase1-bridges | 43 / 0 |
| browser-private | 22 / 0 |
| browser-production-factory | 57 / 0 |
| browser-r1-server | 14 / 0 |
| browser-read-manifest-db | 27 / 0 |
| browser-roles-db | 12 / 0 |
| browser-routes | 45 / 0 |
| browser-run-profile | 14 / 0 |
| browser-runtime-gate | 61 / 0 |
| browser-runtime-startup | 21 / 0 |
| browser-schema-db | 31 / 0 |
| browser-submit-guard | 20 / 0 |
| browser-supervisor | 18 / 0 |
| browser-website-bridge | 22 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |

Total: **815 passed**, 0 failed. Locked `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**. `node scripts/db-roles-scan.mjs --diff`: **exit 0**, browser 0 table-write differences; existing intentionally withheld agent/worker differences remain. `git diff --check`: exit 0.

## Root-hashed files changed by SERVER

The existing runtime-lock/launcher inventory intersection is:

- lib/browser/audit-checkpoint-client.mjs
- lib/browser/cli-launch.mjs
- lib/browser/controller-rpc.mjs
- lib/browser/phase1-contracts.mjs
- lib/browser/privacy.mjs
- lib/browser/production-bridge.mjs
- lib/browser/read-authority.mjs
- lib/browser/retention.mjs
- lib/browser/service.mjs
- lib/browser/web-transport.mjs
- lib/browser/website-bridge.mjs

Also changed `scripts/sjcos-browser.mjs`, separately pinned by the installer signed bundle's `scriptHashes`; coordinator must renew that script digest too. No inventory was refreshed here.

All assigned server findings are fixed in source; no required server fix is intentionally deferred. Actual installed/runtime/device acceptance stays with the coordinator. No push or deploy.
