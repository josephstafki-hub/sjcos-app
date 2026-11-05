SCORES: design=7 completeness=6

Security BUILD round 2; independently reviewed HEAD 1495e052. This supersedes my round-1 privacy acceptance. The rail fix is effective, but privacy is still broken through copied data outside the primary thread tables. No source changes, delegation, browser, Next process, deployment, live/QA database access, or provider sends. Only this report is staged.

## Path inventory and verdicts

“Pass” below means inspected code plus the indicated targeted tests, not exhaustive HTTP or production acceptance. Business records intentionally submitted for shared work are distinct from automatically copied private prompts/answers.

| Surface / server path | Verdict and boundary |
| --- | --- |
| `/panel`, history, archived rail, `/today` Ask dock → actions/ai-chat → thread-folders / ai-chat | PASS: explicit self predicates before ordering/limits, deleted exclusion, per-person folders. Actual Joe/Abigail sessions tested with non-superuser website identity and RLS-bypassing harness login. No owner override. |
| Pin/archive/move/settle/file; folder create/bind/reorder/delete/context | PASS: exact access before busy checks or side effects; foreign destination rejected. Snapshot tests prove denied calls do not mutate/create folders. |
| Cmd-K/search → panel-search | PASS: current session must match supplied principal; SQL filters owner before limit. Both staff and Joe exercised. |
| Messages, unseen transcript, model input → ai-chat / orchestrator/thread / actions/ai-chat | PASS for stored-thread access: exact owner/live-thread guards; admission derives principal. Explicit business context uses area checks. |
| Run poll/activity/answers, review, focus → actions/dev-agents, dev-agents, actions/panel-review, run-focus | PASS: run principal and owned live conversation checked before payload reads; review effects area restricted for staff. |
| Questions/answers, approvals and steers → agent-interactions, run-steers, internal Ask interaction bridge | PASS: self thread/run checks; closed captured stdio tuple; secret route rechecks live run/person/profile/start/revocation. No HTTP caller-selected stdio identity. |
| Attachments/upload/extraction → actions/ai-chat, attachments, thread-access | PASS for application access: canonical path, owned live reference or same-person recent pending upload; send validates before recording references, extraction retains journal fence. Does not claim arbitrary owner-shell filesystem isolation. |
| TTS → api/tts, orchestrator/voice | PASS: run ownership before stored prompt/answer/cache/provider use; current utterance path does not load foreign history. |
| Mobile RPC → operator, operator-reads, today and operator upload | PASS: authenticated adapter/current principal alignment, strict action schema, same fenced DAL; rail/archive serializers tested against real DB. |
| Workbench/Today cards → workbench, actions/workbench, mobile-rpc/today | No automatic private transcript source found: timeline reads business agent_runs/receipts/activity; handoff creates an actor-owned thread; polling uses fenced run path. Business agent_runs is distinct from private dev_agent_runs. |
| Bell/feed → notifications, notify, decisions/notify | Audience predicates inspected: staff addressed/actor events, owner company events. No direct private thread query found. This is NOT proof that copied text is safe: grant-related derivatives need correction below. |
| Telegram → owner-reply-delivery, decisions/owner-replies, decisions/telegram | Session delivery and sweep require current owner=self thread access, deny without fallback to business runner. A cron without a person skips private session answers. BUT stored reply/answer copies and MCP reply mutation are not equivalently protected; see V2. |
| Push drain / notifications outbox → cron/push-drain, notify-owner | Secret machine route; business cards/outbox. No automatic Ask transcript publisher identified. No APNs implementation found in the searched app/lib/scripts/mcp source; APNs delivery is not certified here. |
| Cron digests / weekly-summary → field/server; retries → thread-folder-maintenance | Business summary path and secret guards inspected; retry count now restricts unbound background runs. Folder maintenance has separate import boundary and journal. No private transcript digest found. |
| MCP staff business tools → sjcos-mcp, grants-tools, internal/owner-grants | **FAIL V1:** list/check grants expose private prompt copies. Shared secret authenticates the bridge, not the person whose conversation is being disclosed. |
| MCP reply_to_owner → internal/owner-grants → replyToOwner | **FAIL V2:** no ownership check on conversation-linked replies; foreign grant/decision lookup can return reply ID and update its answer/state. Ordinary business-reply behavior must be separated from private replies. |
| Detached runner → scripts/run-claude-agent | Captured run identity and private-thread journal guards inspected; startup/heartbeat/result callbacks are trusted runtime paths, not public ID-selected readers. Narrow DB access still leaks derivative tables (V1/V2). |
| Metering/measure/authority usage | Global numerical business cost/quota aggregates, not prompt/title/answer bodies. No additional payload leak demonstrated. |
| Maintenance health/recovery/purge | Secret route, opaque health outputs; no title payload. A1 tests below. Purge omits derivative copies, relevant to V1/V2. |

This inventory includes non-SQL consumers rather than adopting the previous 71/30/18 classification as proof. In particular “not-private” is incorrect for a table that contains a private prompt excerpt or copied run answer, even if most rows are shared business data.

## Vulnerabilities

### V1 — HIGH: staff MCP exposes Joe's private Ask prompt through grants

- `lib/owner-grants.ts:117–120` automatically copies the first 240 normalized prompt characters into `owner_grants.reason` when minting Express permission.
- `lib/owner-grants.ts:56` / `:61` get/list without person filtering; `app/api/internal/owner-grants/route.ts:31` serializes reason/scope/audit; `:121–130` returns them for check/list.
- `mcp/sjcos-mcp.mjs:291` checks principal authority only for `perform`; list/check go directly to the secret-authenticated bridge. `mcp/grants-tools.mjs` registers these tools for staff runs too. `scripts/run-claude-agent.mjs:952–963` provides business runs these tools.
- Reproduction: Joe sends a private prompt with Express permission. Abigail's Ask agent calls `list_owner_permissions` during its live window: Joe's literal prompt prefix is returned, along with a grant ID usable for later check. Check has no live-only filter. No UUID guessing or credential theft required.
- Independently executed real production `mintRunGrant`, list/get and route POST code using the non-superuser website DB identity. Both list and check returned the sentinel private prompt with a staff principal supplied. The route ignored that principal. Also confirmed actual `session_user=current_user=sjcos_agent` can SELECT the copy directly. The bridge test substituted only NextResponse serialization and unrelated staged-send helpers; it did not run HTTP or perform a send.
- Hiding the serializer alone is insufficient: underlying narrow-role grants and existing copied rows remain readable. Deleting the chat does not purge this copy.

### V2 — HIGH at the narrow-login boundary; MEDIUM through MCP reply mutation: private reply/answer derivatives remain shared

- `lib/owner-reply-delivery.ts:315` stores a private run answer in `owner_replies.answer`; `db/migrations/0034_telegram_replies.sql:18` also stores session-linked reply bodies.
- `deploy/db-roles.manifest.json:1710` and migration 0060 grant agent/worker/readonly SELECT on all owner_replies. 0105 does not put this table behind private-thread RLS. Independent real-session probes read both body and copied run answer as all three narrow identities. This is a demonstrated database privacy boundary failure; it does not assert that staff has an arbitrary-SQL MCP tool.
- `lib/owner-reply-delivery.ts:230–252` separately finds replies by arbitrary reply/grant/decision ID and marks them answered with caller text, without binding the caller to conversation_id. Internal owner-grants `reply` and MCP grantsCall do not supply/check that binding. Foreign grant IDs are discoverable through V1. This path can claim a foreign private reply and disclose its reply ID; it does not return its full body.
- The new runtime-context `conversation_id IS NULL` filter is useful but cannot protect direct narrow SQL, the reply bridge, or stored copies after deletion.

## REQUIRED fixes

1. **Close V1 end to end:** stop copying private Ask prompt text into shared grant reason (use fixed text); remove/redact historical automatic prompt excerpts. Bind list/check to a verified, immutable runner/person context and authorize thread-linked grant reads against creator/live-thread state before serialization; foreign/missing must return the same fixed response. Protect any retained private grant derivatives from narrow raw SELECT with a private store or appropriate role/RLS policy and matching manifest migration. Add real staff/owner MCP list/check regression tests, including expired grants and deleted threads. Do not merely hide reason in the UI.
2. **Close V2 end to end:** partition shared business replies from private session replies. Deny narrow raw access to private bodies/answers; provide a run/person-bound bridge for legitimate private use. Before reply lookup/update or Telegram dispatch, verify the immutable calling context owns the associated live thread; fence updates as well as reads. Include private derivative copies in deletion/recovery handling (or stop retaining them). Add real-login SELECT-denial and foreign reply/grant/decision mutation tests; update the manifest/migration and audit classification accordingly.

## Static scan and no-actor RLS

The scan is a change detector over a manually approved inventory, not an authorization mechanism. Independently executed `scanSource` against these three strings; each returned zero hits:

```js
query('SELECT reason FROM owner_grants')
query('SELECT * FROM '+['ai','messages'].join('_'))
query('SELECT * FROM private_chat_view')
```

It also cannot generally resolve cross-module table fragments, arbitrary wrappers/ORM mappings, function-produced SQL or database view/function definitions outside its scanned roots. Owner_grants is a concrete missing derivative, not merely a hypothetical evasion. Full-file hashes only cover files with recognized hits. Existing owner_replies hits pass because the allowlist labels replyToOwner “not-private.” Passing all four scan tests therefore coexists with both findings.

0105 already uses FORCE RLS. Its `ask_private_visible` deliberately accepts absent actor for the website login. **That state is reachable during user requests:** lib/db's shared raw pool does not set ask_actor, and request handlers/helpers use it. The independent non-superuser website probe could read a private title without actor despite FORCE. It is false that absent actor itself guarantees trusted background execution. Explicit DAL guards are currently the protection; the fixed rail tests correctly exercise them independently of RLS.

A separate non-superuser request pool/role, transaction-local verified actor on every request transaction, default-deny RLS and narrowly scoped background commands are feasible. FORCE alone or session-wide GUCs are insufficient (superuser bypass / pooled identity contamination). This is recommended architecture, not a third required fix absent another demonstrated path: fixing V1/V2 must still enforce the concrete derivative boundaries. Pin wrappers/imports and extend scan coverage, but do not call that an execution-time guarantee.

## A1 and round-1 rechecks

A1: actual boundary tests passed virgin availability, deletion disabled, typed title-free errors, foreign deletion retry, latch UPDATE denial, local intent evidence with flag removed, restored checkpoint/latch with retained deletion evidence, and authority reconstruction after operations-volume loss. Recovery tests passed real pre-delete pg_dump restore/replay, stale/corrupt/wrong/racing authority, failed replication pending result, tombstone late-write refusal, lease CAS, grace/hold/purge, and captured interaction identity. Delete checks owner before consulting operation UUID when deletion is active; the foreign retry yields THREAD_UNAVAILABLE, not pending/deleted. DELETE_NOT_READY in virgin state is global readiness, not entity existence.

The latch is not tamper-proof against the website/table owner or filesystem administrator: trigger disabling/TRUNCATE or replacement of all evidence can bypass local permanence. A completely pre-deletion DB plus lost local journal plus removed authority configuration is indistinguishable from virgin state. Keep independent-authority restore procedures/configuration as part of deployment acceptance; tested restore cases retain/reconnect authority or retain another evidence source. No unprivileged request path to forge/remove latch was identified. A1.3 defers Browser runtime, not existing thread confidentiality.

Round-1 session/admission/network/schema/render tests were rerun, not inferred from the old score. No new bypass found in session identity/revocation, strict Browser contracts, IP/origin/connect checks, renderer CSP/sandbox/hash contracts or narrow Browser table grants. These are unit/DB guarantees, not browser/network runtime containment acceptance. Browser activation remains outside Phase 0a acceptance.

## Executed tests and evidence

All single files sequentially, disposable `SJC_TEST_CLUSTER_TAG=p0r2sec-<epoch>` clusters, stopped in shell EXIT traps or JavaScript finally. No exit 137. No HTTP server, browser, outbound message, or live/QA service used.

| Test | Pass |
| --- | ---: |
| ask-folder-privacy-db | 11 |
| ask-thread-access-db | 33 |
| ask-thread-recovery-db | 43 |
| ask-server-boundaries-db | 8 |
| ask-run-admission-db | 4 |
| ask-private-query-scan | 4 |
| ask-backfill-db | 3 |
| web-sessions-db | 4 |
| browser-network | 94 |
| browser-contract | 23 |
| canvas-renderer | 7 |
| canvas-content | 51 |
| browser-roles-db | 3 |
| db-roles-manifest-db | 6 |

Additional inline adversarial tests, written and executed without adding a source/test file (the task permits only this report):

1. Harness creates owner/staff people and owner-owned thread. Transpile actual owner-grants and internal route modules with TypeScript/VM, bind query/queryOne to `withSessionIdentity(url,'sjcos_test_website',...)`, mint a grant with sentinel prompt. Call POST list/check with secret-authenticated bridge request and staff principal. Assert JSON includes sentinel: **confirmed exposure**. Real `sjcos_agent` SELECT reason asserts sentinel remains accessible: **confirmed**.
2. Insert a session-linked owner_replies row with sentinel body and `answer_kind='run_reply'` answer. For actual agent/worker/readonly session identities assert SELECT body,answer returns sentinel: **confirmed exposure for all three**.
3. Execute scanner against the three snippets above: **zero hits each**.
4. Actual non-superuser website connection, no actor, SELECT owned-thread title: **returned title under FORCE RLS**.

These tests intentionally assert observed insecure behavior to establish reproducible counterexamples; remediation tests must invert their exposure assertions. Existing tests use controlled readSession seams with real person rows and session_user identities, not full cookie/HTTP authentication. No claim of exhaustive proof for every indirect business-data copy or external APNs system is made.

## Optional

Separate request/runtime DB authority; extend derivative-table inventory and scanner fixtures; add end-to-end staff MCP tests that include business tool responses, not only direct private-table reads. Coordinator visual checks should repeat Joe/Abigail rail/search/history/Today and inspect staff tool outputs after fixes. The previous round's 10/10 was unjustified and must not be reused as rollout evidence.
