# Phase 0b acceptance interface — N/P boundary

Flags remain OFF. These interfaces are disposable acceptance only, never app routes.

N supplies `parser_adapter.py`: `BoundedParser`, `AllocationOwner`,
`UnixPolicy`, and `RuntimeAdapter` for pinned mitmproxy 12.3.1. The adapter must
be installed BEFORE socket reads; calling hooks on the stock DumpMaster does
not attest preallocation. `RuntimeAdapter.attested()` deliberately also requires
an attested transport and deployment verifier; neither a marker nor parser unit
tests can authorize stock startup.

P's dedicated launcher must expose its reviewed acceptance executable as
`/opt/sjcos-browser/fixtures/launcher-driver`. N's network-driver invokes it via `ip netns exec <browser-ns>` with:

```
launcher-driver --kind network --run-id UUID --browser-ns NAME --gate-ns NAME --fixture-ns NAME
```

It must write one <=1MiB JSON document to stdout, no content logs, clean all
children in finally, and fail nonzero on missing integration. Required evidence:
`{runId, kind:"network", realRuntime:true, simulated:false, cases:[{name,passed:true,measurement:{...}}], guardOrderingVerified:true}`.
P owns these cases: `host-cdp`, `listener-cross-context`, `listener-reuse`,
`popup-first-request`, `oopif-first-request`, `worker-never-resumes`,
`controller-loss-keepalive`, `fetch-detach-buffered-write`, `gate-crash`,
`addon-uncaught-exception`, `unauthorized-second-request`, `origin-401-no-secret`,
`proxy-407`, `request-hook-order`, `doh`, `mixed-dns`, `cname-private`,
`dns-rebind`, `peer-mismatch`, `sni-mismatch`, `host-mismatch`.
The driver must use N's parser adapter in the actual gate transport, the exact
signed controller/read-manifest verifier, and fresh Unbound resolutions. N will
not mark these passed from a RequestGate helper call. A missing launcher blocks
network acceptance, rather than reporting simulated success.

N owns namespace creation/firewalls, direct bypass packet probes and capture,
RSS/parser fixture, installation/check scripts. Root may add ONLY the actual
loopback CDP port to `inet sjc_test cdp_ports` in the disposable browser namespace.
There is no fixed CDP port and no host mapping. P selects the port then adds it
before the first attach; it records the selected port in measurement only.

RSS requires traffic helper outside the measured gate cgroup, but in the same
3G capped parent. Runner uses sibling `helpers` and `gate` subcgroups, moves its
own PID into gate (384M/no swap/35%/32 tasks), and passes helper cgroup to driver.
The outer root scope must be delegated/writable cgroup v2 with an empty interior
(no processes after the runner moves). Missing delegation fails closed.

Until the actual TLS/socket transport, controller authority, and P launcher are
integrated and reviewed, unit-tested parser boundaries are not real acceptance.

## Additional explicit blockers / hash coordination

The N change adds `parserTransportIntegrated:true` as a required signed
readiness fact. It remains absent/false; source hashes alone cannot establish it.
`runtime-lock.acceptance.parserPatchSha256` now identifies the adapter source,
so P's `browser-runtime-boundaries` old assertion that it must be null needs to
check the real adapter digest instead. P owns that test and its own changed
source hash entries. N refreshes only N-owned entries, never P's live edits.

P should not implement N's missing network transport on N's behalf. The broad
launcher-driver evidence list above records what the eventual assembled runtime
must demonstrate, not an assignment of N's DNS/TLS/controller work to P.
Outstanding N implementation: wire bounded IO/parser into TLS socket lifecycle,
kernel listener/guard binding, Node RequestGate metadata/body-HMAC protocol,
complete fresh Unbound proofs, signed manifest/consume/checkpoint controller,
unknown receipts and drain-close ack. The RSS driver currently only validates
and delegates to an integrated `parser-transport-driver` which does not exist.
Neither driver is currently sufficient for a passing acceptance run.

## Assembled root runner (2026-11-06, supersedes missing-driver notes above)

The fixed installed network-driver and rss-driver now execute
`node/source/deploy/browser/fixtures/root-fixture.mjs`. The checkout entry scripts
own the disposable namespace recipe and fresh delegated 3G scope's sibling
`gate` (384MiB/35%/32 tasks), `dns` (64MiB/one Unbound thread), `helpers`
(2GiB/105%/208 tasks), and `supervisor` (32MiB/10%/16 tasks) groups. The Node
supervisor and suite observer move into gate, conservatively charging their
overhead alongside the dedicated Python transport and its threads. Browser,
controller, traffic clients and origins stay outside it. The measured
`memory.peak` includes the gate's full native/TLS/parser footprint and observer
overhead, not a ledger estimate. This replaces the missing parser-transport-driver
arrangement. The scope still caps aggregate
CPU at150%, memory3G and tasks256, with zero swap; no host networking or NAT.

Each named case starts a fresh fixture controller, CA, signed exact manifests,
durable consume/checkpoint journal, dedicated uid gate and patched Chromium.
The root-only candidate launch reads a fresh expiring protected run capability,
checks the installed inventory and run/task/boot/namespace, and leaves the
separate release launcher/readiness contract unchanged. Fixture signing keys are
not reviewer keys. They are erased on success/failure, including emergency
cleanup after boot death. All deployment flags and the installed config's
`enabled` remain false. No credential/DB/production authority is provided.

The driver receives the namespace arguments above plus `--helper-cgroup`,
`--gate-cgroup`, `--dns-cgroup`, and `--log-dir`. The supervisor passes them;
there is no arbitrary helper path override. Optional `--case NAME` returns
`diagnosticOnly:true` and cannot validate a complete run. `--keep-on-failure`
retains root-private observations after stopping processes and removing owned
network/cgroup/config/key state. A successful run writes one <=1MiB JSON document
validated by acceptance.mjs, plus `<output>.d` with packet/event/receipt artifacts.
`parserTransportIntegrated:true` is emitted in successful runtime evidence only;
the source lock stays false pending root execution and independent review.

The existing 21 controller cases and seven direct probes are preserved. Raw TLS
clients exercise malformed SNI/Host, real different-peer socket dialing, parser
load and consumed-write interruption using authenticated registered listeners.
They do not pretend to be CDP Fetch events. Browser cases use the actual paused
Fetch guards. The controller-loss cases revoke a live pending policy request and
close the real policy endpoint; no retained keepalive authority exists because
T1 closes a tunnel after its first response. Gate-crash uses explicit root-only
abrupt exit70, never an OOM-shaped SIGKILL. Proxy407 is a real CONNECT challenge.
Terminal telemetry survives revocation and is drained within its bounded ring;
missing/dropped observations, unmatched origin consumes, nonempty allocations,
missing positive controls or absent integration fail rather than invent results.
