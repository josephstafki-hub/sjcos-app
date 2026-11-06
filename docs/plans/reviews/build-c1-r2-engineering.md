SCORES: design=8 completeness=8

Engineering judge, Canvas Phase 1 build round 2. Reviewed implementation HEAD
`a0c436ff`, including `ddbabe0a` and `6ea30751`, against the Phase 1 plan and
round-1 engineering review. HEAD subsequently acquired the other judges' review
documents only. No implementation source was edited.

Rendering, isolation, continuation, durable refusals and flags-off rollout are
substantially improved, and every named automated gate now passes. Two ordinary
staff UI paths remain broken despite those green fixtures.

## REQUIRED fixes

1. **Give staff an authorized Canvas destination search.**
   `components/panel/CanvasSaveDialog.tsx:40`,
   `components/panel/JobPicker.tsx:85`, `lib/actions/ai-chat.ts:377`.
   The inline picker still invokes the rail's owner-only `searchJobsAction`.
   Its actual implementation rejects staff with `ASK_ACCESS_DENIED` before
   searching, even with `ai` and `projects` permissions. JobPicker catches the
   refusal, empties its rows and displays the chat-off copy. Thus an unbound
   staff canvas can expose Save but cannot select its destination or request
   save-policy. `projectOnly` filters the response in the client; it does not
   change authorization. The dialog test replaces this action with an always
   successful project array, hiding the failure.
   **Exact change:** add a server-authenticated, project-only destination search
   for the Canvas picker, checking the current staff person's `ai`/`projects`
   access and applicable destination scope. Wire this dialog to that search
   through an explicit picker search seam. Preserve the owner-only rail action
   and avoid returning leads, vendors, subs or foreign folder metadata to staff.
   Test the real action boundary and mounted picker for owner and staff:
   unbound canvas → project row → policy → readonly staff audience → Save;
   include permission-loss and wrong-scope refusals. Recheck the coordinator's
   owner-side click with request/response evidence during that integration QA.

2. **Match provenance envelopes to the controls the UI actually submits.**
   `db/migrations/0107_ask_context_provenance.sql:40`,
   `components/panel/canvas/state.ts:15`, `:22`,
   `components/panel/PanelChat.tsx:310`,
   `tests/canvas-provenance-db.test.mjs:182`, `:201`.
   SQL recognizes only the obsolete Fix diagnostic `The diagram could not be
   drawn.`. All four current `fixCanvasPrompt` diagnostics, including its default,
   return `complete:false` from the real SQL envelope helper. In a fresh complete
   staff thread, inserting the actual SYNTAX_ERROR control message sets unknown
   permanently and the actual `update_canvas` command then refuses with
   `CONTEXT_PROVENANCE_INCOMPLETE`. Separately, SQL recognizes Change only with
   its trailing space, while `submitText` trims it before delivery: the recognized
   prefix becomes unrecognized even when no arbitrary facts were added. Existing
   provenance tests manually supply the obsolete Fix text and untrimmed Change
   prefix rather than the UI's submitted strings.
   **Exact change:** align server control classification with the four bounded
   diagnostic templates emitted by `fixCanvasPrompt`, its default diagnostic,
   and the trimmed Change control. Keep same-thread/version lookup, inherited
   areas, exact input hashing and fail-closed handling of appended unclassified
   facts. Prefer one canonical control contract so wording cannot drift between
   UI and server. Replace the hand-written positive test strings with actual UI
   helper output passed through composer normalization, then exercise message
   insertion → tracked continuation → update → Save for staff, with foreign
   canvas/version and arbitrary-text negatives. Apply SQL changes through the
   appropriate migration for the deployment's already-applied checksum state.

## Round-1 items verified

1. **Geometry/presentation: fixed in the reviewed implementation.**
   `lib/canvas-renderer.mjs`, `lib/canvas-content.mjs` and 29 render-bridge tests
   preserve explicit label anchors/baselines and visible marker geometry while
   retaining the independent SVG gate/CSP. The fixtures now include real pinned
   Mermaid 12.3.0 subgraphs, long labels, sequence notes/loops, state notes and
   100-node output. Bounded plain state notes pass; HTML notes still refuse.
   Coordinator-supplied `c2-log.json`, `c2b-log.json`, `c2c-log.json` report no
   leaks, unexpected console errors or overflow, with the stated stage minima
   and visible arrows/centred labels. This reviewer started no browser.
2. **Save picker: layout and placeholder fixed; staff integration incomplete.**
   In-flow positioning, 16px search, 48px rows and the empty-string placeholder
   are present. The mounted owner success fixture passes. REQUIRED 1 remains.
   Two additional actual-dialog hook probes show that a policy 404 preserves
   the chosen slug, displays an alert and disables Save, and that a late aborted
   response cannot overwrite the newer selection. Real backend preflight accepts
   an unbound canvas's existing project. There is no policy-fetch code resetting
   `project` to empty. These results do **not** reproduce or explain the supplied
   owner QA observation of remaining at `Pick a project ▾`; do not claim it is a
   silent policy reset or that owner browser acceptance is complete.
3. **Verified continuation: backend fixed; UI control drift remains.**
   Actual detached staff first/second runs retain complete lineage with a fresh
   CLI; missing prior delivery, unclassified messages, resumed/legacy/operator
   context and pending inputs remain closed. Empty-state and Simplify controls
   now classify. Registered MCP result → immutable version → staff Save carries
   content-derived areas rather than the person's unrelated permissions.
   REQUIRED 2 prevents declaring all advertised controls repaired.
4. **Test database interlock: fixed for the reviewed runtime factory census.**
   `lib/guarded-pg.mjs` is the sole runtime `pg` import. Independent recursive
   `rg` across lib/mcp/scripts/db/app/components finds 72 guarded-module users,
   no raw runtime pg factory outside it, and only erased type imports alongside
   that one raw import. Other `Client` constructions belong to MCP/Telnyx.
   The 23 guard tests pass, including hostile PG defaults, omitted/empty database,
   query/config redirects, lost Node context with a retained harness tag, and
   worker/runner/import/migration entrypoints before any fake pg construction.
   Fresh encoded-database, duplicate-host and config-port probes also refuse.
   The test harness's direct pg construction is intentional and outside the
   runtime census; it creates only its own socket-only disposable clusters.
5. **Named verification gates: fixed.**
   Private-query scan, classification/profile setup, actual tracked question
   recovery and ordinary/Canvas mobile file resolver fixtures all pass with
   their ordinary single-file invocations. No manual dummy URL override was
   needed. Role grants remain narrow; no raw private-access grant was added.
6. **Durable refusal fallback: fixed for the exercised paths.**
   The website-only attempt table retains a bounded reason. Successful content
   retry clears it. Real registered failed tool → terminal runner → history and
   mobile tests pass. Fresh probes confirm latest-reason replacement, successful
   retry cleanup, source-free deduplicated cancelled-run terminal events/text,
   and suppression after session revocation. 0106's statement trigger takes the
   global lock before run-row locks; terminal authorization and event allocation
   remain inside the website command transaction. New trigger functions have
   SECURITY DEFINER/fixed search_path and the table is in the role manifest.
7. **Phase-0-only operation: fixed for the actual exercised runtime paths.**
   The exact 0100+0105 rollout test runs ordinary staff runner, registered MCP
   reads, project files and tracked-question wrapper on the legacy path before
   additive upgrade. No Browser migrations are needed. Installed-but-missing
   provenance and latched capability loss refuse rather than downgrade.

## Verification record

Every file below ran alone, sequentially. Each DB invocation used a unique
`SJC_TEST_CLUSTER_TAG=c1r2eng-<timestamp>` and an EXIT trap that stopped its own
cluster. All clusters were stopped. Only disposable harness databases and
temporary test-owned deployment/upload directories were used. No live/QA DB,
protected deployment-state directory, service, browser, application server, Next command,
installation or exit 137 was involved.

| Canvas file (`tests/…`) | Pass / fail |
| --- | --- |
| canvas-classification.test.mjs | 8 / 0 |
| canvas-commands-db.test.mjs | 21 / 0 |
| canvas-content.test.mjs | 54 / 0 |
| canvas-exports-db.test.mjs | 2 / 0 |
| canvas-input-gates-db.test.mjs | 25 / 0 |
| canvas-integration.test.mjs | 33 / 0 |
| canvas-mcp.test.mjs | 40 / 0 |
| canvas-poll-history.test.mjs | 20 / 0 |
| canvas-provenance-db.test.mjs | 5 / 0 |
| canvas-render-bridge.test.mjs | 29 / 0 |
| canvas-renderer.test.mjs | 7 / 0 |
| canvas-retention-db.test.mjs | 1 / 0 |
| canvas-rollout-db.test.mjs | 6 / 0 |
| canvas-routes.test.mjs | 20 / 0 |
| canvas-save-dialog.test.mjs | 27 / 0 |
| canvas-ui.test.mjs | 29 / 0 |

Additional single files: test-db-guard 23/0; ask-private-query-scan 9/0;
db-roles-manifest-db 6/0; db-roles-paths-db 3/0; agent-profile 13/0;
ask-thread-recovery-db 43/0; mobile-rpc 28/0; ask-panel-ssr 95/0;
panel-content-pane 38/0; browser-run-profile 14/0. No skips.

`node scripts/db-roles-scan.mjs --diff` exits 0; private/owner-only reachability
differences are explicitly withheld, not missing grants to add.
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exits 0 (one run).
`git diff --check` passes.

An additional exact-SQL/checksum subset fixture installs only
0100+0105+0106+0107+0108, asserts the recorded IDs, then exercises real staff
epoch → create → update → validated derivative → policy → Save → actual static
blob. It passes with an empty content-derived baseline and without Browser
relations. Migration checksum replay is unchanged. Additional SQL/TS parity
probes both refuse title length 81, summary length 501 and diagram bytes 32769;
fresh unknown/duplicate-area cases refuse on both paths. Existing command tests
also retain immutable-identity, sequential-version, CAS, deferred-latest,
quota/accounting and actual narrow-session boundary coverage.

## Twenty-five fresh adversarial cases

Expectations were set before execution; probes used inline code, not new test or
source files. The first probe driver had a review-only out-of-scope `id` after
case 18; cases 19–25 were completed in a second isolated invocation with a local
dummy canvas ID for the fetch-seam tests. No implementation assertion was relaxed.
Final result: 20 pass, 5 fail, identifying the two REQUIRED fixes above.

| # | Expected behavior | Result |
| --- | --- | --- |
| 1 | Real UI SOURCE_REJECTED Fix inherits complete envelope | FAIL, REQUIRED 2 |
| 2 | Real UI SYNTAX_ERROR Fix inherits complete envelope | FAIL, REQUIRED 2 |
| 3 | Real UI LAYOUT_FAILED Fix inherits complete envelope | FAIL, REQUIRED 2 |
| 4 | Real UI DRAWING_REJECTED Fix inherits complete envelope | FAIL, REQUIRED 2 |
| 5 | Real UI Simplify retains complete envelope | Pass |
| 6 | Appended arbitrary facts cannot mint a known instruction | Pass |
| 7 | Foreign title cannot mint a control envelope | Pass |
| 8 | Staff with ai/projects can search a Save destination | FAIL, REQUIRED 1 |
| 9 | Actual owner search returns project slug | Pass |
| 10 | Unknown area refused by SQL and TS | Pass |
| 11 | Duplicate area refused by SQL and TS | Pass |
| 12 | Unbound real project preflight succeeds | Pass |
| 13 | Missing destination refuses, binding remains null | Pass |
| 14 | Bound canvas refuses another project's destination | Pass |
| 15 | Multiple refusals retain only latest bounded reason | Pass |
| 16 | Successful retry clears pending refusal | Pass |
| 17 | Cancelled terminal run emits one source-free event and text | Pass |
| 18 | Revocation suppresses terminal event | Pass |
| 19 | Policy 404 retains selected slug and shows alert | Pass |
| 20 | Late aborted policy cannot overwrite next destination | Pass |
| 21 | Encoded invalid database cannot use PGDATABASE fallback | Pass |
| 22 | Duplicate host query override refused | Pass |
| 23 | Config port override refused with valid harness URL | Pass |
| 24 | Encoded SVG namespace link rejected independently | Pass |
| 25 | Plain multiline state note accepted, HTML note refused | Pass |

Additional control integration confirms both Change-prefix trim mismatch and
actual UI Fix message → sticky unknown provenance → refused staff update. The
staff-search probe executes the repository's actual action implementation with
controlled principal/search dependencies; the production rejection occurs before
the search dependency is reached. Coordinator still owns browser acceptance of
the owner-side picker observation and the shared-host/device release checks.
