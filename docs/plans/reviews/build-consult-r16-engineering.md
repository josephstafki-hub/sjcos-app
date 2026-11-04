SCORES: design=9 completeness=9

# Build R16 — Engineering judge

Reviewed HEAD `144f72d9ec3fc9c47245376f5368bfad1793e8cf`, commits `c3a8d56a` and `144f72d9`, the plan and R15 reviews. This review is the only repository write. No source changes, subagents, browsers, app servers, builds, services, live DB or QA DB access. All database probes used the disposable `consult-judge` harness. No exit 137 occurred.

## Verified R15 fixes

1. **Legacy room quantities: fixed.** Re-ran the exact 120 × 120 inch legacy-room probe with the room pin's `part_of` removed and bathroom plus kitchen templates. Both projections now return `value:100, instance_ids:[legacy], answer_revisions:[1]`, rather than zero. The new regression also preserves 140 sf across two rooms for both templates. Legacy completion, scope-facts export, and combined-template separation tests pass. The capability gate explicitly preserves the old all-rooms policy for old pins; it does not silently reclassify old rooms.
2. **Direct SQL component ranges: fixed.** Independently published and pinned a door with `range:[18,96], component_ranges:[[18,72],[72,96]]`, created its instance and called `consult_capture_answer` with the assigned visitor's signed context and `[90,20]`. It throws `out_of_range`, leaves the consult revision unchanged and writes zero answers. The regression also rejects `[17,80]` and `[36,97]`. An independent window `[5,80]` probe rejects without mutation. These are executed SQL calls, not source assertions.
3. **Red consult-r11-design suite: fixed.** Ran the file: 11 passed, 0 failed. It now checks the intended three-argument advisory contract; the advisory/no-decision regressions pass too.

## Required fixes

1. **Medium — Hand delivery after the revised start remains satisfied.** `db/migrations/0088_consult_r14.sql:19` (and the redelivery cancellation guard at line 49).

   **Real repro:** in a fresh disposable database, create a consult and project with start `2026-11-20`. Insert its `:rrp:delivery` task as done with `rrp_delivery_method='hand'`, `rrp_delivered_on='2026-11-02'` and matching completion timestamp. Update the project's start to `2026-11-01`, exercising the actual project trigger. Querying the task still returns `status:'done', rrp_delivered_on:'2026-11-02'`: the delivery happened after the revised start. All dates are in the past relative to this review, so no future-delivery fixture is necessary. The final reconciler only checks the lower 60-day bound for hand deliveries; its upper bound only covers mail. This is an uncovered correctness gap in the earlier-start reconciliation, not a failure of the three R15 repairs.

   **Fix:** add a forward migration that treats a hand delivery later than the start as outside the window, preserving its delivery evidence and surfacing an actionable unresolved task. Preserve that unresolved state in the redelivery cancellation branch too, which currently only protects late mail. Use the recorded delivery day consistently, with a completion-day fallback for legacy rows. Add trigger-level tests for both delivery source suffixes: hand before/on the start remains satisfied, hand after the revised start becomes unresolved, mail retains its seven-day margin, and repeat reconciliation stays idempotent. Historical late delivery cannot be repaired by presenting it as timely.

## Additional boundary audit

- **Offline vault / sync:** inspected issuer pinning, lease and identity partition checks, PIN backoff, nonextractable keys, lock/revocation and serialized replay. Offline, queue, send, snapshot refresh, sync and close retry tests passed, including cold unlock, lost acknowledgements, generation fencing and stale decisions. No new required issue found in these paths.
- **Close hash precondition:** server checks the provided baseline hash against current evidence before accepting a patch. The controller sends a hash for every chunk, preserves the original close baseline across refresh and recognizes only its own already-applied prefixes after an interruption. Executed stale-concurrent-baseline, cold close, chunking and production-sized POST regressions passed. The backward-compatible API still allows a matching baseline object rather than requiring a hash on every caller; no new universal hash-only requirement is assumed.
- **Owner / visitor:** reopen remains active-owner/person-only in both command and SQL. Assigned visitor and owner can apply findings; unrelated/revoked staff and agent contexts are denied. Access and R14 apply-service tests passed. The R14 test's HTTP wording is broader than its evidence: it exercises commands and direct service, not a real HTTP request. No new authority restriction was inferred.
- **RRP 0082–0089:** inspected successive replacements and trigger wiring; executed existing start, delayed start, lower-window, mail-margin, delivery-record and cancellation regressions. Their existing scenarios pass. The additional earlier-start hand scenario fails as described above.
- **Ordering / idempotency:** fresh schema + ordered migrations bootstrapped successfully both before narrow roles and with roles provisioned. Independently reapplied 0089 twice successfully; rerunning the migration ledger reported zero pending migrations. Existing migration checksums remain intact in the reviewed diff.
- **SECURITY DEFINER:** every definition in 0082–0089 declares `SET search_path = public, pg_temp`. An independent catalog query found zero `consult_%` SECURITY DEFINER functions missing that setting. CREATE OR REPLACE retains the existing capture ACL; narrow-role boundary tests pass.
- **Manifest parity:** `node scripts/db-roles-scan.mjs --diff` exits 0. Its differences are explicitly documented withheld permissions, including consult command storage; no unaccounted new write target was identified. Both real-database role suites pass (6 + 2 tests).
- **Quantity changes:** combined rooms, legacy rooms, maximum bath ceiling, backsplash choices, pin publication and scope export regressions pass. No independent visual checks were performed; visual appearance remains for the coordinator.

## Verification

Type-check: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?` → **exit=0**.

**319 passed, 0 failed, 0 skipped across 55 requested files.** Each ran alone with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. Bootstrap ran first on a clean cluster so previously provisioned roles could not contaminate its precondition. Independent probes are additional to this tally. The suite cluster and the later probe cluster were both stopped.

Per-file pass counts:

- `tests/consult-access-db.test.mjs`: 3
- `tests/consult-backend-integration-db.test.mjs`: 3
- `tests/consult-completeness.test.mjs`: 6
- `tests/consult-findings-db.test.mjs`: 9
- `tests/consult-forms.test.mjs`: 5
- `tests/consult-formula.test.mjs`: 3
- `tests/consult-hints.test.mjs`: 7
- `tests/consult-length.test.mjs`: 3
- `tests/consult-mcp.test.mjs`: 2
- `tests/consult-migration-bootstrap.test.mjs`: 1
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
- `tests/consult-r14-design.test.mjs`: 6
- `tests/consult-r14-logic.test.mjs`: 4
- `tests/consult-r15-design.test.mjs`: 3
- `tests/consult-r15-logic.test.mjs`: 8
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
