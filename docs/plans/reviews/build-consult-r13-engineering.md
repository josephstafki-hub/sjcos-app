# Build R13 — Engineering judge

SCORES: design=9 completeness=9

Reviewed branch `t3/in-home-consult-backend`, HEAD `23b125ac7e3f0a9f5f29336115e9ea992dd94371`, R12 engineering items 1–2, both complete commit diffs (`13b83a4e`, `23b125ac`), relevant transport/controller/SQL paths, and supplied `/tmp/sjcqa/shots/consult-r13/log.json`. Review only; this is the only repository file written. No code edits, commits, subagents, browsers, builds, application servers, live database connections, or reads of the prohibited artifacts.

## Required fixes

1. **High — Reopen is hidden from staff but is not owner-authorized on the server.** `lib/consult/protocol.ts:526`; `db/migrations/0075_in_home_consults.sql:432`; contradictory regression at `tests/consult-access-db.test.mjs:67`.

   **Repro:** an assigned staff visitor sends `POST /api/consult/<id>` with normal same-origin/CSRF headers and `{command:"reopen",input:{expected_revision:<current>,reason:"Staff from Complete screen"}}`. The command calls `authorize` without its owner flag, and `consult_reopen` checks person mode and assignment but never owner role. A tagged disposable-harness probe using the real command returned generation 2 and changed a Complete visit from generation 1 to `in_progress` generation 2 using the staff identity. The existing SQL access test actually asserts that staff reopening succeeds. Thus hiding the button cannot enforce the requested owner-only action.

   **Fix:** require owner authorization in the reopen command and in a new migration replacing `consult_reopen` (retain person, revision, lifecycle and reason checks). Replace the staff-success regression with staff-denial tests through both command and SQL paths. Verify owner success, stale owner revision refusal, unchanged generation/status on staff refusal, and retention of answers, media, evidence, and audit history.

## Requested checks

- **R12 item 1 — fixed for the requested transport bound.** `decisionPatches` rejects any indivisible serialized patch above 32,000 bytes before queue capture; `setDraft` preserves the previous saved draft on rejection and returns recoverable wording. Evidence similarly rejects oversized scalar bundles and individual map entries before sending. Both paths split aggregate map patches. Maximum ASCII/multibyte arrays and assumptions now refuse rather than emitting oversized requests. Accepted decision ops still pass the complete-envelope enqueue bound, and batches reserve 512 bytes for their fixed transport envelope. The 603-field regression and multibyte evidence regression pass. This is explicit recoverable rejection, not support for saving arbitrarily large individual values.
- **R12 item 2 — fixed.** Successful delayed reporting persists notification and updates active `closing.ownerNotified`, preserving field focus. Already-notified paused intents restore that acknowledgement. Engine/epoch/intent/dispose guards prevent an abandoned or locked report from restoring the screen. Delayed-conflict, failed-then-successful and abandoned-report regressions pass. Conflict, stale snapshot, evidence conflict and owner-required now wait 30 minutes; other permanent refusals report immediately, with retries for delivery failures.
- **Reopen revision/evidence behavior:** the new device Complete card fetches the current revision and uses the existing `reopen` command. The SQL function locks the visit and checks revision/lifecycle; reopening increments generation and clears completion metadata, retaining answer history and close evidence. The targeted staff probe retained both answer records, confirming the authorization failure is not an answer-deletion failure. Existing refresh/reclose tests pass. Owner authorization remains required fix 1. The supplied “Complete screen as Joe” log entry has an office look-over URL, so it is not independent execution proof of the newly added device-card button.
- **Take the day off:** the UI only offers removal (`day: undefined`), with no day setter. The evidence server gate permits unchanged owner-set days or removal, but refuses adding/changing a trade day for staff. A tagged real-command probe confirmed staff adding a day throws `owner_required` and removing an existing day succeeds. Partial decision drafts may retain a proposed day, but cannot turn it into accepted close evidence or a scheduled trade task without this owner gate.
- **0086:** replacement function remains `SECURITY DEFINER SET search_path = public, pg_temp`. Work-item grants are emitted for agent/worker/readonly and retained in the manifest with the new migration note. The completed delivery is reopened only when its Central completion date falls outside the new 60-day window; due date is start minus seven, and ordinary redelivery reconciliation remains clamped to the legal window. Repeated reconciliation does not duplicate the source task; the done-to-queued update no longer matches after its first application, and source existence guards insertion. Both role suites and the RRP slip regression pass. No new idempotency defect found.
- **Office lines and resolution:** every enumerated close code has specific office wording; delayed codes have the updated escalation handling. The supplied forced-refusal order ends in `invalid_command`, explaining the final Before you wrap wording on the single deduplicated task. Read-only SELECTs on the permitted QA database confirmed that exact title and `status=done`, completed at `2026-11-03 20:23:23.465146-05`. Resolving it is intentional: `protocol.ts:392` marks this close-failure source done after a real successful server close, even when that close results in Needs finishing. The task represents failure to close, not every unfinished answer. The walk is `incomplete`; the realistic fixture is `complete`, generation 4, consistent with the supplied reclose sequence.
- **Other changes:** office flag fragments use their explanatory hint while full regulatory sentences survive; counsel changes are grouped after the approval heading; radon at 4 pCi/L is an advisory in the model; realistic fixture changes use room/location/product direction text rather than generic placeholder prose. Corresponding regressions pass. No independent legal judgment is implied.

## Verification

Type-check used exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?` — **exit=0**.

**289/289 tests passed across 50 single test files**, zero failures, including the full consult list, both db-role files and estimating-readiness-consult. Bootstrap ran first; subsequent files ran sequentially, all with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. Harness cluster stopped afterward (`stopped`). One additional tagged inline disposable-harness probe reproduced staff reopening and checked trade-day refusal/removal; it is not included in the suite count. Its cluster also stopped. No exit 137 or killed processes.

Per-file pass counts:

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
