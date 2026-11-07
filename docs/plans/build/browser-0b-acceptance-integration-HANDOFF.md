# Browser Phase 0b integration handoff — INCOMPLETE

2026-11-06. Implementation sub-agent, branch `t3/browser-0b-acceptance`, based
on `ed97f62d`. No subagents, sudo, browser, mitmproxy listener, namespace, packet
capture, dependency install, live DB/service action, deploy, flag change or push.

**The coordinator still cannot obtain passing real containment/RSS acceptance
from this branch.** Items 1–3 remain implementation work, not root installation
chores. No integration bit or acceptance result was invented. All six flags
remain OFF; `parserTransportIntegrated:false`, `releaseReady:false`.

## Item → result

1. **Partial adapter corrections, NOT transport integration.** `remaining()`
   now bounds every request reservation by the transport's original monotonic
   CONNECT deadline and rejects invalid/nonfinite/expired deadlines. The shared
   owner attempts consumed-write unknown persistence before dropping storage on
   *every* terminal path (including parser errors and expiry), once, with boot
   revocation on durability failure. Bulk revocation cleans other flows even
   when one persistence call fails. Successful release requires explicit
   transport drain ACK; a pending ACK retains the response slot/storage. Failure
   persists unknown before transport close. EgressGate shuts the master down in
   `finally` even if revocation/persistence raises. New tests use installed
   mitmproxy 12.3.1 parsers and real HTTPFlow data classes, offline. These tests
   do **not** wire ConnectionHandler/TLS/HttpStream or measure their allocations.
2. **Controller still absent.** Added independently signed *runtime attestation*
   verification, not a read-manifest/action controller. Ed25519 signatures cover
   exact canonical JSON with purpose, format, bounded lifetime and installed
   runtime-lock digest. Extra/duplicate fields, malformed base64, wrong keys,
   stale/future signatures and changed locks fail. Fixed protected reviewer-key
   and attestation paths; no self-signing, generated reviewer key or `()=>true`
   bootstrap. Runtime check also compares attested artifact hashes to installed
   artifacts. No `prepareAcceptance`, Fetch policy, profile trust or MCP
   authority is claimed.
3. **Drivers still incomplete.** Evidence validation now rejects missing/empty,
   malformed, unbounded, negative or nonfinite per-case measurements, in addition
   to the existing exact case/nonce checks. Shape validation cannot authenticate
   measurement provenance. No RSS transport executable or 21-case controller
   packet runner was fabricated. Existing drivers still fail closed.
4. **Root provisioning candidate supplied, NOT root-tested.**
   `deploy/browser/provision-acceptance.sh` is one offline entrypoint; its Python
   implementation verifies all frozen source/launcher/patch inputs before
   runtime mutations. It installs the exact reviewed patch into the dedicated
   `/opt` package (upstream hash required; patched result/metadata checked on
   repeat), invokes `install-acceptance.sh` from a frozen root-only snapshot,
   installs launcher sources and the launcher fixture, writes installed hash
   inventory, creates the dedicated system uid/gid with home
   `/var/lib/sjcos-browser` and shell `/usr/sbin/nologin`, grants only group read/
   search on Node/Chromium, and creates protected run/config directories.
   Original bytes/permissions and created accounts/directories are journaled
   under `/var/lib/sjcos-browser/acceptance-provision` for teardown. Repeating the
   same source lock is supported; a changed lock requires unprovision first.
   The script starts no browser, listener or service and never queries a database.
   `launch-broker.json` is root0600; `acceptance.json` root0644. Both contain no
   DSNs/secrets. This candidate is deliberately **DB-less**: no browser login
   was provisioned or verified, no credential is created, credentialFiles is
   empty, CLI digest is unset, adapter digest is unset, enabled=false and exact
   code blockers are recorded. Thus these are safe disabled configs, **not a
   working broker/controller configuration**. NSS/fixture CA and any future
   verified narrow-role credential bootstrap remain missing.
   `unprovision-acceptance.sh` restores journaled bytes/permissions and deletes
   only invocation-created files, empty directories and accounts. It refuses
   modified files, changed account identity, a running broker socket, retained
   profiles/history/claims, or nonempty directories; it never kills processes,
   unlinks receipts or stops services. An interrupted provision can require
   root journal inspection; do not delete ambiguous data to force rollback.
5. **Done:** refreshed all source/launcher hashes, parser candidate hash, and
   exact Playwright patch/bundle hashes in `runtime-lock.json`. Fixed the old
   boundary assertion to validate the actual parser digest and preserve false
   integration/release state. Boundary file now passes 18/18.
6. **Plan printing done, runtime caps NOT demonstrated:** both --plan commands
   print the same complete absolute coordinator sequence, including provision,
   installation check, network scope, RSS scope and optional unprovision, plus
   caps and explicit integration blockers. `--installation-only` checks byte/
   package/ownership integrity before acceptance exists; it does not bypass the
   launcher's signed readiness gate. The original full runtime check still
   refuses missing independent acceptance.

Exact patch pins:

- upstream `829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d`
- patch `3e38d67da1c5d3d60cf451d4d8f8f9328be3ecf238c6a099afcf91adab3abea1`
- bundle `0207923460c82ee5d394ff12d180bfbd15a005ddd8baf2a1ac99032dc3642cca`

## Verification

Expectations first: 23 new negative authority/evidence cases, 8 adapter cases,
1 addon shutdown case, and 2 foreign-cwd plan cases (34 fresh adversarial cases). The first new JS file
failed missing implementation; original-deadline/persistence/drain tests failed
against the old adapter; shutdown test failed against the old addon. Fixed then
ran each named browser test separately, sequentially, with distinct
`SJC_TEST_CLUSTER_TAG=b0bi-*`. Additional filesystem journal tests use a private
temp tree; production code has no test-path or owner override.

| Test file | Pass | Fail |
| --- | ---: | ---: |
| browser-network.test.mjs | 94 | 0 |
| browser-runtime-gate.test.mjs | 61 | 0 |
| browser-parser-adapter.test.mjs | 41 | 0 |
| browser-acceptance-drivers.test.mjs | 11 | 0 |
| browser-playwright-patch.test.mjs | 29 | 0 |
| browser-launcher.test.mjs | 12 | 0 |
| browser-runtime-startup.test.mjs | 18 | 0 |
| browser-runtime-boundaries.test.mjs | 18 | 0 |
| browser-contract.test.mjs | 24 | 0 |
| browser-ui.test.mjs | 22 | 0 |
| browser-response-budget.test.mjs | 13 | 0 |
| browser-run-profile.test.mjs | 14 | 0 |
| browser-acceptance-integration.test.mjs | 30 | 0 |

Direct `/opt/sjcos-browser/py/bin/python deploy/browser/parser_adapter_tests.py`:
41/41 (the same cases surfaced by the Node wrapper). Journal Python tests:
9/9, also exercised by one integration test. No additional independent runtime
acceptance is implied by counting wrappers.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
The startup test alone uses the explicitly disposable `tests/_harness/testdb.mjs`
cluster and real narrow session; it stops the cluster in finally. An explicit
same-tag `scripts/test-db.mjs stop` confirmed **no cluster running**. No live DB
was accessed. Its fake CLI + real Unix broker are test fixtures, not Chromium or
mitmproxy listeners. No exit 137 / Killed occurred.

Offline source preflight:
`/usr/bin/python3 -I -B deploy/browser/provision_acceptance.py --check-sources`
passes. Nonroot provision/unprovision refuse before mutations. Shell syntax and
changed JS/Python syntax checks pass. `git diff --check` passes.

`node scripts/browser-runtime-check.mjs`: **expected exit 1**. Source hashes
pass; accessible Python 3.12.3, mitmproxy 12.3.1, Unbound 1.26.2 and all 42 wheel
RECORDs match. Node/Chromium are unreadable as Joe; fixture/module installation,
installed lock/inventory and independent signed acceptance remain absent.

## Exact conditional coordinator sequence

These are printed by BOTH --plan commands with `--tag i20261106 --joe-uid 1010`.
Use a fresh tag for an actual run. **The network/RSS commands cannot pass yet;
finish the missing implementation listed below before running them.** The first
two commands may validate the disabled install separately. Root provisioning and
teardown have not been exercised as root by this sub-agent.

```sh
sudo /bin/bash '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/provision-acceptance.sh'
sudo /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-runtime-check.mjs' --installation-only
sudo systemd-run --scope --unit=browser-0b-network-i20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-containment-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-0b-network-i20261106.json
sudo systemd-run --scope --unit=browser-0b-rss-i20261106 --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-rss-check.mjs' --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-0b-rss-i20261106.json
# Optional; after all invocation-owned processes stop and retained evidence is handled.
sudo /bin/bash '/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/deploy/browser/unprovision-acceptance.sh'
```

Expected criteria, once code is complete:

- Provision: repeatable same candidate, protected accounts/paths, exact patched
  bundle and inventory; no app/DB/service/flags changed. Runtime installation
  check: source/installed hashes and Python/Node/Chromium versions/ownership pass.
- Network: all 28 named cases, same nonce/installed lock, real plaintext fixture
  ingress and target-event measurements, positive capture control, zero
  unapproved upstream bytes/private packets. Gate384MiB/35%, DNS64MiB,
  controller heap256MiB, max2contexts/4tabs; child3G/150%/256tasks, no swap.
- RSS: all 15 named cases through the *real integrated* parser/TLS transport;
  helpers outside the measured gate but inside the child. Baseline<=144MiB,
  peak<=336MiB inside384MiB; 56/112/24 nonborrowing pools, 2 slow slots,
  queues<=64KiB, zero retained flows/reservations/completed bodies, zero OOM/
  latch, consumed interrupted write unknown/no retry. Parent3G/150%/256tasks.
- Teardown: reverse only journaled mutations, preserve preexisting runtime and
  accounts, refuse conflicts/retained run data instead of destroying evidence.
- Coordinator separately verifies the common Joe ancestor24G/800%/no-swap
  accounts for every workload. No reparent/restart of live services. Exit137 or
  Killed: stop and report, never retry or raise caps.

## What's NOT done — code blockers, not root chores

- Actual mitmproxy ConnectionHandler/TLS/HttpStream preallocation/drain patch,
  kernel-derived listener generation and guard identity, complete fresh Unbound
  CNAME/A/AAAA resolution, upstream peer/SNI validation, and bounded TLS queues.
- Exact signed read-manifest verifier/controller, durable consume + independent
  checkpoint/unknown receipt authority, boot-wide flow/listener revocation.
  Existing callbacks delegate to a missing transport. They do not implement it.
- `prepareAcceptance`, real Fetch binding policy and fixture-only CA/NSS profile
  adapter, per-call MCP authorize/invoke/narrow connectDb, and 21 real packet/
  event scenarios; `/opt/sjcos-browser/controller-adapter.mjs` is still absent.
- Real `parser-transport-driver`, end-to-end network/controller/gate integration
  and measured gate cgroup RSS. Provisioning does not install nonexistent code.
- Acceptance bootstrap sequencing: current launcher requires signed completed
  network/RSS/etc evidence before launching to collect the first evidence. A
  separately reviewed, narrowly scoped candidate-launch contract is still
  needed; `--installation-only` alone does not solve that circular prerequisite.
- Root provisioning/rollback run, independent reviewer key/evidence/signature,
  real CLI resolved policy, actual Chrome sandbox/packet/RSS acceptance, UI/
  device checks and activation. No release/acceptance readiness is claimed.

Reviewer signature format (no signer supplied): fixed root-owned
`/etc/sjcos-browser/reviewer-ed25519.pub` and `attestation.json`, neither writable
by service group/others. Envelope is exactly `{payload,signature}` with canonical
base64 fields. Signature is Ed25519 over payload bytes. Payload is canonical
sorted-key JSON of exactly `{format:1,purpose:"browser-0b-runtime",issuedAt,
expiresAt,runtimeLockSha256,attestation}`; times are integer Unix milliseconds,
lifetime<=24h. The attestation still needs every existing runtimeReadiness fact
and independently reviewed artifact/evidence hashes. The installer never creates
these documents or their signing key.
