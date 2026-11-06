SCORES: design=8 completeness=8

Engineering judge, build round 8. Reviewed `git diff 96ec1fc4 025818cf` at HEAD `9eb7eb30`, including all 12 touched files and their shared authorization/claim/dispatch dependencies. The phone checkout remains clean at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`.

**The R7 Telegram required fix is verified and closed. One high-priority phone decision authorization race remains.** It is an existing gap in the shared resolver's phone branch, exposed by this round's lock-order review, rather than a regression in the repaired Telegram callback. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

Use only reviewer-owned databases on QA PostgreSQL port 5499, real domain/webhook/action code and fake outbound providers. Refusals preserve target records, approved snapshots, successful resolution events and sends. Probes are loaded in memory without source edits.

1. Bound Telegram draft Approve blocked on its work-item lock must refuse if the same owner is deactivated before that lock is released, even if another active owner exists.
2. Bound Telegram draft Approve under the same wait must refuse a demoted owner; no snapshot or email may be created.
3. Unmapped legacy Telegram Reject must refuse deactivation committed during its work-item lock wait.
4. Unmapped legacy Telegram Reject must refuse demotion committed during its work-item lock wait.
5. Decision Telegram Approve must refuse deactivation committed during its decision lock wait; the decision remains pending.
6. Decision Telegram Approve must refuse demotion committed during its decision lock wait.
7. Decision Telegram Hold must refuse deactivation committed during its decision lock wait; no hold event may be recorded.
8. Decision Telegram Hold must refuse demotion committed during its decision lock wait.
9. Bound Telegram draft Reject must refuse deletion of the discovered owner during its target-lock wait; no other owner may be substituted.
10. While an authorized Telegram draft claim holds the target and owner locks, a role/active change must wait until that transaction finishes. A valid earlier approval can commit once and send only its displayed frozen text.
11. A simultaneous web approval and Telegram approval of the same displayed draft must settle without deadlock, create one snapshot and send one email.
12. A simultaneous phone approval and Telegram approval of the same displayed draft must settle without deadlock, create one snapshot and send one email.
13. Today-only staff may see and approve/decline shared Today/notification/popup and lead/project Ops drafts; Engine-only staff may act on Engine but cannot see or mutate the shared drafts. Wrong areas must preserve evidence; stale displayed bindings must refuse.
14. Matching-area staff and forged owner-role tokens must remain unable to use owner phone alert APIs or Telegram; grant decisions remain owner-only even with ordinary decision authority.
15. Long duplicate Ops draft text remains fully readable; unauthorized viewers see “Waiting on approval.” without controls; each phone-push DB test file passes twice on the same database, without schema resets between repeats, and required Telegram/portal/role regressions pass.

Supplemental expectations, also written before their execution: the lock-order inspection found that phone decision actions do not call the new owner-lock helper. (16) A real bearer phone decision Approve waiting on its decision row must refuse if the authenticated owner is deactivated before release, leaving it pending. (17) The equivalent phone Hold must refuse demotion committed during its decision lock wait, leaving hold fields and hold events unchanged. The same owner-only rule applies to phone alerts and Telegram.

## REQUIRED fixes

1. **High — make phone decision Approve and Hold recheck and lock the same active owner inside their mutation transaction, after the target lock.** `lib/owner-actions.ts:205` calls `locked(run)` and immediately `holdDecision`; line 210 calls `locked(run)` and immediately `resolveFromChannel`. Neither calls `lockActiveOwner`. The new check at line 171 protects the work-item branch only. The API's owner gate (`app/api/mobile/push/[...path]/route.ts:32`) runs before the target-lock wait, and the saved principal is passed at line 75. `authorityFor` (`lib/commands/decisions.ts:216`) trusts an owner-shaped principal without rereading the account; Hold trusts its caller.

   Two independent probes used the **real bearer-authenticated phone API**, real JWT/account lookup, domain transaction and dispatch code, and only fake outbound providers. Expectations 16–17 above were saved before execution. Deterministic ordering: connection A begins and locks the decision `FOR UPDATE`; start `f.action(c.m, verb)` on B; observe B waiting on A using `pg_blocking_pids`; commit the account update on connection C with a two-second lock timeout; release A; inspect the HTTP response, decision and resolution events.

   - **Approve after deactivation:** expected pending decision and refusal. Actual HTTP 200 `{ok:true,message:"Approved ✓",outcome:"approved"}`, `status='approved'`, `decided_via='app'`, and one successful resolution event. `active=false` committed before B acquired the decision lock.
   - **Hold after demotion:** expected unchanged hold fields/events and refusal. Actual HTTP 200 `{ok:true,message:"Held for 4 hours.",outcome:"held"}`, non-null four-hour `held_until`, `hold_note='Held from the app'`, and one held event. `role='staff'` committed before B acquired the decision lock.

   These fixtures deliberately had no held send intent: no email was sent or claimed to have been reproduced. Unauthorized decision resolution and postponement are independently demonstrated. Both test assertions failed against their original expectations; neither was changed to accept the bad result.

   Apply the existing same-account owner-lock check after `locked(run)` and before either mutation/checkpoint; keep target → owner ordering and refuse before effects. Add deterministic real-phone lock-wait coverage for deactivation/demotion. Preserve staff's matching-area web draft actions and delegated decision authority: a blanket owner gate in the shared web decision resolver would violate Joe's decision. No requirement to undo a valid approval committed before a later account change.

## What was verified

**R7 Telegram atomicity: fixed.** Fresh independent cases 1–9 hold the target row, start the actual webhook, observe its database lock wait, then commit deactivation/demotion/deletion before releasing the lock. Bound draft Approve, unmapped legacy Reject, decision Approve and decision Hold all refuse deactivation and demotion. Bound Reject also refuses deletion. Each fresh probe adds a different active owner *after discovery but before the account update*, proving the repaired operation cannot substitute that other account. Target rows, snapshots, receipts, successful resolution/hold event counts, intents and sends remain unchanged. Durable `telegram_updates.outcome` records the refusal. The committed 10 callback race combinations also pass twice.

`lockActiveOwner` selects the original principal's user id `FOR SHARE` and checks both `active` and `role`. This lock conflicts with non-key role/active updates and deletion. Fresh case 10 pauses the actual Telegram draft transaction immediately after that real SELECT returns, starts a role/active update on another connection, observes the update blocked, verifies that approval is still uncommitted, then releases the transaction. The valid earlier approval commits, creates one snapshot and sends exactly the displayed body once; the account update subsequently completes. Instrumentation adds only an in-memory await after the SELECT; it does not substitute its query or verdict.

**Lock ordering: no new cross-channel deadlock found.** Telegram decision callbacks lock the decision then the owner. Legacy Telegram Reject locks the work item then the owner. Mapped Telegram and phone draft Approve/Decline take the action row when applicable, then the work item, then the owner. `claimApprovalInTransaction` reacquires its already-held work-item lock; snapshot insertion and sending retain their existing order. Web draft claims lock the work item without first holding an owner row lock. Web decision claims lock the decision; owner authentication is an ordinary read, and staff authority checks do not hold an incompatible owner lock. Foreign-key key-share locks are compatible with the new share lock. No inspected approval path holds an owner write/share lock and then waits for the target in the reverse order.

Fresh cases 11–12 force two approvers to wait on the same external work-item lock, then release it. Web versus Telegram and phone API versus Telegram settle in both arrival orders, without deadlock/error, with exactly one approved snapshot, exactly one email and the displayed subject/body. Phone decision actions currently take no owner lock at all; that omission is required fix 1, not a lock-order inversion. This establishes the exercised orderings, not a universal proof about every transaction in the application.

**Joe's web area rules: correct.** Shared Today/notification/popup reads now gate drafts on Today; their callable Approve/Decline actions independently use `requireAccess('today')` and the same domain claim helpers. Engine still requires Engine; both record Ops surfaces require Today. Fresh case 13 uses a signed staff-account cookie falsely claiming owner and both areas, while changing only the real database permission between Today and Engine. Visibility, all eight callable draft routes, refusal evidence and exact displayed-binding behavior follow the database area, not the cookie claims. Authorized approvals send the displayed content once; stale bindings refuse. Existing R5/R7 matrices also retain owner, revoked/inactive/demoted account and no-area refusal coverage. Ordinary decision authority remains separate from area access.

**Owner-only boundaries before waits: retained.** Fresh case 14 denies settings/open/messages/message detail/test/action to matching-area staff and to a staff account with a signed owner-role JWT (12 real-bearer API checks, all 403). Telegram refuses when no active owner remains. Explicit ordinary authority for both a grant decision's action and its `grant` kind does not let staff Approve/Reject/Request changes through direct or popup web actions, and polling hides the grant card. The first attempted version of this probe used invalid authority action `qa.review`; the real schema correctly rejected that fixture before its grant assertions. It was rerun with valid `proposal` and `grant` rows, preserving the original expectation; the corrected case passes. The phone race failures concern revocation *during* a wait, not these already-unauthorized cases.

**UI and diff details: verified structurally.** The Ops note is exactly “Waiting on approval.”, visible for pending approvals without Today and accompanied by no approval controls. Fresh case 15 compiles the unchanged production WorkItemCard and evaluates Unicode/multiline bodies, contextual suffixes, absent receipts, both record kinds and both permission states. Full internal approval bodies remain unclamped, preserve wrapping/newlines and retain their entire text. Authorized handlers submit the displayed binding. The five committed UI tests also pass. No browser layout claim is made.

The changed R3 assertion now matches the actual unauthorized `$9900` price instead of a coincidental `9900` substring in a UUID; it still checks the frozen original price and rejects the changed recipient. R5's area expectation now matches Joe's Today rule. New R7 tests exercise actual webhook POSTs, independent blocker/updater connections, durable refusal evidence and finally-block lock cleanup; they do not replace domain authorization. Existing frozen binding, immutable snapshot, generation-fence, uncertain-send, recovery, replay, portal and delivery tests all pass. No new tables, migrations, trigger functions or grants are introduced. Reviewed installed Next.js 16.2.9 server-function/data-security guidance; actions retain server-side authentication and revalidation. No framework incompatibility found by inspection.

## Test results

**15/15 original fresh adversarial expectations pass after the invalid fixture was corrected. Supplemental cases 16–17 fail and support required fix 1.** All probe code was supplied over stdin and appended to unchanged modules only in memory through loader hooks; no probe/test file was created or changed.

Every requested test file ran individually and sequentially with `SJC_TEST_CLUSTER_TAG=pushr8eng`. All nine phone-push DB files passed twice on their same per-file database, with no schema reload or database reset between repeats. Only committed fixture cleanup ran between executions.

| File | Passes per run | Runs |
| --- | ---: | ---: |
| phone-push-r6-ui | 5 | 1 |
| phone-push-r7-db | 13 | 2 |
| phone-push-r5-db | 23 | 2 |
| phone-push-r4-db | 18 | 2 |
| phone-push-r3-db | 25 | 2 |
| phone-push-db | 19 | 2 |
| phone-push-delivery-db | 12 | 2 |
| phone-push-parity-db | 16 | 2 |
| phone-push-r2-db | 26 | 2 |
| phone-push-sweep-db | 3 | 2 |
| approve-work-item-db | 1 | 1 |
| approved-draft-rules | 20 | 1 |
| telegram-events-done-db | 1 | 1 |
| telegram-replies-db | 1 | 1 |
| telegram-draft-replies-db | 1 | 1 |
| portal-telegram-db | 3 | 2 |
| db-roles-manifest-db | 6 | 1 |
| db-roles-paths-db | 2 | 1 |

Ordinary unchanged runs: **353 passed, zero failed, zero skipped, across 18 files / 28 executions** (350 across the initial 27 executions, then the same portal DB passed again). Additional in-memory runs: initial authorization module/probes **26 pass / 1 invalid-fixture failure**; corrected owner-only case plus supplemental phone races **14 pass / 2 product failures**; production UI module plus fresh case **6/6**. These additional totals include rerunning the original tests in their loaded module and are not counted as additional unique fresh cases.

`node scripts/db-roles-scan.mjs --diff` exits 0 and reports only intentionally withheld privileges. Exact DB-role manifest and actual narrow-role MCP/worker paths pass. `git diff --check` passes. No typecheck was run: the sole permitted filesystem write is this report, while the specified incremental tsc command writes build-info. No Next dev/build/start, browser, production bundle, device/APNs check or real outbound send was run.

## Optional items / coordinator checks

- Visually verify the Ops waiting note and long wrapped internal approval text at narrow widths. Structural tests do not establish final layout.
- Retain the previous optional discoverability improvement: pending decisions are limited before principal filtering, so unrelated newer cards may crowd out an older authorized staff card.
- Actual APNs delivery, hidden previews, killed-app handoff and Notification Center behavior remain coordinator/device checks. The native repository is unchanged; Joe's no-in-app-Face-ID decision is retained.

## Cleanup / boundaries

Used only the existing QA PostgreSQL Unix socket `/home/joe/qa-sjcos`, port **5499**, login `postgres`, with **20** reviewer-owned databases under `sjcos_push_pushr8eng_` (one base, 18 per-file databases and one probe database). The base loaded schema/migrations once with both explicit `DATABASE_URL` and an explicit migration URL; per-file clones used that base. The existing QA preload prevented test harness server startup. The legacy Telegram test received an explicit QA `FIN_TEST_DATABASE_URL` and synthetic owner. No live database or live environment file was read.

All 20 reviewer databases were dropped; the namespace query returned zero. Tagged cluster cleanup reported `no cluster running`: no reviewer cluster was started, and the existing shared QA server was left running. No live/QA-push service was stopped or restarted. No source, phone checkout, other review file, stage, commit or deploy was touched.
