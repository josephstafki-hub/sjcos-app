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
