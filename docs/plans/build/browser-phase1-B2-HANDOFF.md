# Browser Phase 1 B2 — website routes / live transport

Dark integration, **not an activation candidate**. Identify this owned implementation
commit with `git log -1 --format=%H -- docs/plans/build/browser-phase1-B2-HANDOFF.md`.
Baseline was `19a024f9` on `t3/browser-phase1`. No push or subagents. A2a/A2b/C2
worked concurrently; none of their files were edited/staged by B2.

## Item → change

1. **Prepared-answer SQL** uses canonical `ai_messages.body` and checks the owned,
   undeleted conversation + user-role message. The production adapter and real
   harness-schema regression share `PREPARED_ANSWER_SOURCE_SQL`; the test executes
   it, inserts a real body value, and proves a different owner cannot read it.
   The disposable fixture explicitly establishes the existing Ask recovery fence.
2. **Task classification** ignores proposal `task_kind` for areas/admission. An
   installation-owned `websiteHooks.classifyTask` returns kind + catalog version;
   B verifies that version in `browser_release_catalog`, derives areas, and checks
   record/thread associations before facts/manifests. No classifier installed →
   `BROWSER_SERVICE_UNAVAILABLE`. A spoofed public_research proposal cannot avoid
   permit/compliance rights. This is a trusted hook, not a new arbitrary HTTP field.
3. **Public sockets / signatures** remain exactly `/run/sjcos-browser/control.sock`
   and `/run/sjcos-browser/frames.sock`, protected root-owned filesystem paths.
   B requires response `{command_id,boot_id,sequence,result,signature}` and HMAC
   over canonical unsigned response with the independent response key. Missing,
   wrong signature/key/command/boot/sequence, expired and extra-field responses
   refuse. Successful A handler results may omit `ok`; signed `ok:false` preserves
   only catalog error codes. Three controller keys must each be exactly 32 bytes
   and distinct. The frame handshake uses A's exact v1 purpose/binding/nonce/time
   fields and canonical request-key HMAC. Binary frames use the independent
   `browser-phase1-frame\0` HMAC, exact length/digest/binding, and increasing
   connection-local sequence. Tests use A's actual RPC signer and binary encoder.
4. **32 KiB and paging**: both outgoing metadata and incoming framed replies cap
   JSON at 32768 bytes, including the signed response envelope. No frame bytes
   enter metadata RPC. B imports A2a's landed `PageRequest` / `MetadataPage` shapes.
   `UnixWebController.pages(method,binding,nextPayload)` collects read_manifest /
   read_review / read_answers / read_in_use pages, requesting a fresh persisted
   proof from `nextPayload` on every page. It refuses mixed revisions, malformed,
   oversized/repeated cursors, empty continuation, oversized pages and overflow;
   no partial assembly is returned. The integration test drives it with A's real
   `pageMetadata`. Routes expose pages below with signed, session/person/task/
   collection/dataset-bound cursors; changed revision/data → REVIEW_STALE.
5. **C route requests**:
   - Authenticated planned stream-close POST below stops local delivery BEFORE
     remote binary EOF can race an accidental onClose. Only a signed remote ACK
     succeeds; failed/lost ACK attempts an accidental-close fence. Plain GET
     cancel/abort remains accidental. Queries cannot assert planning. Rotation
     remains planned. Close/unsubscribe is once-only.
   - Presence rereads committed task/viewer after `browserWebPresence`; returns
     actual persisted `control_expires_at`, current epoch/generation and server
     time. Holder sid/device/viewer epoch must match. It never invents a lease.
     A2a's newly landed SQL renews the task lease under those checks.
   - GET detail/join/control/start have safe typed reason/controller/watch/name/
     window/deadline projections, actual queue rank/expiry/offer status and
     permitted public resume/private pause choices. Private resume/give_back
     remain refused. Terminal GET detail needs no viewer join.
   - Tasks return real content-free PaneSnapshots with nullable real run IDs;
     start rereads the task after queue/admission and reports queued/attached/
     unavailable, never the stale pre-queue run. Optional A2a-compatible start hook
     must return the same attached run now in SQL. Unavailable start has an
     explicit `start_code`; no fabricated run or ordinary Ask admission fallback.
   - Read GET parses the entire stored ReadManifestV1, projecting `.entries`.
     A2a pending `{v:1,candidates}` rows project exact candidates, original deadline,
     revision and pending/expired/denied status. Empty/unknown storage refuses.
     Deny uses a historical complete manifest solely to satisfy the typed ignored
     SQL proposal slot; it never reauthorizes that old manifest.
   - Fresh requires drained/fenced old-generation/new-boot metadata and checks the
     committed response generation is exactly old+1 and boot matches the ACK.
     Control deadlines come from SQL. Pause requires an explicit fenced ACK.
   - Verified frames record `last_frame_uuid/control_epoch` only under matching
     current task/session/stream/boot/generation/epochs/consent before presentation.
     Private frame delivery rechecks current authority. Binary EOF/error/timeout
     closes presentation, and explicit unsubscribe suppresses duplicate errors.
6. **D integration** calls frozen `validateReadProposal` and `publishReadManifest`.
   Publication delegates to `browserWebReads` in the same transaction as the web
   proof and resolves after COMMIT. Initial admission uses D's signed manifest
   builder after validation. Only trusted `websiteHooks.confirmedFacts(task)` is
   accepted; client values/provenance/classification are never used as proof.
   Initial draft facts receive checked record locators + authoritative kind/areas,
   so a project/lead's known private values cannot be omitted by dropping its ID.
   Missing facts/classifier still refuses READ_PROVENANCE_UNKNOWN. Actual outbound
   `classifyRequest` stays in D/A's gate; B dispatches no website HTTP requests.
7. **web-types** now exposes paging, snapshots, queue/projection, reads/answers,
   start/control/presence/stream-close and every create/join/presence/answers/
   settings request type consumed by C2. Request mirrors are type-only imports;
   no Node/server code reaches clients. Existing frozen errors/events are unchanged.

## C2 route / type contract

All paths are under `/api/agent-browser`; existing cookie/uncached authority,
record/area checks, CSRF and viewer/device/owner-claim headers still apply.

- GET tasks (conversation_id required), in-use, task reads, task answers accept
  only optional `cursor` (opaque <=256 UTF-8 bytes) and `limit` (integer 1..20,
  default20). Duplicate/unknown queries refuse. Pages are
  `{items,next_cursor:null|string,revision}`. Tasks items are `{task,snapshot}`;
  reads items are `{kind:'entry',entry}` / `{kind:'candidate',candidate}`; answers
  items are ConfirmedAnswer. Legacy tasks/snapshots/entries/candidates/answers
  aliases contain that page only; C2 assembles every page before publication.
- POST `/sessions/:id/stream-close`: body
  `{viewer_id,device_secret,stream_id,stream_generation,idempotency_key}`. Await
  success `{closed:true,planned:true,stream_id,stream_generation}` before treating
  a hidden view as planned. Missing/mismatched active stream → STREAM_STALE.
- Presence returns `{present_until,control_expires_at:null|ISO,control_epoch,
  context_generation,server_time}`. Renew only an existing matching token.
- BrowserStatus includes queue_position/queue_expires_at/offer_expires_at and
  offer_status `offered|expired|waiting|queue_expired|none`. An old accepted offer
  never relabels an active/paused task as missed.
- BrowserProjection has projection_status `available|unavailable`, state_reason,
  reason_code, idle_closes_at, controller, window_count, watching_owner,
  owner_label. Only fixed enum reasons/codes, validated deadlines/counts and trusted
  labels are projected; arbitrary service/page fields are dropped. Unavailable
  projection uses nulls, controller unknown and no invented explanation.
- BrowserStart adds run_id, run_attachment `attached|queued|unavailable`, start_code
  `BROWSER_SERVICE_UNAVAILABLE|null`. BrowserControl includes context_generation
  and authoritative optional token/expiry. BrowserJoin includes the full detail.
- BrowserReads adds candidates_status `pending|expired|denied|none|unavailable`.
  Approval is only for actual pending, unexpired, exact reviewed candidates.

Exports include Task/TaskDraft/TaskUI/TaskMetadata, ReviewNotice,
OwnerBrowserReviewClaim, ManualInput/ControlMessage/Frame, frozen BrowserError /
BrowserEvents, PageRequest/MetadataPage<T>, ReadEntry/ReadCandidate/ReadProposal /
ConfirmedAnswer, BrowserSnapshot/Projection/Queue/Status/Join/Start/Control/
Presence/StreamClose/Tasks/Reads/Answers/Availability/Settings/InUse/Review,
BrowserCreateRequest/JoinRequest/PresenceRequest/AnswersRequest/SettingsRequest,
BrowserTaskResult, BrowserResponse<T>, BROWSER_API and BROWSER_HEADERS.

## Remaining fail-closed installation hooks / A requests

`requireBrowserWebRequest` deliberately does NOT synthesize these dependencies.
Production currently constructs `createWebsiteAdapter` without `websiteHooks`:

```ts
websiteHooks = {
 classifyTask({conversation_id,project_id,lead_slug,user_id})
   // -> {task_kind:'public_research'|'permit'|'invoice'|'purchase',catalog_version}
 confirmedFacts(task)
   // -> {values:string[],classifyPublicUrl(url,{role,source}):boolean}
 start({task,viewer,session,idempotency_key}) // -> {run_id}
 projection({task,viewer,session}) // -> validated BrowserProjection fields
}
```

- A2a's `confirmedFactsFromCatalog({values,publicUrls})` is suitable for the facts
  hook, and `createWebsiteStart(...)` has the exact start callback shape. The
  protected catalog data source, classifier, held runner/supervisor installation
  dependencies and web bootstrap hookup are still missing. Neither proposal
  labels nor empty facts/public-by-default adapters may substitute. Missing
  classification → SERVICE_UNAVAILABLE; missing facts → READ_PROVENANCE_UNKNOWN;
  starting without launch hook → run_attachment unavailable + explicit start_code.
- No default rich service reason/controller/window/owner-label source is installed.
  B returns projection_status unavailable rather than inferring owner/idle/turn
  reasons. Inject the trusted A2a installation projection when it exists.
- A2a's present pause handler calls service.pause but returns only drained and
  context_generation. B needs `proof_metadata.fenced:true` plus the committed
  current `control_epoch` after that durable pause. Until supplied, pause refuses
  REVIEW_PENDING. Owner pause versus another current holder must also remain
  subject to A's SQL/control policy; B has no owner bypass.
- A must keep its runtime task/control epochs synchronized after website commits,
  supply real consumeProof/authorizeWeb/stream handlers and current boot admission,
  and integrate durable candidate staging with D's trusted classifier. B projects
  existing candidate rows; it adds no discovery/automatic replay route.
- No SQL/migration request is needed for B's implemented queries. A/coordinator
  must refresh private-query census / runtime source inventories for changed
  web.ts + new web-transport SQL constant. B did not edit those owned inventories.

## Verification

26 adversarial B2 expectations were authored before implementation, followed by
4 integration checks: **30 fresh cases**. They cover actual A/B signing/encoding/
paging compatibility; unsigned/wrong-key/replayed/wrong-boot responses; 32768-byte
ceiling; cursor tampering/cross-session reuse/revision drift/loops/UTF-8 bounds;
task-kind area spoof; real body-column SQL; absent facts; candidate deadlines;
projection stripping; private resume denial; planned-close failure race; signed
frame replay/wrong boot; close/unsubscribe once-only. No socket server was started.

Each file ran individually with `SJC_TEST_CLUSTER_TAG=browser-p1-b2-1107q`:

| File | Passed | Failed / skipped | Exit |
|---|---:|---:|---:|
| tests/browser-routes.test.mjs | 41 | 0 / 0 | 0 |
| tests/browser-live-view.test.mjs | 13 | 0 / 0 | 0 |
| tests/browser-login-return.test.mjs | 5 | 0 / 0 | 0 |
| tests/login-return-path.test.mjs | 66 | 0 / 0 | 0 |

**125 passed**, no skips. The body SQL regression exclusively uses URLs minted by
`tests/_harness/testdb.mjs` and an explicit website LOGIN; never an ambient DSN.
Early fixture runs hit the existing Ask recovery fence; the fixture was corrected
using disposable website identity/recovery setup. No production fence was weakened.

Final `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Earlier tsc passes observed concurrent C edits; the final shared-tree check passed.
`git diff --check` for owned paths passed. The tagged cluster was explicitly stopped
with `SJC_TEST_CLUSTER_TAG=browser-p1-b2-1107q node scripts/test-db.mjs stop`.
No exit137/Killed, full-suite, dependency install, browser, Next dev/build/start,
sudo, service, nginx reload, migration application to live DB or deploy occurred.

Not done: real Unix-peer relay/TLS/nginx/Cloudflare streaming, actual Chromium/
manual-privacy/output canary, multi-process DB/control/input races, real owner/
staff/phone/Safari iPad/desktop presentation+IME, installation/launch/bootstrap
hooks above, source-inventory acceptance and activation. Existing nginx proposal
in B's original handoff remains unapplied. Coordinator acceptance must verify
pixels blank on authority loss, fresh-generation consent reset, hidden-view
attendance, planned/accidental disconnect, actual control renewal and FIFO launch.
