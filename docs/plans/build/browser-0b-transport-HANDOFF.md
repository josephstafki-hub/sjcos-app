# Browser Phase 0b transport handoff — local implementation complete; acceptance OFF

2026-11-06. T1 implementation sub-agent. Started at 28b3f6a7; T2 independently
committed its owned controller files as 271c2384 while this work was in progress.
No subagents, sudo, install, external network, browser, Next server/build, live DB,
live service, deploy, lock edits, flag changes, or push. Only process-local
loopback TLS/DNS/TCP sockets were opened by the named tests; they are closed.

## Implemented and evidence

- **Real connection/TLS integration:** `TransportHandler(ConnectionHandler)`
  drives actual 12.3.1 HTTP/server hook objects through RuntimeAdapter, actual
  ClientTLSLayer/ServerTLSLayer handshake implementations and OpenSSL BIOs.
  `BoundedTLS` replaces growing plaintext collection; fixed socket ingress and
  BoundedParser replace stock asyncio/HttpStream allocation. Dedicated CLI and
  root-peer control/policy channels provide a concrete launch entrypoint.
  Evidence: `test_real_connection_handler`, `test_real_tls_layer_classes`,
  `test_real_client_tls_and_bounded_request`,
  `test_real_server_tls_trust_and_hostname`,
  `test_actual_connect_hook_tls_consume_failure_cleanup`.
- **Preallocation, queues and deadlines:** 56/112/24 MiB separate pools;
  2 MiB transport scratch precharged before socket/TLS buffers; exact mutable +
  frozen body reservations; <=32 KiB/128-field heads, <=25 MiB bodies. Expect,
  duplicate lengths, encoding, upload chunking/unknown/oversize lengths rejected
  before body allocation. TLS records <=18432, plaintext fragments <=16384,
  handshake/control-without-plaintext <=64 KiB; no compression, renegotiation,
  tickets or session cache. Directional application and requested Linux socket
  buffers <=64 KiB. Partial sends counted at actual nonblocking socket send.
  Original accept+60s and body+15s are never refreshed; DNS/dial/TLS/proof expiry
  use the same monotonic clock. Evidence: `test_preallocation_*`,
  `test_tls_handshake_limit`, `test_tls_post_handshake_control_flood_prechecked`,
  `test_directional_queue_limit`, `test_transport_reserved_before_tls`,
  `test_original_deadline`, `test_runtime_proof_does_not_refresh_rpc_deadline`,
  adapter `test_transport_precharge_*` and existing 41 parser regressions.
- **Exactly two response slots, real drain and terminal cleanup:** two globally,
  one/context; a response hook never frees the slot. Success requires complete
  kernel sends and policy terminal ACK. Consumed writes persist unknown once;
  client upload abort, real upstream RST after successful TLS, malformed TLS
  after CONNECT, timeout, revoke and failed durability close sockets and clean
  owner/parser/HTTP/TLS references. External cancellation keeps reservations
  charged until async send frames unwind; control revoke waits for settlement
  before reporting ACK/reuse. Evidence:
  `test_two_real_slow_response_slots_until_drain`,
  `test_actual_blocked_socket_holds_response_slot`,
  `test_client_abort_cleanup`, `test_upstream_reset_cleanup`,
  `test_tls_failure_cleanup`, `test_timeout_cleanup`,
  `test_revoke_consumed_unknown_once`,
  `test_unknown_durability_failure_revokes_every_socket`,
  `test_external_revoke_retains_charge_until_send_unwinds`.
- **Kernel listener identity and guarded target correlation:** listening FD's
  Linux SO_COOKIE + accepted socket getsockname bind the context/generation.
  Listener FD closes before reuse. Old-cookie/generation replies fail after
  every await. Root-only guard registrations support multiple targets/pages in
  one context; exact parser digest selects one paused-Fetch registered pair.
  Target identity comes from authenticated controller registration, not a
  fictitious TCP target identity or request header. Evidence:
  `test_listener_identity_kernel_cookie`, `test_socket_wrong_listener_refused`,
  `test_generation_reuse_refused`, `test_revoke_closes_listener_before_rebind`,
  `test_old_generation_decision_refused`, `test_policy_wrong_cookie_refused`,
  `test_same_context_multiple_target_guards`, `test_fetch_digest_single_use`.
- **Fresh DNS, pin, Host, SNI and trust:** each actual new socket repeats bounded
  CNAME/A/AAAA for every chain link through pinned Unbound 10.204.0.2:53 TCP.
  No libc DNS, alternate resolver, hostname dial, private/mixed-answer salvage,
  mapped/translation/metadata/loopback fallback. Peer is kernel getpeername;
  OpenSSL verifies chain AND hostname (CN fallback disabled). Evidence:
  `test_dns_wire_through_real_loopback_socket`, `test_dns_cname_a_aaaa_each_link`,
  `test_dns_cname_loop_refused`, `test_dns_private_in_mixed_answer_refused`,
  `test_dns_private_metadata_loopback_refused`,
  `test_fresh_dns_rebinding_per_socket`, `test_peer_mismatch_refused`,
  `test_host_sni_mismatch`, `test_real_server_tls_wrong_hostname_refused`.
- **Controller/fixture surface:** protected config, uid-0 SO_PEERCRED on both
  Unix channels, <=32768-byte frames; bind/guard/fetch/revoke/revoke_all/stats,
  bounded actual events and case/fault controls. No body IPC/history/logging.
  Evidence: `test_config_cannot_self_attest`,
  `test_metadata_never_contains_body`, `test_digest_canonical_and_body_bound`,
  `test_fault_control_events_are_actual_and_bounded`, plus real CONNECT case.

The transport intentionally closes after one request/response. Pipelining and
second requests on the connection fail closed; no keepalive authorization is
retained. This is a concrete dedicated transport, not a marker attached to a
stock master. The existing addon and closed dispatcher remain available for the
old embedding ABI; the dedicated executable dispatches hooks itself with
boot-fatal exception handling and does not start DumpMaster or optional addons.

## Invocation / ABI

Authoritative full config, policy protocol and embedding contract:
`deploy/browser/parser-contract.md`.

```sh
/opt/sjcos-browser/py/bin/python -B /opt/sjcos-browser/transport_runtime.py --config /etc/sjcos-browser/<run>.json
```

Root-protected candidate config pins all seven Python sources; exactly fixed
namespace address 10.203.0.2 and ports 18081/18082. No config true-marker/signing
key/namespace bypass. Embedding returns runtime with `.adapter`; after sync
revoke, ALWAYS `await runtime.settled()` in finally before claiming zero retained
reservations. Root control ACK does this already. `settled(cookie)` waits only
for the revoked listener, leaving other contexts alone.

T2's controller request handler registers exact parser requestDigest through
`fetch` DURING the policy RPC before returning its decision; Python's policy
worker leaves control available. Multiple guards share the context listener;
registerDigest passes selected targetId/guardId, which later receipts preserve.
Canonical digest uses UTF-8 sorted-key JSON, matching JS canonical().

`case_begin {name}` starts telemetry only; it does not create a fixture URL.
`fault_arm` requires `{point,action}`, never `fault:<case-name>`. Supported points:
before_request_decision, after_consume, before_connect, after_connect,
before_drain. Actions: revoke_all, close_client, close_upstream, raise.
`events` exposes <=64 actual observations with droppedEvents, not fabricated
semantic case pass records. External namespace/origin/CDP fixtures supply DNS
answers, mismatched peer/SNI/Host, browser/worker/auth/fetch/packet evidence.

## Verification

Expectations FIRST: wrote 25 fresh adversarial transport cases and Node wrapper;
first execution failed missing transport_runtime. Added 24 more transport cases
and 3 adapter precharge regressions while implementing/reviewing. Final counts:

| Command | Passed | Failed |
| --- | ---: | ---: |
| `/opt/sjcos-browser/py/bin/python deploy/browser/transport_tests.py` | 49 | 0 |
| `/opt/sjcos-browser/py/bin/python deploy/browser/parser_adapter_tests.py` | 44 | 0 |
| `node --test tests/browser-transport.test.mjs` | 1 wrapper, same 49 cases | 0 |
| `node --test tests/browser-parser-adapter.test.mjs` | 44, same parser cases | 0 |

Node files run one at a time with distinct `SJC_TEST_CLUSTER_TAG` values.
No DB harness was started; explicit same-tag `scripts/test-db.mjs stop` reports
no cluster running. No DB URL/default or live connection was used.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Python AST syntax, CLI --help and `git diff --check`: pass. No exit 137/Killed.
No browser/visual check was run; no browser or server remains running from tests.

## Coordinator changes — do not set readiness from offline counters

- Refresh `acceptance.parserPatchSha256` to
  `a8b424037e37de756647d3cf87554dd5385700fc1bfcd9d3d0a6af9543d0f943`.
  This is the final `parser_adapter.py` SHA-256, not an aggregate bundle digest.
- Add/install/hash **transport_runtime.py, transport_tls.py, transport_dns.py,
  transport_control.py**, along with the existing adapter/addon/dispatcher.
  Update root provisioning/runtime inventory and controller launch orchestration
  in their owned paths. Source hashes for protected run-json are generated with
  SHA-256 of those exact seven files; do not put test files into the runtime.
- `parserTransportIntegrated` remains **false** in the unchanged lock. It can
  become true in reviewed evidence only once the installed launcher actually
  starts THIS transport and real namespace/network/RSS acceptance demonstrates
  the wiring. Do not infer this from stock startup or just passing tests.
- Keep releaseReady and all Browser flags OFF. Independent signed runtime
  acceptance, pinned binary/wheel review and root cgroup evidence remain required.

## NOT done; exact coordinator checks

1. **Installed uid-998 launch and Unix permissions:** no root writes/install were
   permitted. In the disposable gate namespace, launch the CLI above with the
   root-reviewed config, CA/key and source hashes; root controller must bind both
   listeners, register two target/guard pairs in one context, correlate exact
   digests, successfully proxy an authorized TLS request and read stats/events.
   Call revoke_all and require its durable ACK, stats flows=handlers=reservations=0,
   every pool zero, listeners=0, and no connection to either old listener.
   Root policy socket must be connectable by gate uid 998 while its peer remains
   uid 0. **Current T2 `serveController()` creates root0600**, inaccessible to
   uid998: coordinator must supply reviewed group/UID directory/socket access.
   Root CA/key paths similarly need dedicated read/search permissions. Python
   intentionally provides no credential/permission bypass. This is a real
   deployment prerequisite, not verified here.
2. **Real fixture orchestration/network scenarios:** T2's handoff explicitly
   remains incomplete. The telemetry/fault API above exists; fixture URLs,
   origin/Unbound/CDP stimuli, fresh boot per fatal case and semantic event/packet
   mapping are external runner work. Do not invent case events to fit its
   validator. Once supplied, exact root coordinator command (fresh label):

```sh
sudo systemd-run --scope --unit=browser-0b-network-t1transport20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-containment-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-0b-network-t1transport20261106.json
```

   Require all named network cases, positive ingress capture, zero unapproved
   upstream/private packets, fresh DNS rebind/peer/SNI/Host refusals and hook
   ordering from actual origin/parser/CDP observations. Root-owned candidate
   bootstrap must not bypass independent signed release readiness.

3. **Measured TLS/native allocation/cgroup RSS:** offline reservation accounting
   does not prove RSS. The installed real parser-transport/RSS fixture executable
   and root scope still need integration by the coordinator; no fake executable
   or fabricated measurement was added. Use the real CLI/control stats and
   supplied TLS/abort/slow-drain stimuli, not AllocationOwner-only counters.
   Exact root coordinator command after the fixture is supplied:

```sh
sudo systemd-run --scope --unit=browser-0b-rss-t1transport20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-rss-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-0b-rss-t1transport20261106.json
```

   Require all 15 RSS cases through actual bounded TLS/socket transport; baseline
   <=144 MiB, peak <=336 MiB within gate384 MiB, queues <=64 KiB, exactly two slow
   response slots, no cross-pool borrowing, zero retained flows/reservations after
   settled abort/reset/TLS failure/timeout/revoke, durable unknown/no retry, no
   OOM/latch. Helpers remain outside measured gate but inside child3G/150%/256.
   Verify Joe's common ancestor24G/800%/no-swap independently. Stop on exit137;
   never retry/raise caps or touch live services. These commands have NOT run.

The new transport closes the prior Python implementation gap. Full installed
Phase 0b acceptance is still incomplete, including runner work outside this
sub-agent's ownership; no network/RSS/release success is claimed.

## 2026-11-06 — RSS retained-flow/cancellation fix

Read the a23 `rss-diagnostics` observations, client configs, gate stderr and
origin log. Expectations-first loopback regressions reproduced both the missing
`flow_closed`/charged reservation after repeated cancellation and an unbounded
async decision await. A further regression reproduced a completed listener task
remaining in `accept_tasks` when its child join was cancelled.

The transport now bounds HTTP policy hooks to two seconds (also bounded by the
original flow deadline), treats cancellation as local termination rather than a
recursive boot revoke, cancels a socket owner only once, and finalizes storage and
listener bookkeeping in nested `finally` blocks. `finish` is idempotent. Unknown
persistence and actual downstream-drain requirements remain intact.

Proof in `transport_tests.py`:
- `test_rss_two_slow_readers_six_aborted_candidates`: real TLS/parsers, two blocked
  2 MiB responses charging 112 MiB, six preallocation refusals, successful drain,
  then six admitted clients aborting during policy; each finalizes within 750 ms,
  with one `flow_closed`, zero handlers/reservations/pools and no boot revoke.
- `test_request_decision_deadline_bounds_parked_policy`: a withheld policy reply
  times out at two seconds, finalizes, and forwards no upstream plaintext.
- `test_repeated_cancellation_during_monitor_cleanup_finalizes_once` and
  `test_listener_repeated_cancellation_settles_accept_task`: repeated cancellation
  cannot bypass either finalizer.
- 33 named `test_{revoke_all,listener,cancelled_error}_parked_at_*` cases cover 11
  lifecycle boundaries, exactly-once terminal ACK/event and complete cleanup.

Final checks: Python transport **86/86**, Python parser **44/44**; Node transport
wrapper **1/1** (all 86 Python cases), parser wrapper **44/44**. Coordinator
`relock.sh` passed source verification plus root-runner **17/17**, runtime-boundary
**19/19** and acceptance-integration **33/33**. Its launcher-files manifest is
byte-identical; runtime-lock updates only the transport source hash. Parser
adapter/patch/hash, lib/browser and raw fixture client are unchanged. No DB,
browser, root acceptance, installed runtime or live services were used. Coordinator
must rerun real root RSS acceptance; offline passes do not claim measured RSS.

## 2026-11-06 — RSS slot accounting and all 15 transport scenarios

Expectations were written before implementation in
`/tmp/browser-rss-expectations-cf34.txt` and in the loopback tests: two raw TLS
clients, SO_RCVBUF=8192 before connect, two fully collected 25 MiB responses,
continuous slots=2 / response=112 MiB throughout a >=2s no-read window; keep each
56 MiB reservation through downstream TCP drain, including a final unread tail.
Every named RSS scenario gets an independent real-mitmproxy test; malformed or
late responses forward zero plaintext, consumed interrupted writes never retry,
and every terminal path settles all handlers, flows, reservations and pools.
No browser, root, DB, external network, installed-runtime mutation or live service
was used. All temporary loopback listeners/threads are closed by test cleanup.

### Answers and production fixes

**Q1:** The initial 2-second hold already retained both reservations, but a real
terminal accounting defect existed: nonblocking `send()` completion only means
kernel acceptance, not downstream drain. At a final 16 KiB raw-reader pause the
old transport released BOTH slots while TCP bytes were still outstanding. The
expectations-first `test_rss_case_two_25MiB_slow_readers` failed `0 != 2` at this
boundary before the fix. `AsyncSocket.drain()` now waits for Linux SIOCOUTQ=0
(unsent + unacknowledged bytes), bounded by the original deadline, before marking
`h.drained` or releasing storage. The test now samples slots=2 / 112 MiB every
20 ms throughout the >=2s hold, retains both through the tail pause, releases
one client to observe slots=1 / 56 MiB, then releases the other and requires zero.
It checks exact 25 MiB payloads/digests. TCP ACK is the observable network-drain
boundary: no HTTP/TCP transport can establish the instant of the application's
last `recv()` without a separate application acknowledgment. This does not claim
that impossible stronger property.

**Q2:** `len(owner.flows)` IS the live response-reservation count: reserve()
creates one entry charging 56 MiB and release() removes that entry and charge.
There is no separate response queue or uncharged live response slot. Existing
`activeResponseSlots` and `maxResponseSlots` already measure the same quantity;
`test_response_slot_stats_exclude_transport_only_connections` checks 0 before
request admission (despite a charged transport), 1 during collection/drain, 0
on release, and high-water 1. All four multi-client tests use the actual
`ControlServer.dispatch(stats)` result, not invented slot counters. Neither the
control stats nor root-fixture sampler/check was changed or weakened.

A second defect affected `slow-body-deadline`: the disconnect monitor's read
shares the parser's original deadline. Its timeout could cancel the owner first,
turning the expected timeout into `CancelledError`. The monitor now returns on
its timeout and lets the owning parser/IO report its original deadline. The
real 60-second loopback case reproduced the missing timeout event before this
fix; it requires >=59 seconds, zero downstream plaintext, a TimeoutError or
BROWSER_DEADLINE, and complete cleanup.

### a26 root failure: coordinator action still required (outside ownership)

Read a26 and a23 `rss-diagnostics/.../last-observations.json`, including actual
controller events. In a26 both requests have the SAME canonical request digest,
reach the request policy hook, then the controller emits `boot_revoked`; neither
reaches `server_connect`. Both close with upstreamPlaintextBytes=0. Their
response reservations existed for only about 7 ms, so the 100 ms sampler
correctly records zero despite a high-water of 2. Those clients never entered a
slow response drain. This is not a sampler defect; sampling a brief revoked
request would not satisfy the intended slow-reader measurement.

A separate non-root Node reproduction using the REAL createAuthority,
DurableJournal, Ed25519 manifests, fsynced files and temporary directory confirms
why repeated identical fixture requests fail: admit manifest A, authorize R,
admit fresh manifest B for the same R, authorize R again -> EEXIST on A's consume
file. `createAuthority.authorizeRequest()` always selects the FIRST matching
admitted manifest. `prepareFixtureController.authorizeRequest()` discards the
new token returned by admit() and calls that first-match lookup. With concurrent
requests, duplicate consume fails and revokes the boot, including the first
request still awaiting checkpoint. Coordinator should consume the newly admitted
fixture token (or otherwise fix exact token selection without replaying claims).
Do not relax production one-use authority or the RSS live-slot check. No controller,
launcher, Playwright patch, or root client changes were made here. Root acceptance
will still need that controller fix before the multi-request cases can pass.

### Per-case loopback results

All names below are `TransportTests.test_rss_case_<name with hyphens as underscores>`
in `deploy/browser/transport_tests.py` and are checked by the Node wrapper against
the canonical `RSS_CASES` inventory.

| RSS case | Transport result / proof |
| --- | --- |
| two-contexts-eight-candidates | Fixed final TCP drain; two charged responses + six admission refusals before any extra body/transport allocation. Root fixture also needs the controller fix above. |
| two-25MiB-slow-readers | Fixed final TCP drain; >=2s continuous two-slot samples, final-tail retention, independent 2 -> 1 -> 0 release, exact 25 MiB digests. |
| held-request-review | Holds: frozen 25 MiB upload and 50 MiB+4096 request charge during withheld review, zero origin requests until release, complete upload/response. |
| fair-contention-completion | Fixed final TCP drain; six refusals, both original responses complete, then each context admits and completes a new request. Root fixture also needs the controller fix. |
| declared-length | Holds: exact 25 MiB response and SHA-256 through real bounded TLS/parsers. |
| unknown-length | Holds: real EOF-delimited body normalized to exact length/digest before downstream. |
| chunked-response | Holds: real chunked body becomes exact `test` payload, no chunk framing downstream. |
| short-body | Holds: declared 256 bytes / actual 5, zero downstream plaintext and no retained allocations. |
| oversize-body | Holds: declared 25 MiB+1 refused before payload collection, zero downstream plaintext. |
| slow-body-deadline | Fixed timeout-vs-disconnect-monitor race; real original 60s deadline, zero downstream plaintext, timeout evidence and complete cleanup. |
| compressed-bomb-no-decode | Holds: gzip response refused with BROWSER_ENCODING at headers; no decoded content or downstream plaintext. |
| preallocation-backpressure | Fixed final TCP drain; two reservations retain their buffers while six candidates get admission_refused before allocation. Root fixture also needs the controller fix. |
| disconnect-finally | Holds: actual raw TLS client disconnect while response write blocked, finally zeros all pools/reservations. |
| controller-loss-unknown | Holds for transport with controller-owned durable unknown/no retry; additional REAL UnixPolicy EOF test verifies fail-closed cleanup when terminal RPC also loses its channel. |
| consumed-write-no-retry | Holds: consumed write fault revokes before upstream dial, exactly one durable unknown/retry=false record, no origin request or retry. |

The loopback authority/DNS/dial fixtures explicitly substitute policy grants,
public DNS and the public peer check so these tests need no root. TLS verification,
ConnectionHandler, HTTP hooks, HTTPFlow, h11, allocation ownership and actual
socket IO remain real. `test_controller_socket_eof_after_consume_does_not_retry`
uses real UnixPolicy framing and SO_PEERCRED (test peer UID only), writes/fsyncs
unknown before losing the response channel, then requires zero upstream bytes,
exactly one request and persist attempt, dead runtime and zero storage even when
terminal persistence cannot ACK. Additional TCP-drain abort/expiry tests and all
36 cancellation-stage cells (12 stages x 3 sources) verify the new wait unwinds.
Root cgroup RSS peaks/OOM/packet namespaces/CDP authority are NOT proved by
loopback; coordinator must run the real root gate after fixing the authority.

Validation: transport **108/108** (Node transport wrapper **1/1**, checks every
canonical RSS case name); parser wrapper **44/44**. `/home/joe/qa-sjcos/browser-acc/relock.sh`
passed frozen source/hash/pin verification plus root-runner **17/17**,
runtime-boundaries **19/19**, acceptance-integration **33/33**. It refreshed
`runtime-lock.json` for the changed transport source; `launcher-files.json` is
byte-identical (no launcher edits). Parser adapter/hash remain unchanged. No DB
cluster was needed or started. All loopback helpers stopped; no push or root
acceptance run. Root network's earlier 28/28 is coordinator evidence, not a rerun
of this final transport revision.
