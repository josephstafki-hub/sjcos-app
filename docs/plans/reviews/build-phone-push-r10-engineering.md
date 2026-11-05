SCORES: design=9 completeness=8

Engineering judge, build round 10. Reviewed HEAD `c405469c`, the entire five-file fix `git diff 7ac0a588 687bb315`, and the reachable transaction, authorization, dispatch and delivery dependencies. Phone checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` remains clean at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

Use reviewer-owned QA databases on port 5499, real endpoint/domain transactions, and fake outbound transports. No expectation will be relaxed to accept a product failure.

1. Stall Telegram Hold's first callback toast: Hold and its audit must already be committed; an independent Profile name/initials update and target lock must finish within 1500 ms while transport remains stalled. Replaying the update must not add a second held event.
2. Stall Telegram Hold's card edit: the same committed-state/unlocked-owner checks must pass, and its toast must precede the edit.
3. Stall first Telegram decision Approve's toast and edit separately: approval/event must already be committed, Profile and target updates must complete, and replay must not repeat approval effects.
4. Stall Telegram draft Reject's toast/card edit: rejection must already be committed, Profile and target updates must complete, and replay must preserve rejection without any send.
5. Stall Telegram Changes' toast and follow-up prompt separately: callback audit must already be committed, Profile and target updates must complete, and duplicate update delivery must not create a second prompt.
6. Stall callbacks for missing/stale decisions, unauthorized sender, resolved Changes/Hold, replayed Approve and duplicate update: all reachable cosmetic I/O must occur after committed audit evidence with no owner/target lock retained; refusal must preserve domain state.
7. Inject rollback after a real Hold mutation but before callback audit completion: no outbound provider call, held event or dedupe row may survive; retry must apply once.
8. Simulate process loss immediately after Telegram draft callback commit and before post-commit dispatch, then redeliver the identical update: a client-facing draft must either be recovered exactly once or have durable, actionable recorded recovery evidence. A misleading terminal successful audit with a silently lost draft send is unacceptable.
9. Simulate process loss after Telegram decision approval commit but before approval effects: durable recovery must execute required effects exactly once, or expose an explicit held/failed state for reconciliation; duplicate delivery must never reapprove or duplicate a send. Cosmetic toast/edit loss alone is acceptable when domain/audit state remains available.
10. Stall actual email/APNs/portal delivery reached from phone/web/Telegram approval paths: no network provider may run inside a transaction retaining target/owner locks. Durable send/reconciliation records must guard crash ambiguity; matching-area staff retain web authority, while phone/Telegram remain owner-only and no in-app Face ID is introduced.

Supplemental expectation 11, written before execution: interrupt Telegram, callable web and phone draft approval immediately after the real transaction COMMIT that freezes the approved draft and flips its approval gate, before any send intent is enqueued. Redelivery, a new tap, or the dispatch sweep must recover the immutable approved send once, or expose an explicit held/failed recovery state. A permanently approved item with no send intent, no warning and no recovery is unacceptable.

## REQUIRED fixes

1. **Medium — persist recoverable draft-dispatch work with the approval, including Telegram's pre-dispatch callback.** `lib/decisions/telegram.ts:136–139,183–187` records a draft callback as `work item approve: dispatched` and closes its source event before `lib/owner-actions.ts:49–58` actually invokes the action. Interrupt immediately after that callback transaction commits: the real webhook's identical redelivery returns `{ok:true,duplicate:true,outcome:"work item approve: dispatched"}` but never invokes the action. A real dispatch pass does not recover it. The work item remains requested, with zero snapshots, intents or emails; the callback receipt falsely says dispatched.

   The more consequential second window is **after the approval itself commits**: `lib/approve-work-item.ts:150–155` commits the frozen snapshot and approved gate, then calls `finishApproval`; `lib/approved-draft-send.ts:161–174` creates the durable email intent only later. My independent probe injects an exception immediately AFTER the actual PostgreSQL COMMIT containing `INSERT INTO approved_work_item_drafts`, before returning to the caller. Both real Telegram approval and callable web approval leave `approval_status='approved'`, `status='queued'`, one frozen snapshot, `blocked_reason=NULL`, **zero intents and zero emails**. Identical Telegram redelivery is deduped; a fresh Telegram tap still cannot send. Web retap returns `Already approved — nothing more was sent.` A real dispatch pass creates/sends nothing. There is no pending-effect record, automatic recovery or explicit failure/held state on these channels. This is a lost client-facing send, not an acceptable missing cosmetic toast.

   The phone API provides the useful counterexample: it commits `push_actions.phase='effects_pending'` with `approvedDraftId` evidence in the approval transaction. After the same interruption and lease expiry, retry returns durable `needs_review` with the approved work item and empty sends. That explicit recorded uncertainty satisfies the review expectation; do not weaken it.

   Persist pending dispatch/recovery evidence atomically with the approved snapshot, then consume it after commit with fencing/idempotency, or expose a durable actionable failure/held state. Persist Telegram callback dispatch as pending until its domain action settles, with safe replay/recovery. Never fix this by putting transport back under locks or by blindly reapproving/resending. Add crash-boundary regressions for both windows, including the portal-draft branch that shares this approval boundary. These are existing recovery gaps exposed by the requested crash audit, not regressions newly introduced by R9.

2. **Medium — commit missing-decision refusals without violating the audit FK.** `lib/decisions/telegram.ts:198–201` queues `That decision no longer exists.` but then passes the absent UUID to `finish`; line 143 writes it into `telegram_updates.decision_id`, which references `decisions(id)` (`db/migrations/0004_decision_surfaces.sql:50`). The real secret-authenticated webhook returns HTTP 200 with `{ok:false,error:'…telegram_updates_decision_id_fkey…'}`. The transaction rolls back and **no refusal toast is sent**, because queued replies now correctly wait for commit. Repeated delivery hits the same error. A well-formed callback for a nonexistent UUID reproduced this twice; an additional old-card/deleted-decision probe reproduces the same FK failure. No unauthorized domain mutation occurs.

   The final isolated probe creates a real card, deletes its alert/decision rows, then posts its original callback with both an active and an inactive owner. Both return the FK error, with zero committed callback/source-event rows and zero outbound calls. Persist a null FK when the target does not exist, preserving the requested UUID in safe audit detail if needed, and send the queued refusal after commit. Cover inactive-owner/missing-target combinations too: lines 181 and 196 can also pass an unverified target UUID to `finish`. Add actual-webhook tests asserting committed refusal/dedupe evidence, harmless retry and exactly the expected post-commit toast. R9's regression matrix currently omits this advertised missing-target branch. The underlying FK problem predates R9; moving the toast exposes its failure to reach the user.

## What was verified

**R9 required lock-duration fix: closed.** All five touched files were read individually. The webhook no longer passes any transport into `handleTelegramUpdate`; its only dependencies are owner identity discovery and presentation configuration. The handler builds ordered answer/edit data, and the endpoint invokes `finishOwnerAction` only after `withTransaction` returns. Duplicate/refused/stale/resolved callbacks preserve the order and wording of their queued replies. First successful Approve still waits for effects before its toast/card edit. Target → same active owner `FOR SHARE` checks remain intact; INACTIVE_OWNER cleanup is consistent. There are no new tables, migrations, trigger functions or privilege changes.

**Independent before/after R9 repro:** loaded the three pre-fix production modules from `7ac0a588` through in-memory loader hooks, leaving real SQL, endpoint and domain code intact. With fake `editMessageText` blocked on a promise during Hold, both cosmetic provider calls observe an open application transaction, a separate read sees `held_until=NULL`, and the independent Profile-style `UPDATE users SET name=…,initials=…` fails with **55P03 after 1501 ms**. Releasing transport commits Hold. On current code, fresh cases 1–5 pause Hold, first Approve, draft Reject and Changes at their actual toast/edit/prompt calls. Independent Profile updates and `FOR UPDATE` on the target complete in **1–2 ms**, while transport remains blocked; domain state and callback audit are already committed. Replays preserve one resolution/prompt and no extra email.

**Fresh adversarial results:** expectations 1–5 and 7 pass; expectation 6 passes stale, unauthorized sender, resolved Changes/Hold, replayed Approve and duplicate-update variants, but fails the missing decision variant (required fix 2). Rollback injection after Hold but before audit completion leaves no held event, dedupe row or outbound call, and retry applies once. Expectation 8 fails (required fix 1). Expectation 9 passes after correcting its fixture to stage a decision covering `send_email`, the actual recipient/target and content hash: the approved, already-durable intent survives interruption before post-commit effects, sends once on the real dispatch pass and never sends again on a second pass. The initial invalid fixture was correctly refused for covering `qa.review` instead of `send_email`; it was not a product failure.

Expectation 10 passes: paused actual email transports on phone, callable web and Telegram draft approvals observe zero open application transactions, an already-approved item and a durable leased send intent; independent Profile/target writes complete in 1–2 ms. A fake HTTP/2 APNs cleanup request paused after phone Hold also permits those writes while Hold is committed. A real approved portal-draft path posts exactly one frozen `Frozen portal $100.` body. Its post is SQL into the local portal, not an external HTTP transport. The initial APNs probe's fixed 100-query polling budget ended before the fake request arrived; the corrected probe waits for the request with a five-second deadline and passes unchanged lock/domain assertions. Supplemental expectation 11 fails Telegram and callable web, and passes phone's explicit `needs_review` recovery evidence.

**Transaction/network call-graph audit:** searched transaction/lock scopes and provider/transport/fetch/send/dispatch entry points, then followed the called functions rather than relying on nearby grep matches:

- Telegram endpoint transaction → handler → source-event/dedupe SQL, owner discovery/locking, decision Hold/resolve, owner-reply recording and portal-reply recording. `resolveFromChannel` → decision/grant settlement, intent wake/cancel, invoice creation, markup/workflow/QBO-conflict settlement and agent-trigger enqueue are SQL-only on their `run`; QBO-conflict settlement does not contact QuickBooks. Owner-reply triggers and reply-target mappings also use SQL only. Portal replies retain the effective-channel advisory lock and owner share lock through the SQL post/activity evidence, then commit before any acknowledgment.
- Phone claim/mutation transactions → action-row fence, target/binding checks, owner share lock, snapshot/approval or rejection, Hold, reply/portal SQL and effect checkpoint. `finishApproval`, `performApprovalEffects`, Telegram refresh/mirroring, agent delivery, APNs cleanup and action-result alerts all run afterward. The claim/reclaim CTE locks do not enclose transport.
- Web Engine/Today, record Ops and shared-popup draft approvals → area authorization, `claimApproval`/snapshot transaction, then `finishApproval`. Web decision actions → authority check, resolution transaction, then `afterResolve`/effects/Telegram refresh. Grant-page approval settles its grant before staged execution/dispatch. No added owner-only gate blocks matching-area staff.
- Dispatcher → claim/preflight/authority transaction COMMIT → `provider.send` → outcome/effects transaction. Reconciliation performs `provider.reconcile` before its outcome transaction. Dispatch effects insert notification rows directly, without calling the network-emitting notifier. Approved email enqueue commits before dispatch. Approved portal-draft posting is outside the approval transaction and uses database writes. Push delivery and summary jobs commit their lease/delegation statements before Telegram/APNs delivery; the summary `FOR UPDATE` transaction contains only SQL.

**No network I/O was found inside a locked transaction on these reachable approval/reply paths.** The remaining issue is durability between transactions, not a reason to move network calls into them.

**Crash semantics and limits:** already-staged action intents have permanent operation keys, leases, authority records and provider reconciliation; ambiguous client sends are held rather than blindly resent. The requested repeated regressions exercise overlapping actions, stale generation fencing, frozen-content dispatch, failed-send retry, portal dedupe and saved-resolution recovery. Approved staged grants also have a post-commit sweep. This does not cover the missing draft-intent window documented above, and it is not a blanket certification of every billing/refund/release recovery path. Cosmetic callback toasts/edits may be lost on a process crash after commit; that loss is acceptable because Hold/approval/refusal and their audit are durable and the UI can read the actual state. Changes' absent prompt does not pull anything; the original card still accepts text replies. Owner pushes are documented best-effort (`lib/notify-owner.ts:16`), backed by durable history/outbox and per-device delivery receipts. Apple/Telegram acceptance before its receipt is saved can cause a repeated cosmetic notification on retry; there is no exactly-once transport guarantee. Such a notification never authorizes another domain action.

**Joe's binding decisions:** repeated R5/R7/R8 matrices retain matching-area staff web Approve/Decline, reject forged owner/session-area claims and demotion, and keep grant decisions, phone action APIs and Telegram owner-only. The mobile repository is unchanged; the biometric/Face ID source search finds no new in-app authentication gate. No design/security decision was overridden.

## Test results

All files ran individually and sequentially with `SJC_TEST_CLUSTER_TAG=pushr10eng`. Every phone-push DB file ran twice on the same per-file database, without reloading/resetting its schema between runs; ordinary test fixture cleanup was left intact.

| File | Passes each run | Runs |
| --- | ---: | ---: |
| phone-push-r9-db | 10 | 2 |
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

**389 passed; zero failed/skipped, 19 files / 30 executions.** Fresh expectations are reported separately above and are not included in that passing regression count. Early probe-harness errors (a Buffer source requiring string conversion, the invalid decision authority fixture and the short APNs wait) were corrected in memory; product-failure expectations were unchanged. A supplemental missing-target evidence assertion encountered an old source-event id from an earlier probe run; the final isolated missing-target check uses a fresh database. No test source was written.

`node scripts/db-roles-scan.mjs --diff` exits 0 with only intentionally withheld permissions. Both narrow-role test files pass. `git diff 7ac0a588 687bb315 --check` and working-tree `git diff --check` pass. No tsc was run: the permitted invocation can write incremental build-info and this review permits only one file write. Installed Next.js server-function guidance was inspected; this change introduces no framework API use.

## Optional items / coordinator checks

- Physical-device APNs delivery, killed-app action handoff, hidden previews and Notification Center cleanup remain coordinator checks. No browser, app server or device was started.
- Callback toasts and card edits are intentionally best-effort; optionally state that explicitly beside the queued reply type so later changes do not mistake it for a durable effect outbox.
- Retain the prior optional staff-card discoverability and narrow-width Ops visual checks.

## Cleanup

Used QA PostgreSQL only: socket `/home/joe/qa-sjcos`, port **5499**, `postgres`, databases owned by this review under `sjcos_push_pushr10eng_`. A freshly migrated base supplied 19 per-file clones plus the independent-probe database. An in-memory harness adapter selects only the explicit reviewer URL and prevents automatic cluster startup or schema marker writes. All migration invocations had an explicit `DATABASE_URL` and explicit migration URL. The legacy Telegram reply test received its own explicit `FIN_TEST_DATABASE_URL` and synthetic owner.

All **22** reviewer databases (the initial 21 and the final isolated missing-target probe database) were dropped; the reviewer namespace count is **zero**. No tagged cluster was started; tagged `stopCluster` returned false. The existing shared QA server and all `sjcos-qa-push-*` units were left running. No live database, live env file, protected service, build, browser, deployment, stage or commit was touched. Other judges' untracked round-10 review files were left untouched.
