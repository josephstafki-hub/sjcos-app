# In-home consultation backend handoff — capture server slice implemented

The current contract is in **Current server integration** below. Earlier continuation
notes are historical and describe the pre-0076 foundation. Phase 1 as a whole still
requires files/uploads, browser offline integration, and office findings. Do not deploy
this as an end-to-end offline consultation feature. No deployment or push performed.

Branch: `t3/in-home-consult-backend`.
Phase 0 commit: `3e3e1cca` (only MCP kinds/aliases and estimating regression test).

**Phase 1 is not implemented end to end. Do not treat this branch as a working capture backend.**
The modules below are tested foundations. Migration 0075 now supplies storage and a tested subset of signed SQL commands.
No consult routes, executable/published seed, full command protocol, file authorization
changes, service worker, or reconciliation have been installed. Existing business behavior is unchanged except the Phase 0 fix.
No dependency on the parallel 0073/0074 work was introduced. Nothing was pushed.

## Implemented contracts

| Import | Available API | Responsibility / integration constraint |
|---|---|---|
| `lib/consult/form-types.ts` | `FieldDef`, `ModuleDef`, `TemplateDef`, `When`, `ShotDef`, units/tiers | Plan §7.1 types, client-safe. These are definitions, not the seed. |
| `lib/consult/forms/validate.ts` | `fieldSchema`, `moduleSchema`, `templateSchema`, `validateModule`, `validateTemplate` | Zod strict structural validation, tiers/units, duplicate fields/shots/coverage, registered mapping labels and module membership. Publication transaction and SQL validation remain unbuilt. Formula strings are not evaluated. |
| `lib/consult/forms/approved-content.ts` | `approvedFormContent` | Exact §7.2–7.11 content preserved verbatim. **Not `forms/seed.ts`, not executable definitions, not publishable.** Includes all shared modules, seven template sections, template-specific fields, add-ons, scripts, shots, code flags, mappings and conditions as approved prose. |
| `lib/consult/length.ts` | `parseLength`, `parseLengthPair`, `formatLength`, `LengthOptions` | Inches to 1/16 storage, configurable display precision; explicit feet/inches/metric, Unicode fractions, paired input, range-based bare-number interpretation. UI must show interpretation before Save. |
| `lib/consult/completeness.ts` | `CompletionInput`, `CompletionItem`, `RiskAssumption`, `consultCompleteness`, `countingSkip`, `conditionMatches` | Eleven checks and separate price-critical/record counts. **Input must be built from trusted server records**, never accepted directly from a browser. No role argument, owner exemption or review step. Does not persist/lock Complete. Compound/nested conditions compile through `forms/conditions.ts` and are accepted by form validation; full seed conditions remain unbuilt. |
| `lib/consult/queue.ts` | `ConsultOp`, `AnswerAddress`, `QueueState`, `emptyQueue`, `enqueue`, `payloadHash`, `canonicalJson`, `nextBatch`, `applyReceipt`, `applyServerEpoch`, `closeManifest`, `QueueDrain` | Pure queue transitions; stable IDs/hash, per-device sequence, bounded batches, backoff, visible conflicts, tombstones. Caller persists queue and projection together. `enqueue` expects a previously computed hash; the server must recompute/validate it. No transport/CSRF or server receipts exist. |
| `lib/consult/offline.ts` | `OfflineIdentity`, `OfflineLease`, `partitionKey`, `assertOfflineLease`, `seal`, `unseal`, `ConsultOfflineStore.open/load/save/preflight/close` | AES-GCM encrypted whole-state IDB partition with revision CAS and commit acknowledgment. Online lease issuance, device-bound key/PIN management, unlock controller, quota sizing and takeover remain unbuilt. Browser IDB transactions have not been executed. |
| `lib/consult/readiness.ts` | `ReadyCheck`, `readinessLabels`, `offlineReadiness` | First five readiness checks must pass; optional mic never blocks manual capture. Actual downloads, precache, storage estimate and lease issuance remain unbuilt. |
| `lib/consult/client-summary.ts` | `ClientSummary`, `clientSummary`, `handBackAllowed` | Explicit allowlist excludes extra internal/price/transcript properties even on nested room objects. Two-second hold or verified PIN. UI must unmount visitor view and cancel hold on release; PIN verification is external. |
| `lib/consult/copy.ts` | `failureCopy`, `controlCopy` | All 20 current §5.7 rows and the §3 visitor/office words table, with approved wording and placeholders. Arrays include audio/future-phase copy for later use; they do not enable those features. |
| `lib/consult/scope-facts.ts`, `scope-facts-schema.ts` | `ConsultScopeFactsV1`, `consultScopeFactsV1Schema` | Exact v1 wire keys, strict validation, safe revisions, sorted provenance, empty `none`, source-labelled additions. `reviewed` means Complete, never a UI label or stored lifecycle status. **No `consultScopeFacts()` DB export exists.** |

## Screen and state mapping for the UI builder (§5–§7)

The available client-safe functions can be imported now. Entries marked **unbuilt**
are dependencies to implement before wiring a screen to real client data. Do not add
mock success responses or make readiness/completion promises from the pure reducers alone.

| Screen / state | Available imports | Required action/loader still unbuilt |
|---|---|---|
| Overview / Schedule / Ops entry; today list, empty, loading | `controlCopy` for names | Assigned visit list loader, owner schedule command, area/assignment gate, enrollment-aware project links, visitor schedule to-do. |
| Schedule dialog: who/date/time/templates/add-ons/notes/duration | `TemplateDef` only | Owner-authenticated schedule, pinned checksums/plan revision, future Central-day work item; no automatic stage promotion. |
| Get ready: Checking / Not ready / No signal / Ready offline | `readinessLabels`, `offlineReadiness`, `ConsultOfflineStore.preflight`, `failureCopy` | Scoped snapshot, executable forms, static precache, capacity estimate, signed 24h lease and device/PIN key. First five checks actually run in order; mic absent in Phase 1. |
| Start / opening script cards / Next | `approvedFormContent` has approved opening and staff variation | Published seed, pinned template loader, authenticated start operation, one-device registration. Notes must stay off in Phase 1. |
| Phone field entry / tablet two panes / portrait grid | `FieldDef`, `ModuleDef`, parser and form validators | Pinned instances, answer-value validation, condition/mapping compiler, server sync. Layout does not alter logical address `{instance_id,field_key}`. |
| Keypad / laser mode / Same as last / paired dimensions | `parseLength`, `parseLengthPair`, `formatLength` | Persist via IDB CAS before check/haptic. UI shows `display`/interpreted unit and handles `{ok:false,error}`; no save on parse failure. |
| Repeat room/window/door / parent instances | `ConsultOp`, `AnswerAddress` | Server instance membership, pinned versions, once-module uniqueness, parent-cycle validation and removed-instance tombstones. |
| Prefill: Still right / Correct | Queue payload can carry explicit confirmation | Scoped source/time prefill; hide financials without estimates permission; unconfirmed prefill cannot count. |
| Per-field Skip / assumption fields / Return visit | `SkipReason`, `RiskAssumption`, `countingSkip` | Persist skip, validate contradictory N/A on server, return/trade walk tasks. Return visit remains open. No section-wide skip. |
| Photo: Saved on device / Uploading / Uploaded / Retake | Encrypted partition can hold JSON state only; queue tracks logical op | Separate durable encrypted blob storage, bounded image decoding/EXIF stripping, upload init/part/status/commit and classification gates. Do not serialize raw blobs through JSON state. |
| Compact status / expanded send sheet / Send now / Sun mode | Queue entries / `nextBatch` / `QueueDrain`; `controlCopy` | Transport and durable queue binding, last-send metadata, offline recovery controller. Only show Saved after IDB `save()` resolves. Phase 1 status is Notes off. Sun mode is a UI device preference. |
| Leaving section / Go back / Leave for now | Completeness item/count output | Section projection from pinned answers/conditions; in-tool Back handling belongs to UI. |
| Show to client: recap / initials / Renovate Right receipt | `clientSummary`, `ClientSummary`, `handBackAllowed` | Source recap generation, initials blob commit, receipt command; UI unmounts all visitor data, traps Back, returns to visitor preview after hold/PIN. Initials are acknowledgment, never consent/contract/price approval. |
| Before you wrap: Open / Partly / flags / walks / conflicts | `consultCompleteness` gives named check/open-key groups and tier counts | Trusted completeness projection, flag/walk mutation handlers and target navigation. Pending AI chips do not block, but no AI in Phase 1. |
| Close / closed—sending / Complete / Needs finishing | `closeManifest`, `consultCompleteness` | Exact digest acknowledgment, accepted sequences/committed blob check, server reducer/locked generation, finish/return/promise tasks. Local completion alone cannot show server Complete. |
| Forgot Close / interrupted / cut short | `failureCopy` | Persisted lifecycle and device gap metadata; no idle completion. |
| Conflict picker: Pick / Enter another | Queue entry `conflict` state and payload | Server revision pair, human resolution command with both revisions/reason, consciously rebased new op. Queue never chooses by time/source. |
| Reopen | `applyServerEpoch` makes old queue entries `rebase_required` conflicts | Authorized visitor/owner action with expected revision/reason, generation increment, immutable history. |
| Desktop optional look-over / phone stacked version | Completion counts, scope export types/schema, same conflict states | Snapshot/media/gaps loader, assignment check, Apply findings, Reopen. No review button or review to-do. Complete locks editing. |
| Findings applied / failed / Try again / pilot Apply findings | Wire contract types only | Generation/hash reconciliation with exact plan IDs, aggregation/retraction/provenance, sent/signed locks, once-only job and repair task. |
| Forms Settings list / pinned old preview / editor | `validateModule`, `validateTemplate`, definitions | All version persistence/publish/retire guards and owner APIs. Editor itself Phase 1.5. |
| Transcript / chips / note lines / Delete transcript | Copy only | Intentionally Phases 2–3; no recorder, model, transcript or consent-evidence storage implemented. |
| Sketch / helper devices / floor draft | Copy/type context only | Phase 4. No fake sketch evidence; no helper device capture. |

## Error codes and copy

Use `failureCopy` / `controlCopy` as the wording source; do not expose raw codes as labels.

| Result / code | UI behavior and plan copy |
|---|---|
| parser `invalid_length`, `out_of_range`, `invalid_length_pair` | Keep keypad open, show interpretation and request correction; no queue write. §6.6 does not provide a universal error sentence. |
| local `storage_unavailable`, `storage_blocked`, `storage_full` | Get ready's check reason or “Storage full — connect to save, or use paper.” No check/haptic/save tick. Retain last durable record. |
| local `local_conflict` | Reload same-user encrypted partition and consciously reapply draft; never overwrite another tab's durable state. No plan-prescribed unique sentence. |
| `offline_locked`, HTTP 401 | “Signed out — your answers are safe on this device. Sign in as {name} to send them.” [Sign in]. Key/lease controller must lock decrypted memory; not implemented. |
| HTTP 403 | “Your access to this visit was removed. Your answers are locked on this device and Joe can recover them.” Quarantine original author/queue. |
| HTTP 409 `conflict`, `rebase_required` | “This field changed on another device. Pick which value to keep.” [Pick] [Pick] [Enter another]. Preserve proposed/current revisions. |
| HTTP 409 `idempotency_mismatch` | Stop drain; retain op; diagnose changed payload under same ID. Do not generate replacement IDs automatically. No approved separate copy specified. |
| HTTP 410 / greater deletion epoch | Tombstone before exposing cached content, no replay. Transcript deletion uses “The transcript for this visit was deleted.” Form/media deletion needs a server-specific recovery flow. |
| HTTP 422 | Keep rejected op visible for correction; upload uses “This photo couldn't be sent ({reason}). [Retake]”. |
| HTTP 423 `complete_locked` | Require Reopen with expected revision/reason. Never silently edit a completed generation. |
| HTTP 426 / unsupported protocol or checksum | “Update ready — reload between rooms.” [Reload]. Retain original build partition until explicit safe migration/recovery; never silently translate/drop. |
| HTTP 429 / 5xx / lost connection | Jittered 2–60 second retry; same op IDs. No signal: “No signal · saved on this device”. |
| findings apply failure | “Couldn't apply findings to the scope — [Try again]”. Same generation/application key on retry. |

## Remaining backend work

- Files/uploads: authorization on every generic file path, bounded image/EXIF processing,
  multipart/deterministic commit recovery, initials and photo capture. No upload command
  is exposed by this slice. Required photos/initials cannot be faked by close evidence.
- Offline browser engine: IDB/browser verification, encrypted blobs, device/PIN keys,
  leases, quarantine/takeover, data-free shell and service worker, update/recovery flow.
- Office outputs: findings reconciliation, provenance and sent/signed locks, generation
  supersession, scope facts DB export and pricing readiness. No findings job is enqueued
  by this slice. Complete itself requires no owner action/review.
- Agent proposals remain a later slice. Agents cannot use website person commands.
- Executable seed belongs to the parallel seed builder. It was absent at this slice's
  final validation; publication was tested using small real module/template fixtures.
  Run publication on the complete seed when it lands; do not infer seed acceptance.

## Validation in this worktree

All commands use single named files and the `consult` disposable cluster where applicable.
Initial regression failures encountered while writing the new tests were corrected.

- `estimating-db.test.mjs`: 9 passing, including registered MCP schema/handler and real DB.
- `consult-length.test.mjs`: 3 passing.
- `consult-forms.test.mjs`: 3 passing (validator/content fidelity only; not full seed coverage).
- `consult-completeness.test.mjs`: 5 passing (pure reducer; not persisted completion).
- `consult-queue.test.mjs`: 4 passing.
- `consult-offline.test.mjs`: 2 passing (Node crypto/lease only; IDB/browser unverified).
- `consult-readiness.test.mjs`: 2 passing.
- `consult-scope-facts.test.mjs`: 2 passing (wire schema/client allowlist, not DB export).
- `db-roles-manifest-db.test.mjs`: 6 passing on existing schema.
- `db-roles-paths-db.test.mjs`: 2 passing on existing code/schema.
- `node scripts/db-roles-scan.mjs --diff`: exit 0, only documented intentionally withheld privileges.
- Locked `tsc --noEmit -p .`: first run exit=0; expanded validation found and corrected one return-type mismatch; final run exit=0.

No Next server/build, browser, paid model call, live database connection, deployment or
service operation. Disposable test cluster is stopped before handback. No visual check
was run. A future coordinator must check phone/tablet/keypad, client Back/Hand back,
no-signal cold reload, storage/quota/identity switch and recovery after a complete backend
and UI exist.

## 2026-11-02 continuation: SQL contracts implemented in 0075

**This continuation remains incomplete; items 1–2 must not be marked done.**
No executable seed was produced. SQL publication validation is structural and includes
condition references/tiers/units but is not yet equivalent to the approved content and
versioned registry requirements. No approval is needed to continue.

New storage: `consult_context_keys`, `consult_form_versions`, `consults`,
`consult_form_pins`, `consult_assignments`, `consult_devices`, `consult_instances`,
`consult_events`, `consult_answers`, `consult_field_heads`, `consult_conflicts`,
`consult_media`, `consult_operation_receipts`, `consult_uploads`,
`consult_finding_applications`. Audio/suggestions/coverage/floor drafts are not created.
All new tables are manifest-listed with zero raw narrow grants; generator output is
empty and that result is recorded in the migration. No raw consult SELECT was granted
for monitoring. `files.id` is text, so consult file references use text too.

Context envelope: `{key_id, payload, signature}`. `payload` is an exact JSON string;
`signature` is hex HMAC-SHA256 over UTF-8 payload using an owner-installed >=32-byte key.
Claims: `kind: "in_home_consult"`, `sub`, current `role`, `areas`, `mode: person|agent`,
`operation`, `consult_id` (null for global operations), `iat`, `exp` (<=5 minutes),
`run_id`, `nonce` (>=16 characters). No keys are seeded. Only the owner connection can
mint; website integration must authenticate freshly before minting. User active status,
current projects area, session revocations and assignment are checked inside verification.
Worker execution is withheld until fenced job commands are implemented.

| SQL command | Access / result |
|---|---|
| `consult_read(context,target,projection='capture')` | Agent execute; assignment-scoped consult/pins/instances/heads/unresolved conflicts JSON. Only capture projection supported. |
| `consult_propose_form(context,definition,form_kind)` | Agent execute; draft UUID only, checksum/author set by DB. |
| `consult_schedule(context,project,visit_time,visitor,forms,plan?,plan_revision?)` | Agent execute, verified owner subject required; creates visit, published pins and visitor. Flag must be enabled. Work-item creation remains server integration work. |
| `consult_publish_form(context,form)` | Owner connection, person-owner claims only; validates, retires previous published version, returns checksum. |
| `consult_start(context,target,device,expected_revision)` | Owner connection, person claims and assignment; registers one capture device, returns epoch. |
| `consult_create_instance(context,target,instance,module,instance_label,parent,expected_revision)` | Owner connection, person/assignment; enforces pin, once-module and acyclic parent constraints, returns revision. |
| `consult_capture_answer(context,target,device,epoch,event,operation)` | Owner connection, person/assignment/device; returns `{code,revision,answer_id}`. Operation keys: `instance_id,field_key,generation,base_revision,status,value,unit,skip_reason,skip_note`. Server digest + receipt retries; stale writes remain conflicts and do not move heads. |
| `consult_reopen(context,target,expected_revision,reason)` | Owner connection, person/assignment; returns new generation; old history retained. |

Person-command execute is **not** granted to `sjcos_agent` or worker. Agent contexts
cannot use the person capture command to turn proposals into accepted answers.
`consult_mint_context`, verifier, validators and triggers have no PUBLIC/narrow execute.
Website routes/CSRF/Origin/DAL integration do not exist yet; SQL commands are not routes.

Client-safe conditional type now includes `{all: When[]}`, `{any: When[]}`, `{not: When}`
alongside atomic conditions. `compileCondition(condition,knownFields)` returns a pure
predicate, checks field references and bounds depth/node count. `validateModule`,
`validateTemplate`, and `conditionMatches` use this compiler. No dynamic evaluation.

Continuation validation:
- consult-access-db: 1 passing test covering the real scenarios above.
- consult-forms: 4 passing (includes compound compiler; still no full seed fidelity).
- consult-completeness: 5; length: 3; queue: 4; offline: 2; readiness: 2; scope-facts: 2 passing.
- db-roles-manifest-db: 6; db-roles-paths-db: 2; estimating-db: 9 passing.
- db-roles-scan --diff: exit 0 (only documented intentionally withheld privileges).
- Shared-lock typecheck: exit=0.
- No Next commands, browsers, live/QA database connection, deploy or service operations.
  DB fixtures used the disposable `consult` cluster; it is stopped before handback.

## Current server integration (0076 continuation; authoritative)

Implemented in `lib/consult/protocol.ts`, `lib/consult/forms/formula.ts`,
`app/api/consult/route.ts`, `app/api/consult/[id]/route.ts`, and migration 0076.
The website runs these owner-connection transactions after fresh DAL authentication.
Every command re-verifies the current user/area/assignment inside SQL. Capture mutations
also check active device/user/epoch. Assignment/scheduling/publication require Joe;
Reopen and conflict selection allow the assigned visitor or Joe. No narrow execute or
raw consult privileges were added. Envelopes stay server-side; claims use the actual
session authentication time, preserving revocation checks.

### HTTP API for the UI

All responses are JSON with `Cache-Control: no-store` on successful reads/commands.
Use cookie authentication. POST requires same Origin as request URL, JSON content type,
and `X-Consult-CSRF: 1`. Cross-site requests are refused. Payload limit is 256 KiB.

- `GET /api/consult`: `{visits:[{id,project_id,status,revision,completion_generation,
  scheduled_at,conducted_by}]}`, latest 200, owner all / staff assigned only.
- `GET /api/consult/{uuid}`: `{consult,pins,instances,heads,conflicts}`. Pins include
  immutable definitions. Includes tombstoned instances; heads are server-accepted
  answers only. Conflicts include current/proposed answer IDs. Re-fetch the snapshot
  after mutations; this slice does not expose an incremental cursor endpoint.
- `POST /api/consult/{uuid}`: `{command,input}` with the commands below.
- `POST /api/consult/new`: global `schedule` or `publish_form` only.

| command | exact input | result |
|---|---|---|
| schedule | `{project,visit_time,visitor,forms:UUID[],plan?:UUID|null,plan_revision?:number|null}`; offset ISO timestamp; all pins published, every template module pinned | `{id}` + scheduled-visit task |
| publish_form | `{form_id,registry_id}` | `{checksum}` |
| start | `{device,expected_revision}` | `{epoch}` (DB bigint JSON may be a string) |
| assign | `{visitor,expected_revision,scheduled_at?:offset ISO timestamp}` | `{revision}`; revokes prior assignment/device, returns to scheduled for explicit new Start |
| ops | `{nonce,ops:ConsultOp[]}`; nonce 16–128 chars; <=50 ops, one device/epoch | array of queue `OpReceipt`: `{id,status,revision?,error_code?,conflict?}` |
| evidence | `{device,epoch,expected_revision,evidence}` (strict schema below) | `{revision}` |
| close | `{expected_revision,manifest:CloseManifest}` | `{digest,complete,checks,price_critical,record,revision}` |
| reopen | `{expected_revision,reason}` | `{generation}`; clears close acknowledgments, preserves history |
| resolve_conflict | `{instance_id,field_key,current_answer_id,proposed_answer_id,expected_revision,generation,reason,choice:'current'|'proposed'}` | `{revision,answer_id}`; office selection without capture-device takeover |

`ConsultOp` is the exact queue.ts envelope. `payload_sha256` hashes canonical JSON of
**payload**; server also binds the entire envelope to the immutable event receipt.
Signed nonce binds to the request nonce; nonce reuse with different bytes is refused.
Same event/hash retries return the original receipt even under another transport nonce.
Receipt/answer/event/projection/sequence commit together under a consult row lock.
Invalid individual operations roll back to a savepoint and persist a 422 receipt;
malformed envelopes, authorization/hash/sequence errors reject the batch atomically.
A dropped connection before commit rolls everything back; ack loss after commit is safe.

Supported op types:
- `answer` / `clear`: target `{instance_id,field_key}`, payload
  `{status:'answered'|'skipped'|'cleared',value?,unit?,skip_reason?,skip_note?}`.
  Clear requires `status:'cleared'`. Base revision is the **field** head revision.
  Derived fields and caller-selected source/actor/protected properties are refused.
- `create_instance`: target `{instance_id,module_key,parent_id?,label}`, payload `{}`;
  base is consult revision. Pinned membership, once modules, parent cycles enforced.
- `remove_instance`: target `{instance_id}`, payload `{}`; consult revision required,
  live children must be removed first. Stale removal returns conflict, never deletes.
- `resolve`: answer target; payload `{current_answer_id,proposed_answer_id,reason,answer}`
  where `answer` has the answer payload above. New value or either existing value may
  be supplied; both IDs and current field revision must still match. Stores immutable
  resolution evidence and resolves the conflicting proposal.
- `discard_rejection`: target `null`, payload `{event_id,hash,reason}`. Hash is canonical
  SHA256 of the entire rejected op. Human explicitly abandons a rejected/stale proposal;
  unresolved answer conflicts require `resolve` instead. Never silently rebases.

Evidence uses the strict exported `evidenceSchema` as the executable UI contract:
`{photos_ok,manual_confirmed:true,handed_back:true,ack_reason:string|null,promised_date,
no_trades_confirmed,touched_trades:string[],trade_walks:[{trade,needed,reason,day?}],
rrp:{receipt,firm_current,renovator_current,redelivery_required,redelivery_day?},
flags:Record<instanceId:fieldKey,{disposition,note}>,
skips:Record<instanceId:fieldKey|instanceId:shot:shotKey,{reason,note?,assumption?,trade_walk_decided?}>,
return_day?}`. Dates are strict YYYY-MM-DD. Assumptions use `RiskAssumption` exactly.
The server stamps actor/time; client cannot supply completion checks, accepted answers,
photo references, recording evidence, or lifecycle status through this command.
Only Joe can choose return/walk task dates. Without his date these tasks remain undated.
RRP conservatively applies when house year is missing/ambiguous or before 1978.

Close derives all eleven checks from pins, live instances, accepted heads, committed
media, recorded human evidence, flags/conditions and unresolved conflicts. It requires
all sequence receipts to be accepted or explicitly resolved/abandoned, all manifest blobs
committed, all live media hashes included, and zero local pending. Server returns the
canonical exact manifest digest; retrying the same close returns that acknowledgment.
Complete locks mutations. Reopen increments generation, audits reason/actor and forces
old-generation proposals into explicit `rebase_required` receipts. No owner exemption,
review state, review task, push or stage advancement exists.

Tasks use stable `(consult,kind,key)` source IDs under the consult lock: schedule to the
visitor on Central visit day, finish to the visitor next business day, return/trade walk
to Joe (undated until he chooses), estimate promise to Joe on promised date, RRP
re-delivery on its recorded day. All dated work is Central midnight; the existing table
trigger snoozes future work. Completed visits close their finish/schedule task only.

### Publication and schema mirror strategy

There is one strict executable schema/semantic validator: `forms/validate.ts` against
`FieldDef`/`ModuleDef`/`TemplateDef`. It validates registered mapping labels, template
membership, field/shot/coverage uniqueness and references, compound conditions, bounded
arithmetic grammar/references and formula cycles. No dynamic formula evaluation occurs.
Owner-installed `consult_mapping_registries` are immutable, versioned rows; the browser
cannot supply arbitrary mappings to publish. `publish()` validates and writes a
checksum-bound, validator-version-1 attestation in the same transaction before calling
SQL publish. SQL and its publication trigger require this attestation, including on
raw INSERT/UPDATE attempts. A definition edit invalidates it. This replaces the partial
PL/pgSQL schema interpreter and prevents TS/SQL schema drift; future schema changes must
bump the validator/attestation version together and test both publish paths.

Physical schema source is the ordered migration ledger: base `db/schema.sql` plus
0075/0076, exactly as the disposable harness installs it. Do not copy CREATE statements
into the base snapshot and then replay them a second time. Both new-table manifests and
migration permission-generator output are included; all five 0076 tables have no narrow
grants. Publication fixture and narrow-denial DB tests verify the installed schema.

### This continuation's validation

Passing: consult-access-db, consult-sync-db, consult-todos-db; all existing consult unit
files (length, forms, completeness, queue, offline, readiness, scope-facts); estimating-db;
db-roles-manifest-db; db-roles-paths-db. `db-roles-scan --diff` exits 0 (documented
withheld privileges only). Locked niced `tsc --noEmit -p .` exits 0.
No browser/build/server, production/QA connection, deploy, push or service operation.
The disposable `consult` cluster is stopped before handback.

## 2026-11-02 files / findings / proposals continuation (0077)

**This continuation is substantial but does not finish the requested backend slice.**
Do not claim Phase 1 is complete or ready to deploy. In particular, durable background
findings jobs, full seed-to-export semantics, and production maintenance scheduling
remain as listed below. The earlier 0076 capture contract still applies.

### Implemented and tested

- `files.classification` separates attachments, consult photos, and initials. Generic
  readers/listings across website, portal, agent context, mail attachments and MCP
  filter attachment rows before signing/reading/thumbnailing. The generic file route
  rejects consult IDs before signature handling. `serveFile` also checks classification.
  Narrow SQL roles have file RLS limiting them to attachments. Classified file
  storage/hash/classification cannot change, and attachment aliases cannot use consult
  blob basenames (including path-prefixed aliases). `readUpload` refuses consult blobs.
- Consult image uploads use bounded 1 MiB parts, 25 MiB limits, original-byte SHA256,
  JPEG/PNG/WebP sniff + full decoding through Sharp, 40M pixel limit, no animation,
  EXIF stripping and orientation normalization. Both init and commit verify person,
  assignment, device and photo permission. Commit also verifies generation/consent
  epoch, all parts, exact size, event and original hash. HEIC conversion is not enabled.
- Deterministic `consult-<upload UUID>.blob` files: fsync, atomic rename, directory fsync,
  then one caller transaction for files/classification/upload/media/event/receipt.
  The acknowledgment follows COMMIT. Retry after rename + DB rollback checks normalized
  bytes and finishes the same transaction; committed retries return the original IDs.
  `cleanupConsultUploads(client,root)` deletes expired DB parts and recognizable,
  unreferenced disk orphans older than 48 hours under a shared advisory lock.
- Restricted media reads recheck assignment and photo permission before bytes,
  thumbnails and Range processing. In-process owner-only `readConsultPhotoForExport`
  checks Complete, current upload generation, photo kind, current permission, tombstones,
  storage hash and normalized bytes. It returns the v1 export bridge shape with no URL.
- `consultScopeFacts(run,projectId,scopeKey)` in `findings.ts` returns strict v1 facts.
  Repeated disjoint numeric sf/lf/ea contributions aggregate at four decimals, with sorted
  instance IDs and source revisions. Nonadditive inches stay individual evidence.
  Sibling arithmetic derived fields use the bounded formula grammar; missing inputs do
  not become zero. Duplicate ownership within one instance makes an explicit conflict.
  Two-room/four-revision DB tests reach `reviewed` through staff-only Complete.
- Reconciliation requires the current Complete generation. It locks project, consult,
  scope keys and pinned site plan; application receipts dedupe generation retries.
  Other-source/ambiguous quantities and sent/signed formal estimates stay proposals.
  Accepted quantities create auditable findings/contribution manifests and recompute a
  draft formal estimate through the existing estimator. Dedicated prices are retained;
  one stable pricing to-do is created. Unknown mapped scopes create “No scope item —
  add one?” findings, never scope rows. Exact plan matching requires item ID plus pinned
  plan revision, measurement kind, scope, unit, quantity label and `consult_target`.
  Reopen retracts owned quantities/findings and reopens only their exact plan items;
  other-source quantities survive. No stage advancement or review task exists.
- Readiness calls the shared v1 export and adds/persists the six consult gap codes.
  `tests/fixtures/consult-scope-facts/v1.json` is shared by export and readiness tests.
- Ten MCP tools in `mcp/consult-tools.mjs` use strict input schemas and the authenticated
  internal consult bridge. Agent values always enter `consult_agent_proposals`, never
  accepted answers. A person uses/rejects a proposal through the capture command.
  Run authentication time is preserved for session revocation. Mutation receipts bind
  operation UUID + payload and are returned only after commit. Raw narrow access to
  proposals, upload staging, contribution manifests and bridge receipts is withheld.

### Exact additional UI API

All new mutations use cookie auth, same Origin, `X-Consult-CSRF: 1`, and no-store results.
These are real server routes; no browser/offline uploader is supplied here.

| Route / command | Request → response |
|---|---|
| `POST /api/consult/{id}/uploads` | `{event_id,device_id,device_epoch,kind:'photo'|'initials',mime:'image/jpeg'|'image/png'|'image/webp',size,sha256,instance_id,field_key?,shot_key?}` → `{upload_id,part_bytes:1048576,expires_at,received_parts:[{n,sha256}],status,receipt}` |
| `PUT /api/consult/{id}/uploads/{upload}/parts/{n}` | zero-based part; raw bytes with `X-Part-SHA256` → `{n,sha256}`; exact retry no-op, changed bytes/hash rejected |
| `GET /api/consult/{id}/uploads/{upload}` | same status shape; actor/device only |
| `POST /api/consult/{id}/uploads/{upload}/commit` | `{event_id,sha256}` → stable `{file_id,media_id}` after COMMIT; manifest uses the original upload hash, stored normalized file has its own SHA256 |
| `GET /api/consult/{id}/media/{file_id}` | authenticated bytes; optional `?w=` uses 160/320/640/1280 ladder; single explicit byte Range supported; private/no-store, no signed URL |
| existing consult POST `command:'apply_findings'` | `input:{expected_generation,operation_id}` → `{generation,results:[{scope_key,label,status,finding_id?,plan_item_ids?,reason?}]}`; a proposed result changes no quantity |
| existing snapshot GET | additionally `proposals:[{id,instance_id,field_key,base_revision,answer,source_note,generation}]` |
| existing consult POST `command:'proposal_decision'` | `input:{proposal_id,action:'use'|'reject',op?:ConsultOp}`; Use supplies the next durable queued answer op with exact proposal address/payload/base revision; accepted receipt → `{status:'used'}`; rejected/conflicting answer returns normal per-op receipts; Reject → `{status:'rejected'}` |

For exact plan measurement matching, the pinned plan item's JSON must contain
`quantity_label` and `consult_target:{instance_id,field_key}`. This continuation adds
no first-kind/first-unit fallback and no UI for authoring these bindings.

### Remaining work / limits (do not conceal)

- Browser offline engine + service worker is the next UI/integration slice: durable
  encrypted blobs, readiness, leases, PIN/key lifecycle, cold offline reload, takeover,
  quarantine/recovery, uploader drain and progress. No browser or server was run.
- Auto apply currently executes in the close transaction inside a savepoint, gated by
  `consult_auto_apply_findings`; a failure leaves Complete intact and creates one repair
  to-do. **It is not the required durable, fenced worker job with retry/backoff.** Wire
  that before calling item 6 fully done. Cleanup is callable but has no daily scheduler.
- Full §10.5 semantics need more work: aggregate across several consult sources,
  template-level/cross-module formulas, explicit basement/room ownership, complete
  photo/flag/decision/new-work finding application, correction supersession beyond
  Reopen retraction, all scope-readiness projection sources, and locked-target decisions.
  New-work origin capture still needs a typed capture contract; no string is guessed.
- MCP: no instance-proposal creation in `record_consult_answers`; nonowner scheduling
  currently refuses rather than stages Joe's request; schedule notes are not persisted.
  Form proposal note is not persisted. Shared coverage/transcript/design tools are not
  Phase 1 tools here. Procedure-specific tool allowlists have not been expanded.
- Safety/coverage gaps still need tests: actual HTTP signature/thumbnail/Range requests,
  HEIC conversion, explicit request rate caps, partial-part expiry cleanup and permission
  withdrawal after external export. Existing original-photo attachment paths are closed,
  but the shared fixture's full DB reproduction (flags/exclusions/new work) is unfinished.
- Parallel seed builder owns seed files and their tests. During development, five missing
  `maps_to` properties in its `templates.ts` prevented a clean full-worktree tsc. The
  parallel builder corrected them; final full-worktree locked tsc exits 0. This
  continuation did not edit or commit seed paths.

### Validation

Single-file tests pass: consult-access-db (3), consult-findings-db (2),
consult-scope-facts-db (1), consult-mcp (2), estimating-readiness-consult (1),
consult-sync-db (2), consult-todos-db (1), consult-length (3), consult-forms (5),
consult-completeness (5), consult-queue (4), consult-offline (2), consult-readiness (2),
consult-scope-facts (2), estimating-db (9), db-roles-manifest-db (6),
db-roles-paths-db (2). Initial development failures were corrected; a stale disposable
migration ledger was discarded and regressions were rerun on a new consult cluster.
`db-roles-scan --diff` exits 0, with only documented withheld permissions.
Final locked/niced tsc exits 0; earlier seed errors were corrected by its builder.
No push, deployment, live/QA connection, browser, Next command or service operation.
Disposable consult cluster stopped before handback.
