SCORES: design=7 completeness=9

Security/completeness review at backend 823a273c, fix 5e97c12e..6c82d5aa; phone-push checkout 5b1b883, clean. The R5 required web-action fix passes. The explicitly requested wider authorization audit found additional pre-existing bypasses; these are not regressions introduced by this patch.

## REQUIRED fixes

1. **High — apply the current owner check to Telegram work-item callbacks before dispatch.** `lib/decisions/telegram.ts:166–171` returns the parsed work-item callback before calling `deps.ownerPrincipal()` at line 178. `lib/owner-actions.ts:47` then supplies a synthetic `telegram-owner` service principal to the bound-card path (or calls the legacy rejection helper). Consequently the configured Telegram identity can approve/send or reject after the app's owner account is demoted or deactivated. Decision callbacks do perform the database lookup; draft callbacks must do so too. Resolve and carry the current active owner principal before accepting any work-item verb. Keep chat/sender/secret checks and the accepted legacy unbound Approve refusal.

   **Reproduced through the real webhook, DAL database, claims, snapshot and dispatcher:** create a requested project-email draft and mapped Telegram card; demote the only owner to staff, then POST a valid owner-chat callback `w|<id>|a`. Result: `ok:true`, `outcome:"work item approve: dispatched"`, approval becomes approved, exactly one fake email, **zero active owners**. Repeat with `r`: rejected. Repeat both with owner role but `active=false`: same results. No auth function was mocked. Add demoted/deactivated/no-owner negative controls for bound Approve/Reject and legacy Reject, with no approval mutation, snapshot or send, plus active-owner positives. Telegram has its own authentication; this finding does not ask that cookie-session revocation invalidate Telegram login.

2. **High — gate the remaining direct staged-send/release actions on owner authority, not area visibility.** Independently reproduced `lib/actions/newsletter.ts:514` `releaseNewsletterItem`, `:529` `releaseAllOutbox`, and `:546` `skipNewsletterItem` with a real signed staff session and newsletter permission. Single and bulk release each returned success, marked the queued row released and dispatched one fake email; Skip marked a queued row skipped. No grant existed. `releaseOutboxItem` defaults to `newsletter:owner` plus `owner:click`, so the dispatcher cannot recover the caller's missing authority.

   The exhaustive source trace found the same missing gate on `lib/actions/lead-first-response.ts:29` (send the staged first-response email) and `:36` (dismiss it), and `lib/actions/bidding.ts:303` (send the prepared bid package). First response calls `sendLeadFirstResponse` directly with `auto:false`; that helper checks delivery/recipient state but no caller authority before Gmail. Bidding calls `sendBidPackageOp` without auth, which constructs `bidding:owner` and `owner:click` intents (`lib/bidding.ts:510,540`). These latter paths are source-confirmed, not claimed as executed reproductions. Native first-response RPC's ownerOnly flag does not protect the exported web action. Require the current owner in the web actions before mutations or sends, and add real-DAL staff/revoked/demoted negatives and owner controls for each. Preserve explicitly owner-approved automated paths separately.

3. **High — prevent staff communication actions from minting approved owner grants.** `lib/actions/sms.ts`'s send actions require only `comms` access and call `ownerSend`, which creates a grant labeled owner (`:41`). `lib/actions/calls.ts:17–34` likewise permits staff and calls `createGrant`, labeling it staff. `lib/owner-grants.ts:88` defaults these grants to **approved**; neither path obtains an owner decision first. This is a source-confirmed grant-creation bypass outside the correctly protected `approveGrant`/`createGrantAction` exports. Gate these self-authorizing paths on the current owner, or stage a request and consume an actual owner-approved grant for staff; do not equate comms visibility with an owner grant. Test direct web and reachable RPC calls with real staff and stale owner sessions, asserting no approved grant or external effect. This does not require removing staff's ordinary permitted communication UI; it requires preserving the stated owner-grant boundary.

## Verified fix and authorization tracing

- R5 real-DAL file: 15/15 passed. Engine and lead/project record Approve/Reject, Today/notifications/popup Approve/Decline, direct decision Approve/Reject/Request changes refuse staff and revoked sessions before changing evidence; owner controls succeed. Database demotion defeats an owner JWT on the tested approve paths. Notification polling hides controls, with server enforcement independent of those controls. Exact stale-draft recovery wording passes.
- Searched approval/rejection/release/send exports and approval-state writes throughout `lib/actions`, `app/api`, `lib/mobile-rpc`, and MCP `.mjs` tools; followed callers of claimApproval/claimRejection, approveWorkItemById, finishApproval/sendApprovedClientDraft, resolveDecision/resolveFromChannel and createGrant/decideGrant. Findings above qualify any claim of universal owner-only enforcement.
- Current DAL reads users.active, current role and session_revocations; sessionPrincipal uses that DAL. Push REST authenticates the current user and requires owner before feed/actions/settings. RPC dispatch uses current authentication and ownerOnly; Today approval/permission and operator grant actions declare it. The patched underlying web actions independently enforce it.
- Dedicated grant approve/deny/revoke/create actions use requireRole(owner); Team authority-grant writes also do. Decision web resolution now explicitly requires owner. Cost-book non-owner markup changes stage a decision; owner-time rate approval requires owner.
- MCP decision tools/internal route only stage/read/list/wait. Grant tools/internal route request/read/check/perform, with grant consumption and staged-send duplicate protection, not an approval endpoint. Narrow database roles cannot approve grants/decisions or write immutable snapshot evidence. Existing client-send authority checks on invoice/estimate paths differ from the area-only bypasses above; ordinary personal-mailbox Inbox sending is also distinct from releasing Joe's staged drafts.

## R3–R5 regression and completeness checks

Individually executed backend files, sequentially: phone-push-r5-db **15**, r4 **18**, r3 **25**, r2 **26**, base **19**, parity **16**, db-roles-manifest-db **6**, apns **4**: **129 passed, zero failures/skips**. Two additional in-memory extensions of the real-DAL R5 file reproduced the Telegram and newsletter defects above (each reran the 15 existing cases). No source or test files were edited. These probes assert/print the observed unauthorized behavior; a passing probe is evidence of the defect, not security success.

- Device registration/transfer, current eligible recipients, revoked/expired signed sessions, UUID identity binding, lease-generation fencing, blocked domain writes and uncertain-effect handling passed.
- Approved payload snapshots, work-item association, content/recipient/receipt races before and after approval, immutable evidence, stale web/phone replacement-card refusals, missing/forged bindings and no-card variants passed. Bound Telegram frozen sending and legacy unbound refusal passed under an active owner.
- `node scripts/db-roles-scan.mjs --diff` exited 0: only documented intentional withholdings. Manifest DB tests passed 6/6. No permission migration changed in this fix.
- Phone checkout remains 5b1b883; all categories share hidden-preview options `showTitle:false`, `showSubtitle:false` and generic placeholders. APNs payload/category/signing/fake-token tests passed. Transport/origin code is unchanged; transport tests were not rerun this round. No phone runtime or physical-device test is claimed.

| Row | Completeness assessment |
| --- | --- |
| P1 | Owner-kind delivery/routing remains connected; base/parity pass. |
| P2 | Quiet hours, cap, parking, summary and recipient retry pass. |
| P3 | Decision hash/verb validation retained; current owner enforcement on decision paths inspected. |
| P4 | Shared approval effects and one-execution recovery pass; bypasses above block overall authorization sign-off. |
| P5 | Frozen draft sending and stale-page integrity pass; Telegram owner removal still bypasses the gate (fix 1). |
| P6 | Changes, request identity, pullback and origin routing pass. |
| P7 | Current-card replies and owner-note behavior pass. |
| P8 | Follow-up/ack threading and reply identity pass. |
| P9 | Portal reply and concurrent UUID fencing pass. |
| P10 | Cleanup, outcomes, open/badge and expiry reconciliation pass. |
| P11 | Revised children/threading retained; old phone/web bindings refuse replacements. |
| P12 | Replyable-only composer routing unchanged. |
| P13 | Phone owner gate, action persistence/replay and lease fencing pass; all-channel owner-only completion remains blocked by required fixes. |
| P14 | Settings/test contracts and APNs payload/signing checks pass. |
| P15 | Informational payment/contract categories retain contextual titles/destinations and no approval verbs. |

## Execution and optional items

Used SJC_TEST_CLUSTER_TAG=pushr6sec and only reviewer-created `sjcos_push_r6sec` on the existing QA Unix socket, port 5499, postgres role. Loaded fresh schema/migrations; QA preload prevented cluster startup/shared resets. Dropped the database after test pools closed. Started no cluster, so none required stopping. No live database, live env file, services, browsers, servers, builds, staging or commits. All executed outbound effects were fake/mocked. A temporary grep-output file was inadvertently created under /tmp and immediately removed; the review report is the sole retained file change by this reviewer. Other reviewers' files were left untouched.

Optional: retain earlier defense-in-depth suggestions on PUBLIC helpers and inherited error logging. Physical iPhone/iPad preview presentation, actual APNs delivery, killed-app handoff, background cleanup and keychain behavior remain coordinator checks. No in-app Face ID requirement; legacy unbound Telegram Approve refusal is accepted as instructed.
