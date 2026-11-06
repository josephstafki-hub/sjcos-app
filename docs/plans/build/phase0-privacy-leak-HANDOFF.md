# Round-4 private-text census and server evidence (2026-11-05)

This is the current inventory; earlier round-1/2 counts and business-only
classifications below are historical. Implementation/status contracts are in
[phase0-B-HANDOFF.md](phase0-B-HANDOFF.md). **0105 changed in place and remains
unapplied on live.** Round 4 includes both panel and server fixes; earlier validation below is historical.

## Where text can live

A reply to a business card does not publish its private chat text. The full
Telegram body/answer is retained only in protected `owner_replies`; the shared
business records now receive fixed status. This removes the demonstrated copies
instead of making business work items/cards disappear from their shared queues.
The source owner's read/mutation/delivery checks and source FORCE RLS remain the
boundary for the original text. The following is a producer/consumer census,
not a claim that a static scanner proves arbitrary future model/tool dataflows.

| Table / text-bearing fields | Protection / disposition |
|---|---|
| `ai_conversations.title`, `ai_folders.name` | Verified session person; explicit self predicates before ordering/limit; immutable ownership, FORCE RLS, journal/deleted-thread fences. Auto-title is private, even when derived from a first prompt or attachment name. |
| `ai_messages.body`, `attachments` (name/path/MIME) | Same-person live-thread DAL and FORCE RLS. Names also occur in attachment-only prompts in `dev_agent_runs`, never in an automatic business receipt. Upload bytes/sidecars and handed-file transports retain exact live owned-thread association guards before read/copy. |
| `dev_agent_runs.prompt/page_context/answer/activity/spoken_answer` | Canonical person/run/thread admission, explicit run/thread ownership before poll/review/TTS, FORCE RLS and write guards. Original private content retains the existing grace-purge policy. Historical contaminated background hook runs are redacted and fenced as `ask_reply_erased` audit shells. |
| `agent_interactions.payload/response` | Exact live run/thread/principal guard, closed stdio adapter, FORCE RLS; no raw narrow private reads. |
| `run_steers.body` | Person/run guard, FORCE RLS and thread/journal fence; deleted-thread access refused, grace purge redacts. |
| `owner_grants.reason/scope/audit` | Fixed Express permission reason, historical excerpt redaction; materialized immutable run/thread source, self-only bridge/lookup before limits, FORCE RLS. Tombstone revokes and clears content. |
| `owner_replies.body/answer/error` | Verified owner/thread at record; exact person/live-thread selectors for lookup/mutation/delivery; journal through send; FORCE RLS. No private fallback to a shared/background route. Tombstone/replay clears body/answer/error. |
| `decisions.decision_note/hold_note` | Automatic session reply copy removed: fixed status only; historical notes cleared/replaced in 0105 and replay. Existing explicit business title/summary/card permissions remain; whole business rows are not private storage. |
| `decision_events.detail` | Automatic session reply note removed; historical note/reason keys scrubbed, including truncated-origin decisions; fixed status on new events. Shared event readers never receive the original private reply. |
| `action_intents.last_error` | Private reply cancellation uses fixed status; historical decision/grant-linked errors scrubbed in 0105/replay. Explicit staged send payloads remain business artifacts with owner-grant delivery policy. |
| `work_items.blocked_reason` | Private draft reply uses fixed status, not the 500-character reply prefix. Historical private-reply-linked fields scrubbed in 0105/replay; work-item business title/body and existing permissions remain. |
| `agent_triggers.payload/last_error` | Additional confirmed fan-out: decision hook copied `decision_note` before closing its wake. Historical note/owner-reply/draft-text keys/errors removed; trigger finished and fenced permanently against late update. New session hooks receive only fixed status. Unbound explicit business reply triggers keep their business policy. |
| `agent_executions.tool_trace/result_summary/blocked_reason/next_trigger/error/context_refs/records_touched` | Historical contaminated hook consumers scrubbed, including orphan `trigger_ref` associations, and fenced against late completion/new execution from an erased trigger. Run-linked private execution copies now have FORCE RLS, immutable run source and recovery/deletion guards; shared history/context exclude private runs before limits. Tombstone/replay erases payloads immediately. |
| `run_effects.detail/entity_id/entity_kind/action` | Additional automatic runtime carrier, now source-person/live-thread FORCE RLS plus immutable run source and write fences. Request review/focus checks the exact person's run before serialization. Tombstones clear content/entity hints. |
| `agent_pending_actions.payload/review_note/entity_id/entity_kind` | Additional proposal/input copies: source run FORCE RLS, run/thread consistency and immutable source guards; tombstone/replay clears payload/text/entity hints and cancels. |
| `orchestration_tasks.task_prompt` | Additional prompt copy: source-thread FORCE RLS, immutable conversation and recovery/deletion guards; tombstone clears/cancels. |
| `orchestration_events.note` | Additional answer/judgment copy: task-source FORCE RLS, immutable task/run consistency and write guards; tombstone clears note. |
| `agent_runs`, `agent_receipts`, `knowledge_items` | Reviewed producers record explicit business run/receipt/draft/knowledge artifacts, not automatic Ask transcripts. Draft receipt metadata supplies opaque run/conversation IDs for routing; labels/content are explicitly submitted business artifacts. Existing business/file permissions apply. These must never be used as an automatic private-reply sink. |
| `action_attempts`, `owner_touches`, `decision_deliveries`, `telegram_reply_targets` | Status/provider/audit/opaque reference carriers, included in scan. No additional automatic full chat copy found: decision touch has via/kind, Telegram target has IDs only, delivery stores status/reference/error, provider attempts do not consume the Telegram note. Explicit business provider summaries keep their business policy. |
| `push_outbox.title/body/payload/href` | Confirmed historical private reply card carrier. 0105/replay scrub sent and pending/failed rows using decision/work/grant and legacy href/button/edit-delivery associations. Per-write trigger irreversibly sanitizes to fixed status; immediate and queued/retry sends sanitize even stale snapshots. Real agent/worker/readonly login tests cannot read the sentinel. |
| `private_ask_push_sources.kind/ref` | Website-only opaque association registry, no private text or narrow table privileges; source triggers capture links and retain them after purge, boolean-only definer lookup supports worker sanitization. |
| `notifications.title/subline`, digests | Reviewed decision notifications use the explicitly submitted business card's title/summary, not session reply or chat title. No automatic Ask completion/reply text writer found in the reviewed Ask/runner/Telegram paths. Removing downstream private status copies prevents context/digest re-publication. Existing audience rules are not being claimed as a substitute for private-text protection. |
| `browser_tasks.purpose`, `browser_commands.safe_result`, `browser_web_commands.safe_result`, `browser_read_manifests.public_entries/private_entries_ciphertext/envelope` | Potential Browser title/name/result carriers now included by all-`browser_*` scanner coverage. 0100 revokes all narrow logins' table privileges and enforces source/session identity; Browser remains disabled pending Phase 0b. This task makes no Browser runtime/presence/vault certification. |
| `browser_audit` (origin/result code/opaque IDs), related Browser identity/audit tables | Included in scanner; schema has no arbitrary chat-body/detail column. Website-only privileges and append-only/source guards from 0100; Phase 0b remains separate. |

The erasure function is website-only (`REVOKE PUBLIC`, session identity check,
SECURITY DEFINER with pinned search_path), runs in the journal transaction before
original reply erasure, and is idempotent on replay. New private runtime source
links cannot be cleared/replaced to reclassify a row as shared. Agent, worker and
readonly session identities cannot bypass FORCE RLS by setting an actor GUC.
Encrypted backup SELECT policies are explicit; no narrow grants were broadened.

## Scanner and tests

The maintained source inventory now contains **468 function/source entries,
909 SQL/conservative fragments, 209 files**: **98 fenced, 154 trusted-background,
216 not-private**. It includes the four demonstrated shared status columns,
trigger/execution/receipt/attempt carriers, every `browser_*` schema carrier,
composed SQL and filesystem/closed-transport sources. New plain SELECTs from
those tables in a new file fail review. Business-only classifications mean
private copies were removed or the artifact is explicitly filed; they do not
mean that every future string passed to that table is automatically safe.
Whole source/query hashes detect changes to reviewed producers/guards/readers;
unknown wrappers, new indirect cross-module dataflows and arbitrary ORM/view
semantics still require runtime tests and human review.

Each file ran as a separate single-file invocation with tagged disposable DB
cleanup, including after fixture failures. Final results:

| Test file (`tests/<name>.test.mjs`) | Passed | Failed / skipped |
|---|---:|---:|
| ask-r3-auth-db | 4 | 0 / 0 |
| ask-r3-reply-copies-db | 6 | 0 / 0 |
| ask-r2-server-db | 11 | 0 / 0 |
| ask-server-boundaries-db | 8 | 0 / 0 |
| ask-thread-access-db | 33 | 0 / 0 |
| ask-folder-privacy-db | 11 | 0 / 0 |
| ask-thread-recovery-db | 43 | 0 / 0 |
| ask-private-query-scan | 6 | 0 / 0 |
| db-roles-manifest-db | 6 | 0 / 0 |
| db-roles-paths-db | 3 | 0 / 0 |
| mobile-rpc | 28 | 0 / 0 |
| agent-runtime-db | 10 | 0 / 0 |
| web-sessions-db | 4 | 0 / 0 |

**173 passed, zero failed/skipped.** R3 auth uses actual JWT/session registry,
Proxy/NextRequest, exported send/poll/load/upload actions, DAL, status route and
mobile adapters. It tests missing, JWT-expired, registry-expired, revoked sid,
legacy valid/expired/revoked cookies and positive authenticated actual sends
with real message persistence (provider launch stubbed, no actual spawn).
Voice assertions cover actual GET/POST modules plus real recovery-gate tests,
no provider while closed and separate sub daily-log policy. R3 security uses
real non-superuser website and narrow `session_user` identities, historical
migration data, actual record/resolve paths, authorized/foreign reads,
source mutation denial, shared positive controls and replay erasure. R2 retains
real delivery/filing ownership and actual pg_dump/restore replay evidence.

Locked niced `tsc`: **exit 0**. Role scan: **exit 0**, all reported differences
intentionally withheld with manifest explanations (see server handoff); exact
unchanged generator lines are in 0105. `git diff --check`: clean. No live/QA
DB/service, deployment state, browser, Next process, install or subagent was used.
Coordinator still owns the expired-mid-chat DOM/voice-recovery console checks;
server fixtures are not browser acceptance or deployed authority certification.

---

# Phase 0 Ask privacy leak correction (2026-11-05)

Base: `854a9026`, branch `t3/in-app-browser-agent-tools`. Implementation sub-agent;
no delegation, UI edits, dependency installs, builds, browsers, live/QA database
access or service operations. `node_modules` remains the existing symlink.
This report supersedes earlier claims that RLS or the old helper-only caller
inventory proved the rail private.

## Result and folder rule

A chat belongs only to its creator, including Joe. Folders are **per person**,
not shared entity containers. This follows Ask host A1 / Canvas §8.1 self-only
folder/count requirements and the existing 0105 `owner_user_id` plus
`(owner_user_id, entity_kind, entity_id)` unique index. No schema change is
needed. Two people may independently file under the same business entity;
neither gets the other's folder name, existence/conflict, working state,
activity timestamp, suggestions, thread titles or counts.

- `listThreadRail`, `listArchivedThreads`, the older agent/all-thread lists,
  folder lists, entity-folder joins/conflict lookups, busy counts and mutations
  have explicit current-actor predicates, before ordering/LIMIT/aggregation.
  Archived OR branches are parenthesized under ownership. Deleted threads are
  excluded. Existing client grouping/counts receive only the person's rows.
- Every thread lifecycle/folder context operation checks exact thread access
  before activity checks or side effects. Filing checks before creating a
  folder. Moving/creating validates the destination folder; folder mutations
  validate its owner before reading busy state. Public actions return the fixed
  `THREAD_UNAVAILABLE`, including Joe acting on Abigail's thread. No UI change.
- Search verifies that its authenticated web/bearer principal matches the
  current session and applies the same explicit SQL ownership predicate for
  staff and Joe. The staff path already had that SQL predicate at this base;
  regression coverage now proves the actual staff query and returned rows with
  RLS bypassed, rather than assuming it from a role branch.
- Shared run/interaction guards scope their initial queries, and direct data
  readers (chat/model inputs, run poll/focus, spoken-answer cache, interaction
  answer/dismiss and steer lifecycle) recheck exact access. Poll-side run/task
  expiry and orphan interaction expiry cannot mutate another person's work.
- Poll auto-settle is per actor, including its throttle. The separate
  `thread-folder-maintenance` adapter is imported only by the existing
  CRON_SECRET-authenticated agent-retries route and runs under the journal.
  Neither action input nor a missing session selects that trusted path. Its
  count goes only to the machine caller. Quiet background settling still works.
- Approval retries count only unbound background runs. Agent-runtime context
  refuses conversation-linked owner-reply bodies. Business decision/draft
  replies and aggregate operations metering are explicitly distinguished from
  private chat transcripts in the audit below.

## RLS assessment

0105 **already ENABLEs and FORCEs RLS** on conversations, messages, runs,
interactions, folders and steers. Its `ask_private_visible` intentionally permits
an unset actor for the trusted website login. PostgreSQL superusers also bypass
FORCE. Therefore FORCE alone does not fix this leak. The new adversarial tests
run once with actual non-superuser website `session_user=current_user=
 sjcos_test_website`, and once with the harness superuser (RLS bypass), using
separate verified Joe/Abigail session IDs. Neither relies on SET ROLE pretending
to be a login.

No RLS policy, role grant or migration was changed in this slice. The existing
threadQuery transaction already sets `sjcos.ask_actor` locally; admission now
sets it on its own transaction as well, before loading the thread. Ownership
predicates/access checks are also enforced in application SQL, independently
of RLS.

Making *all* website SQL fail closed on an absent actor is deferred because the
same owner pool/login is also used by detached runner startup/heartbeat/results,
OS-journal recovery/replay/purge, secret cron adapters and transaction callbacks
(`Run`) with no request/session. Changing the policy now would disable those
paths; setting a session-wide pool GUC would introduce concurrent-person identity
contamination. A safe follow-up needs a distinct non-superuser request pool/role,
transaction-scoped actor for every request/Run transaction, and separately
run-bound maintenance/runtime identities/adapters (with role manifest, migration
and restore/runner tests), rather than treating absence of a session as trust.
No claim is made that website arbitrary SQL execution is sandboxed by RLS.

## Scan defense and complete caller audit

`tests/ask-private-query-scan.test.mjs` scans **all** source files under `lib/`,
`app/`, `mcp/`, `scripts/`; no directory/file-wide SQL exemption. It includes the
five requested tables plus folders, steers, run effects, pending actions and
orchestration tasks/events. It tracks literal/template/concatenated SQL and
referenced table/SQL-fragment constants. It conservatively includes some
non-SQL prompt/business fragments. Each allowlist entry has an exact file,
function, classification, prescribed reason, explanation and query hashes;
source-file hashes also pin guards/imports, so removing a guard without changing
SQL fails. New files/functions/queries, changed queries and stale entries fail.
The trusted cron adapter's imports are checked across the entire source tree.
There is no auto-update/generate-allowlist command committed to the repository.

The scan guarantees that statically identified private SQL/fragments cannot
change or be added without updating an explicit reviewed inventory. It is a
regression fence, not a SQL authorization engine or proof that an allowlisted
function is correct. Arbitrary runtime-generated/obfuscated table names require
human review; the real identity/bypass DB tests establish actual privacy behavior.

| Classification | Function entries | SQL / conservative fragments |
|---|---:|---:|
| fenced | 71 | 108 |
| trusted-background | 30 | 63 |
| not-private | 18 | 31 |
| **Total** | **119** | **202** |

`not-private` means only explicitly described shared business records,
opaque health/routing metadata, global cost/quota aggregates or conservative
non-SQL matches; it is not an owner exception for reading staff transcripts.
The allowlist is `tests/fixtures/ask-private-query-allowlist.json`.

Non-SQL entrypoints audited too:

| Surface | Disposition |
|---|---|
| `app/panel/page.tsx`, panel rail/history and `/today` dock | AI area gate; shared actions/data functions above own all thread reads. No UI file edited. |
| `lib/mobile-rpc/operator-reads.ts` and mobile operator route wrappers | Read adapter matches request/DAL identity; rail/archived/conversation/poll/review delegate to fenced actions. Real rail and archived serializers are exercised by the new DB test. |
| `lib/mobile-rpc/operator.ts` | Strict schemas + askBoundary; per-ID folder/thread/run mutations delegate to checked actions. |
| `lib/mobile-rpc/today.ts` | Handoff creates a new actor-owned conversation; poll delegates to checked run action, no direct private SQL. |
| `lib/actions/dev-agents.ts`, TTS route, legacy Ask routes | Public boundary + exact run/thread/interaction guards before callbacks or providers. |
| `mcp/interact-mcp.mjs`, `mcp/interact-tools.mjs`, `mcp/sjcos-mcp.mjs` | No direct private-table SQL; private interactions use the closed authenticated runner bridge and its journal/tuple checks. Ordinary business replies stay business metadata. |
| `lib/decisions/telegram.ts`, dispatch and maintenance routes | Verified owner-channel business events / secret machine routes; private session delivery still requires self access; maintenance exposes only opaque health. |
| `lib/permissions.ts`, `lib/entity-href.ts`, `lib/thread-rail.ts`, measure page | Permissions or pure metadata/formatting, no private SQL; rail partitions/counts use only fenced input; measure shows global operations aggregates. |

Full function inventory (SQL fragments in one function grouped; exact individual
hashes are in the allowlist):

| File | Function | SQL/fragments | Classification | Why |
|---|---|---:|---|---|
| `lib/actions/ai-chat.ts` | `sendMessageActionImpl` | 2 | fenced | Each public action uses askBoundary and exact requireThreadAccess before ID reads/writes; runtime INSERT uses admitAskRun or the internal owned-thread continuation. No independent RPC SQL. |
| `lib/actions/ai-chat.ts` | `resetClaudeSessionActionImpl` | 1 | fenced | Each public action uses askBoundary and exact requireThreadAccess before ID reads/writes; runtime INSERT uses admitAskRun or the internal owned-thread continuation. No independent RPC SQL. |
| `lib/actions/ai-chat.ts` | `renameConversationActionImpl` | 1 | fenced | Each public action uses askBoundary and exact requireThreadAccess before ID reads/writes; runtime INSERT uses admitAskRun or the internal owned-thread continuation. No independent RPC SQL. |
| `lib/actions/ai-chat.ts` | `startBackgroundTurn` | 1 | fenced | Each public action uses askBoundary and exact requireThreadAccess before ID reads/writes; runtime INSERT uses admitAskRun or the internal owned-thread continuation. No independent RPC SQL. |
| `lib/actions/ai-chat.ts` | `voiceTurnActionImpl` | 1 | fenced | Each public action uses askBoundary and exact requireThreadAccess before ID reads/writes; runtime INSERT uses admitAskRun or the internal owned-thread continuation. No independent RPC SQL. |
| `lib/actions/panel-review.ts` | `loadRunReviewImpl` | 2 | fenced | askBoundary + requireRunThreadAccess precede run and run_effects reads; staff effects remain area restricted. |
| `lib/agent-interactions.ts` | `listPendingInteractions` | 2 | fenced | Exact run/thread/interaction helper checks precede reads/answers/dismissals; orphan expiry has an explicit current-actor thread predicate. |
| `lib/agent-interactions.ts` | `answerInteraction` | 1 | fenced | Exact run/thread/interaction helper checks precede reads/answers/dismissals; orphan expiry has an explicit current-actor thread predicate. |
| `lib/agent-interactions.ts` | `dismissInteraction` | 1 | fenced | Exact run/thread/interaction helper checks precede reads/answers/dismissals; orphan expiry has an explicit current-actor thread predicate. |
| `lib/agent-runtime/context.ts` | `verifiedOwnerReplyOf` | 1 | trusted-background | Only runtime trigger context reads a verified owner business reply ID; conversation_id IS NULL prevents private-thread reply ingestion. |
| `lib/ai-chat.ts` | `listConversations` | 1 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `listAllConversations` | 1 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `getConversation` | 3 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `getTurns` | 1 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `getThreadMessages` | 1 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `insertConversation` | 2 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `insertMessage` | 2 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ai-chat.ts` | `autoTitleIfNeeded` | 1 | fenced | Lists explicitly filter current actor and live threads. ID operations requireThreadAccess; creation stamps the actor and validates folder ownership. threadQuery supplies actor transaction and journal fence. |
| `lib/ask-run-admission.ts` | `admitAskRun` | 2 | fenced | Verified session/person, transaction-local actor, explicit owned live-thread predicate and requireThreadAccess before admitted INSERT; immutable DB principal/continuation guards. |
| `lib/ask-thread-journal-interactions.mjs` | `interactionCommand` | 4 | fenced | Secret-authenticated closed runner_stdio bridge, immutable run/person/thread/profile/start tuple, active/revocation checks and withAskJournal; no caller-selected principal. |
| `lib/ask-thread-journal.mjs` | `deletionState` | 1 | not-private | Title-free latch/checkpoint and existence-of-deletion health only; no source payload or per-person activity. |
| `lib/ask-thread-journal.mjs` | `replay` | 2 | trusted-background | Journal recovery/replay/purge under the OS lock, independent durability and maintenance lease; trusted internal website identity, no user payload returned. |
| `lib/ask-thread-journal.mjs` | `deleteThread` | 1 | fenced | Verified principal is supplied by deleteOwnedThread; explicit owner/thread predicate and opaque operation retry under journal lock, never a general tombstone reader. |
| `lib/ask-thread-journal.mjs` | `maintainThreads` | 6 | trusted-background | Journal recovery/replay/purge under the OS lock, independent durability and maintenance lease; trusted internal website identity, no user payload returned. |
| `lib/authority/usage.ts` | `admitRun` | 1 | not-private | Global operational quota aggregate only (run count/cap verdict), no title, text, person, thread ID, per-folder count or per-thread activity. Not a source-chat reader. |
| `lib/decisions/owner-replies.ts` | `recordOwnerReply` | 3 | not-private | Business decision/draft replies explicitly written by Joe for business agents, not captured chat transcript. Queries use opaque chat IDs solely to choose delivery; private routing subsequently requires self access. No private title/messages/session selected. |
| `lib/decisions/owner-replies.ts` | `recordDraftReply` | 3 | not-private | Business decision/draft replies explicitly written by Joe for business agents, not captured chat transcript. Queries use opaque chat IDs solely to choose delivery; private routing subsequently requires self access. No private title/messages/session selected. |
| `lib/decisions/owner-replies.ts` | `closeRepliesRevisedByDraft` | 1 | not-private | Business decision/draft replies explicitly written by Joe for business agents, not captured chat transcript. Queries use opaque chat IDs solely to choose delivery; private routing subsequently requires self access. No private title/messages/session selected. |
| `lib/decisions/owner-replies.ts` | `closeRepliesRevisedBy` | 1 | not-private | Business decision/draft replies explicitly written by Joe for business agents, not captured chat transcript. Queries use opaque chat IDs solely to choose delivery; private routing subsequently requires self access. No private title/messages/session selected. |
| `lib/dev-agents.ts` | `runPrincipalStillValid` | 1 | not-private | Internal runtime revocation check reads only opaque principal ID/start/active and returns a fixed validity reason, never source chat content. |
| `lib/dev-agents.ts` | `hermesChat` | 1 | trusted-background | Internal owned-turn runtime stores instruction version metadata on its captured steer.runId; user-selected run IDs are not an input to this provider API. |
| `lib/dev-agents.ts` | `startClaudeRun` | 2 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/dev-agents.ts` | `getDevAgentRun` | 2 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/dev-agents.ts` | `stopDevAgentRun` | 2 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/dev-agents.ts` | `runHermesTurnTracked` | 3 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/dev-agents.ts` | `pingConversation` | 2 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/dev-agents.ts` | `retryFailedApprovalPings` | 1 | trusted-background | Secret cron sweep counts only unbound background attempts by shared business subject; private conversation runs explicitly excluded. |
| `lib/dev-agents.ts` | `failStaleRuns` | 1 | fenced | Human thread launches use admitAskRun/requireThreadAccess; poll and stop requireRunThreadAccess. Internal unbound background branches cannot bind a private thread. Poll reaper explicitly scopes current actor/live thread. |
| `lib/measure/baseline.ts` | `baselineOwnerTouches` | 1 | not-private | Owner operations measurement uses aggregate recorded cost and run count only; no per-person/thread identifiers, title, prompt, answer or folder state. |
| `lib/measure/cases.ts` | `linkedTouches` | 1 | not-private | Operations measurement and owner-touch accounting; private source tables contribute aggregate recorded cost/count only, never private chat contents or per-folder counts. Conservative scan also catches non-private measurement SQL fragments. |
| `lib/measure/cases.ts` | `recordOwnerTouch` | 1 | not-private | Operations measurement and owner-touch accounting; private source tables contribute aggregate recorded cost/count only, never private chat contents or per-folder counts. Conservative scan also catches non-private measurement SQL fragments. |
| `lib/measure/cases.ts` | `measurementSummary` | 1 | not-private | Operations measurement and owner-touch accounting; private source tables contribute aggregate recorded cost/count only, never private chat contents or per-folder counts. Conservative scan also catches non-private measurement SQL fragments. |
| `lib/measure/cases.ts` | `agentCost` | 3 | not-private | Operations measurement and owner-touch accounting; private source tables contribute aggregate recorded cost/count only, never private chat contents or per-folder counts. Conservative scan also catches non-private measurement SQL fragments. |
| `lib/orchestrator/activity.ts` | `write` | 1 | trusted-background | Runtime closure captures the admitted/generated run ID and writes buffered activity, never accepts an action-supplied row ID or returns another run. |
| `lib/orchestrator/effects.ts` | `recordRunEffects` | 1 | trusted-background | Internal completion of a generated/admitted run records effects and infers shared business audit scopes; caller does not accept request-selected run IDs. |
| `lib/orchestrator/effects.ts` | `inferHermesEffects` | 2 | trusted-background | Internal completion of a generated/admitted run records effects and infers shared business audit scopes; caller does not accept request-selected run IDs. |
| `lib/orchestrator/ladder.ts` | `addEvent` | 1 | trusted-background | Internal owned-thread runtime driver uses generated task/takeover IDs, owned transcript helpers and guarded steer relay; never a public task-history endpoint. Poll reaper separately actor scoped. |
| `lib/orchestrator/ladder.ts` | `effectsDigest` | 1 | trusted-background | Internal owned-thread runtime driver uses generated task/takeover IDs, owned transcript helpers and guarded steer relay; never a public task-history endpoint. Poll reaper separately actor scoped. |
| `lib/orchestrator/ladder.ts` | `runHermesLadder` | 11 | trusted-background | Internal owned-thread runtime driver uses generated task/takeover IDs, owned transcript helpers and guarded steer relay; never a public task-history endpoint. Poll reaper separately actor scoped. |
| `lib/orchestrator/ladder.ts` | `taskWithSteers` | 1 | trusted-background | Internal owned-thread runtime driver uses generated task/takeover IDs, owned transcript helpers and guarded steer relay; never a public task-history endpoint. Poll reaper separately actor scoped. |
| `lib/orchestrator/ladder.ts` | `failStaleTasks` | 1 | fenced | Poll-side task reaper uses threadQuery and explicit owned live-conversation predicate; cannot mutate another persons task. |
| `lib/orchestrator/ladder.ts` | `startLadderRun` | 1 | trusted-background | Internal owned-thread runtime driver uses generated task/takeover IDs, owned transcript helpers and guarded steer relay; never a public task-history endpoint. Poll reaper separately actor scoped. |
| `lib/orchestrator/proposals.ts` | `processQwenProposals` | 5 | trusted-background | Only the admitted owned-turn runtime supplies run/thread IDs; review records business proposals and updates its captured run, not request-selected history. |
| `lib/orchestrator/thread.ts` | `lastAnsweringAgent` | 1 | fenced | getThreadMessages requiresThreadAccess before continuity/model-input reads; fallback run query is restricted to that exact immutable owned conversation. |
| `lib/orchestrator/voice.ts` | `conciergeTurn` | 4 | not-private | No private SQL: conservative fragment tracking catches a prompt string; the input is the current supplied utterance, not stored chat data. |
| `lib/orchestrator/voice.ts` | `spokenUpdateForRun` | 2 | fenced | spokenUpdateForRun requiresRunThreadAccess before prompt/answer/cache access; concierge accepts current supplied utterance, not stored foreign-thread history. |
| `lib/owner-reply-delivery.ts` | `markDraftCardPulled` | 1 | not-private | No private SQL: conservative string tracking captures Telegram UI text for shared business draft cards. |
| `lib/owner-reply-delivery.ts` | `promptFor` | 1 | not-private | Shared business owner-grant request selected by its ID, not a private transcript; conservative scan also catches formatting strings. |
| `lib/owner-reply-delivery.ts` | `deliverOwnerReplyImpl` | 7 | fenced | Session route requires threadPrincipal owner plus requireThreadAccess(self), then journal/threadQuery; no private-denial fallback. Remaining writes update only the owner business reply being delivered. |
| `lib/owner-reply-delivery.ts` | `replyToOwner` | 5 | not-private | Owner-authored business reply delivery metadata and Joe-only Telegram routing; private session title/run reads additionally require current owner=self thread access and journal, never blanket owner access. MCP reply selects decision/work-item routing metadata, not source chat content. |
| `lib/owner-reply-delivery.ts` | `sweepUnansweredReplies` | 5 | trusted-background | Secret dispatch cron reads reply routing metadata; private session branch requires self access and skips when no verified current person, so cron cannot forward staff/private transcripts. Unbound branch reads business trigger results only. |
| `lib/panel-search.ts` | `searchPanelForUser` | 1 | fenced | Actor loaded by threadPrincipal must match authenticated web/bearer adapter user; SQL requires c.owner_user_id=$2 and live thread for both roles. Failure yields no chat hits. |
| `lib/run-focus.ts` | `getRunFocus` | 1 | fenced | requireRunThreadAccess before reading run_effects; downstream business entity resolution preserves area checks in consumers. |
| `lib/run-steers.ts` | `enqueueSteer` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `tryEnqueue` | 4 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `takePendingSteers` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `hasPendingSteers` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `releaseSteers` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `markSteersVia` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `closeSteering` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `reopenSteering` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `relaySteers` | 2 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `steersForRun` | 1 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/run-steers.ts` | `steerPrompt` | 1 | not-private | No SQL: conservative fragment tracking catches runtime prompt text; only caller-supplied already-owned steer bodies are formatted. |
| `lib/run-steers.ts` | `settleSteeredRun` | 3 | fenced | Public enqueue/status/relay and run lifecycle claims require exact run/thread helpers; bulk release/mark takes only internally claimed steer IDs, never request input. Journal covers enqueue/relay transactions. |
| `lib/thread-access.ts` | `requireThreadAccess` | 1 | fenced | Verified session/person; exact self-owner/live thread or run principal; no owner override. Attachment path is canonical, owned live refs or same-person pending upload; global attached boolean stays internal to denial. |
| `lib/thread-access.ts` | `requireRunThreadAccess` | 1 | fenced | Verified session/person; exact self-owner/live thread or run principal; no owner override. Attachment path is canonical, owned live refs or same-person pending upload; global attached boolean stays internal to denial. |
| `lib/thread-access.ts` | `requireInteractionThreadAccess` | 1 | fenced | Verified session/person; exact self-owner/live thread or run principal; no owner override. Attachment path is canonical, owned live refs or same-person pending upload; global attached boolean stays internal to denial. |
| `lib/thread-access.ts` | `withThreadAttachmentAccess` | 1 | fenced | Verified session/person; exact self-owner/live thread or run principal; no owner override. Attachment path is canonical, owned live refs or same-person pending upload; global attached boolean stays internal to denial. |
| `lib/thread-folder-maintenance.ts` | `autoSettleQuietThreadsInBackground` | 1 | trusted-background | Only secret-authenticated agent-retries cron imports this entry point; journal-fenced sweep of live quiet owned threads, returns aggregate count to the machine caller. No action option selects it. |
| `lib/thread-folders.ts` | `requireFolderAccess` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `searchFolderEntities` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `listFolders` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `getFolder` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `createFolder` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `ensureFolderForEntity` | 3 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `renameFolder` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `bindFolder` | 3 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `reorderFolders` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `setFolderCollapsed` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `setFolderArchived` | 2 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `deleteFolder` | 2 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `<module>` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `listThreadRail` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `listArchivedThreads` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `threadBusy` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `settleThread` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `unsettleThread` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `touchThreadActivity` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `setThreadPinned` | 2 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `setThreadArchived` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `moveThread` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `autoSettleQuietThreads` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `lib/thread-folders.ts` | `folderContextLine` | 1 | fenced | Per-person folders. Explicit actor SQL on lists, entity-folder joins, conflict lookups, counts and writes; exact thread/folder access checks before metadata or mutation. Per-actor poll sweep. Shared THREAD_SELECT fragment is consumed only with OWN_THREAD. |
| `app/api/internal/canvas-maintenance/route.ts` | `reportHealth` | 1 | not-private | Secret-authenticated maintenance health reports only opaque UUID/count/ready state; no private chat text. Conservative SQL scan also tracks fixed private-table absence checks. |
| `scripts/run-claude-agent.mjs` | `finish` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `loadBusinessInstructions` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `withPrivateThread` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `unseenTranscriptAllowed` | 3 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `flushActivity` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `recordEffect` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `steerText` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `takeSteers` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `takeSteersAllowed` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `onResult` | 2 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `runClaude` | 2 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `main` | 4 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `recordUsage` | 1 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |
| `scripts/run-claude-agent.mjs` | `persistToConversationAllowed` | 2 | trusted-background | Trusted detached runner captures RUN_ID from server spawn, not public RPC. withPrivateThread checks run/person/owner/revocation/tombstone under journal before transcript/steer/persist/session work. Startup/heartbeat/completion operate only that captured run; narrow MCP child cannot use this login. |

## Verification

Expectations were written before implementation/execution in the new test
files. Real DB SQL, functions and login identities are exercised with controlled
request/session/journal-admission seams; this is not an HTTP/browser QA claim.
The folder test checks both real actions and mobile rail/archived serializers,
client grouping/count/activity inputs, both roles, active and archived rows,
foreign busy runs, same-entity independent folder binding, every thread folder
operation and unchanged database snapshots after denial. The separate recovery
suite tests the real journal; background auto-settle tests execute its real SQL.

Every invocation was one file at a time with `SJC_TEST_CLUSTER_TAG=p0leak-<ts>`;
each invoking shell used an EXIT trap to stop/remove that cluster, including
failed assertions. All clusters were stopped. No exit 137 occurred.

| Test file (`tests/<name>.test.mjs`) | Final pass | Fail |
|---|---:|---:|
| ask-folder-privacy-db | 11 | 0 |
| ask-private-query-scan | 4 | 0 |
| ask-thread-access-db | 33 | 0 |
| ask-thread-recovery-db | 43 | 0 |
| ask-server-boundaries-db | 8 | 0 |
| ask-run-admission-db | 4 | 0 |
| panel-search | 6 | 0 |
| mobile-rpc | 28 | 0 |
| db-roles-manifest-db | 6 | 0 |
| db-roles-paths-db | 3 | 0 |
| run-steers-db | 1 | 0 |
| panel-defects | 6 | 0 |
| merge-chat-regressions | 2 | 0 |
| agent-runtime-db | 10 | 0 |
| canvas-rollout-db | 3 | 0 |

Earlier admission test failure caught a result-code regression (foreign rows
became PRIVACY_REQUIRED after filtering); fixed to THREAD_UNAVAILABLE without
weakening its assertion. Existing panel-defects fixture gained the exact access
helper seam. Merge-chat-regressions had a stale missing askBoundary stub at the
base; its isolated external-boundary fixture now supplies the wrapper and keeps
all routing/no-write/context assertions. A new scan import-boundary test first
matched a documentation comment; corrected to match import/require syntax.

Final prescribed typecheck:
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` **exit 0**.
`node scripts/db-roles-scan.mjs --diff` **exit 0**; all printed differences have
existing intentional withholding annotations, no new grants needed. Specifically:
agent's settings, authority, lane, permission audit, policy, revocation and user
writes remain owner-only. Worker's private interaction UPDATE/message DELETE,
journal/session state, payment authorization, QBO, mailbox tokens and the same
owner-control tables remain withheld website/maintenance paths from import
tracing. The scan does not justify broadening worker access to private threads.
The actual role identity/privilege tests pass. No migration or manifest changed
because no new table or narrow-role writer was introduced.

Coordinator-only visual checks remain: Joe and Abigail separately open `/panel`,
History, Show archived, staff Cmd-K QA search and the `/today` dock/mobile rail;
confirm each payload/list/count/status contains only that person's threads.
No browser, server or build was started here. No deploy was performed.

## Round-2 derivative and filesystem correction (supersedes prior acceptance)

The previous source-only audit missed the real filing filesystem reader and
incorrectly treated private prompt/answer copies as business-only. Current
boundaries and restore/bootstrap operations are detailed in `phase0-B-HANDOFF.md`
(round-2 correction). Migration 0105 changed in place, unapplied on live;
existing QA databases need rebuilding. Narrow privileges remain unchanged;
FORCE RLS now partitions private grants/replies from shared business rows.

| Surface | Current authorization |
|---|---|
| Filing Ask paths, including shared ancestor roots/aliases | Captured stdio tuple validated against active attended run/person/live same-owner thread; exact attached path before byte read, journal spans copy. No unbound/HTTP/foreign/deleted access. |
| Grant excerpts/list/check | Fixed Express reason and historical redaction. Before limit/serialization, shared rows or captured person's live thread; expired foreign checks identical to missing. Owner's website list preserves own grants. |
| Owner reply lookup/mutation/delivery | Person/live-thread predicates before lookup/update; journal held through send; private recording checks authenticated owner; shared fallback cannot substitute for missing private reply. |
| Private reply/copy raw SQL | Agent/worker/readonly actual session identities cannot SELECT private body/answer or grant reason/scope/audit even with forged actor GUC. Source-link triggers refuse invisible source or reattachment. |
| Deletion and restore replay | Immediately redact private reply body/answer and grant reason/scope/audit; revoke grant; tombstoned replies cannot deliver. Shared-only unattended sweep stops automatic private answer copying. |
| Protected deployment latch | Explicit bootstrap outside DB/journal loss sets; monotonic fsynced ledger binding before deletion. Missing identity/config, restore-before-latch, wrong/unreachable authority pause until replay. |

The maintained scanner now inventories **223 function/source entries, 366
SQL/conservative fragments across 99 files**: **97 fenced, 76 trusted-background,
50 not-private**. JSON contains per-entry explanations and source/query hashes.
It includes owner_grants, owner_replies, notifications and Telegram target
carriers; literal concatenation and array-join table names; conservative unknown
table expressions; non-SQL upload/reader/closed-transport sources; and database
SQL definitions/migrations. New counterexamples all fail without explicit
review. Fixed/whitelisted business table expressions and owner-only import /
backup / migration CLIs are classified separately. Private reply helpers are
no longer blanket "not-private". A green scan detects changes to reviewed code;
it is NOT runtime authorization, proof of all possible indirect data flows,
whole-program string evaluation or arbitrary ORM/view semantic resolution.

All test files ran individually, sequentially in tagged disposable clusters
`SJC_TEST_CLUSTER_TAG=p0r2srv-<ts>`, with EXIT traps that stopped the cluster on
success/failure. No exit 137, install, browser, Next process, live/QA DB/service
access, deploy or subagent. Panel-owned files were not edited/staged.

| Test file (`tests/<name>.test.mjs`) | Final pass | Fail / skip |
|---|---:|---:|
| ask-r2-server-db | 11 | 0 / 0 |
| ask-thread-recovery-db | 43 | 0 / 0 |
| ask-server-boundaries-db | 8 | 0 / 0 |
| ask-private-query-scan | 5 | 0 / 0 |
| ask-thread-access-db | 33 | 0 / 0 |
| ask-folder-privacy-db | 11 | 0 / 0 |
| ask-backfill-db | 3 | 0 / 0 |
| db-roles-manifest-db | 6 | 0 / 0 |
| db-roles-paths-db | 3 | 0 / 0 |
| grant-supersede-db | 1 | 0 / 0 |
| unsorted-docs-db | 2 | 0 / 0 |
| mcp-unsorted-upload-db | 2 | 0 / 0 |
| portal-telegram-db | 3 | 0 / 0 |
| grant-gate | 9 | 0 / 0 |
| mcp-team-tools | 13 | 0 / 0 |
| canvas-rollout-db | 3 | 0 / 0 |

Total final validation: **156 passed, zero failed/skipped across 16 files**.
The two legacy FIN_TEST_DATABASE_URL consumers initially skipped without that
variable; rerun with an explicitly minted disposable harness URL: 1/1 and 2/2.
One initial access test failed because its VM fixture lacked the new bridge
import; the fixture now supplies the no-bound-person seam, preserving all its
assertions. No product failure was reclassified as success.

Final typecheck via the prescribed flock/nice command: **exit 0**.
`node scripts/db-roles-scan.mjs --diff`: **exit 0**, all differences explicitly
withheld (owner-control writes; website-only private interaction UPDATE/message
DELETE; maintenance/session state; payment authorizations, QBO and mailbox
credentials). No worker privilege expansion. Both real-DB role files pass;
matching generator lines are in 0105 and the server handoff.

Coordinator checks remain Joe/staff own-only rail/history/archived/search/Today,
plus staff MCP grant list/check and denied foreign filing. Production restore /
loss/authority acceptance and protected deployment-state provisioning remain ops
work; no runtime Browser or actual deployed authority-service certification is
claimed by the fixture tests.


## Round-4 transitive outbox/queue/log re-sweep

The earlier “18-table” claim missed `push_outbox`; it is superseded by the
explicit carrier row above. Reviewed schema/migration definitions and direct
writers/consumers again, not merely the old hash allowlist:

| Table / queue | Reviewed disposition |
|---|---|
| `push_outbox` | Private historical card copies removed; irreversible sanitizer and stale-retry protection, migration/replay and three real narrow-login regression controls. |
| `newsletter_outbox` | Explicitly composed newsletter/welcome/drip text; owner grant on release. No automatic Ask/reply producer found. |
| `bid_invite_emails` | Explicit business bid/package email text; existing owner-approved dispatch, not automatic chat copying. |
| `inbox_drafts` | Mailbox/person human drafts and owner-mailbox AI reply suggestions from business messages; per-user/mailbox queries. No Ask transcript/reply producer found. |
| `sms_messages` / `sms_threads` | Explicit/inbound SMS records and grant-gated sends/retries, not automatic private Ask text. |
| `chat_messages` | Explicit/inbound portal/sub communication; channel authorization. Private session reply delivery does not publish here. |
| `notifications` / `notification_reads` | Business card title/summary or fixed status, audience-scoped bell/read state. Phone-only resolved decision refresh bypasses bell. No additional automatic private body/name producer found. |
| `telegram_reply_targets` / `telegram_updates` / `decision_deliveries` | Opaque message/thread/provider IDs, dedup and delivery status; no Telegram body outbox. The durable owner Telegram body queue is `push_outbox`; direct private answer transport remains journal/person fenced. |
| `action_intents` / `action_attempts` | Explicit business send payloads/provider outcomes; historical reply-derived errors erased, new private reply errors fixed. Existing grant dispatch boundaries remain. |
| `agent_triggers` / `agent_executions` / `dev_agent_runs` | Private reply fan-out scrubbed and erased-shell guarded; private run copies use source FORCE RLS. Shared history/context excludes private runs. |
| `agent_pending_actions` / `run_effects` / `orchestration_tasks` / `orchestration_events` / `run_steers` / `agent_interactions` | Private run/thread association, immutable source and person/live-thread RLS; deletion/replay erasure. |
| `work_items` / `decision_events` / `decisions` / `owner_grants` / `owner_replies` | Protected originals or fixed/redacted reply-derived fields as detailed above. Explicit filed business artifacts retain business policy. |
| `agent_runs` / `agent_receipts` / `knowledge_items` / `document_drafts` / `marketing_drafts` | Explicit submitted business artifacts, no additional automatic private chat producer found. |
| `app_change_log` / `reminder_log` / `cron_runs` / usage/audit logs | Table names, dedup keys, fixed status/count/IDs/usage; no additional automatic private text producer found. Detached runner stdout remains ignored. |

No separate `email_outbox`, `sms_outbox` or `telegram_outbox` table exists in
the reviewed schema/migrations. Email dispatch uses business drafts/intents and
bid/newsletter records; SMS uses `sms_messages`; Telegram uses `push_outbox` or
the private direct delivery adapter. These are traced producer conclusions,
not a proof against future explicit model-authored business artifacts or host /
provider histories. Scanner now inventories `push_outbox` queries and source
hashes, including its producers and drain paths; counterexample coverage includes
that table. New table registry is opaque metadata, not a private-text copy.

Round-4 final scanner inventory: **475 entries, 921 conservative fragments,
212 files** (104 fenced, 157 trusted-background, 214 not-private), zero
violations. Final round-4 validation is **266 passed / 0 failed / 0 skipped**
across 15 single-file runs; exact per-file counts and scan/typecheck evidence
are in the round-4 section of `phase0-B-HANDOFF.md`. No live migration applied.


## Main merge phone-copy census (2026-11-06)

Current extension: [merge-main-HANDOFF.md](merge-main-HANDOFF.md). Main adds
`owner_push_messages` title/body/href/outcome/thread keys, APNs payloads,
conversational `push_outbox.payload.appText`, phone action text/evidence/result,
folded-summary and Telegram fallback paths. Additive 0112 irreversibly sanitizes
private Ask associations and descendants to fixed status, including historical
summaries/outbox-only associations. Opaque reply/phone source IDs persist in the
website-only registry after purge; tombstone/replay calls both erasure helpers.
Historical text-derived conversation dedup keys are cleared and new hashing
happens after sanitization. Notification overrides and stale delivery snapshots are re-sanitized; private
phone actions refuse before text persistence. Shared reply metadata queries
exclude conversation-bound rows. Legacy direct Telegram fallback refuses private
or unavailable classification. Ordinary business/portal phone behavior remains.

Phone lines and SMS thread/message summaries consume explicit business
communications, not automatic Ask prompts/replies/titles/attachment names; all
are now inventoried alongside opaque device/session/delivery carriers.
Non-SQL APNs/phone serializers are also source-hash pinned. See the merge
handoff for migration order, narrow login/provider regressions and final counts.

Final merge inventory: **611 entries / 1276 fragments / 247 source files**;
195 fenced, 156 trusted-background, 260 not-private. Scanner passes; see the
merge handoff for all 43 files and 661 passing assertions.
