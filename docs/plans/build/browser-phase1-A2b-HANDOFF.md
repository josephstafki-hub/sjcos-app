# Browser Phase 1 A2b — production adapters and offline installer

Implemented in the assigned shared worktree, against `19a024f9`. No subagents,
root/sudo, browsers, servers, systemctl, package installs, DB connections or
installed-runtime writes. No deployment/readiness/flag activation is claimed.

## Changes by item

1. `production-browser.mjs`: separate production factory, fixed helper protocol,
   rev1248 shell/1.64.1 guarded CDP connection; bounded anonymous contexts/pages,
   guarded-session input, visible-only extraction, JPEG55/1280x800/160KiB capture,
   prompt ACK/drop, bounded publication and pressure shutdown. Chromium's argv
   uses the same reviewed sandbox/site-isolation flags without invoking the root
   acceptance launcher. Root helper checks actual namespace, pinned binary/bundle
   inventory, existing uid998 account, clean environment/closed FDs and ephemeral
   short-prefix NSS/profile dirs. Kernel peer uid+pidfd binds start/stop to one
   controller process; only fixed start/stop are accepted.
2. `production-gate.mjs`: proxy slots, exact context/target/guard bindings, paused
   Fetch authorization, static anonymous header replacement (no page cookies,
   referrers or language/client hints), exact request correlation and D authority.
   A2a's committed read bridge supplies the actual Phase1 gate handler. Separate
   nonroot policy socket and pinned gate peer control protocol; no fixture signer.
   `phase1-gate-entry.py` imports the exact seven pinned transport/parser modules,
   verifies their root-owned hashes and mitmproxy12.3.1, issues bounded ephemeral
   leaf certificates and rejects all acceptance fault/case/control operations.
   Existing two-flow/one-per-context/one-upstream allocation is STRICTER than
   128 total/32-per-task/8-upstreams-per-task; no waiting connection pool is added.
   Original-accept deadlines bound CONNECT+TLS10s and headers30s, flow60s.
3. Fixed production namespaces/veths/nft host forwarding+NAT, gate-only single
   thread Unbound64MiB, explicit host alias deny inventory, ephemeral service NSS
   containing only public CA. No global/Joe trust change. CA private key lives
   only in the gate's LoadCredential mount at runtime. `phase1-credentials.mjs`
   prepares a NEW owner-reviewed bundle only with explicit root --apply; defaults
   to printing a plan. No DB/credential discovery. Existing narrow LOGIN file is
   required. Common-ancestor accounting and IPv4 forwarding are prerequisites;
   namespace setup does not change global sysctls.
4. Updated controller/gate/DNS and added helper/setup units; existing aggregate
   3G/150%/256, 2G high and supervisor32M/10%/16 sibling budgets retained. Controller
   heap256M, gate384M/35%/32, DNS64M/10%/8; swap0 and Restart=no for browser tree.
   Latch precheck/stop records and dependency propagation cover controller,
   helper/Chromium and gate failures. No live workload is moved/restarted.
5. Reversible offline installer with install/uninstall/verify, default dry-run,
   immutable source/bundle snapshot, before-write fsynced journal, separate
   root-private backups (no secret bytes in journal), exact before/after hashes,
   owner/mode restoration, symlink/drift/active-runtime refusal and no implicit
   service actions. All mutating installer tests use temporary roots only.
6. Source-only refresh command covers new installed imports and all units via a
   hashed `phase1-unit-files.json`. Parser and Playwright patch/bundle pins are
   unchanged. Root source inventory and launcher inventory are refreshed together;
   releaseReady/parserTransportIntegrated remain false.

## A2a interface conformance and assembly

Re-read A2a's frozen interface before completion. `createProductionFactory(opts)`
is the lazy service IO adapter. Its `browser()` returns one managed object with
`newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}})`
and `close()`. Contexts expose id/close. Pages are created only after a trusted
record has been associated and its proxy/target policy installed. `bind(record)`
can initialize the guarded blank page before other operations.

Factory implements all frozen hooks: capturePublic(record,{signal}),
deliverInput(record,resolved), fence, cancelAndDrainCommands, cancelObservations,
stopAndAckScreencast, drainPublicOutputs, ackPrivate, rotatePrivateHandles,
stopInputAndCapture and release. Drain/ACK hooks return true. Rotation returns the
already committed savedTask.stream_generation; it performs no SQL increment.
Fencing permanently disables model observation/commands while preserving resolved
human input. After Done, a newer resolved control epoch is required. Type-answer
input must be resolved to confirmedText by A2a; no DB lookup occurs in the factory.

Installation assembly (trusted bridge only, never route/model JSON):

```js
const gate = createProductionGate({
  networkConfig,
  readBridgeFor: (record, gateOptions) => createProductionReadBridge({
    ...committedReadDependencies(record), gate: gateOptions,
  }),
  onFatal: () => service.pressure(),
});
const policySocket = await serveProductionGatePolicy(gate);
const factory = createProductionFactory({
  gate,
  verify: verifyExactInstalledCandidate,
  publishFrame: publishAuthorizedBinaryFrame,
});
const io = createServiceIO({factory, db, common});
```

Start policy socket before the first browser request (the gate's startup wait is
bounded). contextFor must freshly derive server task/manifest/provenance and
`gate.bindingForTarget(meta.targetId)`; never use page/RPC claims. The factory's
publishFrame receives `(record,{bytes:Buffer,frame_id,width,height,viewport,
document_epoch,control_epoch,context_generation})`. The bridge attaches fresh
viewer/stream/sequence bindings and uses A2a's encodeBinaryFrame/frame server,
including authorization BEFORE every private frame. No JPEG enters metadata RPC.
Start/stop capture from the actual authorized stream lifetime; factory never
creates viewers or grants control. Register pressure with service.pressure, not
an app restart. A2a owns committed SQL, audit, fresh task resolution and output
fences. The application-specific /etc bridges remain separately reviewed inputs.

**Credential separation changes account wiring:** controller is
`sjcos-browser-controller` (distinct nonroot uid), Chromium remains existing
`sjcos-browser` uid998, gate and DNS each have separate nonroot accounts. The
relay now resolves the controller name instead of assuming998. This is necessary:
a same-uid Chromium can otherwise read the controller's credential mount via
/proc. Service runtime readability comes through supplementary sjcos-browser
(group only); credentials0700/0600 and distinct uids keep private keys separated.
Existing accounts must be provisioned/verified by the coordinator; installer
never creates/reassigns accounts. Signed bundle/accounting config must include
ALL these uids under Joe's common ancestor.

## Installer plan and evidence

Dry-run plans stage seven services, two child/sibling slices, Unbound config,
fixed launch spec and AppArmor profile. Joe UID and explicit DB Unix socket port
are substituted; no DB-port default or unresolved placeholders are accepted.
Real apply additionally copies the frozen installed source graph, the two
coordinator-hashed entry scripts and EXACT required bundle files, then writes
the phase1-accepted marker last. Units remain disabled; no daemon reload/start,
AppArmor load, user creation, SQL, network download or global sysctl is performed.

Bundle contains phase1-bridge.mjs, supervisor-bridge.py, production.json,
supervisor.json, namespace.json, phase1-gate.json, ca-public.pem and credentials
named by installationPlan.requiredBundle. phase1-gate.json contains ONLY
sourceHashes (the seven transport modules) and deniedAddresses; namespace.json
also requires the complete deniedAddresses inventory. Bridge hashes/config and
all secret files must be reviewed out of band. production.json must satisfy the
protected bootstrap; supervisor.json must satisfy supervisor-entry/latch.

Independent Ed25519 evidence is `{payload,signature:base64}`. Signature covers
UTF8 JSON.stringify(payload) exactly. Payload binds phase1, sourceLockSha256,
releaseReady:true, accountingVerified:true, joeUid, commonAncestor (exact
user-<uid>.slice), databasePort, expiresAt, bundleHashes for every required file,
scriptHashes for scripts/sjcos-browser.mjs and scripts/run-browser-agent.mjs,
and the five named canary/read/staff/transport/supervisor evidence hashes. Key,
evidence and bundle must be root-owned/nonwritable and have protected ancestors.
This builder generated no signing evidence. Boolean fixtures are accepted ONLY
by the temp-root test path; real-root apply always verifies the signed bundle.

## Verification

Thirty new factory/installer cases:22+8. The first27 expectations were written
before modules existed (initial factory run failed missing module); three later
regressions exercise Phase1-only gate wiring and concurrent reservations.

| Individually invoked file | Pass |
| --- | ---: |
| browser-production-factory.test.mjs | 22 |
| browser-installer.test.mjs | 8 |
| browser-launcher.test.mjs | 16 |
| browser-runtime-boundaries.test.mjs | 19 |
| browser-root-runner.test.mjs | 17 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit0.
Python AST parse and JS syntax: passed. No DB test/cluster. No137/Killed.
Source inventory verification is repeated after final writes. Parallel A2a edits
made one earlier check stale; coordinator must freeze/relock again after ALL
builders settle. These checks prove mocks/source boundaries, NOT production
systemd, namespace or Chromium execution.

## What is NOT done (do not install/activate around these)

* No real production install/uninstall, services, Chromium, namespace traffic,
  NSS/CA handshake, private-frame canary, cgroup memory/pressure/OOM measurement,
  full workload census, runtime/device/CLI/transport acceptance or signature.
* **Retained barrier lifecycle blocker:** the frozen patched runtime keeps its
  proxy listener Set/page counters for a boot lifetime and treats detach as fatal.
  It has no acknowledged context/target release hook. Wrapper limits and mocked
  close/reuse do not prove replacing a context while another stays active or
  closing/reusing a tab under the real patch. A third context lifetime can refuse
  even after a prior context closes. No unsafe listener reuse/bypass was added.
  Coordinator must commission the guarded release lifecycle change + repin/root
  acceptance before claiming production G01/fresh-browser completion.
* Application-specific protected bridge assembly, real committed contextFor and
  binary viewer publication are A2a/coordinator installation inputs, not fabricated
  by this factory. Confirm the new controller uid in their admission/peer registry.
* Default extraction returns visible text and no control refs. Rendering semantic
  model-control refs is still an application integration step; no arbitrary
  evaluation/CDP API is exposed to model/RPC callers.
* Kernel/service NSS sandbox/Unbound syntax/topology/hardening must be exercised
  in the coordinator's bounded isolated root window. In particular namespace
  setup intentionally retains the host mount namespace (no filesystem namespacing there), so /run/netns bind mounts reach dependent units.

## Exact later coordinator/root sequence

1. Settle all builder commits, resolve the retained barrier lifecycle blocker,
   review protected bridge assembly, and keep all Browser flags OFF. Verify or
   separately provision the distinct service accounts without changing uid998.
   Verify every workload's common user-<JOE_UID>.slice24G/Swap0/800% placement;
   any required live move/restart needs its own owner window.
2. Source only (no sudo):

```sh
node deploy/browser/refresh-production-sources.mjs
node deploy/browser/refresh-production-sources.mjs --check
/usr/bin/python3 -I -B deploy/browser/provision_acceptance.py --check-sources
```

3. With Joe's sudo AFTER review, follow 0b root-runner handoff's old-journal
   rollback → exact-candidate reprovision → installation-only check → fresh
   capped 28-network/15-RSS scopes → independent artifact recomputation. Old r2a
   evidence does not attest this candidate. Re-run production Phase1 gates,
   including replacement lifecycle, nonroot process/credential census, each
   frame sink/privacy barrier and staff parity. No signing shortcut.
4. Prepare a root-private NEW bundle (example directory is a placeholder; use
   actual reviewed paths) and its narrow-login input; populate the required
   bridges/configs and independently sign the evidence described above:

```sh
sudo /usr/bin/node deploy/browser/phase1-credentials.mjs --apply --out /root/browser-p1-bundle --database-file /root/browser-p1-login
/usr/bin/node deploy/browser/phase1-installer.mjs install --database-port <EXPLICIT_PORT>
sudo /usr/bin/node deploy/browser/phase1-installer.mjs install --apply --bundle /root/browser-p1-bundle --evidence /root/browser-p1-evidence.json --review-key /root/browser-p1-review.pub
sudo /usr/bin/node deploy/browser/phase1-installer.mjs verify
```

5. Separately review/load `/etc/apparmor.d/sjcos-browser-chrome`, review unit
   syntax with the real installed paths/DB socket, daemon-reload, and start ONLY
   browser units in Joe's authorized root acceptance window. Stop them the same
   window; verify zero process/namespace survivors. Installer does none of this.
   Uninstall dry-run then root rollback after stopping browser-only units:

```sh
/usr/bin/node deploy/browser/phase1-installer.mjs uninstall
sudo /usr/bin/node deploy/browser/phase1-installer.mjs uninstall --apply
```

Coordinator must unload/restore the AppArmor kernel profile to match journaled
filesystem rollback and keep the persistent incident latch/audit. No live SJC OS,
MCP, worker or ordinem restart, flag enable, DB migration or push is authorized by
this handoff.

## Root-hashed A2b files changed

Direct source inventory entries:

* lib/browser/launcher.mjs
* lib/browser/production-browser.mjs
* lib/browser/production-gate.mjs
* lib/browser/production-namespace.mjs
* deploy/browser/production-relay.py
* deploy/browser/phase1-chromium-helper.py
* deploy/browser/phase1-credentials.mjs
* deploy/browser/phase1-gate-entry.py
* deploy/browser/phase1-installer.mjs
* deploy/browser/phase1-namespace.py
* deploy/browser/phase1-unbound.conf
* deploy/browser/phase1-unit-files.json
* deploy/browser/phase1-install-plan.json
* deploy/browser/refresh-production-sources.mjs
* deploy/browser/playwright-patch/launcher-files.json
* deploy/browser/runtime-lock.json (outer installed lock)

Units are hashed through phase1-unit-files.json: deploy/sjcos-browser.service,
deploy/sjcos-browser-{gate,dns,helper,setup}.service. Existing supervisor/relay
service and slice bytes are also retained verbatim in that hashed unit manifest.
Refresh additionally hashes A2a's concurrently changed browser modules as the
combined candidate; it does not edit or commit those modules. No D frozen file,
parser_adapter.py, target-barrier patch runtime/spec/result or bundle pin changed.
