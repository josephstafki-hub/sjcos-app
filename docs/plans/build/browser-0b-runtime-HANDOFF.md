# Browser Phase 0b runtime slice

Expectations recorded before implementation/execution (2026-11-06).
All browser flags stay OFF. No runtime launch or deployment is authorized here.

Thirty fresh gate cases must refuse before dispatch: decimal, octal, hex, short
IPv4; IPv6 zone, mapped, NAT64; trailing dot and double dot; IDNA lookalike;
redirect loopback, metadata, private DNS and mixed DNS; rebinding on new socket;
CNAME into app; app /admin, /api, /mcp and /engine/permissions; host public alias;
Azure metadata; IPv6 metadata; QUIC, UDP, HTTP/3, WebSocket, worker; Host mismatch;
SNI mismatch; expired DNS. Positive IDNA is canonicalized and still needs an
exact per-request authorization. No authority is inherited across redirects.

Failure expectations: loss of Fetch/controller/addon revokes existing keepalive
flows, closes listener before reuse, blocks any late decision, consumed writes
become unknown with no retry. No-body, duplicate lengths, Expect, compression,
chunked uploads and over-budget flows are rejected before allocation. Request
bytes are frozen with identity encoding before signing; mutation after signing
cannot dispatch. Response slots survive slow downstream drain, expire at original
60s deadline, and every terminal path releases representations. CLI env/config
exclude owner DB/app secrets, ambient MCP, plugins and privileged transcript;
per-user/task session paths cannot collide. A fake CLI runs through real argv.
Shared pane fixtures retain widths/keyboard/history and refuse failed leave.

Implementation/results/coordinator instructions are appended after verification.

## Delivered code and boundaries

- `lib/browser/gate.mjs`: serialized per-listener-generation state machine,
  request header/body validation, request+response reservation before collection,
  immutable HMAC/nonce, exact trusted decision-verifier seam, <=2s decision,
  pinned actual peer check BEFORE one-time request-byte release, deadlines,
  listener close acknowledgment and fail-closed boot latch. Interception loss
  invalidates pending decisions on keepalives and returns consumed writes as
  unknown/no retry. Baseline rejects site auth/cookies/Referer until reviewed
  exact adapters exist; no implied credential forwarding.
- `deploy/browser/egress_gate.py` and `closed_dispatcher.py`: mandatory hook
  adapter + replacement of mitmproxy log-and-continue safecall, BaseException
  fatal shutdown and sealed addon chain. The addon **refuses stock mitmproxy**.
  It requires the preallocation/Unix-policy runtime adapter specified in
  `parser-contract.md`; that internal adapter/parser patch is NOT implemented
  here. Pure tests execute the Python dispatcher and addon with fake master,
  including fatal exception, missing runtime, killed flow and hot removal.
- `target-barrier.mjs`: same-session callback algorithm, pre-resume Fetch ACK,
  recursive guards, worker refusal, late-timeout fencing and close/revoke.
  `playwright-target-barrier.spec.md` + census: exact cached 1.64.1 upstream bundle
  hash, all SEVEN resume string sites and every Target/Fetch toggle occurrence,
  including detach, dedicated/service worker, crash reload, DevTools and worker
  transport. This is the requested **static patch spec**, not an applied patch.
- `startup.mjs`: explicit narrow env THEN protected 0600/no-symlink credential
  file; no owner/.env fallback; wrong explicit env does not fall through. Checks
  actual session_user=current_user, non-superuser and no bypass RLS before
  returning a connection. Required roles for runner/sjcos/interact are agent;
  controller/reader/gate adapter are browser. Tests use controlled clients, not
  any real DB. The DB/vault builder owns real-session tests and bootstrap.
- `cli-launch.mjs`, `rendezvous.mjs`, `peercred.py`: exact browser CLI config/argv,
  private per-user/task/browser history partition, confirmed-facts-only stdin,
  no ambient env/config/repo privileges, exact 18 allowed tools, one-use
  descendant/start-time/cgroup/node+wrapper-digest registration slots. Linux
  helper collects SO_PEERCRED on a supplied accepted Unix socket. A root-only `launch_broker.py` server implementation and `rendezvous-client.mjs`
  client/startup adapter are supplied, with durable exclusive registration claims.
  Neither server nor actual Claude→MCP integration was run or wired. The
  real argv/env construction is exercised with an executed fake CLI. Existing
  runner remains browser-disabled; no privileged transcript filter was changed.
- `mcp/browser-tools.mjs`: exact 13-tool v1 registration and invocation wrapper,
  inherited task equality, per-call authorizer, observation-context validation,
  fixed errors. Not imported/wired into global MCP, routes or ordinary runner.
- `containment.mjs`, `unbound.conf`: runnable disposable namespace/veth/nftables
  recipe, default deny IPv4+IPv6/UDP, no host route/NAT/forwarding, two gate ports,
  empty root-populated CDP port set, fixed DNS destination, public HTTPS only.
  The fixture has no external uplink: synthetic public 8.8.8.8 exists only in
  its own fixture namespace. All CNAME/A/AAAA and socket peers still require the
  policy checks; Unbound filtering is not authority. Deployment must add the
  full real app/service/public-address inventory before any real runtime use.
- `scripts/browser-containment-check.mjs` and `browser-rss-check.mjs`: coordinator
  runners with nonce-bound complete-case evidence contracts, root-owned reviewed
  external driver requirement, cap checks, no silent simulated acceptance,
  namespace/process cleanup and direct RSS cgroup peak/event checks. **These are
  orchestration/acceptance harnesses, not complete traffic/parser drivers.** They
  require a coordinator-supplied real pinned-runtime driver; see below. Neither
  script (including --plan) was executed here; only `node --check` was used.
- `browser-ui.test.mjs`: shared H5 fixture's second consumer, actual shared layout
  reducer/keyboard/history policy plus Browser leave adapter. Width/device rows,
  failed/concurrent leave, one history exit, passive Watch, attendance-preserving
  content switch and scope reset. No Browser React pane is built or mounted here;
  no device/iframe/focus/rendered UI acceptance is claimed.

## Exact candidate pins and verification

`deploy/browser/runtime-lock.json` contains exact local source/spec hashes and
candidate artifacts. `runtime-pins.mjs` preserves all six flags OFF and adds:

- mitmproxy **12.3.1**, Python **>=3.12**; wheel SHA256
  `87afb808ac8d55383dbe6aa30eadeb0fedaeffd26210e7e23c25c9cd43bdb36a`.
  Verified against [official PyPI metadata](https://pypi.org/pypi/mitmproxy/12.3.1/json).
  Dispatcher safecall API checked against [tagged upstream source](https://github.com/mitmproxy/mitmproxy/blob/v12.3.1/mitmproxy/addonmanager.py).
- Unbound **1.26.2**; source SHA256
  `d8ee7aa6bbb3ff1be7d9e57637d0d0ec2f18273a8efff1a0afe2c665858b96f7`.
  Verified from [official checksum](https://www.nlnetlabs.nl/downloads/unbound/unbound-1.26.2.tar.gz.sha256).
- Existing core **1.64.1** / Chromium **1248** / **156.0.8078.4**, SDK **1.29.0**;
  comparator **0.0.81** stays non-runtime. The private patched runtime, browser
  binary, complete hash-locked Python dependency graph and signed acceptance
  remain absent. Patch/parser/result hashes are honestly null blockers.

The workspace node_modules was missing; a symlink now points at
`/home/joe/sjcos-app/node_modules`. Nothing was installed or modified there.
That live-linked core is **1.61.1**, unsuitable for this runtime. Cached exact
1.64.1 source was read at
`/home/joe/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/lib/coreBundle.js`.
No browser binary was opened or repurposed. Local Python is 3.12.3; neither
mitmdump nor unbound is on PATH. No dependency/security acceptance is implied.

`node scripts/browser-runtime-check.mjs`: **expected exit 1**, local hashes all
match, installed core mismatch + missing patches/transitive lock/runtime evidence
+ signed root attestation block activation. This is an intentional refusal.

All test files executed individually/sequentially, no DB/network/browser:

| Test file | Passed | Failed |
| --- | ---: | ---: |
| browser-network.test.mjs (existing) | 94 | 0 |
| browser-contract.test.mjs | 24 | 0 |
| browser-run-profile.test.mjs (existing) | 14 | 0 |
| browser-runtime-gate.test.mjs | 60 | 0 |
| browser-runtime-startup.test.mjs | 11 | 0 |
| browser-runtime-boundaries.test.mjs | 16 | 0 |
| browser-response-budget.test.mjs | 13 | 0 |
| browser-ui.test.mjs | 22 | 0 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
No killed/137 run. The first expectations-first gate test failed with missing
module before implementation. An early startup test syntax typo was corrected.
No test skips. Response-budget tests cover the ledger and real-evidence refusal
contract; **they do not fulfill the real pinned-parser release gate**.

## Coordinator sequence (NOT executed here)

1. Keep all Browser flags/admission OFF. Merge the disjoint DB/vault slice and
   run its real-role disposable DB tests separately. No production/QA DB here.
2. In a **separate private runtime**, install/review Python >=3.12, the exact
   mitmproxy 12.3.1 wheel above and a fully resolved `--require-hashes` transitive
   lock; Unbound 1.26.2 from the checked source; iproute2 (`ip`), nftables, tcpdump,
   OpenSSL and NSS tools (`certutil`, typically libnss3-tools). Install core
   1.64.1 + SDK 1.29.0 in that runtime only, revision1248 Chromium in its dedicated
   service cache. Never install into/patch live node_modules or use 1228.
3. Required next code/integration work BEFORE running acceptance: implement the
   preallocation parser/Unix-policy adapter ABI in `parser-contract.md`, actual
   pinned Playwright patch per the static spec, dedicated fail-closed launcher,
   wire the provided kernel-peer broker/client and protected strict-DB delivery
   across CLI→MCP. Wire the exact read-manifest/receipt/checkpoint verifier from
   controller/action authority. Produce real fixture traffic drivers; these are
   **not provided by this slice**. Root installs reviewed executables as
   `/opt/sjcos-browser/fixtures/network-driver` and `rss-driver`, root-owned,
   not group/world writable. A driver gets `--kind`, `--run-id` and namespace
   arguments (network) or `--no-network-outside-fixture` (RSS), writes ONE bounded
   JSON evidence document to stdout, uses exact case names from acceptance.mjs,
   attests real parser/packet measurements and cleans every child in finally.
   Do not synthesize JSON from helper counters. No content logs.
4. Verify the common ancestor budget (Joe's actual numeric UID) is truly 24G /
   800% / no swap and includes all Joe workloads; reserve child3G / 150% /
   TasksMax256, supervisor32M. Do not reparent/restart live services for this.
   An unavailable common cap blocks acceptance. The following are coordinator
   commands only, after that accounting and owner authorization exist. Replace
   `<JOE_UID>` and `<TAG>` with trusted numeric UID and fresh incident label.

   From the merged checkout, inspect without launching:

   ```sh
   node scripts/browser-runtime-check.mjs
   node scripts/browser-containment-check.mjs --plan
   node scripts/browser-rss-check.mjs --plan
   ```

   The first currently refuses; do not weaken it. The latter two print plans.
   Then run the network fixture in a **fresh transient root scope**, never a
   live namespace or service:

   ```sh
   sudo systemd-run --scope --unit=browser-0b-network-<TAG> --slice=user-<JOE_UID>-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 /usr/bin/node scripts/browser-containment-check.mjs --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-0b-network-<TAG>.json
   ```

   Network driver creates gate subcap384M/35%, DNS cap64M/one thread, browser
   controller heap256M; max2contexts/4tabs total. Root driver may populate ONLY
   the disposable namespace's empty `cdp_ports` set with the actual ephemeral
   CDP port; no host mapping. Synthetic fixture ingress packet capture MUST show
   zero unauthorized headers/bodies (including keepalive/interception loss).
   Namespace cleanup is in finally, including killing only fixture namespace
   pids and removing leftover freshly-created veths.

   For parser/RSS, use a **new** scope so memory.peak is fresh. Coordinator's
   driver must already have disposable fixture endpoints and gate parser
   configuration; its traffic helper/hostile origin stays outside this measured
   gate cgroup but within the same capped3G child. This runner and gate/driver
   are all charged to the 384M scope, conservatively:

   ```sh
   sudo systemd-run --scope --unit=browser-0b-rss-<TAG> --slice=user-<JOE_UID>-sjcosbrowser.slice -p MemoryMax=384M -p MemorySwapMax=0 -p CPUQuota=35% -p TasksMax=32 /usr/bin/node scripts/browser-rss-check.mjs --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-0b-rss-<TAG>.json
   ```

   Require baseline<=144MiB, measured peak<=336MiB inside384MiB, untouched48MiB,
   56/112/24 pools, exactly2slow response slots, <=64KiB directional queues,
   zero retained flows/reservations, zero OOM/latch. Exit137/Killed: STOP, report,
   do not retry/increase caps. Driver timeout/failure must stop all children;
   run in disposable scope, never production. Independently review packet and
   parser traces/cgroup measurements, then sign the root attestation.
5. Repeat actual CLI resolved-policy checks (not just --help/fake CLI), real
   two-hop SO_PEERCRED registration with replay/PID-reuse attacks, real strict
   DB role checks, original privileged-history exclusion, sandbox check and
   target attachment/resume census on patched core. Visual Browser pane,
   login/Watch return, leave/Back/focus/keyboard/iframe/iPhone/iPad tests remain
   coordinator/later UI work. No dev/build/start was used or requested here.

## Not done / no release claim

No migrations, DB access, dependency install, actual parser patch/adapter,
actual Playwright patch, production launcher/rendezvous integration, controller,
protected bridge/action authority, real traffic drivers, real DB/startup socket
exchange, Browser UI/route/login-return integration, services, namespaces,
firewall/DNS/CA installation, packet capture, runtime RSS measurement, browsers,
production changes or deployments. Flags remain OFF. This is reviewable runtime
policy/addon/specification/harness code with explicit missing integration, **not
completed Browser Phase 0b acceptance or a working enabled browser**.
