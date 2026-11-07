# Browser Phase 1 B — integration handoff (in progress)

## Requests for A/D

**A — controller seam blockers, fail closed:** B's `web-rpc.ts` consumes the frozen
`WebEnvelopeV1` (64 KiB) at `/run/sjcos-browser/control.sock` and a separate signed
binary stream at `/run/sjcos-browser/frames.sock`. A's in-flight implementation
currently differs (32 KiB, runtime/web.sock, unsigned response). Reconcile these
before activation; never silently accept unsigned controller replies. B requires
response `{command_id,boot_id,sequence,result,signature}` with direction-separated
response key, signature over canonical content excluding signature. `result`
includes `ok:true` or the frozen WebError. Controller control returns trusted
`proof_metadata` (drained/context_generation and fresh-browser fence fields),
then B consumes browserWebControl. D's enterPrivate must run before takeover ACK.
Manual input uses persisted browserWebInput proof; service must recheck it and
perform D barrier, not accept a client `drained` boolean. B also calls D's
`authorizeManualInput` before forwarding. stream_open/close use persisted website
proofs and must support planned rotation without expiring initiator presence.
Do not increment epochs on GET. Binary subscription hello is
`{v:1,purpose:'browser-web-frame-open',...FrameBinding,issued_at,expires_at,nonce,signature}`;
no URL tokens. Signed frame payload is frozen BinaryHeader + exact JPEG bytes.

**A — run launch:** /start uses browserWebQueue(request|accept), returns a
TaskDraft until real immutable run attachment. No fabricated run ID. Connect the
server-owned `admitAskRun`/runner attachment to offer acceptance (B cannot edit
A-owned admission/runner). Queue decline needs a catalog transition or owner
confirmation that Stop is the intended decline. An expired/stale offer is never
auto-accepted on retry.

**D — public read classifier:** `createWebsiteAdapter` accepts an installation-owned
`publicReadPolicy` with `facts(task):Promise<string[]>` and
`classifyPublicUrl(url, context):boolean`; none is installed by default. D's
`buildReadManifest` requires this trusted evidence. Please supply the production
policy/facts adapter or its named export. Browser draft/create and read approval
refuse `BROWSER_READ_PROVENANCE_UNKNOWN` until integrated. Do not infer public
classification from route JSON/source:'person' or let an owner bypass it.

This file will be completed with validation, routes and final commit reference.

## Implemented B surface

All handlers are routed through `app/api/agent-browser/[...path]/route.ts`
(Node runtime, dynamic). Unsupported verbs still enter the cookie/DB boundary.
No Next proxy redirect applies to API requests. Every response is private/no-store;
SSE additionally disables nginx buffering/transformation. No file creation,
signed media URLs, legacy sid mint, Bearer auth or CDP relay was added.

Notation: `I={idempotency_key:uuid}`, `V={viewer_id,device_secret}`. IDs and secrets
remain in protected headers / JSON, never query credentials. Successful JSON
also has `ok:true`. Frozen errors have exactly `ok:false,code,message,retryable`.
`T={task:TaskUI,revision,context_generation}`; pre-run `task.run_id` is **null**.

| Method / path under `/api/agent-browser` | Request → success | Specific refusal codes |
|---|---|---|
| GET /csrf | none → `{csrf_token,expires_at}` + HttpOnly Strict double-submit cookie | DISABLED, NOT_AUTHENTICATED |
| GET /availability | none → `{enabled,staff_enabled,can_start,reason_code,revision}` | DISABLED |
| GET /tasks?conversation_id=uuid | only that query → `{tasks,snapshots:[],revision}` | NOT_FOUND, FORBIDDEN |
| POST /tasks | `{conversation_id,task_kind:public_research/permit/invoice/purchase,purpose,project_id?,lead_slug?,origins,initial_url,read_proposal,...I}` → T | READ_PROVENANCE_UNKNOWN, PHASE1_READ_ONLY for adapter_id |
| GET /in-use | owner → `{items:[{task_id,person_label,task_kind,project_label,state,revision}]}` max 2 active | FORBIDDEN |
| GET /tasks/:id | viewer/claim headers as applicable → `{...T,active_run_id,available_controls,pending_action,downloads:[],queue_position,server_time}` | NOT_FOUND, FORBIDDEN |
| POST /tasks/:id/start | I + joined initiator headers → `{...T,run_id:null/uuid}` (request queue / explicit accept offer) | ATTENDED_ONLY, OFFER_EXPIRED, QUEUE_FULL |
| POST /tasks/:id/decline | I + joined initiator headers → T, closes queued task using Stop catalog | OFFER_EXPIRED |
| POST /tasks/:id/sites | `{origin,role,expected_revision,...I}` + viewer headers → T | REVIEW_STALE, SITE_BLOCKED |
| GET /tasks/:id/reads | human headers → `{revision,digest,expires_at,entries,candidates:[],server_time}` | FORBIDDEN |
| POST /tasks/:id/reads | `{expected_revision,proposal,decision:approve/deny,...I}` → `{revision,digest,expires_at,blocked_entries,pending_action_id:null}` | READ_PROVENANCE_UNKNOWN, READ_EXPIRED, REVIEW_STALE |
| GET /tasks/:id/answers | none → `{revision,answers}` | FORBIDDEN |
| POST /tasks/:id/answers | `{expected_revision,proposal:[{field_key,value,source_message_id}],decision:confirm/remove,...I}` → `{revision,answers}` | REVIEW_STALE, READ_PROVENANCE_UNKNOWN |
| POST /tasks/:id/join | `{mode,local_thread_id?,action_id?,private_view?,...I}` → `{...T,viewer_id,device_secret,expires_at,owner_review_claim?,available_controls,pending_action,queue_position,server_time}` | RESOURCE_LIMIT (4th viewer), NOT_FOUND, FORBIDDEN |
| POST /tasks/:id/leave | `{...V,...I}` → `{left:true}`; owner Watch claim revoked | FORBIDDEN |
| POST /sessions/:id/presence | `{...V,visible,host_context,expected_epoch,...I}` → `{present_until,server_time}` | STREAM_STALE |
| POST /sessions/:id/control | `{action,...V,expected_epoch,...I,confirmed?:true}` → `{...T,control_token?,expires_at?}` | REVIEW_STALE, CONTROL_HELD, PRIVATE_INPUT_REQUIRED, PHASE1_READ_ONLY |
| POST /sessions/:id/private-input | frozen ManualInput → `{accepted_seq}` | STREAM_STALE, CONTROL_EXPIRED, IDEMPOTENCY_CONFLICT, PRIVATE_INPUT_REQUIRED |
| POST /sessions/:id/input | any manual payload → refusal | PRIVATE_INPUT_REQUIRED |
| GET /sessions/:id/events | viewer/device/claim headers; no query/replay → SSE state/frame/action/reauth/closed | JSON handshake failures; STREAM_STALE, AUTH_EXPIRED |
| GET /sessions/:id/frame | same headers; no query/Range → bounded `image/jpeg` | STREAM_STALE, BAD_INPUT |
| GET /actions/:id | notice or retained action → `{review,task_id,revision,outcome_code,server_deadline}`; retained action is fixed closed/read-only projection | NOT_FOUND |
| POST /actions/:id/decision | `{decision:deny,expected_revision,...I}` → `{action_id,state:closed,result_code:BROWSER_PHASE1_READ_ONLY}` | approve → PHASE1_READ_ONLY; REVIEW_STALE |
| GET / HEAD /artifacts/:id | authorized; optional Range cannot bypass auth → no Phase 1 artifact, 404 | NOT_FOUND |
| GET /settings | owner → `{flags,pilot_user_ids,takeover_confirm_suppressed_user_ids,revision}` | FORBIDDEN |
| POST /settings | `{enabled,staff_enabled,pilot_user_ids,suppress_own_takeover_confirm,expected_revision,...I}` → settings | REVIEW_STALE, PHASE1_READ_ONLY for later true switches |

All code names above have `BROWSER_` prefix. Common status mapping is imported,
never redefined: NOT_AUTHENTICATED/AUTH_EXPIRED 401; FORBIDDEN/REVOKED 403;
NOT_FOUND 404; stale/revision/dedupe 409; expiry 410; size 413; read-only/private
input/provenance 422; busy/viewer/rate 429; disabled/service/latch 503. All mutation
requests require configured production Origin + same-origin Fetch Metadata,
JSON, a session-bound CSRF nonce, current sid/device/task/areas. Stream authority
is uncached ≤5s and before every emitted frame. Initial frozen notice carries
Close-only semantics; errors preserve the exact four-key frozen WebError shape.

## Client exports / requests for C

`lib/browser/web-types.ts` exports `Task, TaskDraft, TaskUI, TaskMetadata,
ReviewNotice, OwnerBrowserReviewClaim, ManualInput, ControlMessage, Frame,
BrowserError, BrowserEventName, BrowserEvents, BrowserStatus, BrowserJoin,
BrowserAvailability, BrowserResponse<T>, BROWSER_API, BROWSER_HEADERS`.
All wire contracts derive from A0 rather than duplicated UI declarations.

C should use task_kind **public_research**, not browse; send `confirmed:true` on
fresh_browser after the dialog; settings flags use the six plain keys returned
by evaluatePhase1Flags (`enabled`, `staff_enabled`, etc.), not `browser.enabled`.
Passive owner join may inspect metadata/heartbeat before private consent; frames
and takeover remain fenced. `join` returns the detail fields the current C API
expects. `/decline` is an explicit optional queue-decline endpoint; `/start`
continues the frozen second-Open/accept behavior. Update C's types to consume
web-types when integrating; B did not edit panel-owned files.

## Known incomplete integration / acceptance gaps

This is a **dark implementation, not Phase 1 activation acceptance**:

- Default website adapter deliberately has no publicReadPolicy. Draft admission
  and public-read approval refuse until D supplies trusted classification/facts.
- Queue accept changes SQL state, but does not fabricate or launch an agent run.
  A's real attended run launch/attachment is still needed; /start may return a
  TaskDraft while queued/starting. It must not claim the frozen Task success
  variant until a real run exists.
- Controller response authentication / socket path /64KiB framing and the binary
  listener still need A reconciliation. B verifies frame HMAC with
  `browser-phase1-frame\0` and request HMAC with `browser-phase1-web-rpc\0`;
  body_digest on controller envelope is SHA256 canonical payload, matching A's
  current client verifier. DB body proofs are separate keyed HMACs.
- For private controls, A returns proof_metadata with drained/context_generation/
  control_epoch/stream_generation; fresh adds fenced/old_generation/new_boot_id.
  B only persists those allowlisted fields and its server token hash. It never
  accepts a drain assertion from POST JSON. Confirmed fresh is stamped in proof.
- A must persist last_frame_uuid/current stream epochs and upstream CDP ACK/drop
  for each capture, recheck frame permissions, and deliver only the current JPEG.
  B buffers only the latest SSE frame, acknowledges its source callback even
  when dropped, limits encoded delivery, and caps partial binary reads. No
  replay after disconnect or unknown input outcome.
- Socket EOF/error cleanup currently relies on A's stream_close handler to pause
  accidental initiator loss and revoke passive owner viewers. Planned 60-second
  reauth must retain presence. Actual browser/private capture reset is unproven.
- Queue position and blocked public candidates currently project null/empty;
  no invented queue positions/candidates. Thread PaneSnapshot integration and
  reviewed candidate storage need A/C/D integration.
- Full web-DB integration/races were not run; tests exercise boundary/transport
  and the production adapter using explicit fake clients/controller. Remaining
  mandatory harness cases include SQL grant/role paths, durable multi-process
  duplicate input, competing controls/viewers, actual expired claims, task/run
  fencing, settings serialization and notice/answer idempotency under races.

## nginx proposal — NOT APPLIED

Insert before `location /` in `deploy/nginx-sjcos.conf` (and the canonical TLS
server after coordinator review). No config was changed/reloaded:

```diff
+    # Browser Phase 1 SSE proposal — not installed by this change.
+    location ~ ^/api/agent-browser/sessions/[0-9a-f-]{36}/events$ {
+        proxy_pass http://127.0.0.1:3017;
+        proxy_http_version 1.1;
+        proxy_set_header Host $host;
+        proxy_set_header X-Real-IP $remote_addr;
+        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
+        proxy_set_header X-Forwarded-Proto $scheme;
+        proxy_set_header Connection "";
+        proxy_buffering off;
+        proxy_cache off;
+        gzip off;
+        proxy_read_timeout 75s;
+        proxy_send_timeout 75s;
+    }
```

Coordinator-only: production build on isolated/capped dist if separately
approved, real anonymous browser/stream/private canary, Cloudflare/TLS/nginx SSE
flush/rotation/no-cache, disconnect/revocation through the real proxy chain,
real iPhone/iPad/desktop letterboxing/IME/keyboard and private image blanking,
resource envelope, receipts/runtime inventory, activation/deploy gates. No
browser/server/build/service, sudo, install or migration command was run by B.

## Validation and commit

B commit: `git log -1 --format=%H -- docs/plans/build/browser-phase1-B-HANDOFF.md`
(the handoff and all B-owned implementation/tests are in that commit; no push).

The initial 20 expectations were authored before implementation, then expanded
to 29 with regression/production-adapter cases. Commands were
run singly; DB adapter tests use explicit in-memory clients with no DSN:

| Command (prefix `SJC_TEST_CLUSTER_TAG=browser-p1-b-1107`) | Final result |
|---|---|
| `node --test tests/browser-routes.test.mjs` | exit 0, 15 passed, 0 failed |
| `node --test tests/browser-live-view.test.mjs` | exit 0, 9 passed, 0 failed |
| `node --test tests/browser-login-return.test.mjs` | exit 0, 5 passed, 0 failed |
| `node --test tests/login-return-path.test.mjs` | exit 0, 66 passed, 0 failed |
| `node --test tests/api-auth-coverage.test.mjs` | exit 1, 1 passed, 1 failed; existing Canvas/mobile entries, no new Browser route in failures |
| `node scripts/test-db.mjs stop` | exit 0, `no cluster running` |

Final `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **0**.
Intermediate checks observed C's files during concurrent edits (missing pane /
model fields); B did not change those files. `git diff --check` for all owned
paths exited 0. No 137/Killed, full test suite, live DB, package install,
background test cluster, build, browser, server, service or nginx action.

The 29 fresh cases cover all route methods under the boundary; expired/absent/
Bearer-only sid; live authority failure; wrong staff/removed area/disabled user/
wrong sid device; CSRF Origin/metadata/nonce/expiry; no query credentials; body
size/rate; GET controls; fresh confirmation; stale epoch / fourth viewer HTTP
mapping; clipboard/outside viewport/IME bounds; D undrained refusal; exact binary
header/HMAC/digest/binding/size/fragments; latest-only ack/drain; duplicate input
once-only/conflict; revocation before a queued image; stream revocation closure; planned rotation and accidental disconnect; exact canonical login
return with malformed/duplicate/extra/encoded/nested returns and Host-spoofed
legacy-cookie reauthentication.

These tests establish boundary behavior, **not** real DB/service/Chromium
acceptance. In particular some catalog errors (stale epoch/fourth viewer) are
injected fake-controller outcomes to test preservation of the frozen HTTP map;
they do not prove concurrent SQL limits. Coordinator must keep activation off
until the incomplete integration and real-system acceptance above are finished.
