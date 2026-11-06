SCORES: design=9 completeness=9

Engineering judge, build round 9. Reviewed HEAD `7ac0a588` and all five files in `git diff 9eb7eb30 5b5776cc`, including shared authorization, approval, webhook, transaction and dispatch dependencies. The phone checkout is clean and unchanged at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

All probes use reviewer-owned QA databases on port 5499, real domain/API transactions and fake outbound providers. Refusals must preserve domain state and effects. Expectations below will not be relaxed to accept failures.

1. Phone Approve: deactivate and demote the authenticated owner while waiting on each decision/grant/draft target. A different active owner cannot substitute; refuse without approval, grant, snapshot, or send.
2. Phone Decline: deactivate and demote that owner during the draft target wait. Refuse with the draft and effects unchanged; decision Decline remains disallowed.
3. Phone Changes: deactivate and demote that owner during each decision/grant/draft target wait. Refuse without notes, pulls, triggers or sends.
4. Phone Hold: deactivate and demote that owner during each decision/grant target wait. Refuse without held fields/events.
5. Phone Reply: deactivate and demote that owner during each decision/grant/draft/portal wait, including inherited reply-only children. Refuse without notes, portal posts/activity, triggers or sends.
6. A phone reply to a converted lead's inherited portal alert waits on the effective project-channel advisory lock; owner demotion during that wait refuses without posting to either channel.
7. A real Telegram portal reply waiting on the shared channel lock refuses deactivation and demotion of the discovered owner, even if another active owner appears; phone and Telegram portal replies cannot take owner-before-channel locks.
8. Simultaneous phone, Telegram and web Approve on one draft, in every arrival permutation, settle without deadlock/error and create exactly one immutable snapshot and one send of the displayed text.
9. The same three-way race on a decision, in every arrival permutation, produces exactly one approved resolution and no deadlock/error.
10. Pause real phone mutations just after the owner FOR SHARE query for every verb: a legitimate owner profile update waits only for the mutation transaction and completes promptly after commit, even while outbound effects are paused.
11. With an owner update already holding its row lock, phone Approve must wait without a cross-channel cycle, then refuse if the update demotes the owner; Telegram/web approval on that target must settle without deadlock.
12. Staff with Today/Engine access retain their matching web draft approval/decline authority while phone APIs and Telegram remain owner-only; grant decisions remain owner-only even with ordinary delegated decision authority. No in-app Face ID is introduced.

Supplemental expectation 13, written before execution: Telegram Hold's cosmetic bot I/O must not retain the mutation's owner FOR SHARE lock while a network request stalls. Pause the fake outbound card edit after the real hold/account locks are acquired; a concurrent legitimate Profile update should complete while that cosmetic edit is pending. Otherwise inspect the production transport timeout and report the resulting account-edit blocking window.

## REQUIRED fixes

1. **Medium — move Telegram callback toast/card I/O outside the owner-locked transaction.** The R8 phone fix is correct, but the requested account-edit contention review found a remaining shared-channel issue. `lib/decisions/telegram.ts:190–191` locks the decision and owner, then Hold awaits `deps.answer` and `deps.edit` at lines 223–224. `app/api/telegram/webhook/route.ts:54` awaits that whole handler inside `withTransaction`; its edit adapter awaits the bot transport. `lib/providers/telegram.ts:94–98` gives each request a 10-second timeout. A slow Telegram service can therefore retain both locks for approximately 20 seconds on Hold, blocking legitimate owner Profile updates and other actions on the same decision. Changes, stale/refused/replayed decision callbacks also have in-transaction answers; replayed Approve can edit the card there too. Successful first Approve already defers its effects correctly.

   **Independent real-webhook repro (supplemental expectation 13):** create a pending decision; send a secret-authenticated callback `d|<decision-id>|<12-character hash>|h`. Wrap only the fake outbound transport so `editMessageText` waits on a promise; leave real SQL, domain checks, owner discovery, transaction and endpoint untouched. After that edit is reached, issue `UPDATE users SET name='Legitimate Profile edit', initials='LP' WHERE id=$1` on a separate connection with `lock_timeout='1500ms'`. This is the same non-key owner-row update used by the Profile form (`lib/actions/settings.ts:68`). `pg_blocking_pids` identifies the webhook connection as the blocker. The update fails with **55P03 after 1500 ms**, and a separate read still sees `held_until IS NULL`, proving Hold has not committed while the cosmetic edit waits. Release the fake edit: the webhook returns HTTP 200, Hold commits, and that same owner update succeeds. The expectation assertion fails unchanged. No real bot request or external send was made.

   Return pending toast/edit instructions from the transactional handler and execute them after commit, as successful Approve already does. Keep target → same active owner `FOR SHARE` authorization and atomic decision/update evidence; moving or weakening that check would reopen the fixed race. Add a stalled-transport regression proving owner profile/account updates complete while cosmetic I/O is paused, the domain outcome is already committed, and replay callbacks remain harmless. This finding is in existing callback integration exposed by the requested contention audit; it is not a regression introduced by the five-file fix.

## What was verified

**R8 required authorization fix: closed.** The common phone `locked(run)` now locks an optional action claim, then its work-item/decision target, then rereads and locks the same authenticated owner `FOR SHARE`. Reply-only descendants lock their inherited target too. Portal replies acquire the effective channel advisory lock before the same-owner check. The resolver catches the precise inactive-owner sentinel only after transaction rollback, returning a safe unauthorized refusal. It does not commit partial domain mutations or checkpoint effects on that path.

My fresh cases 1–5 drive the actual bearer-authenticated phone endpoint for **all five verbs**, using independent blocker/updater connections and observed database waits. They cover 17 combinations: Approve on decision/grant/draft; Decline on draft; Changes on decision/grant/draft; Hold on decision/grant; Reply on all four targets, both root and inherited child. After the endpoint is waiting on its target, another active owner is inserted and the authenticated owner is simultaneously deactivated and demoted. All 17 operations return HTTP 200 with `{ok:false,message:"No active owner account. Nothing was changed.",outcome:"unauthorized"}`. Full target/grant rows, snapshots, receipts, events, intents, replies, triggers, portal posts/activity and sends are preserved. Decision Decline remains disallowed. The initial deletion variant of these unexecuted expectations was refined before any execution: `push_actions.user_id` has a restrictive owner FK, so committed deletion during an API action claim is not a legal fixture. Combined active/role revocation exercises the live endpoint without circumventing that constraint.

The committed R8 file independently covers deactivation and demotion separately for those same targets, durable refusal/replay after account restoration, a valid new UUID and intended successful effects. It passes twice, including the original Decision Approve and Hold failures from my R8 report. A valid earlier approval still commits once before a later account change, which is the intended serialization.

**Portal integration:** fresh case 6 proves an inherited reply on an old converted-lead alert waits on the effective project channel, then refuses owner demotion without posting in either thread. Fresh case 7 drives real Telegram message webhooks against the channel lock and separately commits deactivation/demotion after discovery; both refuse the original owner even with another active owner available. No portal messages, activity or domain effects are added. Telegram's durable update records the refusal; its expected help/acknowledgment and alert housekeeping are not counted as domain mutations. Existing portal-telegram integration tests also pass.

**Approval lock ordering and races:** fresh cases 8–9 start phone, Telegram and callable web approval against the same externally locked card. Each waits in turn, proven through recursive `pg_blocking_pids`; all **six arrival permutations** run for both a draft and a decision. All settle without deadlock or endpoint errors. Drafts create exactly one immutable snapshot and send the displayed `Displayed $100.` body once; decisions create one approved event. No losing channel duplicates the effect.

The ordering is compatible rather than literally identical: phone takes its action row when present → target → owner; mapped Telegram draft actions enter that resolver without an action row; Telegram decision actions take decision → owner; web draft claims take the work item before freezing/claiming, and web decision resolution takes the decision first. Web authentication/area reads do not first retain a conflicting owner lock; staff decision authority remains distinct from owner-only channel authorization. Relevant FK key-share locks are compatible with owner `FOR SHARE`. Profile/team account updates are single owner-row updates and do not acquire target locks in reverse order. No lock-order cycle was found in these inspected paths or exercised approval races. The required fix concerns lock duration across Telegram network I/O, not a reproduced deadlock.

**Owner edits:** fresh case 10 pauses the actual production owner `SELECT ... FOR SHARE` only after it returns, for all five phone verbs (both decision and draft Approve). A concurrent Profile-style name/initials update blocks while the mutation remains open. After the real COMMIT executes, the probe pauses before post-commit effects; all six updates finish within **0–1 ms of observing commit**, comfortably inside the two-second expectation, while the HTTP action is still paused. This proves phone effects do not retain the account lock. Fresh case 11 begins an owner demotion update first, then starts phone, Telegram and web approval of the same draft; all settle without deadlock after release and phone refuses its revoked owner. A web approval authenticated before that update can finish; this probe establishes lock ordering and does not claim atomic web account-revocation enforcement.

**Joe's authority decisions:** fresh case 12 verifies Today-only and Engine-only staff through both Approve and Decline on both corresponding web surfaces, including a signed cookie falsely claiming owner and both areas. Matching database area succeeds; wrong area refuses with domain evidence unchanged. All eight equivalent phone action requests refuse with 403. Staff with delegated grant/action authority cannot approve the bridged grant decision; Telegram refuses without an active owner. The unchanged R5/R7 matrices additionally cover record Ops, shared notifications/popup actions, ordinary delegated decision authority, forged role tokens, revoked/inactive accounts, bindings, visibility and owner-only grants. No blanket web owner gate or in-app Face ID was introduced.

**Rest of the diff:** all three changed production files, the new test file and its expectations were reviewed. Portal refusal handling catches only the intended sentinel and preserves durable webhook refusal; the new channel lock is shared by both callers and follows converted threads. The common phone check covers replies and changes before any note, pull or checkpoint. Existing frozen-content/generation/recovery/parity behavior remains covered by the repeated regressions. There are no new tables, migrations, trigger functions or privilege changes. Installed Next.js 16.2.9 server-function guidance was inspected; no new framework API incompatibility was found. Native sources remain unchanged, with no in-app biometric authentication call found.

## Test results

All requested files ran individually and sequentially with `SJC_TEST_CLUSTER_TAG=pushr9eng`. Each phone-push DB file ran twice on its same per-file database, with no schema reload/reset between executions beyond the test's normal fixture cleanup.

| Test file | Passes per execution | Executions |
| --- | ---: | ---: |
| phone-push-r8-db | 12 | 2 |
| phone-push-r7-db | 13 | 2 |
| phone-push-r5-db | 23 | 2 |
| phone-push-r4-db | 18 | 2 |
| phone-push-r3-db | 25 | 2 |
| phone-push-db | 19 | 2 |
| phone-push-delivery-db | 12 | 2 |
| phone-push-parity-db | 16 | 2 |
| phone-push-r2-db | 26 | 2 |
| phone-push-sweep-db | 3 | 2 |
| telegram-events-done-db | 1 | 1 |
| telegram-replies-db | 1 | 1 |
| telegram-draft-replies-db | 1 | 1 |
| portal-telegram-db | 3 | 1 |
| approve-work-item-db | 1 | 1 |
| approved-draft-rules | 20 | 1 |
| db-roles-manifest-db | 6 | 1 |
| db-roles-paths-db | 2 | 1 |
| phone-push-r6-ui | 5 | 1 |

Unchanged regressions: **374 passed, zero failed/skipped; 19 files / 29 executions.** Fresh expectations 1–12 pass after correcting a case-12 fixture boundary: its first attempt captured alert evidence before the probe itself assigned a Telegram message id and before cleanup of previously resolved draft alerts. Its failure diff showed only that mapping and expected `cleanup_pending` transitions; domain assertions were intact. The corrected run prepares the mapping and runs ordinary cleanup before capturing its baseline; the original authorization/effect expectation passes. The first fresh run was 11 pass / 1 fixture failure, followed by the corrected case-12 run at 1/1. Supplemental expectation 13 is **one reproducible product failure**, supporting required fix 1. All fresh code used stdin and loader hooks in memory; no test source was written.

`node scripts/db-roles-scan.mjs --diff` exits 0 with only intentionally withheld permissions. Manifest privileges and actual narrow-role paths pass. `git diff --check` passes. No tsc was run because the allowed command writes incremental build-info and the task permits only this review file as a filesystem write. No build, dev/start server, browser, real APNs/provider request, live database or service was used.

## Optional items / coordinator checks

- Physical-device APNs delivery, hidden previews, killed-app handoff and Notification Center cleanup remain coordinator checks. Native source/test inspection is not a device certification.
- Retain the prior optional discoverability issue: limiting pending decisions before principal filtering can crowd out an older authorized staff card.
- Visually check long Ops approval text and the waiting note at narrow widths; the unchanged five UI structural tests pass.

## Cleanup

Used only QA PostgreSQL at socket `/home/joe/qa-sjcos`, port **5499**, login `postgres`, with **21** reviewer-owned databases prefixed `sjcos_push_pushr9eng_` (one freshly migrated base, 19 per-file clones, one fresh-probe DB). Schema/migrations used both explicit `DATABASE_URL` and an explicit migration URL. An in-memory harness adapter prevented automatic cluster startup and selected only these reviewer URLs. The legacy Telegram test received its own explicit `FIN_TEST_DATABASE_URL` and synthetic owner.

All 21 databases were dropped; the namespace count is zero. Tagged `stopCluster` reports no reviewer cluster running: none was started, and the existing shared QA server remains running. No `sjcos-qa-push-*` or live service was stopped. Other judges' round-9 review files appeared during this turn and were left untouched. No source, phone checkout, other review file, stage, commit or deploy was changed.
