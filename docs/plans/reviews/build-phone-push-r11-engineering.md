SCORES: design=10 completeness=10

Engineering judge, build round 11. Reviewed HEAD `b1043d6e`, all 12 files in `git diff c405469c 9d59df11` individually, and the reachable approval, snapshot, dispatch, authority, notification and database-role dependencies. The phone checkout remains clean at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

Use only reviewer-owned QA databases on port 5499, tagged `pushr11eng`, real domain/endpoint transactions and fake external transports. Keep these expectations fixed when interpreting results.

1. Interrupt the actual Telegram approval COMMIT before any post-commit action: approval, frozen snapshot and pending dispatch must survive together; duplicate callback must report durable pending evidence; two real dispatch passes send exactly once.
2. Interrupt callable web approval at that COMMIT, mutate live receipt content, recipient, title, body and assignee, then recover: only the approved frozen recipient/body may leave; no retap may approve twice.
3. Interrupt portal approval after COMMIT; two overlapping recovery passes must create exactly one frozen portal message and receipt, even after live portal routing/body changes.
4. Interrupt immediately after provider acceptance but before the intent outcome transaction commits: expire the leases and run recovery twice; no second provider send, durable needs_review and evidence on the item must remain.
5. Interrupt after the successful send and intent completion but before dispatch-checkpoint completion: recovery must not resend, must retain the accepted provider reference, and must repair a missing item warning on a subsequent pass.
6. Race interactive finish with two cron dispatch passes while its provider is stalled: exactly one sender; owner/profile and target locks must be independently obtainable before transport releases.
7. Roll back after pending checkpoint insertion but before approval UPDATE: no snapshot, checkpoint, approval or outbound effects survive; fresh retry recovers once.
8. Recover under quiet hours and under outbound suppression: enforce the same policy as live explicit approval, with equivalent intent state and no unauthorized transport. Document explicit-approval policy exceptions rather than assume quiet hours apply.
9. Recover with revoked/absent client email consent and with missing/revoked grants: enforce exactly the live approval policy, frozen recipient and actual authorization semantics; recovery must not manufacture broader grants.
10. Run recovery as the real worker role for email, portal and non-email agent notification branches; required reads/writes must succeed, while inserting approval snapshots/checkpoints, altering frozen snapshots, arbitrary portal posting and approving owner grants remain denied.
11. Send nonexistent and deleted-decision callbacks through the real webhook, including inactive and deactivated-during-lookup owners: commit a NULL decision FK, durable refusal/dedupe and a post-commit toast, with harmless replay and no domain mutation.
12. Race expired-checkpoint recovery against an in-flight completion, and revisit terminal needs_review/done rows: no repeated client send, truthful durable result/evidence, no warning silently lost, and no second approval. A slow legitimate sender may finish once; ambiguity must stay reviewable.

## REQUIRED fixes

None. Both round-10 required fixes are closed by independent reproductions. No concrete required defect remains in the changed feature code.

## Independent verification

The 12 expectations above were saved in this file before executing tests. Probes were loaded with in-memory Node module hooks; no probe/test source was written. They use real PostgreSQL transactions, real webhook/domain/dispatch code and fake external transports. The existing R10 fixture helpers supplied cards and crash-injection plumbing; the fresh cases add their own scenarios and assertions. Agent notification probes preserve conversation/message SQL and replace only the final Claude launcher, so no agent process or background model turn starts.

1. **Telegram approval crash: pass.** Threw immediately after the actual COMMIT of the transaction containing the pending-dispatch insertion. Approval is `approved`, exactly one immutable snapshot and one `pending` checkpoint exist, no intent/email exists yet, and the committed callback outcome says `dispatch pending`. Identical webhook redelivery is deduped. Two real dispatch passes produce exactly one email, one intent and a `done` checkpoint. This closes the callback-before-action gap as well as the approval-before-enqueue gap from R10.
2. **Web approval crash and frozen source: pass.** Interrupted after the real approval COMMIT, then changed live knowledge content, recipient, subject, project email, work-item title/body and assignee. Recovery emails only `client@example.test`, subject `Displayed quote`, body `Displayed $100.`; a second pass sends nothing and retap refuses reapproval. A separate worker probe changed the non-email work item's live assignee/title/body after approval; the saved Claude assignee still receives the frozen `Confirm stock` prompt, with none of the changed live text.
3. **Portal crash and concurrent recovery: pass.** After COMMIT, changed live draft body and project slug. Two overlapping passes plus a third pass produce one `Frozen portal $100.` message in the original frozen portal channel, one portal receipt, no email and a `done` checkpoint. The SQL helper's post and receipt share one transaction; it locks the running checkpoint and refuses a missing/non-running approved dispatch.
4. **Provider accepted before intent outcome: pass.** Fake email transport accepts; injection aborts the real intent outcome write. Expired intent/checkpoint leases and two passes do not resend. The checkpoint becomes durable `needs_review`, carries send evidence, and the item says `Do not resend`. Transport is never moved under the approval transaction.
5. **Provider accepted before checkpoint completion: pass.** Failed the checkpoint completion write after a successful email/intent outcome. Recovery retains the accepted provider reference and `needs_review`, sends no second email, and repairs a deliberately cleared item warning on the next pass without changing its evidence.
6. **Interactive/cron race and lock duration: pass.** Paused the actual fake email transport while interactive completion owns the checkpoint; two concurrent dispatch passes finish without a second sender. Independent Profile-style owner UPDATE and `FOR UPDATE` of the target succeed with a 1000 ms lock timeout while transport remains stalled. Exactly one email and a final `done` result follow release.
7. **Rollback: pass.** Failure after snapshot/checkpoint insertion but before the approval UPDATE rolls all three back: the item remains requested, no snapshot/checkpoint survives and no transport runs. Fresh approval plus recovery sends once.
8. **Quiet hours and suppression parity: pass.** At `2026-11-05T05:00:00Z` (23:00 Central), a real ordinary owner notification parks unsent in `push_outbox`, with no Telegram call. Live and recovered explicit client-draft approvals use the same sending path; quiet hours gate owner notifications, not Joe's explicit client email authorization. With `SJC_OUTBOUND_DISABLED=1`, recovery uses the fake provider outcome and never reaches email transport. Supplemental live/recovered cases under an actual `sends` lane pause both leave the intent held with `Lane "sends" is paused: r11 paused` and make zero provider calls.
9. **Consent/grant parity: pass.** Six live/recovered combinations exercised email opt-out, an attached revoked grant, and an explicit approval without a separate grant. Opt-out and revoked-grant variants both cancel the intent, preserve the specific refusal and reopen approval without any email. With no separate grant, both use `owner:approve-click`, send once and create no owner grant: the explicit bound approval itself is the authorization, as on the existing live path. Recovery does not bypass the dispatch preflight or replace the authority on an existing operation-key intent.
10. **Worker permissions: pass.** Actual `SET ROLE sjcos_worker` completes email, portal and agent-notification recovery. It can read frozen snapshots and SELECT checkpoints, and can UPDATE exactly checkpoint `phase`, `lease_until`, `result`; it cannot INSERT checkpoints, INSERT/UPDATE snapshots, change checkpoint identity, or INSERT arbitrary portal chat messages. Worker execution of the portal helper with no approved running dispatch is refused. Both narrow roles cannot create/edit approval evidence; agent cannot execute the portal helper. An attempted worker approval of a real requested owner grant is refused by the existing narrow-write trigger, while agent's UPDATE is permission-denied. No new privilege on users, authority grants, policies, lane pauses or app settings was introduced. The new helper is `SECURITY DEFINER SET search_path = public, pg_temp`, PUBLIC execution is revoked, and only the worker receives EXECUTE. The manifest and migration grants agree.
11. **Missing/deleted decision refusals: pass.** Real secret-authenticated webhook calls for random missing UUIDs, a deleted real card, inactive owner and owner deactivated between discovery and the locking check all commit a NULL audit FK and a done source event. The transport callback independently reads that committed audit before the refusal toast. The correct missing-target/inactive-owner toast arrives; identical update delivery is harmless and no email is sent. The existence subquery's `FOR KEY SHARE` also protects a found FK target through commit.
12. **Slow sender/expired lease race: pass.** Expired the checkpoint while a legitimate provider call was paused, raced two recovery passes, then let that sender complete. Exactly one email leaves; `needs_review` is not overwritten by its late checkpoint completion. Subsequent passes preserve the review state, restore its visible warning and send nothing; reapproval remains refused. This deliberately conservative uncertainty is acceptable evidence, not automatic permission to resend.

**Actual cron endpoint:** additionally exercised `/api/cron/dispatch` in process through its real authenticated POST handler. Missing credentials return 401. Under the actual worker role, consecutive authorized runs report `approved_drafts: 1`, then `0`, with exactly one email. Under the normal website database role, the same recovery also commits a successful `cron_runs` row with `detail.approved_drafts=1`. This verifies route integration in addition to direct sweep tests.

**Rest of the diff:** the checkpoint is inserted by `freezeApprovedDraft` on the same `Run` as snapshot creation and the approval gate; Telegram's bound Approve executes that transaction before callback dedupe commits. `finishOwnerAction` consumes the committed claim after commit and retains existing toast/card ordering. The pending-to-running UPDATE fences overlapping inline/cron starts; expired running work becomes reviewable rather than being blindly restarted. Recovery reads content and assignee from the frozen snapshot. The portal function consumes only that approved snapshot and atomically records its receipt, avoiding a broad worker chat INSERT grant. The dispatch response exposes an additive recovered-draft count. The changed portal regression correctly establishes the running checkpoint before invoking the lower-level sender. No new framework API or client authentication gate was introduced; installed Next.js server-function guidance was read.

**Joe's binding decisions:** unchanged matching-area staff web authority remains covered by the passing R5/R7/R8 matrices; phone alert APIs and Telegram remain owner-only. The phone repository is unchanged and its source search adds no Face ID/biometric gate. No binding design/security decision was overridden.

## Regression results

Every test file ran separately and sequentially with `SJC_TEST_CLUSTER_TAG=pushr11eng`. Every `phone-push-*-db` file ran twice on the SAME per-file database, without a schema reload/reset between executions (ordinary fixture cleanup remains intact).

| File | Passes per final run | Runs |
| --- | ---: | ---: |
| phone-push-db | 19 | 2 |
| phone-push-delivery-db | 12 | 2 |
| phone-push-parity-db | 16 | 2 |
| phone-push-r10-db | 15 | 2 |
| phone-push-r2-db | 26 | 2 |
| phone-push-r3-db | 25 | 2 |
| phone-push-r4-db | 18 | 2 |
| phone-push-r5-db | 23 | 2 |
| phone-push-r7-db | 13 | 2 |
| phone-push-r8-db | 12 | 2 |
| phone-push-r9-db | 10 | 2 |
| phone-push-sweep-db | 3 | 2 |
| approve-work-item-db | 1 | 1 |
| approved-draft-rules | 20 | 1 |
| db-roles-manifest-db | 6 | 1 |
| db-roles-paths-db | 2 | 1 |
| portal-telegram-db | 3 | 1 successful rerun |
| telegram-draft-replies-db | 1 | 1 |
| telegram-events-done-db | 1 | 1 |
| telegram-replies-db | 1 | 1 |

**419 passing regression assertions across the requested 20-file / 32-execution matrix**, plus the 12 fresh adversarial cases and two supplemental endpoint/policy cases above. No requested file skipped. Original R10 registrations were intentionally skipped only inside the in-memory independent-probe processes; the unmodified file separately passed twice.

Harness corrections, disclosed: the initial portal regression run had an extra synthetic earliest owner named `Joe QA`; the test expects `Joe Stafki`. Corrected that reviewer fixture's name and reran the unchanged file: all three tests pass. The first fresh policy assertion mistakenly expected intent state `skipped`; the existing state machine maps a skipped response to `cancelled`. Corrected that internal label while preserving zero-send/refusal expectations; all six combinations pass. The first grant-denial probe UPDATE matched zero rows and therefore invoked no guard; reran against a real requested grant, which is refused. No product expectation was relaxed. The worker test's single-connection pool adapter emits pg's concurrent-query deprecation warning; it is probe plumbing, not a source change.

`node scripts/db-roles-scan.mjs --diff` exits **0**, reporting only intentionally withheld permissions. Both role test files pass. Fix-range and working-tree `git diff --check` pass. No tsc ran because its incremental build-info may write another file and this review permits only this report as a filesystem write. No build, browser, app server or device was started.

## Optional items / coordinator checks

- Physical-device APNs delivery, killed-app action handoff, hidden previews and Notification Center cleanup remain coordinator checks; carry forward the prior narrow-width Ops/staff-card discoverability checks.
- Forcing the entire cron HTTP handler onto `sjcos_worker` logs a best-effort `cron_runs` INSERT permission denial even though recovery succeeds. This is in the unchanged shared cron guard/role setup, outside the feature changes. Normal website-role cron commits its success ledger. Optionally review narrow-role cron observability separately; it is not a required feature fix.
- The portal header/body parser now exists in TypeScript and SQL. Optionally add a shared edge-case parity corpus (including Unicode whitespace) to keep their semantics aligned. The reviewed normal/email/portal cases pass; no concrete required send defect was established.

## Cleanup

Used only the existing QA PostgreSQL socket `/home/joe/qa-sjcos`, port **5499**, as `postgres` or explicit SET ROLE narrow logins. Created reviewer namespace `sjcos_push_pushr11eng_`: one freshly migrated base, 20 per-file clones and one independent-probe database. Migration loading had an explicit reviewer `DATABASE_URL` and explicit target URL; no role-apply script was run. The QA preload prevents automatic test-cluster startup and schema-marker writes. The legacy Telegram test received its explicit isolated `FIN_TEST_DATABASE_URL`.

All **22** reviewer-owned databases were dropped; namespace count is **zero**. No tagged cluster was started; `stopCluster` for `pushr11eng` returned false. Existing QA server/units were left running. No live database, live env file, protected service, browser, deploy, stage or commit was touched. Other judges' round-11 reports were left untouched.
