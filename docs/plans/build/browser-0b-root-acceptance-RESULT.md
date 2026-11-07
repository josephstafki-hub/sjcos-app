# Browser Phase 0b — root acceptance result (2026-11-06/07)

**Outcome:** full root acceptance PASSED at commit `14260c43` (branch `t3/browser-0b-acceptance`),
run `final1`, 2026-11-06 23:52–23:57 ET, by the coordinator as root on GCServer.

| Run | Cases | Result | realRuntime | simulated | releaseReady |
|---|---|---|---|---|---|
| network (containment) | 28 | 28/28 passed | true | false | false |
| rss (parser/memory) | 15 | 15/15 passed | true | false | false |

`releaseReady` stays **false** by design: the plan still requires independent review of the
evidence and a signed root attestation. All browser flags remain OFF; nothing is wired into the
live app, routes, global MCP server or runner; nothing was deployed.

## What ran (real, not simulated)

- Pinned runtime in root-owned `/opt/sjcos-browser`: mitmproxy 12.3.1 (hash-locked venv), Unbound 1.26.2,
  playwright-core 1.64.1 with the reviewed target-barrier patch, **Chromium rev 1248 headless shell**
  (156.0.8078.4), NSS certutil. Provisioned by `deploy/browser/provision-acceptance.sh`
  (account `sjcos-browser`, uid 998 / gid 995, nologin); reversible with `unprovision-acceptance.sh`.
- Per run: fresh disposable namespaces (browser / gate / fixture), nftables default-deny inside the
  namespaces only, fixture DNS (Unbound) + TLS origins signed by a per-run CA, a fresh gate
  (as uid 998) and a fresh controller/launcher per case, `tcpdump` ingress capture, cgroup v2 memory
  files, systemd scopes `MemoryMax=3G MemorySwapMax=0 CPUQuota=150% TasksMax=256`.
- Chromium sandbox stays ON. On Ubuntu 24.04 (`kernel.apparmor_restrict_unprivileged_userns=1`) the
  pinned binaries get a userns-only AppArmor profile (`deploy/browser/apparmor-chrome.sh install|remove`,
  `/etc/apparmor.d/sjcos-browser-chrome`), same shape as Ubuntu's stock chrome profile.

## Evidence (private, not committed)

`~/qa-sjcos/browser-acc/final1/browser-0b-network-final1.json` and `browser-0b-rss-final1.json`
(per-case measurements + pcap/event/receipt hashes; artifact dirs alongside under `/tmp/*.json.d`).
Coordinator loop logs: `~/qa-sjcos/browser-acc/a1 … a29, final1`.

## Defects found by the root runs and fixed (each its own commit)

Product (security/runtime) defects:
1. Gate kept a flow + 56 MiB reservation forever when a candidate aborted while parked
   (repeated-cancellation interrupted cleanup; no transport-level 2 s decision bound) — `f1dff854`.
2. Gate released response slots/reservations after `send()` instead of after TCP acknowledgment — `375726a0`.
3. Authority selected the first matching manifest even when its one-use pair was spent → EEXIST → boot
   revoked on identical concurrent requests — `8af395f5` (one-use unchanged; durable claim still enforced).
4. Barrier `fail()` let a revoke failure (crashed gate) escape as an unhandled rejection — `7ce420da`.
5. Patched `doCreateNewPage` read the page before the barrier approved its attach (race) — `abfdc3df`.
6. Gate listener rebinding hit TIME_WAIT between fresh boots (SO_REUSEADDR) — `e62cd565`.
7. Gate case-name allow-list was lowercase-only — `df427d9c`.
8. Full Chrome `--headless=new` spawns an empty `other` target + two `chrome://omnibox` `browser_ui`
   targets per tab and two component-extension service workers; switched to the headless shell and added
   `--disable-component-extensions-with-background-pages` — `f9e7ef24`, `d20a7b19`. Barrier policy unchanged.
9. Profile dir names overflowed Chromium's 108-byte SingletonSocket path — `23b030f0`.

Harness / measurement fixes (reviewers please scrutinize — each changes what a check accepts):
- Kernel link-local IPv6 NDP/MLD (fe80::/10 → ff02::/16|fe80::/10, ICMPv6 NDP/MLD types only) is counted
  as `linkControlPackets`, not private, in the ingress capture and the bypass probe; any other IPv6 is still
  private; during a bypass probe even fixture HTTPS fails — `60f01eac`, `3a43ff22`.
- Crashed-gate check = "no task running as the gate uid remains" (the runner deliberately charges its own
  root supervision to the measured gate cgroup) — `a3b4a914`.
- Capture budget 250k packets / 40 MiB so RSS transfers are captured completely (early tcpdump exit still
  fails) — `0d8aeec0`.
- Fixture origin sends TLS close_notify for the EOF-delimited `unknown-length` body. The gate's refusal of
  a bare TCP close on EOF-delimited bodies is kept (truncation-ambiguous). **Product note:** real servers that
  skip close_notify on such bodies will be refused — `14260c43`.
- Navigation 8 s deadline (Playwright `nullProgress` ignores goto timeouts); worker case built with
  JSON.stringify (the old literal was a SyntaxError that never created a worker); DNS readiness retry;
  `nsenter --net` (ip netns exec hides `/sys/fs/cgroup`); nft rules via file; controller RPC ENOENT;
  barrier reason codes + first failure reason surfaced to diagnostics; gate control returns fixed Refused codes.

## Test sweep at `14260c43`

Node: every `tests/browser-*.test.mjs` passes individually (one timing flake seen once in
`browser-runtime-startup` under load during a concurrent sweep; 3 immediate reruns 18/18).
Python (`/opt/sjcos-browser/py`): transport 108, parser 44, provision 9, root-runner 5 — all OK. `tsc` exit 0.

## Not done

Independent review + signed root attestation (`signed-root-attestation`, `reviewApprovalSha256`), the scoped
service/web RPC catalog, vault fill/profile restore, the Browser pane UI, the owner-grant flow for external
browser actions, and production wiring. Machine state left provisioned for review (undo:
`sudo bash deploy/browser/unprovision-acceptance.sh && sudo bash deploy/browser/apparmor-chrome.sh remove`).

## Round 1 fixes

The earlier `final1` measurements at `14260c43` remain historical. They do **not**
attest the revised runtime or stricter acceptance predicates below. The builder
ran no root acceptance, browser, Next process, sudo, installation or live service
operation. Coordinator: reprovision the pinned candidate and rerun **all 28
network + all 15 RSS cases**, then independently inspect the private artifacts.
Release readiness and all product flags remain off.

Expectations were written before implementation in
`browser-0b-round1-expectations.md`. Changes addressing all nine required findings:

| Finding | Implementation | Regression proof |
|---|---|---|
| Engineering 1: authority expiry | Check original signed expiry after every journal/checkpoint/verifier await; receipt carries expiry; decision/connect/TLS/transmission use the smaller deadline. Burned claims and durable write unknown are retained. | `browser-round1`: GET/POST × four asynchronous boundaries, signed expiry before connect/TLS; existing controller exact-authority tests. |
| Engineering 2: complete capture | Wait for process **close**, retain bounded stderr, require normal final exit, parse terminal statistics, reject drops/missing stats/early exit/budget exhaustion; hash stderr beside PCAP and cross-check captured record count. | Fresh dropped/missing/SIGKILL/nonzero/budget/truncation cases and delayed stderr after exit. |
| Engineering 3: actual RSS stress | Parse bounded HTTP response metadata; require complete body sizes/digests; two full 25MiB clients, measured >=1500ms exact112MiB interval, actual outstanding TCP tail, separate2→1→0 release, eight concurrent candidates/context, completion in both contexts, frozen25MiB request concurrent with response storage. Store samples/results and recompute artifact checks. | Same root validator accepts complete fake observations and rejects transient charges, short interval, missing slot release/tail, partial/wrong body, insufficient candidates and missing concurrent request charge. Real cgroup/payload/timing proof awaits root. |
| Engineering 4: evidence semantics | Required per-case schema, positive ingress/events, hashes, zero forbidden/retained counts, fault/child predicates and artifact recomputation. Reject diagnostics. Recompute RSS aggregates; preserve any earlier retry/invalid unknown. | Eight real-shaped evidence mutations, poisoned reducer, fabricated measurement and per-case retention negatives. |
| Engineering 5: write/child identity | Every nonzero write requires flow/target/digest and a unique durable consume/checkpoint/digest registration in matching target order; origin consumes compared as a multiset; popup/iframe needs its own paused child attach/guard/resume/Fetch/write/origin. | Missing digest, wrong target, duplicate write/origin, absent OOPIF and actual patched-bundle barrier tests. |
| Engineering 6: startup stdout race | Install bounded close/stdio completion immediately after spawn; parse only after close; broker diagnostics also await close; timers cleared. | Paused stdout deliberately resumes after exit; startup19/19, including unchanged real narrow-login/replay assertions on disposable testdb. |
| Security 1: fatal lifecycle | Idempotent synchronous policy + barrier fence; bounded revoke runs independently of browser kill/await. Independent Python supervisor owns Chromium's group and kills/waits on lifetime-pipe EOF. Gate monitors controller liveness during transfers (100ms interval,400ms RPC bound) and closes sockets before persistence. Controller metadata-only IPC excludes body/credential fields. | Rejected/hung revoke tests, external patched-barrier fence, independent lease-loss/stall and supervisor EOF mocks, bridge loss/bounds tests. Root must confirm process/socket death. |
| Security 2: real faults | Separately forked controller; actual SIGKILL after durable consume and during held active TLS transfer, recording PID/exit signal; actual CDP detach without fallback revoke. Require durable unknown/no retry, independent browser-namespace survivor scan before cleanup, and only named root supervisor PIDs in crashed gate cgroup. Unreadable identity fails unless disappearance is confirmed. | Survivor permission/disappearance fakes, root fault predicates, lease/supervisor fakes. Root must confirm each named fault and mutation sensitivity. |
| Security 3: fabricated evidence / IPv6 | Required semantic schema plus hash/count recomputation. IPv6 exemption needs complete declared payload, canonical extension chain, protocol hop limit, code/checksum/type lengths/options, attributed outgoing fixture interface/source/MAC and bounded count. Raw/unattributed or malformed traffic stays private or fails. Capture snaplen256 permits complete control validation. | Eight malformed IPv6 cases, valid attributed RS, raw/unattributed refusal and SECRET-IN-NDP negative; fabricated evidence mutation. |

Validation (single files; no full suite):

- Node: round1 **52**, controller **87**, Playwright patch **30**, startup **19**,
  root-runner **17**, acceptance-integration **41**, runtime-boundaries **19**,
  acceptance-drivers **11**, launcher **15**, transport wrapper **1** over **108**
  pinned Python cases. Total **292 Node tests**. The transport suite initially
  caught a changed drain calling convention and its previous64-event expectation;
  both were corrected before the passing108-case run. Its event bound is now512
  to retain concurrent16-candidate traces; overflow still fails acceptance.
- Python via `/opt/sjcos-browser/py/bin/python -B`: transport **108**, root-runner
  **9**, provision **9** (through the integration wrapper). These wrapper counts
  overlap the Node totals.
- Required locked/niced `tsc --noEmit -p .`: **exit0**. `git diff --check`: passed.
- Required `repatch.sh` rebuilt from the pristine1.64.1 bundle; `relock.sh`
  refreshed both committed inventories, verified frozen sources, and passed its
  three individual browser test files. `parser_adapter.py` was unchanged.
- Disposable startup test cluster stopped; other test tags were stopped too.
  No resource-limit kill occurred. Deliberate SIGKILL is exercised with fakes in
  builder tests and reserved for the coordinator's fault acceptance.

Root handoff: validate capture terminal stderr and PCAP record counts/hashes;
confirm real simultaneous reservations/payload digests and TCP tail; verify
controller-loss/detach/gate-crash browser and gate socket disappearance **before**
fixture cleanup, no interrupted write reaching origin, unique consume correlation,
and each child target's own barrier trace. The strict IPv6 attribution intentionally
refuses unfamiliar control structures rather than weakening the packet claim.

## Root-run flakes

Follow-up to coordinator ROOT evidence `r1o-evidence` (2026-11-07), implemented
without ROOT, Chromium, Playwright, sudo, installed-runtime writes, or live
services/database access.

**A — shutdown confirmation.** The transfer-drain hypothesis is refuted by
`test_root_flake_revoke_all_cuts_25mib_load_promptly`: actual mitmproxy
ConnectionHandler/HTTPFlow/h11/TLS on loopback, two 25 MiB responses, a held
25 MiB POST, and fourteen aborting candidates revoke without releasing the
readers. Listener-specific revoke also leaves the other loaded context alive.
The reproducible blocking path is synchronous terminal policy RPC inside the
handler's cleanup: two unavailable terminal replies per consumed flow blocked
the event loop for about four seconds each (eight seconds across two flows in
the initial reproduction), hiding behind the launcher's bare refusal. A policy
failure could also await `onFatal -> revoke -> settled -> terminal policy reply`,
a circular wait proved by the Node `policy denial returns before fatal revoke
ACK` test. The original bare ROOT error cannot distinguish timeout from a
rejected revoke/kill; the new codes provide that distinction on the next run.

Terminal RPCs now execute off the control loop with a 400 ms bound per call,
two calls maximum per flow, concurrent across the two contexts. Listener/socket
CUT still happens first. Shielded finalization keeps both body representations
charged until IO frames unwind and terminal persistence/drop completes, even
under repeated cancellation. Unconfirmed persistence/close is sticky and
`settled()` fails with `BROWSER_TERMINAL_UNCONFIRMED`; control cannot issue a
successful durable revoke ACK for that outcome. Consumed writes are marked
unknown once and never retried. Node policy denial fences immediately and
returns its denial without awaiting the control-channel revoke. Shutdown
publishes its idempotent promise before callbacks, always kills and cleans up,
and reports fixed `revoke-timeout`, `revoke-failed`, `kill-failed`,
`cleanup-failed`, or `fence-failed` codes. A confirmed busy revoke still succeeds.
`test_root_flake_revoke_unconfirmed_terminal_fails_without_blocking_control`
failed before these changes and passes afterward, checking immediate socket CUT,
control-loop responsiveness, failed confirmation within 1.5 s, and zero pools.

**B — uncontrolled tail observation, not premature response release.**
`test_root_flake_continuous_reads_can_ack_before_drain_observation` reproduces
complete, correctly accounted 25 MiB transfers with no tail event: a legitimate
scheduling delay lets the continuously reading peer ACK the last send before
the first real SIOCOUTQ sample. No pending-byte counts or reservations are
mocked. The root client now stops exactly before the final 16 KiB plaintext
record using bounded recv sizes and ready/release markers. The root fixture
requires both real TCP tails to remain positive and reserved, with exactly two
slots/112 MiB charged in five samples, before independently releasing them and
checking 2 -> 1 -> 0 plus complete payload digests. Existing tail-event, no-read
hold, candidate count, frozen POST storage, and zero-terminal-allocation checks
remain required. `test_root_flake_actual_root_client_holds_both_tcp_tails` runs
the actual changed `fixture-io.py` client over loopback against real mitmproxy
classes; the separate raw-client controlled-tail test proves the same boundary.
Node negative tests reject missing samples, unreserved/ACKed tails, and counting
one flow twice.

Expectations were written before the production fixes: the initial Node file
had six failing expectations; the initial slow-terminal loopback test exposed
the multi-second event-loop stall. Validation:

- Final full `transport_tests.py`: **114/114** passed (87.7 s), including all
  RSS cases, the listener-specific load test, and all 36 cancellation
  boundaries. Focused rechecks also passed: **6/6** root-flake tests and
  **36/36** cancellation tests.
- `tests/browser-round1.test.mjs`: **66/66** passed.
- `/home/joe/qa-sjcos/browser-acc/relock.sh`: source/pin verification passed;
  root runner **17/17**, runtime boundaries **19/19**, acceptance integration
  **42/42**. Both JSON inventories refreshed. Neither parser_adapter.py nor
  the Playwright runtime patch changed, so no parser-pin override/repatch.
- Unique local tag `browser-flakes-20261107`; these files create no DB cluster.
  Loopback test listeners/threads/tasks are cleaned up by their fixtures. No
  resource-limit kill occurred. `git diff --check` passed.

Coordinator handoff: re-run ROOT network/RSS acceptance and repeat
preallocation-backpressure. Confirm two controlled final-tail samples/IDs,
independent release, durable unknown on interrupted POST, and no browser/socket
survivors. No new ROOT pass claim or acceptance promotion is made here.

### Follow-up to ROOT `r1p-evidence` (2026-11-07)

**Mid-case revoke trigger: control-socket accept backlog exhaustion.** The
`listen(2)` in `ControlServer.serve` was sized like the two browser/body slots,
but independent control RPCs overlap: monitor stats, background sampling,
foreground sampling, and the two contexts' digest registrations. While the
single Python loop is busy collecting/freezing the upload, Node's nonblocking
Unix connects can fill that backlog and fail immediately with `EAGAIN`.
A failed digest registration after consume invokes `createGateAuthority`'s
fatal callback; a failed monitor stats call also revokes. Fixture shutdown
then closes/unlinks the policy endpoint, explaining the subsequent
`FileNotFoundError` and unconfirmable terminal revoke. The missing policy
path is downstream of the revocation, not a terminal finalizer unlinking a
shared socket. Comparing `50a63f09` confirms its terminal cleanup never
unlinks a socket; the undersized control backlog predates that commit.

Expectations were added before the capacity fix. The real loopback
`test_root_control_burst_keeps_both_consumed_requests_and_socket_alive`
failed with consumes followed by the fatal callback at digest registration.
Adding diagnostic codes before changing the backlog identified
`BROWSER_GATE_DIGEST_BACKPRESSURE` (`EAGAIN`), with the socket file still
present. The test uses the actual Python `ControlServer`, real mitmproxy
ConnectionHandler/HTTPFlow instances on two distinct TCP listeners, and Node's
actual `gateCall` + `createGateAuthority`; only the authenticated peer UID is
changed to the test user's kernel UID. One accepted sampler frame is parked
while the other four calls connect, making the root concurrency deterministic
without mocking socket errors, pending bytes, or reservation counts.
`test_root_control_backlog_two_revokes_after_consume_without_unlink` preserves
the old backlog as a negative control and reproduces the specific failure.

The control backlog is now eight pending metadata peers, with serialized
control dispatch and the existing root-peer checks/framing/deadlines unchanged.
This does not add admitted TCP flows, parser buffers, or body slots. The
positive regression checks both distinct listener-cookie digest registrations,
no fatal callback, both TCP listeners/handlers still alive, and the Unix
socket present until its owning server is stopped. Existing loaded GET + held
25 MiB POST tests still verify two slots/112 MiB, real controlled tails,
independent listener revocation, prompt all-flow CUT, and 2 -> 1 -> 0 release.

Fixed diagnostics now preserve `EAGAIN` across the fixture process bridge,
record `policy_refused` with the stage (`BROWSER_GATE_VALIDATE`,
`BROWSER_GATE_AUTHORIZE`, `BROWSER_GATE_DIGEST_REGISTER`, or
`BROWSER_GATE_DIGEST_BACKPRESSURE`), and retain a bounded `boot_revoked.reason`.
Monitor-triggered revokes distinguish `BROWSER_CONTROL_BACKPRESSURE`,
`BROWSER_GATE_MONITOR_FAILED`, and `BROWSER_GATE_MONITOR_DEAD`. No exception
text, request body, or secret is put in those codes. The supplied ROOT logs
had no original trigger code; these codes let the coordinator confirm which
control RPC first failed if the root topology reveals another trigger.

**Run 2: lost proof at artifact serialization/revalidation.** The case had
already passed the live `validateRssCase(state)` check. The parent then called
the same validator from `verifyCaseArtifacts`, but `observations.json` omitted
`tailHoldSamples`, and the parent also omitted that field when reconstructing
state. Therefore even a correct two-tail hold inevitably failed the new strict
check. Both boundaries now preserve the samples, through the actual writer's
`caseObservations` projection. The new Node test failed first on missing JSON
samples, then passes complete artifact revalidation including signed consume,
checkpoint, sink, receipt hashes, packet hashes, and ordering. Negative artifact
variants still fail for missing samples, an unreserved tail, or a duplicated
flow ID. No tail requirement or TCP fixture hold was weakened.

Validation (no ROOT, sudo, browsers, installed-runtime writes, or live DB/services):

- `/opt/sjcos-browser/py/bin/python -B deploy/browser/transport_tests.py -v`:
  **116/116** passed (88.139 s), including all 15 RSS cases and all 36
  cancellation boundaries. The final exact five-call control-burst version
  was also checked separately: **2/2** positive/negative controls passed.
- `tests/browser-round1.test.mjs`: **69/69** passed, including the actual JSON
  artifact round trip and fixed diagnostic/IPC tests.
- `tests/browser-controller.test.mjs`: **87/87** passed.
- `/home/joe/qa-sjcos/browser-acc/relock.sh`: frozen source/hash/pin verification
  passed; root runner **17/17**, runtime boundaries **19/19**, acceptance
  integration **42/42**. Both relocked JSON inventories are committed.
- The parser adapter and Playwright runtime patch are unchanged, so neither
  parser-pin reassignment nor `repatch.sh` was needed. Local test tag:
  `browser-r1p-20261107`; the required relock script uses its own `coord-relock`
  tag. These test files create no database cluster. All test listeners, Node
  children, and tasks were stopped; no exit 137/resource kill occurred.
  `git diff --check` passed.

Coordinator handoff: reprovision the relocked candidate and rerun ROOT
preallocation-backpressure repeatedly. Check that consume is followed by digest
registration/server connect instead of revocation, both tail proof arrays
survive the parent artifact pass, and independent release/zero survivors hold.
No ROOT acceptance pass or promotion is claimed by this follow-up.

## Round 1 — root re-acceptance (2026-11-07, run `final2` at `45982097`)

Full root acceptance PASSED again under the round 1 (stricter) checks: network **28/28**, RSS **15/15**,
realRuntime true, simulated false, releaseReady false. Evidence: `~/qa-sjcos/browser-acc/final2/`.
The case that had been intermittent (preallocation-backpressure) passed 3/3 consecutive root repeats first.

Coordinator changes during the round 1 root loop (each its own commit; reviewers please scrutinize the
evidence-acceptance changes):
- `49be0985` `--site-per-process`: the headless shell ran cross-site frames in-process; now each cross-site
  frame is its own barrier-guarded target (security improvement).
- `6d89bba1` popup paused-child evidence accepts a distinct browser-level page target (headless shell attaches
  popups at browser level); full attach/guard/resume/Fetch/write ordering unchanged.
- `91294c8a` OOPIF evidence follows Chromium's navigation model: the frame's document navigation is Fetch-paused
  on the parent target before the frame process exists; the child then attaches paused, guard < resume; the
  write is bound to the exact child.example consume digest. Popups stay strict.
- `606e5bb3` + `8c4df81c` fetch-detach fault proof = ack OR a boot_revoked recorded after the detach attempt
  (the barrier's revocation closes the session carrying the ack); neither still fails.
- `8ee5ca3f` controller-loss case waits for the gate lease to record controller_lost before releasing the reader.
  **Known window:** an already-authorized, already-buffered response can drain within the lease's <0.5 s
  detection window after an abrupt controller death; no new authorization is possible in it.
- `10bc5c9d` preallocation review hold stays inside the gate's 2 s decision bound (human review happens before
  dispatch, never inside a gate decision).
- `bf8bc51f` launcher pre-start refusal codes.
Builder fixes found by these runs: `50a63f09` (bounded asynchronous terminal cleanup, distinct shutdown codes,
controlled TCP-tail measurement) and `45982097` (gate control backlog 2→8: concurrent first requests exhausted the
Unix control backlog → EAGAIN during digest registration → fatal revocation; RSS tail-hold samples preserved
through artifact serialization).

## Round 2 fixes

Implemented against `3074aa01`, without root, sudo, Chromium/Playwright launches,
Next servers/builds, installed-runtime writes, or live services/database access.
The root `final2` run above remains historical: it does **not** attest this
relocked runtime or the newly required evidence. Release readiness stays false.
Expectations preceded implementation in `browser-0b-round2-expectations.md`.

| Finding | Change | Proving tests |
| --- | --- | --- |
| S1: controller death at dispatch | After upstream TLS, require a controller-confirmed `request_dispatch` bound to the exact flow, decision ID, request digest, listener/guard and original expiry. Pin the authenticated controller's kernel pidfd; readiness actively cuts/cancels dispatch and upload independently of the lease. Check that same pidfd synchronously before every upstream kernel send, including a resumed blocked send, and recheck authority between TLS records. Root `controller-loss-unknown` now holds a consumed POST after TLS, kills the controller, immediately releases dispatch and requires zero HTTP bytes. `consumed-write-no-retry` holds a 25MiB POST between body records, kills/releases immediately, and requires only headers plus the first record, no completed origin write, exact durable unknown and no second consume. | Pinned Python transport: real TLS plus real separate-process SIGKILL at both boundaries, zero/partial byte bounds, fsynced unknown/no-retry and single consume. Python root-runner: pidfd cancels without a lease, refusal before dispatch, and no next TLS record. Node round2: wrong digest/decision, expired/reused dispatch and both root fault predicates. |
| E1: independently recomputed artifacts | Retain capture terminal exit facts and fixture interface identity; reparse terminal statistics and classify every ingress and bypass PCAP, comparing all retained counters/classification/hashes. Recompute case RSS from capped allocation samples, raw cgroup observations, terminal stats, actual events, results and exact write-bound unknown receipts. Reject negative/over-cap case values before aggregate maxima/OR, and require named-case backpressure/unknown/compression. Hold samples must be strictly ordered, span the interval with <=250ms gaps, and show frozen request charge overlapping an actual buffered response on a live flow. | Round2's three hash-matching capture negatives, five healthy-aggregate/corrupt-case mutations, and clustered/gapped/no-overlap stress negatives. Round1 complete signed consume/checkpoint/sink artifact round trip plus corrupted RSS samples, copied maxima and tail evidence. |
| E2: OOPIF child interception | Preserve the exact parent-target document navigation; retain its frame ID and the attached iframe's target/context identity. The child document issues exact-approved `GET https://child.example/oopif-first-request/sub`. Require its own attach < guard < resume < Fetch < consume < digest registration, matching gate write and origin digest. | Round2 full ordering/child positive; unrelated iframe and removed child Fetch negatives. Updated round1 OOPIF positive and parent-write/guard-order negatives. Actual site-per-process rerun belongs to the coordinator. |
| E3: detach causal identity | Retain session binding and a named detach-attempt event. Observe the same session's CDP parent detach independently, deliver it through the registered **production** disconnect handler, and retain that handler's session/target-specific fence/revocation. An ack loss requires this observed detach and its subsequent named fence; unrelated boot revocation cannot substitute. Recompute this chain from artifacts. There is no fixture fallback revoke. | Round2 invalid-session/unrelated-revoke and disabled-cleanup negatives, production cleanup enabled/disabled tests, and lost-ack positive. Acceptance-integration rejects the old arbitrary-revocation predicate. |
| E4: failing positive fixtures | Response-budget uses complete realistic per-case evidence and mutates the actual compression/backpressure case. Successful Python settlement explicitly returns True; False and None cannot acknowledge durable revoke. | Response-budget 13/13; Python root-runner 13/13. |

**Dispatch contract.** The controller RPC confirms exact dispatch authority after
TLS; the final kernel pidfd check immediately preceding each nonblocking send
is the dispatch/send linearization point. A controller already dead at that
check cannot start the buffered request or send another upload record. The
pidfd watcher also cancels pending IO without waiting for the periodic lease.
A userspace check and `send` are not one atomic kernel operation: physical death
can race that final syscall, and already queued/in-flight bytes cannot be
recalled. A dispatched consumed mutation therefore remains durable unknown,
with no retry. This does not claim a zero-time physical-death guarantee.
Already-authorized buffered responses can still drain bytes already queued
before cancellation; the earlier response-side qualification remains. The
active-response case still waits for independent loss observation before
releasing its reader and does not independently certify a fault-to-CUT latency.

Validation, individual files only, tag `browser-r2-20261107`:

- Node: acceptance-drivers 11, acceptance-integration 42, controller 87,
  launcher 15, parser-adapter 44, Playwright-patch 30, response-budget 13,
  root-runner 17, round1 69, round2 26 (including the 15 fresh adversarial
  expectations), runtime-boundaries 19, runtime-gate 61, startup 19,
  transport wrapper 1: **454/454**. Disposable startup uses only
  `tests/_harness/testdb.mjs`; the matching tagged cluster is stopped after
  each file. No suite-wide `npm test` invocation.
- Pinned `/opt/sjcos-browser/py/bin/python -B`: transport **118/118**;
  root-runner **13/13**; parser **44/44** and provision **9/9** through the
  individual Node wrappers. Python/wrapper counts overlap. Test loopback
  listeners, subprocesses and tasks are cleaned up by their fixtures.
- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
  `git diff --check`: passed. No resource-limit kill occurred; deliberate
  child SIGKILL tests are the named controller faults.
- Required `relock.sh`: frozen source/hash/pin verification and root-runner
  17/17, runtime-boundaries 19/19, acceptance-integration 42/42 passed.
  Both JSON inventories are included. `parser_adapter.py` and the Playwright
  patch runtime are unchanged, so no parser-pin reassignment or repatch.

Coordinator: reprovision this relocked candidate and rerun **all 28 network +
all 15 RSS** cases as root. Recompute all private artifacts with the new
validator; old artifacts missing terminal/interface/sample/session identity
must not be grandfathered in. Confirm both immediate-release controller kills
(zero pre-dispatch HTTP bytes; no next upload record), durable exact unknown
receipts/no retry, zero survivors before cleanup, the child's own subresource
consume/digest/write on its iframe target, same-session detach causality, and
real sustained no-read/overlap/two-tail/independent-release storage evidence.
This builder makes no new root acceptance or release approval claim.

## Round 2 — root re-acceptance (2026-11-07, run `r2a` at `7b102970`)

Full root acceptance PASSED on the first run after the round 2 fixes: network **28/28**, RSS **15/15**,
realRuntime true, simulated false, releaseReady false. Evidence: `~/qa-sjcos/browser-acc/r2a/`.
Covers the new dispatch fence (controller killed between consume and dispatch → zero upstream request bytes,
durable unknown/no-retry), the OOPIF child's own guarded subresource Fetch→consume→write, session-bound
detach evidence and independently recomputed capture/RSS artifacts.

## Phase 1 candidate — root re-acceptance (run p1a, 2026-11-07 04:37–04:44)

Candidate `386ad6cf` on `t3/browser-phase1`: the Phase 1 integration (A0–A3b, B/B2, C/C2, D) including the guarded target-barrier lifecycle release (patch `fb71a7f9…`, bundle `5c72f2b3…`). Coordinator source fixes before the run: provisioner and `runtime-readiness` source allowlists admit exactly `scripts/browser-retention.mjs`; provisioner patch pins updated; source inventories refreshed (`refresh-production-sources.mjs --check` + `provision_acceptance.py --check-sources` pass).

Result: unprovision → provision → AppArmor → installation-only runtime check → **network 28/28** → **RSS 15/15**, `realRuntime: true`, `simulated: false`, `releaseReady: false` (signed independent attestation still required). Evidence `~/qa-sjcos/browser-acc/p1a/`. This re-attests the 0b containment/RSS gates for the changed runtime only; production Phase 1 units, bridges, privacy canary, devices and SSE remain coordinator gates.

## Phase 1 round 1 fixes — root re-acceptance (runs p1b → p1c, p1c-rss; 2026-11-07)

- **p1b** (`f5cafe45`): network stopped at `listener-cross-context` — retained-artifact recompute mismatch on `controllerEventsSha256`: the `boot_revoked` teardown event after the deliberately killed gate landed between measurement and the observations write. Harness race, not a containment failure. Fix `35feb203`: wait (≤2 s) for the controller event log to go quiet, then measure, derive RSS and retain the SAME frozen snapshot (stricter — the teardown revocation is now inside the measured evidence). Diagnostics kept in `/root/browser-diag/p1b-network-fail`.
- **p1c** (`35feb203`): **network 28/28**. RSS stopped at `preallocation-backpressure` "ordered hold samples cover interval with ≤250 ms gaps" while the coordinator was concurrently restoring/migrating/seeding the QA database (CPU contention). No code change.
- **p1c-rss** (`35feb203`, RSS only, idle box): **RSS 15/15**.

Result for candidate `35feb203`: network 28/28 (p1c) + RSS 15/15 (p1c-rss), `realRuntime: true`, `simulated: false`, `releaseReady: false`. Evidence `~/qa-sjcos/browser-acc/{p1c,p1c-rss}/`. Operating note: never run heavy work on the box during root RSS runs.

## Phase 1 round 2 fixes — root re-acceptance (run p1d, 2026-11-07 06:50–07:05)

Candidate `faee0245` (round 2 server/factory/QA/UI fixes; QA hooks removed from the production module graph; inventories refreshed). Single uninterrupted run: **network 28/28**, **RSS 15/15**, `realRuntime: true`, `simulated: false`, `releaseReady: false`. Evidence `~/qa-sjcos/browser-acc/p1d/`.

## Phase 1 round 3 fixes — root re-acceptance (run p1e, 2026-11-07)

Candidate `fd02a1ec` (round 3 server/QA/UI fixes; inventories refreshed). Single run: **network 28/28**, **RSS 15/15**, `realRuntime: true`, `simulated: false`, `releaseReady: false`. Evidence `~/qa-sjcos/browser-acc/p1e/`.
