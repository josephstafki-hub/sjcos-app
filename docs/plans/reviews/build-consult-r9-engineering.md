# Build R9 — Engineering judge

SCORES: design=8 completeness=7

Reviewed `t3/in-home-consult-backend` at `f99b338c125430a9698fd463450d56182ecf4961`, both requested commits, R8 engineering review, and supplied R9 production log and relevant screenshots. Review only; no code edits, commits, subagents, browser/app servers, live/QA DB connections or forbidden file reads.

## Required fixes

1. **High — preserve accepted skip evidence across reopen and device changes.** `lib/consult/protocol.ts:75,265,292,299`; `lib/consult/ui/controller.ts:257,549`; `db/migrations/0075_in_home_consults.sql:436`. Repro: Complete the supplied fixture, reopen in the office, enroll a fresh phone, close without changing answers. Supplied `phone-43-own-close-result.png` shows 212 answer and 29 photo gaps. Reopen increments the generation but does not delete answer heads, skips or media. Snapshot returns only a `decisions` event in the current generation, never the existing `consult_close_evidence`. The fresh vault therefore starts with an empty draft. Its next evidence submission unconditionally replaces the server evidence row. Price-critical answer skips retain their reason/note in answer heads but lose their risk assumptions, so `countingSkip()` rejects them; photo skips live entirely in the evidence map and disappear from the effective close state. Trade decisions disappear too. **The close manifest does not overwrite answer state, and completion does not filter answer skips by device.** The seed writes the assumptions and photo skips to server close evidence (`scripts/qa-seed-consult.mjs:73–74`), not solely a device vault. It omits a decisions event, which exposes the hydration defect immediately; this is not an acceptable seed-only explanation. Real UI field skip assumptions also travel in the local projection alongside the answer op, and old-generation decisions become invisible after reopen. Fix: retain an authoritative, revisioned decision/evidence baseline across generations, hydrate new devices from it, and apply explicit edits/removals with conflict handling rather than replacing missing data with an empty draft. Preserve acknowledgement provenance and invalidate only evidence actually made stale. Add an end-to-end disposable-DB regression for seeded and UI-created skips: complete → reopen → fresh-device snapshot → unchanged close, asserting answer heads/media/assumptions/photo skips remain and completion does not regress. Also cover same-generation device handoff and intentional skip removal.

2. **Medium — make conflict ordering antisymmetric for equal timestamps.** `lib/consult/ui/words.ts:623`. Repro: same actor, two devices, identical `created_at`; invoke `conflictSideLabel(a,b)` and `conflictSideLabel(b,a)`. Both return “Abigail · 4:33 pm · earlier”, independently reproduced with the actual function and confirmed by the supplied office picker. It is not every same-minute pair: unequal millisecond timestamps order correctly. `<=` treats exact equality as earlier from both directions. The seed creates both answers inside one transaction; PostgreSQL `now()` defaults give them the same transaction timestamp (`db/migrations/0075_in_home_consults.sql:83`). JS millisecond conversion can also collapse finer timestamp differences. Fix: order by immutable server revision (with a stable ID tie-break), or use distinct neutral labels on ties; pass the ordering fields through all callers and test equal timestamps, submillisecond timestamps and reversed arguments. Never describe both as earlier.

3. **Medium — finish device/server real-start RRP parity.** `lib/consult/ui/model.ts:411`; `lib/consult/protocol.ts:303`; `lib/consult/rrp.ts:10`. Repro: visit Nov 3, work start March 10, firm/renovator certificates expire March 7. Server passes March 10 to `rrpFacts` and blocks; device calls it with only the visit date and says certificates are current. The new helper regression tests the four-argument helper, not the actual device call. Fix: include the project start day in the authorized snapshot/offline baseline and pass it into the device evaluation; refresh/invalidate that fact appropriately when the office changes the start. Add a model-versus-completion regression using identical captured facts and project start, including no start and certificate expiry between visit and start.

## Other requested checks

- **0081:** trigger function is `SECURITY DEFINER SET search_path = public, pg_temp`; it updates matching consult delivery work only, leaving done/cancelled items alone. Due date is seven calendar days before actual start at Central midnight. Existing `trg_work_items_snooze_until_due` fires on its due-date writes, holding later days until Central midnight and lifting the future snooze when moved to today/past. Manifest includes the work-items trigger note; `node scripts/db-roles-sql.mjs work_items` matches the three grants pasted in 0081. No new narrow-login approval permission introduced. This is source inspection plus standard suite coverage, not a separate runtime trigger timing probe.
- **Undo skip:** `components/consult/field/FieldRow.tsx:306` calls `actions.answer` with `status: cleared`; VisitScreen forwards it to `ctl.answer`, which commits an `answerOp` through the persistent queue and ordinary sync protocol. It is not a local-only answer removal. Stale draft metadata is ignored for a cleared answer by both model and server. Regression coverage should accompany fix 1 so intentional removal stays distinct from absent hydration.
- **Other R9 changes:** kept-toilet advisory versus moved-fixture code flags use shared evaluation; nullable-date closing lines, skip marks and Complete quantity text are covered by passing design/logic tests. No additional required engineering fix identified in these changes.

## Verification

Type-check used exactly `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: **exit=0**.

Full consult list ran one file at a time with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test`, bootstrap first, plus both DB-role files and estimating-readiness-consult. Only the disposable harness was used. Test counts follow below.

**223/223 passed across 38 files; zero failures/skips. Tagged cluster stopped after the suite.** Passing tests do not cover the cross-generation evidence hydration or actual device real-start call identified above.

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
| `tests/consult-r8-design.test.mjs` | 8 |
| `tests/consult-r8-logic.test.mjs` | 9 |
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
