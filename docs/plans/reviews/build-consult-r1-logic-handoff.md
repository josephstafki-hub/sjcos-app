# Round 1 consultation logic handoff

Worktree: t3-991224c1; branch t3/in-home-consult-backend. No app server, browser, build, live/QA DB, service operation or push.

## Engineering review disposition

| Item | Result / implementation |
|---|---|
| 1 Authorization/expiry/logout | Fixed in `lib/consult/ui/controller.ts`: whole presentation cleanup, engine lock, expiry timer and access guard, fresh authorization before unlocked projection, async thumbnail/refresh fencing. Ciphertext retained. |
| 2 Takeover / recovery | Fixed in `lib/consult/protocol.ts`: assignment requires old manifests or owner reason, records original devices/users/epochs in an exception event, completion includes revoked devices unless explicitly excepted. `saveEvidence` invalidates only active-device manifests. `ScheduleDialog.tsx` allows same-visitor move with a reason; `RecoveryControl.tsx` obtains a scoped recovery lease and stages original-author answers on the original device with its PIN. Unsynced photo bytes remain on that device; the control explicitly warns to retain it. |
| 3 Offline Close | Fixed in `offline-engine.ts` and `ui/controller.ts`: encrypted durable intent, saved exact close request, reconnect/cold-unlock replay after answers/media, stable manifest on lost acknowledgments, explicit evidence errors. |
| 4 Cold retained builds | Fixed in `public/sw.js`: navigation query chooses the build independently of clientId; subordinate requests use client build; incomplete caches refused. VM regression includes two complete builds and one incomplete build. |
| 5 PIN | Fixed in `get-ready.ts`, controller, `GetReady.tsx`, words: 6–12 digits before any network/device reservation, dedicated `pin_invalid`, correctable retry, matching unlock policy. |
| 6 Migration bootstrap | Fixed in 0077/0078; 0075 already guards roles, 0076 is PUBLIC-only, 0079 has no role grants. Existence-guarded revokes, no raw consult grants added. Attachment-only PUBLIC RLS policy remains effective when narrow roles are provisioned later. New disposable-cluster bootstrap test starts with no narrow roles. |
| 7 Recovery media | Fixed in `protocol.ts`: real `consult-<uuid>` file IDs, ownership/hash/instance revalidation. Recovery regression uses an actual PNG upload, commit receipt and pending answer. |
| Unidentified look-over 404 | **Unresolved, not rejected.** Review provides no URL/status initiator log. The page's media URL matches the existing `/api/consult/[id]/media/[file]` route. No browser was authorized. Coordinator must capture the actual failing request; no speculative resource was changed. |

## Domain review disposition

| Required item | Result / implementation |
|---|---|
| 1 Template merge | `template-merge.ts`, model, controller, protocol: OR requirements, additive room/fixture/door/selection minima, max for shared systems, all prefixed pinned presets, area-labelled instances. Whole-home uses the pinned nested templates' lists; basement Bath answers add the bath list and materialize it. |
| 2 Duration | `words.ts`: minute ranges for templates/add-ons, summed hour total, `visitTiming` returns split hint separately, no hint in spoken duration, whole-home retains “or two scheduled visits”. Schedule includes add-ons. |
| 3 RRP | `rrp.ts`, protocol, model: seed disturbance/replacement rule with conservative unknown era, committed pamphlet initials and given answer, expiry on visit/planned start, reasoned recorded skip with deliver-before-start to-do. Era “No” fires a flag. `WrapClose.tsx` reads facts and links to Era. Snapshot reads Settings keys `rrp_firm_cert_number` / `rrp_firm_cert_expiry`, controller prefills new Era instances. Settings UI must expose those keys if not already populated. |
| 4 Noisy flags | Seed shared/template modules: cast iron needs cracks/rust/weeping; water yes/no with details; separation choice; insulation No; bedroom egress/lot/soil language reads as a check. |
| 5 Electric | Required fuel-appliance yes/no; vent rows conditional on not explicitly No; Electric — no venting available. |
| 6 Bath | None — half bath; existing footprint conditional; fan details conditional; attic/no-exit choices. |
| 7 Footings | Editable 42-inch start prefill and prefill derivation; floating/shallow or depth <42 flags city-approved detail. |
| 8 Egress | Conditional well ladder question; deep wells cannot meet egress without ladder/steps. |
| 9 Script placeholders | Missing date becomes a direction, no-open-selection line omitted. Helper omission remains intentional for single-visitor Phase 1. |
| 10 Ranges/triggers/trades | Component ranges in schema, keypad and SQL validation; new tub capacity >60 triggers heater check; structure, footing and asbestos add trade prompts. |

Seed test expectation changes are intentional review-approved content only: conditional fan/footprint and vent requirements; added stack-condition, fuel-appliance, tub-capacity, basement water-detail and well-ladder fields; pamphlet/shallow-footing flags; corrected check wording. Script fidelity assertions remain intact.

## Design review logic handoff

Items 1, 2, 9 and 11 have logic changes. New/changed UI contracts:

- `pin_invalid`: show inline 6–12-digit validation, do not suggest signing in. `device_access_denied` has its own other-device result; unknown failures no longer imply sign-in.
- `State.lastSendFailure: {code, at} | null`, and encrypted `LocalVisit.last_send_failure`: render Last try via `plainWords(code)`, Retry, and an action banner after a minute. `last_send` is still the successful-send timestamp. Weak-signal sending copy needs the builder's connection-aware rendering.
- `LocalVisit.close_intent` holds evidence and the exact close request once receipts are available. `closing.step = waiting_signal` persists across reload via this intent and resumes automatically; dismissing the sheet does not cancel it.
- `VisitModel.rrp` has derived `applies`, `receipt`, `firm_current`, `renovator_current`; no free certification overrides. Readout and Go to Era are wired.
- `visitTiming(keys)` returns `{minutes:[min,max], duration, suggestSplit, components:[{key,minutes}]}`. `visitDuration` returns duration only. Render the office hint separately, hide when no templates, include add-ons. Spoken text must not read the office hint.
- Owner move uses `assign` with `missing_device_reason`, including same visitor. `missing_device_manifest_required` is actionable. Recovery control is deliberately plain for the next UI pass; it only operates on the original encrypted device copy/PIN and keeps original authors.
- Settings prefill keys are `rrp_firm_cert_number` and `rrp_firm_cert_expiry`.

Design-only layout/copy work remains with the Claude builder. No visual acceptance is claimed. Coordinator still needs cold offline reload, offline answers/photos/Close, revoked reconnect, open-tab expiry, missing-device takeover and retained-build recovery checks, plus the actual look-over 404 request.

## Verification

119 tests passed, zero failures/skips in the requested 23 files plus `consult-r1-logic` and `consult-migration-bootstrap` (original 109 retained; 10 additional regressions). Files ran individually using the disposable harness with `SJC_TEST_CLUSTER_TAG=consult`. Bootstrap test passed without narrow roles and after later provisioning. The harness cluster is stopped. Locked/niced tsc returned `exit=0`; role scan returned `exit=0`; `git diff --check` passed. The unidentified 404 is the one unresolved engineering observation.
