SCORES: design=9 completeness=9

Engineering judge, build round 6. Reviewed the whole fix diff `5e97c12e..6c82d5aa` at backend HEAD `823a273c1fdd9447f39f540f5e5645de2bd12473`; the intervening HEAD commit contains R5 reports only. Phone checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` is unchanged and clean at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`. The R5 engineering cleanup requirement is fixed. One new Ops preview regression needs correction. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — recorded before execution

Use isolated QA PostgreSQL, real DAL/JWT/actions and fake providers. Denial must preserve approval state, snapshots, receipts, decision events, intents and sends. All expectations below precede executable probes.

1. A staff database row with a cryptographically valid cookie claiming owner, plus Engine/Today permissions, must still be refused across all eight work-item approval/rejection routes and all direct/popup decision resolution routes.
2. An owner cookie for an inactive owner row must be refused across those routes without mutations.
3. An owner cookie whose user row was deleted must be refused across those routes without mutations.
4. An expired signed owner cookie must be refused across those routes without mutations.
5. Missing and malformed session cookies must be refused across those routes without mutations.
6. A valid staff session with every internal permission must still be refused across those routes.
7. Client and subcontractor database roles with forged owner-role cookies must be refused across those routes.
8. Database demotion of an owner to staff must immediately cover Reject, Decline and Request changes as well as Approve, including popup decisions.
9. A database promotion to owner must be honored despite a still-valid staff-role cookie; a bound Engine approval must send exactly the displayed draft once.
10. An owner with no explicit area permissions must retain Engine, lead/project Ops and pending-card approve/reject behavior.
11. For each owner work-item Approve route, swap in another item's genuine binding and then omit the binding: refuse both; the original displayed binding must subsequently approve exactly once.
12. Render owner Engine and Ops internal cards whose identical draft box is suppressed: retained Approve handler must submit the same displayed item's binding; staff must have neither Approve nor Reject. Email and portal previews must remain visible.
13. Render internal Ops content longer than two lines, including different receipt content: suppression must not conceal the sole readable draft content required to review the approval; different content must retain its preview and binding.
14. Seed an unrelated portal outbox/app-message pair before portal regression execution: fixture cleanup must preserve it, while removing every fixture cap/portal outbox and child. Repeat execution on the same database must pass and remain clean.
15. Inject an unexpected error into portal fixture cleanup: the unchanged test must report failure rather than swallow it; removing the injection must allow two consecutive clean runs.

## REQUIRED fixes

1. **Medium — retain a readable full internal draft when suppressing its duplicate preview in Ops.** `components/engine/RecordOps.tsx:205` always renders the work-item body with `line-clamp-2`; line 206 now suppresses `WorkItemDraft` whenever a headerless draft is a prefix of that body. For an internal approval with a long body matching its draft, the only remaining copy is clamped, with no expand control or per-item details link, while Approve remains available. Previously the separate draft box supplied the scrollable full preview. This affects both lead and project Ops.

   Reproduction: create a requested/approval_needed work item with a 543-character internal plan (eight steps) and a draft receipt containing that same plan. The real `getRecordOps` returns an approval item with `body === draft.body`, no To/Subject and a valid binding. The unchanged card function produces zero draft boxes and exactly one body node, whose class is `mt-0.5 line-clamp-2 text-label text-ink-3`; its owner Approve button remains present. The case also occurs without a receipt, when the preview falls back to the work-item body. This is a read/approval usability regression, not a binding substitution or unauthorized client send: the correct binding is still submitted, and internal approval sends no email.

   Make the remaining approval text expandable or unclamped when its separate preview is suppressed, or retain the scrollable preview for long content. Preserve the duplicate-box improvement for short internal cards and the current binding. Add coverage for long matching bodies on lead/project Ops, staff-hidden controls, and unchanged email/portal previews. Engine details already render their body without a clamp and do not have this problem.


## R5 requirement: fixed and independently verified

- Ran every `portal-*.test.mjs` and `phone-push-*.test.mjs` twice, sequentially, on the **same migrated per-file database**. No drop/recreate or migration reset occurred between runs. All 19 files passed both runs with zero skips. `phone-r1.setup` retains its committed fixture TRUNCATE; it no longer requests a fresh database. This preserves schema/FK repeatability while clearing its own file fixtures.
- `portal-telegram-db` passed 3/3 twice with app alerts explicitly enabled. Its app-message channel/body assertions remain and pass. Cleanup now removes delivery/action children, app messages, then outbox parents, scoped to this fixture; its `finally` does not swallow errors. The portal approval test also stopped swallowing its cleanup failures.
- Fresh case 14 additionally seeded an unrelated portal outbox/app-message pair. Both subsequent runs preserved that pair and left **zero** cap/fixture portal parents and **zero** fixture app-message children. This verifies that the cleanup no longer deletes all portal outbox rows.
- Fresh case 15 installed a temporary database BEFORE DELETE trigger that raised `R6 injected cleanup failure` for the fixture app-message row. The **unchanged** portal test visibly failed its third case with that exact error (2 passed/1 failed), proving unexpected cleanup failure is loud. Removed the trigger/function, then ran the unchanged file twice on the same contaminated database: both passed 3/3, preserved the unrelated pair and left fixture counts 0/0. The deliberately failed fault run is separate from the ordinary passing totals below.

## Whole-diff correctness

**Authorization uses the real DAL.** Engine Approve/Reject call `requireAccess("engine")` and then check the returned database user's owner role before claims or mutations. Lead/project Ops Approve/Reject do the same with `requireAccess("today")`. `approveWaiting` and `declineWaiting` check `getCurrentUser` before parsing/routing either work-item or decision keys. Direct decision Approve/Reject/Request changes share the new `isOwner(sessionPrincipal())` check before the transaction. `sessionPrincipal` delegates to `getCurrentUser`; that DAL verifies JWT/session revocation, active user and the database role. No submitted role, page prop, JWT role claim or UI visibility flag supplies approval authority.

The committed R5 test exercises this real chain with only Next request/cache/navigation adapters replaced. It covers staff, revoked owners, active owners, database demotion, polling and exact stale-copy behavior. Both 15/15 runs pass. Independent cases 1–11 extend it to forged role claims, all staff area permissions, missing/deleted/inactive/expired identities, promotion despite a stale JWT role, all decline/change paths and cross-item/missing bindings. Every denial preserves the work-item/decision row, snapshot/receipt/event/intent counts and outbound sends. Owner approvals still dispatch exactly the displayed draft once; repeated approvals do not send twice.

**Next.js 16.2.9 conventions are respected.** Read installed `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`, `use-client.md`, `01-app/02-guides/data-security.md`, and the `revalidatePath` reference. The relevant action modules retain their file-level `"use server"` and async runtime exports; authentication and authorization occur inside callable actions, not only in page/layout code. Revalidation stays server-side. The client draft renderer uses an `import type` for its server-shaped DTO. The added page props are serializable booleans derived from the real viewer. No new API incompatibility or server/client data import was found. CLI adapters do not certify production bundling or framework POST/origin processing.

**Owner controls and displayed bindings survive the UI changes.** Both `RecordOps` call sites pass `viewer?.role === "owner"`; the flag reaches the actual card. Engine already gets `canAssign={user.role === "owner"}` from its server page, and the new approval buttons use that flag. Evaluating both unchanged card functions with owner/staff props confirms that owner Approve/Reject remain, staff controls disappear, and the surrounding content/record links remain. Invoking each owner's retained Approve handler after duplicate-box suppression submits its original item id and `draft.binding`; no click-time preview replacement is introduced. Email To/Subject and portal To keep their preview boxes visible. Distinct internal receipt content also retains its preview. Only the long matching Ops body loses readable access, as required fix 1 describes.

**Copy and frozen dispatch remain connected.** Both changed client approval handlers supply `title: "Approve failed"` to `runAction`, so stale refusal uses the recovery toast; their existing refresh follows it. The exact revised copy passes tests on all web action families and includes “Nothing was sent.” The claim still compares the viewed binding exactly under the work-item lock, freezes one atomic source in the approval transaction and dispatches only that snapshot. The copy/comment changes do not alter that behavior. No migration, grants, table shape, native contract, transport or phone-source change was introduced.

## Fresh adversarial results

**14/15 expectations passed; case 13 exposed required fix 1.** Expectations above were written into this review before running any probes. Probes used stdin and in-memory module/JSX compilation only; no probe or test source files were written.

- **1–8:** all eight work-item approve/reject routes plus all five direct/popup decision resolve routes fail closed for the specified invalid identities. JWT owner claims never override the database row. The demotion case includes rejection, decline and request changes, extending the committed approve-only demotion loop.
- **9–10:** a genuine database owner retains authority despite a staff JWT role or empty explicit permissions. Engine sends the displayed payload once after promotion; all eight owner work-item routes work with no area permissions.
- **11:** every owner work-item Approve route refuses another item's genuine binding and missing evidence without changes, then accepts its own original displayed binding once.
- **12:** unchanged Engine and Ops card functions were extracted with the TypeScript AST and compiled in memory, using request/hook/action adapters to inspect the JSX tree and invoke handlers. Both retain the exact binding after short internal-preview suppression; staff has no Approve/Reject, and email/portal boxes remain. This is structural/event verification, not a browser layout check.
- **13:** **failed the prewritten readability expectation**. The actual database/read-layer probe confirms the 543-character matching internal body is valid data and triggers suppression; JSX evaluation confirms only the clamped body and live owner Approve remain. Different receipt content keeps its preview. A diagnostic assertion that confirms this bad predicate is not counted as passing the expectation.
- **14–15:** scoped cleanup, foreign-key repeatability, loud injected failures and two-run recovery all pass, as detailed above.

One preliminary reviewer preload had a JavaScript brace error and stopped before loading application code. Corrected the in-memory adapter and ran all eleven auth probes successfully; application/test source and expectations were unchanged. Two initial QA connection attempts named nonexistent local roles (`joe`, `sjctest`); the actual QA admin is `postgres`. These were reviewer setup errors, not product failures.

## R4 nonregression

All R4 executable regression families pass again; no regression was found in frozen sending, phone/Telegram parity, provider handling, recovery, native queue safety or database boundaries. This does not waive the newly introduced Ops text-readability issue.

- The R3 25-case file still verifies all nine post-approval content/receipt/recipient edits across phone, Telegram and web, before-approval edits, concurrent approval, missing evidence, narrow-role snapshot writes and failed-send retry. Both runs pass. R4 binding regressions pass 18/18 twice, including unmapped/mapped legacy Telegram refusal, same-source web previews and frozen Telegram dispatch.
- Original, parity and R2 files retain rejection/stale-tap behavior, generation fencing, live blocked mutation/expired lease overlap, saved-result collision/replay, durable needs-review recovery, known pretransmit retry, uncertain provider acceptance, portal replies, threaded revisions and conversational-child restrictions. All pass twice. Delivery/sweep retain the unrelaxed hourly-cap, quiet-hour, partial summary retry and clock assertions and pass twice without reviewer clock substitution.
- Independently repeated R4's **17** explicit auth/envelope assertions: eight invalid-bearer push routes return 401; six owner-only routes return 403 for staff; real `push.saveSettings` dispatch returns 401/403/200 for invalid/staff/owner. Owner success retains `{ok:true,result:{channels,quietHours,configured}}`. Real bearer authentication is used for those RPC checks.
- All six unchanged phone regression files pass **109/109**: request identity and durable queue, SecureStore/journal failures, account boundaries, unregister retry/transfer, stale/needs-review handling, trusted navigation, confirmations, native action authentication/foreground options and preview privacy. Phone HEAD and working tree remain unchanged. Actual device/APNs presentation remains a coordinator check.
- APNs/transport tests pass 13/13: origin restrictions, UTF-8 payload limits, credential/token redaction and timeout/stream/session behavior. Telegram reply/draft/event, portal, decision-summary and notification regressions pass.
- Exact manifest and real MCP/worker narrow-role path tests pass 8/8. `node scripts/db-roles-scan.mjs --diff` exits 0 with only its documented intentionally withheld permissions. `node scripts/db-roles-sql.mjs approved_work_item_drafts` still prints no grants. Owner-only source/snapshot access and immutable evidence are unchanged; no privilege widening was introduced. New trigger-function rules have no product changes to review in this diff.
- Retraced P1–P15 through notifier/gate, resolver/effects, binding/snapshot, conversations/portal, reconciliation, phone action queue/category mapping/settings and informational destinations. No changed wire field, duplicated resolver, approval bypass or routing disconnect found. R4's entire independent twenty-probe crash/race sequence was not reproduced separately this round; the retained committed regression families and additional probes above establish the stated nonregression scope.

## Validation

Every test file was run by itself, sequentially. Ordinary unchanged-source runs: **406 passed, zero failed, zero skipped**, across **30 backend files / 49 executions**. For the 19 repeated files, each pair used the same per-file database, and only their committed fixture cleanup/reset ran between executions.

| Backend file | Passes per run | Runs |
| --- | ---: | ---: |
| portal-telegram-db | 3 | 2 |
| phone-push-r5-db | 15 | 2 |
| phone-push-r4-db | 18 | 2 |
| phone-push-db | 19 | 2 |
| phone-push-delivery-db | 12 | 2 |
| phone-push-parity-db | 16 | 2 |
| phone-push-r2-db | 26 | 2 |
| phone-push-r3-db | 25 | 2 |
| phone-push-sweep-db | 3 | 2 |
| approve-work-item-db | 1 | 1 |
| approved-draft-rules | 20 | 1 |
| telegram-events-done-db | 1 | 1 |
| telegram-replies-db | 1 | 1 |
| telegram-draft-replies-db | 1 | 1 |
| db-roles-manifest-db | 6 | 1 |
| db-roles-paths-db | 2 | 1 |
| apns | 4 | 1 |
| apns-transport | 9 | 1 |
| decision-summary | 4 | 1 |
| notifications-v2-db | 1 | 1 |
| portal-checkout | 7 | 2 |
| portal-financials | 2 | 2 |
| portal-pay-link | 4 | 2 |
| portal-payment-breakdown | 4 | 2 |
| portal-presentation | 11 | 2 |
| portal-preview | 2 | 2 |
| portal-selection-counts | 2 | 2 |
| portal-selection-groups | 1 | 2 |
| portal-selection-price | 4 | 2 |
| portal-signature-review | 4 | 2 |

The extra scoped/recovery portal runs passed 3/3 four times; the deliberate cleanup fault run failed 1/3 as expected. Those runs, eleven independent auth tests, independent 17-check R4 auth/envelope repeat, SQL/JSX diagnostics and phone tests are separate from the 406 total.

Phone tests from `/home/joe/qa-sjcos/mobile/tests/`, each importing the verified push checkout and run individually: push-actions 18, push-feed 12, push-outbox 9, push-payload 10, push-r1 30, push-r2 30; **109/109**, zero skips. Backend/phone `git diff --check` pass. No typecheck was run because the permitted exact incremental `tsc --noEmit -p .` writes build-info and this task permits only the review-file write. No browser, Next dev/build/start or production bundling verification was performed.

## Optional items / coordinator checks

- Visually check owner/staff Engine and lead/project Ops after required fix 1, including long text, narrow widths and wrapping. Structural checks do not establish final layout.
- Retain R4's optional bounded reconciliation/expiry optimization and possible known-before-dispatch snapshot recovery; the current conservative needs-review policy remains unchanged.
- Actual APNs delivery, hidden previews, killed-app handoff, device authentication, Notification Center removal and keychain behavior remain device/coordinator checks.

## Cleanup / boundaries

Used `SJC_TEST_CLUSTER_TAG=pushr6eng` and only the existing QA Postgres Unix socket `/home/joe/qa-sjcos`, port **5499**. An in-memory harness adapter routed each file to its own reviewer database and left fixture/test behavior intact; it did not start another server or touch the shared `sjcos_qa_push` database. Loaded schema/migrations only into the explicit reviewer QA `DATABASE_URL`. Neither migration nor role-apply was run with an implicit target. Synthetic owner provisioning was used in the two files that explicitly require a preexisting owner (`telegram-replies-db`, `notifications-v2-db`).

Created **32** databases named `sjcos_push_pushr6eng_*` (base, thirty per-file clones, auth/probe database). All were dropped after closing test connections; zero remain. Tagged cluster stop returned `no cluster running`; no reviewer cluster was started. Existing `sjcos-qa-pg` remained active. No shared QA push unit or live service was stopped/restarted, and no live database or live environment file was accessed.

No source/probe/log files, browser, application server, real outbound send, deploy, staging or commit. Concurrent R6 design/security review files belong to other reviewers and were left untouched.
