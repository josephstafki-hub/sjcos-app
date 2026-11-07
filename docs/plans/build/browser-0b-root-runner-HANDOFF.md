# Phase 0b executable root runner — candidate, root acceptance NOT run

2026-11-06. Based on T1 `25b4826e` and T2 `271c2384`. Single implementation
sub-agent, no delegation. No push, root invocation, sudo, systemctl, browser,
namespace/firewall/cgroup mutation, dependency installation, database or live
service action. Flags OFF; no app/global MCP/route/ordinary-runner integration.

## Assembly

- `scripts/browser-{containment,rss}-check.mjs` call the shared root supervisor.
  Both `--plan --joe-uid 1010 --tag root20261106a` print the same complete sequence
  below, with the current checkout's absolute path, independent of caller cwd.
- Supervisor creates only fresh `b0b-<8hex>-{b,g,f}` namespaces/veths/nftables,
  with no external uplink/NAT/host forwarding. It requires a fresh empty,
  delegated 3G/zero-swap root scope and creates sibling gate384MiB/35%/32-task,
  DNS64MiB/one-thread, helpers2GiB/105%/208-task and supervisor32MiB/10%/16-task
  subcgroups; the parent enforces aggregate150%/256tasks. Node supervision and
  the suite observer move into gate, conservatively including their overhead in
  the384MiB measurement, as in the original RSS harness. Traffic helpers,
  controller and Chromium stay outside gate. Cleanup parks the supervisor back
  in its32MiB group before killing/removing gate and helper groups.
- Installed drivers invoke `root-fixture.mjs`; each case boots fresh root policy,
  Unbound1.26.2 with static fixture zone, TLS origin, per-boot CA/leaf,
  uid/gid-checked dedicated gate via `/opt/sjcos-browser/py/bin/python`, and
  patched1.64.1/revision1248 Chromium. CDP stays namespace-loopback with only its
  actual ephemeral port in the disposable nft set. Chromium offers HTTP1 only.
- All21 controller cases plus7 direct cases and all15 RSS cases have executable
  stimuli. Raw TLS probes supply malformed SNI/Host and real different-peer
  socket dialing; browser cases use actual paused Fetch. RSS uses real TLS/native
  parser load: two25MiB slow readers, eight contenders, a25MiB frozen upload held
  through review, malformed/framing/encoding/deadline/disconnect/fault paths.
- The assembly uses T2's real controller policy, gate authority, Ed25519 manifest
  verifier, consume journal and separately keyed/fsynced checkpoint sink. Fixture
  manifests sign the exact frozen digest after matching an explicit, bounded,
  one-use fixture method/URL/kind/body specification. This dynamic fixture signer
  is only for controlled test data, never production authority or release review.
- `launchAcceptanceBrowser` is a separate root candidate capability: protected
  expiring run/task/user/boot/namespace file and exact installed inventory. It
  does not call `runtimeReadiness` with a fabricated true verifier. The original
  `launchBrowser` still requires independently signed completed readiness.
- Per-run signing/checkpoint keys and CA keys are root-only, generated at runtime,
  never committed or retained in artifacts. Only public CA goes to Chromium NSS;
  the gate gets group-readable root-protected leaf material. Policy socket group
  access allows the dedicated uid to reach its uid-0-authenticated endpoint.
- Provisioning installs all seven transport modules, fixture IO, controller
  wrapper plus complete installed source graph, adapterSha256, protected run and
  receipt directories. Config remains `enabled:false,databaseEnabled:false`.
  Reversible original-file/account/permission journal retained. No dependency
  download, service start or reviewer key is part of provisioning.
- Runtime and launcher source inventories refreshed. Parser digest is T1's
  `a8b424037e37de756647d3cf87554dd5385700fc1bfcd9d3d0a6af9543d0f943`.
  Source lock keeps parserTransportIntegrated:false, releaseReady:false and no
  signed attestation. A validated full runtime document records integration;
  a diagnostic single-case result cannot satisfy full acceptance.

## Transport assembly corrections

These change transport_runtime/control, not parser_adapter.py or its digest:

- Root terminal stats stay available after revocation. `events_drain` empties the
  bounded64-event ring so complete observations can be retained without overflow;
  dropped events still fail. Logs add actual refusal, authenticated target/digest,
  active slot, rejected admission and kernel peer mismatch observations.
- Standard Chromium CONNECT Host/User-Agent/Proxy-Connection metadata is bounded
  and accepted; duplicate/credential/cookie/framing fields remain forbidden.
- Root-only faults add actual CONNECT407, abrupt process exit70 and alternate
  public fixture socket dialing before the real getpeername check. No test marks
  a semantic case passed in the transport. Exit70 is an intentional crash fault;
  exit137/SIGKILL remains stop/report/do-not-retry.

## Evidence and failure loop

One <=1MiB JSON document is written with exclusive creation to the requested
`/tmp/*.json`. Full runs pass acceptance.mjs before writing. Successful artifacts
are in `<output>.d` (root0700): snaplen96 ingress PCAPs, metadata-only origin
request digests, complete gate/controller observations, pool samples and durable
consume/checkpoint/unknown receipts. Every origin digest must match a controller
consume. Private packets are decoded from captured IP envelopes, not helper
counters. Guard/Fetch/consume/digest ordering is checked against actual events.

`--case <exact-name>` reruns one case with `diagnosticOnly:true`. Use a FRESH unit
name/tag/output file; do not reuse a previous cgroup or overwrite evidence.
Append `--keep-on-failure` to either scope command to preserve the root-private
`diagnostics=/run/sjcos-browser/acceptance-<UUID>` directory named in stderr.
Processes, cgroups, namespaces/veths, run configs, public CA and private keys are
still cleaned. Emergency cleanup uses an invocation-owned UUID ledger after
process/cgroup settlement. Namespace pid cleanup uses pidfds and verifies the
process is still in this invocation's namespace before signaling it.

Failures report step, case, exact argv, exit/signal and last4096 stderr bytes.
`last-observations.json`, bounded per-child stderr and failure.json aid the next
builder. Paste the failing command, stderr and retained metadata; never keys.
No silent substitution, higher caps, retry after137, alternate runtime or stock
parser fallback. SIGINT/SIGTERM of the supervising command enters cleanup.

The controller-loss fixture revokes a pending signed request and disconnects its
real policy socket. T1 deliberately closes every tunnel after one response;
there is no retained keepalive authority. The Fetch-detach fixture detaches its
actual guarded CDP session while a signed request is buffered. The gate-crash
fixture uses abrupt exit70 and proves its gate cgroup empty; terminal allocation
counts for that case derive from process death, rather than pretending a dead
process answered stats. Independent review should examine these distinctions.

## Exact coordinator sequence (NOT executed by builder)

Keep Browser flags OFF. Confirm the existing common Joe ancestor still includes
all workloads under24G/8threads. Run from this checkout, with a new tag if these
units/files already exist. The old provision journal belongs to the prior lock:
reverse it before installing this candidate. Stop on the first failed command.

```sh
sudo /bin/bash '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/unprovision-acceptance.sh'
sudo /bin/bash '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/provision-acceptance.sh'
sudo /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-runtime-check.mjs' --installation-only
sudo systemd-run --scope --unit=browser-0b-network-root20261106a --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-containment-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-0b-network-root20261106a.json
sudo systemd-run --scope --unit=browser-0b-rss-root20261106a --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-rss-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-0b-rss-root20261106a.json
sudo /bin/bash '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/unprovision-acceptance.sh'
```

For the first diagnostic attempt, append `--keep-on-failure` to the network/RSS
command. For a targeted rerun also append e.g. `--case dns-rebind`, changing the
unit tag and output filename. Do not treat its one-case JSON as full acceptance.
The final unprovision is after processes stop; artifacts under `/tmp` remain for
review. Do not remove/restart any live service, lower common caps or delete an
ambiguous provision journal to force rollback.

Pass criteria per run:

1. Installation-only: every source/installed inventory hash, patched bundle,
   runtime version, binary/wheel ownership/record passes; releaseReady remains
   false. Provision and rollback reverse only journaled changes.
2. Network: all28 distinct cases, this nonce and lock, positive PCAP/plaintext
   control for EACH case, exact signed origin-request correspondence, target/
   Fetch/consume ordering, no dropped events, zero unauthorized upstream bytes,
   zero private packets and zero retained flows/reservations.
3. RSS: all15 cases through the installed transport, two actual concurrent
   response reservations,56/112/24MiB nonborrowing pool bounds,56MiB response
   charge per slot, directional queues<=64KiB, baseline<=144MiB and measured
   cgroup peak<=336MiB within384MiB (48MiB untouched), no memory-event change,
   zero OOM/latch, zero retained allocations/completed bodies, durable interrupted
   write unknown/no-retry, no automatic resend. Browser/traffic helpers never
   enter the measured gate group.
4. Both scopes:3G/150%/256-task/zero-swap parent; dedicated gate384MiB/35% and
   DNS64MiB, controller Node heap256MiB; at most2 contexts/4 tabs. Cleanup must
   succeed. Retained diagnostics contain no private signing/CA keys.

## Local verification

Expectations were written and observed failing before the new runner module,
control changes, packet classifier, scope matcher and HTTP1 argument existed.
Runner logic uses fakes; no root acceptance was invoked. Counts and final tsc
result are appended after the final checks below.

## Not done / no acceptance claim

No root install/uninstall round-trip of this candidate, actual Chromium/NSS launch,
namespace traffic/capture, cgroup/RSS acceptance or independent signature/review
was performed here. The first root execution can reveal integration/platform
failures; the failure loop above is deliberate. No installed source was changed
by this builder. No real CLI resolved-policy, broker/strict-DB/sandbox attestation,
UI/device verification, release/deployment or flag activation. Historical T1/T2
handoffs remain snapshots; this handoff and acceptance-interface's assembly
appendix describe the new candidate runner.

## Final local check results

Each named Node file ran separately with a unique SJC_TEST_CLUSTER_TAG; explicit
same-tag `scripts/test-db.mjs stop` checks reported no cluster running. No DB
cluster was started. No skips/failures in the final invocations:

| Browser test file | Pass |
| --- | ---: |
| root-runner | 16 |
| acceptance-drivers | 11 |
| acceptance-integration | 33 |
| runtime-boundaries | 19 |
| launcher | 15 |
| controller | 84 |
| playwright-patch | 29 |
| response-budget | 13 |
| network | 94 |
| transport | 1 |
| parser-adapter | 44 |
| **Total** | **359** |

Direct `/opt/sjcos-browser/py/bin/python -B` runs: root_runner_tests5/5,
transport_tests49/49, parser_adapter_tests44/44, provision_acceptance_tests9/9.
The49/44 Python cases overlap the Node wrappers and are not independent extra
acceptance. Tests used private temporary files and, in the existing transport
suite, process-local loopback TLS/DNS fixtures; all are closed. No root runner,
Chromium/Playwright browser, live DB, service or external-network action occurred.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit0**.
Frozen source/hash preflight (`provision_acceptance.py --check-sources`): pass.
Changed JS/Python and installer-shell syntax: pass. `git diff --check`: pass.
Both side-effect-free plans print the six commands above. No exit137/Killed.
Candidate startup diagnostics now preserve exact fixture command argv/exit and
last4096 stderr bytes; Chromium captures startup stderr only before CDP becomes
available, never runtime page logs. The commit SHA is in the implementation reply.
