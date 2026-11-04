# Build R8 — Engineering judge

SCORES: design=10 completeness=10

Reviewed branch `t3/in-home-consult-backend`, head `44c52288`, commits `a4dcce49`, `a75e8e71`, `44c52288`, the R7 engineering review, the in-home consultation plan, and supplied R8 logs. Scores cover the implemented Phase 1; deferred audio, helpers and form editor are not missing requirements.

## Required fixes

None found.

## R7 items 1–5

1. **Flags fixed.** `lib/consult/flags.ts` now evaluates eligibility recursively per expression branch. Orangeburg without a crack answer and a missing year-override reason both raise the expected flag; blank forms do not. The regressions pass, alongside the shared device/server evaluation tests.
2. **Conflict values and provenance fixed.** `lib/consult/protocol.ts:snapshot` first obtains an authorized `consult_read`, then fetches both immutable conflict answers restricted to that consult and unresolved conflict IDs. The payload includes actual status, value, units, skip metadata and source identity. Device and office pickers suppress unavailable sides. No cross-consult read or newly unauthorized viewer path found. The backend test confirms fresh-snapshot proposal value and source labels; supplied production evidence shows both values with sources. Skipped-side handling was inspected in the model, rather than independently browser-tested.
3. **Effective SQL summary guard fixed.** Forward migration 0080 installs the guard in the final `consult_capture_answer`, preserving the derived-field and visit-context protections from 0079. Direct SQL summary bypass is rejected by the backend regression after all migrations. Acknowledgment/refusal paths remain separate authorized commands.
4. **Forward migration fixed.** 0075 is restored byte-for-byte to its original version (`git diff 3d4ec349 HEAD -- db/migrations/0075_in_home_consults.sql` is empty); 0080 changes the skip CHECK and effective function. Supplemental disposable-harness upgrade probe: load fresh schema; retain its full consult-function/constraint signature; reconstruct pre-0080 using the exact 0079 capture function, original skip CHECK and ledger without 0080; run the standard migrator with its explicit harness URL. It identifies only 0080 as pending and produces an identical signature to fresh install. No production ledger checksums were changed. This probe reconstructs the pre-0080 schema; it does not upgrade an external historical database backup.
5. **Fixture reuse fixed.** Stable explicit/default fixture keys, project scoping and an advisory transaction lock reuse the original Complete/conflict pair. Two calls are covered by the backend test and return the same IDs. Supplied fresh-QA evidence also reports the stable pair. Form publication remains its own idempotent seed operation; fixture creation uses the validated protocol/upload paths.

## Focused engineering checks

- **Nullable date and skip close:** evidence schema accepts null; client serialization, wrap check and server completeness agree on the recorded date skip. The backend test completes the null-date fixture and verifies the owner task says to set the formal estimate date, with no invented due date. Ordinary dates remain validated. Renovate Right redelivery uses `evidence.rrp.redelivery_day`, independently of the nullable estimate date (`lib/consult/protocol.ts:340`); the common task writer converts that day to Central midnight. The general task/date tests pass; no separate new RRP task runtime probe was added.
- **Transient close:** 408, 429 and 5xx map to the calm timeout state with bounded retry. The only active transport deadline is 15 seconds in `deadlineFetch`, covering response-body consumption and transports ignoring abort; the old close timer has no scheduling assignment. Close token/engine/epoch checks continue fencing stale continuations. Supplied 45-second held-close evidence is consistent with Still closing followed by settlement. Tests for transport, retry, held replacement engines and wording pass.
- **Complete screen authorization:** `/consult/[id]` still requires projects access and active assignment before rendering boot data; an unassigned owner redirects to the authorized office page, and other unassigned users get not-found. The Complete branch only replaces Get ready after this gate. Its Look over link is therefore shown to an assigned visitor, who is permitted by the destination's owner/assignment/conductor check and subsequent authorized snapshot read. No capture unlock, answer mutation, or authorization bypass found. This is a calm online Complete landing screen; it is not evidence of a newly prepared offline Complete vault.
- **Evidence limits:** supplied logs include successful zero-overflow/error captures plus a selector timeout in the follow-up toilet attempt. These logs and the coordinator's held-close report were read as supplied evidence; no browser, application server or QA/live database was opened by this judge. No claim of independent visual verification.

## Verification

**206/206 tests passed across 36 files; zero failures/skips.** All files ran individually and sequentially with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test tests/<file>.test.mjs`, bootstrap first. Type-check ran exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: **exit=0**. Supplemental upgrade signature probe: **passed**, using only the same tagged disposable harness. Cluster stopped after the suite and again after the probe.

No code edits, commits, subagents, Next commands, browser/app servers, service operations, live/QA DB connections, or forbidden file reads. This review is the only repository file written.

| Test file | Passed |
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
| `tests/consult-r7-design.test.mjs` | 7 |
| `tests/consult-r7-logic.test.mjs` | 8 |
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
