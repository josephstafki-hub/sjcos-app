SCORES: design=9 completeness=9

Security and completeness judge, build round 7. Reviewed `823a273c..6bae654b` at backend HEAD `96ec1fc4`; native checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` remains clean at `5b1b883`. R6 required fix 1 is fixed. Joe's binding decisions supersede the prior owner-only web requirement and move R6 findings 2–3 outside this feature. One mismatch with the specified web area rules remains.

## REQUIRED fixes

1. **Medium — honor Today access for the shared Today/notification draft cards, instead of requiring Engine.** `lib/actions/approvals.ts:97,114` routes work-item Approve/Decline through Engine actions, which require `engine`; `lib/approvals.ts:108` also hides those draft cards unless the viewer has Engine. The notifications page itself requires Today (`app/(os)/notifications/page.tsx:10`). Thus a Today-only staff member cannot see or answer these cards even though Joe explicitly authorized Today access for Today cards. The new area tests encode this mismatch: every non-Ops path, including the paths named “Today/notifications/popup”, is treated as requiring Engine. Independently reproduced with real DB users, signed sessions, DAL and dispatcher: Today-only staff's shared Approve is refused without effects and polling omits the card; change the same user's areas to Engine-only, and the same shared Approve succeeds with one fake email. Use the intended Today gate for these Today-area card actions and visibility, retain Engine gating for Engine actions and Today gating for record Ops, and adjust the area matrix accordingly. Preserve displayed bindings, decision-specific delegated authority, owner-only grant approvals and owner-only native RPCs. This is an area-routing/completeness defect, not a request to restore owner-only web sends.

## Verified

- **Telegram owner removal:** the real webhook now resolves `ownerPrincipal()` before returning any work-item callback. Its SQL selects an active database owner; `TelegramHandleResult.workItem` carries that principal, and `finishOwnerAction` passes it into bound-card dispatch instead of manufacturing a service identity. Executed inactive, demoted and absent-owner cases for bound Approve/Reject, legacy Reject, and decision Approve/Changes/Hold. Each refuses with `refused: no owner principal`, preserving approval state, snapshots, receipts, decision events, intents and sends. Active-owner controls pass, including one frozen bound send, duplicate suppression, both rejection routes and decision verbs. Secret/chat/sender/forwarding checks remain in place. Legacy unbound Approve still refuses.
- **Web access:** real-DAL/JWT tests pass for Engine-authorized staff on Engine, Today-authorized staff on lead/project Ops, no-area refusals, revoked staff/owner sessions, demoted owner sessions without retained access, and owner positives. Authority-enabled staff can resolve ordinary decisions; area access alone does not grant decision authority. Direct and popup grant decision Approve/Reject/Changes refuse staff even with ordinary decision authority. Dedicated owner-grant actions retain their owner-role gates. The shared card area mismatch above qualifies web-policy sign-off.
- **Stale-page repro rerun:** R4's “Old $100” to “New $9900” replacement-card reproduction passes: old phone and old web binding refuse, with no snapshot or send; opening the replacement sends its displayed payload once. The R4 file also exercises Engine, lead/project Ops and shared notification actions, missing/forged bindings, no-phone-card drafts, recipient/receipt edits and a lock-wait race. An independent in-memory extension of the real-DAL R5 file repeated edit-plus-replacement for every web Approve path with both owner and authorized staff sessions; all stale submissions refused without changing approval evidence or sending. This does not rely only on the committed stale test, which edits without recording a replacement.
- **Native authorization:** push feed/detail, open state, settings, test alert and action handling retain the fresh authenticated owner gate. Device enrollment/removal is the documented exception for owner/staff: token ownership is protected and staff devices are not eligible for owner delivery. Mobile approval/decline and permission RPC definitions remain `ownerOnly:true`; dispatch checks current authentication before invoking the now staff-capable web functions. No phone authorization relaxation was introduced.
- **R3–R5 defenses:** executed device takeover/session eligibility, action UUID binding, lease generation and blocked-write fencing, terminal-result protection, uncertain-effect handling, approved snapshot atomicity/immutability/work-item association, pre/post-approval content/recipient/receipt races and narrow-role refusals. All pass. `node scripts/db-roles-scan.mjs --diff` exits 0 with documented intentional withholdings only; manifest DB tests pass 6/6. No migration or new database privileges in this fix.
- **Native privacy and authentication:** unchanged category source has `isAuthenticationRequired:true` and foreground launch on every actionable category; hidden-preview options remain `showTitle:false`, `showSubtitle:false` with generic placeholders. No in-app Face ID requirement is imposed. APNs transport/origin/signing/payload checks pass. No physical-device certification is claimed.
- **UI binding:** actual card-function compilation tests pass for full internal Ops text, duplicate suppression, retained email/portal previews, staff controls and submission of the displayed binding. No browser or production build was run.

## P1–P15 completeness

| Row | Assessment |
| --- | --- |
| P1 | Owner-kind routing, delivery metadata and native categories remain connected; base/parity pass. |
| P2 | Quiet hours, caps, parking/drain, summaries and partial-recipient retry pass. |
| P3 | Decision hashes, allowed verbs and current-card validation pass. |
| P4 | Shared effects and one-execution recovery pass; web area restoration has required fix 1. |
| P5 | Frozen draft dispatch, stale/missing binding refusal and active-owner Telegram gate pass; shared web card access needs fix 1. |
| P6 | Changes, request identity, pullback and origin delivery pass. |
| P7 | Current-card replies and owner-note handling pass. |
| P8 | Follow-up/ack threading and durable reply identity pass. |
| P9 | Portal reply and concurrent UUID fencing pass. |
| P10 | Outcomes, cleanup, open/badge and hold/expiry reconciliation pass. |
| P11 | Revised child threading and old phone/web replacement refusal pass. |
| P12 | Replyable-only composer routing remains unchanged. |
| P13 | Owner-only phone/Telegram, persisted UUIDs, lease fencing and recovery pass. |
| P14 | Settings/test contracts, APNs signing/transport and channel checks pass. |
| P15 | Informational payment/contract categories retain contextual destinations and no approval verbs. |

## Follow-ups outside this feature

- R6 finding 2: newsletter release/skip, first-response send/dismiss and bid-package sends use pre-existing area-based staff permissions. Per Joe, these are outside this feature and are not required fixes.
- R6 finding 3: staff SMS/call paths creating grants are pre-existing communication behavior under Joe's per-area design and explicit permission to text/call clients. Not a phone-alert blocker or a required owner-only conversion.

## Execution and optional items

Single files executed sequentially: `phone-push-r5-db` 23, `phone-push-r4-db` 18, `phone-push-r3-db` 25, `phone-push-r2-db` 26, `phone-push-db` 19, `phone-push-parity-db` 16, `db-roles-manifest-db` 6, `apns-transport` 9, `apns` 4, `phone-push-r6-ui` 4: **150 passed, zero failures/skips**. The in-memory R5 extension reran its 23 cases plus two independent probes: **25 passed**. The area probe asserts the observed mismatch, so its passing result is evidence of the finding, not policy compliance.

Used `SJC_TEST_CLUSTER_TAG=pushr7sec` and only reviewer-created `sjcos_push_r7sec` on the existing QA Unix socket at port 5499, with fresh schema/migrations and the QA preload preventing cluster startup/shared resets. Dropped that database after pools closed. No cluster started; none to stop. All outbound effects were fake/mocked. No live database, live env, services, browsers, servers, builds, staging or commits. The review report is this reviewer's only filesystem write; another reviewer's report was left untouched.

Optional: retain earlier defense-in-depth suggestions on older PUBLIC database helpers and inherited error logging. Coordinator/device checks remain actual APNs delivery, physical hidden previews/device-auth presentation, killed-app handoff, background cleanup and keychain behavior. These are limitations of this review, not additional required source fixes.
