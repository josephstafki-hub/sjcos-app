SCORES: design=9 completeness=9

Engineering judge, build round 5. Reviewed the complete diff 50cb82b1..717686a6 at backend HEAD 5e97c12e69a19fb1749a815ad1cc541cbdd0078a. Changes after 717686a6 are R4 review documents only. Confirmed the phone push checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` remains 5b1b883ca9453c47b0441b97fde7199ddb88bdfc and clean. The R4 approval-to-view finding is fixed; one required test-isolation fix remains. Only this review file was written by this reviewer; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

All refusals below must leave the gate requested, create no snapshot, and make zero outbound sends. Real QA PostgreSQL, real claims/actions and fake providers; independent probes run from memory only.

1. Copy the valid binding from an identical-looking other work item into Engine Approve: refuse; the correct item's server-issued binding succeeds once.
2. Submit non-string binding values (object, array, number, boolean) through each web action family: refuse without throwing or changing approval state.
3. Submit a prefix, suffix, whitespace-padded or case-altered binding: refuse; no prefix/hash normalization acceptance.
4. Capture lead Ops preview using a converted lead's project portal, then change the selected portal project: old binding refuses; fresh preview targets the new portal.
5. Project Ops with no phone alert still displays and approves the exact current email once; missing evidence refuses first.
6. Lead Ops with no phone alert still displays and approves the exact current email once; missing evidence refuses first.
7. Change the fallback recipient on the project's linked lead while keeping the draft and project unchanged: old pending-card binding refuses.
8. Pull and resubmit identical content: old web binding refuses because approval revision changed; fresh binding succeeds once.
9. Internal work item with no draft receipt: missing evidence refuses; actual displayed internal preview binding approves without sending a client message.
10. Race Engine, project Ops, and pending-card Approve on the same displayed revision: exactly one success, snapshot and email.
11. Approve through project Ops, then edit content and recipient after approval COMMIT: only the displayed original snapshot is sent.
12. Inject snapshot INSERT failure: approval and snapshot roll back; retry the same displayed binding after removing the fault succeeds once.
13. Edit content on a separate connection after preview SQL has executed but before its rows return: preview text and binding remain the same old revision; approving it refuses the new live source.
14. A mapped old Telegram card after content edit plus replacement refuses; an unmapped legacy Decline still rejects safely without sending.
15. Portal destination/login change after the pending web preview invalidates the old binding; fresh portal approval posts exactly its displayed body to its displayed destination, with no email.

## REQUIRED fixes

1. **Medium — repair portal regression-test fixture cleanup and verify same-database repeatability.** `tests/portal-telegram-db.test.mjs:230` deletes portal outbox rows before their `owner_push_messages` children. The `finally` cleanup at line 247 repeats that ordering and silently swallows the foreign-key error. On a fresh migrated reviewer database the unchanged file passes 3/3, but leaves four `zz cap filler` outbox rows and one portal outbox row with one app-message child. Running the same unchanged file immediately again on that database fails its third test with SQLSTATE **23503**, constraint **owner_push_messages_push_outbox_id_fkey**, at line 230. This is deterministic fixture contamination, not a transient cluster conflict. The ordinary test harness reuses each file's database; these portal calls do not request `fresh:true`, so repeatability matters outside the QA preload too.

   Clean up the fixture's app-message/dependent rows before its outbox rows (scope cleanup to this fixture), and make unexpected cleanup failures visible. Preserve the app-channel integration assertions. Acceptance: run this file twice on the same migrated isolated database, with app alerts enabled; both runs pass 3/3 and neither leaves portal/cap fixtures. An **in-memory-only diagnostic substitution** deleting the linked app-message rows before the existing outbox deletes passed twice on the contaminated database and left zero portal/cap outbox rows. No source fix was made. This issue predates the binding fix; it was missed by R4's fresh-database-only run and is explicitly in scope for this review.

## Diff correctness and R4 security fix

- **Engine board/details:** `lib/engine.ts` selects the draft source in the same statement as the work item. `draftPreview` returns the content/recipient and server-computed binding together. `EngineClient.tsx:730` renders that preview; line 733 submits that same `item.draft?.binding` to `approveWorkItem`, which passes it to the claim. No click-time fetch substitutes newer evidence.
- **Project and lead Ops:** `lib/record-ops.ts` similarly shapes the atomic source. `RecordOps.tsx:206` displays it and line 190 submits its binding through `approveRecordWorkItem` to `claimApproval`. Both no-phone-card fresh views send once; missing or stale evidence refuses.
- **Today/notifications/popup:** `listPendingApprovals` returns `contentHash: w.binding` alongside To/Subject/body. Both notification-client and shell-popup handlers capture that displayed approval object and pass its `contentHash` through `approveWaiting`. Today uses the shared shell surface. The action forwards the binding unchanged. Decision approvals retain their separate existing decision-hash path. The generic native `approvals.approve` RPC also forwards the same field.
- **Server authority:** `freezeApprovedDraft` requires a nonempty string, reads `phone_push_draft_source` while holding the work-item lock, and compares the submitted value exactly to the binding produced by that server-side source. It never trusts a client hash as the source of content, never accepts a prefix or coerces another type, and never looks up a replacement card as authorization. Missing/empty/null/forged/cross-item evidence creates no snapshot, changes no gate and sends nothing. The frozen payload and binding still come from one SQL/MVCC source and commit with approval. The preview SQL uses a STABLE binding/source function, the same receipt ordering and the same statement snapshot for displayed columns.
- **Telegram:** unmapped legacy Approve refuses unchanged as well as edited drafts and directs Joe to Today; it never calls the unbound web fallback. Mapped cards retain their exact saved binding and the shared locked claim. Missing bindings refuse. Bound post-commit dispatch remains frozen. Legacy Decline still works.
- **Next.js 16.2.9:** read the installed `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`, `use-server.md`, the data-security guide and `revalidatePath` reference. Changed action modules retain top-level `use server` and async runtime exports. Read modules stay on the server. The new shared JSX component imports the draft interface with `import type`, so it brings no DB/runtime code into its client parents. Preview props are plain serializable values, not the full source record or secrets. Revalidation remains in server actions. No incompatible API or client/server boundary change found. Framework calls are stubbed by the DB harness; this is source/docs verification, not a production build certification.

## Fresh adversarial results

**15/15 passed**, corresponding to the expectations recorded above before execution. Probes ran from stdin with an in-memory module substitution that reused fixture helpers but replaced the committed test cases with these independent assertions. No probe files or test-source edits were written.

Cases 1–3 verify exact server comparison and refusal through all three action families. Cases 4–8 cover converted-lead portal selection, alert-free project/lead approval, fallback recipient mutation and revision rotation for identical resubmissions. Case 9 preserves bound internal approvals without client sends. Case 10 races Engine/Ops/pending actions and observes exactly one success, frozen snapshot and email. Case 11 edits both recipient and content after the Ops approval COMMIT and receives only the original displayed payload. Case 12 faults snapshot insertion and verifies rollback plus successful single-send retry. Case 13 edits through a separate connection after preview SQL execution and verifies the returned old text and old binding stay paired, then refuse the new live draft. Cases 14–15 cover mapped stale Telegram, legacy decline, and portal destination/login invalidation followed by one fresh portal post.

The first probe run used NULL for the project's missing email, which the schema disallows. Correcting that reviewer fixture to the supported empty-string fallback produced a clean 15/15 run; expectations and source were unchanged.

## R4 nonregression

No product regression found in the behavior exercised here. The unchanged R4 phone checkout and its six regression files pass **109/109** again. Backend R3/R2/original/parity/delivery/sweep regressions, role tests, Telegram/portal tests, APNs tests and decision-summary tests all pass on properly provisioned isolated databases. The newly checked same-database portal repeatability fails as required fix 1 describes; R4 never claimed that repeat check.

- Frozen dispatch still resists post-approval content, receipt and recipient edits across phone, Telegram and web (all nine committed R3 combinations); before-approval edits refuse. Independent Ops COMMIT and preview-query races also pass. Missing evidence and immutable-snapshot tests pass. Atomic insertion failure still rolls back approval.
- Rejection/stale taps, racing approvals, failed-send reopening, permanent intent deduplication and uncertain provider acceptance remain covered. R2 generation/lease overlap, saved results, needs-review handling, JWT/session expiry and device-transfer checks pass. The conservative crash/recovery implementation is unchanged; the R4 twenty-probe sequence was not independently reproduced in full this round.
- All **17** R4 auth/envelope checks were repeated independently: eight invalid-bearer routes return 401, six owner-only routes return 403 for staff, and `push.saveSettings` returns 401/403/200 for invalid/staff/owner with the documented `{ok:true,result:{channels,quietHours,configured}}` success envelope. Two preliminary reviewer-auth probe errors (an overly narrow expected result object and then a GET body) were corrected in memory; the final probe passes unchanged application code.
- Telegram/phone conversational parity, portal replies, changes/replies/threading, child-card restrictions, outbox/history fault handling and uncertain Telegram delivery pass. Summary/fanout/quiet-hour/cap and partial-recipient retry assertions remain intact; no runtime clock substitution or relaxed assertions.
- The manifest and real narrow-role MCP/worker paths pass. `node scripts/db-roles-scan.mjs --diff` exits 0 with only documented intentionally withheld permissions. `node scripts/db-roles-sql.mjs approved_work_item_drafts` prints no grants. No migration, privilege widening or new table was introduced by this fix.
- Phone queue/request identity, SecureStore failure recovery, account boundaries, confirmations, trusted navigation, unregister behavior, native authentication/foreground categories and preview privacy remain covered by the unchanged 109 cases. APNs origin restriction, transport handling, payload limits and secret-redaction cases pass.
- P1–P15 connections reviewed in R4 remain connected. The revised P5/P11 web surfaces now authorize the viewed revision, including without an alert; other push routing, settings, cleanup and informational destinations are unchanged.

## Validation

Every file ran separately; no full-suite command. Final successful unchanged-source runs total **172 backend assertions/tests across 19 files**, zero skips:

| Backend file | Passed |
| --- | ---: |
| phone-push-r4-db | 18 |
| approve-work-item-db | 1 |
| phone-push-r3-db | 25 |
| portal-telegram-db (fresh database) | 3 |
| phone-push-db | 19 |
| phone-push-delivery-db | 12 |
| phone-push-parity-db | 16 |
| phone-push-r2-db | 26 |
| phone-push-sweep-db | 3 |
| approved-draft-rules | 20 |
| telegram-events-done-db | 1 |
| telegram-replies-db | 1 |
| telegram-draft-replies-db | 1 |
| db-roles-manifest-db | 6 |
| db-roles-paths-db | 2 |
| apns | 4 |
| apns-transport | 9 |
| decision-summary | 4 |
| notifications-v2-db | 1 |
| **Total** | **172** |

`telegram-replies-db` and `notifications-v2-db` initially refused because the fresh schema has no active owner; both tests explicitly require one. Inserted a synthetic owner in each reviewer-owned database and reran each unchanged file successfully. This is fixture provisioning, not an application failure. The original repeated portal run is an additional **2 passed / 1 failed** and is not hidden in the successful totals. The diagnostic cleanup substitution's two 3/3 runs are not counted as unchanged-source passes.

Phone files in `/home/joe/qa-sjcos/mobile/tests/`, each separately against imports from the verified 5b1b883 push checkout: push-actions 18, push-feed 12, push-outbox 9, push-payload 10, push-r1 30, push-r2 30; **109/109**, zero skips. Backend and phone `git diff --check` pass.

No typecheck was run: the required exact `tsc --noEmit -p .` command uses incremental build-info, while this review permits only the review-file write. No browser or Next dev/build/start was run. Executable database/actions verification and source/docs inspection do not establish visual layout or actual production bundling.

## Optional items / coordinator checks

- Retain the R4 optional bounded reconciliation/expiry work and conservative known-before-dispatch recovery opportunity; neither was changed here.
- Coordinator should visually check the newly displayed draft preview and its overflow behavior on Engine details and project/lead Ops. Actual APNs/device presentation, hidden previews, killed-app handoff, device authentication and keychain cleanup remain device/coordinator checks. No new claim of physical-device verification.

## Cleanup / boundaries

`SJC_TEST_CLUSTER_TAG=pushr5eng` for all database work. The existing `sjcos-qa-pg` was active before and after. Created exactly **23** reviewer-owned databases under `sjcos_push_pushr5eng_*` on the existing QA socket/port 5499 (base, nineteen file clones, two probe databases and auth database); all were dropped after tests, and zero remain. Tagged cluster cleanup returned `no reviewer cluster running`; no cluster was started and no shared QA unit was stopped. Schema loading had an explicit reviewer QA `DATABASE_URL`; neither migration nor role-apply scripts were run with an implicit target.

No live database, live environment file, live service, browser, application server, build, real outbound send, staging or commit. Other reviewers' concurrent R5 files were left untouched.
