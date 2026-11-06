# Canvas Phase 1 core backend handoff

Built on `2996d531`, branch `t3/in-app-browser-agent-tools`, in the assigned worktree.
Shared types were written first and committed separately: **12c54bde**.
This is the core backend slice, not acceptance of the complete Phase 1 release.

## Changes and contracts

- `lib/canvas-api-types.ts`: shared §5.5 availability, metadata, version, source,
  mutation, list, version-page, event union/page and fixed error envelopes. UI
  imports this file. Bigint event IDs remain decimal strings; metadata has no source.
- `0106_ask_canvases.sql`: canvas/version/request/event/usage/minute-window records;
  immutable identities and snapshots, same-thread composite FKs, deferred latest
  validation, 20/thread and 100/version bounds, 10 accepted content writes/minute,
  100/run, retained byte caps of 20 MiB/thread, 200 MiB/person and 1 GiB/global.
  UTC minute windows, conservative serialized row accounting plus 4096 bytes of
  request/event/index overhead per version. Parent count counters and usage
  checkpoints update atomically. Failed writes roll back request/event/rate/usage.
  Page is predeclared with the 256 KiB bound, but Page/Floor writes remain refused.
  Provenance revision, completeness, input refs/hashes and manifest hash are stored
  with **no FK to 0107**. All new functions are SECURITY DEFINER with fixed search
  path; PUBLIC execution is revoked. No narrow login receives raw Canvas access.
- `lib/ask-canvases.ts`: journal-fenced commands, current session/person/area checks,
  explicit owner=self thread predicates for owner and staff, CAS, whole-snapshot
  restore with null run, strict request hashes/replay, source opt-in, availability,
  bounded event/list/version pagination, HMAC cursors and fixed error serializers.
  Cursor MAC binds person/thread/direction; list boundaries preserve PostgreSQL
  timestamp microseconds. Metadata pages stay below 16 KiB. Canvas-off event feeds
  still return availability and redacted events. Phase-0-only feeds return an
  empty disabled page without querying 0106 tables. Streamed JSON is bounded and
  compressed bodies refused; human mutations check Origin. Per-person bounded
  admission/body abuse windows supplement durable accepted-write counters.
- Every content write calls exactly
  `conversationProvenance({client: db, threadId})` under thread serialization.
  Unknown provenance derives all 21 content areas; ai/projects are access gates,
  not sensitivity labels. Staff writes are refused while the fail-closed stub is
  present, even for staff with every area. Actor permissions never classify data.
- `mcp/canvas-tools.mjs` exports exactly
  **`registerCanvasTools(server, ctx)`**, where `ctx={json,canvasCall}`. It registers
  show_canvas/update_canvas/get_canvas/list_canvases and shares strict Zod schemas
  with the website commands. Unknown identity/context/scope/CSP fields are refused.
  MCP mutation results contain no source; explicit get source is quoted untrusted
  JSON. Protocol schema failures are also rejected by the SDK before dispatch.
- JSON routes: internal POST, thread canvas events/list, canvas metadata/DELETE,
  version list and human restore. Dynamic params are awaited. Auth precedes query
  diagnostics; all controlled success/error responses are private/no-store with
  nosniff and no-referrer, no CORS or auth redirects.

## Coordinator wiring

Do **not** pass the existing MCP `internalCall` unchanged: it adds ordinary
`principalPayload` fields, which this strict internal route deliberately refuses.
Construct `createCanvasCall({transportKind,env,httpActive,internalCall})` once at
actual MCP server construction. `internalCall(path, body)` here means a dedicated
secret-authenticated JSON forwarder to the constant internal Canvas path, without
ordinary claimed principal/header fields. `httpActive` must inspect HTTP ALS,
including the misconstructed-stdio case. Use the actual bootstrap transport.
Then `registerCanvasTools(server,{json,canvasCall})` once. This slice intentionally
leaves `mcp/sjcos-mcp.mjs` untouched for coordinator ownership.

The closed adapter captures the five runner tags once and rejects HTTP/bare
stdio before any forwarding. It first makes a private **`admit`** call with input
`{conversation_id:<captured thread>}` and the §5.2 context, then forwards the tool
with that same closed context. This internal-only admission action returns only
`{ok:true}`; it is not an MCP tool. It compares the fifth captured tag with the
DB-derived thread without granting the narrow MCP login private SQL access.
The website reloads and repeats run/person/start/profile/launch/ownership/revocation
checks on every actual command. `with_mcp=false`, non-Claude, terminal/canceled,
foreign-thread and revoked runs are refused. Existing runner config already
forces `MCP_HTTP_PORT=0` for both sjcos and interact.

`canvasGet`, `canvasList`, `canvasVersions`, `canvasRestore`, `canvasDelete` and
`canvasEvents` are the human/shared read/write exports. The UI-owned source route
uses `canvasGet(id,{version,include_source:true})`; no direct SQL is needed.
`canvasEvents(threadId,input)` is the canonical EventPage command for later poll,
conversation-history and native adapters. Effective Page/Floor/exports stay false
until those implementations land; renderer/source flags do not enable them.

## Required supporting Phase 0 extensions

The assigned retention requirement needed small edits outside the new core files:

- `lib/canvas-deletion-ledger.mjs` now validates/hashes canvas intents alongside
  thread intents, with identical grace and durability requirements.
- `lib/ask-thread-journal.mjs` reuses the existing OS lock, independent authority,
  lease/fencing token and recovery checkpoint for canvas deletion/replay/purge.
  Canvas deletes get an atomic request/event tombstone; thread tombstones propagate
  through the 0106 trigger. Incompatible schema replay stays closed. Canvas payload
  purge is batched at 40 versions with one canvas batch per invocation; retained
  hashes/identity remain, holds stop purge, and removed bytes are subtracted once.
  Reconciliation freezes positive content writes and resumes from the existing
  maintenance row over 40-version batches; fixed repair/limit work items contain
  no private content. File capability now corresponds to reserved migration 0108,
  not the old plan's 0107.
- Private-query scanner table registry includes ask_canvases and all ask_canvas_*
  carriers. Its explicit reviewed source/query hashes include core commands,
  journal, transport, migration/schema and the existing opaque owner-health route.
  Final inventory: **494 entries, 965 fragments, 216 files, zero violations**.

The base `db/schema.sql` follows the repo's existing pre-ledger convention:
0106 DDL remains in the checksummed migration, with an explicit schema pointer.
It is not duplicated into the base and then executed a second time by the harness.

## Grants and validation

The exact generator command was:

```sh
node scripts/db-roles-sql.mjs ask_canvases ask_canvas_versions ask_canvas_requests ask_canvas_events ask_canvas_usage ask_canvas_rate_windows ask_canvas_maintenance
```

Its output was empty (one newline): **No narrow grants generated; access is through
the app adapter.** This is also pasted as the generator/no-grant note in 0106.
The manifest lists each new table explicitly with its website-only explanation.
Actual session identities sjcos_agent/sjcos_worker/sjcos_readonly all fail raw reads.

Every file ran separately with `SJC_TEST_CLUSTER_TAG=c1core-<timestamp>` and an EXIT
trap stopping the disposable cluster on success/failure. No live DB, protected
coordinator QA state, install, browser, Next process, deploy, service action, or
subagent was used. No exit 137/resource kill occurred.

| Test file | Passed | Failed / skipped |
|---|---:|---:|
| canvas-commands-db.test.mjs | 21 | 0 / 0 |
| canvas-mcp.test.mjs | 40 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |
| canvas-rollout-db.test.mjs | 5 | 0 / 0 |
| ask-private-query-scan.test.mjs | 7 | 0 / 0 |
| ask-thread-recovery-db.test.mjs | 43 | 0 / 0 |
| db-roles-manifest-db.test.mjs | 6 | 0 / 0 |
| db-roles-paths-db.test.mjs | 3 | 0 / 0 |

Includes 24 fresh strict-input counterexamples plus transport attacks; 10 concurrent
same-key requests on dedicated website-session connections; competing CAS; replay
after later versions; null-run restore/rate rollback; source-free durable events
and stopped/no-reply runs; >20-event forward/backward/byte-bounded drains; forged,
wrong-direction/thread/person cursors; old selected source; microsecond list
boundaries; active flag changes with no events; streamed body/auth/Origin JSON
route cases; actual narrow-role denial; unknown staff provenance; journal-backed
canvas delete/retry/grace/hold/purge/repair/authority-loss/local-volume recovery.

Initial fixture failures exposed staff-off-before-object-check behavior, omitted
with_mcp=true admission, a UUID/text test cast and the existing work_items shape;
fixtures were corrected without relaxing those boundaries. A polymorphic deferred
trigger field lookup was corrected after the real DB caught it.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
`node scripts/db-roles-scan.mjs --diff`: **exit 0**. Printed differences are intentional:
owner settings/authority/lane/policy/user/revocation/audit writes; website-only
private retention/session code, including Canvas imported into worker's static
trace; payment authorizations, QBO and mailbox credentials. No grant was widened
because an imported maintenance helper appeared reachable to the static scanner.
`git diff --check`: passed.

## Not done / integration and release limits

- Coordinator MCP registration and dedicated authenticated forwarder wiring.
- 0107 real provenance, native-reader removal, synchronous context tracking and
  ask_owner gates. The stub is unchanged; staff content writes remain fail-closed.
- 0108 renders/derivatives, project-file saves/exports/audience/declassification;
  its builder must extend retained-byte accounting and the same maintenance lease.
- 0109 floor references and real design snapshots. Page rendering is later too.
- Existing run PollResult/conversation/mobile/native fallback wiring and runner
  terminal rejection events are outside the assigned backend paths. The canonical
  event endpoint/command is ready; UI-owned feed/card integration is separate.
- UI/renderer/wrapper/download work and tests are owned by the parallel builder;
  none were edited or staged here. These checks do not certify CSP in Safari.
- Future derivative-vs-content races, actual near-1-GiB cross-owner exhaustion,
  saved-file recovery/trash, and provenance-complete staff positives belong to the
  later table/implementation slices; they are not claimed by these tests.
- No deployed authority/backup-aging/ops provisioning, visual acceptance, deploy,
  merge or PR was performed. Owner pilot/staff release still need the full plan's
  prerequisite and coordinator acceptance matrix.


## Round-1 server corrections (2026-11-05)

Engineering R4/R6/R7 and security R2: every runtime pg import now routes through
`lib/guarded-pg.mjs`. Construction, connect and query check the explicit test URL
against the harness state file, live socket, postmaster port/socket identity and
owned disposable directory. Empty databases, PG fallback, TCP/duplicate/query
redirects and configuration overrides fail before constructing pg. Test tags
retain the interlock in detached children. Environment/file URL builders select
the guarded test URL first; production resolution is unchanged.

0106 and 0107 were edited in place with authorization: **unapplied on live**.
0108 was not changed. No live/QA DB was read, migrated or repaired. The new
`ask_canvas_attempts` table is website-only in the role manifest. Exact command
`node scripts/db-roles-sql.mjs ask_canvas_attempts` prints one newline (no narrow
grants), pasted into 0106. Both new trigger functions are SECURITY DEFINER with
fixed search_path and revoked PUBLIC execution.

Failed admitted mutations retain only the latest fixed reason, under renewed
run/person/thread authorization. Successful content writes clear it. The trusted
website terminal-run command appends one deduplicated, source-free rejected event
and fixed text fallback, even with no assistant output or a recovered failed run.
A statement trigger takes global serialization before run-row locks; the row
trigger then takes the thread before allocating an event ID. Runner instructions
require plain-text explanations on refusal. Mobile/history recover the durable
event independently of assistant persistence.

Flags-off Phase 0 uses trusted schema capability to select ordinary runner/tool/
question paths. Once 0107 is recorded, a missing table/errors refuse delivery;
there is no error-based downgrade. File readers use equivalent row-JSON profile
exclusions so absence of the 0108 column does not break ordinary files. Canvas
file policy/list/trash helpers explicitly recognize the pre-0108 schema.

Exhaustive guarded pg import paths (72; the constructor census rejects raw pg
runtime imports anywhere under lib/mcp/scripts/db, including dynamic imports):

```text
db/apply-agent-memory.mjs
db/apply-bid-follow-ups.mjs
db/apply-bidding.mjs
db/apply-chat-room-lifecycle.mjs
db/apply-client-activity.mjs
db/apply-client-portal-invites.mjs
db/apply-comms-sms-voice.mjs
db/apply-detectors.mjs
db/apply-estimate-kinds.mjs
db/apply-estimate-pdf-link.mjs
db/apply-floor-designer.mjs
db/apply-in-person-signing.mjs
db/apply-lead-first-response.mjs
db/apply-lead-nurture.mjs
db/apply-lead-portal-publish.mjs
db/apply-live-changes.mjs
db/apply-mood-crop.mjs
db/apply-mood-editor.mjs
db/apply-multi-assignees.mjs
db/apply-newsletter-p7n.mjs
db/apply-notifications-v2.mjs
db/apply-orchestration-p1.mjs
db/apply-orchestration-p2.mjs
db/apply-orchestration-p3.mjs
db/apply-orchestration-p4.mjs
db/apply-orchestration-p5.mjs
db/apply-owner-grants.mjs
db/apply-portal-approvals.mjs
db/apply-portal-link-window.mjs
db/apply-project-financials.mjs
db/apply-push-outbox.mjs
db/apply-run-steers.mjs
db/apply-runbook-instances.mjs
db/apply-scheduled-snooze.mjs
db/apply-selection-budget.mjs
db/apply-selection-options.mjs
db/apply-staff-separation.mjs
db/apply-staff-users.mjs
db/apply-thread-folders.mjs
db/apply-unsorted-docs.mjs
db/apply-work-item-archive.mjs
db/migrate.mjs
db/seed-portal-demo.mjs
db/seed-workflow-runbooks.mjs
lib/db.ts
mcp/interact-mcp.mjs
mcp/sjcos-mcp.mjs
scripts/backup.mjs
scripts/db-roles-apply.mjs
scripts/enqueue-trigger.mjs
scripts/houzz-export-inventory.mjs
scripts/import-brain-archives.mjs
scripts/import-review.mjs
scripts/import-subs-audit.mjs
scripts/import-subs-csv.mjs
scripts/import-temp-leads.mjs
scripts/import-undo.mjs
scripts/invoice-collision-report.mjs
scripts/migrate-cents.mjs
scripts/newsletter-write-test.mjs
scripts/propose-financials-skill.mjs
scripts/qa-seed-canvas.mjs
scripts/record-capability-evidence.mjs
scripts/refresh-capabilities.mjs
scripts/report-work-item-collisions.mjs
scripts/restore.mjs
scripts/run-business-agent.mjs
scripts/run-claude-agent.mjs
scripts/run-evals.mjs
scripts/seed-egan-financials.mjs
scripts/sjcos-worker.mjs
scripts/upsert-inbox-work-items.mjs
```
