import "server-only";

// Floor-plan designer reads (docs/floor-plan-designer-plan.md §10, §15).
// DB-backed: plan_designs (live docs), plan_design_versions (snapshots),
// plan_design_files (captures / sheets / underlays), plan_design_comments,
// plan_cost_rules, and the placeable slice of catalog_items. Writes live in
// lib/actions/plan-designs.ts, plan-files.ts, plan-comments.ts, plan-estimate.ts.

import { query, queryOne } from "./db";
import { DEFAULTS, docCounts, migrateDoc, type DesignerDefaults, type DocCounts, type PlanDoc } from "./plan-doc";

export interface PlanDesignSummary {
  id: number;
  name: string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  leadSlug: string | null;
  leadName: string | null;
  isTemplate: boolean;
  rev: number;
  updatedAt: string;
  updatedLabel: string;
  counts: DocCounts;
  versionCount: number;
  latestVersion: { id: number; number: number; label: string } | null;
}

export interface PlanDesign extends PlanDesignSummary {
  doc: PlanDoc;
}

export interface PlanDesignVersion {
  id: number;
  designId: number;
  number: number;
  label: string;
  createdAt: string;
  createdLabel: string;
  counts: DocCounts;
  /** Published floor-plan version id, if this snapshot was published. */
  floorplanId: number | null;
  published: boolean;
}

export interface PlanDesignFile {
  id: number;
  designId: number;
  versionId: number | null;
  fileId: string;
  kind: "capture" | "sheet_pdf" | "underlay" | "photo";
  label: string;
  camera: unknown;
  createdAt: string;
  url: string;
}

export interface PlanDesignComment {
  id: number;
  designId: number;
  versionId: number | null;
  anchor: { levelId: string; x: number; y: number; itemId?: string | null };
  authorRole: "owner" | "staff" | "client" | "agent";
  authorName: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
  createdLabel: string;
}

export interface PlanCostRule {
  id: number;
  measure: string;
  materialTag: string;
  costItemId: number;
  costItemName: string;
  unit: string;
  enabled: boolean;
}

export interface CatalogPlaceable {
  id: number;
  name: string;
  supplier: string;
  sku: string;
  category: string;
  series: string;
  price: string;
  priceCents: number | null;
  imageId: string | null;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  placeKind: string;
  costItemId: number | null;
  modelKey: string;
  material: { color?: string; roughness?: number; textureKey?: string } | null;
}

interface DesignRow {
  id: string;
  name: string;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
  lead_slug: string | null;
  lead_name: string | null;
  is_template: boolean;
  rev: number;
  updated_at: Date;
  doc: unknown;
  version_count: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  latest_version_label: string | null;
}

const DESIGN_SELECT = `
  SELECT d.id, d.name, d.project_id, p.slug AS project_slug, p.name AS project_name,
         d.lead_slug, l.name AS lead_name, d.is_template, d.rev, d.updated_at, d.doc,
         (SELECT count(*) FROM plan_design_versions v WHERE v.design_id = d.id) AS version_count,
         lv.id AS latest_version_id, lv.number AS latest_version_number, lv.label AS latest_version_label
    FROM plan_designs d
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN leads l ON l.slug = d.lead_slug
    LEFT JOIN LATERAL (
      SELECT id, number, label FROM plan_design_versions v WHERE v.design_id = d.id ORDER BY number DESC LIMIT 1
    ) lv ON true`;

export function whenLabel(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - t.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rowToSummary(r: DesignRow): PlanDesignSummary {
  const doc = migrateDoc(r.doc);
  return {
    id: Number(r.id),
    name: r.name,
    projectId: r.project_id,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    leadSlug: r.lead_slug,
    leadName: r.lead_name,
    isTemplate: r.is_template,
    rev: r.rev,
    updatedAt: r.updated_at.toISOString(),
    updatedLabel: whenLabel(r.updated_at),
    counts: docCounts(doc),
    versionCount: Number(r.version_count),
    latestVersion: r.latest_version_id
      ? { id: Number(r.latest_version_id), number: r.latest_version_number ?? 0, label: r.latest_version_label ?? "" }
      : null,
  };
}

export async function getPlanDesign(id: number): Promise<PlanDesign | null> {
  const r = await queryOne<DesignRow>(`${DESIGN_SELECT} WHERE d.id = $1`, [id]);
  if (!r) return null;
  return { ...rowToSummary(r), doc: migrateDoc(r.doc) };
}

export async function listPlanDesigns(scope: {
  projectSlug?: string;
  leadSlug?: string;
  templates?: boolean;
  all?: boolean;
} = {}): Promise<PlanDesignSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.templates) where.push(`d.is_template = true`);
  else if (scope.projectSlug) {
    params.push(scope.projectSlug);
    where.push(`p.slug = $${params.length}`);
  } else if (scope.leadSlug) {
    params.push(scope.leadSlug);
    where.push(`d.lead_slug = $${params.length}`);
  } else if (!scope.all) where.push(`d.is_template = false`);
  const sql = `${DESIGN_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY d.updated_at DESC LIMIT 200`;
  const { rows } = await query<DesignRow>(sql, params);
  return rows.map(rowToSummary);
}

export async function listPlanDesignVersions(designId: number): Promise<PlanDesignVersion[]> {
  const { rows } = await query<{
    id: string;
    design_id: string;
    number: number;
    label: string;
    created_at: Date;
    doc: unknown;
    floorplan_id: string | null;
    published_at: Date | null;
  }>(
    `SELECT v.id, v.design_id, v.number, v.label, v.created_at, v.doc,
            fp.id AS floorplan_id, fp.published_at
       FROM plan_design_versions v
       LEFT JOIN LATERAL (
         SELECT id, published_at FROM project_floorplans f WHERE f.design_version_id = v.id ORDER BY id DESC LIMIT 1
       ) fp ON true
      WHERE v.design_id = $1
      ORDER BY v.number DESC`,
    [designId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    designId: Number(r.design_id),
    number: r.number,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    createdLabel: whenLabel(r.created_at),
    counts: docCounts(migrateDoc(r.doc)),
    floorplanId: r.floorplan_id ? Number(r.floorplan_id) : null,
    published: !!r.published_at,
  }));
}

export async function getPlanDesignVersion(
  versionId: number,
): Promise<{ id: number; designId: number; number: number; label: string; doc: PlanDoc; createdAt: string } | null> {
  const r = await queryOne<{ id: string; design_id: string; number: number; label: string; doc: unknown; created_at: Date }>(
    `SELECT id, design_id, number, label, doc, created_at FROM plan_design_versions WHERE id = $1`,
    [versionId],
  );
  if (!r) return null;
  return {
    id: Number(r.id),
    designId: Number(r.design_id),
    number: r.number,
    label: r.label,
    doc: migrateDoc(r.doc),
    createdAt: r.created_at.toISOString(),
  };
}

/** A published plan's design snapshot for the client portal 3D viewer. Only
 *  resolves when the floor-plan version is published (owner gets it always). */
export async function getPublishedDesignForFloorplan(
  floorplanId: number,
): Promise<{ doc: PlanDoc; slug: string; published: boolean; designId: number; versionId: number; name: string } | null> {
  const r = await queryOne<{
    doc: unknown;
    slug: string;
    published_at: Date | null;
    design_id: string;
    version_id: string;
    name: string;
  }>(
    `SELECT v.doc, p.slug, f.published_at, d.id AS design_id, v.id AS version_id, d.name
       FROM project_floorplans f
       JOIN plan_design_versions v ON v.id = f.design_version_id
       JOIN plan_designs d ON d.id = v.design_id
       JOIN projects p ON p.id = f.project_id
      WHERE f.id = $1`,
    [floorplanId],
  );
  if (!r) return null;
  return {
    doc: migrateDoc(r.doc),
    slug: r.slug,
    published: !!r.published_at,
    designId: Number(r.design_id),
    versionId: Number(r.version_id),
    name: r.name,
  };
}

export async function listPlanDesignFiles(designId: number): Promise<PlanDesignFile[]> {
  const { rows } = await query<{
    id: string;
    design_id: string;
    version_id: string | null;
    file_id: string;
    kind: PlanDesignFile["kind"];
    label: string;
    camera: unknown;
    created_at: Date;
  }>(
    `SELECT id, design_id, version_id, file_id, kind, label, camera, created_at
       FROM plan_design_files WHERE design_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [designId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    designId: Number(r.design_id),
    versionId: r.version_id ? Number(r.version_id) : null,
    fileId: r.file_id,
    kind: r.kind,
    label: r.label,
    camera: r.camera,
    createdAt: r.created_at.toISOString(),
    url: `/api/files/${r.file_id}`,
  }));
}

export async function listPlanDesignComments(designId: number): Promise<PlanDesignComment[]> {
  const { rows } = await query<{
    id: string;
    design_id: string;
    version_id: string | null;
    anchor: PlanDesignComment["anchor"];
    author_role: PlanDesignComment["authorRole"];
    author_name: string;
    body: string;
    resolved_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, design_id, version_id, anchor, author_role, author_name, body, resolved_at, created_at
       FROM plan_design_comments WHERE design_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [designId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    designId: Number(r.design_id),
    versionId: r.version_id ? Number(r.version_id) : null,
    anchor: r.anchor,
    authorRole: r.author_role,
    authorName: r.author_name,
    body: r.body,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    createdLabel: whenLabel(r.created_at),
  }));
}

export async function getPlanCostRules(): Promise<PlanCostRule[]> {
  const { rows } = await query<{
    id: string;
    measure: string;
    material_tag: string;
    cost_item_id: string;
    name: string;
    unit: string;
    enabled: boolean;
  }>(
    `SELECT r.id, r.measure, r.material_tag, r.cost_item_id, c.name, c.unit, r.enabled
       FROM plan_cost_rules r JOIN cost_items c ON c.id = r.cost_item_id
      ORDER BY r.measure, r.material_tag`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    measure: r.measure,
    materialTag: r.material_tag,
    costItemId: Number(r.cost_item_id),
    costItemName: r.name,
    unit: r.unit,
    enabled: r.enabled,
  }));
}

/** Catalog items the designer can place or use as materials. Items without
 *  dimensions are still returned (as materials / unsized products) so the
 *  picker can prompt for a size. */
export async function getPlaceableCatalog(): Promise<CatalogPlaceable[]> {
  const { rows } = await query<{
    id: string;
    name: string;
    supplier: string;
    sku: string;
    category: string;
    series: string;
    price: string;
    price_cents: number | null;
    image_file_id: string | null;
    width_in: string | null;
    depth_in: string | null;
    height_in: string | null;
    place_kind: string;
    cost_item_id: string | null;
    model_key: string;
    material: CatalogPlaceable["material"];
  }>(
    `SELECT id, name, supplier, sku, category, series, price, price_cents, image_file_id,
            width_in, depth_in, height_in, place_kind, cost_item_id, model_key, material
       FROM catalog_items ORDER BY category, series, name LIMIT 2000`,
  );
  const num = (v: string | null) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    supplier: r.supplier,
    sku: r.sku,
    category: r.category,
    series: r.series,
    price: r.price,
    priceCents: r.price_cents,
    imageId: r.image_file_id,
    widthIn: num(r.width_in),
    depthIn: num(r.depth_in),
    heightIn: num(r.height_in),
    placeKind: r.place_kind,
    costItemId: r.cost_item_id ? Number(r.cost_item_id) : null,
    modelKey: r.model_key,
    material: r.material,
  }));
}

/** Designer defaults from app_settings (designer.* keys), falling back to the
 *  built-in DEFAULTS. */
export async function getDesignerDefaults(): Promise<DesignerDefaults> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key LIKE 'designer.%'`,
  );
  const out: DesignerDefaults = { ...DEFAULTS };
  for (const r of rows) {
    const k = r.key.slice("designer.".length) as keyof DesignerDefaults;
    if (!(k in out)) continue;
    const cur = out[k];
    if (typeof cur === "number") {
      const n = Number(r.value);
      if (Number.isFinite(n)) (out as unknown as Record<string, number>)[k] = n;
    } else {
      (out as unknown as Record<string, string>)[k] = r.value;
    }
  }
  return out;
}

/** Designs that belong to a project or lead, for the Floor tab strip. */
export async function getDesignsForScope(scope: { projectSlug?: string; leadSlug?: string }): Promise<PlanDesignSummary[]> {
  if (scope.projectSlug) return listPlanDesigns({ projectSlug: scope.projectSlug });
  if (scope.leadSlug) return listPlanDesigns({ leadSlug: scope.leadSlug });
  return [];
}
