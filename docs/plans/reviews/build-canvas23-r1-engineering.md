SCORES: design=8 completeness=7

Reviewed `c922976b..e6cb3693` on `t3/canvas-phase2-3`, including the named plan sections, shared-host/context contracts, both handoffs and coordinator QA logs. No source edits, commits, app servers, builds, browsers, live/QA database access or service operations. Only this review file was authored. Tests used `tests/_harness/testdb.mjs`, socket-only disposable cluster tag `c23-eng-r1-1106-943`; that cluster was stopped successfully.

## Verified fixes / what works

- Static pages reconstruct accepted HTML/CSS/SVG, reject resource/script/navigation/integration escapes, preserve original text separately, and canonicalize repeatedly without changing SVG local references. Fresh entity/delimiter, duplicate-property, nesting, length and reference attacks passed. Source text never joins the bridge script.
- The production bridge hash discrepancy is explained and verified, not a CSP failure. I extracted the actual emitted child function from `.next-qa-abc/server/chunks/1144.js` and `2818.js`: its 1,735-byte script hashes to **`y/zRPLRJ9JUt++slAdPaUk1vaafMl77Q5kQoWBggy04=`**, exactly the coordinator's response header. `lib/canvas-renderer.mjs:326–332` derives both script and hash from the same emitted function bytes. Executing those emitted bytes in an isolated Node VM produced authenticated `ready` and `height:1200` messages. This proves execution under the simulated protocol; browser enforcement evidence remains the coordinator's, not mine. A constant 600px is neither a deliberate maximum nor proof of a blocked script: the maximum is 8192, while the separate measurement race below is real. Including root scrollHeight also means a short document cannot report less than its current iframe viewport.
- Real session-backed routed preview refused another person's page with 404. Turning source off preserved owned preview and denied text source download. A currently rejected historical source was refused by HTML export. Static files omit the bridge and include a scriptless meta CSP; the changed exports tests exercise saved-file routes and immutable policy.
- Floor pins reuse immutable same-design geometry, CAS rejects stale revisions, concurrent ensures converge, no-op Load latest and its replay return changed=false without adding versions, and changed request-ID reuse is rejected. Canvas restore appends the historical reference while leaving live geometry unchanged. Existing project-design web save/restore works.
- Referenced snapshots/designs cannot be deleted, including retained tombstones. Scope changes and missing/malformed references are refused. Actual staff-session Projects revocation closes access. Lead access requires Projects plus Leads. Preview serialization strips catalog/selection identities, financial props, photos, underlays and related-design metadata; the full loader separately gates catalog, money, cost rules and estimate targets.
- 0114's nested procedural JSON cast fix works: ordinary non-JSON diagram and page source commits. A byte-count-correct floor source with extra geometry fails the deferred reference-only guard atomically. Snapshot hashing uses PostgreSQL jsonb encoding consistently in backfill, insert validation and TS lookup. Narrow identities cannot read floor references.
- A fresh Canvas-only subset through 0114 applied and replayed exact real migration checksums without 0101–0104. I used the existing harness callback's `apply([...114])`; the public fixture's declared-ID cap and missing persistent coverage still need the fix below.

## REQUIRED fixes

1. **P1 — Make page measurement and printing complete reliably.** `lib/canvas-renderer.mjs:308–313`, `components/panel/canvas/page-bridge.ts:15`, `components/panel/canvas/PagePrint.tsx:7–11`. Fresh case 12: invoke ResizeObserver at t=0 before connection, then connect at t=20ms; only `ready` arrives because the unconnected measurement consumed the throttle window. With no subsequent layout change, height remains the default 600 forever. Case 13: after an initial height, change content to 1400px at t=20ms; the callback is discarded and no trailing measurement is scheduled. The parent independently discards valid reports inside 200ms, including forced print-layout measurements. Print is enabled on `ready` alone and calls print after two animation frames without waiting for layout measurement. **Change:** do not consume measurement state before a port exists; force an initial connected measurement; coalesce throttled callbacks with a trailing timer on both ends, clearing timers on disposal. Wait for a bounded authenticated post-print-layout measurement and React height commit before printing, and keep Print disabled until a valid non-overflow measurement exists. Add scheduling tests for both observer/handshake orders, final resize inside the throttle interval and immediate print-layout after readiness; coordinator must recheck long/narrow tables and multi-page printing.

2. **P1 — Preserve existing template save/restore in the full designer.** `lib/actions/plan-designs.ts:190` and `203`. Fresh case 30 executes the actual web-action source against the harness: an existing `is_template=true` design opens under the new loader, but both `savePlanVersion` and `restorePlanVersion` return `{ok:false,error:'CANVAS_UNAVAILABLE'}`. The new `assertFloorAccess(user,d)` uses its default `allowTemplate=false`. **Change:** pass `true` at these two full-designer action checks (or use a separate full-designer access helper with that policy), while retaining template refusal for Canvas pins. Add real web-action DB regressions for owner and authorized staff template version saves/restores. Project-design cases must remain passing.

3. **P2 — Render the promised own-reference Open canvas links.** `lib/actions/plan-designs.ts:174–175` and `219–220`; callers include `components/floor/TopBar.tsx:267`, `components/floor/DesignsStrip.tsx:54`, `components/floor/inspector/VersionsPanel.tsx:102`. The preflight correctly computes authorized links, but both actions discard `block.links` and return only a string, so no caller can render the required links. **Change:** return a typed deletion-block payload and render each authorized title/link as Open canvas at these deletion entry points; retain the fixed generic notice and empty links for foreign, held, deleted or revoked references. Handle refusal without navigating away as though deletion succeeded. This is also an explicitly unfinished handoff item.

4. **P2 — Complete floor Canvas actions, including deletion.** `components/panel/CanvasPane.tsx:49`, `components/panel/canvas/floor/FloorCanvasPane.tsx:34–45`, `components/panel/canvas/floor/FloorCanvasStage.tsx:21`. The early floor branch bypasses the common canvas actions; its own menu contains only the designer link. There is no Copy link or Delete canvas entry/confirmation. People cannot delete an individual floor canvas through its pane, even while it blocks design deletion. **Change:** expose the canonical `/floor/<id>` Copy link and Delete canvas… entries, wiring deletion to the existing fenced/idempotent API and confirmation/Escape/focus/error behavior. Preserve screen-based Open/Edit labeling and omit fake HTML exports. Add action/confirmation tests that execute the floor branch.

5. **P2 — Finish the shared snapshot-writer migration required by §7.2.** `lib/actions/plan-publish.ts:212–218` and `lib/actions/plan-estimate.ts:73–85` still read geometry and insert snapshots independently of `lib/plan-version-writes.ts`. The new insert trigger serializes numbering but cannot validate an earlier detached read. Supplemental case 31 executed the actual `publishPlanVersion` source, interleaving a real live-doc update after its SELECT and before INSERT, then stopped before any PDF/file/publication operation: live rev=1 had the new note, while the supposedly current Published snapshot omitted it and had source_rev=NULL. This behavior predates the branch, but refactoring these discovered writers is an explicit Phase 3 acceptance item. **Change:** run their current-doc snapshot selection/allocation through the shared transaction command under the design row lock, with current validation/rev checks, and use its returned snapshot for subsequent work. Preserve intentionally selected historical versions. Add actual publish/generation snapshot races against Canvas ensure and web restore; no client send is needed for those tests.

6. **P2 — Land reproducible Phase 3 subset rollout coverage.** `tests/_harness/testdb.mjs:275` and `tests/canvas-rollout-db.test.mjs:1`. The fixture rejects declared migration 114 (`n<=112`) and the committed rollout tests never include it. My callback-based subset smoke passes, so this is a missing acceptance test rather than a demonstrated migration failure. **Change:** permit existing reviewed feature migrations through 0114 and add a persistent Canvas-only matrix exercising pages and floor show/update/no-op/replay/restore plus real ledger/checksum replay without 0101–0104. Assert omitted Browser relations stay absent and the floor migration's dependency failure is atomic. Do not modify/forge production ledger rows or checksums.

7. **P2 — Repair the private-query audit at the reviewed HEAD.** `tests/fixtures/ask-private-query-allowlist.json:229`. The real `ask-private-query-scan` run is **10/11**, with `Private SQL/guard source changed; review audit: scripts/qa-seed-canvas.mjs`. The final QA seed commit changed the source after its audit. **Change:** review the final seed's guarded QA target and actual MCP floor seeding, then update its source digest (and query entries only if required). Current source digest is `bb5d883a19b3f273b550444f7d261ce013f1270b0c49b0b5f8ab21a91ef51071`, versus recorded `f03b0f4c049081197c54dd64ee14853021452c519b611eba1c99da143ff54b2a`. Rerun the audit at the final commit. Do not mechanically bless unrelated changed sources.

## Verification record

Every changed executable test file ran separately: agent-profile 14, canvas-content 58, canvas-exports-db 3, canvas-floor-adapter 30, canvas-floor-db 16, canvas-page-sandbox 9, canvas-renderer 7, canvas-routes 22, canvas-ui 39, mcp-floor-tools 12, plan-ops 8 — all passing. The changed page-layout fixture is executed by content/sandbox tests; the changed private-query fixture fails as documented above.

Additional single-file checks: canvas-commands-db 21, canvas-render-bridge 29, canvas-retention-db 1, canvas-input-gates-db 25, canvas-rollout-db 7, db-roles-manifest-db 6, db-roles-paths-db 3 — all passing. `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited 0. Early role/rollout test runs incorrectly pinned the base harness DB through SJC_TEST_DATABASE_URL instead of letting their explicit per-case URLs take effect; after removing that override, both pass. No connection used a live/default database. Fresh cases 18/23/27 initially needed corrected error-code/fixture setup; final outcomes below are the corrected runs, not product failures.

`node scripts/db-roles-scan.mjs --diff` ran. No narrow grant to the new private reference table is needed or appropriate. Existing ai_conversations/dev_agent_runs/run_steers UPDATE findings are not new required fixes. The scan also reports agent leads UPDATE through the new lock helper: the scanner marks every JOIN as UPDATE whenever it sees FOR UPDATE, although this query explicitly locks **OF d** (plan_designs). That is a static-scan over-report, not justification to grant lead writes. Runtime role tests pass.

Fresh expectation outcomes: **27/30 pass**; cases **12, 13, 30** reproduce required fixes 1 and 2. Supplemental case 31 reproduces required fix 5. Node VM tests execute real source/emitted functions with controlled browser/auth seams; they are not claims of a new browser run. DB cases use actual SQL, actual web action source, real sessions and separate connections for the snapshot race.

## Optional / coordinator follow-up

- Preserve the existing feature-off rollout until required fixes and coordinator print/focus/WebGL disposal/full-designer return checks pass. Existing QA screenshots/logs are useful positive evidence for ownership isolation, CSP/no-cookie/no-external-request behavior and real geometry; they do not cover the scheduling or template regressions above.
- Add a historical pre-current-schema PlanDoc fixture to document the acknowledged normalization/deduplication behavior on first pin; do not rewrite immutable old snapshots.

## Expectations recorded before execution

Fresh adversarial expectations (30 cases):
1. Entity-encoded CSS escape is rejected.
2. Numeric entity attribute delimiter cannot create an event handler.
3. SVG namespace/integration escape is rejected.
4. Entity-encoded closing script stays inert text, with exactly one fixed script.
5. Duplicate style declarations are rejected.
6. Unresolved local SVG reference is rejected.
7. Two SVG roots retain distinct local IDs after repeated canonicalization.
8. Innocuous document envelope has idempotent canonical bytes.
9. Oversized CSS tracks/lengths are rejected.
10. Malformed HTML nesting cannot produce repaired active markup.
11. Preview hash equals the exact emitted bridge bytes; source never changes it.
12. ResizeObserver firing before handshake cannot lose the initial height report.
13. A resize inside the throttle interval eventually reports the final height.
14. Parent refuses sibling/null-origin spoofing and stale nonce/action messages.
15. Downloaded page has static meta CSP and contains no bridge.
16. Routed preview denies a different person's canvas.
17. Source-off still allows owned page preview, but refuses source download.
18. HTML export rejects source that current policy no longer accepts.
19. Floor ensure races allocate/reuse atomically and reject stale revisions.
20. Load latest at identical geometry is changed=false; same request replays without growth.
21. A reused request ID with changed input is rejected.
22. Canvas restore pins historical snapshot without changing live geometry.
23. Referenced design/snapshot deletion is blocked, including tombstones.
24. Revoked projects/leads/current scope closes floor access and suppresses private deletion links.
25. Preview strips catalog, money, file and related-design payloads; full loader independently gates sensitive props.
26. 0114 allows diagram and page source that is not JSON.
27. 0114 rejects missing/mismatched floor reference or embedded geometry atomically.
28. Canvas-only migration subset through 0114 applies/replays exact checksums without Browser migrations.
29. Existing full-designer explicit save/restore still works for project designs.
30. Existing full-designer explicit save/restore still works for templates.
31. Supplemental writer audit expectation, before execution: publishPlanVersion's automatic current-doc snapshot uses the shared lock/validation path and cannot pin a stale pre-lock read after a concurrent live edit.
