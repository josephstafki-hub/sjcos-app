SCORES: design=10 completeness=10

Security and completeness judge, build round 10. Reviewed `git diff 7ac0a588 687bb315` at HEAD `c405469c`. The intervening HEAD changes are round 9 review documents only. Verified the native checkout remains clean at `5b1b883`. No required fixes remain within Joe's binding scope.

## REQUIRED fixes

None.

## Verified

- The transactional Telegram handler no longer receives transports. It returns ordered answer/edit instructions; the webhook awaits `withTransaction` (including COMMIT) before `finishOwnerAction` sends them. Rollback cannot send a queued success, edit, or changes prompt. First approval still performs its post-commit effects before reporting the outcome. Only the winning approved resolution enters that effects branch.
- Authorization branches and reply text remain equivalent, apart from the intentional consistent `INACTIVE_OWNER` help text. Chat and sender must match the configured owner; bot/forwarded callbacks refuse. Target locking and the same owner's active/role `FOR SHARE` check remain inside the mutation transaction. Work-item dispatch retains its separate target/account-locked mutation. No owner authorization was moved into the cosmetic reply loop.
- The new R9 test file passes all 10 tests: stalled Hold/Approve/duplicate Approve/Decline/draft-send toasts and edits, Changes prompt, text reply, stale/inactive/resolved refusals, and forced pre-commit rollback. Independent connections can update Profile and lock the target during transport stalls; audit/domain state is already committed. Replay never adds an approval, send, hold, prompt or owner note. Rollback emits nothing and leaves no committed dedupe row; retry succeeds once.
- Additional inline real-webhook checks pass for stranger, bot, forwarded, inactive-owner, stale-hash and expired Approve callbacks and their duplicates. Refusal toasts contain refusal wording, no success claim and no target title. The first five produce no card edit. Expired Approve retains its authorized-owner card presentation. Duplicate callbacks preserve domain state and create no approval event. No new content destination or sensitive field was introduced by deferral; the existing secret-authenticated update/dedupe boundary is unchanged.
- R8 target-wait tests pass for all 34 supported target/account-change combinations, including a second active owner that cannot substitute for the initial principal. Account updates remain blocked through an authorized mutation's commit. Concurrent phone/Telegram approvals pass in both arrival orders.
- R3–R7 defenses pass: token/session ownership and eligibility, inactive/demoted/revoked authentication, owner-only native paths, authorized matching-area staff web actions, immutable displayed snapshots and stale replacements, action identity, lease takeover/generation fencing, terminal results, narrow-role restrictions, uncertain-effect recovery and owner/portal writes. No schema, privilege or native implementation changed in this round.
- `node scripts/db-roles-scan.mjs --diff` exits 0 with intentional withholdings only. The six manifest DB tests pass, including secret isolation and trigger/approval boundaries. Mocked APNs transport tests pass; signing and hidden-preview/device-auth code are unchanged. Joe's no-in-app-Face-ID decision is preserved.

## P1–P15 completeness

| Row | Assessment |
| --- | --- |
| P1 | Owner-kind routing, metadata, categories and contextual destinations retained; base/parity tests pass. |
| P2 | Shared gating, quiet hours, cap exemptions, parking, drain and summaries pass. |
| P3 | Decision actions and stale-card checks pass; refusal/hold/approval presentation survives transport deferral. |
| P4 | Shared approval effects remain post-commit and execute once; reported outcomes retained. |
| P5 | Frozen draft approval/send, decline and stale/pulled-card refusals pass. |
| P6 | Changes toast/prompt is post-commit; typed changes pull and hand off once. |
| P7 | Decision/grant/draft owner notes and pullback pass with account rechecks. |
| P8 | Agent replies, acknowledgments and inherited reply targets/threading remain covered. |
| P9 | Portal replies, channel locking and replyable acknowledgments pass. |
| P10 | Card outcomes, open state, badge and cleanup reconciliation pass; cosmetic edits release transaction locks. |
| P11 | Revised child threading and stale phone/web replacement refusals pass. |
| P12 | Replyable-only composer/category behavior unchanged; UI source checks pass. |
| P13 | Owner-only phone/Telegram authorization, durable UUID/update dedupe, fencing and recovery pass. |
| P14 | Settings/test contracts, channel isolation and mocked HTTP/2 transport tests pass. |
| P15 | Payment/contract informational destinations remain intact without approval actions. |

## Follow-ups outside this feature

- Newsletter/first-response/bid-package staff sends remain outside this feature under Joe's binding decision.
- Staff SMS/call grants remain outside this feature under Joe's binding decision.

## Execution and optional items

Sequential single-file runs: `phone-push-r9-db` 10, `phone-push-r8-db` 12, `phone-push-r7-db` 13, `phone-push-r5-db` 23, `phone-push-r4-db` 18, `phone-push-r3-db` 25, `phone-push-r2-db` 26, `phone-push-db` 19, `phone-push-parity-db` 16, `db-roles-manifest-db` 6, `apns-transport` 9, `phone-push-r6-ui` 5: **182 passing tests, zero skips**, plus the six inline refusal/replay scenarios.

Used `SJC_TEST_CLUSTER_TAG=pushr10sec`, existing QA Postgres :5499 and only reviewer-created `sjcos_push_r10sec`, loaded from schema/migrations. QA preload prevented automatic cluster startup or shared database resets. Dropped the reviewer database after testing; no cluster was started, so none needed stopping. Initial connection attempts used nonexistent QA roles and made no changes. The first inline transport assertion encountered the harness's outbound-disabled short circuit; reran with its fake Telegram transport enabled and network fetch blocked, and all six scenarios passed. These were reviewer setup corrections, not product failures. No exit 137/Killed occurred.

This review file is my only filesystem write. No live DB/env/services, shared QA database, server, browser, Expo, simulator, build, tsc, staging or commit. Other reviewers' files were left untouched.

Optional: carry forward prior defense-in-depth notes on older PUBLIC helpers and inherited error logging. Physical APNs delivery, hidden-preview/device-auth presentation, killed-app handoff, background cleanup, keychain behavior and Ops presentation remain coordinator/device verification limits, not newly required source fixes. The APNs temporary-key-file signing test was not rerun under the only-review-file-write constraint.
