# Build R12 — Engineering judge

SCORES: design=9 completeness=9

Reviewed branch `t3/in-home-consult-backend`, HEAD `03ddd36a529b2b4126c24ed546f272322772701b`, the R11 engineering report, changes in `8d8f4b7e`, `cff2ee60`, `03ddd36a`, and supplied `/tmp/sjcqa/shots/consult-r12/log.json`. Review only: this is the only repository file written. No code changes, commits, subagents, browsers, builds, application servers, live DB access, or prohibited artifact reads.

## Required fixes

1. **Medium — the 64 KiB request guarantee does not cover indivisible values.** `lib/consult/ui/ops.ts:58`, `:65`; `lib/consult/evidence-chunks.ts:13`, `:21`. Repro: build ten trade walks with distinct short trade names, `needed:true`, and an 8000-character ASCII reason apiece. Both `decisionSchema` and `evidenceSchema` accept these values. A tagged inline probe using the real builders produced an **80,803-byte decision op**, rejected by enqueue as `batch_too_large`, and an **80,790-byte evidence command even before adding device/revision/hash envelope fields**. Arrays are copied whole; the chunk threshold only separates map entries. A sufficiently large individual skip assumption (especially multibyte text) has the same problem. The 64,578-byte regression is valid for its 500-character fixtures, not a worst-case bound over accepted values. Queue rejection occurs before durable save and has recoverable wording, so the old poisoned-queue failure is fixed; nevertheless, evidence requests can exceed the requested limit, and schema-supported trade decisions cannot be saved at that scale.

   **Fix:** bound complete serialized requests, including scalar arrays and individual map values. Either implement indexed/keyed trade patches and bounded item transport, or establish explicit input limits that fit one request (with recovery before accepting/saving the change). Apply the bound to evidence as well as ops. Add maximum-length and multibyte trade/assumption cases; assert actual serialized command bodies stay at or below 65,536 bytes. Keep the existing atomic save and clear semantics.

2. **Medium — delayed/retried reporting never displays its successful acknowledgement.** `lib/consult/ui/controller.ts:571`–`:574`; `components/consult/field/WrapClose.tsx:309`. Repro: refuse close with `conflict`, let the saved intent age past 30 minutes, then allow `report_close_failure` to succeed. The paused branch persists `notified:true` but never sets `closing.ownerNotified`. A tagged inline controller probe returned `{reports:1,durableNotified:true,closing:{step:"error",code:"conflict"}}`; therefore the screen omits “Joe has been told”. This also affects an immediate refusal whose first reporting attempt fails and later succeeds. Supplied forced-refusal screenshots exercise initial successful reports only.

   **Fix:** after a successful paused report, update the active controller state from the durable intent and set ownerNotified, retaining refusal code and field focus. Guard the asynchronous update against lock/dispose/abandon or a replaced intent. Restore the acknowledgement when reopening an already-notified paused intent. Add delayed-conflict and failed-then-successful reporting tests.

## Prior findings and requested checks

- **R11 item 1:** fixed for automatic close replay. Non-transient refusals persist `paused`, and resume entry points return without another close POST. Retry timers now use `closeTimer`, which abandon/success clear. Conflict/stale wait until 30 minutes from the original intent before reporting; other non-transient refusals report immediately. Transport failures retain request identity and retry with backoff, escalating at 30 minutes. The pause tests pass. Required fix 2 concerns the acknowledgement shown after delayed reporting, not escalation delivery.
- **R11 item 2:** fixed for the demonstrated 603-skip/500-character case. Decision patches carry explicit map clears and are captured with their projection in one durable transaction. IDs/sequences survive retry; server receipts bind operation hashes, and a lost acknowledgement can replay with the same or a fresh batch nonce without duplicating accepted effects. Revision/generation preconditions remain enforced. Existing sync tests exercise replay and transactional rollback. The 1,800,000-byte draft boundary rejects before replacing saved state. Remaining maximum-item issue is required fix 1.
- **Evidence crash/retry:** intent durably retains original evidence/hash and marks evidence started before sending. On resume, refresh obtains the committed baseline; a changed baseline must match a deterministic prefix of the intended patch chain, otherwise it refuses as evidence_conflict. Remaining patches are diffed against that baseline. Server writes check exact revision/hash and run transactionally; equal replacement is a no-op. Close request is saved before sending and retained for ambiguous retries. No additional demonstrated crash/idempotency defect found by inspection. The chunk regression exercises merging/prefixes, not a full process-kill controller recovery test; do not overstate that coverage.
- **Required nulls:** first evidence now sends ack_reason:null and promised_date:null rather than dropping them. The real POST first-evidence regression passes and closes; supplied phone/tablet `*-29` log entries have no console errors or overflow. The supplied outcome is Needs finishing, consistent with a successful server close rather than claiming every field is complete.
- **Validation privacy:** route details contain Zod issue paths/codes/messages, not raw input or database records. Evidence authorization precedes parsing/merging saved evidence; snapshot first invokes the scoped SQL read gate before consulting decision history. Paths for record keys are caller-supplied or from that authorized visit. No cross-user data disclosure found in these paths. Request-envelope validation before authorization operates on caller input only.
- **0085:** SECURITY DEFINER and fixed `public, pg_temp` search_path retained. Redelivery dates clamp to Central calendar start minus 60 through start minus 7; NULL start returns without erasing dates, done tasks stay done, cancelled tasks reopen only when needed. Generated narrow-role grants are present and the manifest records the path. UI min/max and clamp complement the database reconciliation.
- **Buttons:** invalid_command routes to Before you wrap, owner_required to Trade walks, device refusal offers Keep working, signed_out links to login with a return URL. Field paths feed refusalFocus. The supplied log records all four button follow-ups without console errors/overflow; no new browser session was opened.

## Office to-do wording investigation

Read-only SELECTs used only the explicitly allowed QA database at localhost:5499/sjcos_qa_consult. The task source is `f23fb365-4376-49b2-ad9d-a47c94bc3895:close_failure:visit`; its body is **Close refusal code: signed_out**, status **done** after the successful close. Its audit events, in order, are invalid_command (19:54:47), owner_required (19:55:04), device_access_denied (19:55:20), signed_out (19:55:37), all on 2026-11-03 Central.

`lib/consult/protocol.ts:513`–`:516` deduplicates by visit source and then overwrites the existing title/body with the newest refusal. `officeCloseFailure` specifically maps invalid_command to the promised Before you wrap wording; signed_out intentionally uses the generic fallback. Therefore the observed generic title is **not a defect in invalid_command mapping**: it reflects the latest of four codes on one deduplicated task. Earlier reasons remain in consult_events. Successful close marks the task done.

## Verification

Type-check: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?` — **exit=0**.

Full consult list plus both DB-role suites and estimating-readiness-consult: **277/277 passed across 48 single test files**, zero failures. Bootstrap ran first, all other files sequentially using `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. Cluster stopped afterward using `SJC_TEST_CLUSTER_TAG=consult-judge node scripts/test-db.mjs stop` → `stopped`. No killed processes. Two additional tagged, non-DB inline probes reproduced required fixes 1 and 2; they are not included in the suite count.

Per-file pass counts:

- `tests/consult-migration-bootstrap.test.mjs`: 1 passed
- `tests/consult-access-db.test.mjs`: 3 passed
- `tests/consult-backend-integration-db.test.mjs`: 3 passed
- `tests/consult-completeness.test.mjs`: 6 passed
- `tests/consult-findings-db.test.mjs`: 9 passed
- `tests/consult-forms.test.mjs`: 5 passed
- `tests/consult-formula.test.mjs`: 3 passed
- `tests/consult-hints.test.mjs`: 7 passed
- `tests/consult-length.test.mjs`: 3 passed
- `tests/consult-mcp.test.mjs`: 2 passed
- `tests/consult-offline-db.test.mjs`: 4 passed
- `tests/consult-offline.test.mjs`: 23 passed
- `tests/consult-queue.test.mjs`: 5 passed
- `tests/consult-r1-copy.test.mjs`: 4 passed
- `tests/consult-r1-logic.test.mjs`: 6 passed
- `tests/consult-r10-design.test.mjs`: 9 passed
- `tests/consult-r10-domain.test.mjs`: 5 passed
- `tests/consult-r10-engineering.test.mjs`: 4 passed
- `tests/consult-r11-design.test.mjs`: 11 passed
- `tests/consult-r11-engineering.test.mjs`: 4 passed
- `tests/consult-r11-fixes.test.mjs`: 4 passed
- `tests/consult-r2-design.test.mjs`: 9 passed
- `tests/consult-r3-logic.test.mjs`: 8 passed
- `tests/consult-r4-design.test.mjs`: 4 passed
- `tests/consult-r4-logic.test.mjs`: 20 passed
- `tests/consult-r5-design.test.mjs`: 8 passed
- `tests/consult-r6-backend.test.mjs`: 2 passed
- `tests/consult-r6-design.test.mjs`: 11 passed
- `tests/consult-r7-design.test.mjs`: 7 passed
- `tests/consult-r7-logic.test.mjs`: 8 passed
- `tests/consult-r8-design.test.mjs`: 8 passed
- `tests/consult-r8-logic.test.mjs`: 9 passed
- `tests/consult-r9-design.test.mjs`: 4 passed
- `tests/consult-r9-domain.test.mjs`: 5 passed
- `tests/consult-r9-logic.test.mjs`: 4 passed
- `tests/consult-readiness.test.mjs`: 2 passed
- `tests/consult-scope-facts-db.test.mjs`: 4 passed
- `tests/consult-scope-facts.test.mjs`: 2 passed
- `tests/consult-seed-publication-db.test.mjs`: 1 passed
- `tests/consult-seed.test.mjs`: 12 passed
- `tests/consult-send.test.mjs`: 2 passed
- `tests/consult-snapshot-refresh.test.mjs`: 4 passed
- `tests/consult-sync-db.test.mjs`: 4 passed
- `tests/consult-todos-db.test.mjs`: 3 passed
- `tests/consult-ui-model.test.mjs`: 6 passed
- `tests/db-roles-manifest-db.test.mjs`: 6 passed
- `tests/db-roles-paths-db.test.mjs`: 2 passed
- `tests/estimating-readiness-consult.test.mjs`: 1 passed
