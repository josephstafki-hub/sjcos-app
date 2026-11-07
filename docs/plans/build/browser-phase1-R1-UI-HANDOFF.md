# Browser Phase 1 R1 — UI handoff

Owned UI/test paths only. No lib/API/DB/deploy changes, push, dependency install,
server/browser, build, live DB/service action, or subagent. Concurrent SERVER,
FACTORY and QA edits were neither staged nor reverted. Find the UI commit with
`git log -1 --format=%H -- docs/plans/build/browser-phase1-R1-UI-HANDOFF.md`.

## Finding → change → regression

| Finding | Change | Test |
|---|---|---|
| Engineering 5, guarded navigation | ⋯ enables only server-advertised Back/Forward/Reload/switch_tab with a navigation projection. Both window labels use the two bounded server targets. Accessible Back/Forward names, 48 px by ≥44 px buttons, arrow/Home/End keyboard movement, dialog heading focus, shared Tab trap/Escape/cancel/return focus. Reload first warns that entered values may clear, then explicitly confirms. | browser-ui R1 menu/projection/keyboard/reload cases, actual API payload and real session request/refusal cases |
| Engineering 4, exact discovery UI | Sites sends the exact entered document URL in `proposal`, separately from origin permission. Pending server candidates and their original revision/deadlines drive Read once / Don't open and resource review. Adding a site/path and reviewing it do not navigate; missing-read navigation refreshes review and never retries the action. | browser-ui R1 Sites rendered pending review + API separation, real session resource-review refusal, existing candidate expiry/paging tests |
| Engineering 9, planned pre-frame close | Each authenticated SSE state supplies the connection's stream binding before a JPEG. Switching stops presentation immediately, waits for bootstrap if it is still in flight, then awaits exact planned-close ACK before GET cancellation. The next GET waits for that drain. Missing bootstrap (5 s bound), failed/malformed/mismatched ACK and transport loss remain accidental. Server-planned rotation does not flash disconnected copy. | browser-ui real-hook no-frame Chat/Canvas switches, independent two-viewer transport, bootstrap/ACK failure, mismatched ACK, server-planned rotation; all render the actual pane |
| Security 1, stale Watch consent | Public→private/context replacement clears pixels and consent synchronously. Authoritative `required` drops a stale local decision and shows Show the page again, even in the same private context. Presence epoch refusal reloads authoritative status so a takeover cannot leave the viewer stuck behind stale presence. Old join responses cannot override a newer revision/task. | browser-ui real-hook takeover epoch/refusal + consent invalidation; browser-owner-review R1 invalidated/missing-signal cases with old frame supplied |
| Security 3, acknowledged private Watch | Explicit Show the page waits on `private_view_status`; pending_audit renders “Waiting to show the private page…” with zero private subscriptions/pixels. Only authorized plus the local explicit decision enables a private stream/image. Required/unavailable/missing signals stay closed. Wide owner status uses the same waiting/re-ask projection as phone/landscape. | browser-ui real-hook pending→authorized→required and rendered image; browser-owner-review pending/missing/authorized cases at narrow/wide widths |
| Runtime-name copy | New waiting/menu/reload/private states retain neutral wording. Expanded existing Abigail/Mark/Sam × Joe/Alex/Taylor rendered copy lint includes authorized, pending and invalidated Watch states. | browser-owner-review C26 and R1 states |

New expectations were written and run before their implementation. Initial R1
render expectations reproduced 4 UI and 2 owner failures; subsequent real-hook,
pre-frame, discovery, rotation, epoch-refusal and reload-warning cases likewise
failed before their respective fixes. The hook fixture runs the actual React
session hook/effects with a small deterministic dispatcher and mock website IO;
SSR renders the actual TSX. It starts no DOM browser or server.

## Exact SERVER fields consumed

Final alignment reads `browser-phase1-R1-SERVER-HANDOFF.md`, `web-types.ts` and the
route implementation. POST remains `/sessions/:id/control` as the final SERVER
handoff specifies. Request adds `expected_document_epoch`, `context_generation`,
`read_manifest_revision` and `target_id` (switch only) to existing `expected_epoch`,
viewer/device and fresh idempotency key. Navigation types derive from
`BrowserStatus.navigation` and `ControlMessage`.

Response: `available_controls` and nullable `navigation` with
`context_generation/document_epoch/read_manifest_revision/target_ids`. The hook
checks projection bindings against current task metadata before sending. No
click/Enter/CDP fallback. Successful action and read-review refusal refresh status
and candidates; approval does not automatically replay navigation.

Stream: optional authenticated SSE `state.stream_id/stream_generation` is captured
before any presentation guard, including after local hide while awaiting headers.
Join binding is not reused for a rotated connection. Frames remain a fallback
binding source. `BrowserStreamClose` must return `closed:true,planned:true` and
exact matching `stream_id/stream_generation`; HTTP success alone is insufficient.

Watch: `private_view_status` is exactly
`required|pending_audit|authorized|unavailable` on status/join/state. Public mode
never requests advance private consent. Pending state polls existing authoritative
status; it creates no local audit proof. Required invalidates the local decision.
Frame acceptance also checks the latest authoritative status synchronously.

Sites: optional `proposal:{v:1,entries:[{url,role:'document',source:'person'}]}`
carries the exact entered URL. Original candidates_status, candidate
server_deadline, expires_at and read revision remain separate from approved
entries and origin membership. SERVER handles same-origin new-path staging.

## Verification

All requested files ran individually, no full suite; **328 passed**, zero final
failures/skips. Browser/owner checks were repeated after the final UI changes;
Canvas/panel checks passed and no subsequent Canvas/shared-host logic changed.

| File | Pass | Fail / skip |
|---|---:|---:|
| browser-ui.test.mjs | 134 | 0 / 0 |
| browser-owner-review.test.mjs (includes copy lint) | 11 | 0 / 0 |
| panel-content-pane.test.mjs | 40 | 0 / 0 |
| canvas-ui.test.mjs | 60 | 0 / 0 |
| canvas-floor-adapter.test.mjs | 30 | 0 / 0 |
| canvas-integration.test.mjs | 33 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |

Canvas history used only tests/_harness/testdb.mjs with
`SJC_TEST_CLUSTER_TAG=browser-p1-r1u-1107a48`; that isolated cluster was stopped.
No explicit/live URL, untagged/default cluster or production service was used.
No exit 137/Killed occurred. Owned diff whitespace check is clean.

Locked tsc: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`
— **final exit 0** (empty diagnostics). An early pass also exited 0; two
intermediate passes saw concurrent SERVER discover-callback type diagnostics in
lib/browser/web.ts. Those were sent to that builder, fixed there and not edited
from this slice. Final types and SERVER handoff were reread before commit.

## Coordinator QA shot/transport deltas — not performed here

Retain C/C2's device/viewport/Canvas/focus checklist. Add these disposable-fixture
shots/checks, keeping rollout dark outside that fixture:

1. 360 phone, 420 dock, 820/1180 tablet and 800×360 landscape: ⋯ Back/Forward
   enabled/disabled individually from available_controls; missing projection;
   both windows and exact trusted origin/Payment window labels. Keyboard arrow,
   Home/End, Tab wrap, Escape and cancel return focus to options. Reload warning,
   Cancel and explicit Reload; no hidden input or phone takeover.
2. Guarded missing-resource navigation → document/files review, original expiry
   and changed revision; Read once/Allow these files once followed by a NEW
   explicit Reload. Repeat new origin and same-origin new-path Sites entry.
3. Real transport: begin events GET with no JPEG (also delayed first state),
   Browser→Chat and Browser→Canvas; local image blanks immediately, exact
   stream-close ACK precedes GET abort, next GET waits. Keep a second device
   attended: closing one stream must not pause the other. Include refused ACK,
   lost ACK, malformed binding and server-planned no-frame rotation. Successful
   planned paths must never flash “Connection lost. Browser paused.”
4. Public Watch → staff takeover; old image/decision disappear and Show the page
   reappears. Include stale presence epoch and same-private-context invalidation.
   Explicit Show the page during audit outage shows the waiting placeholder,
   no private frame request; recovery authorizes before first image. Verify
   360/800×360/1280 wide Watch, private label, missing signal and changed context.
5. Recheck unchanged shared Canvas selection/attention/composer preservation and
   prior Diagram/Page/Floor acceptance after Browser↔Canvas switches.

No screenshots/device/Safari/real SSE/IME/privacy canary were performed here.
The coordinator's rendered transport/device evidence and installed privacy/audit
acceptance remain required; deterministic UI fixtures do not attest those gates.
