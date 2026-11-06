# Canvas Phase 1 run-poll / mobile integration

Implementation sub-agent, 2026-11-05, branch `t3/in-app-browser-agent-tools`, starting HEAD `80e86aa4`. No subagents. No install or modification of the live node_modules symlink. No database, QA database, service, server, browser, build, deploy or resource kill.

## Item → change

- `components/panel/canvas/run-actions.ts`: server adapters `pollAgentRunWithCanvas`, `loadConversationWithCanvas`, and `canvasRunPage`. Preserve existing Ask envelopes, extend live/done/error results and conversation loads with optional `canvas_changes: EventPage`. Use authorized `getDevAgentRun` to resolve the run's thread and canonical `canvasEvents` for every page; no duplicate Canvas SQL, event reconstruction, or source read. Each call requests at most 20 events and inherits canonical byte limits/cursor authorization. Empty event pages retain effective availability. Master env off leaves original envelopes intact and never reads Canvas commands. Server dependencies are lazy so disabled Canvas does not pull server-only modules into SSR fixtures.
- **Ownership seam:** the actual existing `PollResult` is in `lib/actions/dev-agents.ts`, not `lib/dev-agents.ts`. Conversation actions live in the parallel builder's `lib/actions/ai-chat.ts`. Neither was edited. The assigned panel glue supplies typed adapter results to the panel and mobile; other consumers of the raw original actions retain their existing contract. No parallel-builder files were edited or staged.
- `useAgentChat` / `run-events.ts`: canonical pages travel with run polling and initial conversation load. Retain opaque forward cursor in the live poll loop; after done/error, drain forward to `has_more=false` before settling/following a successor. Newest-page backward `has_more` is never mistaken for forward history. Reject a non-advancing continuation; test the existing live claim after each await. Accumulate event IDs in memory across batched React updates so fast terminal pages cannot overwrite earlier commits. Claim changes clear accumulated pages.
- `PanelChat` / `useCanvasFeed`: feed poll/history changes to existing Canvas event store; reject foreign-thread pages and hidden/blocked scopes, consume each delivered page once, merge by event ID, and invoke the established feed refresh/list path. Availability revision changes immediately remove cached views/items/private snapshots and redact cards while the canonical feed reauthorizes. Existing CanvasCard, CanvasPane, grouping, backward history, focus, source fetching, idle/focus/visibility cadence and rendering behavior remain unchanged. No private payload was added to storage or panel bus.
- `lib/mobile-rpc/operator-reads.ts` / `canvas-fallback.ts`: optional canonical pages plus `canvas_fallback` entries on REST and production RPC polling/conversation responses. Each entry has group/run/canvas/version identity, server time, exact plain fallback line, and `{label:'Open in Safari',href:'/panel/canvas/<id>?v=<n>'}`. No bearer token/source/summary/actor is included in the fallback. Group by run/canvas, select highest version within that run, suppress deleted/unavailable/rejected metadata and master-off titles. Append once to returned assistant/error bodies, never saved shared transcript; missing replies get timestamped synthetic returned assistant rows. Native new clients can suppress these lines when displaying cards. Fallback generation is bounded to the accompanying canonical event page; older history is available through its backward cursor.
- `operator.canvasEvents` RPC and `GET /api/mobile/operator/conversations/[id]/canvas-events`: same authorized canonical command, opaque after/before/limit contract; REST additionally validates duplicate query fields and returns canonical fixed errors/private-no-store headers. REST run polling and RPC polling accept optional `after`. Original clients may omit it.

## Expectations / verification

Tests were written first; the initial integration invocation failed on the missing implementation modules. Subsequent failures caught explicit event-kind filtering for stale redacted metadata. Existing mobile fixture caught an off-path regression, corrected by preserving the original conversation action when off. SSR caught eager server imports, corrected by retaining the original disabled panel call path and lazy enabled dependencies. No unrelated test fixtures were edited.

Every file below ran separately, sequentially, using `node --test <file>`:

| File | Pass | Fail / skip |
|---|---:|---:|
| tests/canvas-integration.test.mjs | 33 | 0 / 0 |
| tests/canvas-ui.test.mjs | 24 | 0 / 0 |
| tests/canvas-routes.test.mjs | 16 | 0 / 0 |
| tests/mobile-rpc.test.mjs | 28 | 0 / 0 |
| tests/ask-panel-ssr.test.mjs | 93 | 0 / 0 |
| tests/panel-content-pane.test.mjs | 37 | 0 / 0 |

Integration coverage includes 33 fresh expectations: real adapter invocation with mocked authorized command/action seams; pending/running/done/error envelopes; off/no Canvas reads; opaque cursor forwarding; auth/read failure; reload without assistant; metadata-only availability; duplicate live/final/error grouping; orphan crash cards; 47 events over four pages including a four-row byte-truncated-page simulation; terminal drain; backward/newest direction; cancellation after await; stuck cursor refusal; native exact line/Safari target/dedupe/run separation/human restore/redaction/no reply/no mutation/no private extras. These tests do not replace the core's real DB cursor/byte-bound/permission tests.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0** (including final shared-worktree state at validation time).
`git diff --check`: **exit 0**.

## Not done / coordinator acceptance

- No changes to the mobile repository. Old clients display the plain fallback text through existing reply/error rendering. A visible native card/menu button must be implemented there later using the supplied Open in Safari action and existing authenticated web login; server payload alone cannot render a new native button. Read-only review confirmed the mobile app consumes operator poll answer/error and conversation message bodies and uses Linking for web navigation.
- Native old clients do not drain optional event cursors; their fallback text covers the bounded newest page. New clients/history consumers must paginate `operator.canvasEvents` for earlier groups. No unbounded terminal response or server-side full-history scan was introduced.
- No runner rejection-event creation, provenance/MCP wiring, migrations/grants, derivatives/Save/export/print, or raw action-contract changes outside the assigned panel/mobile adapters.
- No DB-backed integration test was needed for these adapters; canonical DB authorization, cursor signing, byte limits, atomic commit-before-crash, migration and provenance acceptance remain the respective builders' tests.
- No browser/native/device or deployed acceptance. Coordinator must verify real active→done/error card arrival, reload/crash/no-reply orphan, backward history, terminal >20-event drains, availability kills while active/idle, hidden/reopen/thread switch, zero private storage/bus payloads, and old iPhone reply fallback + web login. No server/browser was started under the shared-host rules.


## Round-1 server validation (2026-11-05)

Engineering R3–R7 and security R1/R2 are addressed by the server-owned changes.
Renderer/geometry and Save-dialog picker work belongs to the parallel builder;
none of its source or tests was edited or staged by this implementation.

- Classification: get_project carries Leads/Subs; actual handler→provenance→Save
  rejects readers missing either area. Broad returned SQL fields are re-scanned
  for every narrow registration; historical input policy is corrected on read,
  and old affected saved snapshots are withheld from staff until regenerated.
- Test DB interlock: the 72 runtime pg import paths are enumerated in the core
  handoff, including workers/runners/imports/backup/restore/migrations. Shared
  construction/connect/query checks use the real harness socket/state identity;
  no empty-db/PG environment/runtime URL/default/query redirect is permitted.
  Fake-pg tests see zero construction or connection attempts on negative paths.
- Staff continuation: real fake-CLI runner performs two verified staff turns;
  exact message/control envelopes, update and Save are positive. Missing old
  delivery, extra prompt facts, foreign version/title, pending and tracking
  failures remain closed. Business tracked turns use a fresh verified CLI epoch.
- Durable refusals: real failed MCP command → runner terminal → source-free
  event/text fallback → history/mobile; successful retry clears pending refusal.
  Terminal retries deduplicate, no-assistant and canceled-run recovery preserve
  fallback, with global/thread event serialization before event allocation.
- Phase 0: actual 0100+0105-only runner/tool/question plus ordinary file listing
  pass flags-off, then exact additive 0106–0108 upgrade. Missing recorded tracking
  or a capability downgrade fails closed. No Browser migrations are fabricated.
- Recovery fixture uses the shared tracked/legacy selection and typed validated
  formatted answers; mobile file fixture injects the resolver/snapshot seam and
  checks ordinary, denied and Canvas cases. Private-query audit updates cover
  only reviewed changed guards/queries and the explicit QA-only seeder.

All files ran individually and sequentially, with unique
`SJC_TEST_CLUSTER_TAG=c1r1srv-<timestamp>` and EXIT cleanup stopping the cluster
after success/failure. Real website/agent/worker/readonly session identities were
used. No install (node_modules is the live symlink), subagent, browser, Next
command, deploy, service change, live/QA DB connection or exit 137 occurred.

| Test file (tests/) | Pass | Fail / skip |
|---|---:|---:|
| test-db-guard.test.mjs | 23 | 0 / 0 |
| canvas-classification.test.mjs | 8 | 0 / 0 |
| canvas-provenance-db.test.mjs | 5 | 0 / 0 |
| canvas-rollout-db.test.mjs | 6 | 0 / 0 |
| canvas-commands-db.test.mjs | 21 | 0 / 0 |
| canvas-input-gates-db.test.mjs | 25 | 0 / 0 |
| canvas-exports-db.test.mjs | 2 | 0 / 0 |
| canvas-mcp.test.mjs | 40 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |
| canvas-retention-db.test.mjs | 1 | 0 / 0 |
| canvas-integration.test.mjs | 33 | 0 / 0 |
| agent-profile.test.mjs | 13 | 0 / 0 |
| ask-thread-recovery-db.test.mjs | 43 | 0 / 0 |
| mobile-rpc.test.mjs | 28 | 0 / 0 |
| db-roles-manifest-db.test.mjs | 6 | 0 / 0 |
| db-roles-paths-db.test.mjs | 3 | 0 / 0 |
| browser-run-profile.test.mjs | 14 | 0 / 0 |
| ask-private-query-scan.test.mjs | 9 | 0 / 0 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0.
`node scripts/db-roles-scan.mjs --diff`: exit 0. Reported differences are existing
intentional withholds for owner controls/credentials/private Ask tables reached
by static imports; no new narrow grant was added. The new attempt table is
website-only; its grant generator produces one newline (no grants).
Private-query census: 524 reviewed groups, 1047 fragments, 226 source files,
zero violations. `git diff --check` passed. 0106/0107 changed in place, authorized
because unapplied on live; 0108 unchanged. No actual data migration was run.

Coordinator still owns visual/browser/served-byte/CSP acceptance and deployment.
This server handoff does not claim renderer or Save-dialog visual acceptance.
