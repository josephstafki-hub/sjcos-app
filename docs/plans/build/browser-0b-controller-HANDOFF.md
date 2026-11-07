# Browser Phase 0b controller candidate — INCOMPLETE

Implementation sub-agent T2, 2026-11-06, based on `28b3f6a7`, branch
`t3/browser-0b-acceptance`. No push, deployment, source-lock edits, dependency
installation, Chromium, browser, server, namespace, capture, database or live
service action. No subagents. T1's Python/transport files were not edited or
staged. All existing release/feature flags remain OFF.

**This does not finish the requested controller job. The assembled root network
runner still cannot pass.** The signed authority, guarded policy and adapter
candidate below are implemented and tested offline; real fixture orchestration,
the final event integration, and root runtime/MCP assembly remain code work.
Do not remove the existing integration blockers or enable acceptance from these
test results. No independent review/signature or real acceptance is claimed.

## Implemented components and evidence

- `deploy/browser/controller-adapter.mjs` is the fixed install wrapper for
  `/opt/sjcos-browser/controller-adapter.mjs`. It checks protected root ownership
  and every installed source-lock hash BEFORE importing the implementation;
  required imports cannot silently disappear from the lock. The implementation
  is `lib/browser/controller-adapter.mjs`. Imports start no processes/services.
  Three new integration tests cover root-only refusal, DB-less refusal and the
  complete source-graph verification boundary.
- `prepareAcceptance({runId,config})` returns the launcher's attestation,
  `verifySignature`, user/task, uid/gid, policy, onPort and cleanup options.
  It checks config uid/gid against `/etc/passwd`'s `sjcos-browser` entry (no account
  IDs embedded in source), binds run/task/user/OS boot identities, and verifies
  the independent reviewer signature against the exact installed lock. Its
  signature callback re-verifies expiry and exact attestation content. There
  is no readiness bypass or self-signing bootstrap.
- `controller-authority.mjs`: exact Ed25519 envelopes and canonical signed JSON,
  explicit purpose/schema/lifetime, task/user/run/boot binding, exact method,
  URL, request kind, body SHA256 and full requestDigest. A read manifest cannot
  authorize POST/PUT/PATCH/DELETE; writes require the separately signed action
  purpose. The wire requestDigest is SHA256 of canonical sorted-key JSON
  `{method,url,headers,bodySha256}`, matching T1's frozen projection.
  Duplicate keys, extra fields, wrong keys, tampering and wildcard URLs refuse.
- Manifest IDs are claimed once with exclusive `O_NOFOLLOW` files, file fsync
  and directory fsync. The manifest ID claim also rejects a differently signed
  revision with the same ID. Each exact request has an independently exclusive
  consume claim, so concurrent callers cannot both dispatch. An independent
  signed checkpoint ACK is verified and durably recorded before a receipt is
  released. Refused/ambiguous checkpoint burns the consume; no retry. Writes
  are conservative `unknown` before dispatch; boot and terminal revocation
  persist idempotent unknown/no-retry records. Receipts live under
  `/var/lib/sjcos-browser/controller-receipts`, not volatile `/run`.
- `controller.mjs`: one listener/context, up to two contexts/two tabs each,
  distinct target guards, a synchronous boot death fence, and idempotent
  boot-wide revoke. Pending binds, authority checks, gate registrations,
  `Fetch.continueRequest` and auth cancellation all cross live fences after
  awaits. Detached/crashed sessions revoke. Gate close is attempted even if
  unknown persistence fails. `target-barrier.mjs` now passes its own `isLive`
  predicate to a direct registerFetch callback too.
- Profile setup requires fresh empty home/profile directories, exact uid/gid,
  private modes and no symlinks. It creates only `HOME/.pki/nssdb`, uses fixed
  `/opt/sjcos-browser/nss/usr/bin/certutil`, imports one fixture CA, compares
  exported X509 DER to that CA and rejects an additional trust-root inventory.
  No ambient Chrome profile, ignored-certificate flag or system trust import.
  `createFixtureCA`/`withFixtureCA` use real OpenSSL RSA3072/SHA256/one-day CA
  generation. Keys stay in a root-private run subdirectory and are removed in
  finally, including partial OpenSSL failure. Real OpenSSL key lifecycle and
  fake certutil inventory tests pass; installed NSS was not run.
- `controller-rpc.mjs`: bounded <=32768-byte length-framed metadata RPC,
  fragmented framing, trailing-frame rejection, protected socket parents and
  root-owned endpoint checks, bounded calls. Production policy socket is root
  0600. Group-writable MCP socket is allowed only beneath a nonwritable root
  parent; its own root owner/type/other-permissions are checked separately.
- `controller-gate.mjs`: T1 metadata ABI with kernel listener cookie/generation,
  registered target guard and Fetch correlation, complete DNS chain/address
  validation, exact CONNECT/Host/SNI, frozen request digest, one-use durable
  authority, bounded dispatch decision, fresh connect and actual peer checks.
  Exact digest correlation is registered over gate control from the request
  policy callback before returning the dispatch decision. Later events use the
  selected target guard. Terminal unknown/close uses the saved binding even
  after boot revocation. Positive fake-wire tests cover the actual transition
  sequence and consumed-write terminal receipt, with negative digest/DNS tests.
- `browserMcpDependencies` supplies explicit narrow `sjcos_browser` connection
  through the separately installed pg package. `databaseEnabled:false` refuses
  before importing pg or opening any connection; no ambient DSN/default DB.
  Every authorize/invoke/observation-context operation reaches the dedicated
  authority, including reauthorization on invoke. `controller-mcp.mjs` supplies
  that authority's durable broker-claim hash, kernel peer, live PID/start,
  executable/script digest, cgroup, task/principal and revocation checks. Its
  fixed Python stdlib relay reads SO_PEERCRED, never JSON peerPid, before private
  stdio delivery. The relay is NOT started by imports/tests. MCP entry passes
  protected config to dependencies. Root task-handler/relay startup remains
  to be assembled; no working MCP service is claimed.
- `controller-network.mjs` contains all 21 P names, actual namespace tcpdump
  capture code (never run here), bounded binary pcap parsing/hashing, and strict
  per-case event/run/order requirements. Offline I/O-injected tests exercise the
  21 capture/action intervals and every case's missing-event failure. These
  are **unit tests**, never packet evidence. `controller-scenarios.mjs` is an
  unfinished scenario sketch, NOT a usable root fixture driver; see below.
- Launcher entry destroys adapter/CA authority before emitting evidence. Its
  error/finally path emits stable refusal and no unhandled cleanup exception.

## Tests and resource compliance

Expectations were written first: the first controller-file invocation failed
`ERR_MODULE_NOT_FOUND` before any implementation. The initial 32 cases include
more than 25 fresh adversarial cases. Later tests broaden wire, profile, MCP
and packet-validator coverage. Each test file was run separately/sequentially
with a distinct `SJC_TEST_CLUSTER_TAG=b0bc-*`.

| Test file | Pass | Fail |
| --- | ---: | ---: |
| browser-controller.test.mjs | 84 | 0 |
| browser-launcher.test.mjs | 14 | 0 |
| browser-acceptance-integration.test.mjs | 33 | 0 |
| browser-playwright-patch.test.mjs | 29 | 0 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Node syntax checks, embedded peer-relay Python compile-only check and
`git diff --check` pass. No DB test/cluster was started, so no cluster required
stopping. Integration's existing filesystem journal tests were run offline.
No Next dev/build/start, browser, test listener or root process was started.
The only crypto subprocesses executed were OpenSSL CA generation in private
throwaway unit-test directories; every directory/key was removed in finally.
No exit137/Killed and no resource-limit retry.

## Exact config / installation needs (NOT performed)

1. Coordinator regenerates `deploy/browser/runtime-lock.json` AND
   `deploy/browser/playwright-patch/launcher-files.json` after T1/T2 finish.
   Add all eight `lib/browser/controller*.mjs` files and the install wrapper;
   include existing transitive imports (`gate`, `response-budget`, contracts,
   network policy, startup, protected bootstrap, acceptance attestation and
   runtime readiness). Refresh changed launcher/MCP/barrier source hashes.
   No lock-hash assertion was weakened.
2. Install the wrapper verbatim as `/opt/sjcos-browser/controller-adapter.mjs`,
   and its complete source graph beneath `/opt/sjcos-browser/node/source` using
   the root installer/hash inventory. Configure root-protected acceptance.json:
   `adapter` fixed path, `adapterSha256` wrapper SHA256, numeric `uid`/`gid` from
   the provisioned account, `databaseEnabled:false`. Keep `enabled:false` until
   the remaining implementation and candidate-launch review are resolved.
3. Provision root-private `/var/lib/sjcos-browser/controller-receipts` (0700),
   root-protected `/etc/sjcos-browser/runs`, and existing protected `/run`
   directories. Per run file: `{runId,userId,taskId,bootId,manifests,networkConfig}`.
   `bootId` is the real `/proc/sys/kernel/random/boot_id`; UUIDs are canonical.
   `networkConfig` is `{appHosts,serviceHosts,hostPublicAddresses}` with the
   complete real deny inventory. The code deliberately never fills this from
   guesses or model argv.
4. Independent authority public key:
   `/etc/sjcos-browser/controller-ed25519.pub`. Manifest envelope exactly
   `{payload,signature}` with canonical base64. Signed canonical document:
   `{format:1,purpose:"browser-read-manifest"|"browser-action-manifest",
   manifestId,runId,taskId,userId,bootId,revision,issuedAt,expiresAt,requests}`.
   Integer ms times, currently <=60000ms lifetime. Each request exactly
   `{method,url,kind,bodySha256,requestDigest}`. Full digest definition above.
   This adapter supplies no private signer or signing shortcut.
5. Independent sink public key:
   `/etc/sjcos-browser/checkpoint-ed25519.pub`; root-owned checkpoint socket
   `/run/sjcos-browser/checkpoint.sock`. Request `{v:1,event:"checkpoint",record}`;
   reply `{ok:true,envelope}` whose independently signed canonical payload is
   `{purpose:"browser-controller-checkpoint",...record}`. `record` is exactly
   `{id,digest,runId,bootId,kind}` from the fsynced consume. Sink must persist
   before signing/ACK. No sink daemon/key was provisioned or run here.
6. Existing independent runtime attestation/reviewer key are still required.
   Current readiness still needs completed network/RSS/etc evidence. Resolve
   the candidate-launch/bootstrap circularity through separate review, not a
   `()=>true` callback, forged acceptance bit, or `enabled` alone.
7. Gate endpoint expected `/run/sjcos-browser/gate-<runId>.sock`; policy endpoint
   produced `/run/sjcos-browser/controller-<runId>.sock`. T1 CLI config and
   cgroup/namespace process lifecycle must be assembled before a real launch.
   Generated CA/leaf material is not yet handed to gate/fixture startup.
8. A future DB-enabled MCP assembly must install/pin pg in the isolated Node
   tree, provision only broker-delivered narrow credentials, start the kernel
   peer relay at `/run/sjcos-browser/mcp-controller.sock`, and provide actual
   authorized task handlers. Do not enable DB mode just to bypass refusal.

## Remaining implementation blockers — not root verification chores

- `runNetworkCases` cannot yet run through the existing launcher runtime.
  `controller-scenarios.mjs` sketches stimuli but expects `runtime.openCase`,
  `progress`, fresh fault-isolated browser boots, fixture URLs/control and
  `detachFetch`. The existing launchBrowser returns none of that harness.
  These need real implementation, with CA cleanup across all boots.
- The sketch's `case_begin`/`case_end` envelope and fault commands predate T1's
  final controls. T1 currently exposes `case_begin {name}`, `events`/`case_end`
  returning raw hook/flow events, and `fault_arm {point,action}`. Do NOT run the
  sketch as if it were compatible. Join actual gate events, policy target
  events and plaintext fixture ingress observations, preserve dropped-event
  refusal, and derive measurements from those plus captures. No current gate
  stream naturally has the higher-level event names required by the P validator.
- Disposable fixture DNS (pinned Unbound), real TLS/HTTP origin/proxy401/407,
  mixed/CNAME-private/rebinding replies, real peer/SNI/Host stimuli, positive
  ingress control, plaintext unauthorized byte accounting, root gate cgroup
  and children teardown are not orchestrated by this candidate. Requiring these
  surfaces is not implementing them; no helper counter may fill the gap.
- `createMcpAuthority`/`serveMcpAuthority` are implemented primitives, but the
  protected entry does not start/attach the root task handler service. DB-less
  mode intentionally refuses before the missing service can matter. No claim
  is made of complete authorized browser action workflows.
- The full protected `prepareAcceptance` path and its lifecycle have not been
  root-executed; its returned options and authority internals have offline
  coverage only. Actual gate startup, certificate transfer, installed certutil,
  root namespace/packet runs, browser sandbox/RSS and independent review remain.

Do not promote `parserTransportIntegrated`, `releaseReady`, signatures or flags
based on this handoff. The parent was notified of these blockers during work.
