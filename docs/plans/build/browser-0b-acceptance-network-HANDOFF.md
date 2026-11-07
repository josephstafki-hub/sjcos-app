# Browser 0b network acceptance — PARTIAL IMPLEMENTATION, not acceptance ready

2026-11-06. Network builder N; shared worktree/branch with builder P.
All six browser flags remain OFF. No app/route/runner wiring, DB, migrations,
services, browser launch, namespace creation, packet capture or sudo was used.
No install, full suite, Next dev/build/start, or deployment was performed.
No subagents were started. Nothing was pushed.

## Result against the build list

1. **Partial:** `deploy/browser/parser_adapter.py` implements preallocated pinned
   HTTP/1 head/body parsing, reserved mutable/frozen representations, a shared
   56/112/24 MiB owner, two response slots/one per context, rotating metadata
   contention, monotonic deadlines, <=64KiB recv_into/write primitives, rejection
   before body collection, bounded root SO_PEERCRED Unix metadata RPC, and ABI
   glue. It uses real installed mitmproxy 12.3.1 `http1` and `_http1`/h11 readers.
   Request and response compression, duplicate/ambiguous lengths, Expect,
   request transfer encoding, trailers, upgrade, unknown upload lengths are
   refused. Cleanup also drops parser references on owner revocation and on
   exceptions in transport shutdown. The immutable copy was reserved before
   collection. RPC uses an absolute deadline, not a per-byte timeout refresh.
   **This is not a patch to stock ConnectionHandler/TLS/HttpStream, nor a
   complete Unix-policy/controller integration. EgressGate still correctly
   refuses stock startup.** `RuntimeAdapter` delegates reviewed transport
   operations that are NOT implemented here; its attestation cannot pass from a
   marker alone. See the explicit interface/blockers below.
2. **Partial:** network-driver has actual namespace socket probes, bounded pcap
   record parsing, capture-ready handshake and positive ingress control, seven
   direct bypass scenarios and child cleanup. It needs a reviewed
   `/opt/sjcos-browser/fixtures/launcher-driver` for the other 21 scenarios,
   including actual policy/TLS traffic. The broad list is an assembled-runtime
   contract, not an assignment of missing N work to P. The RSS executable is
   **only a fail-closed entrypoint** to a missing integrated
   `/opt/sjcos-browser/fixtures/parser-transport-driver`; it does not implement
   the required real RSS scenarios. Neither driver can currently produce passing
   acceptance evidence. They do not fabricate evidence from helper counters.
3. **Implemented, expected refusal:** runtime check reads `/opt/sjcos-browser`,
   never worktree/live node_modules; checks ownership/parent paths, writable bits,
   symlink targets, pinned versions, full 42-distribution Python lock/RECORDs,
   adapter/bundle digests and a required reviewed installed binary hash manifest.
   It requires real evidence plus independent root signature verification and
   parser transport integration. The signature verifier is still absent.
4. **Implemented, unexecuted:** offline, idempotent root installer validates ALL
   source hashes and installed Python transitive lock before mutations. It uses
   frozen verified bytes, atomic replacement, fsync, root ownership and 0755
   driver / 0644 module modes. It installs the two entrypoints, adapter, existing
   addon/dispatcher and frozen runtime lock. It does not install the missing
   integrated transport or launch any process/service.
5. **Implemented plans, unexecuted acceptance:** --plan prints complete commands
   with this checkout's absolute path, Joe UID 1010 and supplied fresh tag. RSS
   now plans a delegated 3G OUTER scope with sibling helper/gate subgroups; gate
   remains **384MiB / no swap / 35% / 32 tasks**. The old outer-384M command could
   not keep helpers outside that measured gate while charging both to one 3G
   child. The supervisor is 32MiB while empty; setup/teardown temporarily holds
   the Node runner under the capped outer scope. Failures kill only invocation-
   owned cgroups; measured gate memory.peak/events are checked independently.
   This cgroup setup is not root-tested and may need coordinator correction.

Additional concrete fix: `lib/browser/gate.mjs` formerly released a response slot
when `finish(id,true)` was called with queued transport bytes. It now returns
`BROWSER_DRAIN_PENDING` and retains the slot until both directions drain; failure
or the original deadline still releases it. Regression written and observed
failing before implementation, then passing.

## Exact interfaces and ownership

`deploy/browser/acceptance-interface.md` records CLI argv, P launcher evidence,
ephemeral CDP-port population and the unresolved transport interface. No fixed
CDP port / host mapping. N did not edit P's launcher, Playwright, broker, MCP or
tests. P's concurrent edits remain outside this commit.

`RuntimeAdapter` requires transport methods `attested`, `remaining(flow)`
(original monotonic CONNECT deadline), `event_metadata`, `apply_verified`,
`server_connect`, `server_connected`, `persist_unknown`, `close_flow`,
`revoke_all`. Kernel-derived listener generation/guard identity, exact signed
read-manifest verification, durable consume/checkpoint receipts, complete fresh
Unbound CNAME/A/AAAA, peer/SNI validation and TLS buffer/drain accounting are
still missing integration code, not coordinator installation chores.

The acceptance validator rejects unknown kinds, extra/duplicate cases and stale
nonce/installed-lock hashes. No acceptance source hash can substitute for
`parserTransportIntegrated:true` and signed reviewed evidence.

`runtime-lock.acceptance.parserPatchSha256` identifies the bounded adapter
source (not a complete stock-parser patch). `pythonTransitiveLockSha256` is the
actual installed lock hash:
`eba221bfad4290320bd1dabec0ab76583d5b84505b9fdfa0e9d675eb9d777885`.
`parserTransportIntegrated` is explicitly false; evidence remains absent.
Only N-owned runtime-lock file entries were refreshed. P must refresh its own
entries and its old boundaries-test expectation of a null parser hash; that
assertion now needs to verify the real adapter hash while checking integration
remains false. N did not edit or commit P's files.

## Files

- New adapter and offline Python tests: `deploy/browser/parser_adapter.py`,
  `parser_adapter_tests.py`, `tests/browser-parser-adapter.test.mjs`.
- Driver entrypoints: `deploy/browser/fixtures/network-driver.py`, `rss-driver.py`.
- Root installer and contracts: `deploy/browser/install-acceptance.sh`,
  `acceptance-interface.md`, `parser-contract.md`, `runtime-lock.json`.
- Installed runtime checking/pins: `lib/browser/runtime-readiness.mjs`,
  `runtime-pins.mjs`, `scripts/browser-runtime-check.mjs`.
- Acceptance orchestration/evidence: `lib/browser/acceptance.mjs`,
  `scripts/browser-containment-check.mjs`, `scripts/browser-rss-check.mjs`,
  `tests/browser-acceptance-drivers.test.mjs`.
- Drain bug: `lib/browser/gate.mjs`, `tests/browser-runtime-gate.test.mjs`.

## Verification

Expectations were written and run first: first 30 adapter tests failed missing
implementation; driver/plan/strict-evidence expectations failed; drain regression
failed; two additional terminal-cleanup expectations failed. Fixed, then tested
individually with distinct SJC_TEST_CLUSTER_TAG values. No DB/harness cluster was
created, so no cluster needs stopping. Every subprocess used for offline tests
has exited. No exit 137 / Killed event occurred.

| Test file | Pass | Fail |
| --- | ---: | ---: |
| tests/browser-network.test.mjs | 94 | 0 |
| tests/browser-response-budget.test.mjs | 13 | 0 |
| tests/browser-runtime-gate.test.mjs | 61 | 0 |
| tests/browser-parser-adapter.test.mjs | 33 | 0 |
| tests/browser-acceptance-drivers.test.mjs | 9 | 0 |

Python tests additionally executed directly with
`SJC_TEST_CLUSTER_TAG=browser-n-python-final PYTHONDONTWRITEBYTECODE=1 /opt/sjcos-browser/py/bin/python deploy/browser/parser_adapter_tests.py`:
**33 passed**. Those are the same adapter cases, not additional independent
acceptance cases. They import real pinned classes but use offline byte sources;
they do NOT prove real socket/TLS preallocation, packet containment or RSS caps.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
`node --check` on changed scripts and `sh -n` on installer: pass.
Both `--plan` commands: exit 0, no root/process/browser work.
`node scripts/browser-runtime-check.mjs`: **expected exit 1**. Accessible installed
Python 3.12.3, mitmproxy 12.3.1 and Unbound 1.26.2 match; 42 locked Python
packages/RECORDs match. Node/Chromium root directories are unreadable as Joe;
missing adapter/driver installation, installed-hashes.json, patches, real evidence,
transport integration and independent signature verification keep readiness OFF.
Concurrent P source hashes still need its refresh. No refusal was weakened.

## Coordinator root commands — planned only, NOT acceptance ready

First finish the missing integration code above, review both builders' sources,
refresh P's hashes, install the pinned Playwright patch via P's instructions,
and establish root-reviewed binary hashes/signature trust. Verify the common
Joe ancestor really has 24G / 800% / no swap and accounts for all his workloads;
the rootless runtime note currently says swap was 1G. Do not reparent or restart
live services. Then review/run these in order from this checkout:

```sh
sudo /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/install-acceptance.sh
sudo /usr/bin/node /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-runtime-check.mjs
node scripts/browser-containment-check.mjs --plan --tag n20261106 --joe-uid 1010
node scripts/browser-rss-check.mjs --plan --tag n20261106 --joe-uid 1010
```

Do NOT proceed merely because sources install. Runtime check currently refuses;
it must not be bypassed. The exact planned acceptance commands printed for fresh
label `n20261106` are below (use a new label if a scope/output already exists):

```sh
sudo systemd-run --scope --unit=browser-0b-network-n20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-containment-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-0b-network-n20261106.json
sudo systemd-run --scope --unit=browser-0b-rss-n20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-rss-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-0b-rss-n20261106.json
```

No real containment/RSS result or completed Phase 0b acceptance is claimed.
The remaining code gaps in items 1 and 2 prevent the coordinator from completing
acceptance with this commit alone. Keep all Browser flags OFF.

Post-commit interface alignment: P has now supplied a launcher-driver source
entrypoint in the shared worktree. N invokes the installed launcher from INSIDE
the disposable browser namespace (via ip netns exec), as P requires. P's entry
still delegates prepareAcceptance/runNetworkCases to the protected controller;
this does not close the missing network/RSS transport/controller implementation.
