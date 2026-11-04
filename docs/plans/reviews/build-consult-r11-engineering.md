# Build R11 — Engineering judge

SCORES: design=8 completeness=8

Reviewed `t3/in-home-consult-backend`, HEAD `19bafac8b782fb89f78b3865c81b51b02888473f`, the R10 engineering report, commits f907899a, 44d76fff, 6d62e067 and 19bafac8, and supplied R11 log.json/log-refused.json. Review only; this is the only file written. No code edits, commits, subagents, browsers, application servers, live DB access or prohibited artifact reads.

## Required fixes

1. **High — non-retryable close refusals replay automatically, indefinitely.** `lib/consult/ui/controller.ts:590` (also `:468`, `:598`). Repro: make close return HTTP 409 `{error_code:"conflict"}` persistently. The UI correctly says Not closed yet / Reload, but the catch schedules another drain regardless of `transientClose`; drain resumes the saved request with the same expected revision. Supplied log-refused.json records two refused POSTs. An inline controller reproduction with mocked fetch confirmed two consecutive refusals produce two close POSTs, two report POSTs and scheduled delays of 2000/4000ms without user action. The single injected refusal succeeding on replay proves only an artificial transient failure, not that retrying a real revision conflict is safe or useful.

   Delay is bounded at 60 seconds (2, 4, 8, 16, 32, 60 seconds), but attempts/duration are unbounded; 30 minutes only starts escalation. `closeTimer` is never assigned the scheduler's `timer`, so abandonClose clears the wrong timer. Dropping the intent prevents that timer from closing again, but terminal refusal itself leaves the intent eligible on timers, foreground and online events.

   **Fix:** persist a paused/refused close state for non-transient errors, retain evidence/request for recovery, and require the prescribed Reload/rebase/owner action before resuming. Gate all resume entry points, not just timer scheduling. Retry only known transient failures, retain identical request identity for ambiguous transport outcomes, and define the escalation/continuation policy after 30 minutes. Clear the actual retry timer on abandon/success. Add controller tests for persistent 409, foreground/online after refusal, abandon with a scheduled timer, and eventual transient success. Server escalation is already deduped under the consult lock/stable source key and resolved on successful close; avoid repeatedly reporting an already acknowledged failure.

2. **High — a realistic large visit still cannot sync its wrap decisions, before the enlarged evidence route is reached.** `lib/consult/ui/ops.ts:46`; `lib/consult/ui/controller.ts:427`; `lib/consult/queue.ts:56`. Repro: use the same 603-skip scale as the production regression, with a 500-character explanatory note per skip (well below the allowed 8000 characters). `decisionSchema.parse` accepts it; `decisionsOp` serializes the entire draft into one **348,920-byte** operation. Enqueue succeeds but `nextBatch` returns no operations because its cap is 256 KiB minus envelope reserve. OfflineEngine reports `op_too_large`; that sequence blocks later operations and close. This was reproduced using the real schema, envelope, enqueue and nextBatch, without DB or repository writes. The current 603-skip regression calls the evidence route directly and omits this real UI queue path.

   **Fix:** send bounded incremental decision operations (with explicit clears, conflict preconditions and idempotency), or a separately bounded/chunked decision transport; do not enlarge all ops indiscriminately. Exercise editing a retained large reopened draft through setDraft → durable queue → actual ops transport → evidence → close. Also define and enforce the supported total evidence size before accepting offline input: 603 schema-valid skips with 3500-character notes produce a **2,157,479-byte** evidence request even without assumptions and hit the 2 MiB refusal. The new cap safely bounds requests and has actionable refusal wording, but does not cover the schema's worst case. Support that case through bounded patches/chunks or provide an explicit, recoverable size boundary in capture; a permanently stuck accepted local operation is not an adequate boundary.

## Requested checks

- **R10 hash/transport fix:** replacement baseline is now a canonical SHA-256 precondition rather than duplicated JSON. Server checks revision/generation and exact hash; explicit replacement maps retain deletion semantics. Production-sized route test passes, including changed skip evidence, stale hash refusal, 413 and Complete. This fixes the previously demonstrated duplicated-baseline failure, subject to required fix 2 for actual UI capture.
- **Durable refresh:** unlock, foreground/online and Reload refresh the encrypted durable snapshot. Refresh runs through the engine's serialized transaction, rejects older baselines, preserves unsent operations and their projection, rebases changed generations to explicit conflicts, and preserves blobs and pending close evidence. Accepted draft state is recovered from server decisions. Failed network refresh leaves the durable copy intact. Four snapshot-refresh tests pass, including cold unlock, unsent edits, Reload and changed evidence refusal. No additional demonstrated evidence-loss defect found in these paths.
- **0083:** both reconcile and trigger functions are SECURITY DEFINER with fixed `public, pg_temp` search_path. Manifest documents the work_items path and migration retains generated narrow-role grants; both role suites pass. Reconcile runs at close as well as project-start changes. NULL start returns without wiping dates; strictly more than 60 Central calendar days creates redelivery; due date is capped at start minus seven days using least with the saved requested date, falling back when no evidence exists. Done tasks remain done; cancelled tasks reopen when needed; moving within the window cancels open redelivery. Domain tests cover existing start, NULL preservation, cancellation and applicability parity. Exact 60/61 and earlier/later cap boundaries were inspected in SQL, not separately executed as new runtime cases.
- **Server trades:** completion derives required trades from live server instances, captured asbestos answers and evaluated structural flags, unions device-supplied additional trades and permits no-trades confirmation only when derived trades are empty. Empty/lying touched_trades cannot suppress server-derived plumbing/electrical walks; the actual server check-11 regression passes. Tests also accept decided walks. No additional bypass demonstrated.
- **Refusal UI/evidence:** known codes have actionable wording; persistent conflict evidence records the expected refusal capture without overflow or console errors. Logs support the coordinator's successful fresh-phone, same-phone and injected-refusal close runs, but do not establish correct retry classification. No new visual session was started. Coordinator should verify the refusal remains stable across timer/foreground/online after fix 1 and run the real large-draft capture path after fix 2.

## Verification

Exact type-check: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?` — **exit=0**.

Full consult list plus both DB-role files and estimating-readiness-consult: **258/258 passed across 45 single files**, bootstrap first, remaining files sequentially, each via `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. No failures or killed processes. Cluster stopped afterward via `SJC_TEST_CLUSTER_TAG=consult-judge node scripts/test-db.mjs stop` → `stopped`. Two separate inline, tagged, non-DB probes reproduced findings 1 and 2; those observations are not included in the 258 suite count.

Files run:

- `tests/consult-access-db.test.mjs`
- `tests/consult-backend-integration-db.test.mjs`
- `tests/consult-completeness.test.mjs`
- `tests/consult-findings-db.test.mjs`
- `tests/consult-forms.test.mjs`
- `tests/consult-formula.test.mjs`
- `tests/consult-hints.test.mjs`
- `tests/consult-length.test.mjs`
- `tests/consult-mcp.test.mjs`
- `tests/consult-migration-bootstrap.test.mjs`
- `tests/consult-offline-db.test.mjs`
- `tests/consult-offline.test.mjs`
- `tests/consult-queue.test.mjs`
- `tests/consult-r1-copy.test.mjs`
- `tests/consult-r1-logic.test.mjs`
- `tests/consult-r10-design.test.mjs`
- `tests/consult-r10-domain.test.mjs`
- `tests/consult-r10-engineering.test.mjs`
- `tests/consult-r2-design.test.mjs`
- `tests/consult-r3-logic.test.mjs`
- `tests/consult-r4-design.test.mjs`
- `tests/consult-r4-logic.test.mjs`
- `tests/consult-r5-design.test.mjs`
- `tests/consult-r6-backend.test.mjs`
- `tests/consult-r6-design.test.mjs`
- `tests/consult-r7-design.test.mjs`
- `tests/consult-r7-logic.test.mjs`
- `tests/consult-r8-design.test.mjs`
- `tests/consult-r8-logic.test.mjs`
- `tests/consult-r9-design.test.mjs`
- `tests/consult-r9-domain.test.mjs`
- `tests/consult-r9-logic.test.mjs`
- `tests/consult-readiness.test.mjs`
- `tests/consult-scope-facts-db.test.mjs`
- `tests/consult-scope-facts.test.mjs`
- `tests/consult-seed-publication-db.test.mjs`
- `tests/consult-seed.test.mjs`
- `tests/consult-send.test.mjs`
- `tests/consult-snapshot-refresh.test.mjs`
- `tests/consult-sync-db.test.mjs`
- `tests/consult-todos-db.test.mjs`
- `tests/consult-ui-model.test.mjs`
- `tests/db-roles-manifest-db.test.mjs`
- `tests/db-roles-paths-db.test.mjs`
- `tests/estimating-readiness-consult.test.mjs`
