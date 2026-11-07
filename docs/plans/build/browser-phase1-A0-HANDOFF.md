# Browser Phase 1 A0 — frozen seam

Branch `t3/browser-phase1`, based on `07fa420de6c1154d332c16e7a2b820acfccdeda0`.
This handoff is part of the A0 commit (use `git log -1 --format=%H -- this-file`
to identify it). No push, live database change, activation, service, browser or
Next build was performed. Only migration **0115** is new; 0100–0114 are unchanged.

## Client / MCP contracts

`lib/browser/phase1-contracts.mjs` is client-safe ESM with Zod and Web platform
globals only. Its exact exports are:

`UUID`, `UInt`, `Task`, `TaskDraft`, `TaskUI`, `TaskMetadata`, `TaskSafe`, `PHASE1_RESULT_CODES`, `ERROR_CODES`, `ERROR_MESSAGES`, `RETRYABLE_CODES`, `HTTP_STATUS`, `RESULT_CATALOG`, `WebError`, `webError`, `ReviewNotice`, `QueueOffer`, `OwnerBrowserReviewClaim`, `Viewport`, `Frame`, `EVENT_NAMES`, `EventPayloads`, `validateEvent`, `InputEvent`, `ManualInput`, `CONTROL_OPERATIONS`, `ControlMessage`, `RPC_METHODS`, `WebEnvelopeV1`, `BinaryHeader`, `OriginManifest`, `ReadProposal`, `ReadEntry`, `ReadManifestV1`, `ReadCandidate`, `ReadConsumeProof`, `ReadDispatchV1`, `InputEpochs`, `ConfirmedAnswer`, `RPCPayloads`, `validateRPC`.

Objects are strict, IDs lowercase canonical UUIDs, timestamps UTC ISO ending
in Z, numeric fields safe nonnegative integers (positive where required). IDs
are associations, never permission. `Task` preserves the MCP UUID `run_id`;
`TaskDraft` alone has `run_id:null`; `TaskUI` is their union. `TaskMetadata` is
`{revision,context_generation}`. `TaskSafe` exactly follows the breakdown, with
no person/URL/title/body. Original MCP exports remain in `contracts.mjs`; all
new errors are accepted by its error union and advertised tool error lists.

`ReviewNotice` is `{id,task_id,original_run_id,revision,kind,state,server_deadline,
result_code,read_revision}` with nullable original run/deadline/result/read
revision; kinds public_read/resource_read/write_blocked/final_blocked, states
pending/closed/expired. A service prepare command creates a fixed final_blocked
notice in `browser_commands.safe_result.review`, never a browser_actions row.
Its command state is failed and the refusal code is BROWSER_PHASE1_READ_ONLY.
Website read-only notice close/presentation adapters are B's responsibility.

`OwnerBrowserReviewClaim` aliases match the breakdown exactly, including
viewing_user_id/viewing_session_id/local_thread_id/task_principal_user_id/
task_conversation_id, separate from the staff's immutable original run.
Watch claims require an attached run and expire within five minutes/session.

`OriginManifest`, `ReadProposal`, `ReadEntry`, `ReadCandidate`, `ReadManifestV1`,
`ReadConsumeProof`, `ReadDispatchV1` preserve the breakdown's exact fields.
Phase 1 has no release_action_id or installed static rule in SQL. Website calls
to publish reads receive D-validated, server-stamped, HMAC-signed manifests, not
raw route proposals. The SQL publisher is website-only; service cannot label or
approve a URL. D still owns the single URL parser, outbound classifier, actual
request HMAC and production Ed25519 dispatch signer. Structural parsing is not
a substitute for those checks.

New errors (messages equal the fixed code; arbitrary strings are rejected):

`BROWSER_PHASE1_READ_ONLY`, `BROWSER_REVIEW_PENDING`, `BROWSER_REVIEW_STALE`, `BROWSER_STREAM_STALE`, `BROWSER_CONTROL_EXPIRED`, `BROWSER_QUEUE_FULL`, `BROWSER_OFFER_EXPIRED`, `BROWSER_READ_EXPIRED`, `BROWSER_READ_PROVENANCE_UNKNOWN`, `BROWSER_FRAME_TOO_LARGE`, `BROWSER_RATE_LIMIT`, `BROWSER_AUTH_EXPIRED`, `BROWSER_LATCHED`.

`HTTP_STATUS` / `RESULT_CATALOG` freeze the HTTP mapping. Only BROWSER_BUSY,
BROWSER_RESOURCE_LIMIT and BROWSER_SERVICE_UNAVAILABLE may be retryable; no
input/action automatically replays. Web errors have exactly ok/code/message/
retryable; MCP adds nullable task_id in the existing isError text envelope.

SSE events are **state, frame, action, file, reauth, closed**. `EventPayloads`
freezes each shape from the breakdown; file is only `{available:false}` and
closed permits BROWSER_OK as well as error codes. Frames use UUID frame_id,
connection-local integer seq, canonical 1280×800 viewport, at most 160 KiB binary
JPEG. BinaryHeader also covers bounded 300 KiB review images. InputEvent and
ManualInput freeze pointer/wheel/key/IME/confirmed-answer variants, stream/frame/
epoch/seq/device/token/idempotency bindings; modifiers/keys reject clipboard and
developer/navigation shortcuts. Runtime letterboxing, capture, rate/sequence,
private drain, consent and current device checks remain mandatory.

RPC methods are admit/join/leave/presence/sites/control/manual_input/health,
read_state/read_manifest/read_review/read_answers/read_availability/read_in_use,
stream_open/stream_close. `RPCPayloads` specifies strict method-specific
`{proof_id,body}` payloads; WebEnvelopeV1 validates these too. Envelope HMAC is
64 lower-case hex; ≤5 s and ≤64 KiB. It carries no CDP relay or authorized boolean.
Bodies contain server-derived persisted proof associations; they are not
untrusted POST JSON with a new label. B mirrors compile-time types in web-types.ts.

## SQL and repository

All public catalog functions return JSONB, are SECURITY DEFINER with
`search_path=public,pg_temp`, revoke PUBLIC EXECUTE, and check actual session_user.
Website APIs have no narrow EXECUTE. Only service APIs are granted to
sjcos_browser. Internal browser_p1_* helpers/trigger functions are not public APIs.

Each signature has a camelCase JS wrapper (e.g. browserWebAdmit,
browserReadConsume) and an entry in `SQL_FUNCTIONS`. Call as
`browserWebControl(client,{tid,vid,op,epoch,i,d})`. Bytea arguments are 32-byte
Uint8Array/Buffer; checkpoint signature is 64 bytes. JSON inputs are objects;
the wrapper encodes them as JSON, binds every argument and validates the result.
`RESULT_SCHEMAS` covers public outputs; browser_read_state chooses its result
schema from scope. No default client, pool, DSN, env-file fallback or transaction
commit is hidden in the repository. The caller owns the transaction.

- `browser_web_admit(conversation uuid,project uuid,kind text,manifest jsonb,session uuid,i uuid,d bytea)` — website.
- `browser_web_join(tid uuid,session uuid,device_hash bytea,role text,private_view boolean,i uuid,d bytea)` — website.
- `browser_web_leave(vid uuid,i uuid)` — website.
- `browser_web_presence(vid uuid,visible boolean,generation bigint,i uuid)` — website.
- `browser_web_owner_view(tid uuid,aid uuid,session uuid,local_thread uuid,i uuid)` — website.
- `browser_web_sites(tid uuid,vid uuid,expected_revision integer,manifest jsonb,i uuid,d bytea)` — website.
- `browser_web_reads(tid uuid,vid uuid,expected_revision integer,proposal jsonb,decision text,i uuid,d bytea)` — website.
- `browser_web_attach_run(tid uuid,rid uuid,vid uuid,expected_epoch bigint,i uuid)` — website.
- `browser_web_capability(tid uuid,rid uuid,vid uuid,server_kind text,process_binding jsonb,i uuid)` — website.
- `browser_web_control(tid uuid,vid uuid,op text,epoch bigint,i uuid,d bytea)` — website.
- `browser_web_input(tid uuid,vid uuid,frame uuid,epochs jsonb,seq bigint,i uuid,d bytea)` — website.
- `browser_authorize(tid uuid,rid uuid,k bytea)` — service.
- `browser_read_state(tid uuid,k bytea,scope text)` — service.
- `browser_command_begin(tid uuid,rid uuid,k bytea,i uuid,epoch bigint,seq bigint,op text,d bytea)` — service.
- `browser_command_finish(command uuid,boot uuid,result text)` — service.
- `browser_enter_private(tid uuid,boot uuid,expected_epoch bigint,mode text)` — service.
- `browser_runtime_transition(tid uuid,boot uuid,epoch bigint,next text,code text)` — service.
- `browser_run_end(tid uuid,rid uuid,disposition text,boot uuid)` — service.
- `browser_maintenance_claim(boot uuid,lim integer)` — service.
- `browser_maintenance_finish(job uuid,boot uuid,result text,proof jsonb)` — service.
- `browser_append_audit(tid uuid,event_id uuid,event text,object_id uuid,code text,chain jsonb)` — service.
- `browser_checkpoint(seq bigint,d bytea,key_id text,signature bytea,external_ack text)` — service.
- `browser_read_consume(tid uuid,boot uuid,revision integer,entry uuid,manifest_d bytea,request_d bytea,flow_nonce uuid,generation bigint,epoch bigint)` — service.
- `browser_web_queue(tid uuid,vid uuid,op text,i uuid,d bytea)` — website.
- `browser_queue_offer(boot uuid)` — service.

The last two queue functions supplement the breakdown's catalog: web_queue
requires a persisted request/accept_offer proof; queue_offer serializes offers,
expires old queue/offer records, reserves at most two live/offered contexts and
selects FIFO. Merely retrying an idempotency key cannot accept an offer. Capacity
checks at admission use the common advisory lock; runtime headroom/latch remain A1.

Safe write transactions lock task first (queue serialization lock before task),
then manifest/action/use/command and audit head. Website proofs must be created
in the same transaction as their function call. `browser_web_commands` stores
operation/session/viewer/idempotency/body HMAC and a short expiry (≤5 seconds
when consumed); it contains no input text or plaintext device secret. A succeeded
proof preserves its metadata and stores the immutable retry response under
safe_result.response. Same proof/digest returns that response after current
person/session checks; changed digest fails. It never performs another mutation.

Proof metadata used by the catalog:

- join: device_secret_hash (64 hex, server minted). Existing same-device owner
  viewer can be consent-upgraded without consuming a second slot; secret hash
  must match. Joins cannot create an owner claim or control authority.
- presence: conversation_id for an initiator, claim_id for owner review; exact
  stream generation and ≤15-second session-bounded attendance.
- watch: real owner session; action_id is NULL for Phase 1 notices/Watch.
- capability: process_binding exactly `{pid,start_ticks,cgroup,boot_id}`; server
  kind browser only. Capability is issued once after immutable run attachment.
- take_over: drained=true, context_generation, control_token_hash (64 hex), after
  D's privacy barrier. SQL also requires private context/current consent.
- fresh_browser: drained=true, fenced=true, context_generation, old_generation,
  new_boot_id. Only a paused live task; SQL consumes a completed command before
  clearing privacy, increments context/listener/document/control generations,
  rotates viewer streams, revokes old runs/reads and clears current run/control.
- input: exact viewer/session proof plus UUID last frame, InputEpochs, increasing
  seq and keyed body HMAC. Accepted proof expires within five seconds. No text is
  stored. B's authenticated publisher must update viewer.last_frame_uuid and
  current stream/document/control fields only after verifying the signed frame;
  an unrecorded frame cannot be used as authority.

Web control op names are take_over/done/give_back/resume/stop/fresh_browser/pause.
Give back and private resume always refuse Phase 1. Done remains private/paused.
Stop also accepts queued/starting tasks. Service runtime_transition only pauses,
closes or fails current boot/epoch; web attachment performs starting→active.
Terminal tasks cannot reopen, regardless of login. Normal run_end revokes the
capability and pauses; a crash fails. Service never gets fresh-public authority.

## Audit / exact read consumption

Keys stay outside Postgres. SQL recomputes canonical JSON SHA256 and locks the
expected audit head. A1's separately trusted installation verifier must first
validate the purpose HMAC, then stage an owner-only setting:
`browser.audit_event.<event UUID> = {verified:true,digest,hmac,key_id,expires_at}`.
The service cannot write this attestation or substitute one for another digest.
`browser_append_audit` requires chain exactly
`{v:1,previous_digest,digest,hmac,key_id,at,binding}`. Canonical event bytes are
`{v:1,seq,event_id,task_id,event,object_id,code,at,previous_digest,binding}`; hashes
are lowercase hex. The fixed ASCII schema keys and safe integers are canonicalized
identically in SQL and JS fixtures. For read_consumed, object_id is flow_nonce;
binding exactly contains boot_id/context_generation/revision/entry_id/
manifest_digest/request_hmac/flow_nonce/listener_generation/document_epoch/
control_epoch. Other events require binding:null. No page/body/log text is accepted.

Independent sink verification then stages owner-only
`browser.checkpoint.<ack> = {verified:true,through_seq,digest,key_id,signature,
install_id,boot_id,sink_key_id,sink_signature,expires_at}`. Signature fields in
this attestation are canonical base64 (64 decoded bytes); ack is a bounded safe
identifier. SQL accepts only that exact signature/digest/key/seq and a live
attestation, serializes the head and retains the original 0102 checkpoint guards.
No signature-presence or invented ACK fallback exists. The A1 verifier/bridge
and independent sink are **not implemented by A0**; missing attestations refuse.

Order is deliberate: prepare/anchor exact read-consume intent with the signed
binding → commit checkpoint → call read_consume once → commit its use → permit
bytes only through D's independently bound transport. A consume proof includes
the exact consume_seq and checkpoint_ack_id, original run, boot/context/listener,
manifest/entry/request/flow, parent document epoch and use ordinal. A preflight
anchor grants no transmit authority without a committed successful consume.
One-use races serialize on the task; duplicate nonce, wrong generation, exhausted
budget, stale parent/revision, private state, lost session/areas/attendance or
missing checkpoint all refuse. Loss after consume burns the use; never retry a
request automatically. Network/TLS/pidfd/target/2-second decision checks remain D+A1.

## Columns and role boundaries

New columns:

- browser_tasks: task_kind (public_research/permit/invoice/purchase), revision
  bigint default1>0, context_generation bigint default0≥0, confirmed_answers
  JSONB default[], attention default none, listener_generation bigint default0≥0.
  The latter is the durable listener identity bound to ReadConsumeProof; accepted
  start/fresh generation increments it, service cannot arbitrarily replace it.
- browser_viewers.last_frame_uuid UUID; browser_commands.frame_uuid UUID. Old
  bigint frame fields remain compatibility-only. The replaced CHECK demands
  UUID frame + stream generation + document/control epochs for viewer commands;
  existing viewer/task/sid composite FK is retained.
- ai_messages.trust_profile ordinary/browser default ordinary and nullable
  browser_task_id FK RESTRICT, iff browser tag. Tags bind task/thread/run and are
  immutable. Narrow INSERT/UPDATE cannot assign either protected column.
- browser_audit.phase1_binding JSONB: fixed, bounded read-intent binding only;
  other service events use JSON null. No general event payload/log channel.

Existing web-command operation CHECK adds fresh_browser/input/attach_run/
capability/queue/offer/accept_offer; audit outbox CHECK admits fixed runtime
catalog events. The original audit chain, append-only, identity, terminal,
web session and manifest immutability guards remain. All new triggers/definers
have protected search_path. No new entity tables or roles with approval rights.

Pilot/preference defaults are [] and all six existing boolean flags default off.
`evaluatePhase1Flags({settings,env,user})` requires exact env
SJC_BROWSER_ENABLED=1, valid DB enabled and a named active pilot. Empty/invalid
pilots admit nobody, including Joe. Staff_enabled is independent, and later
vault/files/final/handoff effective flags are always false. Owner-only own-user
confirmation suppression does not suppress the privacy barrier. This module
only evaluates flags: A1/B must also enforce readiness/accounting/schema/recovery/
record/cookie/presence/latch and recheck within five seconds and on commands.

The fifth role is integrated into bootstrap, generator, apply/check, scan,
manifest and disposable harness. No live role was created. Actual LOGIN tests
prove session_user=current_user for website, Browser, agent, worker, readonly
and a no-membership PUBLIC-only login. Tests never use localhost:5432 fallback.

## Verification and remaining work

Commands used the disposable harness, tag `browser-p1-a0-1107x`, one file at a
time. Final results will be recorded below. `node --check` also covered the
harness, both fixture modules and db-roles-apply; `git diff --check` passed.

A0 does not implement the A1 production supervisor/controller/agent, installation
verifier/attestation bridge, key provisioning, independent sink, resolved Claude
CLI/history filters, process binding, timers or cleanup executor. B owns web
routes/session-CSRF/stream publisher+frame recording; C owns pane/Watch UI; D owns
privacy drain, read classifier/parser/manifest signing, outbound gate/dispatch.
Input proof consumption and delivery remain A1/B/D's memory-only one-use path.
No Browser runtime readiness is asserted, no flag enabled, no canary/network/
RSS/device/SSE/visual acceptance claimed. Coordinator still owns those gates.

Final verification (all exits 0; no skips):

| Command | Passed |
|---|---:|
| `node --test tests/browser-contract.test.mjs` | 40 |
| `node --test tests/browser-schema-db.test.mjs` | 31 |
| `node --test tests/browser-roles-db.test.mjs` | 12 |
| `node --test tests/browser-flags-db.test.mjs` | 12 |
| `node --test tests/db-roles-manifest-db.test.mjs` | 7 |
| `node --test tests/db-roles-paths-db.test.mjs` | 4 |

Total 106 passed. Schema coverage includes fresh snapshot+ledger, upgrade through
0100–0114 (0113 remains unused), exact ledger replay and raw SQL idempotent replay.
The initial 27 contract/flag expectations were written before their implementation;
subsequent tests exercise real LOGIN paths, the complete attended admission/offer/
run/capability sequence, private/fresh fences and anchored concurrent consume.
The disposable owner fixture simulates independently verified attestations; it
does not claim a production verifier/sink or actual upstream network dispatch.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit **0**.
`node scripts/db-roles-scan.mjs --diff`: exit **0**, Browser **0 tables**.
The report is not empty: prior agent/worker static over-approximations remain.
Comparing the current scan against the base manifest shows only two newly
reported operations: worker ai_messages INSERT/UPDATE now have explicit column
ACLs instead of table ACLs. Both are documented intentional restrictions, and
actual worker/MCP path tests pass. No service table grant was added to silence it.
`node scripts/db-roles-sql.mjs --functions` emits the catalog successfully.

Cleanup: `SJC_TEST_CLUSTER_TAG=browser-p1-a0-1107x node scripts/test-db.mjs stop`
completed after the final tests. No test cluster/server/browser remains from A0.
