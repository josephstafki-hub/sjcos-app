SCORES: design=9 completeness=9

Engineering judge, build round 3, `t3/canvas-phase2-3` at `122e850a`, base `c922976b`. Reviewed the round 2 delta, prior engineering/security/design findings, both “Round 2 fixes” handoffs, relevant installed Next documentation, integrated action/Canvas/UI paths, migration guards and the coordinator's supplied QA summaries. No source edits, commit, dependency installation, Next build/start/dev, browser, live/QA database connection or service operation. Only this review file was authored. The other concurrently written review files were left untouched.

## Round 2 fixes verified

1. **Historical publish authorization: verified.** `lib/actions/plan-publish.ts:78–109` now resolves the automatic/current/selected version under the design lock and `assertFloorAccess`, before project/lead details, captures, PDF render, storage, design-file attachment or publication. Selected snapshots bind both snapshot ID and authorized design ID. Both publication and render-only use that resolver. Actual-action SQL repros refuse Projects-only staff on lead history/current, revoked Projects, inactive staff and foreign snapshots with zero output effects. Owner and authorized staff controls pass for projects, leads and full-designer templates.
2. **Estimate authorization and rollback: verified.** `lib/actions/plan-estimate.ts:101–121` locks and authorizes the source before draft insertion or existing-target diagnostics. Draft creation, snapshot, pin/revision records, generated line deletion/replacement and totals use the same transaction/client. The original denied-source/new-draft and post-snapshot-INSERT failure repros now return structured failures without persisted drafts, snapshots, lines or revisions. Fresh failures after the real revision INSERT, totals UPDATE and regeneration DELETE also restore all pre-request state. Existing approved/missing-target diagnostics remain behind source authorization.
3. **Duplicate Delete/stale completion fence: verified.** `components/panel/CanvasPane.tsx:32–57` installs the per-canvas flight synchronously and retains its operation ID through genuine retries. Triple retained confirms produce one DELETE; duplicate retries produce one retry with the same request ID. Completed callbacks cannot reopen the operation or overwrite success. Success/rejection after a store-scope change cannot mutate the new scope. Completion preserves newly received unrelated items/events and redacts all matching cards. The original late-rejection/stranded-retry repro no longer occurs. Actual server deletion/journal idempotency and retention tests also pass.

## REQUIRED fixes

1. **P2 — Distinguish an existing newer Canvas floor version from a new designer change.** `components/panel/canvas/floor/FloorCanvasPane.tsx:40–43`, with the no-op notice at `:29`. This corroborates the design judge's finding with an independent executed component failure and real Canvas commands/SQL. With distinct floor pins v1 and v2, the live drawing matching v2, and v1 selected: `selected.floor.changed=true`, `latest.floor.changed=false`, and the meta slot renders **“The floor plan changed. Load latest”** with no **Latest** navigation. Calling the advertised floor-latest action returns `{changed:false, selected.version:2}`, creates no new version, and triggers **“This floor plan is already current.”** The server correctly distinguishes immutable pins; the UI conflates historical selection with an uncaptured drawing change.

   **Exact change:** compute whether the selected **Canvas version** is older than the newest known Canvas head. Use the maximum of `data.canvas.latest_version` and the matching current store item's head, so a stale list entry cannot override a newer polled response (and vice versa). When older, show the existing-newer-version notice and a **Latest** button that calls `selectCanvasVersion` on that head; do not POST `floor-latest`. Use the head's design number when known, otherwise generic newer-version wording. Suppress the designer-changed notice and change-note fallback while older. Show **The floor plan changed. Load latest** only on the latest Canvas version when its pin differs from the live designer. Add executed tests for historical/current pins with identical and different geometry, plus a head advance while history is open; Latest must navigate without mutation, and a real new drawing change must still allocate a pin through Load latest. Do not change snapshot comparison/hash behavior to hide this UI issue.

## Current design_name permission judgment

**No additional gate is required at `lib/ask-canvases.ts:139` for the demonstrated revocation scenario.** The serializer is reached after the current-person transaction and `load` (`:133–135`), which fences the owned live Canvas/thread, required areas, Projects and scoped Leads, including floor-specific access. Get additionally calls `readFloorCanvas`; list/history/events load before returning metadata, and events redact denied metadata. Mutation/replay either load the same authorized Canvas or prepare an authorized locked design. `0114_canvas_floor_refs.sql:64–73` prevents retained designs from changing project/lead/template scope behind those checks.

Fresh real-session API probes created project and lead floor Canvases while authorized, verified repeated current-name renames on historical and latest get/list/history/events, then changed their owning principal to active staff with full relevant permissions. Authorized staff still read both names. After separately removing Projects and Leads and renaming the corresponding design **after revocation**, get/list/history refused with `CANVAS_UNAVAILABLE` and events contained no version/name metadata. Canvas ownership alone did not retain access. This tests both revocations, not just an inactive-user or staff-feature-off refusal. Current-name freshness across show/replay/restore also remains covered by the existing test.

## Executed verification

**Every touched executable test file ran individually**, as did the related harness/fixture consumers and role checks: **28 files, 567 existing tests pass** at this HEAD. No full-suite command was used.

| File (`tests/*.test.mjs`) | Pass | File | Pass |
| --- | ---: | --- | ---: |
| canvas-content | 58 | canvas-page-sandbox | 22 |
| canvas-routes | 22 | canvas-mcp | 40 |
| canvas-ui | 60 | canvas-commands-db | 22 |
| canvas-renderer | 7 | canvas-render-bridge | 29 |
| canvas-rollout-db | 9 | canvas-save-dialog | 30 |
| canvas-exports-db | 3 | canvas-floor-db | 18 |
| canvas-floor-adapter | 30 | canvas-classification | 8 |
| canvas-input-gates-db | 25 | canvas-integration | 33 |
| canvas-poll-history | 20 | canvas-project-search-db | 1 |
| canvas-provenance-db | 5 | canvas-retention-db | 1 |
| mcp-floor-tools | 12 | plan-ops | 8 |
| agent-profile | 14 | floor-actions-db | 53 |
| floor-ui | 17 | ask-private-query-scan | 11 |
| db-roles-manifest-db | 6 | db-roles-paths-db | 3 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **0**. `node scripts/db-roles-scan.mjs --diff` exited **0**. Its unannotated agent UPDATE entries remain the known `ai_conversations`, `dev_agent_runs`, `run_steers`, and `leads` (the JOIN/`FOR UPDATE OF d` scan over-report). No new grant, table or migration is needed for these changes; no narrow-role access to private floor references was introduced. Runtime manifest/path/role tests pass.

SQL/TS parity remains consistent: the sole production snapshot INSERT is `lib/plan-version-writes.ts:30`, used by web publish/estimate/save/restore, MCP and Canvas allocation. It locks the same design as the SQL insert/reference guards. PostgreSQL jsonb hashing drives backfill, insert validation and TS lookup with equality checks; allocation, same-design composite identity, immutable geometry/number/hash, retained scope, deferred reference-only payload and deletion retention guards agree with TS behavior. The exact subset migration ledger through 0114 replays without Browser dependencies; missing dependencies roll back atomically. Pages/diagrams continue to commit non-JSON source under the floor migration.

**All 20 planned fresh cases pass**, executed from stdin with in-memory loader additions, without saving test/source changes: action file **63/63** (53 existing + 10 fresh); UI **66/66** (60 + 6); command/API **25/25** (22 + 3); floor UI **18/18** (17 + 1). Cases 1–10 exercise real exported actions and SQL; case 1 was also rerun with an actual same-design capture attachment and remains effect-free on denial (63/63 action-file tests). Cases 11–14 and 17–19 execute real component/bridge source with controlled React/DOM/network seams. Case 18 also executes the real page bridge timeout and retained late-ready callback. Cases 15/16 use real session/API reads and SQL; case 20 races two actual database sessions and proves exactly one restore CAS winner and one `VERSION_CONFLICT`, preserving the winning head. Canvas version numbers and designer snapshot numbers are deliberately distinct in case 19.

The supplemental expectation below was recorded after consulting the concurrent design review and before the supplemental runs. Its real-DB observations pass, while its expected **Latest** component control assertion fails on the current code, establishing required fix 1. The supplemental floor DB file otherwise passes **18/18**; floor UI is **17 existing pass + 1 supplemental failure**. This is separate from the 20 planned cases and the all-green existing suite.

Owner and authorized staff full-designer project/lead/template save, restore, current/selected publication, current/selected render-only, estimate generation/regeneration/pricing, and unreferenced snapshot/design deletion all pass through actual action source and SQL. Referenced/publication-held targets remain blocked appropriately. Template save/restore/publish/estimate still work in the full designer while Canvas template pins remain unavailable. PDF bytes/storage and framework/authentication are controlled action seams; no physical PDF or actual client send was produced.

Initial broader-run setup: a globally pinned outer `SJC_TEST_DATABASE_URL` overrode the tests' explicit subset/worker/MCP URLs and caused three unrelated fixture failures. Removing that override and supplying explicit per-file harness URLs lets each test's explicit per-case URL take effect; rollout/provenance/role paths then pass unchanged. The commands file also had one transient rate-window assertion failure and cascading state failures; two subsequent unchanged runs pass. Minute rollover is plausible, not independently proven. Probe-only loader syntax/CommonJS initialization errors were corrected before the counted fresh runs. No product code or test assertion was relaxed to obtain the passing results.

Disposable harness cluster tags: `c23-eng-r3-1106-931`, `c23-eng-r3-rerun-931`, `c23-eng-r3-probes-931`, `c23-eng-r3-probes-932`, `c23-eng-r3-names-931`, `c23-eng-r3-meta-931`, `c23-eng-r3-capture-931`. All started clusters were stopped using `stopCluster()` (**true**); no tagged cluster state remains. All DB connections used harness-minted socket URLs; no connection default, live cluster, QA port 5499 or protected service was used. No exit 137/resource kill occurred.

## Optional / coordinator follow-up

- Keep permanent regressions for both current-name revocations and the additional failure boundaries exercised here. Make the rate-window fixture deterministic across minute rollover if that transient failure recurs.
- Publication still commits an immutable snapshot before PDF rendering, and stores/attaches/publishes metadata in later steps. Render/storage refusal is effect-free beyond that snapshot in the fresh tests. Compensation for attachment/publication failures after storage remains existing lifecycle hardening, not part of the newly atomic estimate guarantee.
- The supplied `summary.txt` has an initial floor-not-opened run; `summary-floor.txt` corrects it with successful floor opens, no leaks/external requests/overflow, latest menus without restore, floor links, Load latest and selected-history coverage. The user additionally reports completed confirmation/restore QA. These are coordinator evidence, not a browser run by this reviewer. Keep the existing Safari/iOS printing, focus/Escape, WebGL disposal and unsaved full-designer-return acceptance checks; no visual release/deploy/flag change is claimed here.

## Fresh adversarial expectations (recorded before execution)

1. Denied selected-history publish cannot load capture bytes, render, store, or file output even with a valid capture id.
2. Denied render-only history is equally effect-free; a foreign snapshot is unavailable for an authorized caller.
3. Failure after a real publish snapshot INSERT rolls that snapshot back and performs no output.
4. PDF-render failure returns a failure and creates no file/publication records; its committed immutable snapshot may remain.
5. Storage refusal returns failure and creates no design-file/publication records.
6. Estimate failure after real snapshot INSERT rolls back draft, snapshot, provenance and lines (round 2 repro).
7. Estimate failure after revision pin INSERT rolls back all initial work.
8. Estimate failure after totals UPDATE rolls back draft, snapshot, lines and provenance.
9. Failed regeneration after DELETE preserves prior generated/manual lines and totals.
10. Denied source authorization precedes existing approved/missing target diagnostics and writes.
11. Retained Delete confirm invoked three times issues one request and publishes one completion (round 2 repro).
12. Genuine Delete failure followed by two retained retry callbacks issues one retry with the original request ID.
13. Delete completion after Canvas scope changes cannot redact or publish into the new scope.
14. Delete completion preserves unrelated canvases/events received during its request.
15. Historical floor metadata returns the current renamed design name consistently through get/list/history/events.
16. Losing Projects or scoped Leads prevents design_name through get/list/history/events; retained ownership alone grants no read.
17. PageStage initially hides the iframe and zoom controls, then shows both only on ready.
18. PageStage timeout leaves export disabled and a retry mounts a fresh hidden stage; bridge ignores late readiness after timeout/disposal.
19. Use this version tracks selected version versus fresh latest_version after an update, even when snapshot numbers differ from Canvas numbers.
20. A concurrent latest-version advance while restore confirmation is open is either safely accepted against fresh CAS or rejected without overwriting the new head.


Supplemental expectation, recorded after reading the concurrent design review and before execution: when a newer Canvas floor pin already matches the live designer, selecting an older pin must offer navigation to that existing latest version, rather than label it as an uncaptured designer change and report that it is already current. **Fails in the component; actual SQL/API observations corroborate required fix 1.**
