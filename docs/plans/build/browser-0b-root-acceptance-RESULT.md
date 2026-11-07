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
