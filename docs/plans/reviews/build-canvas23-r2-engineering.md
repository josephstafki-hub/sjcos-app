SCORES: design=9 completeness=8

Engineering judge, build round 2, `t3/canvas-phase2-3` at `12d0f9c5`, base `c922976b`. Reviewed the integrated implementation, round 1 findings, both handoffs, plan §§6.3–6.5/7/8/9/10 and coordinator round 2 summaries. Expectations below were recorded in this file before fresh execution. Only this review file was authored; fresh executable probes ran from stdin, using in-memory loader additions rather than editing tests or source. No commit, browser, Next server/build, dependency installation, live/QA database connection or service operation. The disposable harness cluster `c23-eng-r2-1106-2741` was stopped successfully (`stopCluster() === true`).

## Round 1 fixes verified

1. **Verified:** observer-before-connect and trailing-resize repros 12/13 now pass; both ends coalesce trailing measurements and dispose timers. Correlated print-layout replies, timeout/retry, overflow refusal and React height-commit ordering pass executed source tests. Actual browser/device printing remains the coordinator's release check.
2. **Verified:** original case 30 passes for owner and Projects-authorized staff templates; fresh edit/restore also preserves the edited document in the Before-restoring snapshot. Project save/restore passes; Canvas template pins remain refused.
3. **Verified:** typed deletion blocks retain authorized titles/links through TopBar, DesignsStrip and VersionsPanel without navigating on refusal. Multiple own references produce links; mixed/foreign/held/deleted references remain generic, and denied scope is checked before diagnostics.
4. **Implemented, concurrency incomplete:** floor uses the shared picker/confirmation and canonical Copy link, with server-computed edit labeling and no fake export. Cancel/focus return and failed-delete retry pass. Fresh duplicate-callback cases expose required fix 3 below.
5. **Snapshot race fixed, authorization/rollback incomplete:** actual publish/estimate actions now use the shared lock and immutable snapshot commands; original case 31 and edit/Canvas-ensure/web-restore contenders pass for owner and authorized staff. Selected-history scope authorization and estimate draft rollback still need required fixes 1/2 below.
6. **Verified:** declared subset IDs through 0114, exact production SQL/checksum ledger replay, page/floor lifecycle and no-op/replay/restore matrix, omitted Browser relations, and atomic missing-dependency refusal all pass. Fresh reversed-ID application/replay and 0114-first failure also pass.
7. **Verified:** final private-query audit passes 11/11 at this HEAD. Reviewed the seed's explicit positional `sjcos_qa_*` guard before connection/imports, connected-database identity check, outbound/deletion-authority isolation, and real named-principal MCP floor seeding. No mechanical blessing of unrelated sources.

## REQUIRED fixes

1. **P1 — Authorize explicitly selected historical publication.** `lib/actions/plan-publish.ts:213`, `:228` and `:76`. `assertFloorAccess` is inside the `versionId === null` branch. A selected matching snapshot goes through plain database readers in `resolveDesign` without the Projects/scoped-Leads check. Independent disposable-DB repro: active staff with Projects+Estimates but no Leads is refused automatic publication of a lead design, then succeeds with that design's saved `versionId`: `{ok:true,floorplanId:0,versionId:1}`, **zero access-helper calls**, one PDF-render seam call, and one real file-metadata row filed against the denied lead. PDF bytes/storage were mocked; no physical output or client send occurred. This corroborates the security judge's finding with real SQL.

   **Exact change:** lock and authorize the target design for both automatic and selected-version branches before resolving snapshot content, lead details, captures or output. Resolve the chosen snapshot under that authorization and require its design ID to match. Use the same authorized resolver for `renderPlanSheetsPdf` (`:188`) rather than leaving that entry point with the same bypass. Return a fixed unavailable result for denied scope. Add actual-action negative tests for Projects-only staff versus lead current/selected versions, plus authorized owner/Projects+Leads controls and foreign-snapshot refusal; denied calls must produce zero render/storage/file/publication effects.

2. **P2 — Make estimate authorization and initial draft/snapshot work atomic.** `lib/actions/plan-estimate.ts:118`, `:121`, `:132`, `:74`. The new locked `pinnedVersionFor` authorizes/validates after `generateEstimateFromDesign` has autocommitted a new estimate. Fresh case 20 injects failure immediately after the real snapshot INSERT: snapshot count correctly rolls back to zero, but **one newly-created estimate remains**. A separate no-fault repro using Projects+Estimates staff without Leads throws `CANVAS_UNAVAILABLE` yet leaves `Unauthorized fresh draft` persisted on the denied lead. Existing-target diagnostics also precede source authorization. The snapshot helper's rollback cannot undo the earlier pool INSERT.

   **Exact change:** begin the design-lock/access transaction before resolving/creating the target estimate or inspecting target-specific status; derive scope/title from that authorized locked design. Execute new-draft creation, snapshot selection and initial pin validation on that transaction, committing only when those steps succeed. Catch failures into the action's structured result, and roll back draft creation as well as snapshot writes. Add real-DB tests for denied Projects/Leads scope and injected snapshot/validation failure, asserting no new estimate, snapshot, line or output records; retain successful current/historical snapshot reuse and existing-estimate behavior.

3. **P2 — Fence duplicate shared Delete callbacks and stale completions.** `components/panel/CanvasPane.tsx:31`, `:39`, `:45–46`. Fresh cases 3/5 execute the real floor branch and confirmation handler with delayed network promises. Invoking the retained confirm handler twice before rerender issues **two DELETE requests with the same request ID**. Resolve request 2 successfully, then reject request 1 as a lost response: success removes the canvas and clears `attempt.current`, but the late catch overwrites the view with `DELETE_FAILED`. Its Try again button then makes **no request**, because both the selected data and attempt are absent. This is a stranded failure after a successful deletion, even though server idempotency protects the tombstone.

   **Exact change:** add a synchronous per-pane mutation-in-flight ref/operation identity before the first await, coalescing duplicate calls; only the current operation may publish success/failure or clear the retry attempt. Preserve the original request ID for a genuine failed-delete retry, clear the in-flight fence in a guarded finally, and disable/guard the confirm action while pending. Add executed component tests for duplicate confirm/onDelete callbacks, success followed by late rejection, and a genuine failure followed by successful same-ID retry. Completion and publication must happen once; an old failure must never overwrite success.

## Verification and limits

Every touched executable test file ran individually, together with the harness/fixture consumers and additional focused checks. **All 28 existing files pass, 535 tests total:**

| File (`tests/*.test.mjs`) | Passed | File | Passed |
| --- | ---: | --- | ---: |
| canvas-content | 58 | canvas-page-sandbox | 22 |
| canvas-routes | 22 | canvas-mcp | 40 |
| canvas-ui | 51 | canvas-commands-db | 21 |
| canvas-renderer | 7 | canvas-render-bridge | 29 |
| canvas-rollout-db | 9 | canvas-save-dialog | 30 |
| canvas-exports-db | 3 | canvas-floor-db | 17 |
| canvas-floor-adapter | 30 | canvas-classification | 8 |
| canvas-input-gates-db | 25 | canvas-integration | 33 |
| canvas-poll-history | 20 | canvas-project-search-db | 1 |
| canvas-provenance-db | 5 | canvas-retention-db | 1 |
| mcp-floor-tools | 12 | plan-ops | 8 |
| agent-profile | 14 | floor-actions-db | 36 |
| floor-ui | 13 | ask-private-query-scan | 11 |
| db-roles-manifest-db | 6 | db-roles-paths-db | 3 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **0**. Tests were single-file sequential runs with explicit harness URLs for database environment variables; subset tests retained their own explicitly minted URLs. No default/live connection was used. The rollout harness's own stub infrastructure is test-owned and cleaned up; no app/browser server was launched.

`node scripts/db-roles-scan.mjs --diff` exited 0. Its unannotated agent UPDATE entries remain `ai_conversations`, `dev_agent_runs`, `run_steers` and `leads`; the first three are known pre-existing findings, and the last is the known JOIN scan over-report for `FOR UPDATE OF d`. No grant expansion is warranted. The private floor reference table remains inaccessible to narrow identities; runtime role tests pass.

SQL/TS parity: repository INSERT scan finds the sole production snapshot INSERT in `lib/plan-version-writes.ts`; web publish/estimate/save/restore and MCP/Canvas allocation use it. SQL trigger allocation and the TS command lock the same design row. Hash lookup, backfill and insert validation use PostgreSQL jsonb hashing, with byte-equivalence checks on matches. Composite same-design references, immutable geometry/number/hash, retained scope and deferred reference-only payload guards agree with TS validation. Non-JSON page/diagram commits pass under 0114. No new manifest/grant change is needed for these fixes.

The full owner/staff designer workflow passes through real exported action source and actual SQL: project save/restore, automatic and selected-history publication records, estimate product lines/provenance/regeneration, unreferenced design/snapshot deletion, template save/restore/deletion, and refusal links. Fresh case 30 repeats the complete authorized project workflow. PDF rendering/storage and framework/authentication are controlled seams; this is not a claim of new visual, native printing or physical PDF verification. Authorization gaps for negative callers remain as documented above.

Fresh cases: **27/30 pass**. Cases **3 and 5** fail on the same Delete race; **20** fails on estimate draft rollback. All other numbered expectations pass. Supplemental selected-history authorization and denied-estimate probes independently reproduce required fixes 1/2. Early fresh fixtures needed actor reset before creating another user's thread, staff `business` profile instead of owner-only `operator`, and a fresh DB/actor budget rather than exhausting the 10-content/minute quota after the baseline suite. Those setup errors were corrected and cases 7/9/12/13 rerun successfully; they are not product findings. One initial supplemental assertion also needed shared VM Error identity to preserve the expected error string.

## Optional / coordinator follow-up

- Coordinator evidence supports frame shrink to 317/452 px, opaque routed frames, the production bridge hash `sha256-4a1ZQHgv3f5bQu9afS0L8iX8cAlbdz1LCjsAjnUyJlU=`, no Set-Cookie/external requests/leaks/overflow, foreign 404s, Load latest, floor menus and page retry. No screenshots or browser were generated here. The coordinator's incomplete Use this version script is **unverified browser coverage, not a product failure**; actual API restore/lifecycle tests pass.
- Retain device acceptance for Safari/iOS multi-page table/iframe printing, focus/Escape across menu-to-confirm transitions, 3D/WebGL disposal and full-designer return/unsaved edits. Recheck duplicate floor Edit menu/link presentation with the design judge. Keep the existing feature-off rollout until the required fixes and outstanding release checks pass.

## Fresh adversarial expectations

1. Picker can switch from a floor to a page with the selected version.
2. Floor Delete opens the shared confirmation; Cancel invokes no deletion.
3. Repeated Delete before rerender issues one request and one tombstone.
4. Failed Delete retries the same request ID without exposing the hidden floor.
5. Deletion success calls onDelete exactly once despite duplicate callbacks.
6. Owner project floor receives can_edit=true from server access checks.
7. Projects staff project floor receives can_edit=true.
8. Projects-only staff cannot read/pin a lead floor.
9. Projects+Leads staff can read/pin a lead floor and receives can_edit=true.
10. Templates remain unpinnable in Canvas despite full-designer template access.
11. Own active deletion references expose correct authorized Open canvas links.
12. Foreign references return only the generic deletion notice and no links.
13. Held/deleted references remain generic; revocation denies before diagnostics.
14. Owner template save/restore succeeds (r1 case 30).
15. Authorized staff template save/restore succeeds (r1 case 30).
16. Publish pins the live geometry after a competing edit wins the lock (r1 case 31).
17. Estimate pins the live geometry after a competing edit wins the lock.
18. Explicit historical publish renders the requested historical snapshot.
19. Publish snapshot insertion failure rolls back all new snapshot rows.
20. Estimate snapshot failure leaves no partial newly-created estimate.
21. Observer before handshake still produces initial connected height (r1 case 12).
22. Final resize within throttle window eventually reports final height (r1 case 13).
23. Parent burst coalescing delivers final height and disposal cancels trailing work.
24. Print ignores stale layout IDs, times out boundedly and can retry.
25. Print waits for a valid measurement and React height commit before dialog.
26. Child shrink clamps tiny content to 200 and large content to 8192 with overflow.
27. Child reports a real shrink after previous taller content.
28. Canvas-only rollout through 0114 replays exact ledger/checksums without Browser features.
29. 0114 missing-dependency failure is atomic.
30. Full owner/staff designer project save/restore/publish/estimate/delete remains functional.
