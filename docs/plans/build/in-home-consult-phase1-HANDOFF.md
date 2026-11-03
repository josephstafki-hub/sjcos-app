# In-home consultation backend handoff — PARTIAL, not ready for UI integration

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

## Remaining backend work (required, not an approved scope reduction)

1. **0075 migration — PARTIAL, not done**: Phase 1 storage entities, relational
   pins, composite FKs, append-only answers/events/receipts, published-byte immutability,
   single visitor/device constraints, default-off flags and command-only manifest entries
   are implemented. Signed HMAC claims are independent of 0074 and have no UUID/GUC
   fallback. Remaining: complete publication validation parity (registered mappings,
   formula/coverage/compound validation), full operation-batch protocol and nonce/receipt
   binding, agent proposals, assignment management, human conflict resolution, trusted
   close/reducer transitions, upload commands, reconciliation job projections, complete
   protected-field/membership guard coverage and schema mirror strategy. The SQL subset
   below is tested, but does not fulfill all of item 1. Do not deploy as a complete backend.
2. **Executable seed — NOT done**: `forms/seed.ts` and its migration companion are still
   absent. Every approved row, compound subfield, template, add-on, shot, MN flag, script,
   formula and versioned mapping registry must still be translated into executable data.
   Compound AST/compiler is implemented and integrated with form validation/completeness;
   this does not replace the seed or full-seed fidelity tests. No external blocker or
   new approval requirement was established.
3. **Server integration**: fresh DAL/assignment/device authorization on all routes and
   MCP commands, CSRF and Origin checks, ops transaction/receipt/revision/conflict handling,
   close manifests, completion lock/Reopen, enrollment and to-dos with Central due dates.
4. **Files**: classification before generic signed/session readers/listings/thumbnails/
   Range/signing/upload paths; photo permission at init and commit; bounded safe uploads,
   deterministic file transaction, crash/rename retry and orphan cleanup.
5. **Offline**: IDB browser validation, durable encrypted blob store, device/PIN key and
   signed lease handling, lock/quarantine/takeover, capacity estimate, asset manifest,
   data-free shell, service worker `/consult/`, kill/update lifecycle and recovery.
6. **Office outputs**: `findings.ts` reconciler and `consultScopeFacts()`, v1 shared DB
   fixture, exact site-plan mapping, aggregation/supersession/retraction, sent/signed locks,
   readiness and work-item integration, no review or stage advancement.
7. **Tests still absent**: consult-sync-db, consult-findings-db, consult-todos-db,
   full seed coverage and end-to-end offline/upload tests. `consult-access-db` now tests
   real SQL signed access, raw narrow SELECT/INSERT/UPDATE denial, assignment/revocation,
   immutable publication, answer receipts/conflicts, Complete lock and Reopen. It does
   not establish full authorization/command coverage for the unfinished protocol.

Audio, AI and the shared transcript remain out of this task's Phase 1 scope by design;
React screens remain the next UI builder's work. The other omissions above are unfinished
implementation. No technical/external blocker was established, and no approval is needed
to continue the authorized work.

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
