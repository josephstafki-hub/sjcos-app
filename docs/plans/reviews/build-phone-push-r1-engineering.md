Score: 5/10 — do not ship.

Engineering judge, round 1. Reviewed the uncommitted backend tree on `t3/phone-push` against HEAD `76d57cd8`, including all named untracked implementation files, the plan, contract, project rules, database-role rules, and installed Next route-handler guidance. Findings concern correctness and safety, not formatting. Locations are relative to this repository.

## Findings, ranked by severity

### F1 — P1: narrow database logins can enroll an arbitrary receiver as an owner device

**Location:** `db/migrations/0092_phone_push.sql:60` and `:61`; `deploy/db-roles.manifest.json:2150`; delivery filter `lib/phone-push.ts:19`.

The new table-wide INSERT/UPDATE grants let `sjcos_agent` and `sjcos_worker` create devices with any owner's user_id, or change a registered staff device's user_id to the owner. The subsequent delivery JOIN trusts that association. A staff panel agent runs under sjcos_agent; the HTTP registration route's user binding does not protect this database path. This creates an alert-exfiltration capability across the owner boundary.

**Reproduced:** in a rolled-back transaction on the isolated QA database, SET ROLE sjcos_agent followed by INSERT INTO push_devices ... SELECT owner.id succeeded. The ordinary owner-delivery predicate then selected the synthetic receiver. No real token or outbound network was used.

**Fix:** keep registration, reassignment, token, environment, platform and revocation restoration owner-login-only. Delivery principals need token reads and narrowly scoped invalidation writes, not INSERT or table-wide UPDATE. Use column grants for disabled_at/disabled_reason or a one-purpose helper, update the manifest and migration together, and add negative SET ROLE tests for enrollment/reassignment. The monitor should not get raw tokens merely to inspect device health.

### F2 — P1: a reply/ack row bypasses stale-content approval protection

**Location:** `lib/phone-push.ts:36`; `lib/owner-actions.ts:106`, `:140`, `:143`, `:149`.

Reply/ack rows inherit decision_id from their parent, but do not inherit the rendered content hash. They are advertised as reply-only. The action endpoint never enforces the advertised actions, category, state or message purpose. Sending action=approve against an ack reaches the decision branch with a null hash; that branch loads and approves the current decision using its current hash. This substitutes fresh content for the content represented by the old thread message.

**Reproduced:** create a decision with old-hash, its original alert, and a child ack; change the decision to new-hash. Approving the original alert returned stale. Approving the ack returned `{ok:true, outcome:'approved'}` and changed the decision to approved, although the ack's allowedActions contained only reply. Approval effects were stubbed, so nothing was sent externally.

**Fix:** validate each verb against authoritative message purpose and current domain state. An ack/reply must not authorize approval. Only an actual approval card bound to its rendered revision may resolve/send; carry that exact revision into the transaction's resolver. Do not fix this by suppressing actions on every threaded row: revised approval cards must remain actionable (F7).

### F3 — P1: concurrent action retries can deadlock the entire shared connection pool

**Location:** `app/api/mobile/push/[...path]/route.ts:38` through `:44`; pool limit `lib/db.ts:14`.

Each request reserves a pool connection and waits for a session advisory lock. The winning request then uses queryOne and the resolver's helpers, which need additional connections from the same ten-connection pool. Ten concurrent retries of the same action can reserve every connection: nine wait for the winner's advisory lock, while the winner waits for a pool connection. None can release its connection. Production has no pool acquisition timeout; unrelated API/database work also stalls.

**Reproduced:** ten concurrent calls produced total=10, idle=0, waitingForPool=1. For this reproduction only, an in-memory 500ms pool-acquisition timeout was added so the test could terminate safely; the winner failed with a pool-acquisition timeout. With the checked-in pool settings it has no such escape.

**Fix:** avoid waiting lock holders occupying the executor's entire pool. Use bounded admission with a separate small lock pool, a nonblocking claim protocol with explicit in-progress responses, or consistently pass the acquired connection through all database work. Preserve the committed crash claim and first-result semantics. Add concurrent identical-ID and distinct-ID tests with bounded completion.

### F4 — P2: APNs failure disables the existing Telegram hourly cap

**Location:** `lib/notify-owner.ts:136` through `:142`, `:249` through `:253`; gate count at `:201`.

A successful Telegram delivery followed by an overall channel error leaves push_outbox.sent_at null. The hourly gate counts sent_at, so those actual Telegram sends do not consume the cap. An APNs outage therefore allows unlimited new ordinary Telegram alerts. The same issue applies in the opposite channel direction.

**Reproduced:** with one enabled synthetic iOS device, mocked APNs 503 and successful mocked Telegram transport, five sequential non-exempt comms notifications in one hour produced five Telegram sends and zero counted-as-sent outbox rows. A control with no APNs failure sent only four.

**Fix:** separate throttle accounting (first actual channel delivery/admission) from completion and retry state per channel. Preserve the shared gate and channel-specific retries without erasing the fact that an owner alert already went out. Test both asymmetric outages and cap-exempt kinds.

### F5 — P2: agent answers can be silently dropped while reply_to_owner reports sent=true

**Location:** `lib/owner-reply-delivery.ts:44`, `:245`, `:249`; sweep completion at `:303`.

sendOwnerTelegram catches and discards APNs delivery failure. These mirrored answers are inserted directly with no push_outbox_id, so the drain has no retry job for them. replyToOwner then marks the note answered and computes sent from channel configuration rather than delivery. With App-only settings and an APNs timeout/503, it reports sent=true although no push was accepted. sweepUnansweredReplies also marks a reply answered before this best-effort send and will never select it again. The answer remains available in the feed, but the promised phone alert is lost.

**Fix:** put answers, prompts and acknowledgments on a durable channel-aware delivery path, with explicit conversation/gate exemption where required. Return delivery/queued state from real results, not configuration. Make the sweep's terminal state safe with respect to durable enqueue, and test App-only provider failure, retry, and crash boundaries.

### F6 — P2: Telegram replies to phone-originated acknowledgments cannot be routed

**Location:** `lib/owner-reply-delivery.ts:201` and `:202`; caller `lib/owner-actions.ts:125`.

The phone calls deliverOwnerReply with chatId='app'. The acknowledgment is sent to the real Telegram owner chat, but rememberReplyTarget stores it under chat_id='app'. findReplyTarget looks it up using the actual Telegram chat id, so Joe's follow-up reply to that acknowledgment receives help instead of reaching the originating conversation/agent.

**Reproduced with actual reply delivery and a mocked Telegram transport:** the ack mapping was `{chat_id:'app', message_id:'71234'}`. findReplyTarget using the real synthetic owner chat and that message id returned target=null. The new database test does not see this because it stubs deliverOwnerReply and sendOwnerTelegram.

**Fix:** store Telegram mappings under ownerChat(), independently of the originating channel. Resolve the mirrored note's Telegram message id as reply_parameters too, so phone-originated conversations remain threaded on Telegram. Test phone note → Telegram ack → Telegram follow-up → same agent/conversation.

### F7 — P2: revised approvals lose their in-app approval buttons

**Location:** `lib/phone-push.ts:55`; revised-message parent creation at `:27` and `:36`; revision callers `lib/notify-owner.ts:426` and `lib/owner-grants.ts:197`.

A revised draft/permission card is intentionally inserted under Joe's note with reply_to_id set. shapePushMessage removes all approval verbs from every row with reply_to_id, even when that row is a new open SJC_DECISION/SJC_GRANT/SJC_DRAFT card. It exposes only reply. The thread/feed consequently cannot offer Approve, Changes, Hold or Decline on the revised card.

**Reproduced:** an open revised decision with category SJC_DECISION and a parent note shaped to allowedActions=['reply'].

**Fix:** distinguish conversational rows from approval-card rows by authoritative purpose/category and live record state, not by whether they have a parent. Test revised decisions, grants and work-item drafts in the actual feed/thread response, including their buttons and subsequent resolution.

### F8 — P2: feed/cleanup state is not live across parked delivery and approval reopening

**Location:** `lib/phone-push.ts:31` through `:36`, `:55`; `db/migrations/0092_phone_push.sql:46` through `:51`; phone work-item finalizer `lib/owner-actions.ts:136` through `:138`.

Message insertion checks decision status but never work-item approval_status. If a queued work-item alert drains after Joe approved/declined/pulled it elsewhere, a new open actionable alert is created. The update-only trigger already ran before this row existed, so cleanup never clears it. Conversely, a failed send can legitimately reopen approval_status to requested; previously decided alert rows remain decided because the trigger only closes rows. GET messages simply shapes stored state rather than reconciling the underlying record.

**Reproduced:** inserting a card for an already approved/done work item yielded state=open with approve/changes/decline/reply. Domain approval still refuses a normal tap, but the lock-screen/feed state and cleanup contract are wrong. Also, the phone's work-item approve/decline finalizer never edits its Telegram card; only the text-change path calls markDraftCardPulled, leaving the Telegram card visibly actionable after a phone decision.

**Fix:** initialize and reconcile cards from current domain state, explicitly handle reopen/revision transitions, and update both channel representations through a shared finalizer. Keep old revisions closed while exposing the new/reopened valid request. Test parked → resolved → drain, send failure → reopened request, and phone work-item decision → Telegram card edit.

### F9 — P2: a just-created immediate outbox row can be delivered concurrently by the drain

**Location:** `lib/notify-owner.ts:249` through `:252`; drain claim at `:539`; check-then-insert message reuse `lib/phone-push.ts:23`.

transmit inserts an immediately due unsent outbox row before network delivery, but never claims it. A five-minute drain overlapping that send can claim the same row. If the first sender has inserted its owner_push_messages row but has not yet saved delivered_channels, both senders see no completed channel and both deliver the alert. The unique index prevents two history rows, not two network sends. A slow APNs request makes this overlap window substantial and can duplicate Telegram too.

**Fix:** use one atomic leased/claimed outbox protocol for immediate send and drain, with crash recovery and per-channel completion. Do not publish immediately deliverable work and then bypass its claim path. Add a deterministic blocked-transport/overlapping-drain test. This concerns duplicate owner alerts; I did not establish a duplicate client-facing send through the domain approval functions.

### F10 — P2: APNs transport/fanout does not satisfy the required connection and failure lifecycle

**Location:** `lib/providers/apns.ts:48` through `:58`; `lib/phone-push.ts:20`; transport test stub `tests/apns-transport.test.mjs:6`.

Every device delivery opens and closes a separate HTTP/2 session; there is no reuse, session cache, or explicit GOAWAY retirement. The code handles error/end and a stream inactivity timeout, but does not explicitly settle close/aborted lifecycle paths. More concretely, sendAppPayload stops at the first throwing device. A transient error on the first selected device prevents every later owner device from receiving that pass; if a later device fails, already successful devices are sent the alert again on the next channel retry, because completion is tracked only for the whole App channel. The device SELECT has no stable order or per-device delivery state.

**Fix:** maintain bounded reusable sessions per APNs origin/environment, retire them on GOAWAY/connection termination, and guarantee settlement/destruction for all lifecycle exits. Attempt devices independently and persist enough per-device outcome state to retry failed recipients without repeatedly alerting successful ones. Add session-reuse, timeout, stream/session close/error/GOAWAY and multi-device mixed-outcome tests. The current stub's setTimeout is a no-op and it emits only normal response/data/end, so it establishes none of those properties.

## Parity and safety assessment

The core domain functions are reused: decisions reach resolveFromChannel/holdDecision; normal decision approvals run performApprovalEffects; work items reach approveWorkItemById/rejectWorkItemById after the requested-status check; typed notes reach recordOwnerReply and the existing agent/session routing; portal replies reach recordPortalReply. I did not find a new direct send implementation bypassing those web approval functions. Telegram's pure handler is unchanged and the successful extracted work-item reply wording matches its former behavior.

That does not establish the specified byte-for-byte behavior of the complete webhook. The adapter now adds unguarded history writes before delivering owner notes (`lib/owner-actions.ts:49` and `:68`), and sendOwnerTelegram performs new settings/history database operations before its existing transport try/catch. A failure in those added steps can stop post-commit Telegram reply handling; Telegram returns HTTP 200 and its persisted update prevents replay. The old bot path was not isolated from this new dependency. F4 and F6 are additionally demonstrated behavioral differences. The webhook's extra App result line also drops performApprovalEffects' actual result lines and, for work items, uses the pre-action dispatched outcome (`lib/owner-actions.ts:94`), so its mirrored result is not the actual send description.

Endpoint authentication is otherwise consistently checked: getUserFromRequest verifies the signed bearer session, active user and revocations; the push route rejects nonowners before settings/open/test/feed/detail/action; the settings RPC has ownerOnly=true; registration binds user_id to the authenticated owner/staff user and deletion is user-scoped. Ordinary APNs device selection filters active owner users and enabled iOS devices. F1 breaks the trustworthiness of that filter from the database side.

actionId is stored before domain work, exact successful results are cached, mismatched request reuse is rejected, and the session lock serializes the same id while connections remain healthy. Crash-left claims return ok=false/recorded, not success. That fail-closed compromise is explicitly documented in the plan; it is not an exactly-once completion guarantee. The existing domain decision/work-item claims protect normal double approval, but crash/send reconciliation is not exercised by the new tests, and F3 must be resolved before the endpoint is reliable.

APNs details that look correct: ES256 uses Node's ieee-p1363 encoding (raw 64-byte JOSE signature rather than DER), the token contains kid/iss/iat and refreshes at 50 minutes, default topic/team match the plan, environment selects the sandbox/production origin per device, normal headers use alert/10 and cleanup uses background/5 with content-available and no alert, and stale nudges set a collapse id. 410, BadDeviceToken and Unregistered return invalidation reasons and the caller disables those devices. Alert JSON is measured by UTF-8 byte length and trimmed by code points; the Unicode test passed. A 100-UUID cleanup payload measured 4004 bytes with a small badge. I found no intentional key/full-token logging in the provider or token exposure in HTTP responses. Tests did not validate error logging for every failure path.

0092 loaded successfully and uses idempotent DDL/grant patterns. It preserves the existing web registry columns/platform allowance. The new trigger has SECURITY DEFINER SET search_path = public, pg_temp, and the role-manifest database test passed, including approval restrictions and trigger checks. Required delivery-table writes are granted and push_actions remains owner-login-only. Manifest consistency is not sufficient authorization safety: F1 is an overgrant that that test accepts. The new decision/work-item trigger lookups also lack supporting decision_id/work_item_id indexes on the growing message history; add these when correcting state reconciliation.

## What the tests actually cover

`tests/phone-push-db.test.mjs:21` is one aggregate happy-path test, with authentication, approval effects, both work-item mutations, and all reply delivery stubbed at lines 9–13. Its replay assertion counts a stub invocation rather than proving a real send or resulting work-item state. The following is the coverage boundary, not an assertion that every unchecked path is broken:

| Parity | Evidence and missing verification |
|---|---|
| P1 | Generic recording/routing and category mapping are tested. No full entrypoint/payload/destination assertion for all twelve OwnerPushKinds. |
| P2 | One quiet-time park, happy-path channel setting combinations and one already-full cap. No drain/fold/channel snapshot/DST tests, asymmetric outage accounting, immediate/drain overlap, or full exemption matrix. F4/F9 escape this coverage. |
| P3 | Direct stale approve/changes, fresh hold and approve. No phone-vs-Telegram state/event comparison for all verbs, stale hold, expiration, missing card, or ack action injection. |
| P4 | performApprovalEffects is replaced with a Sent line. No real staged-grant, first-draw invoice, intent wake/dispatch, failure/unknown-send or actual result-line parity test. |
| P5 | One stubbed approve, replay, and pulled-back refusal. No real decline, concurrent approve/decline, failed-send reopening or external-send reconciliation. |
| P6/P7 | One note creates an app owner_replies row and reaches a delivery stub. No actual session steer/new-turn/fallback-agent delivery, Telegram editing, or bidirectional follow-up test. |
| P8 | Actual sendOwnerTelegram/deliverOwnerReply/replyToOwner are stubbed out. No no_change/question/done delivery, sweep success/24h failure, App-only APNs outage, retry, or reply-to-agent-answer integration test. The actual sweep SELECT is channel-neutral, but its delivery/finalization has F5. |
| P9 | One project-portal post and thread length. No reply to the ack, subsequent cross-channel reply, lead-to-project redirect, sub portal, unauthorized send, or acknowledgment delivery failure test in the new file. Existing portal tests cover several pure Telegram/domain cases. |
| P10 | A work-item update and decision update appear in open reconciliation. No parked stale creation, reopen, Telegram-card synchronization, per-device cleanup failure, or full feed live-state test. |
| P11 | No revised-card thread/actions assertion; F7 is untested. |
| P12 | No parity test needed for the deliberately omitted unthreaded phone free-text path. |
| P13 | Sequential same-id replay and mismatched action reuse; staff is rejected on settings/action and null auth on settings. No true parallel replay, crash boundaries, real bearer revocation/inactive tests, authorization matrix across every endpoint, or registered staff-device exclusion/role-level enrollment test. |
| P14 | Basic HTTP/2 seam, silent headers, provider-level invalid-token reason, 503 rejection, fake delivery, signature/cache and Unicode payload. No actual device invalidation persistence, connection lifecycle/reuse, per-environment transport assertion without override, kid/iss/iat assertions, or multi-device recovery. |
| P15 | Payment is used in channel-routing assertions and payment/contract categories are checked. No money/documents destination assertion or real transactional alert path for both kinds. |

Add focused, independently named failure tests with real domain effects where possible. Preserve the existing Telegram suites and add endpoint/finalizer differential tests; those suites currently exercise the pure handler more than the newly extracted post-commit adapter.

## Validation and limits

Passed, run as individual files: apns.test.mjs (4), apns-transport.test.mjs (2), phone-push-db.test.mjs (1 aggregate), db-roles-manifest-db.test.mjs (6), telegram-replies-db.test.mjs (1), telegram-draft-replies-db.test.mjs (1, also rerun correctly on QA), portal-telegram-db.test.mjs (3 on a fresh QA schema with its required Joe Stafki owner fixture). The requested single flock/niced tsc completed successfully. The database-role scan reported the existing intentional withheld privileges, with no newly missing delivery grants.

QA service was already active. Tests and reproductions used isolated sjcos_push_judge / sjcos_push_judge_legacy databases on port 5499, synthetic devices and mocked/fake outbound transports. Initial portal-suite attempts in the reused phone-test database exposed a fixture-name mismatch and a rerun cleanup failure: its DELETE FROM push_outbox now conflicts with the new history FK after an earlier run. The fresh-schema run passed; repeated-run cleanup should also be addressed in regression coverage, rather than masking this with shared fixtures.

One legacy test invocation omitted the QA preload and unexpectedly started a disposable harness cluster. It was stopped immediately after discovery using the pushjudge-tagged harness cleanup; the file was then rerun against QA with the preload. No live database/service or other agent's cluster was touched. No Next/Expo/browser process was started. No repository file was edited; this report is the only requested file artifact.

No real Apple credential/device or production delivery was exercised. The review is of backend behavior; native registration/action execution while killed still needs the separate phone judge.

## Blockers

- F1: remove agent/worker enrollment and reassignment of owner push devices.
- F2: reject approval verbs on reply/ack rows and preserve rendered-content authorization.
- F3: eliminate the action-lock/shared-pool deadlock.
- F4: retain hourly-cap accounting when only one channel succeeds.
- F5: persist/retry conversational push delivery and report actual delivery state.
- F6: fix Telegram acknowledgment mapping/threading for phone-originated notes.
- F7: retain approval actions on revised threaded cards.
- F8: reconcile live card state across parking, reopening and both channels.
- F9: atomically claim immediate deliveries against the drain.
- F10: fix APNs session lifecycle/reuse and independent multi-device recovery.
- Add focused parity/failure regression tests for these fixes; the current aggregate test cannot establish P1–P15 completeness or crash/send safety.
