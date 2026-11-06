SCORES: design=7 completeness=6

Engineering judge, Canvas Phase 1 build round 1. Reviewed implementation through
`b98a8aa7` against Phase 0 `c2d8a699`, the shared context/host contract, Canvas
plan §§5/6/8/9/9.1/10/11, and all Phase 1/classification handoffs. During review,
HEAD advanced to `f8204075`; the intervening commits contain the other judges'
review documents only. No implementation source was edited.

The private-data boundaries and basic persistence are substantially implemented.
The build does not yet meet the Phase 1 exit: real drawings lose presentation,
an unbound canvas cannot reach its Save destination, and staff's tracked
conversation cannot survive another turn. Required checks are also not all green.

## REQUIRED fixes

1. **Preserve drawing geometry and semantics during normalization.**
   `lib/canvas-renderer.mjs:74`, `:89`, `:120`, `:133`.
   The fixed palette preserves fills/strokes for only a few classes, removes every
   upstream stylesheet/inline style, then gives every otherwise unfilled path
   `fill="none"`. Replaying each existing real fixture through the actual emitted
   bootstrap reproduces the problem: flowchart node labels have no `text-anchor`
   after normalization, and sequence actor labels lose their inline
   `text-anchor: middle`. Their coordinates still identify the centers, so SVG's
   default start anchor shifts them right. All flowchart and sequence marker paths
   in these fixtures end up without a non-none fill; directed arrowheads disappear.
   This is more specific than attributing the issue only to 16px/em conversion.
   **Exact change:** translate the pinned renderer's approved label alignment,
   baseline/font metrics, cluster/note/loop presentation and marker fill/stroke
   into explicit allowlisted attributes before stripping CSS. Apply `fill=none`
   only to actual unfilled connector paths, not marker geometry. Keep independent
   SVG validation and existing CSP unchanged. Add assertions for label anchors,
   node-relative positions and visible arrowheads, rather than just text presence
   and a successful `rendered` message. Extend real-output fixtures to subgraphs,
   long/multiline labels, sequence notes/loops and state notes. The state source
   branch at `lib/canvas-content.mjs:247` currently rejects ordinary
   `note right of A ... end note`; add bounded, non-HTML note grammar for this
   supported family and test it through the same rendering gates. Coordinator
   must capture the additional real fixtures/visual evidence; no browser was
   started by this reviewer.

2. **Make the Save project picker usable inside its dialog.**
   `components/panel/CanvasSaveDialog.tsx:27`, `:30`, `:31`;
   `components/panel/JobPicker.tsx:146`, `:167`.
   JobPicker is an absolutely positioned `top-full` dropdown, mounted without a
   positioned anchor inside two scrolling/clipped dialog containers. For an
   unbound canvas, `project=''`, policy is never fetched until a project is picked,
   and the displaced picker prevents reaching the audience/checklist/Save state.
   This matches the coordinator's UNKNOWN-canvas result. The empty string also
   defeats the `?? 'Pick a project'` placeholder.
   **Exact change:** provide an in-flow picker mode for this dialog, or correctly
   anchor/portal it inside the visible focus-trapped dialog with sufficient room;
   use an empty-string fallback for the Project button, 16px search and 48px rows.
   Test the real dialog+JobPicker integration: unbound canvas → choose project →
   policy fetch → default staff audience/all 21 areas → acknowledgement → Save,
   plus changing a prebound project. Existing save-dialog tests exercise pure
   policy/transport helpers and do not cover this mounted picker.

3. **Carry verified business provenance across normal Canvas turns.**
   `lib/ask-context-inputs.mjs:101`, `:104`, `:105`;
   `scripts/run-claude-agent.mjs:1069`, `:1074`;
   `db/migrations/0107_ask_context_provenance.sql:38`;
   `components/panel/canvas/state.ts:14`, `:17`.
   Any prior run, even a fully tracked business run followed by a fresh CLI with
   `resumed=false`, permanently sets `unknown`. A fresh disposable-DB test with
   complete tracked money input confirms `complete:true` becomes false solely
   because the second admitted run exists. Separately, only three exact prompt
   strings can be complete. The UI's own empty-state request, fix/simplify prompts
   and Ask-for-a-change prefill are outside that set. The normal staff flow thus
   cannot create/change/save through the advertised UI; starting another chat
   does not fix the UI's own unrecognized prompt.
   **Exact change:** verify and carry the complete prior business lineage,
   enforced policy/session epoch and every assembled input hash when continuing;
   mark unknown for actual missing/uninstrumented lineage, not merely `prior` or
   an otherwise verified continuation. Introduce authenticated server-generated
   instruction envelopes for the Canvas controls and classify their inherited
   canvas/record context before delivery. Keep arbitrary unclassified facts,
   legacy/operator sessions and unhealthy tracking fail-closed; do not replace
   provenance with keyword guesses or the actor's permissions. Add actual
   message/runner/second-turn/change/Save positives, alongside unknown negatives.

4. **Finish the test database interlock and close its default-database bypass.**
   `lib/test-db-guard.mjs:9`; `lib/db-login.mjs:89`;
   `scripts/run-claude-agent.mjs:96`, `:289`;
   `scripts/sjcos-worker.mjs:58`; `scripts/run-business-agent.mjs:85`.
   Only the app pool and two MCP pools call the new guard. The factory census
   also finds unguarded worker/runner, import, backup/restore, migration and
   reporting factories throughout `scripts/` and `db/`. The marker alone does
   not prove a disposable destination. A no-connect probe set
   `NODE_TEST_CONTEXT=child-v8`, `PGDATABASE=sjcos` and passed
   `postgresql://unused@127.0.0.1/?application_name=sjc_test_harness`: the guard
   accepted it, while `new pg.Client(...).connectionParameters` resolved to
   **sjcos at 127.0.0.1:5432**. No connect/query was called.
   **Exact change:** centralize guarded pg construction/resolution for every
   connection factory, including directly supplied URLs and subprocess entry
   points. Validate the effective pg configuration against an explicit disposable
   cluster/database identity; require a nonempty test database and explicit
   harness socket/port, and reject environment/default/query overrides that can
   redirect it. Check before constructing or reusing a pool. Add a factory census
   test plus fake-pg subprocess cases for empty pathname/PGDATABASE, runtime URLs,
   worker/runner/import/migration factories and lost test context. Keep runtime
   behavior outside tests unchanged.

5. **Restore the named verification gates without weakening their assertions.**
   `tests/fixtures/ask-private-query-allowlist.json:1`;
   `tests/canvas-classification.test.mjs:9`;
   `tests/agent-profile.test.mjs:156`;
   `tests/ask-thread-recovery-db.test.mjs:185`;
   `tests/mobile-rpc.test.mjs:83`.
   The private-query scan fails with 11 audit violations: changed/stale MCP
   private-files audit plus unaudited QA-seed queries at lines 38/40/53/55/82/86/87.
   Classification and profile files fail their ordinary single-file invocation
   because they supply dummy non-harness URLs; both pass when an explicit
   disposable `SJC_TEST_DATABASE_URL` is supplied. Recovery reports 41/43 because
   the registered-question fixture no longer matches the answer-delivery
   contract; mobile reports 27/28 because its evaluated file-route fixture lacks
   the newly imported resolver (`resolveCanvasFilePolicy is not defined`).
   **Exact change:** audit the changed queries and guards, then update only their
   justified hashes/entries; make test setup consistently provision explicit
   disposable URLs before MCP import; update the recovery fixture to exercise
   the tracked adapter, validated response shape and formatted answer; inject the
   file resolver/snapshot-response seam into the mobile fixture with ordinary and
   Canvas cases. Rerun these single files. Do not disable the guard, remove the
   private-query scan, erase answer-delivery coverage or grant raw private access.

6. **Implement the durable rejected-attempt fallback.**
   `mcp/canvas-tools.mjs:40`; `mcp/sjcos-mcp.mjs:479`;
   `scripts/run-claude-agent.mjs:98`; `lib/ask-canvases.ts:329`.
   The UI/feed/schema can read a `rejected` event, but there is no production
   writer or runner rejection state. A fresh valid admitted run rejected unsafe
   source and left zero rejected events; a repository scan finds no runner Canvas
   attempt/fallback handling at all. This leaves reload/crash/no-reply rejection
   cards and their promised text fallback unimplemented (§5.4 item 6).
   **Exact change:** retain only the bounded latest refusal reason for an admitted
   run, clear it after successful Canvas creation, and on give-up/terminal
   failure persist one source-free rejected event plus the text fallback through
   the trusted app command. Serialize its event allocation under the same
   global/thread locks, reauthorize, deduplicate retries and never save rejected
   source. Test actual failed tool → terminal runner → history/mobile recovery,
   including success-after-rejection and no-assistant/crash cases; fabricated
   event objects alone do not verify this path.

7. **Preserve Phase 0-only operation when the new code is deployed flags-off.**
   `scripts/run-claude-agent.mjs:1056`, `:1069`;
   `mcp/sjcos-mcp.mjs:452`, `:469`;
   `mcp/interact-mcp.mjs:110`.
   Business launch unconditionally calls the 0107 epoch writer, and admitted
   panel MCP handlers unconditionally invoke the provenance adapter. Neither
   checks schema capability. With only actual 0100+0105 installed and Canvas off,
   the real epoch helper raises 42P01 (missing ask_context_provenance), so ordinary
   staff launch/tool/question paths cannot retain Phase 0 behavior. The current
   rollout test checks an empty event endpoint, not these changed runtime paths.
   **Exact change:** select the legacy non-Canvas runner/tool/question path from
   trusted server schema capability before assembling/spawning a run when 0107
   has not been installed; keep Canvas unavailable. Once tracking is installed
   and required, storage/transport failures must still refuse delivery rather
   than falling back. Test a flags-off 0100+0105 staff run and question with the
   actual runner/wrapper, then the additive 0106/0107/0108 upgrade. Do not require
   Browser 0101–0104 or forge ledger entries.

## Verified-correct (file:line)

- `mcp/canvas-tools.mjs:27`, `lib/ask-private-transport.mjs:3`,
  `lib/ask-canvases.ts:358`: construction-time stdio identity, HTTP/ALS rejection
  before forwarding and repeated DB admission. Fresh exact-owner/staff HTTP,
  missing-tag and fractional-start cases all return fixed refusals with zero
  internal calls. Strict schemas reject identity overrides.
- `lib/ask-canvases.ts:166`, `db/migrations/0106_ask_canvases.sql:23`:
  whole snapshots, immutable private identity, CAS, request-hash replay and
  deferred latest linkage. Commands tests pass including ten simultaneous same
  keys and two-connection CAS; fresh changed-label replay/future-restore attacks
  refuse. SQL rejects unknown content keys as TS does.
- `lib/ask-context-inputs.mjs:75`, `lib/ask-context-provenance.mjs:5`:
  durable pending records block completeness; a completed known money input
  produces exactly money, not the actor's unrelated permissions. Input-gate DB
  tests pass for before-delivery synchronization and native-reader restrictions.
- `lib/canvas-renderer.mjs:65`, `lib/canvas-content.mjs:288`:
  b98a8aa7 safely removes decorative filter/gradient/symbol subtrees and filter
  attributes, converts bounded stroke units, removes invalid circle dimensions,
  and keeps the independent numeric/reference grammar. All three real fixtures
  now pass reconstruction; existing unknown-element/reference attacks still
  fail. This verifies acceptance/safety, not faithful appearance (R1).
- `lib/canvas-exports.ts:25`, `:42`, `:54`, `:88`:
  unknown-owner preflight contains all 21 content areas, API omission remains
  owner-only, deliberate reductions require an exact-set token, stale policy is
  rejected before token interpretation and publication is rechecked. Immutable
  equal-hash SVG replay/conflict and independent saved-file authorization pass.
- `db/migrations/0108_ask_canvas_files.sql:62`,
  `lib/canvas-file-access.ts:1`: saved profile partition, current saved-area
  checks, internal-only delivery policy and policy-preserving trash/restore are
  covered by real-session DB tests. A project-file reader need not hold ai or own
  the source chat. Private source and saved copy remain separate.
- `lib/ask-thread-journal.mjs:1`, `lib/canvas-deletion-ledger.mjs:1`:
  Canvas uses the existing deletion authority/lease and preserves saved files.
  Canvas retention tests and fresh physical-delete/premature-purge attacks pass.
  Existing recovery DB coverage has one broken question subtest (R5); no claim
  that every recovery case is green.
- `tests/_harness/testdb.mjs:270`: fresh exact production-SQL rollout
  0100+0105+0106+0107+0108 succeeds without Browser 0101–0104. Missing-0100
  rejection, checksums and additive migrations pass existing rollout tests.
- `deploy/db-roles.manifest.json:1`: new private tables remain website-only;
  raw narrow-role tests pass. `node scripts/db-roles-scan.mjs --diff` exits 0;
  its private/owner-only reachability differences are explicitly withheld, not
  missing grants to add.

## Verification record

Every test file ran alone, sequentially. DB runs used unique
`SJC_TEST_CLUSTER_TAG=c1r1eng-<timestamp>` and an EXIT trap to stop their own
socket-only disposable cluster. No live/QA DB or protected Ask deployment state
was used. No browser, Next command, service operation, install or exit 137.

| Canvas file (`tests/…`) | Pass / fail |
| --- | --- |
| canvas-classification.test.mjs | 7 / 0 with explicit harness URL; fails before setup without it |
| canvas-commands-db.test.mjs | 21 / 0 |
| canvas-content.test.mjs | 52 / 0 |
| canvas-exports-db.test.mjs | 2 / 0 |
| canvas-input-gates-db.test.mjs | 25 / 0 |
| canvas-integration.test.mjs | 33 / 0 |
| canvas-mcp.test.mjs | 40 / 0 |
| canvas-poll-history.test.mjs | 20 / 0 |
| canvas-provenance-db.test.mjs | 5 / 0 |
| canvas-render-bridge.test.mjs | 17 / 0 |
| canvas-renderer.test.mjs | 7 / 0 |
| canvas-retention-db.test.mjs | 1 / 0 |
| canvas-rollout-db.test.mjs | 5 / 0 |
| canvas-routes.test.mjs | 19 / 0 |
| canvas-save-dialog.test.mjs | 25 / 0 |
| canvas-ui.test.mjs | 24 / 0 |

Additional files: test-db-guard 7/0; private-query scan 8/1; role manifest 6/0;
role paths 3/0; panel SSR 93/0; pane 37/0; agent-profile 13/0 with explicit
harness URL (12/1 without); thread recovery 41/2 (one failed child and its
parent); mobile RPC 27/1; browser-run-profile 14/0. No skips.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited 0.
`git diff --check` passed. No second typecheck was started.

Thirty fresh cases were executed from inline, expectations-first review probes,
without adding test/source files. The first MCP probe mistakenly expected thrown
errors; it was corrected to assert the documented error envelope and zero
forwarding. A disposable project fixture initially used invalid statuses; it was
corrected to the already established allowed `floor_plan` status. The 30 final
case outcomes below include that corrected setup; 28 pass, 2 fail.

| # | Expected before execution | Result |
| --- | --- | --- |
| 1 | Encoded HTML label rejected UNSAFE_CONTENT | Pass |
| 2 | Quoted word click accepted | Pass |
| 3 | Nested bounded subgraphs accepted | Pass |
| 4 | Sequence note inside loop accepted | Pass (source gate only) |
| 5 | Plain state note accepted | FAIL: UNSAFE_CONTENT, R1 |
| 6 | HTTP exact owner tags refused, zero forwarding | Pass |
| 7 | HTTP exact staff tags refused, zero forwarding | Pass |
| 8 | HTTP ALS on constructed stdio refused, zero forwarding | Pass |
| 9 | Missing captured thread refused, zero forwarding | Pass |
| 10 | Fractional start timestamp refused, zero forwarding | Pass |
| 11 | MCP context override rejected by strict schema | Pass |
| 12 | Fresh valid business epoch complete, empty baseline | Pass |
| 13 | Pending tool makes provenance incomplete | Pass |
| 14 | Known completed money input complete, money only | Pass |
| 15 | Second fully tracked fresh CLI retains complete lineage | FAIL: unknown, R3 |
| 16 | Fixed tracked instruction preserves completeness | Pass |
| 17 | Extra conversation in internal context refused | Pass |
| 18 | Same request with changed labels conflicts | Pass |
| 19 | Restore nonexistent future version unavailable | Pass |
| 20 | SQL rejects unknown schedule content area | Pass |
| 21 | Unknown preflight has 21 areas, no ai/projects | Pass |
| 22 | Save without derivative EXPORT_NOT_READY | Pass |
| 23 | Forged declassification token SAVE_FAILED | Pass |
| 24 | Stale policy rejected before forged token processing | Pass |
| 25 | SVG loopback URL rejected, no derivative persisted | Pass |
| 26 | Encoded-script/image SVG rejected UNSAFE_CONTENT | Pass |
| 27 | Master off denies existing drawing read | Pass |
| 28 | Physical deletion of retained shell refused | Pass |
| 29 | Premature source purge refused even with purge GUC | Pass |
| 30 | Exact Canvas-only 0100+0105–0108 rollout succeeds | Pass |

Additional probes: real-fixture emitted-bootstrap reconstruction reproduces
anchor/arrow loss (R1); constructor-only effective-pg inspection proves the
PGDATABASE bypass without a connection (R4); admitted unsafe Canvas attempt
persists zero rejection events (R6); flags-off Phase 0-only epoch ingestion fails
on the absent provenance relation (R7). These are additional to the 30 cases.

## Optional / coordinator notes

- The projects.status default `pre_construction` violates the existing check;
  confirmed by disposable fixture inserts and the QA-seed's explicit status fix.
  This is pre-existing and is not a Canvas required fix.
- PNG and actual print remain gated, which the Phase 1 exit expressly permits.
  Do not enable print until the static wrapper and Safari/device acceptance pass.
- Coordinator's zero cross-person leaks, expected foreign-canvas 404 and drawing
  frames at every width are useful supplied evidence. This review did not create
  new visual evidence or certify the deferred host captures. Recheck long labels,
  arrows, notes/subgraphs and unbound Save at 360/820/1100/1280 after the fixes,
  retaining the shared-host landscape/split/Back/focus release gates.
