# Browser Phase 1 C2 — pane integration handoff

C2 owns only the pane/API adapter/session/model/settings and C tests below. No push,
flag enablement, deploy, app server, browser, build, service operation or subagent.
Find the C2 commit with `git log -1 --format=%H -- docs/plans/build/browser-phase1-C2-HANDOFF.md`.
B2/A2a/A2b have independent edits in this same worktree; they are not C2 changes.

## Item → implementation

1. `public_research` is the create request kind; explicit fresh confirmation sends
   `confirmed:true`. Availability uses `enabled/can_start`; settings and the own
   confirmation preference use only `enabled/staff_enabled`, with no prefixed-key
   override. The four later flags stay disabled in the existing settings UI.
2. `browser/api.ts` imports BROWSER_API/BROWSER_HEADERS and all exposed wire/request
   types from `lib/browser/web-types.ts`. Cookie/no-store fetch, GET `/csrf`, POST
   JSON+CSRF, viewer/device/owner-claim headers, per-explicit-mutation UUIDs, frozen
   private input/event validators remain the single route seam. All existing
   methods match B's routes; `/decline` and `/sessions/:id/stream-close` are included.
   No token query, Bearer fallback, mutation replay or generic CDP operation.
3. Tasks, In use, reads and answers consume paged `items/next_cursor/revision`.
   Assembly completes before publication. Mixed revisions, repeated cursors, aborts
   and bounded collection overflow discard the assembled list. Stale read review
   clears candidates and disables approval. Task snapshots retain the shared
   registry's per-kind publication; no Canvas store/feed changes were necessary.
4. Queue position and `offer_status` render when present. A null position says
   “Browser is busy.” rather than inventing second place/full capacity. B's safe
   `state_reason` controls idle/absence/turn/owner-pause/crash/latch/unknown copy;
   no missing reason is inferred from generic pause. Owner label, controller,
   watching indicator and window count are display-only. Null fields clear the
   respective display data. `reason_code` maps to fixed plan copy, never wire
   exception strings. The configured-owner fallback is neutral “Owner”.
5. Read reviews use ONLY pending `candidates`, their original deadlines and
   `candidates_status:pending`. Approved `entries` are separately shown in Sites;
   they never enable a new review. Missing/null candidates/status/deadlines,
   expiry and >20 resources disable approval. Each mutation still carries the
   original read revision. Decline never fabricates an approval.
6. Pause/resume/takeover/Done/fresh/Stop exposure follows `available_controls`;
   null/absent controls disable these actions. Private pages have no Continue.
   Control renewal extends only an existing memory token after authoritative
   presence with matching CURRENT context_generation/control_epoch and a valid
   persisted control_expires_at/server_time. No local lease invention.
7. Fresh reset synchronously clears pixels/input/token/consent and aborts the old
   stream. `createFrameGate` holds presentation until authoritative GET detail
   (or state) has the new context generation, at least old+1 and the response's
   target when supplied. Old/missing metadata and stale revisions cannot open it.
   The control response alone never unblocks presentation. Polling can release
   the gate after a temporarily stale detail; a new stream is then opened.
8. Normal visible stream rotation or Browser→Chat/Canvas switches stop local
   presentation immediately; when stream binding is known, the hook awaits the
   authenticated planned-close ACK before cancelling GET. The next GET waits for
   that drain. Failed ACK aborts as accidental, never claims attendance preserved.
   Context/privacy replacement clears private consent and rotates presentation.
9. Every frozen BrowserError code has a tested fixed §6.5 copy (the nearest
   fail-closed applicable state for codes without their own row). Exact site
   blocked copy uses only the trusted allowed-site origin. Phone write refusal
   uses the phone variant. Handshake errors retain their real code. No person
   pronouns are guessed; existing Abigail/Mark/Sam × Joe/Alex/Taylor lint remains.

## Consumed B2 web types / fields

Final alignment reads the B2 `web-types.ts` and route implementation directly;
all exported requests/settings/review/In use types added during B2 are used.
`TaskUI`, TaskMetadata, BrowserStatus/Join/Start/Control/Presence/StreamClose,
BrowserTasks/Reads/Answers/Availability/Settings/InUse/Review, BrowserCreateRequest,
JoinRequest/PresenceRequest/AnswersRequest/SettingsRequest, BrowserTaskResult,
ReadProposal, ConfirmedAnswer, ControlMessage, ManualInput, Frame and BrowserError
supply the client types. Frozen validators stay client-safe in phase1-contracts.

Consumed fields: task state/private/control/allowed_sites/required_areas/epochs,
revision/context_generation, available_controls, pending_action, queue_position,
offer_status, state_reason/reason_code/projection_status, idle_closes_at,
controller/owner_label/window_count/watching_owner, items/next_cursor,
candidates/candidates_status/server_deadline/expires_at, approved entries,
answers, start_code, token+control expires and presence server_time/epochs.
`start_code` refuses unavailable attachment instead of claiming a running agent;
the server owns run launch. No fake run is minted. Snapshot run_id remains nullable.

Fields with no extra presentation: queue_expires_at/offer_expires_at (server's
queue/offer status is authoritative), read digest, downloads (Phase 1 empty),
active_run_id/run_attachment (task/snapshot retains the actual run association).
Missing production reason/candidate/renewal sources remain fail-closed even though
these fields now have route types. Owner reason/name metadata must come from B's
trusted website projection, never a page title or transcript.

## Verification

Initial C2 expectations ran before implementation: 47 passed / 55 failed at the
intended missing helpers/copy/paging/frame-gate gaps. Later projection and real
paging expectations also failed before their respective implementation.
Final verification (each file individually; no full suite):

| File | Passed | Failed / skipped |
|---|---:|---:|
| tests/browser-ui.test.mjs | 114 | 0 / 0 |
| tests/browser-owner-review.test.mjs | 8 | 0 / 0 |
| tests/panel-content-pane.test.mjs | 40 | 0 / 0 |
| tests/canvas-ui.test.mjs | 60 | 0 / 0 |
| tests/canvas-floor-adapter.test.mjs | 30 | 0 / 0 |
| tests/canvas-integration.test.mjs | 33 | 0 / 0 |
| tests/canvas-poll-history.test.mjs (isolated rerun) | 20 | 0 / 0 |

**305 passing**, no final failures/skips. Locked tsc
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Earlier tsc observed/fixed C's transient syntax/type errors and observed B's
in-progress syntax/types without editing B files. Owned diff whitespace check
is clean. Final web-types reread includes B2's appended request/settings/review
exports, and its control route now returns full authoritative detail plus the
persisted control expiry.

The first Canvas history invocation mistakenly omitted SJC_TEST_CLUSTER_TAG;
it reused the existing disposable harness cluster and refused changed migration
0115 before test-body writes. That pre-existing cluster was neither reset nor
stopped. The isolated rerun used **browser-p1-c2-1107ui**, only the harness URL,
and passed all 20 cases. Its cluster was stopped successfully. No live DB used.
No resource-limit kill occurred.

## Coordinator QA shot deltas — not performed here

Retain C's full viewport/device/landscape/Canvas/focus list. Add these integration
shots using disposable owner/staff transport fixtures and rollout flags off:

- True plain flags plus conflicting prefixed fixture keys; settings save/conflict.
- Queued position null versus 2; offered/missed/expired; unknown safe reason versus
  every bounded reason, configured owner Alex/Taylor, null controller/window data.
- Public paused Continue enabled only by server; private paused and absent controls
  disabled. Owner Pause failure must never say success.
- Read review after 2+ metadata pages, stale second-page revision, null/empty/pending/
  denied/expired candidate sets, missing deadline and 1/20/21 resources. Approved
  Sites addresses must never substitute for pending review candidates.
- Fresh confirmation with new-generation response followed by OLD detail and an
  old queued frame: blank until NEW detail, fresh stream, and new owner private
  consent if applicable. Also reload becomes current only on a later heartbeat.
- Heartbeat matching context/epoch extends control; null deadline, stale epoch or
  generation removes local control. No auto takeover/replay on refusal.
- Browser→Canvas→Browser after receiving a frame: planned-close ACK precedes GET
  cancellation, Canvas remains selected and staff attendance survives only if
  the real controller confirms planned close. Include ACK refusal/transport loss.
- Precise errors in the actual pane, including read stale, internal address/site
  refusal, private-input requirement, resource cap and login/permissions expiry;
  no raw BROWSER_* or page error text on screen.

## Not done / remaining gates

No screenshots, Safari/IME/focus geometry QA, real SSE/controller/network/privacy
canary, installer attestation, activation, production flag enablement or push.
Guarded remote Back/Forward/Reload/window switching remain disabled as in C.

Planned close before the FIRST frame remains conservatively accidental: the
frozen state event has no stream_id/stream_generation and B's GET currently has
no separate pre-frame binding projection. C2 can acknowledge planned close once a
frame supplies the binding; it will not invent one. A reviewed authenticated
pre-frame binding/header extension would close this remaining seam.

Actual reason/deadline/candidate/control-renewal availability, attended immutable
run attachment and fence ACKs depend on A/B production adapters; UI fixtures do
not attest those sources. D's real hostile-page canary is still mandatory before
takeover exposure. Defaults remain dark/fail-closed.
