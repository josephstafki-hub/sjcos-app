# Browser Phase 0b acceptance — Playwright/launcher slice P

Purpose: executable pinned target-barrier candidate, dedicated disposable
launcher and kernel-peer CLI→MCP strict startup. All browser flags remain OFF.
No app route, global MCP server, ordinary runner, migration or live service changed.
This is **not completed Phase 0b acceptance**: the reviewed real controller,
read-manifest verifier and gate transport adapter are still missing. The launcher
driver refuses that gap rather than inventing passing packet evidence.

## Contract and delivered files

- `deploy/browser/playwright-patch/apply.mjs` verifies exact pristine 1.64.1
  SHA256 and all 15 original census rows before changing bytes. It applies the
  ordered exact-text `target-barrier.patch.json` (expected match counts, first
  occurrence only), embeds `runtime.js`, syntax-checks the result, verifies the
  after census, writes NEW `coreBundle.js` and `sjc-patch.json` with `wx`.
  It never edits the input. `result.json` records reproducible result hashes.
- All SEVEN upstream resume calls are removed. There are two executable
  autoattach calls (root, recursive), one denied extension switch and one
  comment. Playwright remains sole autoattach owner. The only executable resume
  is in the separately hashed `lib/browser/target-barrier.mjs`.
- `guardTarget` now supports prepare → initialization → single guarded resume →
  navigation wait. The same <=2s attachment budget survives initialization.
  Worker/unknown/startup/detach/dispose/crash/reload/duplicate reattach and lost
  context revoke the boot. Atomic slots cap two contexts/two tabs each; listeners
  cannot be shared. Route/auth Fetch handlers and toggles are removed/refused.
  Persistent context, CDP reconnect, DevTools and worker transport fail closed.
  Updated static spec/census describe dispositions, not acceptance approval.
- `lib/browser/launcher.mjs`: fixed `/opt/.../chromium-1248/chrome-linux64/chrome`,
  signed readiness and exact bundle/Chromium hashes, root ownership checks,
  kernel netns inode checks against `/run/netns/b0b-<8hex>-b` and `/proc/1`,
  private per-user/task/fresh profile, empty startup window, sandbox retained,
  no ambient env, extensions/QUIC/background networking disabled. Chromium drops
  to explicit nonroot uid/gid. Only discovered ephemeral loopback CDP port is
  added to nft `inet sjc_test cdp_ports` INSIDE that namespace; no host mapping.
  Dedicated process group, bounded revoke, TERM/KILL, port/profile cleanup.
- `deploy/browser/launcher-driver[.mjs]` conforms to N's
  `acceptance-interface.md`: exact network argv, <=1MiB JSON, 21 required real
  measurement cases, cleanup before output. No controller means fixed nonzero
  error and EMPTY stdout. `protected-bootstrap.mjs` loads only root-owned
  `/etc/sjcos-browser/acceptance.json` and hash-pinned
  `/opt/sjcos-browser/controller-adapter.mjs`; no model module selection.
- `cli-launch.mjs` adds exact MCP identity parser and `launchRegisteredCli`:
  readiness + CLI-policy checks, root executable checks, transfer of isolated
  history tree to narrow uid, spawn waiting for stdin, broker registration of
  direct child, then confirmed-facts-only prompt. Refusal kills private group.
  Root must provision its parent CLI directory searchable by the narrow uid;
  use `directoryUid` when preparing subsequent runs as root.
- `launch_broker.py` now has a production entry and trusted launcher registration
  operation. Root launcher script/node digests authenticate the first hop;
  broker reads direct CLI child PID/start/uid/cgroup itself, persists immutable
  root-only record before stdin release. The second hop authenticates MCP
  SO_PEERCRED + live ancestry/start/cgroup + exact Node/wrapper hashes. Live CLI
  start/cgroup is reread before credentials. One-use durable claims persist a
  capability HASH and peer binding (never plaintext capability). Restart, copied
  IDs, PID reuse and replay cannot reissue slots. `peercred.py` rechecks ALL
  ancestry snapshots and hashes `/proc/pid/exe`, not a mutable executable path.
- `rendezvous-client.mjs`, `startup.mjs`, `mcp/browser-tools.mjs` and
  `deploy/browser/mcp-entry.mjs`: protected socket delivery before tools register,
  exact response schema, in-memory capability/DSN only, actual session checks.
  Browser MCP uses **sjcos_browser**, sjcos/interact use **sjcos_agent**; no owner
  fallback, SET ROLE, superuser or bypass RLS. DSN removed from verifiedRun.
  `startBrowserMcp` is dedicated stdio only; global MCP remains untouched.
- `install-playwright.sh`: root-only new isolated package candidate install;
  `--launcher` installs hash-verified reviewed source under the isolated Node
  tree. `launcher-files.json` binds launcher dependencies separately from patch
  identity. It includes N-owned dependencies as READ-ONLY inputs; I edited none.

## Patch hashes (candidate, not reviewed/signed acceptance)

- upstream: `829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d`
- playwrightPatchSha256: `3e38d67da1c5d3d60cf451d4d8f8f9328be3ecf238c6a099afcf91adab3abea1`
- patchedBundleSha256: `0207923460c82ee5d394ff12d180bfbd15a005ddd8baf2a1ac99032dc3642cca`

Patch identity = SHA256(UTF8 patch JSON || NUL || UTF8 runtime.js). The
application script also checks the external barrier source through the root
source manifest; coordinator must put ALL final source hashes and the two patch
hashes into N/coordinator-owned runtime-lock.json. I did not edit that file.
Root `/opt/.../node` was unreadable; source was read from the provided user-owned
copy and matched the EXACT upstream hash. Live 1.61.1 node_modules was never used
for Playwright, installed to or edited.

## Verification

Expectations were written before implementation: the initial patch test failed
with missing apply.mjs. Over 25 fresh adversarial cases were added. Each test
file runs separately with `SJC_TEST_CLUSTER_TAG=browser-p-acceptance`.

| File | Pass | Fail |
| --- | ---: | ---: |
| browser-playwright-patch.test.mjs | 29 | 0 |
| browser-launcher.test.mjs | 12 | 0 |
| browser-runtime-startup.test.mjs | 18 | 0 |
| browser-contract.test.mjs | 24 | 0 |
| browser-runtime-boundaries.test.mjs | 16 | 1 |

The ONE failing boundaries test is the existing whole-source runtime-lock hash
check. P changed assigned files; N/coordinator owns the final lock refresh.
Do not weaken this test. It also has an old `parserPatchSha256 === null`
expectation: once N records the real parser candidate, coordinator should update
that assertion to the new exact hash while preserving releaseReady=false.

Patch tests include AST + exhaustive string census, syntax checks, actual
patched module loading (no browser), private-connect refusal, live-guard helper
paths, workers, timeout/stale binding, tab/context/listener races and detach.
Startup test executes fake launcher → fake CLI using real generated argv/config
→ actual Node MCP child → real Python Unix socket broker (SO_PEERCRED) → protected
credential → **real LOGIN sjcos_browser** on disposable testdb. It asserts
session_user=current_user, no super/RLS bypass, replay refusal and no DSN output.
The test-only broker owner_uid override uses its private temp directory; production
serve hard-requires root and the fixed socket. Kernel-role proof is real; actual
Claude resolved policy and production-root provisioning are NOT claimed.
The disposable DB cluster was stopped and removed in finally. An early test hung
because it awaited an already-exited broker; only those test PIDs were terminated,
the tagged cluster was stopped, the event race was fixed, and the test passed.
No exit137/Killed and no retry of resource-killed processes.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0.
`bash -n install-playwright.sh`, Node syntax checks and git diff --check pass.
No Chromium, Next server/build, browser, namespace, root install or live service
was started. Actual GUI/event/packet/sandbox/RSS acceptance belongs to coordinator.

## Exact coordinator install commands — ROOT shell, NOT executed

Review this candidate and the merged N changes first. Keep all flags OFF. These
commands affect ONLY the separate `/opt/sjcos-browser` acceptance tree. Preserve
the pristine package; do not rerun the patch against an already-patched source.

```sh
cd /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be
/bin/bash deploy/browser/install-playwright.sh /opt/sjcos-browser/node/node_modules/playwright-core /opt/sjcos-browser/node/node_modules/playwright-core-sjc-0b
mv /opt/sjcos-browser/node/node_modules/playwright-core /opt/sjcos-browser/node/node_modules/playwright-core-upstream-1.64.1
mv /opt/sjcos-browser/node/node_modules/playwright-core-sjc-0b /opt/sjcos-browser/node/node_modules/playwright-core
/bin/bash deploy/browser/install-playwright.sh --launcher
install -m 0755 deploy/browser/launcher-driver /opt/sjcos-browser/fixtures/launcher-driver
install -d -m 0711 /run/sjcos-browser /run/sjcos-browser/profiles /run/sjcos-browser/cli
install -d -m 0700 /run/sjcos-browser/registry
```

Provision a dedicated NONROOT Chromium/CLI uid and gid first (not done here).
The source tree and pinned Node/Chromium libraries must be root-owned and
readable/searchable by that service group, never group-writable. For a provisioned
`sjcos-browser` group (source contains no credentials):

```sh
chgrp -R sjcos-browser /opt/sjcos-browser/node /opt/sjcos-browser/browsers
chmod -R g+rX /opt/sjcos-browser/node /opt/sjcos-browser/browsers
chmod -R o-rwx /opt/sjcos-browser/node /opt/sjcos-browser/browsers
```

Provision `/etc/sjcos-browser/launch-broker.json` root0600 with numeric webGid,
launcherUid=0, launcherNodeDigest, launcherDigests[], cliDigest, nodeDigest,
executables{browser,sjcos,interact} SHA256, and credentialFiles{kind:absolute
root0600 narrow DSN file}. Digests refer to actual `/proc/exe` and absolute
Node script in argv[1]. Bootstrap record creation never accepts caller DSNs.
The fixed production broker command, inside a coordinator-owned disposable
capped run (NOT as an existing service), is:

```sh
/usr/bin/python3 -I -B /opt/sjcos-browser/node/source/deploy/browser/launch_broker.py
```

Python isolated mode omits script-directory imports on some versions: the broker
entry establishes its own trusted sibling peercred path. Stop this broker after
acceptance. Never unlink old durable claims/reuse an ambiguous run.

Provision the missing reviewed controller adapter and `/etc/sjcos-browser/acceptance.json`
(root-owned, nonwritable by the narrow uid; no DSNs/secrets). Required adapter API:

- `prepareAcceptance({runId,config})` → launchBrowser options containing signed
  attestation + verifySignature, userId/taskId, nonroot uid/gid, policy and onPort.
- policy `{bindTarget, validateBinding, registerFetch(session,binding,isLive),
  revokeListener(), prepareProfile({home,profile,uid,gid})}`. prepareProfile must
  install ONLY the reviewed fixture CA/NSS trust; no ambient Chrome profile.
  revokeListener is BOOT-WIDE, closes all existing upstream/keepalive flows and
  marks consumed writes unknown. Fetch callbacks recheck isLive after EVERY await.
- `runNetworkCases({runtime,runId,namespaces})` → actual packet/event measurements
  for all 21 P cases in acceptance-interface.md; never helper-counter evidence.
- `browserMcpDependencies()` → narrow connectDb, per-call authorize/invoke and
  observationContext adapters. Broker-issued capability must be checked against
  its durable hash/peer/run binding by that authority. No fake authority supplied.

Acceptance config pins `adapter:'/opt/sjcos-browser/controller-adapter.mjs'` and
its adapterSha256. Attestation must also contain exact chromiumSha256 in addition
to all runtimeReadiness fields. Readiness currently requires signed real namespace,
RSS, CLI, rendezvous, sandbox and review evidence even for this launcher: the
coordinator must resolve bootstrap evidence provisioning explicitly, not replace
verifySignature with ()=>true. This slice introduces no fixture bypass.

After that integration and N's parser/transport installation, N's network driver
must execute the launcher-driver INSIDE the browser netns (ip netns exec); it
receives the exact argv from acceptance-interface.md. Host invocation is denied.
Run coordinator sequence 4–5 from browser-0b-runtime-HANDOFF.md with fresh capped
root scopes, unique tags, and teardown in the same turn. No root acceptance was
run here, so no passing packet/measurement results are claimed.

## Not done / coordinator work

No real controller/read-manifest/action authority, real mitmproxy TLS transport
integration, CA/NSS provisioning, root-role/bootstrap account provisioning,
production Claude resolved-policy run, full three-server filtered catalog,
independent review/signature, Chromium/event/packet acceptance, memory acceptance,
UI/login/phone/tablet verification, service deployment or enabling any flag.
The launcher entry and browser MCP refuse missing protected configuration.
Fresh real-runtime measurements are required before promoting this candidate.
No push. Commit SHA is reported in the implementation reply.
