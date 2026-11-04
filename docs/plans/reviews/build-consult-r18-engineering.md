SCORES: design=10 completeness=10

# Build R18 — Engineering judge

Reviewed HEAD `69a43508` against R17's reviewed `8e3aeab8`, including `0d47d625` and the approved wording-marker changes. Re-confirmed 10/10. No required correctness, integrity, or security fix found.

## Required fixes

None.

## Focus findings

1. **Legacy kitchen pins retain their projections.** Completion (`lib/consult/protocol.ts`) and scope-facts export (`lib/consult/findings.ts`) both feed pinned module and template definitions into `pinnedDerivations`; neither substitutes the new kitchen template. Explicit recorded derive_cases take precedence over seed fallback, which requires exact module equality. Independently reconstructed the prior kitchen pin without `new_base_run`, `cabinet_base_run`, or `island_new_top`, retaining its prior island-top cases and cabinet formula. Some new, Keep, 264-inch wall and 72 × 36 island still produces 22 lf cabinetry and 64.75 sf countertop. Existing R17 legacy tests pass. Missing new fields create no new completion requirements on old pins. Export takes the same pinned template result and provenance, including after completion.
2. **Stale lead-test answers do not change the hidden-plan outcome.** The change does not mutate existing pins: a genuinely old pin retains its old question condition. For a current definition with a previously recorded answer and a plan other than Not needed, the stored answer remains available in scalar inputs; it is not erased or globally filtered. This is harmless here: completion excludes the question when its pinned required condition is false; the lead-plan advisory separately requires Not needed; the test field has no scope mapping and no own flag. Thus a hidden stale true or false answer neither creates an exported condition nor changes the advisory. Export's RRP applicability is independent of that answer. Returning to Not needed reuses the saved answer, which is then visible.
3. **Lead-plan flag remains correct.** Independent runtime probes covered all four plan choices crossed with missing/false/true negative-test answers. Only Not needed with missing or false evidence produces the advisory; all other plans produce none, even with stale answers. Existing disturbance/window-replacement regressions pass. The first standalone condition probe omitted `house.year_built` from its known-field set; after correcting the probe context, all 12 combinations passed.
4. **Some new, including zero, works.** Independent production-derivation assertions with `new_base_run=0`, whole-wall `base_run=264`, and a kept island retaining its top yield 0 lf cabinetry and 46.75 sf countertop. Zero survives formula evaluation and is an answered, valid completion value (the validator rejects null/empty string/empty arrays, not zero). The field has no positive-only range. The new cabinet pricing case uses the new run only for Some new; countertops retain the whole-wall run. Current regressions cover 120-inch new runs, both kept-top choices, new islands and legacy formulas.
5. **Role parity and wording markers.** `node scripts/db-roles-scan.mjs --diff` exits 0; all reported differences are intentional withheld permissions documented by the manifest, including consult command-only storage. Both DB role suites pass. The later commit changes approval markers/comments and docs, with no new execution path, table, trigger, or permission expansion.

## Verification

- All `tests/consult-*.test.mjs` plus `tests/db-roles-manifest-db.test.mjs` and `tests/db-roles-paths-db.test.mjs`: **354 passed, 0 failed, 0 skipped across 58 files**. Bootstrap ran first; every file ran alone with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test <file>`.
- Disposable harness cluster stopped after the suite. No live or QA database access.
- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: exit=0.
- Independent in-memory probes described above are additional to the suite tally.
- No source edits, subagents, builds, browsers, app servers, or service operations. No exit 137. Only this review file was written in the repository. Visual verification remains with the coordinator under the server rules.
