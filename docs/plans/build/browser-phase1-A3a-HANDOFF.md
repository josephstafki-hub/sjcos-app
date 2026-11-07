# Browser Phase 1 A3a — website, records, checkpoints and guarded navigation

Implemented from `1e7aae3e` on `t3/browser-phase1`, without delegates or push.
Find the implementation commit with `git log -1 --format=%H -- this-file`.
Other builder files were neither staged nor committed. Browser flags remain off;
this is code integration, not installed runtime or activation acceptance.

## Changes by requested item

1. `website-bridge.mjs` is now the default loader in `requireBrowserWebRequest`.
   Missing/invalid protected configuration returns disabled (503). The loader pins
   root-owned `/etc/sjcos-browser/phase1-website.json` and its fixed module
   `/etc/sjcos-browser/phase1-website-bridge.mjs` by SHA256. Neither is installed
   by this work. Module export `websiteDependencies({db,key})` returns the trusted
   inputs to `createWebsiteBridge`: owner committed `transaction`, `proofKey`,
   `ownerId`, `runtimeProjection`, `authorizeRecord`, `reconcile`, supervisor and
   held runner broker. This concretely assembles `createWebsiteStart` and
   `createWebsiteProjection`. Catalog has positive `version`, exact `tasks`
   (conversation/project/lead/user tuple + task_kind), `privateValues`, and exact
   `publicUrls`. Unknown/ambiguous tasks or URLs never fall back to a classifier.
   Private denial facts include actual task-linked project/lead values, even when
   unconfirmed, plus confirmed answers and installation-wide company values.
   They never become model output. The protected catalog must enumerate all
   other company/private values known to that installation.

   `record-projections.mjs` exports `createRecordProjections` and
   `createRecordProfileBridge`. Dependencies are explicit narrow committed
   `transaction`, protected fresh `readTask`, and per-call `authorize`.
   Actual session_user/current_user must both be sjcos_agent for business reads.
   Four exact SJC projections expose fixed operating-rule/area IDs; task-bound
   address/scope; explicitly confirmed compliance permit/license items; or safe
   work status/due/source-kind. No raw notes, body, intake, mail, files, contact
   dumps or ordinary MCP JSON. Project scope comes from its linked lead.
   Address/scope must exactly match a Browser initiator-confirmed answer key
   `project.address`, `project.scope`, `lead.address`, or `lead.scope`.
   Compliance answers use `project.permit:<uuid>` / `company.license:<uuid>`:
   exact title match, safe row ID, confirmed answer revision, and compliance
   area are required; notes/owner/step are excluded. No confirmations => empty
   checklist/license arrays. Work-item ID must be a protected task association;
   an unbound task cannot look up a model-selected work item.

   Initiator questions use real agent_interactions, exact Browser run/task/thread/
   principal association and fresh authorization. FORCE RLS intentionally makes
   private Ask inaccessible to the narrow reader. Therefore questionTransaction
   is a SEPARATE actual-owner-checked website bridge, not the narrow transaction.
   `createQuestionTransaction(pool,options)` wraps it in withAskJournal and a
   committed transaction. UI answering remains the existing authenticated thread
   flow. Polling is bounded to 60s; mismatch, revocation, dismissal or expiry
   refuses. `ask_owner` never redirects a staff question to an owner thread.

2. `web.ts` input_private includes `task_id:t.id` in BOTH viewer/frame projections.
   Regression executes D's real authorizeManualInput: corrected bindings pass;
   either omitted binding fails. A3b's final factory input check is separate.

3. Back/forward/reload/switch_tab are fixed control operations, not click/Enter.
   Website stores a `navigation` proof, controller reauthorizes that web proof
   throughout the service command. Request carries expected_epoch,
   expected_document_epoch, context_generation, read_manifest_revision,
   idempotency_key and target_id for switch_tab. Service serializes per context,
   rereads epochs/privacy, invalidates observation refs and burns attempted keys
   before effects. Public history/reload requires a reviewed NEXT document epoch,
   matching D's deliberate reload/resources rule; gate still consumes the exact
   reviewed read. Private navigation refuses. Tab target must be in the current
   guarded context, never a page title/URL. No generic input bypass was added.

   Service IO contracts: `navigationState(record)` => {back,forward,reload,targets};
   `prepareNavigation(record,request)` => {reviewed:true,document_epoch:old+1,
   read_manifest_revision,...protected exact URL bindings};
   `guardedNavigation(record,{action,target_id,prepared,reauthorize})` must call
   reauthorize immediately before the actual guarded send AFTER page/session
   awaits and return {document_epoch}. No raw CDP method is selected by JSON.
   These are protected installation hooks; absent hooks refuse.
   Website `navigationProjection({task,viewer,session})` must attest
   {guarded:true,back,forward,reload,targets}. Only then does available_controls
   include those controls. The additional `navigation` response supplies epoch,
   generation, revision and <=2 opaque target IDs, no page labels. If the adapter
   is not installed, controls remain disabled. Private contexts advertise none.
   Navigation uses web authority independently of manual private-input control.

4. `audit-checkpoint-client.mjs` implements the exact exporter JSON-line protocol
   at `/run/sjcos-browser-exporter/checkpoint.sock`: <=1024-byte signed request,
   JCS Ed25519, pinned exporter ACK verification, exact seq/digest, Object Lock
   sink/version/retention checks. Root-owned non-world-writable socket in protected
   ancestors permits the controller group to connect; exporter enforces SO_PEERCRED.
   No TCP fallback or ACK-shaped success. Protocol verifier rejects extra keys,
   malformed signatures and invalid retention dates.

   Existing fsynced outbox is reused, capped at <=64MiB; files survive missing/
   forged ACK and SQL commit failure. Replay sorts by SEQUENCE rather than hash
   filename. New checkpoint is durably queued before retrying older records;
   replay drains older checkpoints before newer ones. `boot`, 60s `tick`, 100
   `event` calls, `shutdown`, and `beforeEffect` hooks are exported. Full spool or
   outage refuses effects, never discards evidence. Service start/tick/shutdown
   use these hooks; production controller startup REQUIRES their presence.
   Shutdown checkpoint is attempted even if closing the browser throws.

   `createProductionAudit({transaction,writer,stageEvent,readHead,...clientOptions})`
   concretely commits browser_append_audit, obtains exporter ACK, has the separate
   protected owner writer verify/stage its attestation, commits browser_checkpoint
   through the service transaction, THEN removes the outbox entry. Install its
   `checkpoints` on service IO and use its `anchorReadIntent` on the production
   read bridge. Read-intent is the exact flow-bound read_consumed evidence; SQL
   refuses read consume until a checkpoint covering it exists, and D's gate
   awaits that commit before dispatch signing. Approval precedes it in the chain.
   Keys, head/stageEvent adapters, owner verifier transport and the independent
   sink remain separately provisioned installation dependencies, not booleans.

5. `production-bridge.retentionDependencies(config)` exports owner-side bounded
   retention dependencies with <=100 rows/batch. `scheduleRetention` is a
   nonoverlapping minute scheduler with close/drain; retention CLI also supports
   explicit --schedule outside controller identity. A3b's systemd timer can use
   the default one-shot CLI instead. Owner LOGIN is checked by existing retention
   executor; no controller owner DSN, no new narrow grants.

6. 32KiB signed metadata and existing paging limits are unchanged.
   0115 ONLY (still unapplied live) adds navigation to the web proof operation
   CHECK; additive schema snapshot agrees. Manifest documents the separate owner
   question path. Actual generator output for agent_interactions is pasted in
   0115; existing grants and FORCE RLS are preserved, not broadened.

## Verification

First 30 new adversarial expectations were written before implementation (initial
website run failed missing module). Three additional cases exercise real narrow
record reads, real owner question backend and bounded retention scheduling.
Each test file invoked separately. All DB clients and subprocesses used disposable
harness URLs; tag `browser-p1-a3a-1107r`. Explicit stop: exit0, reported `stopped`.
No Next dev/build/start, Chromium/browser, package install, sudo/systemctl,
installed service/unit/runtime writes or live DB connection. No exit137/Killed.
Transport gate exercises its temporary test sockets; no production server started.

| Individually invoked test file | Passed | Failed |
|---|---:|---:|
| ask-private-query-scan.test.mjs | 11 | 0 |
| ask-thread-access-db.test.mjs | 33 | 0 |
| ask-thread-recovery-db.test.mjs | 43 | 0 |
| browser-acceptance-drivers.test.mjs | 11 | 0 |
| browser-acceptance-integration.test.mjs | 42 | 0 |
| browser-contract.test.mjs | 40 | 0 |
| browser-controller.test.mjs | 101 | 0 |
| browser-flags-db.test.mjs | 12 | 0 |
| browser-launcher.test.mjs | 16 | 0 |
| browser-multiturn-db.test.mjs | 5 | 0 |
| browser-parser-adapter.test.mjs | 44 | 0 |
| browser-playwright-patch.test.mjs | 35 | 0 |
| browser-response-budget.test.mjs | 13 | 0 |
| browser-roles-db.test.mjs | 12 | 0 |
| browser-root-runner.test.mjs | 17 | 0 |
| browser-round1.test.mjs | 69 | 0 |
| browser-round2.test.mjs | 26 | 0 |
| browser-run-profile.test.mjs | 14 | 0 |
| browser-runtime-startup.test.mjs | 21 | 0 |
| browser-schema-db.test.mjs | 31 | 0 |
| browser-supervisor.test.mjs | 18 | 0 |
| browser-transport.test.mjs | 1 | 0 |
| db-roles-manifest-db.test.mjs | 7 | 0 |
| db-roles-paths-db.test.mjs | 4 | 0 |
| browser-phase1-bridges.test.mjs | 43 | 0 |
| browser-phase1-bridges-db.test.mjs | 13 | 0 |
| browser-private.test.mjs | 22 | 0 |
| browser-read-manifest-db.test.mjs | 26 | 0 |
| browser-submit-guard.test.mjs | 20 | 0 |
| browser-outbound-data.test.mjs | 31 | 0 |
| browser-egress-gate.test.mjs | 27 | 0 |
| browser-network.test.mjs | 94 | 0 |
| browser-runtime-gate.test.mjs | 61 | 0 |
| browser-runtime-boundaries.test.mjs | 18 | 1 |
| browser-website-bridge.test.mjs | 22 | 0 |
| browser-audit-checkpoint.test.mjs | 11 | 0 |

1014 passed / 1 failed across 36 files, no skips. The one failure is the expected
runtime-boundaries installed-source lock/hash check. No source-inventory refresh
was run; coordinator must freeze/relock after BOTH builders finish. Earlier green
runtime checks do not attest the modified candidate. Private-query SQL/source
census was reviewed separately (not the root source refresh) and passes 11/11.
Locked tsc (`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`): exit0.
`node scripts/db-roles-scan.mjs --diff`: exit0; sjcos_browser 0 tables. Conservative
agent graph now sees 184 tables (179 previously) because protected record bridge
imports owner assembly; withheld owner/private table privileges remain withheld.
Worker163 inventory remains. `git diff --check`: exit0.

## Remaining integration / acceptance gaps (do not activate around them)

- No protected website/catalog/owner verifier/keys/sink configuration installed.
  Default route fails closed until a reviewed websiteDependencies module exists.
  The exact per-task catalog tuple classifier is deliberately restrictive; there
  is no automatic task-kind inference from user purpose/page content.
- No production factory history/reload/window API was added in A3b-owned files.
  Installation must implement the three fixed guarded navigation IO hooks above
  and its fresh navigation projection, plus authorizeWeb's navigation proof
  association. Until then these controls remain unavailable; service tests prove
  epoch/refusal rules using a guarded IO fixture, not real Chromium navigation.
- Record/project scope only exposes a confirmed linked-lead scope; absent scope
  remains null. No model-selected work item is inferred for an unbound task.
  Browser task creation does not manufacture a work-item association.
- Exporter interoperability here is protocol/key/outbox tested with a fake
  exchange, not a real Unix socket/S3 Object Lock deployment. SQL verifier uses
  pinned protocol signatures; a real independent sink and key/head/stageEvent
  transports must be provisioned and tested before any read dispatch.
- No real Claude/history/credential isolation, 1248 private canary, root network28/
  RSS15/pidfd/peer/target suite, browser lifecycle, SSE/device/IME or visual UI
  acceptance. Coordinator must check navigation disabled/enabled states, reload
  review/new epochs, input after takeover, owner/staff questions and failures.
- Root source inventory is intentionally stale; A3b/coordinator owns refresh.

## Root-hashed files changed by this slice

Existing locked modules: lib/browser/{audit-service,phase1-contracts,
production-bridge,service}.mjs. Their new transitive imports include
lib/browser/{audit-checkpoint-client,record-projections,website-bridge}.mjs;
website web.ts is not a controller executable. Changed executable sources
scripts/{sjcos-browser,browser-retention}.mjs also require the coordinator's
source/install inventory review (retention entry was not in the old lock).
No A3b launcher/production-browser/production-gate/production-namespace,
root-broker, deploy/browser or unit files were modified by A3a.
