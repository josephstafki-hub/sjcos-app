SCORES: design=10 completeness=10

Security and completeness judge, build round 8. Reviewed `96ec1fc4..025818cf` at backend HEAD `9eb7eb30` (subsequent changes are review documents only). Native checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` is clean and unchanged at `5b1b883`. R7 security's Today-area requirement and R7 engineering's atomic Telegram authorization requirement are fixed. No required source fixes remain within Joe's binding scope.

## REQUIRED fixes

None.

## Verified

- **Shared Today/notification/popup authorization:** `approveWaiting` and `declineWaiting` now require Today for work-item cards; `listPendingApprovals` uses the same area. Real DAL, signed JWT, database accounts, list/poll and dispatcher tests confirm Today-only staff see and approve/send or decline these cards and lead/project Ops cards, while Engine actions refuse them. Engine-only staff can approve/send or reject on Engine, cannot act through shared Today or Ops actions, and do not receive shared draft cards in polling. No-area staff fail every path. Positive approvals send the displayed payload exactly once; duplicates refuse. Decision-specific authority and owner-only grants remain separate and pass their regression cases.
- **Atomic Telegram owner check:** real webhook races hold the target row, start the callback, observe its database lock wait, commit deactivation or demotion on another connection, then release the target. Bound draft Approve/Reject, legacy Reject, and decision Approve/Hold all refuse without changing domain rows, approved snapshots, receipts, resolution events, intents or send counts. An independent in-memory extension also exercises decision Request changes under both account changes; both refuse. The new `lockActiveOwner` checks the same user after the target wait and holds `FOR SHARE` through the mutation transaction, conflicting with active/role updates. Its serialization test proves an account update waits until commit and another active owner cannot substitute for the original account. Earlier inactive/demoted/absent-owner and active-owner controls also pass. Legacy unbound Approve remains refused.
- **Stale-page binding and approved snapshots:** reran the Old $100 → New $9900 replacement repro, including old phone, Engine, lead/project Ops and shared notification submissions. Missing/forged bindings, receipt changes and the blocked web approval race refuse. Opening the replacement sends its displayed payload once. Extended the R7 staff matrix in memory to record a replacement card after changing the draft: all authorized staff approval paths still reject the old displayed binding without evidence changes or sends. R3 pre/post-approval content, recipient and receipt races pass; immutable snapshots remain atomic, associated with the correct work item, and protected from narrow roles and accidental owner mutation.
- **Device binding and lease fencing:** device takeover, registration/session eligibility, expiry/logout behavior, UUID request identity, blocked portal/owner-note writes, expired-lease takeover, generation fencing, terminal-result protection and uncertain-effect handling pass the existing regression files. No changes to these mechanisms in the fix.
- **Owner-only phone APIs:** fresh authenticated owner checks remain on feed/detail, open state, settings, test and action routes. Device enrollment/removal retains the documented owner/staff exception with token ownership protection; staff devices do not become owner-alert recipients. Native approval/decline and grant RPCs retain `ownerOnly: true` and current-account dispatch checks. Real-DAL revocation, demotion and staff-refusal regression cases pass.
- **Hidden previews and authentication:** unchanged native category definitions require device authentication and foreground launch for actions; hidden-preview flags remain `showTitle: false`, `showSubtitle: false` with generic placeholders. No in-app Face ID requirement is imposed. APNs transport, signing, origin and payload tests pass. This is source/test verification, not physical-device certification.
- **Ops UI:** actual card-function compilation tests pass for full internal draft text, duplicate suppression, distinct/email/portal previews, displayed binding submission, and the new “Waiting on approval.” note without controls on both record surfaces when Today access is absent.
- **Database roles:** `node scripts/db-roles-scan.mjs --diff` exits 0 with documented intentional withholdings only. Manifest DB tests pass 6/6. This fix introduces no migration or privilege expansion.

## P1–P15 completeness

| Row | Assessment |
| --- | --- |
| P1 | Owner-kind delivery routing, metadata and native categories remain connected; base/parity tests pass. |
| P2 | Quiet hours, caps, parking/drain, summaries and partial-device retry pass. |
| P3 | Decision hashes, current-card validation and allowed verbs pass. |
| P4 | Shared effects and one-execution recovery pass; web area gates now match Joe's policy. |
| P5 | Frozen draft sends, stale/missing binding refusals, Today/Engine area matrix and atomic Telegram owner checks pass. |
| P6 | Request changes, request identity, pullback and origin delivery pass. |
| P7 | Current-card replies and owner-note behavior pass. |
| P8 | Agent answers, acknowledgments and durable reply threading pass. |
| P9 | Portal replies, replyable acknowledgments and concurrent UUID fencing pass. |
| P10 | Outcomes, cleanup, open/badge state and hold/expiry reconciliation pass. |
| P11 | Revised child threading and old phone/web replacement refusals pass. |
| P12 | Replyable-only composer routing remains unchanged. |
| P13 | Owner-only phone/Telegram authorization, persisted UUIDs, lease fencing and recovery pass; Telegram account changes during target waits now win. |
| P14 | Settings/test contracts, APNs signing/transport and channel checks pass. |
| P15 | Informational payment/contract categories retain contextual destinations without approval verbs. |

## Follow-ups outside this feature

- Newsletter release/skip, first-response send/dismiss and bid-package staff sends remain outside this feature under Joe's explicit decision.
- Pre-existing staff SMS/call grant behavior remains outside this feature under Joe's explicit decision.

## Execution and optional items

Single files ran sequentially with fake outbound effects: `phone-push-r7-db` 13, `phone-push-r5-db` 23, `phone-push-r4-db` 18, `phone-push-r3-db` 25, `phone-push-r2-db` 26, `phone-push-db` 19, `phone-push-parity-db` 16, `db-roles-manifest-db` 6, `apns-transport` 9, `apns` 4, `phone-push-r6-ui` 5: **164 passed, zero failures/skips**. The in-memory R7 extension reran the matrix with replacement cards and added two Request changes races: **15 passed**, for **179 passing executions** overall. No test source was edited.

Used `SJC_TEST_CLUSTER_TAG=pushr8sec`, the existing QA socket at port 5499 and only reviewer-created `sjcos_push_r8sec`, loaded from schema/migrations. QA preload prevented test cluster startup and shared database resets. Initial connection attempts using nonexistent `sjctest` and `joe` roles failed without mutations; the documented QA role succeeded. Dropped the reviewer database after all test processes finished. No cluster was started, so none required stopping. No live database/env/services, browser, simulator, server, build, staging or commit operations were used. This review file is the only filesystem write; other judges' reports were left untouched.

Optional: retain earlier defense-in-depth suggestions concerning older PUBLIC database helpers and inherited error logging. Coordinator/device checks remain actual APNs delivery, physical hidden previews and device-auth presentation, killed-app handoff, background cleanup, keychain behavior and visual confirmation of the Ops note. These are verification limits, not additional required source fixes. No tsc or browser run was performed for this read-only review.
