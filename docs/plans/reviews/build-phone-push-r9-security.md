SCORES: design=10 completeness=10

Security and completeness judge, build round 9. Reviewed `git diff 9eb7eb30 5b5776cc` at HEAD `7ac0a588`; subsequent changes are review documents only. Native checkout remains at `5b1b883`, with no phone implementation change. No required fixes remain within Joe's binding scope.

## REQUIRED fixes

None.

## Verified

- **Real owner-deactivation/demotion repro:** executed `phone-push-r8-db.test.mjs` against isolated QA Postgres. All 34 supported target/account-change combinations pass: Approve on decisions, grants and drafts; Decline on drafts; Changes on decisions, grants and drafts; Hold on decisions and grants; Reply on all four target types, including portal threads and reply-only children. Tests hold the domain target, start the authenticated endpoint, prove its wait with `pg_blocking_pids`, commit deactivation or demotion independently, and release the target. A second active owner exists throughout and cannot substitute for the original account. Every action refuses. Decisions continue to disallow Decline.
- **Refusal and durable replay:** the exact response is `{ok:false,message:"No active owner account. Nothing was changed.",outcome:"unauthorized"}`. It contains no target text, recipient, account identifiers or database error. The transaction rolls back before the wrapper returns it. Tests compare domain rows, grant state, snapshots, receipts, events, intents, owner notes, triggers, portal messages/activity, alert records and outbound effects before/after; none change. Only the request UUID records its terminal refusal, with null effect evidence. Restoring the owner and retrying that UUID returns the same refusal; a fresh UUID succeeds with the expected effect once.
- **Lock placement and serialization:** inspected action claim → work item/decision target → same owner's `FOR SHARE` ordering. Reply-only child alerts now lock inherited targets too. Portal replies use a transaction advisory lock on the effective channel, then the same owner check, shared with Telegram. `FOR SHARE` conflicts with role/active updates and holds through the mutation commit. The test pausing after the actual owner SELECT proves a subsequent deactivation/demotion waits until the authorized approval commits. Concurrent phone/Telegram decision and draft approvals settle in either arrival order without deadlock and produce one resolution or snapshot/send.
- **Owner-only routes/RPCs and web area policy:** inspected fresh account authentication, the phone push route's owner gate, and owner-only mobile approval/decline, grant and push-setting RPC definitions/dispatch. Device enrollment/removal retains the documented owner/staff exception and token ownership protection; staff devices cannot receive owner alerts. Real DAL/JWT regressions cover inactive/demoted/revoked accounts, staff refusals on native paths, Today versus Engine gating, authorized staff web sends, no-area refusals, decision-specific authority and owner-only grants. Telegram target-wait races and active-owner controls still pass.
- **R3–R8 defenses:** reran device binding/takeover, session eligibility/expiry/logout, request identity, expired-lease takeover, generation fencing, blocked owner/portal writes, terminal-result protection and uncertain-effect recovery. Frozen snapshots, pre/post-approval edit races, recipient/receipt changes, narrow-role restrictions and immutable approval evidence pass. Old $100 → New $9900 replacement-card repro still refuses old phone and web submissions; missing/forged bindings refuse, and opening the new card sends its displayed payload once. Today/notification, Engine and lead/project Ops coverage passes.
- **Hidden previews and transport:** native categories still require device authentication and foreground action launch, use generic hidden-preview placeholders, and set `showTitle:false`, `showSubtitle:false`. This does not impose in-app Face ID. Mocked HTTP/2 tests pass for cleanup headers, session reuse, token invalidation, bounded/redacted errors, deadline/error handling and credential-origin protection. APNs signing code is unchanged from the prior reviewed version; its temporary-key-file test was deliberately not rerun under the only-review-file-write constraint.
- **Database roles:** `node scripts/db-roles-scan.mjs --diff` exits 0 with intentional withholdings only. Manifest DB tests pass 6/6, including narrow-role secret isolation, owner approval boundaries and trigger security. No migration or privilege expansion was introduced.

## P1–P15 completeness

| Row | Assessment |
| --- | --- |
| P1 | Owner-kind routing, destinations, message metadata and native categories remain connected; base/parity regressions pass. |
| P2 | Shared channel gating, quiet hours, caps, parking/drain and summaries pass. |
| P3 | Decision hashes, current-card checks and allowed verbs pass, including account changes during target waits. |
| P4 | Shared approval effects and one-execution recovery pass. |
| P5 | Frozen draft sends, decline, stale binding refusals and matching web-area gates pass. |
| P6 | Request changes, pullback, request identity and origin delivery pass; revoked owner cannot mutate after waiting. |
| P7 | Card replies and owner-note behavior pass for decisions, grants and drafts. |
| P8 | Agent answers, acknowledgments and durable threading pass; inherited reply targets receive the owner recheck. |
| P9 | Portal posting and replyable acknowledgments pass; channel-lock account races refuse without posting. |
| P10 | Outcomes, cleanup/open state, badges and hold/expiry reconciliation pass. |
| P11 | Revised child threading and stale phone/web replacement refusals pass. |
| P12 | Replyable-only composer/category behavior is unchanged. |
| P13 | Owner-only phone/Telegram authorization, persisted UUIDs, lease fencing, recovery and the new target-wait authorization checks pass. |
| P14 | Settings/test contracts, transport isolation and channel behavior pass; signing implementation unchanged. |
| P15 | Payment/contract informational alerts retain contextual destinations without approval actions. |

## Follow-ups outside this feature

- Newsletter/first-response/bid-package staff sends remain outside this feature under Joe's binding decision.
- Staff SMS/call grants remain outside this feature under Joe's binding decision.

## Execution and optional items

Completed single-file runs, sequentially: `phone-push-r8-db` 12, `phone-push-r7-db` 13, `phone-push-r5-db` 23, `phone-push-r4-db` 18, `phone-push-r3-db` 25, `phone-push-r2-db` 26, `phone-push-db` 19, `phone-push-parity-db` 16, `db-roles-manifest-db` 6, `apns-transport` 9, `phone-push-r6-ui` 5: **172 passing tests in the completed validation runs, zero skips**.

Harness incident: stopped my sequential driver before the APNs temporary-file test to honor the write restriction. This interrupted its next schema setup, so an initial manifest run encountered an empty reviewer database (1 pass, 5 setup-related failures). Loaded the schema/migrations and reran the file: all 6 passed. This was a reviewer setup error, not a product failure; no process was killed by resource limits.

Used `SJC_TEST_CLUSTER_TAG=pushr9sec`, the existing QA Unix socket at port 5499, and only reviewer-created `sjcos_push_r9sec`. QA preload prevented automatic cluster startup and shared-name resets; databases were loaded from schema/migrations. Dropped the reviewer database after test processes finished. No cluster was started, so none required stopping. All tested outbound effects were fake/mocked. No live database/env/services, browser, Expo, simulator, server, build, tsc, staging or commits. This review file is my only filesystem write; other reviewers' files were left untouched.

Optional: carry forward the prior defense-in-depth suggestions about older PUBLIC database helpers and inherited error logging. Physical-device verification remains with the coordinator: actual APNs delivery, hidden-preview/device-auth presentation, killed-app handoff, background cleanup, keychain behavior and Ops presentation. These are the limits of this source/backend review, not new required source fixes.
