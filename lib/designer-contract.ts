// The agreed interfaces over the EXISTING floor-plan designer (A21 / A19 /
// A15). Nothing here replaces or forks the designer (lib/plan-*.ts,
// components/floor/*); it only names the identities and exports the other
// workstreams consume:
//
//   • stable design id (plan_designs.id) + immutable version
//     (plan_design_versions.id / number) — the "revision" every quantity
//     export and time event cites;
//   • project link (plan_designs.project_id / lead_slug), units (inches in
//     the doc; sf / lf / ea in measures);
//   • export refs (plan_design_files: capture / sheet_pdf / underlay / photo);
//   • quantity export with provenance (designQuantitiesForEstimate);
//   • active-session events (DesignerActivityEvent → lib/owner-time);
//   • client sharing (project_floorplans publish / client approval);
//   • signed / approved design artifacts pinned via document_revisions.
//
// Pure module: Run-based + the pure plan libs, importable from tests and
// from the MCP server. Human-readable contract: docs/automation-reliability/
// designer-contract.md. Gaps against the designer plan §13 stretch list:
// docs/automation-reliability/designer-gaps.md.

import type { Run } from "./commands/core.ts";
import { hashInput } from "./commands/core.ts";
import { migrateDoc, type PlanDoc } from "./plan-doc.ts";
import { computeMeasures, productLines, summarizeMeasures, type MeasureUnit } from "./plan-measures.ts";
import { pinRevision, currentRevision, revisionRef, type DocumentRevision } from "./closeout/revisions.ts";

// ── Identities ───────────────────────────────────────────────────────────────

export interface DesignRef {
  designId: number;
  /** Immutable snapshot id; null = the live (autosaved) doc, which is NOT a revision. */
  versionId: number | null;
  versionNumber: number | null;
  projectId: string | null;
  leadSlug: string | null;
  /** "design:<id>@v<n>#<hash12>" — cite this on every derived record. */
  revision: string;
  contentHash: string;
  units: { length: "in"; area: "sf"; linear: "lf" };
}

export function revisionLabel(designId: number, versionNumber: number | null, contentHash: string): string {
  return `design:${designId}@${versionNumber == null ? "live" : `v${versionNumber}`}#${contentHash.slice(0, 12)}`;
}

/** Resolve a design (+ optional version) into its identity. Refuses a version
 *  that belongs to a different design. */
export async function resolveDesignRef(run: Run, designId: number, versionId: number | null): Promise<{ ref: DesignRef; doc: PlanDoc } | null> {
  const [d] = await run<{ id: string; project_id: string | null; lead_slug: string | null; doc: unknown }>(`SELECT id, project_id, lead_slug, doc FROM plan_designs WHERE id = $1`, [designId]);
  if (!d) return null;
  let doc: unknown = d.doc;
  let versionNumber: number | null = null;
  if (versionId != null) {
    const [v] = await run<{ id: string; design_id: string; number: number; doc: unknown }>(`SELECT id, design_id, number, doc FROM plan_design_versions WHERE id = $1`, [versionId]);
    if (!v || Number(v.design_id) !== designId) return null;
    doc = v.doc;
    versionNumber = v.number;
  }
  const migrated = migrateDoc(doc);
  const contentHash = hashInput(migrated);
  return {
    ref: {
      designId,
      versionId,
      versionNumber,
      projectId: d.project_id,
      leadSlug: d.lead_slug,
      revision: revisionLabel(designId, versionNumber, contentHash),
      contentHash,
      units: { length: "in", area: "sf", linear: "lf" },
    },
    doc: migrated,
  };
}

// ── Quantity export (A15) ────────────────────────────────────────────────────

export interface DesignQuantity {
  key: string;
  label: string;
  unit: MeasureUnit;
  quantity: number;
  /** True only when the doc marks the underlying dimensions as measured on
   *  site. The designer has no such flag yet, so everything is an assumption. */
  verified: boolean;
  assumption: string | null;
  materialTag?: string;
  catalogId?: number | null;
  revision: string;
  sourceElementIds: string[];
}

export interface DesignQuantityExport {
  ref: DesignRef;
  items: DesignQuantity[];
  /** Placed catalog / library products (one line each). */
  products: { label: string; qty: number; catalogId: number | null; libraryKey: string | null; kind: string; revision: string }[];
  exportedAt: string;
  /** Provenance hash of (revision, items) for the estimate side. */
  provenance: string;
}

/** Quantities from an IMMUTABLE version (live docs are refused unless
 *  allowLive) — an estimate must cite a revision that cannot change. */
export async function designQuantitiesForEstimate(run: Run, designId: number, versionId: number | null, opts: { allowLive?: boolean } = {}): Promise<DesignQuantityExport | { error: string }> {
  if (versionId == null && !opts.allowLive) return { error: "Quantities for an estimate must come from a saved version (immutable), not the live doc. Save a version first." };
  const r = await resolveDesignRef(run, designId, versionId);
  if (!r) return { error: "Design/version not found or version belongs to another design." };
  const measures = computeMeasures(r.doc);
  const verifiedDims = !!(r.doc as unknown as { meta?: { verifiedDimensions?: boolean } }).meta?.verifiedDimensions;
  const byKey = new Map<string, DesignQuantity>();
  for (const m of measures) {
    const k = `${m.key}|${m.materialTag}`;
    const cur = byKey.get(k);
    if (cur) {
      cur.quantity = Math.round((cur.quantity + m.qty) * 1000) / 1000;
      cur.sourceElementIds.push(...m.elementIds);
      continue;
    }
    byKey.set(k, {
      key: m.key,
      label: m.label,
      unit: m.unit,
      quantity: m.qty,
      verified: verifiedDims,
      assumption: verifiedDims ? null : "dimensions drawn in the designer, not field-verified",
      materialTag: m.materialTag,
      revision: r.ref.revision,
      sourceElementIds: [...m.elementIds],
    });
  }
  const items = [...byKey.values()];
  const products = productLines(r.doc).map((p) => ({ label: p.label, qty: p.qty, catalogId: p.catalogId, libraryKey: p.libraryKey, kind: p.kind, revision: r.ref.revision }));
  void summarizeMeasures;
  return { ref: r.ref, items, products, exportedAt: new Date().toISOString(), provenance: hashInput({ revision: r.ref.revision, items: items.map((i) => [i.key, i.materialTag, i.quantity]) }) };
}

// ── Active-session events (A19) ──────────────────────────────────────────────

/** What the designer shell posts (components/floor/ActivityEmitter.tsx →
 *  POST /api/mobile/time/events { designer: [...] }). The server resolves the
 *  project from the design; a client-sent project id is ignored. */
export interface DesignerActivityEvent {
  designId: number;
  sessionId: string;
  seq: number;
  kind: "focus" | "heartbeat" | "blur" | "idle" | "end";
  at: string; // ISO
  deviceId?: string;
}

// ── Client sharing ───────────────────────────────────────────────────────────

export interface DesignSharing {
  designId: number;
  versionId: number;
  versionNumber: number;
  floorplanId: number;
  publishedAt: string | null;
  clientApprovedAt: string | null;
  clientApprovedName: string;
}

/** Versions the client can see (project_floorplans rows that point at a
 *  design version and are published). Portal reads must go through this. */
export async function designSharingFor(run: Run, designId: number): Promise<DesignSharing[]> {
  return run<DesignSharing>(
    `SELECT f.design_id::int AS "designId", f.design_version_id::int AS "versionId", v.number AS "versionNumber", f.id::int AS "floorplanId",
            f.published_at::text AS "publishedAt", f.client_approved_at::text AS "clientApprovedAt", f.client_approved_name AS "clientApprovedName"
       FROM project_floorplans f JOIN plan_design_versions v ON v.id = f.design_version_id
      WHERE f.design_id = $1 AND f.published_at IS NOT NULL ORDER BY v.number DESC`,
    [designId],
  );
}

// ── Signed / approved artifacts ──────────────────────────────────────────────

/** Pin a design version as an approved/signed artifact. A version is already
 *  immutable; pinning gives decisions an artifact_revision to bind to. */
export async function pinDesignVersion(run: Run, versionId: number, pinnedBy: string): Promise<{ ref: DesignRef; revision: DocumentRevision; artifactRevision: string } | { error: string }> {
  const [v] = await run<{ design_id: string }>(`SELECT design_id FROM plan_design_versions WHERE id = $1`, [versionId]);
  if (!v) return { error: "No such version." };
  const r = await resolveDesignRef(run, Number(v.design_id), versionId);
  if (!r) return { error: "Version unresolved." };
  const { revision } = await pinRevision(run, "plan_design_version", versionId, { contentHash: r.ref.contentHash, revision: r.ref.revision }, pinnedBy);
  return { ref: r.ref, revision, artifactRevision: revisionRef(revision) };
}

export async function designVersionPinned(run: Run, versionId: number): Promise<DocumentRevision | null> {
  return currentRevision(run, "plan_design_version", versionId);
}
