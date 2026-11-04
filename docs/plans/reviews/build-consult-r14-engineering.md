# Build R14 — Engineering judge

SCORES: design=9 completeness=9

Reviewed HEAD `a47fb7cd7b5c2b50f59c9b14111bc3c76443e769`, both requested commits, R13 engineering review, and supplied production QA log. Review only: this is the sole repository file written. No code edits, commits, subagents, app servers, browsers, builds, live DB connections, or reads of prohibited artifacts.

## Required fixes

1. **Medium — The context-taking findings service still allows staff application.** `lib/consult/findings.ts:123`–128; regressions retain staff-success calls at `tests/consult-findings-db.test.mjs:7` and `:84`.

   **Repro:** in the tagged disposable harness, create `findingsFixture(c)`, save evidence and close Complete, then call `reconcileConsultFindings(c, f.context('apply'), {consult_id:f.consult, expected_generation:1, operation_id:randomUUID()})` in a transaction. The context belongs to assigned staff. It returned `results[0].status='applied'` and wrote a 200 sf Floor area quantity to scope. Rolled back after inspecting the result. The function checks the SQL context and person mode but never the actor's owner role. `consult_verify_context(...,'apply')` authenticates assigned staff successfully.

   **Fix:** either remove this unused production export and route its tests through the authorized command/fenced worker, or enforce an active owner on this context-taking entry before calling the internal executor. Change the staff-success regressions to owner-success and staff-denial assertions, including unchanged scope/application records after denial. Preserve the internal worker executor and intentional owner-configured auto-application path.

   **Exposure:** no current app/MCP caller of this export was found; HTTP `apply_findings` now correctly refuses staff. This is a remaining service-boundary gap under the requested “every path” requirement, not a demonstrated HTTP bypass.

## Requested checks

- **R13 reopen fix passes.** Existing access harness test proves staff denial through both `command(...,'reopen')` and `consult_reopen`, unchanged Complete status, stale owner revision denial, and owner success. Additional real-command harness probe confirmed staff `reopen` and `apply_findings` both throw `owner_required`, and direct SQL staff reopen throws the same error. All three narrow roles were refused direct INSERT into `consult_findings_jobs`; there is no SQL `apply_findings` command function. The findings context entry gap is required fix 1.
- **Ranges:** additional harness calls accepted 1″ and 600″ inclusive bounds, 24 1/16″ (24.0625), 2 ft, 609.6 mm, and 0.6096 m after the actual length parser converted them to canonical inches. Each received status 200. The new out-of-range regression refuses 99999 with `details.fields=['room.length']` and no answer write. Range checks compare canonical values, with no whole-inch rounding or raw metric comparison. Existing length/pair and seed tests pass. This is targeted evidence, not an exhaustive numeric-domain proof.
- **0087:** both replaced functions retain `SECURITY DEFINER SET search_path = public, pg_temp`; CREATE OR REPLACE preserves the existing reopen execution ACL. Work-item grants are present and the existing manifest entries remain, with the migration note updated. Both role suites pass. Executed the entire migration twice more on the disposable probe database without error. Source-existence and status guards prevent repeated inserts/reopens; default mailing work is start minus 14 days, while explicit permitted redelivery days remain within the 60-to-7-day window.
- **64 KiB:** the client ops queue retains its 64 KiB minus 512-byte envelope reserve and indivisible-op guard; evidence patches retain bounded splitting and multibyte regression coverage. The requested 64 KiB bound is a client-generated sync-request bound. It is not the HTTP acceptance limit: `transport.ts:6` and `protocol.ts:185` deliberately retain 256 KiB ops acceptance, and evidence accepts up to 2 MiB. The route reads the body before parsing; this round does not establish a streaming 64 KiB HTTP limit.
- **Refusal routing:** moving `closeRefusalFocus` from `ui/words.ts:716` into `close-errors.ts` would put the two pure path resolvers together and is a reasonable cleanup, but is not a required fix. The wrapper handles `closing.estimate_promised` while delegating other paths. Unknown/missing paths, absent visit fields and absent photos fields open wrap with the refusal note; normal row actions remain distinct. `DotLine` binds the separator to the preceding piece. Source regressions pass; no independent browser verification was performed.
- **Seed/fixture:** radon advisory is now pinned seed content rather than a model-only addition; its advisory kind survives schema validation and server evaluation. The coherent fixture closes Complete in the real database test. This review makes no separate regulatory judgment.
- **Supplied evidence:** read `/tmp/sjcqa/shots/consult-r14/log.json`; it includes `phone-43k` and the refusal/reclose sequence. The office failure wording is explicitly updated in `close-errors.ts`. The log also records a disabled-Close click timeout for the conflict fixture and unrelated selection-image 404s; it is not a wholly error-free visual run. The named Joe Complete screenshot still uses an office URL. No new browser session was started.

## Verification

Type-check: exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?` — **exit=0**.

Two extra tagged inline disposable-harness probes verified authorization, six accepted lengths, migration replay, narrow SQL job denial, and reproduced the staff findings-service application. These are separate from the suite counts below. No exit 137 or killed process occurred.

**299/299 tests passed across 52 single test files**, 0 failures. Full consult list plus both database-role suites and estimating-readiness-consult ran sequentially with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. The tagged harness cluster stopped afterward (`stopped`).

Per-file passes:

- `tests/consult-migration-bootstrap.test.mjs`: 1
- `tests/consult-access-db.test.mjs`: 3
- `tests/consult-backend-integration-db.test.mjs`: 3
- `tests/consult-completeness.test.mjs`: 6
- `tests/consult-findings-db.test.mjs`: 9
- `tests/consult-forms.test.mjs`: 5
- `tests/consult-formula.test.mjs`: 3
- `tests/consult-hints.test.mjs`: 7
- `tests/consult-length.test.mjs`: 3
- `tests/consult-mcp.test.mjs`: 2
- `tests/consult-offline-db.test.mjs`: 4
- `tests/consult-offline.test.mjs`: 23
- `tests/consult-queue.test.mjs`: 5
- `tests/consult-r1-copy.test.mjs`: 4
- `tests/consult-r1-logic.test.mjs`: 6
- `tests/consult-r10-design.test.mjs`: 9
- `tests/consult-r10-domain.test.mjs`: 5
- `tests/consult-r10-engineering.test.mjs`: 4
- `tests/consult-r11-design.test.mjs`: 11
- `tests/consult-r11-engineering.test.mjs`: 4
- `tests/consult-r11-fixes.test.mjs`: 4
- `tests/consult-r12-design.test.mjs`: 6
- `tests/consult-r12-logic.test.mjs`: 6
- `tests/consult-r13-design.test.mjs`: 7
- `tests/consult-r13-logic.test.mjs`: 3
- `tests/consult-r2-design.test.mjs`: 9
- `tests/consult-r3-logic.test.mjs`: 8
- `tests/consult-r4-design.test.mjs`: 4
- `tests/consult-r4-logic.test.mjs`: 20
- `tests/consult-r5-design.test.mjs`: 8
- `tests/consult-r6-backend.test.mjs`: 2
- `tests/consult-r6-design.test.mjs`: 11
- `tests/consult-r7-design.test.mjs`: 7
- `tests/consult-r7-logic.test.mjs`: 8
- `tests/consult-r8-design.test.mjs`: 8
- `tests/consult-r8-logic.test.mjs`: 9
- `tests/consult-r9-design.test.mjs`: 4
- `tests/consult-r9-domain.test.mjs`: 5
- `tests/consult-r9-logic.test.mjs`: 4
- `tests/consult-readiness.test.mjs`: 2
- `tests/consult-scope-facts-db.test.mjs`: 4
- `tests/consult-scope-facts.test.mjs`: 2
- `tests/consult-seed-publication-db.test.mjs`: 1
- `tests/consult-seed.test.mjs`: 12
- `tests/consult-send.test.mjs`: 2
- `tests/consult-snapshot-refresh.test.mjs`: 4
- `tests/consult-sync-db.test.mjs`: 4
- `tests/consult-todos-db.test.mjs`: 3
- `tests/consult-ui-model.test.mjs`: 6
- `tests/db-roles-manifest-db.test.mjs`: 6
- `tests/db-roles-paths-db.test.mjs`: 2
- `tests/estimating-readiness-consult.test.mjs`: 1
