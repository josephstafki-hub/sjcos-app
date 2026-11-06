SCORES: design=10 completeness=10

Engineering judge, build round 4. Backend 50cb82b18f84514ea03b9e70f56cc3cf31a3a3bf; phone 5b1b883ca9453c47b0441b97fde7199ddb88bdfc. Reviewed the R3 fix diff `9b4ba319..1152a759`, current backend/phone integration, the R3 engineering/design/security findings, P1–P15, API contract and database-role rules. No required engineering fixes remain. Scores cover executable engineering and parity, not physical-device presentation or deployment approval. Only this review file was written by this reviewer in the repositories; no source edits, staging or commits.

## Fresh adversarial expectations — recorded before execution

Each case uses fresh QA fixtures and real approval/dispatch code with fake outbound providers. Edits use a separate SQL connection.

1. Phone approve then content edit at the R3 effects-running checkpoint sends Original $100, never Unauthorized $9,900.
2. Telegram approve then replacement receipt after approval COMMIT sends only Original $100.
3. Web approve then recipient/subject/body edit after COMMIT sends Original $100 to the original recipient.
4. Phone approval blocked on work-item lock, concurrent content edit committed first: stale, no snapshot, no send.
5. Telegram approval blocked on work-item lock, concurrent receipt replacement committed first: no snapshot, no send.
6. Web approval blocked on work-item lock, concurrent recipient edit committed first: changed-draft refusal, no send.
7. Two phone approvers with distinct UUIDs: one snapshot and one accepted send.
8. Two web approvers: one winner, one snapshot and one accepted send.
9. Telegram vs phone approval race: one snapshot and one accepted send.
10. Web vs phone approval race: one snapshot and one accepted send.
11. Phone crash after approval commit but before effects claim; edit content and receipt; retry same UUID dispatches original snapshot at most once or returns durable needs_review with zero sends; never sends mutable content.
12. Phone crash after effects claim but before dispatch: retry preserves durable needs_review and performs no speculative send.
13. Pull, edit, resubmit and re-push a revised draft: old phone card refuses, revised phone card approves revised content once.
14. Pull, edit, resubmit and re-push: current Telegram card approves revised content once; old phone card remains stale.
15. Pull, edit, resubmit and re-push: web approves current revised content once.
16. Snapshot INSERT failure rolls back approval/action resolution; retry after removing fault can approve once.
17. Knowledge edit after source SELECT but before snapshot INSERT cannot change the frozen approved content.
18. Forged/missing snapshot id and snapshot id belonging to another work item cannot dispatch anything.
19. Narrow roles cannot read/create/update/delete snapshot evidence or call the full-source SQL function; accidental owner snapshot UPDATE is rejected.
20. Portal approval then concurrent body/portal-target edit posts original body into original channel once.

## Verified R3 fixes

1. **R3 engineering #1 — fixed.** Backend `lib/approved-draft-snapshot.ts:9`, `lib/approve-work-item.ts:87`, `lib/owner-actions.ts:167`, `lib/approved-draft-send.ts:126`, and migration `0092_phone_push.sql:65` now preserve exactly what was approved. One SQL statement obtains both the binding and complete send source; the frozen row and approval gate commit in the same locked transaction. The sender looks up that snapshot by both snapshot id and work-item id. Phone evidence persists the snapshot id. Web and both mapped/unmapped Telegram work-item paths reach the same frozen approval helper. The full-source SQL function and snapshot table are owner-only; a trigger rejects snapshot UPDATE even by an accidental owner write.

   **Exact $100/$9,900 reproduction:** pause the real phone `effects_running` query after approval committed, edit the knowledge content on a separate SQL connection to Unauthorized $9900, then resume: exactly one accepted fake email, to `client@example.test`, subject `Original $100`, body `Original $100.`. The committed regression also exercises content, replacement receipt and recipient edits after approval across phone, real Telegram webhook and web (nine combinations), plus six before-approval edit combinations. All pass. Independent probes additionally edit both content and recipient after web COMMIT, edit after the source SELECT but before snapshot INSERT, race approvers across channels, and change a portal body/target after COMMIT. Only the original snapshot dispatches. Before-approval edits refuse without any snapshot or send. Revised re-pushes remain approvable on all three paths.

   **Crash qualification:** the independent before-effects-claim and after-effects-claim crashes both retain the exact original snapshot id and return durable `needs_review` on same-UUID retry, with no send and no automatic second approval. They do not automatically resume a work-item send. This matches the documented conservative work-item recovery contract; saved decision-resolution recovery and idempotent email-intent retry still pass. The pre-execution expectations explicitly permitted this fail-closed result. Known pretransmit failure reopens the card and retries one durable intent; provider acceptance with lost completion never resends.

2. **R3 engineering #2 — fixed.** `tests/_harness/push-clock.mjs` derives the next Central noon from SQL time, stamps newly counted deliveries into the gate clock, keeps leases on real SQL time and chooses retries after saved `send_after` and the full counted hourly window. Related sweep/delivery fixtures use relative times. The three previously failing assertions are unchanged: direct fanout retries total **3** requests; partial summary retry adds exactly **1** request; failed-summary recovery leaves **0** pending rows. Reviewed the full test diff: no assertions were removed or relaxed, and no skips were added. Untouched independent single-file runs pass delivery **12/12**, R2 **26/26** and sweep **3/3**, without the R3 review's runtime clock substitutions.

3. **Other touched engineering paths — verified.** Preview and snapshot receipt selection now share `created_at DESC,id DESC`; approval callers pass the winning snapshot id. Hold copy uses readable Central time and lowercase am/pm, stale permission nudges use the linked decision title/app card while preserving Telegram copy, and internal drafts lose the leading blank line while emails retain their header separator. Committed R3 tests cover these changes. Phone's R3 diff changes only alert layout/press targets; action ids, queues, identity checks, confirmations and privacy configuration are unchanged. Phone typecheck passes. Visual layout remains the design/coordinator's device check.

## REQUIRED fixes

None.

## Independent adversarial results

**20/20 pass**, in the order recorded above before running the probes. No source/probe files were written. Probes executed from stdin against real QA PostgreSQL, actual route/resolver/dispatcher code and fake outbound providers. They reused the committed fixture and synchronization helpers in an in-memory module, with independent assertions and additional transaction/query fault injections. The report expectations, rather than the implementation's observed behavior, governed the results.

- Cases 1–6: original approved content only after approval; zero snapshots/sends when content, receipt or recipient changed before the locked claim.
- Cases 7–10: two phone, two web, Telegram/phone and web/phone races each produce exactly one snapshot and one accepted email.
- Cases 11–12: injected crash yields HTTP 500 first, then same-UUID durable `needs_review`, identical subsequent replay, original frozen content and zero sends.
- Cases 13–15: revised threaded phone, Telegram and web approvals each send the revised draft once; the old phone card remains stale.
- Case 16: snapshot INSERT failure rolls back domain approval and snapshot creation; removing the fault permits one successful approval.
- Case 17: editing mutable content after source SELECT but before snapshot INSERT still sends only the original $100 source.
- Case 18: absent, random and another work item's snapshot ids all fail closed.
- Case 19: agent/worker/readonly cannot SELECT, INSERT, UPDATE or DELETE snapshot evidence or execute the full-source function; owner snapshot UPDATE raises the immutable-snapshot error.
- Case 20: concurrent portal body/target edits after approval still post exactly the original body into the original channel, without email.

## R3 security nonregression

No regression found in the R3 security judge's exercised boundaries:

- **Auth/envelopes:** repeated all **17** explicit invalid-bearer/staff/owner route and `push.saveSettings` dispatcher checks. Eight invalid-bearer push routes return 401; six owner-only routes reject staff with 403; RPC invalid/staff/owner results remain 401/403/200, and the successful RPC retains `{ok:true,result:{channels:…}}`.
- **Devices/session expiry:** real JWT expiry, revocation, owner deactivation, cross-user collision and explicit unregister/transfer checks pass. Expired DELETE remains retryable with `deliveryStopped:false`; fanout excludes expired registrations. Phone cleanup retains credentials/intent until actual stopped/removal evidence and checks the same user before renewed cleanup.
- **Action safety:** generation fencing, blocked portal/note lease-overlap, stale-generation exclusion, UUID request collision and saved-result replay tests pass. Stale content/revision/hash and conversational-child approval checks remain enforced. The new snapshot adds protection after approval without widening caller privileges.
- **Effects/conversations:** real Telegram/phone parity, provider-acceptance/lost-completion, durable summaries/recipient retries, history/outbox failure handling, uncertain Telegram delivery, portal follow-ups, agent answers and owner/system attribution all pass. No duplicate approval/send or speculative retry was observed.
- **Phone/provider/privacy:** all 109 phone cases pass, including trusted navigation, durable SecureStore queue/journal failure and migration recovery, account switching, 202/needs_review retention, category confirmations and unregister errors. All eight categories still suppress hidden preview title/subtitle; every native action still requires device authentication and foreground opening. APNs credential-origin isolation, UTF-8 payload cap, title preservation, redaction, timeout/stream handling and session reuse tests pass. No in-app Face ID or Notify-me requirement was introduced.
- **Database:** exact manifest/trigger/real narrow-login path tests pass. New source/frozen-trigger functions retain `SECURITY DEFINER SET search_path = public, pg_temp`. `node scripts/db-roles-scan.mjs --diff` exits 0 with only intentional documented withheld paths; `node scripts/db-roles-sql.mjs approved_work_item_drafts` prints no grants, matching the owner-only table. No narrow-role approval, enrollment or snapshot mutation grant was added.

## Validation

Every test file ran separately; all results below are unchanged-source runs, zero failures and zero skips.

| Backend file | Passed |
| --- | ---: |
| phone-push-r3-db | 25 |
| phone-push-delivery-db | 12 |
| phone-push-r2-db | 26 |
| phone-push-sweep-db | 3 |
| approve-work-item-db | 1 |
| portal-telegram-db | 3 |
| phone-push-db | 19 |
| phone-push-parity-db | 16 |
| db-roles-manifest-db | 6 |
| db-roles-paths-db | 2 |
| telegram-events-done-db | 1 |
| telegram-replies-db | 1 |
| telegram-draft-replies-db | 1 |
| notifications-v2-db | 1 |
| apns | 4 |
| apns-transport | 9 |
| decision-summary | 4 |
| **Total** | **134** |

Phone files at `/home/joe/qa-sjcos/mobile/tests/`, each separately: push-actions **18**, push-feed **12**, push-outbox **9**, push-payload **10**, push-r1 **30**, push-r2 **30**; **109/109**. Phone `flock /home/joe/qa-sjcos/mobile/tsc.lock nice -n 19 npx tsc --noEmit -p .` passes. Backend typecheck was not rerun in this read-only review because its incremental configuration writes build-info; backend modules were exercised by the tests above. Both repository diff checks pass.

P1–P15 were retraced through the shared notifier/gate, resolver/effects, current draft binding and frozen sender, conversations/portal, cleanup/live state, phone request identity/queue, category mappings, settings and provider seams. The R3 P5 concurrent-send hole is closed; no request/response field or error-envelope mismatch was found.

## Optional items / coordinator checks

- Existing optimization opportunity: bound full-history reconciliation to changed records and bounded expiry batches.
- Automatic recovery of a known-before-dispatch work-item crash could eventually use its saved snapshot; current durable `needs_review` behavior is conservative and explicitly documented, not a required fix here.
- Physical device/coordinator checks remain for actual APNs delivery, shown/hidden previews, killed-app typed-action handoff, device authentication, Notification Center cleanup, keychain behavior and the latest phone layout. No visual verification is claimed.

## Cleanup / boundaries

`SJC_TEST_CLUSTER_TAG=pushr4eng` throughout DB work. Existing `sjcos-qa-pg` was active before and after; only its QA Unix socket at port 5499 was used. Seventeen reviewer-owned databases named `sjcos_push_pushr4eng_*` were created (base, fourteen isolated file clones, fresh-probe and security-probe databases); every one was dropped after connections closed. Explicit QA DATABASE_URL was set when loading schema/migrations. No other cluster was started; tagged stop returned `no cluster running`. No shared QA units were stopped.

No browser, Next dev/build/start, application server, simulator, real email/APNs/Telegram send, live database/environment file/service, deployment, staging or commit was used. Other reviewers' concurrently created R4 reports were left untouched.
