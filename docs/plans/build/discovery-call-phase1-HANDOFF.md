# Discovery checklist Phase 1 — backend handoff

Branch: `t3/discovery-checklist-backend`. Migration: **0074 only**. The migration has been exercised only in the disposable `calls` harness. No deployment, live DB access, provider call, browser or app server was used.

## Entry points and types

Import screen functions from `lib/actions/discovery-checklist.ts` (all public exports are authenticated server actions). Import client-safe types/data/helpers from `lib/checklist-coverage/contract.ts` and `manual.ts`. Do not import the DB, DAL or server actions into an offline persistence worker.

- `ChecklistSnapshot`: pinned session + version + ordered `rows[]`; each row contains `identity` (use **runtime** `item_id`), `spec`, `coverage`, and nullable `prior`.
- `ManualOperation`: `{session_id,item_id,state,value,reason,expected_revision,operation_id}`. Revisions are session revisions, not the row's revision. UUIDs are canonical strings. Use `crypto.randomUUID()` once per logical operation; preserve it across network retries.
- `CommandResult`: `{ok:true,session_id,revision}` or `{ok:false,code:'CHECKLIST_CONFLICT',status:409,current,proposed}`. Server actions return the status as data; the client must branch on `ok`. Normal successful commands require a subsequent load/refresh for the full snapshot. Exceptions carry stable `CHECKLIST_*` messages; don't display SQL errors verbatim.
- `ChecklistItem` includes stable definition UUID/key, questions, exact reminder wording, component requirements, covered/partial rules, optional/enabled and reminder settings. Never substitute a definition UUID for a runtime item UUID.
- `COVERAGE_MARKS`: exact two word sets of §6.0. UI builder implements the shared React `CoverageMark` using these. Coverage flags are presentation flags, not extra saved states. `safeRevision` refuses unsafe integers.

## Screen/action map (plan §4.2 / §6)

| Screen/state | Backend and client integration |
| --- | --- |
| Calls, nothing selected | “Start a checklist, or pick a call.” `startChecklist({operation_id})` works with voice off. Navigate to `/calls?checklist=<session_id>`. No selection or confirm sheet required. |
| Calls loading | “Loading checklist”; skeleton; disable edits until ID/load returns. `loadChecklist(id)`; Retry repeats the read. |
| Calls deep link | `/calls?open=<call-id>&view=checklist`: `loadChecklistForCall(callId)` returns null if none; show Start checklist / unknown choices. Starting from a selected known call passes call and lead IDs. No automatic capture/session creation on viewing. |
| By-hand checklist, all widths | `loadChecklist`; exact chip **By hand — AI can't hear this call**. Session header lead/call selectors use `linkChecklist({session_id,lead_id,call_id,expected_revision,operation_id})` after the plan's Link/Cancel confirmation. `saveChecklistNotes` persists the Notes field. Sticky **Finish checklist** calls `finishChecklist`, which returns summary and never hangs up. Phone/tablet/desktop share these APIs. |
| One-tap state word | `setChecklistItem`: Open→Covered; Covered→Open; Partly→Covered. `value:null` is legal and produces no fact. Save indicator becomes **Saved** only on acknowledgement. |
| Row sheet | Same `setChecklistItem` for Open/Partly/Covered/N/A and answer JSON (§3.3). `reason` required for N/A. Data in `spec.questions`, `covered_when`, `partial_when`, `components`, `partial_reminders`. Mic uses existing VoiceButton/dictation; backend accepts its final typed value. Undo restores the sheet's initial local values before save, or sends a new operation with current revision after a committed edit. Human rows have `manual_lock:true`. |
| On lead / Still right ✓ | Nullable `row.prior` displays **On lead** with the stored value; underlying state stays Open. `confirmLeadChecklistItem({session_id,item_id,expected_revision,operation_id})` uses the current saved fact and records a manual Covered value. Scalar scope/budget/timeline/address facts adapt to session objects. No automatic identity changes or fact promotion. `loadLeadChecklistFacts(leadId)` exposes all known facts for other consumers. |
| Unknown caller | `unknownCallerChoice({call_id,choice,lead_id?,operation_id})`: `link` starts linked checklist; `new_lead` returns `{createLead:{phone},linkCallId}` for the existing lead form; after creation call `startChecklist` with new lead/call; `not_lead` returns `{hidden:true}` and creates no session. Hide in local selected-call UI. |
| Lead “Start a discovery call” confirm sheet | `discoveryCallConfirmData(leadId)` supplies name/phone/email/scope and explanation. `startDiscoveryCall({lead_id,operation_id,checklist_only:true})` handles **Checklist only — I'll call from my cell**. For **Call now**, pass false; owner-only, calls unchanged `placeCallAction` using the lead's current phone and existing exact-number single-use grant. Errors leave the manual session usable. Cancel has no backend effect. Concurrent clicks serialize per session. |
| App-wide live-call bar | `activeCallSnapshot()` under a `can(user,'comms')` visibility check returns recent ringing/bridged call rows (last 2 h), direction, contact, number, start/answer time, session link, plus open manual checklists. No provider API. Feed existing layout refresh; no new polling process. “Incoming call” / “Your cell rings first” / “on the line” are derived from status/direction. Per-tab × and hidden-while-selected are UI sessionStorage state. Display Chicago times. |
| Finish / summary | `finishChecklist` is valid even if the call is still live: it only ends checklist. `loadChecklistSummary` includes counts, rows, notes, `everythingCovered`, lead email/name, previous approval draft IDs/status. Show **Everything covered.** if appropriate; otherwise Open/Partly groups, counts line and Edit links. No automatic email drafting. |
| Summary follow-up | Joe types subject/body; `stageChecklistFollowup({session_id,expected_revision,operation_id,subject,body})` stages knowledge + work item + draft receipt atomically and returns IDs. Replaying identical op returns same IDs. To is always current linked lead email. No email → **Confirm their email first** / Add email via existing lead editor. Show **Submit for approval**, “Joe approves it in Today; approval sends it.” Do not call a send function afterward. `lib/approvals/stage-draft.ts` contains the reusable staging primitive, exercised in isolated DB tests. |
| Ask in email toggles | UI-local selection, max three; N/A and refusals must not be offered. Summary supplies rows/answers. Phase 1 has no generated question/body API: Joe composes the text. |
| Insurance answer | `INSURANCE_WARNING` in `manual.ts` is the exact §3.2 warning. The manual save creates one lead-keyed §325E.66 initial-estimate notice task when insurance is entered with a linked lead. |
| Settings › Calls › Discovery checklist | Owner-only `loadDiscoveryChecklistSettings()` returns definition/version/settings/defaults. Per-row label ≤40, reminder ≤120, ≤2 questions ≤160 each, optional enabled toggle, reminder toggle, array order. Save calls `publishDiscoveryChecklist({definition_id,expected_version,items,screen_phone,send_call_link,operation_id})`. Cancel local edits. Restore default wording merges returned defaults' label/reminder/questions by stable ID (preserve switches/order), then Save. Core nine cannot be disabled. New immutable version; old sessions stay pinned. Phone/link preferences are saved but delivery activates only in later phases. Wrap-up editor is Phase 3. |

## Offline queue contract (§4.3)

The UI builder owns IndexedDB and browser event handling. Backend replay/conflict behavior is complete. `OFFLINE_QUEUE` and `recoverPending` export the shared constants/expiry/partition rules.

1. Database `sjcos-calls`, user-partitioned store `pending:<user-id>`; key by session. Store `{user_id,created_at,operations:ManualOperation[]}`; retain each operation UUID, base session revision and intended value. Only human edits; no transcript, audio, auth context or secrets.
2. Connection drops: queue locally, optimistic state distinct from acknowledged state. Copy **Offline — 3 changes saved on this device. They'll send when you're back online.** Register beforeunload while pending. Queue revisions advance in local operation order; replay sequentially and stop at first conflict.
3. Recovery after online reload: **3 changes from this device weren't sent — [Send now] [Discard]**. No offline shell/service worker; a reload while offline is the browser's offline page. Do not replay recovered edits without Send now.
4. Replay through `setChecklistItem`; preserve op ID and payload for retries. Same principal+operation+payload returns its stored result, including after later edits. Changed payload/principal with same UUID is `CHECKLIST_OPERATION_REUSED`.
5. Conflict returns 409 data with both current snapshot and proposed operation. Show both; keep mine requires a **new UUID** using the returned session revision; use server discards local op. Never silently rebase over another device. Normalize BIGINT strings in raw conflict snapshots with `safeRevision(Number(...))` before scheduling further edits.
6. Clear user partition on logout, expire at 24 h, refuse another user's recovered partition. `recoverPending` implements ownership/expiry checks; it does not implement storage.
7. Storage denied/full: **Can't save on this device — keep this page open until you're back online.** Retain pending edits in memory and keep unsent warning. Header must not claim Saved.

## Errors and copy

| Result/code | UI handling |
| --- | --- |
| `CHECKLIST_CONFLICT` | Both versions + explicit choice (§4.3 specifies behavior, not an exact conflict sentence). |
| `CHECKLIST_OPERATION_REUSED` | Do not retry modified data with same UUID; preserve queued edit and ask for explicit conflict resolution. |
| `CHECKLIST_INVALID_ANSWER` | Highlight answer or required N/A reason; retain sheet values. |
| `CHECKLIST_INVALID_ID`, `CHECKLIST_INVALID_ITEM`, `CHECKLIST_INVALID_REVISION`, `CHECKLIST_INVALID_TARGET` | Reload current checklist; do not drop pending edits. |
| `CHECKLIST_NO_PRIOR` | Refresh row; no longer show stale On lead value as confirmed. |
| `CHECKLIST_VERSION_CONFLICT` | Settings changed elsewhere: reload current version and let owner reapply changes. |
| `CHECKLIST_INVALID_SETTINGS` | Keep edits and highlight length/required-row restrictions. |
| `CHECKLIST_OWNER_ONLY`, `CHECKLIST_FORBIDDEN` | Hide owner controls; DAL redirects unauthorized website requests. Fresh DB authorization also rejects revoked comms access. |
| `CHECKLIST_NOT_FOUND`, `CHECKLIST_UNAVAILABLE` | Retry loading; preserve local pending edits. “Start a checklist, or pick a call.” only when there is actually no selection. |
| `CHECKLIST_LINK_LEAD` | Open Link to a lead before staging. |
| `CHECKLIST_NO_EMAIL` | **Confirm their email first** / Add email. |
| `CHECKLIST_NO_PHONE` | Keep checklist open; edit lead phone before trying Call now. |
| `CHECKLIST_INVALID_DRAFT` | Keep draft; subject/body must be nonempty; subject single line; body ≤30k. |
| Existing `placeCallAction` error | Show its existing connection/phone/provider error; checklist remains usable. |

Only copy already specified by the plan is quoted above; validation/conflict sentences without plan copy are for UI builder to write plainly.

## Read APIs / MCP / schema boundary

`GET /api/calls/coverage?session=<uuid>&rev=<revision>` authenticates through the website DAL; `Cache-Control: private, no-store`; returns 304 if unchanged. Phase 1 can use existing LiveUpdates and refresh instead of a dedicated poll. Later phase live polling follows §10.3, pauses hidden tabs and backs off on error.

MCP `get_call_coverage` takes exactly one call/session UUID. `list_checklist_definitions` optionally filters kind. Both are read-only via `/api/internal/checklist`, using the trusted internal bearer plus current principal/delegation checks; unattended/no-principal requests fail closed. No new MCP edit/dial/consent tool is enabled in this backend scope. Existing place_call stays unchanged.

0074 includes all §8.3 tables, immutable guards, seed, consent evidence, legal holds, purge requests/targets, content lineage, replay receipts, settings and protected context keys. Definitions/version templates alone grant raw SELECT to agent/worker. Narrow roles cannot read/write shared content or mint contexts. Owner website mints short-lived signed contexts through an owner-only function; HMAC key bytes remain in an owner-only table. SQL rechecks active user/comms/role/session scope every command. Public EXECUTE revoked on scoped helpers; agent only receives scoped read EXECUTE. Staff may edit manual checklist, never publish Settings. Schema baseline is intentionally unchanged: `db/migrate.mjs` documents `db/schema.sql` as the historical baseline and numbered ledger as authoritative; appending non-idempotent shared guards/FKs to both would break fresh installs.

Consult builder can rely on composite version/item/session/evidence FKs and v3 types/fixture now. Consult assignment-aware commands, scoped late-instance insertion and audio ingestion are not enabled by this calls-only Phase 1 command dispatcher. SQL tests exercise relational late-instance membership directly as migration owner; future consult functions must enforce actual form instance/assignment.

## Explicitly later phases / UI-owned work

- React screens, shared CoverageMark component, row mic wiring, IndexedDB persistence, focus/accessibility, safe areas and visual acceptance belong to the next UI builder. Backend tests do not prove browser storage behavior or layouts.
- Phase 2: consent buttons/card and all pending/declined/unknown-speaker/ambiguous/stop states, recorded yes verification/clip extraction, STT, live freshness and retention/hold/purge execution. Schema only now. Never label this manual feature Notes on or claim it hears calls. Capture stays off in this feature; existing telephony behavior has not been changed.
- Phase 3: Heard — confirm suggestions, reminders cards/toggles, wrap-up phrases/editor, inference, known/unknown-speaker engine apply, job leases and all AI states. Contract types/data only now. Behind/Failed/Waiting for speech/Notes failed/Ended-final-transcript states in §6.7 are later live features, not emitted by Phase 1.
- Phase 4: fact promotion/contact identity application, generated summaries/follow-up questions, business SMS adapter, transcript-derived approval lineage and worker pipeline. Manual answers persist but do not change qualification facts/stages. The seven fact keys and intake Other bids mapping are in place; required qualification verdict subset unchanged.
- No legal approval remains outstanding: Joe confirmed attorney approval and all 13 rows on. No rollout/deploy authorized.

## Verification

Single-file tests: `call-checklist` (4), `checklist-offline` (1), `checklist-access-db` (3), `db-roles-manifest-db` (6), `db-roles-paths-db` (2). Final results recorded in the implementation response. DB tests use only `SJC_TEST_CLUSTER_TAG=calls` disposable harness; stop command run after checks. Typecheck uses the shared flock and reports an explicit exit code. No Next build/dev/start or visual checks.

Coordinator/UI checks still required: 360 px phone, tablet both orientations, desktop, keyboard, screen reader, 200% zoom, daylight contrast; two actual browser devices, offline reload recovery and storage-denial banner. Do not start a dev server on this shared box.
