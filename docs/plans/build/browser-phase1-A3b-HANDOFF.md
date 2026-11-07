# Browser Phase 1 A3b — integration round 2

Base: 1e7aae3e, branch t3/browser-phase1, shared worktree
/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be. Implementation commit is the commit
containing this handoff (`git log -1 --format=%H -- <this path>`). No push.
Only A3b-owned paths staged. A3a's parallel edits are deliberately untouched.

No subagents, browser/server launch, real network, root/sudo/systemctl, package
installation, live DB, SQL/migration, installed runtime write or source inventory
refresh was performed. No 137/Killed. Tests use mocks/temp roots; fake S3 is an
in-process request handler, with no listening socket or network connection.

## Item → change

1. Barrier lifecycle: exact patched Chromium context creation commits its listener
   to actual context ID. `_closePage` / context `doClose` call mandatory guarded
   close hooks. Fence exact session tree synchronously; remove gate target policy;
   issue fixed close/dispose; wait command ACK AND expected detach events <=2s;
   then release counts/reservations. Unexpected detach, close failure, pending
   unresumed session, stale/released resume, unknown target or closing-context
   attach still revokes. Other context/listener remains live during replacement.
   No worker/reconnect/unguarded-resume path was added. Factory full shutdown
   releases gate leases in finally and waits shutdown before creating a new boot.
   Original + lifecycle censuses, spec, exact transform, result and acceptance
   pins updated. Real lifecycle acceptance is still required.
2. `root-broker.py` is a fixed runner/claim broker. Website uses SO_PEERCRED-
   authenticated broker.sock; controller-only readClaim/registration uses separate
   broker-authority.sock; runner descendants claim on launch.sock. All root-owned
   sockets are0660, with separate website/controller/runner groups. Caller never
   supplies executable/argv/env/cgroup/start time. Dedicated pinned Node + fixed
   run-browser-agent script, empty environment, nonroot runner UID, private fd3
   hold, 20s timeout, two held/live runner maximum. Register returns actual
   `{pid,start_ticks,cgroup,boot_id}`. Bind stores committed SQL capability_hash
   and expiry before release; expired/unbound/repeated release refuses. Cancel
   kills its own unreaped child process group and fsyncs revocation. WNOWAIT
   observes child exit without freeing/reusing the PID before group cleanup.
   Owner PID+start time binds mutations. Root0600 registry/claim files remain
   protected; controller receives proof/hash fields, never DSN/credential paths.
   Existing pinned MCP descendant/ancestry/one-use claim checks remain intact.
3. `checkpoint-exporter.py`: fixed contract described below; stdlib only,
   RFC8032 Ed25519, hand-written SigV4, pinned public IP TLS/SNI endpoint,
   redirects/proxies off, Object Lock COMPLIANCE + version checks and sink highest
   sequence CAS. Root opens/configures the socket/credentials then drops to the
   distinct sjcos-browser-exporter account. Unit32MiB/5% feature slice, no browser,
   vault, DB or controller credential paths. Base IPAddressDeny=any; installer
   writes a journaled IPAddressAllow drop-in from the signed root config's exact
   public IP list. Only fixed HTTPS443/SNI host is used by the process.
4. production-adapter forwards `retentionDependencies(config)` to protected bridge.
   Separate sjcos-browser-retention account/owner-retention credential,128MiB/5%,
   oneshot45s bound; minute timer schedules after prior completion (no overlap).
   Uses A3a's CLI once per firing, not its optional persistent --schedule mode.
5. Factory requires `authorizeInput(record,resolved) === true` after page/session
   awaits. Before actual CDP send, synchronously compare task authority epochs,
   run/state/privacy fields, resolved input and stop state with original snapshot.
   Missing callback, callback refusal or any change refuses; no await after final
   local fence. Service-side authorization alone is insufficient.
6. Installer/units: broker, MCP peer relay (exact --mcp-peer-relay entry), exporter,
   retention service+timer, expanded credential requirements/config examples,
   sink-only egress drop-in, account separation, script install allowlist.
   Peer key comes from /run/credentials/sjcos-browser-mcp-relay.service/peer-key;
   controller gets the same key via its own LoadCredential. Checkpoint/exporter
   keys are separately generated; sink writer/retention LOGIN remain explicit
   owner-provided inputs. Dry-run default and journal-before-write rollback remain.
7. Did NOT run refresh-production-sources.mjs. Only unit-bytes manifest was updated
   explicitly. Source lock file digests and launcher-files remain intentionally
   stale until the coordinator's one refresh after BOTH builders settle.

## Frozen cross-builder interfaces

```js
import {createRootBroker} from './lib/browser/root-broker.mjs';
const runner = createRootBroker(); // website: createWebsiteStart({runner,...})
// controller: createMcpAuthority({readClaim: runner.readClaim,...})
// runner.registration(runId,kind) returns {record,claim}, no DSN or secret.
// runner.register(run,child) returns actual kernel process binding.
// run = {run_id, task:{id,initiator_user_id,...}}; child={runId,pid}.
// issued passed to bindCapability = {capability_hash,expires_at}, from SQL.
const factory = createProductionFactory({
  /* gate, identity, verify, publishFrame, ... */
  authorizeInput: async (record,resolved) => {
    // Re-read committed task/viewer/frame/control authority and compare the
    // resolved event + epoch bindings; return literal true only if still valid.
  },
});
```

Production gate supplies mandatory `policy.releaseTarget(target)` for guarded
close; custom acceptance/installation policies must implement an equivalent
exact binding removal. Missing hook fails close and revokes; there is no no-op
fallback. New listener generation installation still belongs to the gate/SQL
bridge; barrier release never generates authority by itself.

## Exporter contract conformance

Socket `/run/sjcos-browser-exporter/checkpoint.sock`, root-owned0660; only configured
controller UID accepted via SO_PEERCRED. One JSON line<=1024 bytes with EXACT
`v,seq,digest,time,install_id,boot_id,sig`. v1, safe positive integer sequence,
lowercase64-hex digest, canonical UUIDs, UTC ISO timestamp, configured installation,
Ed25519 signature over JCS without sig. This ASCII+safe-integer schema makes
sorted compact JSON exactly JCS. Reject duplicate fields, wrong types/extra fields,
stale timestamps (>120s absolute skew), forged signature and rollback/conflict.

Success EXACT `v,seq,digest,sink,object_key,version_id,retain_until,ack_sig`, with
sink=s3-object-lock. ack_sig covers JCS without ack_sig with separate exporter key.
Failure `{"v":1,"error":"CODE"}`; fixed codes, no raw error/URL/credential logging.
RFC8032 known-answer vector and Node crypto ACK interoperability are tested.

Objects: `checkpoints/<install UUID>/<seq>.json`; only signed checkpoint fields
(IDs, hashes, seq, time, version, signature). Mutable latest pointer
`checkpoints/<install UUID>/highest.json` contains seq+digest, also versioned and
COMPLIANCE-retained. Read latest before EVERY request, including after restart;
reject decreasing sequence or conflicting same-seq digest; PUT checkpoint with
If-None-Match:* then highest with If-Match ETag CAS (or first-create condition).
ACK only after both persisted. Same exact seq/digest retry can recover an already
stored checkpoint; missing checkpoint at a previously acknowledged head refuses.

PUT must return a version ID. Then HEAD must confirm SAME version ID, COMPLIANCE
and retain-until>=requested deadline. S3 does not need to echo retention headers
on PUT itself; absence on the verification HEAD fails. Redirects/other-host URLs
are never followed. No automatic retry of uncertain writes; outbox retry must
reconcile immutable object and highest pointer. Default B2 endpoint/region:
https://s3.us-west-004.backblazeb2.com / us-west-004; default retention731days.
Bucket and public endpoint IP pins are explicit root-reviewed inputs. Examples
contain invalid placeholders and cannot be installed as working configuration.

Provision a dedicated independently administered Object Lock bucket/versioning
and writer Get/Head/Put permission plus retention writes, with NO delete,
retention-shortening, bucket policy or admin permissions. B2's exact region and
conditional-PUT/Object-Lock behavior MUST be proven with its real bucket before
production acceptance. This implementation fails closed if the selected backend
cannot provide the required CAS/version/retention behavior. No sink was provisioned
or contacted here; Python cryptography and SigV4 still require independent review.

## Pins

Upstream core unchanged:
829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d

Patch SHA256 (patch JSON + NUL + runtime.js):
fb71a7f96c43a0bdfae75536afdfb6f07887c73c46542d71384b25ebbf36e1e8

Patched coreBundle SHA256:
5c72f2b33ee33b4f5f1282d5dc3a5a4a5370679d5fed3059ba7a1c7ee61bcf06

1.64.1 / Chromium revision1248 unchanged. releaseReady and
parserTransportIntegrated remain false. The old root evidence is not valid for
these bytes. Repatch must start with pristine upstream, never the old patched
bundle; result.json and runtime-lock acceptance pins match new output.

## Verification (one file at a time)

28 new adversarial scenario expectations were registered before implementation:
broker8/exporter12/lifecycle5/input3. The initial broker invocation failed for
missing implementation. Tests later acquired the full fake backend assertions.

| File | Pass | Fail |
|---|---:|---:|
| browser-playwright-patch.test.mjs |35|0|
| browser-production-factory.test.mjs |25|0|
| browser-installer.test.mjs |8|0|
| browser-launcher.test.mjs |16|0|
| browser-runtime-boundaries.test.mjs |18|1|
| browser-root-runner.test.mjs |17|0|
| browser-root-broker.test.mjs |8|0|
| browser-checkpoint-exporter.test.mjs |12|0|

Total139 pass/1 expected stale-source failure. Test16 of runtime-boundaries
checks exact source inventory, which coordinator must refresh; not waived.
Locked tsc: exit0. Python AST/JS syntax and git diff --check: exit0.
No live/disposable DB or test cluster needed. No installation/activation acceptance.

## Outstanding integration / do NOT activate yet

* Existing protected-bootstrap loads `/etc/sjcos-browser/phase1.json` as root0600
  from NONROOT controller/runner/retention. Installer historically stages
  production.json instead. Reconcile loader/path/credential mounts in A3a or a
  coordinator-owned integration change BEFORE installation. Do not chmod shared
  private config/secrets world-readable to work around it. Runner's narrow DB
  credential also needs a purpose-specific protected delivery path; its uid must
  never read controller/provider/sink keys. This slice does not edit A3a's loader.
* Wire the exported broker/readClaim adapter and mandatory factory authorizeInput
  hook in the actual protected installation bridge, using current SQL authority.
  Kernel boot_id returned by registration must agree with controller/task boot
  binding; do not substitute a caller's JSON UUID or stale acceptance boot.
* Provision/verify new runner, retention, exporter accounts and group assignments,
  actual fixed Node path/digests, MCP script hashes, runner credential files,
  owner-retention DB connection and installation-specific cache purge roots.
* Real root/unit hardening,32MiB exporter peak/5% CPU latency, S3 TLS+CAS+retention,
  runner fd3 launch/cancel/restart, registry/relay peer isolation, guarded context
  replacement with a surviving context and tab close/reuse remain unexecuted.
* All previous Phase1 hostile privacy, frames, CLI/MCP, staff parity, browser
  traffic/RSS, cgroup/OOM and UI/device acceptance gates remain required. No flags,
  migrations, app/live-service restarts or release are authorized by this handoff.

## Exact coordinator sequence (NOT executed here)

Stop on first failure. Keep flags OFF. First settle A3a/A3b commits and resolve
outstanding integration above; enumerate every Joe workload under common24G /
Swap0 /800% user-<JOE_UID>.slice without moving/restarting live workloads.

```sh
cd /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be
node deploy/browser/refresh-production-sources.mjs
node deploy/browser/refresh-production-sources.mjs --check
python3 -I -B deploy/browser/provision_acceptance.py --check-sources
node --test tests/browser-runtime-boundaries.test.mjs
flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .
```

Review/commit that combined source-lock delta. Rebuild the isolated patched runtime
from pristine bytes with the coordinator-owned helper (review its source/target
paths; never modify live node_modules):

```sh
bash "$HOME/qa-sjcos/browser-acc/repatch.sh"
sudo /bin/bash deploy/browser/unprovision-acceptance.sh
sudo /bin/bash deploy/browser/provision-acceptance.sh
sudo /usr/bin/node scripts/browser-runtime-check.mjs --installation-only
sudo systemd-run --scope --unit=browser-a3-network-20261107a --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-containment-check.mjs --run --disposable-only --driver /opt/sjcos-browser/fixtures/network-driver --output /tmp/browser-a3-network-20261107a.json
sudo systemd-run --scope --unit=browser-a3-rss-20261107a --slice=user-1010-sjcosbrowser.slice -p MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes /usr/bin/node /home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/scripts/browser-rss-check.mjs --run --disposable-only --driver /opt/sjcos-browser/fixtures/rss-driver --output /tmp/browser-a3-rss-20261107a.json
sudo /bin/bash deploy/browser/unprovision-acceptance.sh
```

1010 is the prior acceptance UID: verify actual Joe UID and substitute its exact
slice first. Use fresh scope/output tags. Acceptance must recompute all28 network
and15 RSS cases, include actual lifecycle stimuli/new pins, and leave no processes
or namespaces. Diagnostic --case artifacts do not satisfy full acceptance.

After production gates and independent review/signatures, prepare a NEW root bundle:

```sh
sudo /usr/bin/node deploy/browser/phase1-credentials.mjs --apply --out /root/browser-a3-bundle --database-file /root/browser-a3-narrow-login
# Populate reviewed root-broker/exporter/production/supervisor/bridge configs,
# separate retention/sink writer files and all requiredBundle entries OFFLINE.
# Independently sign exact source lock, scriptHashes (INCLUDING retention CLI),
# bundleHashes and all mandatory acceptance evidence. Never use examples as secrets.
/usr/bin/node deploy/browser/phase1-installer.mjs install --database-port <EXPLICIT_PORT>
sudo /usr/bin/node deploy/browser/phase1-installer.mjs install --apply --bundle /root/browser-a3-bundle --evidence /root/browser-a3-evidence.json --review-key /root/browser-a3-review.pub
sudo /usr/bin/node deploy/browser/phase1-installer.mjs verify
```

Review/load only the browser AppArmor profile, validate the installed unit syntax
and egress drop-in, then daemon-reload/start/stop ONLY browser units in Joe's
separate authorized root acceptance window. Include retention timer/exporter/
root broker/MCP relay in stop/census. Installer never enables/starts/reloads them.
Stop units before rollback; unload/restore browser AppArmor separately and retain
incident latch/audit. Do not touch sjcos, sjcos-mcp, sjcos-worker or ordinem.

```sh
/usr/bin/node deploy/browser/phase1-installer.mjs uninstall
sudo /usr/bin/node deploy/browser/phase1-installer.mjs uninstall --apply
```

## Every root-hashed A3b source changed/added

Direct existing/new entries (new ones join at coordinator refresh):

* lib/browser/{production-browser,production-gate,root-broker}.mjs
* deploy/browser/{root-broker,root_broker_tests,checkpoint-exporter,checkpoint_exporter_tests}.py
* deploy/browser/{phase1-credentials,phase1-installer,production-adapter,refresh-production-sources}.mjs
* deploy/browser/{phase1-unit-files,phase1-install-plan,phase1-exporter-config.example,phase1-sink-writer.example,phase1-root-broker-config.example}.json
* deploy/browser/sjcos-browser-retention.timer
* deploy/browser/playwright-target-barrier.spec.md
* deploy/browser/playwright-resume-census.json
* deploy/browser/playwright-patch/{apply.mjs,runtime.js,target-barrier.patch.json,result.json}
* deploy/browser/runtime-lock.json (outer lock; acceptance pins only here)

Unit bytes, covered through phase1-unit-files.json:

* deploy/sjcos-browser.service
* deploy/sjcos-browser-{root-broker,mcp-relay,checkpoint-exporter,retention}.service

No launcher-files.json refresh or D/source parser changes. A3a-owned modified
files seen in git status are not authored/staged by this slice. Source inventory
refresh must additionally include A3a's final files and the retention CLI.
