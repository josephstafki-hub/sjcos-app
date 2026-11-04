# Build R15 — Engineering judge

SCORES: design=8 completeness=8

Reviewed HEAD `04b07e00daca722e2ae6c28f353f4d3b4465c387`, `git show 1dc74373 6c209472 04b07e00`, R14 engineering review and `/tmp/sjcqa/shots/consult-r15/log.json`. This file is the only repository write. No code edits, commits, subagents, browsers, app servers, builds, live DB connections or prohibited artifact reads.

## Required fixes

1. **High — Legacy multi-template visits lose their room quantities.** `lib/consult/derive.ts:13`.

   **Repro:** call `pinnedDerivations` with the old pinned room module (no `part_of` field), bathroom and kitchen templates, and a room with answered 120-inch length and width. Both templates' `room.floor_area` projections return `{value:0,instance_ids:[],answer_revisions:[]}` instead of preserving or explicitly refusing to classify the existing 100 sf. Reproduced with a tagged inline pure probe. The filter applies to all pinned versions, but old visits cannot answer a field absent from their immutable pin. The new membership UI and completion requirement only exist when the pin contains that field. Existing completed visits can therefore export changed quantities without being edited.

   **Fix:** gate membership filtering on the pinned module's capability and define an explicit legacy policy. Preserve the old projection for old pins, or require a supported migration/reclassification workflow that retains audit evidence; never treat unclassifiable measured rooms as valid zero contributions. Add old-pin combined-visit coverage through completion and scope-facts export, plus a check that exported quantities agree with the intended per-template sums.

2. **High — Direct SQL ignores the door/window component ranges.** `db/migrations/0084_consult_multi_validation.sql:35` (latest `consult_capture_answer` replacement); pinned definitions at `lib/consult/forms/seed/shared.ts:153` and `:187`.

   **Repro:** in the tagged disposable harness, publish and pin a door module with the actual seed limits `range:[18,96], component_ranges:[[18,72],[72,96]]`, create its instance, and call `consult_capture_answer` with the assigned visitor's signed `capture_answer` context and `[90,20]`. It returns `code:'accepted'` and persists an answer. Both components fit the broad fallback range, but neither fits its own component range. The protocol correctly rejects these values; SQL does not. The older 0078 function checked component ranges, but subsequent replacements dropped that guard.

   **Fix:** restore the indexed `component_ranges` check in a new migration while preserving all current guards, SECURITY DEFINER and fixed search_path. Test direct SQL and protocol boundaries for door width/height and window width/height, with no answer/head/revision mutation on rejection.

3. **Low — The full consult suite is red after the advisory change.** `tests/consult-r11-design.test.mjs:156`.

   **Repro:** `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test tests/consult-r11-design.test.mjs` passes 10 and fails 1. The source assertion demands `officeFlagText(f.issue, f.hint)` while the component now correctly passes `f.kind` as its third argument.

   **Fix:** update the stale assertion for the intended three-argument contract, preferably relying on rendered behavior proving advisory wording and absence of a decision row. Retain the correct implementation and rerun this file.

## Requested boundary checks

- **Apply findings:** Joe's decision supersedes the R14 owner-only recommendation. HTTP forwards `apply_findings`; `command` re-mints the `apply` operation and calls SQL verification, without an owner-only restriction. Direct `reconcileConsultFindings` verifies that same operation and requires person mode. SQL verification checks current active user, matching role, staff projects permission and a nonrevoked assignment. Assigned visitor and active owner are allowed; unrelated/revoked staff are denied. The R14 logic regression exercises command and direct service success for staff/owner and denial for other staff without application writes. Despite its title saying HTTP, that test invokes the command service, not a real HTTP request. No separate SQL apply command exists; the SQL context verifier is the shared authorization boundary.
- **Reopen:** protocol retains the owner requirement and latest SQL `consult_reopen` independently requires an active owner/person and a nonempty reason, with revision/lifecycle checks. Access tests cover SQL and command staff denial, stale owner revision denial and owner success. The generic SQL context verifier alone intentionally permits assigned staff; the reopen function supplies the owner restriction.
- **RRP route:** `app/api/consult/[id]/route.ts:11` accepts the new command. Claims use `operation:body.command`, so the minted operation matches both protocol and SQL `record_rrp_delivery` checks. Session, projects permission, CSRF, origin and JSON checks remain. Authorization is assigned active visitor or active owner/person, not arbitrary project staff and not agent mode. Tagged real-command probes confirmed assigned/owner success and unrelated-staff denial. Strict protocol validation requires hand/mail, an actual ISO calendar day, and optional boolean redelivery; SQL independently rejects invalid methods, missing/future dates and non-person mode, and requires an existing delivery task. Invalid February 30 was refused with ZodError. SQL completion records the supplied day/method, then reconciles the start window. No owner-only requirement for delivery was supplied; none is inferred here. This is source review plus command/SQL evidence, not a live HTTP test.
- **Membership:** new-pin combined rooms require membership; single-template rooms hide it and all rooms count. The new regression proves 40 sf bathroom and 168 sf kitchen projections, 208 sf for the single-template case, and 43.5 sf backsplash including only the range wall's extra height. Legacy compatibility fails as above. This is not a blanket proof of every combined-template aggregate.
- **64 KiB:** queue construction caps individual ops and batches at 64 KiB minus a 512-byte envelope reserve; offline tests include bounded evidence splitting and multibyte cases. This remains the client-generated sync request bound. HTTP transport and protocol accept ops up to 256 KiB, and evidence has a larger allowance; there is no universal streaming 64 KiB HTTP body cap. No new requirement beyond the previously documented client bound is assumed.
- **Ranges:** service checks canonical numeric values and per-component bounds; existing length/parser and out-of-range tests pass. SQL scalar/fallback pair ranges remain, but component bounds fail as above.
- **Production evidence:** supplied log records the Complete, offline/reclose, field-refusal and note-clear flows with zero recorded horizontal overflow. It also records disabled Close click timeouts for the conflict fixture and selection-image 404 URLs. The trade day was seeded into close evidence, so those screenshots do not prove the scheduling write path. No independent visual verification was performed.

## Verification

Type-check used exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: **exit=0**.

**Final per-file results: 308 passed, 1 failed across 54 files.** All consult files plus both database-role suites and estimating-readiness-consult ran one at a time with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`. The first alphabetical pass reported 307 passed / 2 failed: the bootstrap test expects a cluster without narrow roles and was run after other tests had provisioned them. After stopping that cluster, its isolated rerun passed 1/1. The sole remaining failure is required fix 3. No killed process or exit 137 occurred.

Extra probes are separate from suite counts: legacy projection, direct SQL component-range acceptance and RRP authorization/calendar validation. An initial probe attempted to change a published harness form and was correctly refused by the immutable-definition guard; the successful range probe instead published a new pinned module. All probe writes were confined to the disposable tagged harness. Both suite and probe clusters were stopped afterward.

Per-file results (bootstrap reflects isolated rerun):

- `tests/consult-access-db.test.mjs`: 3 passed
- `tests/consult-backend-integration-db.test.mjs`: 3 passed
- `tests/consult-completeness.test.mjs`: 6 passed
- `tests/consult-findings-db.test.mjs`: 9 passed
- `tests/consult-forms.test.mjs`: 5 passed
- `tests/consult-formula.test.mjs`: 3 passed
- `tests/consult-hints.test.mjs`: 7 passed
- `tests/consult-length.test.mjs`: 3 passed
- `tests/consult-mcp.test.mjs`: 2 passed
- `tests/consult-migration-bootstrap.test.mjs`: 1 passed
- `tests/consult-offline-db.test.mjs`: 4 passed
- `tests/consult-offline.test.mjs`: 23 passed
- `tests/consult-queue.test.mjs`: 5 passed
- `tests/consult-r1-copy.test.mjs`: 4 passed
- `tests/consult-r1-logic.test.mjs`: 6 passed
- `tests/consult-r10-design.test.mjs`: 9 passed
- `tests/consult-r10-domain.test.mjs`: 5 passed
- `tests/consult-r10-engineering.test.mjs`: 4 passed
- `tests/consult-r11-design.test.mjs`: 10 passed, 1 failed
- `tests/consult-r11-engineering.test.mjs`: 4 passed
- `tests/consult-r11-fixes.test.mjs`: 4 passed
- `tests/consult-r12-design.test.mjs`: 6 passed
- `tests/consult-r12-logic.test.mjs`: 6 passed
- `tests/consult-r13-design.test.mjs`: 7 passed
- `tests/consult-r13-logic.test.mjs`: 3 passed
- `tests/consult-r14-design.test.mjs`: 6 passed
- `tests/consult-r14-logic.test.mjs`: 4 passed
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
