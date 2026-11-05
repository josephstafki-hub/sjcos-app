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
