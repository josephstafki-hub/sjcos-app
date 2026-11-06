SCORES: design=8 completeness=9

Security and completeness judge, build round 5. Reviewed fix 50cb82b1..717686a6 at backend HEAD 5e97c12e; changes after the fix are review documents. Phone remains 5b1b883. The R4 revision-binding defect is fixed. A separately reproduced authorization gap in the web approval entry points prevents security sign-off. This gap predates the fix; it is not a newly introduced regression. Earlier reports did not catch it.

## REQUIRED fixes

1. **High — require owner approval authority on both direct web draft-approval actions.** `lib/actions/engine.ts:264` checks only `requireAccess("engine")`; `lib/actions/record-ops.ts:77` checks only `requireAccess("today")`. `lib/dal.ts:89` permits staff who hold those areas. Neither the claim nor the sender checks the acting user's approval authority. Area visibility expressly does not grant approval authority (`lib/permissions.ts:14`). Consequently a staff login can freeze, approve and immediately email a client's staged draft without Joe's approval. The binding fixes content integrity but is not an authorization credential; the Engine and record data loaders now supply it along with the preview.

   Reproduced on isolated QA with **real `getCurrentUser`, `requireAccess`, signed sessions, database users, action implementations, claim and dispatcher**. Only Next headers/cookies/cache were adapted for the command-line harness; no DAL/authz function was stubbed. Created active staff with permissions `['engine','today']`, a requested project email, its draft receipt, and the displayed binding from `getEngineWorkItem`. Called each exported server action on a separate draft. Both returned `{"ok":true,"sent":{"to":"client@example.test","subject":"Authorized?"}}`; each recorded exactly one fake email. `getCurrentUser()` confirmed `role:"staff"`. Owner controls through both paths also sent once. No owner grant or authority grant was created for the staff.

   Add an explicit owner gate before either action can claim/send (or an explicit, correctly scoped approval-authority check if delegated approval is intentionally supported). Keep the displayed binding requirement. Add negative tests using the real DAL for staff with each relevant area, plus owner positive controls, asserting unauthorized calls create no snapshot, change no approval state and dispatch nothing. `approveWaiting` and native `approvals.approve` already retain their owner checks; direct web calls must provide the same protection. The new R4 regression file mocks `requireAccess` to return its fixture user and therefore does not test this boundary.

## R4 fix verification

- Exact old-$100/new-$9900 reproduction now refuses both the old phone card and old web binding after a replacement alert exists. No email, snapshot or approval-state change is produced by the stale web call.
- Opening the replacement preview approves and sends its displayed payload once; a second approval does not resend. No-phone-card stale/fresh variants pass. Missing, empty, null and forged bindings fail closed rather than adopting current content.
- Independent transaction edits content while the web action waits for the work-item lock: the old binding is refused. Recipient-only edits and replacement draft receipts also invalidate the displayed binding.
- Entry-point search covered `approveWorkItemById`, both claim functions and callers: Engine `WorkItemCard` submits `item.draft.binding` through `approveWorkItem`; lead/project `RecordOps` submits it through `approveRecordWorkItem`; Today/notifications/corner popup use `PendingApproval.contentHash` through `approveWaiting`. Both notification components pass the hash from their displayed object. Native Today RPC also passes that field unchanged. No remaining latest-card fallback exists in the frozen-source helper.
- Engine and record previews derive content and binding from the same SQL source. Pending approvals read preview fields and the STABLE binding function in one statement/MVCC view. The locked claim compares the submitted binding with the source used to insert the immutable snapshot. Dispatch consumes that snapshot, not mutable draft fields.
- Legacy Telegram unmapped cards refuse Approve whether edited or unchanged: “This old card cannot approve a draft. Open Today to review the draft and approve it there. Nothing was sent.” This is safe and clearly states the next step. A mapped card with no binding also refuses. A bound mapped card still sends its frozen displayed payload across a post-commit edit. No convenience objection or migration requirement is imposed.

## Security regression checks

- R2 file: 26/26 passed, including lease-generation fencing during blocked domain writes, stale-generation and lost-completion handling, signed-session expiry, registration takeover restrictions and eligible-recipient filtering. REST still authenticates/current-checks the user and owner-gates feed/settings/actions; action UUIDs bind user/message/verb/text. Uncertain external effects are not replayed.
- R3 file: 25/25 passed, including cross-channel pre/post-approval content/receipt/recipient races, immutable evidence, rejected snapshot substitution and narrow-role denial. Content and recipient inputs remain frozen with the approval transaction; the sender binds snapshot id to work-item id. Current review's web authorization finding qualifies the earlier broad claim about checked callers.
- Base/parity files: 19/19 and 16/16 passed. Device registration remains user-bound; explicit unregister is required for transfer. Narrow roles cannot enroll or rewrite tokens, and the monitor cannot read them. Replay, changes/replies, portal posting, threading and cleanup remain connected.
- `node scripts/db-roles-scan.mjs --diff` passed with only documented intentional withholdings. Manifest DB tests passed 6/6. No new grants or migration changes in this fix. Snapshot source execution remains restricted; immutable evidence remains owner-only at the database-login boundary. This does not distinguish staff from owner when both use the website's database login, hence required fix 1.
- APNs provider/transport tests passed 13/13, retaining origin restrictions, bounded/redacted errors, fake-token handling and failure behavior. No token/credential logging was added by the fix.
- Phone source recheck: all eight categories retain hidden-preview title/subtitle suppression and generic placeholders, authenticated foreground native actions, durable identity-bound outbox and unchanged trusted navigation/secure-storage behavior. Real APNs titles and no in-app Face ID are accepted rulings. Phone code is unchanged; this round does not claim a rerun of phone logic tests or physical-device verification.

## P1–P15 completeness

| Row | End-to-end recheck |
| --- | --- |
| P1 | Shared owner delivery routes APNs metadata to unchanged native parsing/navigation. |
| P2 | Quiet-hours/cap/parking/drain/summary and recipient retry regressions pass. |
| P3 | Live category/hash validation and native action verbs remain aligned. |
| P4 | Shared decision effects and recovery retain one execution and truthful outcomes. |
| P5 | Displayed-revision integrity and frozen draft sending now pass on all channels; direct web owner authority still needs required fix 1. |
| P6 | Typed changes retain request identity, pullback and delivery to the originating operator. |
| P7 | Replies retain current-card checks and threaded owner-note behavior. |
| P8 | Agent follow-ups/acks preserve thread and reply identity; parity tests pass. |
| P9 | Authenticated portal replies and concurrent UUID fencing pass. |
| P10 | Cleanup/open/badge state, hold and expiry reconciliation remain intact. |
| P11 | Revised children retain threading/actions; old web and phone bindings now both refuse replacements. |
| P12 | Allowed-action composer routing is unchanged. |
| P13 | Native owner gate, persisted UUIDs and lease fencing pass; owner-only resolution across direct web entry points is incomplete as described above. |
| P14 | Settings/test/cleanup contracts and APNs boundary tests pass. |
| P15 | Payment/contract informational categories retain useful titles and record destinations without approval verbs. |

## Execution and optional items

Single backend files run sequentially: phone-push-r4-db 18, phone-push-r3-db 25, phone-push-r2-db 26, phone-push-db 19, phone-push-parity-db 16, db-roles-manifest-db 6, approve-work-item-db 1, portal-telegram-db 3, apns-transport 9, apns 4: **127 passed, zero failures/skips**. Additionally ran the four real-DAL authorization probes described above (two staff reproductions and two owner controls).

Used SJC_TEST_CLUSTER_TAG=pushr5sec with only reviewer-created `sjcos_push_r5sec` and `sjcos_push_r5sec_auth` on the existing QA Unix socket, port 5499. Loaded fresh schema/migrations and used the QA preload to prevent cluster startup/shared database resets. Both databases were dropped after pools closed. No cluster was started, so none needed stopping. All outbound delivery was fake/mocked. No live database/env/services, servers, browsers, Expo, simulator, build, staging or commits were used. No source edits or temporary files: only this review file was written; other reviewers' files were left untouched.

Optional: retain earlier defense-in-depth suggestions for older PUBLIC reconciliation/binding helpers and inherited raw-error logging. Physical iPhone/iPad preview presentation, actual APNs delivery, killed-app handoff, background cleanup and keychain behavior remain coordinator/device checks; this review makes no device-certification claim.
