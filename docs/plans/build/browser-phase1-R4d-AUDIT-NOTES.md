# Browser Phase 1 R4d private-query audit

Reviewed branch `t3/browser-phase1` at `be74231f`, including the query callers and guards. This change updates only the private-query allowlist and these notes. No fence fix was necessary; `lib/browser/web.ts` and the QA scripts remain unchanged.

## Flagged queries

| Query | Verdict | Caller and fence |
| --- | --- | --- |
| `lib/browser/web.ts:131`, `currentLoading`: `SELECT * FROM browser_viewers ...` | Fenced | Exact viewer ID, authorized task ID, caller web-session ID and person ID, with `left_at IS NULL`; attendance and stream ID/generation are checked before returning a boolean. |
| `scripts/qa-browser-fake-controller.mjs:99`, `createQaWebsiteHooks` projection: `SELECT 1 FROM browser_owner_views ...` | Fenced (QA-only) | Uses the website-authorized task, requires its scenario entry, and limits the query to that task's unrevoked, unexpired owner views. Returns only an existence boolean. The query deliberately does not filter to the viewer's own claim: it answers whether an owner is watching this task. |

### Website query and enclosing guard

`currentLoading` is private to `createWebsiteAdapter` and called only from `detail`. The route transport invokes `authorize` before `execute`; callers cannot supply an arbitrary context in route JSON. Authorization validates the uncached cookie session, active owner/staff person and required areas. `records` verifies the task's project/lead and that its conversation remains non-deleted and owned by its initiator. A staff caller cannot inspect another initiator's task. An owner inspecting another initiator needs a live claim bound to that task, owner, sid and original run (join creates the claim separately).

A supplied viewer first passes `loadViewer`: exact viewer/task/sid/person, device-secret hash and attendance. `detail` receives the authorized task from status or the same task reloaded after guarded start/control operations; join passes no viewer, so loading short-circuits. The `loadTask(task.id)` inside `currentLoading` is thus a reload of an already-authorized ID, not a new task lookup selected by the controller or client. No extra initiator predicate should be added there that would silently exclude authorized owner review.

Loading is unavailable for private/non-public/inactive tasks or missing controller/stream. Before RPC, `proof` rechecks the session and areas, locks the task, and inserts a task/session/viewer-bound short-lived presence proof. The signed response must match task/run/boot/context/document/control; after RPC, the task reload must still match and be public. The flagged viewer reread additionally binds the current person and session in SQL, and rejects departed, absent or replaced streams. Only the loading boolean enters the response; no viewer row, private transcript, confirmed answer or task text is serialized by this helper. Existing R4c route tests cover public/private and stale task/stream responses; this audit changes no runtime behavior and requires no new regression test.

### QA query and enclosing guard

The ordinary production `lib/browser/runtime-endpoints.ts` uses the protected installation adapter. QA hooks enter through the separately copied `qa/browser/runtime-endpoints.ts` overlay, which checks the actual website LOGIN identity (`sjcos`, non-superuser), explicit side-build configuration, private fixture path and matching keys. `createQaWebsiteHooks` validates `readScenario` at construction and at each relevant hook invocation: explicit QA environment, connected `sjcos_qa_*` database on a non-5432 port, private regular files, and pinned database OID/port/postmaster start time.

Projection additionally refuses a task absent from `scenario.tasks`. Its task/session/viewer are installation callbacks from the authenticated website adapter, not route fields. The new owner-view query is bounded to this task and selects a constant, exposing neither owner-view records nor another person's conversation. The adjacent private-view predicate joins the supplied viewer to its task and runs only for an owner-review viewer with consent and the local audit-release control file. Its task binding is inherited from the authenticated callback; that SQL alone is not a general person authorization API. The hook's other SQL remains task-bound: private-watch resolves the supplied task/viewer and checks sid and owner-review role; start locks that task and requires its latest approved, unexpired, unused next-document manifest before attaching a run. Classification checks fixed QA person/thread membership. Local checkpoint signatures and inert process bindings remain QA evidence only.

## Source-hash review

All SQL and enclosing guards in the three pinned sources were inspected, not just the two added hashes.

- `lib/browser/web.ts`: reviewed `authorize`/`ownThread`/`records`/`loadViewer`, task and manifest/review helpers, presence proofs, task-list/create/start/control paths, owner-only settings/in-use metadata, and per-frame authorization. Task list binds conversation and initiator; owner review of another task requires the explicit claim. The new loading path preserves those guards. The adapter intentionally reads the task internally before checking its initiator and never returns that row on authorization failure.
- `scripts/qa-browser-fake-controller.mjs`: reviewed hooks above plus explicit-client proof/run/audit helpers and fake protocol. `taskFor` checks scenario membership and boot/run; RPC proof consumption checks task/viewer/expiry/state; frame opening checks signature, expiry, nonce, opened stream, task/viewer/session attendance and private consent. These helpers are trusted fixture tooling, not standalone person-scoped public APIs. No import-time connection or ambient production DSN exists.
- `scripts/qa-seed-browser.mjs`: no new SQL hashes. Reviewed explicit bootstrap through `prepareQaLogins` (QA database/port/data directory/private cluster pin), advisory seed lock and fixed QA principals. Conversation/message inserts use deterministic fixture threads and fixed fixture text. Task retirement locks the task and checks scenario entry, QA person, deterministic thread and project before changing viewers/claims/control or completing runs. Other task/manifest/command/viewer writes use IDs produced by guarded admission/join/run creation; expired deadlines affect only the two selected fixture tasks. Fixture settings/readiness changes are explicitly isolated bootstrap operations. Recipe/resource-count/deadline/fixture-revision/control-file changes, including enabling navigation for `earlier_view`, do not broaden the data audience. This is a trusted QA bootstrap, not independent per-person SQL authorization; it may inspect its fixed QA person's live task to decide whether retirement is permitted.

Refreshed full-source SHA-256 values:

| Source | SHA-256 |
| --- | --- |
| `lib/browser/web.ts` | `12984f29b582089ef4d5e8a4db78f8e3750603aa5891842de8487ea78c9f5627` |
| `scripts/qa-browser-fake-controller.mjs` | `adafb7739aeaaece93c52416d6f8a15844abdef631ca9ad9e657844b08e37fef` |
| `scripts/qa-seed-browser.mjs` | `0e9b86231f1b96fdbc9c5d491ca85e261cd245cf0d10680a42a296ff06eff385` |

## Validation

`SJC_TEST_CLUSTER_TAG=browser-p1-r4d-9f12a6 node --test tests/ask-private-query-scan.test.mjs`: **11 passed, 0 failed, 0 skipped**. This scanner uses source files only; no harness cluster was started, so none required stopping. Browser-route tests and TypeScript compilation were not run because no TypeScript/runtime code changed. No QA/live DB, service, server, browser, build, install or push was used.
