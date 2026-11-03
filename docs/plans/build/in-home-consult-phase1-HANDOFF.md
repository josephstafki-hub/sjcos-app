# Phase 1 consult backend and offline integration — 0079

This is the authoritative handoff for `t3/in-home-consult-backend`. It replaces
previous continuation notes. Capture, publication, uploads, findings jobs,
reconciliation, maintenance, offline modules and the service-worker protocol are
implemented. The consultation UI was subsequently supplied in `ee7ad0d4`; see the
backend/UI completion addendum below for the current integration contract. No deployment, push, browser, Next build, live DB
or QA connection was performed.


## Backend/UI completion addendum — 2026-11-02

This supersedes the six outstanding backend asks in the UI builder's notes. No schema
migration or additional narrow-login privileges are needed: visitor notes and partial
human decisions use the existing immutable `consult_events` log and sync receipts.

- Reviewed `e4fd171a`: kept its exact-instance/field committed signature check. Also
  restricted check 5 to live `closing.client_initials`; Renovate Right initials never
  substitute for the walk-through acknowledgment. Uploads set the acknowledgment
  pointer only for that closing field.
- `prepare_device` now serializes reservation and returns `last_ack_seq`. A fresh
  build/login partition starts `next_seq = last_ack_seq + 1`. Existing pending work
  stays in its original partition; an unlocked, fully synced partition can move to
  the current build/session through Get ready. Tests cover both new builds and logins.
- Close accepts `initials_hashes: string[]`. Legacy `initials_hash` remains supported;
  all listed initials must be committed initials and every live committed image must
  be included. The UI captures walk-through and pamphlet initials separately and sends
  all hashes. Snapshots restore committed media receipts for fresh partitions.
- `schedule` accepts optional `visitor_notes` (trimmed, at most 8,000 characters).
  The assigned snapshot returns them, `display` (client, address, phone, visitor), and
  `prefill`: year built from intake, intake answers, rough line labels (values only for
  owner/`estimates`), scope quantities, open pinned/latest plan items, lead-photo
  references, discovery activity and filed call summaries. All reads follow successful
  assignment authorization. No transcript, recording, storage path, supplier price,
  dedicated price or arbitrary rough-line properties are returned. Reads refresh
  source facts; unconfirmed prefill never counts toward completion.
- New sync op `decisions`, target `null`, payload `EvidenceDraft` (exported server
  `decisionSchema`): flag decisions, trade walks, RRP answers, photo skips and decline
  reason. Partial drafts may retain an undecided trade, empty flag explanation or
  incomplete redelivery date; final `evidenceSchema` still strictly validates Close.
  It receives the normal sequence/hash/generation/device checks, immutable event and
  idempotent per-op receipt, increments revision, and invalidates close acknowledgments.
  Snapshot `decisions` restores the latest current-generation draft. It does not claim
  any close check passed. UI Save waits for local durable capture before dismissing;
  failures remain visible as data. Capture/media/replay writes are serialized.
- Removed the injected page-display response and the single-initials/next-answer-save
  workarounds. Existing screens receive the server fields, expose visitor notes and
  What we know so far, and route the pamphlet field through the guarded client view.

Final validation: 108/108 tests across 22 single-file runs (`consult-*`,
`estimating-db`, both `db-roles-*`), zero failures/skips; shared-lock/niced tsc
exit 0; role-scan diff and whitespace checks exit 0. Consult harness cluster stopped. Coordinator visual checks still needed:
Schedule notes; prefill/Still right/Correct; both guarded client initials views; a cold
reload after decision-only saves; Get ready after a new build/login; Close with both
images. No Next build/start/dev, browser, live/QA DB, deployment or push was run.

## UI integration order

1. Build the consult client UI into `public/consult/assets/capture.js`, with every
   import, stylesheet, font, keypad and renderer dependency under that directory.
   Mount on `#consult-root` in `public/consult/offline.html`; this shell must stay
   data-free. In-tool navigation is local state, never an offline RSC fetch.
2. Run `node scripts/consult-precache.mjs` after bundling. It generates
   `public/consult/precache.json` with content hashes and a content-derived build ID.
   It deliberately refuses an absent capture bundle. No placeholder renderer is
   shipped or counted as ready. Supply that build ID in `OfflineIdentity.build`.
3. Call `registerConsultWorker(enabled)` from a client. Registration uses `/sw.js`,
   scope `/consult/`, updateViaCache `none`. Await an active worker. Redirect and
   no-cache script/API headers are installed in `next.config.ts`; `proxy.ts`
   preserves the scoped trailing slash and allows only the data-free static shell
   assets through without cookies.
4. Open `ConsultOfflineStore`, then call `getReady()` with the current identity,
   stable device UUID, PIN, manifest, active worker, storage manager, byte budget,
   and `onCheck`. It runs snapshot → checksum-pinned forms → verified precache →
   actual IDB probe/capacity → online device reservation + signed lease + PIN
   enrollment + durable local snapshot. Result is `{ok:true,engine,capacity,
   expires_at}` or `{ok:false,code,check}`. Optional mic stays Notes off.
5. The session epoch is the authenticated session time in whole seconds, as returned
   by the signed lease payload. User/build/consult must match the authenticated
   bootstrap. Do not substitute another user's identity or a current clock value.
6. Cold offline reload uses `OfflineVault.unlock(identity,device,pin)` followed by
   `OfflineEngine.unlockSigned(key,signed,device,issuer)`. No unlocked global
   singleton, plaintext localStorage, or shared last snapshot. Never import the
   server signer in a client. Only local CryptoKeys and ciphertext are persisted.
7. Offline Start is an ordinary durable `type:'start', target:null, payload:{}` op,
   based on the prepared consult revision. It precedes instance/answer operations.
   Get ready reserves the device without changing scheduled to in_progress.

## Browser modules and states

| Import | Final API / UI obligation |
|---|---|
| `offline.ts` | `ConsultOfflineStore.open/load/save/preflight/keyRecord/saveBlob/loadBlob/deleteBlob/blobHashes/clearPartition/close`; encrypted IDB v2, identity/build partitions, revision CAS, transaction acknowledgment. Never call clearPartition on logout with pending work. |
| `offline-vault.ts` | `OfflineVault.enroll/renew/unlock/recover`. Nonextractable device AES key + PBKDF2 PIN envelope, issuer pinning, persisted PIN backoff. Renew cannot replace issuer. Recover requires an owner-issued recovery-purpose lease and original PIN/device. |
| `offline-engine.ts` | `OfflineEngine.unlockSigned/read/prepare/capture/captureBlob/replay/epochs/resumeAuthorized/lock/logout/recoveryManifest/orphanHashes/evictSyncedBlobs`. Read returns a clone. Expiry blocks all reads/capture. Revocation quarantines and locks. Logout clears decrypted references, retains ciphertext. |
| `queue.ts` | Stable event IDs, canonical payload hash, sequence, bounded batches, conflict/rejection states, 2–60s backoff. `closeManifest` is local evidence only; server acknowledgment decides Complete. `426` blocks the entire queue without changing original ops. |
| `get-ready.ts` | Ordered readiness coordinator; existing pending partition wins over newly downloaded data. Reauthentication only resumes signed-out operations after a successful authorized online bootstrap. Revoked partitions require owner recovery. |
| `service-worker.ts` | `registerConsultWorker`, `prepareConsultShell`, `verifyConsultShell`, `activateConsultUpdate`, `workerMessage`. Failed checks never imply offline readiness. Activation requires zero pending work or explicit safe migration. |
| `length.ts` | `parseLength/parseLengthPair/formatLength`; interpretation must be shown before save. Save tick/haptic only after `capture`/`captureBlob` resolves. |
| `client-summary.ts` | `clientSummary` allowlist and `handBackAllowed`; UI unmounts all visitor information and cancels hold on release. |
| `copy.ts`, `readiness.ts`, `completeness.ts` | Approved wording, ordered check labels, eleven completion checks and tier totals. Server supplies trusted completeness. |

`LocalVisit` is `{queue,snapshot,blobs,last_send}`. Each blob metadata record has
`hash,event_id,mime,kind,instance_id,field_key?,shot_key?,receipt?`. Blob bytes are
separately AES-GCM encrypted, hash verified before persistence, never JSON arrays in
the whole visit. Save blob bytes before metadata: a crash between commits leaves a
recoverable encrypted orphan; `orphanHashes()` lists it for explicit classification.
Never guess its room/shot. `evictSyncedBlobs()` removes only bytes with a committed
server receipt and no pending same-hash reference. Call before retrying after quota;
never evict pending media. On a storage failure, keep the prior durable state and
stop capture until the visitor resolves it.

`replay()` is one drain per engine. Construct one engine per device/visit in the UI;
IDB CAS also detects competing tabs. It calls the actual command API, preserves IDs
on transport loss, processes per-op receipts, then resumes bounded multipart uploads
and deterministic commit. Calling it again retries the same logical event, including
acknowledgment loss after upload commit. UI schedules retries using queue next_at;
there is no autonomous background timer or service-worker mutation replay.

`epochs(generation,device_epoch,deletion_epoch)` handles a fresh authorized server
snapshot: stale snapshots fail, greater deletion epochs tombstone and clear visible
content, generation/device changes require conscious rebase. Current server reads
use fresh snapshots rather than incremental cursors; no cursor endpoint is promised.
The app's removed-instance/media records are the authoritative tombstones.

## Service worker lifecycle

Only `/consult/offline.html` and explicit `/consult/assets/*` hashes can enter
CacheStorage. API, RSC, sign-in redirects and authenticated HTML never enter it.
Online navigation passes through; disconnected navigation uses a complete verified
shell. A missing asset/checksum/renderer refuses Ready. Old caches are retained;
when several builds coexist, use `?consult_build=<build>` in the visit URL so cold
navigation selects the correct build. One cache needs no selector.

On build mismatch show “Update ready — reload between rooms”. Never drop or
translate a queued old-build op. `activateConsultUpdate(registration,pending,
safelyMigrated)` refuses unsafe activation. On a live kill-switch update call
`registerConsultWorker(false)`: it sends STOP_CACHE to controlling/active/waiting
workers, disables caching, removes shell caches, unregisters, and preserves all IDB
notes for online recovery. UI must stop capture immediately on that flag/result.

## Screen map (§5–§7)

| Screen/state | Integration |
|---|---|
| Entry/list/loading/empty | GET list; show assigned visits, approved copy. |
| Schedule | Owner schedule command; pin all template modules and nested templates; no stage advancement. |
| Get ready / Not ready / No signal / Ready | `getReady`, `onCheck`; no prior preparation → approved open-once/paper copy. |
| Door scripts / Start | Pinned opening or opening_staff; queue Start. Consent/manual flow is Phase 1; Notes off. |
| Phone/tablet fields, repeats, parents, keypad, laser, Same as last | Pinned field types, parser, `capture`, logical `{instance_id,field_key}`; parent_module and presets are in pins. |
| Skip / assumptions / return / trade walks | Queue skipped answer plus evidenceSchema; no section-wide skip. Future dated tasks stay snoozed. |
| Prefill / Still right / Correct | Explicit answer confirmation; unconfirmed values do not count. |
| Photos/initials / saved/uploading/uploaded/retake | `captureBlob`, local metadata/receipt, `replay`, restricted media GET; no generic file URL. |
| Status / Send now / expanded sheet | Queue states + last_send + blob receipts; Save is durable local, Uploaded is committed server; Sun mode UI preference. |
| Leaving section / Back | Completion item navigation; UI owns Back handling. |
| Show to client / recap / initials / hand back | Allowlisted summary and hold/PIN; initials are acknowledgment only. |
| Before wrap / open/partly/flags/conflicts | Trusted completeness, evidence mutation and conflict picker. |
| Close / closed-sending / Complete / Needs finishing | Exact close manifest, all op/blob receipts, server Complete acknowledgment. |
| Interrupted / forgot Close / cut short | Durable state, retry drain, maintenance finish task; no idle completion. |
| Conflict picker / Reopen | Explicit resolve with both IDs/reason; fresh generation and conscious rebase. |
| Optional desktop look-over / findings applied/failed/retry | Same snapshot, restricted media, findings_job and apply_findings; no review button/to-do. |
| Forms list / pinned preview | Published immutable definitions and validation; visual editor is Phase 1.5. |
| Owner recovery / locked device | recovery_lease → original PIN/device unlock → recover_device; stage proposals, never impersonate original author. |
| Transcript/chips/sketch/helpers | Not Phase 1; do not enable from copy/type availability. |

## New server commands

All use POST `/api/consult/{id}` with `{command,input}`, cookie auth, same Origin,
`X-Consult-CSRF: 1`, JSON, no-store. Expected failures are JSON data at the HTTP
boundary; internal transaction functions throw to roll back. No Server Actions were
introduced. Device reservation returns `{ok:false,code}` for expected conflicts.

| command | input → result |
|---|---|
| prepare_device | `{device,expected_revision}` → `{ok:true,epoch,last_ack_seq,revision,generation}` or `{ok:false,code}`; single active device, does not start visit |
| offline_lease | `{device,build}` → `{payload,signature,public_key}`; Ed25519 24h lease bound to authenticated user/session/consult/device/build; disabled capture refuses issuance |
| recovery_lease | Owner only `{original_user,session_epoch,device,epoch,build,reason}` → same signed envelope with purpose recovery, 15-minute expiry; verifies historical device ownership and audits owner |
| recover_device | Owner only `{operation_id,original_user,device,epoch,reason,ops,blobs?}` (≤50 ops) → `{ok:true,staged:true}`; verifies original hashes/address, preserves full manifest audit, stages answer/clear proposals under original actor, revokes old device; non-answer operations stay in audit for explicit human reconstruction |

Recovery never updates accepted heads or automatically rebases generations. Current
form/value validation still runs when a person chooses Use through proposal_decision.
After recovery use owner assignment and fresh device preparation; never reuse old
sequence/author as the new capture device. Recovery retains optional original blob metadata in the audit. Vault.recover returns
`{saved,readBlob(hash)}`; the owner explicitly classifies/re-enters recovered media on
the new device rather than automatically sending it as the old author.
Original key/PIN is required; server
signing keys cannot decrypt local notes.

## Forms, formulas and fresh-install publication

`form-types.ts` and `forms/validate.ts` support parent_module, context_module,
per-template module presets, derive_cases, multiple flags, instance_reference,
pCi/L, and opening_staff/closing_staff. Instance references must name a live row of
the same consult. Derived/context values cannot be submitted as typed answers.
The server synthesizes the hidden visit context from pinned templates/add-ons;
whole-home includes every explicitly pinned nested area template. Never show it.

`forms/formula.ts` parses bounded ASTs: arithmetic, field.w/field.h, sqrt, ceil,
abs, min/max, numeric comparisons and lazy `condition ? yes : no`. It never executes
JavaScript. `derive.ts` evaluates additive repeat-module terms per live instance
before summing (never product of sums), length pairs as square-inch area, false
conditional applicability as zero, applicable missing/skipped inputs as gaps.
Conditions across repeat rows mean any live row matches. Both provenance and
pinned conditional cases survive publication. The unchanged seed fidelity tests
remain the authority for the plan's content; old derivation-case tables are retained
where replacing them would change those expectations.

Migration 0079 preserves the latest new-work validation and adds instance-reference
and prepared-device Start support. No new table or narrow-role write privilege.
`db/migrate.mjs` invokes `db/seed-consult.mjs` once after applying 0079, staging all
seed drafts then calling real `protocol.publish` (typed validation → checksum
attestation → SQL publish) for every module/template/add-on. It does not overwrite
Joe's published edits. A truly empty DB has no owner to author forms: after initial
owner provisioning run the explicit-URL companion `scripts/seed-consult.mjs`.
The seed publication test checks every DB checksum and real scheduling/pinning.

## Existing capture HTTP API

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
| schedule | `{project,visit_time,visitor,forms:UUID[],plan?:UUID|null,plan_revision?:number|null,visitor_notes?:string}`; offset ISO timestamp; all pins published, every template module pinned | `{id}` + scheduled-visit task |
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
- `start`: target `null`, payload `{}`, base consult revision; only a prepared device on a scheduled visit.
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


## Uploads and proposals

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


## Findings, reconciliation and maintenance

`apply_findings` takes `{expected_generation,operation_id}` and returns
`{ok:true,generation,status,result}` or `{ok:false,code}`. It enqueues the same
`(consult_id,generation)` job used by auto-apply on Complete; the historical
synchronous apply result described above is now persisted in findings_job.result.
Snapshot includes findings_job generation/status/attempts/available_at/lease_until/
last_error/result. UI shows approved failure copy and retries the same generation.

`lib/worker/consult.ts` uses two-minute UUID-fenced claims, atomic effects and final
ack, exponential 30s–1h retry and one repair task after five failures. Reopen obsoletes
pending jobs and retracts owned evidence; cancellation is owner-only. Scope facts
aggregate disjoint quantities across instances/visits with immutable provenance;
correction/removal/Reopen rebuild surviving contributions. Sent/signed estimates,
manual evidence and dedicated prices are preserved. Plan matching uses exact pinned
IDs/revisions/targets. Explicit new-work origins, flags, exclusions, permits, RRP,
trade walks and required readiness gaps are exported through the strict v1 schema.

`deploy/sjcos-consult.timer`/`.service` and `scripts/consult-tick.mjs` call the cron
route with CRON_SECRET, max ten findings jobs plus upload expiry/orphan and forgotten
visit/return maintenance. Timer installation remains a deployment action, not done.
No stage promotion, review task or client-facing send is part of this backend.

## Validation and deployment boundary

Tests run one file at a time with the consult-tagged disposable DB harness. Browser
APIs use a small async transactional IDB adapter and VM worker fakes; actual browser
verification is intentionally left to the coordinator under shared-server rules.
Typecheck uses the shared flock and nice. Final validation: 99 passing cases across the 21 single-file regression/seed/offline
files, including the original 64, unchanged seed 12/12, offline 17/17, queue
5/5, formula 3/3, offline DB 3/3 and real seed publication 1/1. Shared-lock tsc
exits 0; role scan and diff whitespace checks exit 0. The consult cluster is stopped.

Remaining coordinator integration: build the existing UI capture bundle and generate
its precache manifest; perform visual/device checks, install timer and deploy when authorized.
No claim of an end-to-end working offline UI is made by this backend handoff.
