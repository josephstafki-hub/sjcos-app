# Designer integration contract (A21 · A15 · A19)

**Status 2026-09-23:** the full 2D/3D designer (`components/floor/*`,
`lib/plan-designs.ts`, PRs #28–#30) is the design tool SJC OS integrates. This
document is the contract the estimating, owner-time and portal features hold
it to. It does not build a second planner; gaps are listed at the end for the
designer's owner.

## Identity and versions

- A design is `plan_designs.id`; a saved revision is `plan_design_versions.id`
  with `version_number` and a content hash. `lib/designer-contract.ts
  revisionLabel(designId, versionNumber, contentHash)` is the label every
  downstream record carries (`design:<id>@v<n>#<hash8>`).
- Estimates never read the live document. `designQuantitiesForEstimate(run,
  designId, versionId)` refuses an unsaved/live doc unless `allowLive` is
  explicitly set, and returns quantities keyed by measure with the revision
  label and a per-quantity `reviewed` flag. Reviewed quantities are the only
  ones the estimating library treats as `basis: "plan"`; unreviewed ones land
  as `assumption` (see `lib/estimating/rules.ts`).
- `pinDesignVersion(run, versionId, by)` writes a `document_revisions` row
  (artifact kind `plan_design_version`) so a signed document, a bid package or
  an estimate line points at an immutable revision. Re-pinning the same version
  is idempotent.

## Sharing and portals

- `designSharingFor(run, designId)` lists which versions are published to
  which client-portal floorplan and when. The client portal shows only
  published versions; the sub portal shows nothing from the designer unless a
  bid package attaches an exported file (a `plan_design_files` row) for that
  exact revision. Cross-project ids are refused server-side (V19, V26 tests in
  `tests/designer-contract-db.test.mjs`).

## Owner time (A19)

- The designer shell mounts `components/floor/ActivityEmitter.tsx` when the
  viewer is the owner and the design is editable. It posts
  `DesignerActivityEvent { designId, sessionId, seq, kind, at, deviceId }`
  (`focus | heartbeat | blur | idle | end`) to `POST /api/time/events`
  (cookie session) — only on real interaction (pointer, keys, wheel); an open
  tab, background rendering or a hidden window emits nothing.
- The server resolves the project from the design (a client-sent project id is
  ignored), materialises bounded `design` intervals with the configured idle
  threshold (`app_settings owner_time.idle_threshold_seconds`, default 300 s),
  turns idle gaps into review rows and merges duplicate sessions/tabs. A
  designer interval that overlaps a confirmed site timer is flagged, never
  counted twice (`lib/owner-time/designer.ts`, `tests/owner-time-db.test.mjs`).

## Estimating (A15)

- Scope quantities from a reviewed design revision flow into
  `scope_items.quantities[].basis = "plan"` via `record_site_findings` /
  the estimating library; the `source` names the revision label.
- Design paths per scope (`set_design_path`: undefined → mood board, defined →
  selections, exact → straight to the estimate) live in `design_decisions`,
  not in the designer.

## Gaps for the designer's owner (not built here)

1. Editable import of Houzz/SketchUp/DWG files is unsupported; the Files tab
   archive/export fallback is the documented path (`/engine/houzz-exit`).
2. Quantity review UI: quantities are marked reviewed through the estimate
   target flow (`lib/actions/plan-estimate.ts`); a per-measure "reviewed"
   toggle inside the inspector is desirable.
3. Device acceptance of the 3D scene on iPad is untested (see
   `mobile-time-contract.md` for the phone side).
