# Build R7 — Engineering judge

SCORES: design=8 completeness=8

Reviewed head `23d720f8fc59c27595367ec60b29eec3ba4c58e6`, commits `94e670cc`, `80a679eb`, `23d720f8`, the R6 engineering review, Phase 1 plan, and `/tmp/sjcqa/shots/consult-r7/log.json` and `log-b.json`. Review only; no code edits, commits, subagents, browsers or Next commands. Deferred audio/helpers/editor are not counted as missing.

## Required fixes

1. **P1 — Eligibility suppresses real flags. `lib/consult/flags.ts:15`.** Repro with the actual seed field `water.main_stack`: evaluate with `{main_stack:'Orangeburg'}` and no crack answer; result is `[]`, although the OR expression explicitly flags Orangeburg regardless of cracks. Likewise `era.year_override_reason` with `era.before_1978=false`, `house.year_built=1960`, and no reason returns `[]`: requiring the missing reason to be present makes its `not answered(reason)` warning impossible. Both reproductions ran in memory against the production evaluator. Device and server agree because they share this defect. Fix eligibility at expression/branch level: distinguish absent numeric/comparison inputs from intentional absence tests, preserve OR short-circuit semantics, and handle conservative unknown-year rules explicitly. Add regression coverage for these cases, not just blank forms and one toilet measurement.

2. **P1 — Server-origin conflict cannot supply its proposed choice. `lib/consult/ui/model.ts:147`, `components/consult/field/VisitScreen.tsx:179`.** Repro: open the seeded conflict on a freshly prepared browser, which has no local conflict receipt. `openConflicts` explicitly supplies `proposed.value=undefined` and fabricates `status='answered'`; the picker renders an empty length and labels it “this device” even though it came from another device. Picking it submits an answered payload without a value and fails validation. This is a logic defect, not merely copy. Return both immutable answer records in the authorized snapshot, map their actual values/status/units/device identity, and allow selection only once complete records exist. Verify picking each side from a new browser, including a skipped proposal and its skip metadata.

3. **P1 — SQL summary guard is overwritten by later migrations. `db/migrations/0075_in_home_consults.sql:314`, `db/migrations/0079_consult_seed_offline.sql:27`.** The new `summary_read_only` guard is added to the original function, but 0078 and finally 0079 replace that function without it. Repro on the fully migrated schema: call `consult_capture_answer` using a valid person capture context/device and a pinned closing.summary text operation; the effective function permits it without initials or a recorded refusal. The TypeScript batch rejects it, so the current HTTP path and its test pass, but the database command boundary does not enforce the promised invariant. Add the guard to the effective function through a forward migration and test a direct SQL command after all migrations. The server intentionally supports a recap with a recorded initials refusal too; “only with initials” must include that explicit alternative, not unrestricted summary typing.

4. **P1 — Skip-reason upgrade edits an applied migration. `db/migrations/0075_in_home_consults.sql:79`.** Repro: migrate a database at the prior build, then run the standard migrator at this head. `db/migrate.mjs:76` rejects the changed 0075 checksum; the new `Client absent` / `Joe sets the date` CHECK never reaches that database. Fresh QA/bootstrap tests mask this. Preserve applied migrations and use a forward migration to replace the CHECK and effective function. Test both fresh installation and upgrade from the prior migration ledger. Do not repair this by changing production ledger checksums.

5. **P2 — QA fixture creation is not idempotent. `scripts/qa-seed-consult.mjs:21`.** Each invocation generates a timestamp/random namespace and schedules two new visits. Repro: commit the seed twice for the same project; there are four fixture visits, not the original pair. A failed run can also leave published forms because `seedConsult` commits before the fixture transaction. Its consult records do use validated schedule/command/upload paths; no direct consult-row bypass was found. If this is to be the repeatable QA seed requested here, accept a stable explicit fixture key, reuse/verify the existing pair and upload receipts, and test two committed invocations. Keep any intentionally additive mode explicit.

## Requested checks and evidence

- **R6 Close fencing: fixed.** An attempt captures engine, memory epoch and token; lock invalidates ownership and resets the guard. Continuations check ownership after refresh, evidence, request persistence, close response and intent clearing. Clearing compares the durable request. An old finally cannot reset a newer attempt. Held success/failure replacement-engine regression tests pass. Refresh checks the epoch before handling authentication failures too. No remaining required Close fencing fix found.
- **Flags:** the supplied one-card 20-inch toilet evidence is consistent with the new device/server parity test; blank placeholders no longer raise that warning. This does not establish correct OR/negative eligibility; see fix 1.
- **Acknowledgment:** normal batch writes to summary are refused. Initials upload commits the displayed recap with its acknowledgment; the reason-skip path saves the displayed recap atomically. Upload replay/tamper tests pass. SQL enforcement remains incomplete (fix 3).
- **PIN wait:** `OfflineVault.checkPin` sleeps only up to its configured bound and then calls `unlock`, which re-reads the persisted retry deadline and verifies the lease before deriving the PIN key. It does not pre-check guesses during the delay, erase failures, or bypass the increasing backoff. No new timing/brute-force weakening found from this change. The existing read/modify/write counter is not a cross-tab serialized rate limiter; this round does not establish that stronger property. Accepted supplied evidence of right PIN immediately following wrong PIN.
- **Complete visit on a new device:** capture preparation deliberately returns `complete_locked` (`lib/consult/protocol.ts:373`), preserving the Complete generation. This is not an answer-locking logic defect. The red Get ready message is a navigation/copy shortcoming: route completed visits to the existing authorized office look-over instead of offering capture preparation. Do not unlock capture to fix it. No new-device offline Complete reader is demonstrated by these logs.
- **QA evidence limits:** logs record zero overflow/errors for successful captures, but also selector timeouts in the initial toilet/conflict attempts. The follow-up log records the corrected toilet and conflict-picker captures. Accepted the coordinator's Complete counts (245/245, 241 reason-skipped); this fixture exercises exclusions heavily and is not proof of a realistically measured full visit. No QA database connections were made by this review.

## Verification

Full consult list plus DB-role suites run individually and sequentially with the requested harness command and `SJC_TEST_CLUSTER_TAG=consult-judge`; bootstrap first. Type-check used exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: **exit=0**. Only the disposable tagged harness cluster was used and stopped afterwards. No live/QA database, forbidden file contents, service operation or app server was used. The requested review is the only repository file written.

**191/191 tests passed across 34 files; zero failures/skips.**

| File | Passed |
| --- | ---: |
| `tests/consult-migration-bootstrap.test.mjs` | 1 |
| `tests/consult-access-db.test.mjs` | 3 |
| `tests/consult-backend-integration-db.test.mjs` | 3 |
| `tests/consult-completeness.test.mjs` | 6 |
| `tests/consult-findings-db.test.mjs` | 9 |
| `tests/consult-forms.test.mjs` | 5 |
| `tests/consult-formula.test.mjs` | 3 |
| `tests/consult-hints.test.mjs` | 7 |
| `tests/consult-length.test.mjs` | 3 |
| `tests/consult-mcp.test.mjs` | 2 |
| `tests/consult-offline-db.test.mjs` | 4 |
| `tests/consult-offline.test.mjs` | 23 |
| `tests/consult-queue.test.mjs` | 5 |
| `tests/consult-r1-copy.test.mjs` | 4 |
| `tests/consult-r1-logic.test.mjs` | 6 |
| `tests/consult-r2-design.test.mjs` | 9 |
| `tests/consult-r3-logic.test.mjs` | 8 |
| `tests/consult-r4-design.test.mjs` | 4 |
| `tests/consult-r4-logic.test.mjs` | 20 |
| `tests/consult-r5-design.test.mjs` | 8 |
| `tests/consult-r6-backend.test.mjs` | 2 |
| `tests/consult-r6-design.test.mjs` | 11 |
| `tests/consult-readiness.test.mjs` | 2 |
| `tests/consult-scope-facts-db.test.mjs` | 4 |
| `tests/consult-scope-facts.test.mjs` | 2 |
| `tests/consult-seed-publication-db.test.mjs` | 1 |
| `tests/consult-seed.test.mjs` | 12 |
| `tests/consult-send.test.mjs` | 2 |
| `tests/consult-sync-db.test.mjs` | 4 |
| `tests/consult-todos-db.test.mjs` | 3 |
| `tests/consult-ui-model.test.mjs` | 6 |
| `tests/db-roles-manifest-db.test.mjs` | 6 |
| `tests/db-roles-paths-db.test.mjs` | 2 |
| `tests/estimating-readiness-consult.test.mjs` | 1 |
