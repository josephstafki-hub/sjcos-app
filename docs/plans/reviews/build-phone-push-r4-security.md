SCORES: design=8 completeness=9

Security and completeness judge, build round 4. Reviewed backend diff 9b4ba319..1152a759 at HEAD 50cb82b1 (subsequent changes are review documents), and phone ac18de1..5b1b883. Read the R3 security report and rechecked its boundaries against the changes. No source edits.

## REQUIRED fixes

1. **High — bind web Approve to the draft the owner actually viewed, rather than the latest alert at click time.** `lib/approved-draft-snapshot.ts:12-20` substitutes the newest stored card binding when no expected binding is supplied. Both `lib/actions/engine.ts:264` and `lib/actions/record-ops.ts:77` submit only a work-item id to the claim. Their callers (`components/engine/EngineClient.tsx:731`, `components/engine/RecordOps.tsx:189`, and the notification approval action) carry no displayed revision. Once a replacement card exists, an old web page therefore approves and freezes the replacement content. With no card, the helper likewise accepts current content without any displayed-content comparison.

   Reproduced against the real claim/sender with fake outbound delivery: create a requested project email and alert for “Old $100”; retain that old view; change the draft to “New $9900” and record its replacement alert; submit the old phone card, then the web approval call with the same work-item id. Phone returned `stale`. Web returned `{ok:true,sent:{to:"client@example.test",subject:"New $9900"}}`, and the fake email contained subject and body “New $9900”. The owner did not have to open the replacement. The new race tests pass because their pre-approval edits do not also create a new card; this additional case is not covered.

   Return a content/recipient binding with each displayed web draft, submit it on every web approval surface, and validate that exact binding in the locked snapshot transaction. Refuse missing/stale evidence for send approvals rather than falling back to whichever card is newest. Include replacement-card and no-phone-card regressions; stale web approval must send nothing, while opening and approving the replacement must dispatch its frozen payload once. Also ensure Telegram's unmapped/legacy-card fallback cannot substitute a newer card for the tapped content (`lib/owner-actions.ts:46-48`); mapped Telegram cards already use the correct explicit binding. This is an approval-to-view gap, not a failure of post-approval snapshot immutability.

## Re-verified

- **Snapshot atomicity and dispatch:** the work-item row is locked; source fields and their binding are produced in one SQL/MVCC statement; snapshot insertion and the approval transition commit together. Content, selected receipt, email recipient, record ids/slugs, portal destination and eligibility inputs are frozen. Phone and mapped Telegram approval supply the selected card's binding. Post-approval content/receipt/recipient changes cannot replace the dispatched payload. All nine three-channel post-approval race cases passed, as did six pre-approval content/receipt races.
- **Forgery, recipients and replay:** snapshots are owner-only, UPDATE is blocked even for the owner, and the sender selects by both snapshot id and work-item id. No HTTP field supplies a snapshot id; successful claims pass it internally. Missing evidence fails closed. Narrow agent/worker snapshot INSERT/UPDATE/DELETE attempts fail. Existing source-to-recipient validation and permanent email-intent deduplication remain. Concurrent approvals, failed-send retry, and immutable evidence tests passed. The private sender is not itself an authorization endpoint; safety depends on the checked claim callers. The required fix concerns which content those callers authorize.
- **R3 lease/session fixes:** R2 regression file passed 26/26 unchanged, including blocked domain-write lease fencing, stale generations, lost completion, session expiry, device takeover restrictions, and eligibility filtering. REST still validates signed/current sessions, reserves feed/settings/actions for the owner, binds action UUIDs to user/message/verb/text, and returns terminal results without replaying uncertain effects.
- **Least privilege:** `node scripts/db-roles-scan.mjs --diff` succeeded and listed only explicitly documented withheld permissions. `node scripts/db-roles-sql.mjs approved_work_item_drafts` printed no grants, matching the migration and manifest. The new source helper revokes PUBLIC execution; the new trigger has `SECURITY DEFINER SET search_path = public, pg_temp`. Existing column-limited device access and protected approval boundaries passed the six manifest DB tests. No new agent/worker approval authority was granted.
- **Secrets/logs:** no new credential/token logging or outbound destination override was added. APNs signing, origin restriction, bounded/redacted failures, fake token suffixes and transport failure handling passed. Snapshot contents are not returned by the phone action API (only the internal evidence id may appear during recovery). Existing raw-error logging outside the hardened push route remains an optional R3 concern, not a new regression.
- **Phone:** exact diff changes only title Pressable structure, chip alignment and inline-button layout. It retains the same callbacks and does not change actions, confirmations, API requests, queue persistence, account checks or navigation targets. Rechecked category authentication/foreground options and hidden title/subtitle settings, trusted-link filtering, and SecureStore accessibility. Real APNs titles remain intentional; no in-app Face ID requirement is imposed.
- **Copy/clock changes:** hold/expiry formatting, stale permission card text and no-leading-blank-line cases passed. The prior R3 optional clock issue is resolved: all 26 R2 tests passed without source substitutions.

## P1–P15 completeness

| Requirement | Re-check result |
| --- | --- |
| P1 | Shared owner delivery, APNs routing metadata and native parsing remain connected. |
| P2 | Quiet hours, cap, parked delivery, summary and recipient retry paths pass the R2/DB regressions. |
| P3 | Phone verbs and live binding/category validation remain intact. |
| P4 | Shared decision effects and recovery still avoid uncertain-effect replay. |
| P5 | Frozen draft dispatch works across all three callers; **web displayed-revision authorization remains incomplete as required fix 1 describes**. |
| P6 | Typed changes retain owner-note/pullback delivery and durable request identity. |
| P7 | Reply paths retain current-card checks and threaded owner notes. |
| P8 | Follow-up/thread identity remains connected; parity tests pass. |
| P9 | Authenticated portal reply and concurrent UUID fencing remain intact. |
| P10 | Open-state/badge cleanup and hold/expiry reconciliation pass. |
| P11 | Revised children retain actions/threading; old phone bindings reject replacement drafts. Web parity needs fix 1. |
| P12 | Allowed-action composer routing is unchanged. |
| P13 | Owner authentication, persisted UUIDs, fenced mutation and needs-review handling remain intact. |
| P14 | Settings/test/cleanup contracts and APNs provider boundaries remain intact. |
| P15 | Payment/contract information retains useful titles and destinations without approval actions. |

## Execution and optional items

Executed single backend files: `phone-push-r3-db` 25, `phone-push-r2-db` 26, `phone-push-db` 19, `phone-push-parity-db` 16, `db-roles-manifest-db` 6, `apns-transport` 9, `apns` 4: **105 passed, zero failures or skips**. Additionally ran the stale web reproduction above. No phone test files were present in the supplied phone checkout; phone re-verification here is source/diff inspection, not a claimed rerun of the R3 phone tests.

Used `SJC_TEST_CLUSTER_TAG=pushr4sec`, only reviewer-created `sjcos_push_r4sec` on the existing QA Unix socket at port 5499, and the repository QA preload to prevent cluster startup or shared-name resets. Recreated that database between regression files and dropped it after all pools closed. Initial connection attempts with nonexistent harness/default roles failed before database creation; the documented QA role succeeded. All outbound delivery was fake/mocked. No cluster was started, so none required stopping. No live database/env file/services, browsers, servers, builds, staging or commits were touched. This review is the only filesystem write; other reviewers' files were left alone.

Optional: retain the R3 defense-in-depth suggestion to narrow PUBLIC execution on older reconciliation/binding helpers and improve inherited raw-error logging. Physical iPhone/iPad preview behavior, APNs delivery, killed-app handoff, background cleanup and keychain behavior remain coordinator/device checks, not claimed certifications.
