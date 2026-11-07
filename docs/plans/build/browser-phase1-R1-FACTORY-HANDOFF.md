# Browser Phase 1 R1 — FACTORY / INSTALLER

Implementation is the commit containing this handoff (`git log -1 --format=%H --
docs/plans/build/browser-phase1-R1-FACTORY-HANDOFF.md`). Branch t3/browser-phase1;
base 43d78eb3 plus concurrent review commit 12a66294. Explicit owned paths only;
no push. No subagents.

## Public Continue hooks — final factory contract

- `await factory.pausePublic(record)` on normal public turn end, BEFORE the
  durable run-end write. Synchronously fences model output/old input, cancels
  observation/read controllers, drains pending extraction and capture, stops
  loading every page and revokes/drains the old root listener. It preserves
  public pages and immutable task/context identity; private/close still hard
  fence. No old HTTP flow survives pause ACK.
- After final committed attachment, update record.task from SQL and call
  `await factory.resumePublic(record,{reauthorize:async()=>committedTask})`.
  Callback is mandatory and returns a freshly authorized full task, not boolean.
  It is called before AND after gate rebind. Require active/public task with
  SAME id/kernel boot/context_generation; DIFFERENT nonnull current_run_id;
  GREATER listener_generation and control_epoch than at pause. SERVER must
  increment listener_generation on committed public resume/attachment.
- Gate makes a NEW read bridge/authority, root listener cookie, guard IDs and
  transport binding at that committed listener generation; stable CDP barrier
  sessions keep their identity. Pending old policy/Fetch continuations are
  generation-fenced and cannot continue or kill the replacement turn. Old
  reviewed decisions/capabilities are never revived. Factory only reopens
  extraction after the final reauthorization. Failed rebind fences hard.
- Startup requires both hooks; createServiceIO must bind both. Hook regressions
  cover pause/drain, old-input refusal, different run/new generation, stale
  identity/authority, stable CDP sessions with fresh transport binding and old
  Fetch denial across pause/resume. An integrated BrowserService.runEnd →
  bindAttachedContext → actual factory/gate mock test now passes without
  replacing/copying the public context or reviving any old capability.

## Judge finding → implementation → regression

- Engineering 5 (FACTORY): fixed `navigationState`, `prepareNavigation`,
  `guardedNavigation` on the browser and lazy factory. Exact CDP history entry
  IDs for back/forward; `Page.reload {ignoreCache:true}` for reload;
  `Page.bringToFront` for a live context-owned tab. No Input/click/Enter fallback.
  One-use WeakMap preparations bind action, target, task/boot/run, listener,
  context, document/control epochs and read revision. Re-resolve session/history,
  recheck exact reviewed document, then mandatory `reauthorize` and synchronous
  local fence immediately before send. Reload/back/forward deliberately return
  the next document epoch. Switching tabs drains the old screencast and starts
  capture on the selected page; input/extraction also resolve that page.
  Adapter startup refuses missing guarded navigation IO. Factory tests cover
  all four effects, stale epochs/targets/history/expiry, missing authority,
  one-use retry, screencast switch and wire control → controller → service →
  actual factory mock CDP send. SERVER supplies createServiceIO hook binding.
- Engineering 1/4 (owned gate seams): listener generation comes from
  `task.listener_generation`, independently of context generation. Controller
  bindings also carry `contextGeneration`; the exact frozen D transport wire
  excludes that extra field. Gate preparation verifies an exact next-document
  anonymous GET. A false Fetch authorization calls trusted `discoverFetch`;
  only a successful committed discovery avoids fatal shutdown, after blocking
  the original request. Exceptions and unclassified requests remain fatal.
  Tests assert missing-asset block/review/no replay, nonfatal deliberate new
  reload after review, and fatal binding/classification failures.
- Engineering 7 (EXPORTER): accepts the SERVER replay envelope verbatim. Original
  sig verifies the original payload; replay_sig verifies original fields AND
  original sig AND replay_at. Original time must be <= replay_at; replay_at
  must be within 120 seconds of now. Without refresh, the original 120-second
  freshness rule remains. Sink stores only the original signed record. Strict
  same-seq original-record equality rejects even a re-signed timestamp change;
  highest seq/digest, CAS and Object Lock reconciliation survive restart and
  uncertain sink ACK. Rollback and conflicting digests refuse. Audit-head
  checkpoints are monotonic, allowing legitimate 1 -> 100 head advancement;
  the controller drains all stored outbox records in order without skipping.
  Tests cover 181-second outages, stale/forged/extra replay fields, original
  signature forgery, future original time, audit-head jump/conflict, lost sink ACK, restart,
  and actual JS outbox → Python exporter → JS pinned ACK verification. A lost
  SQL ACK keeps original spool evidence until a later verified commit succeeds.
- Engineering 8: installer and all nonroot consumers now share fixed
  `/etc/sjcos-browser/phase1.json`, root0644 nonsecret metadata with EXACT
  `v,phase,adapter,adapterSha256,bridgeSha256`. Loader checks trusted root path,
  file ownership/mode, metadata schema and adapter hash. Installer verifies both
  adapter/bridge digests. Secrets and broker registry/claims remain root0600;
  consumers use purpose-specific LoadCredential or authenticated broker, never
  direct registry reads. Broker uses `/usr/bin/node`, matching units and actual
  supplied runtime; installer checks its signed nodeDigest and runnerDigest.
  SERVER also reconciled cli-launch.mjs to that executable. Temp-root artifact
  tests cover exact loader path, modes, unknown/secret config rejection, unit
  byte parity and all Node ExecStart paths. New example is deliberately invalid
  until exact digests are supplied. No credential provisioning was performed.
- Engineering 10 (CDP): finite half-open x=[0,1280), y=[0,800), preserving full
  fractional precision exactly as the current phase1-contracts InputEvent.
  Pointer and wheel regressions parse the shared schema and deliver fractional
  edges through the final authorized factory; upper edges, negative, NaN and
  infinity refuse.

Regression expectations were added before each implementation; initial runs
failed on missing navigation hooks, replay acceptance and installer metadata.

## SERVER contract conformance

Re-read docs/plans/build/browser-phase1-R1-SERVER-HANDOFF.md after implementation,
including its discovery and updated continuation notes. Exported navigation hook
names/signatures and mandatory final reauthorize callback match exactly. No new
client wire fields or generic navigation path were introduced. Factory consumes
all four epoch/revision request bindings and returns the next document epoch.
Missing review stages discovery, returns BROWSER_REVIEW_REQUIRED so the UI
opens review, and requires a NEW deliberate action. The final SERVER correction
clarifies that seq is an audit head, so heads need not be numerically consecutive;
the exporter now accepts 1 -> 100, rejects rollback/conflict, and leaves ordered
no-skip replay of stored records to the controller outbox.

Replay accepts exactly either original
`v,seq,digest,time,install_id,boot_id,sig`, or those fields plus
`replay_at,replay_sig`. Both signatures use the pinned controller key and sorted
compact canonical JSON. Sink object and original durable evidence are unchanged;
ACK shape stays exactly v1 S3 Object Lock. Actual cross-language recovery is tested.

## Verification (single files, sequential)

| File | Pass | Fail |
|---|---:|---:|
| browser-production-factory.test.mjs | 57 | 0 |
| browser-installer.test.mjs | 11 | 0 |
| browser-launcher.test.mjs | 16 | 0 |
| browser-playwright-patch.test.mjs | 35 | 0 |
| browser-runtime-boundaries.test.mjs | 18 | 1 |
| browser-root-runner.test.mjs | 17 | 0 |
| browser-root-broker.test.mjs | 8 | 0 |
| browser-checkpoint-exporter.test.mjs | 23 | 0 |

185 passed, 1 failed. Runtime-boundaries test 16 is the expected exact source
inventory mismatch: coordinator must refresh inventories after all builders
settle. It is not waived. This slice did NOT run refresh-production-sources and
has not changed runtime-lock.json or launcher-files.json.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: final exit 0.
Initial concurrent SERVER WebsiteHooks.discover inference diagnostics were fixed
by that builder; the final locked run is clean. git diff --check: exit 0.

No browsers, servers, next commands, sudo, systemctl, real network/S3, DB,
installer production apply, dependency installation or writes to installed/live
paths. All installer mutations were under private temporary roots. No exit137.

## Outstanding integration / coordinator work

1. Refresh combined root inventories and the explicitly reviewed private-source
   audit hash for production-browser.mjs (engineering 11; audit fixture is
   outside this slice). Re-run inventory check; re-attest exact candidate bytes.
2. Real root/unit/credential/Node digest acceptance, S3 CAS/retention, browser
   navigation/privacy canary, UI/device and containment/RSS evidence remain
   coordinator gates. No activation/flag enable is authorized here.

## Every root-hashed file changed / added by this slice

- lib/browser/production-browser.mjs
- lib/browser/production-gate.mjs
- lib/browser/protected-bootstrap.mjs
- deploy/browser/checkpoint-exporter.py
- deploy/browser/checkpoint_exporter_tests.py
- deploy/browser/phase1-installer.mjs
- deploy/browser/phase1-root-broker-config.example.json
- deploy/browser/phase1-config.example.json (new; included by coordinator refresh)
- deploy/browser/production-adapter.mjs
- deploy/browser/root-broker.py

No unit bytes, D parser/transport sources, Playwright patch bytes/pins, source
inventories, SQL, UI or other SERVER-owned implementation files were authored
or staged by this slice.
