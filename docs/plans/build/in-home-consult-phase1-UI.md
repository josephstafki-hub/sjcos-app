# Phase 1 consult UI — handoff

Builds on `in-home-consult-phase1-HANDOFF.md` (backend). Phase 1 per Joe 2026-11-02:
no audio, no AI, no owner review. "Complete" is the server's §10.3 test alone; the
desktop visit page is an optional look-over.

## What is where

| Piece | Files |
|---|---|
| Field app (phone 390 / tablet 820 portrait / tablet 1180 landscape) | `app/consult/[id]/page.tsx` → `components/consult/field/ConsultApp.tsx` (+ `GetReady`, `VisitScreen`, `FieldRow`, `Keypad`, `SkipSheet`, `WrapClose`, `ClientView`, `primitives`) |
| Visit list `/consult/` | `app/consult/page.tsx`, `components/consult/field/VisitList.tsx` |
| Pure logic (tested) | `lib/consult/ui/model.ts` (marks, sections, counts, wrap list, flags, conflicts, revision prediction, evidence), `ops.ts` (op envelopes), `words.ts` (every on-screen word + error code → plain words) |
| Engine wiring | `lib/consult/ui/controller.ts` — getReady, vault unlock, one OfflineEngine, capture/captureBlob, UI-driven replay, close (drain → evidence → exact manifest → close), reopen, apply findings, PIN hand back, lock |
| Server reads | `lib/consult/ui/server.ts` (same minted person context as the API for the snapshot) |
| Owner entry point | `components/consult/office/ConsultProjectCard.tsx` (Project › Overview aside), `ScheduleDialog.tsx` (Schedule, Change who goes) |
| Desktop look-over | `app/(os)/projects/[slug]/consult/[id]/page.tsx` (+ `loading.tsx`), `components/consult/office/LookOverActions.tsx` |
| Shared mark | `components/ui/CoverageMark.tsx` + `lib/checklist-coverage/contract.ts`, copied verbatim from `t3/discovery-checklist-backend` |
| Scope page link | "Open the in-home consultation →" beside Site-visit plan |
| Permissions | `/consult` added to the `projects` area paths |

## Offline bundle — how it is produced

The backend service worker (`public/sw.js`) admits only `/consult/offline.html` and
`/consult/assets/*` into CacheStorage, and answers a disconnected `/consult/…`
navigation with `offline.html`. Next route chunks (`/_next/static/…`) and RSC are never
cached, so the offline UI is a separate static bundle of the **same components**:

1. `next build` loads `next.config.ts`; in `PHASE_PRODUCTION_BUILD` it runs
   `scripts/build-consult-capture.mjs` once (env flag guards worker re-evaluation).
2. That script bundles `components/consult/field/capture-entry.tsx` with Next's own
   compiled webpack + SWC (`scripts/consult-capture-loader.cjs`) into one chunk
   `public/consult/assets/capture.js` (React included, minified by SWC), and runs
   Tailwind (PostCSS, `source(none)` + `@source` on the field components) over the
   app tokens + `app/consult/consult.css` into `public/consult/assets/capture.css`.
3. It then runs the backend's `scripts/consult-precache.mjs`, which hashes
   `offline.html` + every asset into `public/consult/precache.json` with a
   content-derived build id. Get ready fetches that file and uses its `build` as
   `OfflineIdentity.build`; the SW verifies every hash before "Offline pages" ticks.

Manual: `node scripts/build-consult-capture.mjs` (≈1 s, ~350 MB). Skip during a build:
`SJC_SKIP_CONSULT_CAPTURE=1`. Outputs are gitignored. Offline fonts fall back to
Georgia / system-ui / ui-monospace (next/font files are not in the shell).

## Backend asks (not done here)

1. **Signature fields** — `consult_capture_answer` refuses type `signature`, so
   `closing.client_initials` could never count and every visit stayed Needs finishing.
   Fixed minimally in `protocol.completion()` (this branch): committed `initials` media
   for that exact instance + field answers it. Please review/keep.
2. **Second initials** — the close manifest has one `initials_hash` and close refuses
   any other committed initials, so Renovate Right pamphlet initials
   (`era.pamphlet_initials`) can't be captured without breaking close. The UI records
   the receipt in Before you wrap and leaves that field to be skipped.
3. **Device sequence across partitions** — a new partition (new build after deploy, or
   new session epoch after re-login) starts `next_seq` at 1 while the server expects
   `last_ack_seq + 1` on the same device/epoch → `sequence_gap`. `prepare_device`
   should return `last_ack_seq` (or bump the epoch when the device has no pending work).
   The UI keeps using an existing enrollment while its lease is valid to avoid this.
4. **Visitor notes** on Schedule — `schedule` has no notes input; the field is omitted.
5. **Prefill** ("What we know so far", Still right ✓ / Correct) — the snapshot carries no
   lead/rough-estimate prefill and no project/client display; the page server adds the
   display block, and prefill is not shown.
6. **Draft persistence** — flag decisions, trade walks, RRP and shot skips live in the
   queue `projection` and persist with the next captured op; the engine has no
   "save projection" call, so a crash between those taps and the next answer loses them.
