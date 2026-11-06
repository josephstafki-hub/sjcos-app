# Round-3 server implementation (2026-11-05)

This section and the round-3 census in
[phase0-privacy-leak-HANDOFF.md](phase0-privacy-leak-HANDOFF.md) supersede earlier
privacy/inventory claims below. Started on branch `t3/in-app-browser-agent-tools`
at `245f5a09289310aef6d11a5a016bd8e77abd865e`. The parallel panel commit is
`0ade4617`; no panel-owned file was edited or staged by this server task.

1. **Security V1:** full session-routed Telegram text stays in `owner_replies`,
   with its existing verified owner/live-thread/journal, person-scoped lookup,
   mutation and delivery guards and FORCE RLS. `recordOwnerReply` passes fixed
   status to decision resolution; draft replies pass fixed blocked status.
   Thus `decisions.decision_note`, `decision_events.detail`,
   `action_intents.last_error` and `work_items.blocked_reason` no longer hold
   automatic private copies. Their business metadata stays shared under the
   existing business permissions; these four tables are deliberately **not**
   converted into private chat storage or hidden wholesale by RLS.

   **0105 changed in place; it is unapplied on live. Rebuild disposable QA rather
   than treating its old checksum as applied.** Its website-only
   `erase_ask_reply_copies(thread)` scrubs historical decision/event/intent/work
   item copies, decision-hook `agent_triggers` payloads, execution traces/results,
   and contaminated detached background runs (including orphan execution
   `trigger_ref` matches). The same function runs on tombstone/replay **before**
   erasing the original reply. Erased trigger/execution/background-run shells
   are permanently fenced against late completions; a new execution cannot use
   an erased trigger. No narrow login can invoke the erasure function or clear
   that fence. An installing website/repair session uses the purge scope; the
   function restores the previous scope before returning.

   The additional sweep found automatic private runtime copies in `run_effects`,
   `agent_pending_actions`, `orchestration_tasks`, `orchestration_events` and
   run-linked `agent_executions`. 0105 adds FORCE RLS with source-person/live
   thread visibility, immutable source triggers and recovery/deletion write
   fences. Shared execution history and context exclude conversation-linked
   executions before limit/serialization, even with the trusted raw website
   connection. Tombstones erase these runtime payloads and text/entity hints.
   Backup SELECT policies remain explicit. No narrow privilege was expanded;
   manifest notes and exact generator output are in 0105.

2. **Engineering 1 / design 1 server:** Proxy passes only POSTs with a
   `Next-Action` header through stamped `next(req)` before its optimistic page
   redirect. This is transport only: actual exported Ask actions still check
   the current session/person before query, upload, run or provider work.
   Page navigations retain Proxy/DAL redirects (legacy revoked JWTs reach DAL's
   `/logout`; missing/expired cookies go to `/login`). The shared pure
   `askRedirectPath` parses genuine Next digests, and `normalizeAskFailure`
   maps only local `/login`/`/logout` and exact legacy auth codes to
   `SIGN_IN_AGAIN`; arbitrary login/provider text remains paused. Server and
   panel normalizers use this same digest parser.

   **UI contract:** `GET /api/ai/status` with missing, invalid, expired or revoked
   authentication returns **401 `{ok:false,code:'SIGN_IN_AGAIN'}`**, always with
   **`Cache-Control: no-store`**. Existing owner ready/warning/paused and
   authenticated non-owner 403 envelopes remain. Ask APIs/mobile adapters map
   auth/access/recovery to **401/403/503**, conflicts to **409**; TTS's unavailable
   run remains 404. Both returned and caught auth failures preserve their code.
   No header itself authorizes any business mutation.

3. **Engineering 2 / design 3 server:** authenticated paused capability GETs at
   `/api/transcribe` and `/api/tts` return **200
   `{available:false,code:'ASK_PAUSED'}`**, no-store, before provider callbacks.
   POST remains paused **503**. Subcontractor daily-log raw speech/dictation
   retains its separate policy. Hook generation/retry, mounted draft/private
   state clearing and sign-in affordances belong to the panel builder.

Validation: **173 passed, zero failed/skipped across 13 files**; per-file counts
and the private-copy census are in the linked round-3 privacy handoff. Tests
used separate single-file invocations with `SJC_TEST_CLUSTER_TAG=p0r3srv-<ts>`
and EXIT cleanup of every disposable cluster, including failed fixture runs.
The initial new fixtures needed a VM TextEncoder, correct schema field names,
and the distinction between optimistic legacy Proxy checks and DAL revocation;
no desired privacy/auth expectation was weakened. The existing folder fixture
still emits pg's concurrent-client-query deprecation; module-type warnings and
the mobile suite's intentional simulated notification failure are test noise,
not production sends or failed assertions.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
`node scripts/db-roles-scan.mjs --diff`: **exit 0**, no unexplained differences.
Withheld agent owner-control writes: settings, authority grants, policies,
lane pauses, permission audit, revocations and users. Worker differences also
include website-only interaction UPDATE/message DELETE, maintenance/web-session
state, payment authorizations, QBO and mailbox credentials. All are explicitly
explained by manifest notes; no grant was added to satisfy a static import path.
Both actual-DB role files pass. `git diff --check` passes.

No install, Next dev/build/start, browser, deploy, service action, live DB,
`sjcos_qa_abc`, coordinator Ask state, default protected deployment directory,
or subagent was used. No resource kill occurred. Coordinator checks remaining:
expire/revoke a cookie mid-chat and exercise Send/poll/upload/Retry; confirm Sign
in, retained draft and cleared private pixels; confirm paused voice GETs do not
produce failed-resource console entries and voice returns after panel Retry.
Browser Phase 0b/runtime and deployed authority durability remain outside this
server test evidence.

---

> **Privacy correction after coordinator QA:** see [phase0-privacy-leak-HANDOFF.md](phase0-privacy-leak-HANDOFF.md) for the explicit ownership fences, full 119-function audit, RLS limits and new bypass-identity regression evidence. Earlier helper/RLS-only privacy claims below are superseded.

# Phase 0 round-2 server correction — A1 (2026-11-05)

This section supersedes the pre-A1 backfill, all-Ask gate, combined-matrix and
scan claims in the historical slice-B report below. Server implementation only;
the parallel panel builder owns its own UI changes and verification.

## Findings resolved

1. **A1.1 / engineering 1 / design 4:** `withAskJournal` checks the migration
   dependency, DB latch/checkpoint/retained deletion metadata, and local intent
   bytes/marker under the same OS lock used by deletion. A never-enabled DB with
   no deletion evidence admits ordinary Ask without an authority, records
   `JOURNAL_NOT_CONFIGURED` as a warning, and refuses Delete with
   `DELETE_NOT_READY`. An unsuccessful enable request with no deletion state
   does not permanently disable Ask when that request is withdrawn. A bare
   ledger binding is not deletion evidence. Enabling requires live verified
   authority receipts; the DB latch cannot be cleared by UPDATE/DELETE, and a
   fsynced local marker also persists the transition. Any intent (including a
   partial append), tombstone, sequence or latch keeps the full recovery gate.
   Restored/forged DB latch values cannot bypass remaining journal or retained
   shell evidence. Recovery still verifies identity, signed freshness, prefix,
   checkpoint and leases before admission. Configuration stays outside restores.
   The local latch file is created once, without following symlinks.

   Public chat/folder actions, run polls/stop/steer/interactions/approvals, run
   review, mobile adapters, TTS/dictation, legacy Ask API and owner reply routing
   return fixed typed failures; unknown causes map to `ASK_PAUSED`. A single
   verified journal scope covers each callback, including provider/spawn/context
   work. Auth/health metadata and the title-free delete retry command are the
   deliberate exceptions to ordinary private reads. Subcontractor daily-log
   speech/dictation remains independent of Ask. Owner replies cannot fall back
   into an unbound operating run after a private-chat denial; Telegram propagates
   that fixed failure before refreshing a card to claim successful delivery.
   `/api/ai/status` exposes an owner-only, no-store warning/ready/paused envelope
   without causes, titles, counts or configuration. Missing schema also yields a
   controlled paused result. Maintenance reports the virgin warning without
   opening a high-priority recovery outage, within the original 1.8-second
   maintenance invocation budget.

2. **Engineering 3 / design 6:** Delete accepts a caller UUID v4 `operationId`
   through both `deleteConversationAction(id, operationId)` and `operator.delete`.
   Retrying that same actor/thread/operation acknowledges `pending` after local
   intent durability or `deleted` after committed replay, including lost
   responses and reconstruction after primary-directory loss. It does not
   require a live-thread read or expose general tombstones. Wrong actors and
   conflicting operations get the same unavailable code, without a title.
   A pending result never claims independent durability. No duplicate intent is
   appended. Thread-list responses carry `capabilities.deleteAvailable`; mobile
   allowed-actions lists also suppress Delete while unavailable.

3. **Design 5:** chat-search rejection becomes an empty chat-result list; job,
   lead, invoice and other record results still return.

4. **A1.2 / engineering 5 case 30 / design 7:** 0105 now assigns a null-owned
   historical thread to its unique active recorded run principal (staff
   included), ignoring null principals. Only threads with no principal evidence
   fall back to the unique active owner. Mixed/inactive evidence and no/multiple
   fallback owners stay quarantined. Existing non-null owners are unchanged.
   Legacy folder links across the resulting owner boundary are detached to
   Unfiled, so a staff thread neither leaks Joe's folder nor becomes unwritable.
   Fixtures cover owner/staff/null/mixed/inactive principals, zero/one/two active
   owners and contradictory evidence on already-owned rows.

5. **Engineering 5 / A1.3:** subset `apply()` rejects every nonexistent requested
   migration ID before applying any requested migration. The real available
   matrix is named **shared_canvas_phase0 (0100 + 0105)**. The test for the
   missing 0101–0104 combined matrix asserts that it is blocked, not that the
   combined migration set works. Recovery now runs once on that actual set,
   rather than counting an identical subset twice. Its 43 passing assertions
   replace the old duplicated 60 count; no security expectation was removed.
   Maintained caller/SQL tests cover the server-side fresh review cases: owned
   and foreign rail/message/run access; mobile rename/archive/reset/poll/stop/
   steer/answer with no downstream work on denial; self positive controls;
   review, TTS, owner reply and search fencing; strict injected-source refusal;
   actual narrow-login GUC/voice/background attacks; immutable admitted identity
   and background-parent continuation refusal; existing session/bridge attacks;
   atomic shared dependency and the A1.2 legacy matrix.

6. **Engineering 6:** worker `agent_interactions UPDATE` and `ai_messages DELETE`
   are explicitly annotated as intentionally withheld website maintenance paths
   reached by static import tracing. Worker privileges were not broadened.
   Actual worker identity tests assert both missing privileges and real SQL
   denial, as well as voice identity spoofing refusal. Regenerated evidence is
   pasted as comments into 0105 and below.

## Public action result integration

`lib/ask-result-codes.ts` is unchanged. Failure is always `{ok:false,code}` for
privacy/recovery/auth failures. Existing validation/domain refusals may still
carry their fixed `error` text. Success envelopes:

- listConversations: `{ok:true,conversations,capabilities}`;
- listAllConversations / listArchivedThreads: `{ok:true,threads,capabilities}`;
- listThreadRail: `{ok:true,rail,capabilities}`;
- loadConversation: `{ok:true,conversation,capabilities}`;
- newConversation: `{ok:true,id}`;
- searchJobs: `{ok:true,jobs}`;
- loadRunReview / listRunApprovals: `{ok:true,review}` / `{ok:true,grants}`;
- Delete: `{ok:true,state:'pending'|'deleted'}`.

Mutation/send/voice/poll successes keep their existing object fields. Mobile
poll keeps its existing `{poll:...}` wrapper for ordinary run outcomes, but
fixed Ask failures are top-level JSON (503 for `ASK_PAUSED`, never generic 500).

## Verification

Expectations were recorded before implementation; fresh fixtures were written
before running them. Controlled session/provider seams are explicitly separate
from actual SQL and caller bodies. No HTTP/browser/end-to-end claim is made.
All invocations are single files, sequential, tagged `p0fixsrv-<timestamp>`, with
an EXIT trap stopping/removing that tag's disposable cluster even on failure.
Earlier fixture failures (new export seam, envelope adaptation, quoting and an
overly broad test-only MobileInputError stand-in)
were corrected; final runs are below. No exit 137 occurred.

| File | Final pass / fail |
| --- | ---: |
| ask-backfill-db | 3 / 0 |
| ask-thread-access-db | 33 / 0 |
| ask-thread-recovery-db | 43 / 0 |
| ask-server-boundaries-db | 8 / 0 |
| ask-run-admission-db | 4 / 0 |
| canvas-rollout-db | 3 / 0 |
| web-sessions-db | 4 / 0 |
| db-roles-manifest-db | 6 / 0 |
| db-roles-paths-db | 3 / 0 |
| panel-search | 5 / 0 |
| mobile-rpc | 28 / 0 |

Final locked typecheck: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`
exit 0. Scan exit 0. Every printed diff has an explicit withholding annotation:

```text
## sjcos_agent (166 tables)
  app_settings                     INSERT,UPDATE,DELETE   ← withheld on purpose: settings incl. pricing/markup and link tokens; agents read non-secret keys only (row security hides *.token)
  authority_grants                 INSERT,UPDATE   ← withheld on purpose: who may approve what
  lane_pauses                      INSERT,UPDATE,DELETE   ← withheld on purpose: Joe's kill switches
  permission_audit                 INSERT   ← withheld on purpose: permission change log: website only
  policies                         INSERT,UPDATE   ← withheld on purpose: Joe's automation switches
  session_revocations              INSERT   ← withheld on purpose: sign-outs: website only
  users                            SELECT,UPDATE,INSERT   ← withheld on purpose: logins and passwords: Joe's Settings › Team (website) or his own panel run only

## sjcos_worker (147 tables)
  agent_interactions               UPDATE   ← withheld on purpose: Worker UPDATE intentionally withheld: private Ask recovery/purge is website-only; imported journal code does not grant worker execution.
  ai_messages                      DELETE   ← withheld on purpose: Worker DELETE intentionally withheld: private Ask retention purge is website-only; INSERT/UPDATE background grants do not authorize private chat maintenance.
  app_settings                     INSERT,UPDATE   ← withheld on purpose: settings incl. pricing/markup and link tokens; agents read non-secret keys only (row security hides *.token)
  ask_canvas_maintenance           UPDATE,SELECT   ← withheld on purpose: 0105 private recovery epoch/lease/checkpoint; website only. No narrow grants. Backup via pg_read_all_data.
  authority_grants                 INSERT,UPDATE   ← withheld on purpose: who may approve what
  lane_pauses                      INSERT,UPDATE,DELETE   ← withheld on purpose: Joe's kill switches
  payment_authorizations           SELECT,INSERT   ← withheld on purpose: client payment authorizations: written only by the portal checkout (website); the worker reaches lib/payments/service.ts but never records one
  permission_audit                 INSERT   ← withheld on purpose: permission change log: website only
  policies                         INSERT,UPDATE   ← withheld on purpose: Joe's automation switches
  qbo_connection                   INSERT,UPDATE,SELECT   ← withheld on purpose: QuickBooks OAuth connection; QBO sync runs inside the website (cron route)
  session_revocations              INSERT,UPDATE   ← withheld on purpose: sign-outs: website only
  user_email_accounts              SELECT,INSERT,UPDATE,DELETE   ← withheld on purpose: staff Gmail refresh tokens; only the website's own mailbox code reads them
  users                            SELECT,UPDATE   ← withheld on purpose: logins and passwords: Joe's Settings › Team (website) or his own panel run only
  web_sessions                     INSERT,SELECT,UPDATE   ← withheld on purpose: 0100: private cookie/session/browser data; website only. No agent, worker, readonly or service table privileges. Backup reads via pg_read_all_data.
```

The shared settings/users/permission/revocation/authority/policy/lane entries
are website-only owner controls. The worker's payment authorization is a portal
write, QBO is a website cron path, staff mailbox tokens are website-only, and
session/journal state is private website authority. These static import-path
findings do not justify granting the worker those operations.

Generated unchanged grants (`node scripts/db-roles-sql.mjs agent_interactions
ai_messages ask_canvas_maintenance`):

```sql
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_interactions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'agent_interactions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_interactions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'ai_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_messages');
```

`ask_canvas_maintenance` generates no grants. The agent's existing interaction
privileges remain fenced by actual session identity + RLS; this change grants
nothing new to any narrow login.

## What Joe / the coordinator must do; not done here

- **Rebuild all Phase 0 QA databases from the baseline and ordered migrations.**
  0105 was deliberately edited in place because it is not live. Existing QA
  checksums, latch schema and legacy owners are obsolete. Do not patch or fake
  migration rows to reuse those databases. No live DB, `sjcos_qa_abc`, services,
  deployment, build/start/dev, browser, package install or node_modules write
  occurred in this work.
- Tell Abigail before deploy: chats with a recorded sole active creator stay
  with that person (including her two chats); new chats are private to their
  creator. Mixed/inactive evidence is quarantined. Staff legacy chats linked
  to Joe's shared folders start Unfiled. Verify the rebuilt QA ownership counts.
- Ordinary Ask may ship with deletion never enabled and authority absent under
  A1.1. Keep Delete off until independent authority provisioning/identity/key
  pinning outside both restore sets, restore/loss drills, and deletion acceptance
  are approved. Once enabled, preserve the durable directory/marker and authority
  configuration across releases and restores; flags off cannot disable recovery.
  No authority service was implemented or provisioned here.
- **Browser Phase 0b deferred (engineering item 4, A1.3):** no 0101–0104 schema,
  gate/addon/dispatcher, target-barrier patch/pins, namespace/packet/RSS/actual CLI
  runtime evidence, or second Browser UI fixture consumer. Browser stays disabled;
  these are required before Browser Phase 1, not blockers for Canvas Phase 1.
- UI layout/hydration/focus/device captures remain the parallel builder and
  coordinator's work. Check normal owner/staff chats without deletion enabled,
  deliberately paused mode after enabling, record search during pause, Delete
  disabled/capability copy, stable pending retry and title-free foreign denial
  at the six requested widths. No visual verification was performed here.

---

# Historical slice-B report (pre-A1; superseded where noted above)

# Phase 0 slice B — Ask ownership and thread recovery

2026-11-05. Implementation only; no deployment, live DB, service changes,
installation, browser, Next server or build. Started at 709a3c68; concurrent
Canvas content/renderer commits advanced the shared branch to f2bb9056. None
of that builder's files were edited or staged. All Canvas flags remain off.
**Thread Delete defaults server-disabled** (`SJC_ASK_THREAD_DELETE_ACCEPTED`
absent). This handoff is code/test evidence, not production recovery acceptance.

## Item → change

- `0105_ask_thread_ownership.sql`: explicit transactional dependency on the
  real 0100 ledger entry; private immutable thread/folder owners, RESTRICT
  identity/run retention, deleted/purge timestamps, holds, cancellation,
  minimum singleton maintenance lease/epoch/checkpoint. No later Canvas FK,
  table or query. Thirty days is 720 elapsed hours, avoiding session-timezone
  DST disagreement with the UTC journal timestamp.
- Backfill historical shared threads/folders to the unique active owner only.
  Otherwise leave null, quarantine and report a NOTICE count. No staff guesses
  or ownership-reassignment tool. New human inserts use the authenticated actor.
- Shared `thread-access.ts`: fresh signed session/bearer, active role/ai and
  revocation check, website-only scoped transactions, self-owned live thread
  and run/interaction checks. Actor GUC is scoped to this trusted website
  transaction; **actual narrow session_user cannot authorize itself with it**.
- RLS on conversations, folders, messages, runs, interactions and steers;
  session_user guards override ordinary table privileges. FORCE RLS scopes
  the website actor too; absent actor is the trusted raw website runner/repair
  boundary, never a Joe source-read exception. The backup role has a separate
  SELECT policy because pg_read_all_data alone does not bypass RLS. Existing
  narrow grants were not broadened. Background runtime INSERT/status updates
  stay unbound/business. Owned private threads cannot host background runs.
- `canvas-deletion-ledger.mjs` / `ask-thread-journal.mjs`: local fsynced intent
  chain and pinned ledger binding, kernel flock, synchronous independent CAS,
  per-access live-authority recovery, recovery epoch, tombstone/cancellation,
  bounded reconciliation and hold-aware grace purge. Tombstoned runs become
  terminal/cancellation-requested. Late private message/run writes fail. Purge
  removes messages and attachment refs, redacts run/interactions/steer payloads,
  preserves ID/audit shells and never deletes saved project files.
- Maintenance route/script and uninstalled oneshot/timer specs: secret-authenticated
  loopback POST, 5-minute Persistent timer, Nice=19, MemoryMax=128M,
  CPUQuota=25%, TimeoutStartSec=15, request timeout 10s, Restart=no. Recovery
  and purge use bounded phases (50 records, short transaction/lock timeouts,
  1.8s maintenance deadline for authority/lock work); lease owner/token/expiry
  rechecked in each batch. No filesystem blobs are unlinked in Phase 0.
  Health uses aggregate fixed codes/counts and one sourced repair key
  `canvas-maintenance-health`, normal completion command when healthy, no
  promotion or approval. Provisioned-store latency and end-to-end 2s route
  budget (including health bookkeeping) still require deployment measurement.

## Independent journal / high-water authority

Local **`SJC_CANVAS_DELETION_LEDGER_DIR`** is an owner-only 0700 operations
volume excluded from DB snapshots/restores. Files are `ledger-id`, `journal.lock`
and fsynced 0600 `intents.jsonl`. Local checksums detect corruption, not freshness.
A complete local intent is already a denial fence: durability failure pauses
all Ask access conservatively, including title/rail reads. No DB row lock spans
remote/fs operations. The global OS lock spans recovery/deletion acknowledgements
and private query commits/attachment extraction, including detached runner paths.
Nested awaited adapters reuse an active lock scope; escaped async work cannot
reuse it after release. This is deliberately conservative serialization.

**The authoritative high-water does not live in Postgres or on this volume.**
The implementation is a client for a separately provisioned HTTPS authority at
`SJC_CANVAS_AUTHORITY_URL`. It requires a strongly consistent, authenticated,
monotonic CAS service with independently durable, encrypted/versioned immutable
prefixes outside BOTH DB backups and the primary operations-volume restore set.
The service must durably store the whole prefix before advancing high-water;
CAS/idempotency is by ledger, expected sequence/head and operation UUID/hash.
This task did not provision or claim a real independent service.

Protected deployment/recovery config, outside both restore sets, pins:
`SJC_CANVAS_LEDGER_ID`, Ed25519 `SJC_CANVAS_AUTHORITY_PUBLIC_KEY`,
`SJC_CANVAS_AUTHORITY_TOKEN`, and 32-byte hex `SJC_CANVAS_JOURNAL_KEY`.
A read/CAS POST contains a fresh random nonce and fixed action/ledger ID. A
response is `{payload: string, signature: base64}`; exact payload bytes are
Ed25519-verified, then nonce, ledger, full AES-256-GCM encrypted prefix and
sequence/head are checked. Old signed receipts cannot satisfy a new nonce.
Redirects, identity changes, stale/incomplete prefixes, divergent local chains,
unknown intent kinds, future/unsupported schema and unavailable authority close
access. The DB checkpoint cannot establish freshness. The local ledger binding
and restored checkpoint identity are checked before advancing an authority.
No implicit authority initialization, backwards reset or local-only success.
A 10,000-intent / 8 MiB local bound fails closed; future archival must preserve
independent monotonic authority rather than silently pruning it.

Recovery queries the live authority, reconstructs even a lost local directory,
replays acknowledged AND unacknowledged durable intents, then re-reads the live
head under the OS-locked recovery epoch before ready. A backlog remains closed
across bounded ticks. The capability map comes from actual migration ledger IDs;
only 0100+0105 are needed. Canvas flags never substitute for capabilities.

Tests use separate disposable local-journal and authority directories, signed
nonce-bound HTTPS response fixtures, durable prefix/CAS fixtures, real Postgres
sessions and actual pg_dump/psql restoration. These prove client behavior under
the tested faults; they are **not physical off-box production durability proof**.
Actual authority/store identity, pinned-key fingerprint, live sequence/head,
primary-volume-loss drill and real encrypted-backup aging remain deployment
release evidence. Thirty days is not a promise to erase historical backups.

## Every touched caller and visibility rule

Canvas §8.1 / Joe decision 8 governs: **Joe sees his own private threads only,
exactly like staff A/B.** ai is required; portal roles, inactive/revoked people,
other people and unresolved null owners cannot access private contents. Staff
cannot get operator. No role exception for staff chat payloads. Saved job copies
remain separate audience-controlled business files. Browser §4.1 consumes this
privacy prerequisite; it does not override the later explicit Canvas decision.

- `lib/ai-chat.ts`: list/load/turns/model messages/inserts/title writes use the
  scoped query helper; new threads carry their verified owner.
- `lib/actions/ai-chat.ts`: sends/session/rename/archive/rail/folder mutations
  inherit scoped queries; server Delete uses only the gated journal command.
  Uploads are person-scoped and timestamp-named. Attachment submission uses the
  same ownership check as byte reads; fresh unbound upload names expire after
  24h, active owned transcript refs remain readable, deleted refs cannot be
  laundered back into another chat. No legacy physical-delete fallback.
- `lib/thread-folders.ts`: own folders, entity uniqueness per owner, own rail,
  counts, settle/archive/refile and grounding queries; cross-owner folder FK
  association is rejected by the DB too.
- `lib/attachments.ts`: exact source authorization/journal fence covers file,
  image/PDF extraction and cached sidecar reads. Old flat paths require an
  active owned message ref. No new Phase 1 tracked-reader/provenance claim.
- `lib/ask-run-admission.ts`: shared journal gate before transaction and shared
  thread check under its locked admission; retains 0100 provenance/profile rules.
- `lib/actions/dev-agents.ts`: poll/stop/steer/interaction/approval access now
  requires an owned live thread for Joe too; no global orphan question fallback.
- `lib/actions/panel-review.ts`: same run/thread ownership, no owner bypass.
- `lib/agent-interactions.ts`: scoped pending/answer/dismiss statements; no
  global untagged question bucket. Phase 1 atomic provenance ingestion is deferred.
- `lib/dev-agents.ts`: run reads scoped; stop/ping private-thread checks;
  slice A's launch_source/admission and unbound business work-item retries kept.
- `lib/run-steers.ts`: private queries scoped; enqueue/relay transactions fenced;
  relay requires owned runs in the same thread; completion checks thread access.
  An autonomous callback cannot retain a private thread as a background run;
  a new human turn must readmit. Retained steer bodies are redacted at purge.
- `lib/orchestrator/thread.ts`: fallback model-context run lookup scoped; main
  transcript/attachment readers inherit the shared fences.
- `scripts/run-claude-agent.mjs`: session lookup, unseen transcript, steer input,
  persistence and five-second cancellation/health guard use the journal fence
  and reload run/person/owner/revocation. No owner/thread resurrection on failure.
  The ordinary launch/profile/source behavior stays slice A's. Both stdio MCP
  configurations explicitly force MCP_HTTP_PORT=0.
- `app/api/tts/route.ts`: owned live run before deriving spoken private output.
- `lib/panel-search.ts`: ONLY private thread search goes through threadQuery and
  an explicit self-owner/live predicate. Non-private business search keeps its
  existing owner/area access. Dedicated Joe-no-bypass test added.
- `lib/owner-reply-delivery.ts`: Joe target/session/thread checked before title
  lookup/routing, scoped latest-run read, no cron private-transcript relay.
  Without a verified target session, the existing background business-reply
  fallback handles the shared decision/work-item note, without private titles.
  Dedicated denial-before-title/read/routing test added.
- Mobile operator reads, mutations, upload and voice paths consume the above
  same actions/readers; their authenticated source adapters remain unchanged.

## Trusted staff interaction bridge (additional authorized scope)

`lib/ask-thread-journal-transport.mjs` captures five runner tags once in a private
construction-time stdio closure; tool arguments and HTTP headers cannot supply
or override them. HTTP construction, bare stdio and an HTTP ALS backstop reject
BEFORE forwarding. IDs polled by a closure must have been created by it.

`mcp/sjcos-mcp.mjs` passes actual bootstrap transport kind; both it and
`mcp/interact-mcp.mjs` use that adapter in `mcp/interact-tools.mjs` and permission
prompts. No raw SQL interaction write/read fallback. Cookie/bearer sessions are
not fabricated for models. The fixed `/api/internal/ask-interactions` route uses
constant-time CRON_SECRET validation and strict bounded schemas, not generic
principalPayload. `ask-thread-journal-interactions.mjs` repeats live DB run,
exact person/thread/profile/start/source, active ai, cancellation and revocation
checks under the journal gate/transaction for create, poll and expire. Narrow
agent/worker raw inserts stay denied. MCP-off runs retain interact questions.
HTTP/unadmitted questions get RUN_CONTEXT_REQUIRED, never the old shared bucket.

**Phase 1 seam:** `beforeDeliver` is called for answer, dismissal and timeout
before formatting a model result. It currently revalidates identity only.
Phase 1 must add synchronous pending-input/answer provenance ingestion here and
in shared answerInteraction; no provenance recording/completeness gates or
0106 relations were built or claimed in this slice.

## Verification

Tag `SJC_TEST_CLUSTER_TAG=phase0b-20261105-1`; single test files sequentially,
never a suite. Actual attack/control fixtures assert session_user=current_user
as sjcos_agent, sjcos_worker and separate non-superuser sjcos_test_website.
No harness-superuser whitelist. Narrow GUC spoofing, private reads/writes,
owner reassignment, panel insertion and resume/continuation attacks are denied;
worker unbound background INSERT/status updates still work.

New tests were authored with adversarial expectations first. Both Phase 0
migration sets use exact ordered real SQL/checksums and transactional ledger
insertion from a pre-0100 baseline. No fake ledger rows or shared migration-dir
edits. Missing 0100 rolls back 0105 atomically. No 0106+ relations are queried.
Real pre-delete pg_dump/psql restoration, independent replay, primary-directory
loss, N-1 refusal, authority identity/signature/nonce/prefix failure, local
binding mismatch, partial tails/corruption, UUID replay, lease competition and
stale token, failed durability, in-flight writes, grace/hold/redaction and staff
question round-trip/forgery/raw-write tests are included.

| Test file | Before pass/fail | Final pass/fail |
|---|---:|---:|
| ask-thread-access-db | new | 33 / 0 |
| ask-thread-recovery-db | new | 60 / 0 |
| canvas-rollout-db | new | 3 / 0 |
| ask-run-admission-db | 4 / 0 (A handoff) | 4 / 0 |
| web-sessions-db | 4 / 0 (A handoff) | 4 / 0 |
| agent-profile | 9 / 0 (A handoff) | 10 / 0 |
| db-roles-manifest-db | 6 / 0 (A handoff) | 6 / 0 |
| db-roles-paths-db | 2 / 0 (A handoff) | 3 / 0 |
| run-steers-db | 0 / 1 (709a3c68, real harness URL) | 1 / 0 |
| panel-search | 3 / 0 (709a3c68) | 4 / 0 |
| merge-chat-regressions | 2 / 0 (A handoff) | 2 / 0 |
| panel-defects | 6 / 0 (709a3c68) | 6 / 0 |
| mobile-rpc | 26 / 0 (A handoff) | 26 / 0 |
| mcp-team-tools | not remeasured before | 13 / 0 |
| agent-runtime-db | 10 / 0 (A handoff) | 10 / 0 |
| portal-telegram-db | 3 / 0 (A handoff) | 3 / 0 |
| access-db | 7 / 0 (A handoff) | 7 / 0 |
| browser-run-profile | 14 / 0 (A handoff) | 14 / 0 |
| gmail-quota-budget | not remeasured before | 9 / 0 |
| api-auth-coverage | 1 / 1 (known baseline) | 1 / 1 |

Before counts labelled A come from the accepted slice A handoff, not a new
baseline claim. The other before runs used an unmodified 709a3c68 git archive
in /tmp with the existing read-only node_modules link, no checkout/worktree
changes, installation or live configuration. Original run-steers failed on its
fixture UPDATE of immutable run identity. Its fixture now creates that run in
its destination thread and binds a takeover to the same thread, uses the disposable harness and scoped-helper seams,
and leaves retained cleanup to disposable DB disposal. No assertions were
removed or weakened. New privacy assertions are separate cases.

Edited existing test/fixture files: `tests/agent-profile.test.mjs`,
`tests/ask-run-admission-db.test.mjs`, `tests/db-roles-paths-db.test.mjs`,
`tests/run-steers-db.test.mjs`, `tests/panel-search.test.mjs`,
`tests/merge-chat-regressions.test.mjs`, `tests/panel-defects.test.mjs`,
`tests/phase0a-fixtures.mjs` and `tests/_harness/testdb.mjs`. Fixture-only files
have no independent test count. The A admission missing-0105/standalone checks
now use a real subset migration fixture; staff gets a separate owned thread,
never an owner reassignment. Narrow 0100 guard assertions are preserved on
0100; the new 0105 tests separately prove private rows are hidden by RLS.

Final tsc: exit 0 (`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`).
`node scripts/db-roles-scan.mjs --diff`: exit 0, no unaccounted writes; intentional
withheld entries remain printed. `node scripts/db-roles-sql.mjs
ask_canvas_maintenance` prints empty output (website-only); recorded in 0105.
Auth coverage still flags exactly the same 44 unchanged mobile wrapper routes;
neither new internal route adds a failure. No test/auth allowlist was loosened.
Disposable clusters were stopped, including the isolated baseline check.

## Not done / release gates

- No deploy, actual independent authority/store provisioning, key installation,
  timer enablement, live backfill/quarantine resolution, real backup-aging
  measurement, production restore/loss drill or end-to-end maintenance timing.
  The deployment must keep all writers on the shared protected operations lock
  and pin recovery config independently of both restore sets.
- Do not set SJC_ASK_THREAD_DELETE_ACCEPTED=1 or accept Browser/private-thread
  production rollout until that deployment recovery evidence is approved.
  No permissive old binary rollback or physical-delete fallback.
- No Canvas tables after 0105, renderer/pane/layout work, saved-file delivery,
  Phase 1 tracked readers/native-reader restrictions/provenance, quota/blob
  cleanup extensions, or Browser launch/runtime acceptance. Existing unrelated
  Canvas builder artifacts are independent of this slice.
- No visual verification. Coordinator should check web/mobile own-thread rail,
  cross-account denial, deletion-disabled and paused/error copy, question and
  permission prompt flow, attachment reuse rejection and phone TTS behavior.

## Round-2 server corrections (2026-11-05; supersedes earlier privacy/recovery acceptance)

- Engineering 1: filing no longer grants the Ask upload tree to an unbound MCP
  client. A construction-time stdio context is captured separately from tool
  input; HTTP and background clients get none. The website validates the exact
  live run/person/thread/profile/start/revocation tuple. Ask source ownership
  and attachment membership are checked before byte reads; the journal lock
  spans reading and copying into Unsorted/Files. Canonical Ask paths override
  configured shared ancestor roots and symlink aliases. Denials use fixed
  `THREAD_UNAVAILABLE`/`ASK_PAUSED` envelopes without paths/titles.
- Engineering 2: A1 now requires explicit deployment bootstrap, with protected
  identity outside DB and journal restore/loss sets. `identity.json` plus the
  exclusive, fsynced `deletion-enabled.json` bind deployment UUID to ledger UUID.
  Missing state never bootstraps during a request. Missing/partial/invalid
  authority config is permissive only for an explicitly bootstrapped,
  never-enabled installation with entirely absent authority configuration.
  Missing identity, conflicting ledger or an ever-enabled restore pauses until
  verified current replay. Nested journal/protected directories are refused.
- Security 1: Express permission uses fixed reason text. 0105 redacts historical
  automatic excerpts, including unbound legacy rows. Bridge list/check/perform
  filter private grants by current captured person and live thread before
  serialization/ordering/limits, including expired checks. Website grant lists
  likewise show only that person's private grants. No Joe override.
- Security 2: 0105 materializes run-only source links and applies FORCE RLS to
  grants/replies: narrow SQL sees shared business rows only. Source links cannot
  be detached/reattached, and an invisible source is refused rather than inferred
  shared. Reply/grant/decision lookup and answer mutation require the captured
  person to own the live thread, with the journal fence held through Telegram.
  Private recording requires authenticated owner=self/live/recovery-ready;
  delivery also validates the stored reply/thread association. The unattended
  sweep selects shared rows only. Tombstone replay immediately erases reply
  bodies/answers and grant reason/scope/audit, and revokes the grant; replay on a
  restored DB repeats the erasure. Shared business replies still work.

**0105 was edited in place; it is NOT applied on live. Rebuild any existing QA
DB before acceptance (its migration checksum changed). No live/QA DB was touched.**
The manifest records row-level restrictions; narrow table privileges were not
broadened. Generator output pasted into 0105:

```sql
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_grants');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_grants');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_grants');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_replies');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_replies');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_replies');
```

Before rollout, ops must provision the protected state for a demonstrably new,
never-enabled installation with
`node scripts/ask-deployment-bootstrap.mjs --new-install`. Default location is
`~/.local/state/sjcos-ask-deployment`, outside the checkout and journal volume;
a separately protected persistent volume may be configured. Retain/reconnect
that identity on restore. NEVER run bootstrap to repair a restored deployment;
recover its protected volume instead. Loss/replacement of all independent
protected evidence by the filesystem administrator remains outside the app's
threat boundary. No provisioning, deployment, service or authority enablement
was performed here. Browser runtime remains Phase 0b, outside this work.

The new `ask-r2-server-db` file records expectations before implementation and
executes real filing/grant route code, actual grant/reply/storage-stage SQL,
non-superuser website identity and all three narrow `session_user` logins.
Filesystem storage/provider/session seams are controlled: the filing byte reader
is real, with a counted store callback and real stage/attachment rows; no HTTP
server, real Telegram send or browser was used. Its actual pg_dump/psql restore
matrix restores a pre-latch DB, removes the journal directory and keeps protected
state: absent, partial, wrong and unreachable authorities never call back;
intact current authority replays the tombstone first, with the flag off.

Final validation for this correction is recorded in
`phase0-privacy-leak-HANDOFF.md` below the prior-round inventory. That earlier
119-function classification is historical, not the current completeness claim.

## Round-4 build corrections (2026-11-05)

0105 changed **in place and remains unapplied on live**. Rebuild disposable QA
from migrations; do not skip checksum verification on an existing database.
No deployment, live/QA DB, service, browser or Next process was used here.

Background actions now authenticate without redirecting: `pollLiveChanges`
(shell and client portal), `refreshTodayQueue` (Today focus, panel queue mount,
live/trailing refresh and settled turn), `getWorkbenchAction`, `loadDrafts`,
`saveDraft` (debounced inbox sync), and `loadCall`. The Unsorted photo-reading
interval and Designer focus refresh now authenticate through `pollLiveChanges`
before requesting an RSC refresh. Existing `pollNotificationCenter` (null) and
`getNavCounts` (zero counts) already fail safely; panel run/history polls already
return fixed Ask failures. ActivityEmitter calls an authenticated HTTP API,
not a redirecting action; panel liveness/claim timers are local storage/bus work.
Portal has no separate redirecting message-read timer; its LiveUpdates uses the
same fixed boundary. Explicit page navigation keeps Proxy/DAL protection;
Next-Action POST passthrough is unchanged.

The document-local auth-loss latch stops live refresh, focus queue reads and
follow navigation, drops pending trailing refreshes, and invokes the panel's
existing failure path. Transcript/pane/private queue state clears; composer
text stays. The next Ask failure displays “Sign in again to continue.” with
Sign in returning to the current page through the existing validated link.
A successful explicit Retry can clear the auth latch; actual sign-in starts a
new document. Typed area denial is checked before any business callback.

### Safe folder setup and repair (operator deployment steps)

Let the app create the configured **journal leaf** directory as its runtime
account: `mkdir({recursive:true,mode:0700})` creates a missing leaf but does
**not** fix an existing directory's mode or ownership. Do not pre-create it as
0775. Protected deployment identity remains separately provisioned **only for a
new installation** by the documented bootstrap command; it must remain outside
both DB and journal restore/loss sets. Bootstrap likewise requires 0700 and the
runtime account's ownership. Neither admission nor maintenance chmods folders.

For an owner status diagnosis `JOURNAL_PERMISSIONS` or
`JOURNAL_DEPLOYMENT_PERMISSIONS`:

1. Resolve the configured journal/deployment-state paths from deployment config
   on the operator host. Verify each leaf and its ancestors using `namei -l`
   and `stat`; confirm the configured leaf is a real directory, not a symlink,
   and belongs to the app's runtime uid. Fix an incorrect configured path or
   symlink under operator control before touching permissions.
2. With the correct runtime account/ownership verified, repair **only that
   leaf**: `chmod 700 <journal-dir>` or `chmod 700 <deployment-state-dir>`.
   If ownership is wrong, the administrator must correct that exact directory
   to the runtime account. Never `chmod -R` the parent or shared checkout.
3. Preserve and inspect existing ledger/binding/identity files. Verify they are
   regular, non-symlink files owned by the runtime account and mode 0600; repair
   individual files to 0600 if needed. Never remove `intents.jsonl`, reset a
   deletion latch, or re-bootstrap a restored deployment as a permissions fix.
4. Retry authenticated owner `/api/ai/status`, then the normal maintenance tick.
   Expect ready (or the existing never-enabled authority warning). Missing or
   mismatched authority, binding and corrupt records are separate problems;
   safe folder modes do not override those fences.

Owner status includes only allowlisted diagnosis codes and fixed remediation
text with placeholder paths. Staff/unauthenticated probes reveal no diagnosis;
public Ask still returns `ASK_PAUSED`. Maintenance retains the same safe cause
in the deduplicated owner repair item. No raw exception/path is serialized.

### Push copy protection

Historical sent and parked `push_outbox` cards are scrubbed in 0105 and the
website-only replay erasure helper. Associations include decision/work/grant IDs
in payload/href/buttons and legacy Telegram edit IDs via decision deliveries.
`private_ask_push_sources` holds **only opaque kind/UUID pairs**, with no narrow
table grants; a boolean SECURITY DEFINER helper supports existing push writers
without reading RLS-hidden reply bodies. Source triggers capture new links;
associations persist across tombstone/purge. Every push write sanitizes private
cards to fixed status and retains an immutable erased marker. Immediate sends,
row-ID sends and drain retries sanitize before transmit, including stale
already-selected snapshots. Shared business decision status remains in its
normal record. No provider history/forensic erasure claim is made.

Manifest generator for `private_ask_push_sources` prints **empty output**
(website only). Existing push privileges are unchanged; exact generator output
is also pasted in 0105:

```sql
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'push_outbox');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'push_outbox');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'push_outbox');
```

Coordinator visual checks remain: at desk1280 and phone360, type draft before
expiring session, wait >4 s with shell polling active, Send and focus the window;
verify `/panel` stays, fixed sign-in line/link and draft remain, History agrees,
and sign-in returns to `/panel`. Also check the disabled Delete menu, expanded
empty folder and /today 900 History shots listed by the design judge. No visual
verification is claimed by the component lifecycle tests.

### Round-4 verification

Expectations were recorded before implementation (including unattended auth,
folder diagnosis/repair, migration installer identity, historical push copies,
real narrow logins, replay and queued retry safety) and are maintained in test
headers/assertions. Controlled component lifecycles execute the actual shell,
Today provider, follow-navigation component and panel together; they are not
browser/HTTP-navigation certification. The signed-cookie fixture executes real
DAL/action/Proxy boundaries for expired/revoked legacy and sid sessions.

Each test file ran sequentially with `SJC_TEST_CLUSTER_TAG=p0r4fix-<timestamp>`,
`SJC_OUTBOUND_DISABLED=1` and an EXIT trap stopping its disposable cluster even
on assertion failure. Every cluster stopped. Final results:

| `tests/<name>.test.mjs` | Pass | Fail / skip |
|---|---:|---:|
| ask-panel-ssr | 82 | 0 / 0 |
| ask-r4-server-db | 2 | 0 / 0 |
| ask-r3-auth-db | 4 | 0 / 0 |
| ask-run-admission-db | 4 | 0 / 0 |
| inbox-drafts-actions | 9 | 0 / 0 |
| ask-private-query-scan | 6 | 0 / 0 |
| ask-r3-reply-copies-db | 6 | 0 / 0 |
| ask-thread-recovery-db | 43 | 0 / 0 |
| ask-thread-access-db | 33 | 0 / 0 |
| db-roles-manifest-db | 6 | 0 / 0 |
| db-roles-paths-db | 3 | 0 / 0 |
| inbox-draft-flow | 39 | 0 / 0 |
| inbox-draft-sync | 15 | 0 / 0 |
| workbench-detail | 3 | 0 / 0 |
| ask-r2-server-db | 11 | 0 / 0 |

**266 passed across 15 files, zero final failures/skips.** Initial harness-only
failures were corrected: health asserted an obsolete exception string instead
of the public PAUSED constant; the expanded auth VM needed the call module's
existing relative dependency seam. Initial tsc caught the newly typed queue
mount consumer; it now handles failures before applying a snapshot. No failing
product assertion was weakened or skipped.

Final `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Final `node scripts/db-roles-scan.mjs --diff`: **exit 0**; every printed difference
is explicitly withheld: owner-control settings/authority/policies/permissions /
users/revocations; website-only private maintenance/session/interaction/message
paths; payment authorizations, QBO and mailbox credentials. No narrow grants
expanded. The new opaque push-source registry has no narrow grants, and both
real role-manifest/path files pass. `git diff --check` passes. No exit 137.

Private-query inventory: **475 entries / 921 conservative SQL fragments / 212
files** (104 fenced, 157 trusted-background, 214 not-private), zero violations.
Newly inventoried push schema/CLI/payment/cost-cap producers were individually
reviewed: schema-only owner CLIs, business payment text, and fixed aggregate
cost notices; they do not introduce private body readers. Push persistence and
drain entries are now classified as fenced, not blanket business-only.

## Build round 5 corrections (2026-11-05)

This section records the fixes required by the [round-5 design review](../reviews/build-p0-r5-design.md)
and [round-5 engineering review](../reviews/build-p0-r5-engineering.md). The
[round-5 security review](../reviews/build-p0-r5-security.md) remains the privacy
baseline; these fixes do not imply a deployment or Browser Phase 0b acceptance.
Starting revision: `6775251c7610c32de7fe22ad4dccaa4162c701a6`, branch
`t3/in-app-browser-agent-tools`.

### Required items and security preservation

- **Design 1 — signed-out queues:** `TodayQueueContext` exposes `signedOut` on
  the document-local sign-out notification and a typed `SIGN_IN_AGAIN` refresh.
  It still clears private priorities/waiting rows and stops polling; stale
  refresh results cannot replace the cleared state. Today replaces Up next and
  the list with “Sign in again to continue.” and `AskSignInLink`, omitting the
  Work list count. The panel Queue rail uses the same copy/link under
  “Queue · Priorities”, replacing both priorities and Waiting on me. This is
  also the phone Queue tab. The link resolves the current page on mount/click;
  no background navigation or private row retention was added. Healthy empty
  queues retain their real empty-state message.
- **Engineering 1 — push function ACLs:** 0105 now immediately revokes PUBLIC
  execution on `bind_ask_push_source()` and `guard_ask_push_copy()`. No narrow
  grants were added. Real agent, worker and readonly sessions cannot attach
  either function to temporary tables (42501), inject registry references or
  erase an unrelated business push. Installed website source triggers still
  bind reply/grant IDs; installed sanitization triggers and the intentional
  boolean `ask_push_is_private(jsonb,text)` remain functional. Historical
  cleanup, irreversible erased markers, tombstone/replay and stale drain
  sanitization retain their passing regression coverage. Registry contents
  remain website-only opaque kind/UUID pairs.
- **Engineering 2 — foreground inbox recovery:** redirecting `requireAccess('inbox')`
  is restored for discard, dismiss and sent bookkeeping. Background load/save
  authenticate directly with `getCurrentUser`/`can`, returning typed failures
  before the same mailbox-only helper. Redirects are never caught/translated
  into ordinary exceptions. Both wrappers retain server-derived mailbox/person
  identity, connected/disconnected staff controls and versioned conflicts;
  caller-injected mailbox/person fields are ignored. Background failure still
  preserves the local unsent draft without navigation.
- **Engineering 3 — foreground call selection:** CallsClient uses
  `loadSelectedCall`, guarded by redirecting `requireAccess('comms')`, with no
  dependency on an Ask panel. It shares the authorized detail loader with
  `loadCall`. BrowserPhone continues using the typed, nonredirecting `loadCall`;
  neither call/event reader runs on background denial. Real signed-cookie
  tests cover expiry/revocation and permission removal for foreground reads;
  a comms staff member without ai retains normal selection access.
- **Engineering 4 — maintained fixture:** the server-boundary VM resolves the
  real `ask-health.mjs` namespace. Both tests explicitly bootstrap their own
  temporary deployment identity beside a separate journal leaf, restore prior
  environment values and remove only their temporary root in finally. The
  original eight status/delete/recovery assertions pass unchanged. The fixture
  never needs the default `~/.local/state/sjcos-ask-deployment` identity.

**Security review invariants:** no private query/reader, push transport, session,
Proxy, action Origin/Host check, cookie policy or allowed-origin configuration
was relaxed. Authentication/area checks still precede business callbacks. The
only census update is the reviewed 0105 source/query hash plus an ACL explanation:
**475 entries / 921 SQL fragments / 212 files**, 104 fenced, 157
trusted-background and 214 not-private, zero violations. No entry was removed or
reclassified. Background shell/focus/poll/Send/upload/Retry tests still clear
private state, preserve drafts, stop trailing refresh and remain on the page.

### Operative deployment checklist corrections

Use the engineering review's **Complete Phase 0 deploy checklist for Joe /
coordinator**, all twelve items, as the consolidated future procedure. It
reconciles the historical handoff sections; in particular the explicit A1
never-enabled ordinary-Ask mode remains valid. Required release checks include:

1. Pin the complete release revision and migration checksums, preserve DB and
   independently protected recovery state, verify target DB/website installer,
   and coordinate every website/MCP/worker/detached writer at cutover. Keep the
   shared host within 24 GB / 8 threads.
2. Use ordered checksummed `db/migrate.mjs` status/dry-run/application. Phase 0
   requires real 0100 then 0105 plus genuinely pending earlier migrations.
   **0105 changed in place again for these ACL fixes. It is documented/supplied
   as unapplied on live; no live DB was contacted to verify that premise.** The
   deployer must verify it before applying. Never fake ledger rows/checksums or
   bypass an applied migration mismatch; rebuild old disposable QA DBs instead.
   Use the website/table-owner installer, not a narrow login. 0101–0104 remain
   absent/deferred; 0106+ is outside Phase 0.
3. Verify owned/quarantined backfill counts, notices, FORCE RLS, immutable
   associations and corrected function ACLs with actual identities. Exercise
   Joe, Abigail/other ai staff and no-ai staff. Joe has no staff-chat override;
   ambiguous/inactive/mixed creators stay quarantined and cross-person folder
   links move to Unfiled. Registry grants remain withheld.
4. Provision protected deployment identity with `ask-deployment-bootstrap.mjs
   --new-install` only for a demonstrably new, never-enabled installation, as
   runtime uid. Keep the stable state location independent of BOTH DB and
   journal restore/loss sets. A restore missing identity is an outage requiring
   recovery of that volume, never re-bootstrap or marker replacement.
5. Provision a stable absolute journal directory separate/nonnested with state;
   all writers share its kernel lock. Inspect configured paths, ancestors,
   symlinks and uid; repair only the correct runtime-owned leaf to 0700 and
   individual sensitive regular nonsymlink files to 0600. Recursive mkdir does
   not repair existing permissions. Preserve intents, identity and latches;
   retry owner health/maintenance after safe repair.
6. For A1 ordinary Ask with explicit never-enabled identity and entirely absent
   authority config, leave Delete acceptance unset/off. Expect ready with
   JOURNAL_NOT_CONFIGURED warning and `deleteAvailable:false`; staff see the
   disabled Delete explanation. Partial/invalid config still pauses admission.
7. Before ever enabling Delete, provision the stable HTTPS authority URL,
   ledger UUID, Ed25519 public key, token and 32-byte hex journal key outside
   both restore sets. Joe must accept independent monotonic CAS, immutable
   encrypted prefixes durable before advancement, identity/key/sequence/head
   and nonce/signature/failure evidence, DB restore plus journal-loss drill,
   protected-state replay and real encrypted-backup aging. Tests do not certify
   off-box durability. Once enabled, flag-off cannot disable recovery.
8. Preserve protected runtime settings and valid session signing across website
   and detached bridge paths. Keep website owner credentials separate from the
   three narrow logins. Staff bridge uses the fixed internal endpoint and
   protected CRON_SECRET; no fabricated bearer/cookies or private SQL fallback.
9. At deployment, validate the existing bounded maintenance oneshot/timer under
   runtime uid, protected `%h/.config/sjcos/canvas-maintenance.env`, actual working
   directory and loopback port 3017. Prove secret POST before enabling the
   five-minute Persistent timer. Retain Nice=19, MemoryMax=128M, CPUQuota=25%,
   TimeoutStartSec=15, request timeout 10s, Restart=no. Measure deadline,
   heartbeat, lease/backlog fencing, grace/hold/purge and owner repair lifecycle.
10. Leave all six Browser settings false and Canvas rollout flags off. Host and
    renderer helpers do not deliver persisted Canvas/provenance or Browser
    runtime acceptance. Do not install/start Browser units from package pins.
11. Coordinator acceptance must include no-ai staff Calls/inbox foreground
    redirects, actual owner/staff login/renew/logout, explicit page versus
    action POST, expired/revoked sessions with focus/timers, retained draft,
    cleared private state, validated return links, normal/paused widths,
    Delete-off/accepted retry, foreign attachments, interaction round trip and
    quiet voice. Use only an approved memory-capped side build/dist/service and
    stop it. Rollback retains additive schema, ownership, sessions and deletion
    evidence and uses a privacy-compatible binary; never restore shared readers.
12. Tell staff chats are person-private including from Joe, older ambiguous
    chats need review, saved business files retain their audience, Delete is
    unavailable pending recovery acceptance, paused chats retain draft/Retry,
    sign-in returns to the current page, and Browser/new Canvas are off. Before
    Delete is enabled, explain its 30-day grace and limits: audit/ID shells,
    saved business files, provider histories, backups and filesystem blobs are
    not all erased by Phase 0.

Coordinator visual captures still required (no server/browser was started here):
`owner-desk1280-today-session-expired` after cookie expiry and >4 s must stay on
`/today`, show the fixed line and `/login?returnTo=%2Ftoday`, with no “Nothing else
on the list.” or Work list zero count. Recapture desk1280 and phone360 panel
expiry, including the phone Queue tab, no bare Waiting on me header, retained
composer draft and sign-in round trip. Retain all remaining normal/paused width
and quiet-console acceptance from the consolidated checklist.

### Round-5 fix verification

Regression expectations/assertions were written before product changes; initial
runs reproduced ordinary inbox errors, use of the background call reader,
missing queue sign-out state and PUBLIC trigger attachment. Fixture-only
corrections during validation supplied Next Link/index-module resolution and a
phone formatter in the controlled component loader, valid draft fields in the
signed-cookie test, and a staff role-home expectation consistent with the real
DAL. No production assertion was weakened or skipped.

Each test file ran individually/sequentially with
`SJC_TEST_CLUSTER_TAG=p0r5fix-<timestamp>[-<file>]`, `SJC_OUTBOUND_DISABLED=1` and
EXIT cleanup stopping its disposable cluster even on failure. Protected state
was explicitly isolated/bootstrapped where real journal admission was used;
no operator default, live/QA DB or coordinator state was used. Final results:

| `tests/<name>.test.mjs` | Pass | Fail / skip |
|---|---:|---:|
| ask-panel-ssr | 84 | 0 / 0 |
| ask-r3-auth-db | 4 | 0 / 0 |
| ask-r4-server-db | 3 | 0 / 0 |
| ask-server-boundaries-db | 8 | 0 / 0 |
| inbox-drafts-actions | 11 | 0 / 0 |
| calls-client-selection | 4 | 0 / 0 |
| ask-private-query-scan | 6 | 0 / 0 |
| ask-r3-reply-copies-db | 6 | 0 / 0 |
| db-roles-manifest-db | 6 | 0 / 0 |
| db-roles-paths-db | 3 | 0 / 0 |
| inbox-draft-flow | 39 | 0 / 0 |
| inbox-draft-sync | 15 | 0 / 0 |

**189 passed across 12 files, zero final failures/skips.** Component executions
are controlled lifecycle/SSR tests, not browser/HTTP certification. The real
signed-cookie actions/DAL and actual narrow SQL logins supply separate server
and function-privilege evidence.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
`node scripts/db-roles-scan.mjs --diff`: **exit 0**. Every printed difference is
explicitly withheld by the manifest: owner controls/settings, policies, users,
permissions/revocations; private recovery/interactions/messages/web sessions;
payment authorizations, QBO and mailbox credentials. No unaccounted table grant
or new MCP/worker write was added. The table scan does not prove function ACL
safety; the real three-login temp-trigger attack regression supplies that check.
`db-roles-sql.mjs private_ask_push_sources` still prints no grants; the push_outbox
generator output remains exactly as quoted in the round-4 section. No manifest
expansion is needed for two function EXECUTE revocations. The privacy census
passes unchanged in size/classifications with the reviewed 0105 hash update.
`git diff --check` passes. All disposable clusters stopped. No exit 137, install,
Next dev/build/start, browser, deployment or service operation occurred.
