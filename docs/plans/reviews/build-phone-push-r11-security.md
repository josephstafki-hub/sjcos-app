SCORES: design=10 completeness=10

Security and completeness judge, build round 11. Reviewed `c405469c..9d59df11` at HEAD `b1043d6e`; the remaining HEAD changes are review documents. Native checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` is clean at `5b1b883`. No required fixes remain within Joe's binding scope.

## REQUIRED fixes

None.

## Verified

- Telegram bound-draft approval now locks the work item, checks and locks the same active owner, validates the displayed binding, freezes the source, creates pending dispatch, changes the approval gate and persists callback dedupe in one transaction. Pre-commit failure rolls everything back; a crash after COMMIT leaves recoverable evidence. Web and phone approvals use the same snapshot/checkpoint transaction. Duplicate callbacks and retaps cannot create a second approval.
- Recovery joins pending rows to immutable approval evidence and passes that exact snapshot ID to the sender. Content, recipient, record identity and assignee come from the approved source, not subsequent edits. The sender also checks the snapshot/work-item association. Source/recipient replacement after approval sends the approved content and recipient only. Narrow roles cannot manufacture snapshots or pending checkpoints, alter snapshot content/binding/work-item identity, retarget checkpoint IDs, or delete the evidence.
- Worker UPDATE is restricted to phase, lease_until and result. An additional adversarial check reset an already completed dispatch to pending as sjcos_worker after replacing the source with unapproved content: recovery neither sent the replacement nor repeated the accepted email. Immutable evidence plus existing permanent intent keys/prior-send checks remain the send boundary; mutable checkpoint result is not used as an outbound payload.
- Inactive/demoted Telegram principals create no snapshot or pending row for cron to consume. R8 target-lock races still refuse revocation/demotion that wins before the approval mutation, including substitution by another active owner. Real-DAL revoked-session, demoted-owner and staff/native refusals pass the existing regressions. Matching-area staff web approvals remain authorized, as Joe specified. A legitimately committed approval is durable authorization for its frozen payload; later account changes do not manufacture new approval or authorize new content. This review does not interpret account revocation as retroactively cancelling committed approvals.
- Pending-to-running claim commits before effects and permits one winner across cron/interactive races. Expired running dispatches become needs_review with intent evidence and a repairable work-item warning. Tests cover crashes after provider acceptance both before intent outcome persistence and before dispatch completion persistence: subsequent sweeps do not resend. A stalled transport holds neither the owner account nor work-item transaction lock.
- The portal helper has a fixed SECURITY DEFINER search_path, no PUBLIC execution grant, and only worker execution among narrow roles. It accepts a snapshot ID, requires a running checkpoint, derives the portal destination/body from frozen evidence, and writes the message and receipt atomically. Worker recovery posts once; missing/unclaimed evidence refuses; sjcos_agent cannot execute it. No broad worker INSERT grant on owner chat messages was added.
- GET and POST cron dispatch retain the fail-closed CRON_SECRET guard before any dispatch. Additional real-route checks for missing, wrong and unconfigured credentials all return 401, leave the checkpoint pending, and send nothing.
- Missing/deleted decision callbacks now persist NULL audit FK and finish their source event before emitting the refusal toast. Inactive-owner and owner-changed-during-lookup cases commit correctly; duplicates have no domain effect.
- `node scripts/db-roles-scan.mjs --diff` exits 0 with documented intentional withholdings only. Generated grants for both new/revised tables match migration 0092. All six manifest DB tests pass, including exact privileges, trigger security and approval boundaries. Recovery email and portal paths execute successfully under SET ROLE sjcos_worker.
- R3–R10 regression coverage passes for device ownership/session eligibility, revoked authentication, owner-only native/Telegram paths, staff web area gates, frozen displayed drafts, stale replacements, action identity, generation fencing, uncertain-effect recovery, owner notes, portal replies, transport deferral and rollback. APNs transport remains mocked; the native implementation is unchanged.

## P1–P15 completeness

| Row | Assessment |
| --- | --- |
| P1 | Owner-kind routing, contextual destinations, metadata and categories retained; base/parity tests pass. |
| P2 | Shared gating, quiet hours, caps, parking/drain, summaries and partial-device retry pass. |
| P3 | Decision action sets, hashes and current-card refusals pass. |
| P4 | Shared effects and truthful results retained; committed draft approvals now recover through the dispatch pass. |
| P5 | Frozen email/portal sends, decline, stale/missing binding refusals and staff web area matrix pass. |
| P6 | Post-commit changes prompt, typed changes and pullback pass. |
| P7 | Decision/grant/draft owner notes, account rechecks and pullback pass. |
| P8 | Agent answers, acknowledgments, inherited reply targets and threading pass. |
| P9 | Portal replies, channel locking and replyable acknowledgments pass; worker recovery uses a narrow helper. |
| P10 | Outcome, open/badge and cleanup reconciliation regressions pass; uncertainty remains visible on interrupted actions. |
| P11 | Revised-child threading and stale phone/web replacement refusals pass. |
| P12 | Replyable-only composer/category behavior unchanged; UI source tests pass. |
| P13 | Owner-only phone/Telegram, durable dedupe, lease fencing and atomic approval/recovery pass. |
| P14 | Settings/test contracts, channel isolation and mocked HTTP/2 APNs transport pass. |
| P15 | Payment/contract informational destinations remain intact without approval actions. |

## Follow-ups outside this feature

- Newsletter/first-response/bid-package staff sends remain outside this feature under Joe's binding decision.
- Staff SMS/call grants remain outside this feature under Joe's binding decision.
- No in-app Face ID requirement is raised.

## Execution and limits

Sequential single-file runs: phone-push-r10-db 15, r9 10, r8 12, r7 13, r5 23, r4 18, r3 25, r2 26, phone-push-db 19, phone-push-parity-db 16, db-roles-manifest-db 6, phone-push-r6-ui 5, apns-transport 9, portal-telegram-db 3: **200 distinct repository tests passing, zero skips**. R10's 15 tests also passed a second run while exercising in-memory review extensions. Four additional review scenarios cover cron denial, inactive/demoted approval plus sweep, checkpoint/evidence tampering and replay, and portal-helper denial.

The helper-denial extension initially asserted a global zero-message count despite portal messages retained from preceding fixtures. All denial assertions passed; the final count assertion failed on those existing rows. Rechecked with before/after comparison: no chat mutation. This was a reviewer assertion correction, not a product failure. Initial QA connection attempts used nonexistent roles and made no changes; the QA postgres role worked.

Used existing QA Postgres :5499 with SJC_TEST_CLUSTER_TAG=pushr11sec and only reviewer-created database sjcos_push_r11sec, loaded from schema/migrations and dropped after testing. The QA preload prevented automatic cluster startup/reset; no cluster was started or stopped. No live database/env/services, shared QA database, browser, server, Expo, simulator, build, tsc, staging or commit. No exit 137/Killed occurred. This review file is my only filesystem write; other reviewers' files were left untouched.

Physical APNs delivery, hidden-preview/device-auth presentation, killed-app handoff, background cleanup, keychain behavior and visual Ops presentation remain coordinator/device verification limits carried forward from R10. The temporary-key-file signing test was not rerun under the only-review-file-write constraint.
