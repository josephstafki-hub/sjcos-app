SCORES: design=8 completeness=8

Engineering judge, build round 7. Reviewed the entire fix diff `823a273c..6bae654b` at HEAD `96ec1fc4`, compared authorization behavior with `5e97c12e`, and checked retention of `6c82d5aa` binding/copy/cleanup protections. Phone checkout `/home/joe/.t3/worktrees/sjcos-mobile-push` remains clean at `5b1b883ca9453c47b0441b97fde7199ddb88bdfc`.

The R6 full-text requirement is fixed. Joe's staff web authorization decision is implemented server-side. One high-priority Telegram authorization race remains: deactivation or demotion after principal lookup can still approve/send or reject. Only this review file was written; no source edits, staging or commits.

## Fresh adversarial expectations — written before execution

Use isolated QA databases, real DAL/JWT/actions/webhook/domain code and fake outbound providers. Refusals preserve approval rows, snapshots and sends unless an explicit audit event is appropriate. No source files will be changed.

1. Long matching internal approval text in both lead and project Ops remains fully readable, with preserved newlines and wrapping, when the duplicate preview is suppressed; its Approve handler submits the displayed binding.
2. Long fallback bodies without draft receipts remain readable; short duplicates remain suppressed; distinct internal, email and portal previews remain visible; staff without Today have no Ops approval controls.
3. Engine-only staff can approve/reject Engine and popup work items using the displayed binding but cannot approve/reject either Ops surface; Today-only staff have the inverse permissions, with no assignment-authority dependency.
4. A signed cookie claiming owner cannot override an inactive/deleted/revoked account or a staff account lacking the matching area on any work-item or decision action.
5. Staff with ordinary decision authority can approve/reject/request changes only within its action, project and amount scope; area access alone cannot resolve decisions. Direct and popup routes must enforce this server-side.
6. Staff with every area and ordinary decision authority cannot resolve grant decisions through any direct/popup action, and cannot see grant cards in polling.
7. Authorized staff and owners cannot approve changed, missing-binding or cross-item-binding drafts on Engine, both Ops surfaces or popup; exact stale recovery copy remains and nothing sends.
8. Fresh active owner and authorized staff approvals freeze the displayed payload, dispatch once and refuse replay; subsequent edits cannot replace the approved snapshot.
9. Telegram bound and legacy work-item callbacks and decision callbacks refuse an owner already inactive, demoted or deleted, without domain effects.
10. Deactivate the owner after callback principal lookup but before bound Approve dispatch: the callback must recheck active DB authority and refuse before approving or sending.
11. Deactivate or demote the owner after lookup but before legacy Reject dispatch: the callback must refuse without changing the work item.
12. Deactivate the owner after callback principal lookup but before decision resolution (including a blocked decision lock): approval must refuse without a send or successful resolution.
13. Active-owner Telegram bound Approve sends its displayed frozen payload once; mapped and legacy Reject still work, while unmapped legacy Approve cannot bypass binding evidence.
14. Phone APIs and actual bearer RPC retain owner-only database authorization for area-enabled staff, forged role claims and inactive owners; owner success retains the envelope.
15. Portal Telegram cleanup is scoped and repeatable: an unrelated portal outbox/app-message pair survives two runs; unexpected fixture cleanup failures remain loud. All phone-push DB files must pass twice on each file's same database with the committed fixture cleanup only.

## REQUIRED fixes

1. **High — make Telegram's active-owner authorization atomic with the protected mutation, including deferred work-item dispatch.** `lib/decisions/telegram.ts:174` resolves an active owner once, then returns that principal for later work-item dispatch at line 183. `lib/owner-actions.ts:47` passes it to the mapped resolver; that resolver's work-item branch (`:165–190`) never checks the principal's current database account. The unmapped legacy Reject branch does not receive the principal at all. Decision callbacks likewise retain the earlier principal while waiting for the decision lock; `lib/commands/decisions.ts:216` returns owner authority from its saved role without rereading the account. The initial active-owner lookup therefore closes the already-inactive case but leaves a reproducible check/use race.

   Three independent adversarial expectations failed against the **real webhook POST**, real database and domain/dispatch code, with only external sends faked:

   - Bound draft Approve: hold its `work_items` row lock on connection A; start the webhook on B; observe B waiting on a database lock after successful active-owner lookup; commit `UPDATE users SET active=false` on C; release A. Expected: requested draft, no snapshot/send. Actual: `approval_status='approved'`, one fake client email carrying the displayed payload, HTTP body `{ok:true,handled:true,duplicate:false,outcome:'work item approve: dispatched'}`. Deactivation committed before the approval claim acquired its lock.
   - Unmapped legacy Reject: same ordering, but demote the owner to staff while the rejection waits. Expected: unchanged requested draft. Actual: `approval_status='rejected'` and webhook success, despite the database row already being staff. No client email was expected or observed.
   - Decision Approve: hold its `decisions` row lock, start the real webhook, observe its lock wait, deactivate the owner and commit, then release the decision lock. Expected: pending decision with no successful resolution. Actual: `status='approved'`, webhook outcome `Approved ✓`. This fixture had no held outbound intent; it demonstrates unauthorized resolution rather than claiming a decision-email reproduction.

   Recheck the **same account's** active owner authority under synchronization that conflicts with role/active updates, in the transaction that claims or changes the protected record. Cover mapped draft Approve/Reject, unmapped legacy Reject and decision callbacks, including Hold. Preserve the frozen viewed binding and all existing replay/recovery guards. A second unlocked lookup before a potentially blocking record lock does not fix this ordering; neither does merely carrying an owner-shaped principal into a resolver that ignores it. A deactivation committed before the approval/rejection claim must win. Add deterministic real-webhook lock-race coverage for these paths, alongside the existing already-inactive/demoted/deleted tests. No requirement here to retroactively undo an approval that validly committed before a later account change.

## R6 requirement and whole-diff verification

**Full internal text: fixed.** `RecordOps` computes whether the separate draft preview is displayed. When it is suppressed on an approval, the remaining body has no clamp, maximum height or overflow hiding and retains `whitespace-pre-wrap break-words`. Other work-item bodies retain their two-line clamp. Both lead/project callers supply the real viewer's Today permission. The unchanged production card functions were compiled in memory and their JSX/event handlers evaluated: long matching bodies, a long body with a matching draft prefix plus context, long Unicode/multiline content, and no-receipt fallback all retain full text. Short duplicates remain suppressed; distinct receipt content, email and portal previews remain. Both Approve handlers submit the exact displayed item id, kind/slug and binding. Area-disabled viewers have no Ops Approve/Reject. This is structural/event verification, not a browser layout claim.

**Staff web rules are restored with server enforcement.** The final `lib/actions/engine.ts` and `lib/actions/record-ops.ts` have **zero diff from `5e97c12e`**. Engine uses `requireAccess('engine')`; both Ops surfaces use `requireAccess('today')`. Those calls resolve the real signed session against the active DB account and current permissions before claiming or rejecting. Popup work items now authenticate and delegate to the same Engine actions, so Engine access is required there; a Today-only viewer can act in Ops but cannot bypass Engine through the popup. Engine's approval controls no longer depend on owner-only assignment authority. Lead/project controls use `can(viewer,'today')`, matching their callable actions.

Ordinary decisions use server-derived `sessionPrincipal`, `authorityFor` and the transactional shared resolver; staff area access alone supplies no decision authority. Grants are explicitly refused to staff before direct Approve/Reject/Request changes, and popup actions delegate to those checks. Pending-card reads on Notifications and polling pass the server-derived principal and filter decisions by authority, hide grant decisions from staff and offer work-item cards only to Engine-enabled principals. Unlike pre-R5 popup behavior, authorized staff can now actually answer the cards Joe has authorized; this is an intentional behavior change in the current decision, not a literal restoration of the old popup owner gate. No client prop, submitted role or JWT role claim supplies web approval authority.

Fresh probes exercised all eight work-item routes and five direct/popup decision routes with real DAL/JWT, forged owner claims, inactive/deleted/revoked sessions and absent/malformed cookies. Every refusal preserved the work-item/decision row, snapshot/receipt/event/intent counts and sends. Separate scope probes covered wrong action, wrong project, amount over limit, revoked grants and exact matching grants; all five decision routes denied a different project and then succeeded for the authorized project. Staff with matching areas still sends exactly the displayed draft once, just as owner does. Ordinary decision authority, even explicit authority for action type `grant`, does not bypass the grant-kind guard.

**R4/R5 protections are retained.** The final diff does not alter `lib/approve-work-item.ts`, `lib/approved-draft-snapshot.ts`, `lib/approved-draft-send.ts`, `lib/work-item-draft.ts`, the phone action contract, migrations or role manifest. Displayed web bindings still reach the locked claim without being recomputed at click time; snapshots freeze one atomic source and dispatch only its content. Missing, empty, cross-item and changed bindings fail closed for staff and owners on all four web Approve surfaces, with the exact recovery copy: “This draft changed since you opened it. Nothing was sent. Read the new version and approve again.” Both changed UI handlers keep the `Approve failed` toast title and refresh. Post-claim edits cannot replace the frozen sent payload; replay sends nothing again.

The R3/R4 suites still cover post-approval content/receipt/recipient edits, concurrent approval, edits while awaiting record locks, known failed-send retry, immutable evidence and narrow-role snapshot access. R2/original/parity/sweep suites retain generation fencing, live blocked-mutation/expired-lease overlap, durable recovery, uncertain acceptance, stale cards, threaded replies and conversational-child restrictions. All pass twice. Delivery cap, quiet-hour and partial-summary assertions pass unchanged, with no reviewer clock substitution. Unmapped legacy Approve still refuses even for unchanged content; mapped frozen Telegram Approve still sends the viewed payload once. The new initial owner lookup correctly refuses bound/legacy/decision callbacks when the account is already inactive, demoted or absent. These passing protections do not cover the race in required fix 1.

**Phone boundaries remain server-side.** Fresh real-bearer probes deny six owner alert routes to area-enabled staff and a staff user with a forged owner-role JWT (403), and deny an inactive owner (401). Device registration's established staff exception remains outside those owner alert routes. Actual `push.saveSettings` dispatcher calls with real bearer authentication return 401/403/200 for invalid/staff-forged-owner/owner, and successful owner responses retain `{ok:true,result:{channels,quietHours,configured}}`. The native repository has no source or working-tree change this round.

**Framework and DB boundaries.** Read the relevant installed Next.js 16.2.9 `use server`, `use client` and data-security guidance. Callable action modules retain server directives, async exports, in-action authentication and server-side revalidation; client props remain serializable. No new Next API incompatibility found by inspection. Exact DB-role manifest and real MCP/worker narrow-role path tests pass. `node scripts/db-roles-scan.mjs --diff` exits 0, listing only intentionally withheld privileges. No new table, trigger or privilege widening is introduced in the reviewed diff.

## Fresh adversarial results

**12/15 passed; cases 10, 11 and 12 failed their prewritten expectations and support required fix 1.** Expectations above were saved before executable probes. Probe code was supplied over stdin and appended to unchanged modules only in memory via Node loader hooks; no test/probe source file was created or changed.

- **1–2:** six UI assertions/tests pass, including the four committed tests and two independent fresh cases using long Unicode text, context suffixes, both record kinds, fallback bodies and permission variants.
- **3–9, 13–14:** nine independent fresh test cases pass, with loops across the applicable actions/identities, plus the supplemental project-scope matrix. The accompanying 23 unchanged committed R5/R6 authorization cases pass again.
- **10–12:** three independent, deterministically blocked real webhook races fail as described above. They are actual product failures, not assertions rewritten to bless the bad result. Each test released its lock in `finally` and awaited completion.
- **15:** seeded an unrelated portal outbox row with an app-message child on a fresh reviewer DB. Ran unchanged `portal-telegram-db` twice: both passed 3/3, the unrelated pair survived and all fixture parents/children were gone. Installed a temporary DB-only BEFORE DELETE trigger that raises `R7 injected cleanup failure` for the fixture app-message. The unchanged test failed its third case with that exact error (2 pass/1 fail). Removed the trigger/function; two further unchanged runs passed 3/3 on the same contaminated DB, preserved the unrelated pair and left fixture parent/child counts 0/0. All eight phone-push DB files also passed twice without recreating their databases between runs. Fixture resets are their committed cleanup only.

## Requested validation

Every test file ran individually and sequentially, with `SJC_TEST_CLUSTER_TAG=pushr7eng`. **Ordinary runs: 326 passed, zero failed, zero skipped, across 17 files / 26 executions.** Each repeated pair used the same migrated per-file DB; no reset/reload occurred between executions beyond the tests' committed fixture cleanup.

| File | Passes per run | Runs |
| --- | ---: | ---: |
| phone-push-r6-ui | 4 | 1 |
| phone-push-r5-db | 23 | 2 |
| phone-push-r4-db | 18 | 2 |
| phone-push-db | 19 | 2 |
| phone-push-delivery-db | 12 | 2 |
| phone-push-parity-db | 16 | 2 |
| phone-push-r2-db | 26 | 2 |
| phone-push-r3-db | 25 | 2 |
| phone-push-sweep-db | 3 | 2 |
| approve-work-item-db | 1 | 1 |
| approved-draft-rules | 20 | 1 |
| telegram-events-done-db | 1 | 1 |
| telegram-replies-db | 1 | 1 |
| telegram-draft-replies-db | 1 | 1 |
| portal-telegram-db | 3 | 2 |
| db-roles-manifest-db | 6 | 1 |
| db-roles-paths-db | 2 | 1 |

Additional runs, separate from 326: authorization module plus independent cases **32 pass / 3 fail**, UI module plus independent cases **6/6**, supplemental project-scope probe pass, four portal sentinel/recovery runs **3/3 each**, and one intentionally faulted portal run **2 pass / 1 expected fail**. `git diff --check` passes. No typecheck was run because the only permitted write is this review file and the specified incremental tsc command writes build-info. No browser, server, Next dev/build/start, production bundle or device/APNs check was run.

## Optional items / coordinator checks

- Visually check long lead/project Ops approval text at narrow widths, including wrapping and contextual suffixes. Structural checks establish that the full text exists and is unclamped, not final browser layout.
- Pending decisions are limited before principal filtering in `listPendingApprovals`; consider fetching/filtering enough authorized rows so unrelated newer decisions cannot crowd an older authorized staff card out of the popup. This is a discoverability improvement, not an authorization bypass, and was identified by inspection rather than a dedicated probe.
- Actual APNs delivery, hidden previews, device authentication, killed-app handoff and Notification Center behavior remain coordinator/device checks. Native code is unchanged this round.

## Cleanup / boundaries

Used only QA PostgreSQL on Unix socket `/home/joe/qa-sjcos`, port **5499**, with 20 reviewer-owned databases named `sjcos_push_pushr7eng_*` (base, 17 per-file DBs and two probe DBs). The existing QA preload redirects the harness to those explicit URLs without starting another cluster or weakening test logic. Schema/migrations were loaded once into the reviewer base with explicit `DATABASE_URL` and explicit migration URL, then cloned per file. The legacy Telegram reply test received an explicit `FIN_TEST_DATABASE_URL` and a synthetic QA owner. No implicit migration/role-apply target was used.

All **20** reviewer databases were dropped; the final namespace query returned **zero**. Tagged cluster cleanup returned `no cluster running`: no reviewer cluster was started, and the existing shared QA server remained running. No live DB, live environment file, live service, QA-push unit, real outbound send, deploy, stage or commit was touched. Other reviewers' concurrent R7 report files were left untouched. Only this review file was written; no logs or probe files were created.
