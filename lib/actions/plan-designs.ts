"use server";

// Floor-plan designer write paths (docs/floor-plan-designer-plan.md §10).
// Owner/staff (projects area) gated: create / rename / duplicate / delete a
// design, save the live doc with an optimistic rev check, cut immutable
// versions, restore one, and persist designer defaults. Reads stay in
// lib/plan-designs.ts. Publishing to the client and estimate generation live in
// lib/actions/plan-publish.ts and plan-estimate.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { getDesignerDefaults } from "@/lib/plan-designs";
import { DEFAULTS, emptyDoc, migrateDoc, parseDoc, type DesignerDefaults, type PlanDoc } from "@/lib/plan-doc";
import { withRooms } from "@/lib/plan-geometry";
import { roomTemplate } from "@/lib/plan-library";

type Result = { ok: boolean; error?: string };

const MAX_NAME = 80;
const cleanName = (v: unknown) => String(v ?? "").trim().slice(0, MAX_NAME);

async function revalidateDesign(id: number) {
  const row = await queryOne<{ project_slug: string | null; lead_slug: string | null }>(
    `SELECT p.slug AS project_slug, d.lead_slug FROM plan_designs d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = $1`,
    [id],
  );
  revalidatePath(`/floor/${id}`);
  revalidatePath("/floor");
  if (row?.project_slug) revalidatePath(`/projects/${row.project_slug}`);
  if (row?.lead_slug) revalidatePath(`/leads/${row.lead_slug}`);
}

/** Create a design on a project or a lead, optionally seeded from a room
 *  template (lib/plan-library) or by duplicating another design. */
export async function createPlanDesign(input: {
  projectSlug?: string;
  leadSlug?: string;
  name?: string;
  templateKey?: string;
  fromDesignId?: number;
  asTemplate?: boolean;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const name = cleanName(input.name) || "Kitchen";

  let projectId: string | null = null;
  let leadSlug: string | null = null;
  if (input.projectSlug) {
    const p = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [input.projectSlug]);
    if (!p) return { ok: false, error: "Project not found." };
    projectId = p.id;
  } else if (input.leadSlug) {
    const l = await queryOne<{ slug: string }>(`SELECT slug FROM leads WHERE slug = $1`, [input.leadSlug]);
    if (!l) return { ok: false, error: "Lead not found." };
    leadSlug = l.slug;
  } else if (!input.asTemplate) {
    return { ok: false, error: "A design needs a project or a lead." };
  }

  const defaults = await getDesignerDefaults();
  let doc: PlanDoc = emptyDoc(defaults);

  if (input.fromDesignId) {
    const src = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [input.fromDesignId]);
    if (!src) return { ok: false, error: "Source design not found." };
    doc = migrateDoc(src.doc);
    doc.meta = { ...doc.meta, createdFrom: { designId: input.fromDesignId, versionId: null } };
  } else if (input.templateKey) {
    const t = roomTemplate(input.templateKey);
    if (!t) return { ok: false, error: "Unknown room template." };
    const built = t.build(doc.levels[0].id, { x: 0, y: 0 }, defaults);
    doc.walls = built.walls;
    doc.openings = built.openings;
    doc.items = built.items;
    doc.notes = built.notes ?? [];
    doc.meta = { ...doc.meta, templateOf: t.key };
    doc = withRooms(doc);
  }

  const parsed = parseDoc(doc);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_designs (project_id, lead_slug, name, is_template, doc, rev, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, 0, $6) RETURNING id`,
    [projectId, leadSlug, name, !!input.asTemplate && !projectId && !leadSlug, JSON.stringify(parsed.doc), user.id],
  );
  const id = Number(row!.id);
  await revalidateDesign(id);
  return { ok: true, id };
}

/** Save the live doc. `rev` must match the stored rev; on mismatch the newer
 *  doc comes back so the client can offer reload / save-as-copy. */
export async function savePlanDesign(
  id: number,
  doc: unknown,
  rev: number,
): Promise<{ ok: true; rev: number } | { ok: false; error: string; conflict?: { rev: number; doc: PlanDoc } }> {
  const user = await requireAccess("projects");
  const parsed = parseDoc(doc);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const updated = await queryOne<{ rev: number }>(
    `UPDATE plan_designs
        SET doc = $2::jsonb, rev = rev + 1, updated_at = now(), updated_by = $3
      WHERE id = $1 AND rev = $4
      RETURNING rev`,
    [id, JSON.stringify(parsed.doc), user.id, rev],
  );
  if (updated) return { ok: true, rev: updated.rev };

  const current = await queryOne<{ rev: number; doc: unknown }>(`SELECT rev, doc FROM plan_designs WHERE id = $1`, [id]);
  if (!current) return { ok: false, error: "Design not found." };
  return {
    ok: false,
    error: `This design was changed elsewhere (rev ${current.rev}).`,
    conflict: { rev: current.rev, doc: migrateDoc(current.doc) },
  };
}

export async function renamePlanDesign(id: number, name: string): Promise<Result> {
  await requireAccess("projects");
  const n = cleanName(name);
  if (!n) return { ok: false, error: "Give the design a name." };
  await query(`UPDATE plan_designs SET name = $2, updated_at = now() WHERE id = $1`, [id, n]);
  await revalidateDesign(id);
  return { ok: true };
}

export async function duplicatePlanDesign(id: number, name?: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const src = await queryOne<{ project_id: string | null; lead_slug: string | null; name: string; doc: unknown }>(
    `SELECT project_id, lead_slug, name, doc FROM plan_designs WHERE id = $1`,
    [id],
  );
  if (!src) return { ok: false, error: "Design not found." };
  const doc = migrateDoc(src.doc);
  doc.meta = { ...doc.meta, createdFrom: { designId: id, versionId: null } };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_designs (project_id, lead_slug, name, doc, rev, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, 0, $5) RETURNING id`,
    [src.project_id, src.lead_slug, cleanName(name) || `${src.name} copy`, JSON.stringify(doc), user.id],
  );
  const newId = Number(row!.id);
  await revalidateDesign(newId);
  return { ok: true, id: newId };
}

/** Save the current design as a reusable template (no project / lead). */
export async function savePlanAsTemplate(id: number, name: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const src = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [id]);
  if (!src) return { ok: false, error: "Design not found." };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_designs (name, is_template, doc, rev, updated_by) VALUES ($1, true, $2::jsonb, 0, $3) RETURNING id`,
    [cleanName(name) || "Template", JSON.stringify(migrateDoc(src.doc)), user.id],
  );
  revalidatePath("/floor");
  return { ok: true, id: Number(row!.id) };
}

export async function deletePlanDesign(id: number): Promise<Result> {
  await requireAccess("projects");
  const row = await queryOne<{ project_slug: string | null; lead_slug: string | null }>(
    `SELECT p.slug AS project_slug, d.lead_slug FROM plan_designs d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Design not found." };
  await query(`DELETE FROM plan_designs WHERE id = $1`, [id]);
  revalidatePath("/floor");
  if (row.project_slug) revalidatePath(`/projects/${row.project_slug}`);
  if (row.lead_slug) revalidatePath(`/leads/${row.lead_slug}`);
  return { ok: true };
}

/** Cut an immutable snapshot of the live doc. */
export async function savePlanVersion(
  id: number,
  label: string,
): Promise<{ ok: true; versionId: number; number: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const src = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [id]);
  if (!src) return { ok: false, error: "Design not found." };
  const row = await queryOne<{ id: string; number: number }>(
    `INSERT INTO plan_design_versions (design_id, number, label, doc, created_by)
     VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM plan_design_versions WHERE design_id = $1), $2, $3::jsonb, $4)
     RETURNING id, number`,
    [id, cleanName(label), JSON.stringify(migrateDoc(src.doc)), user.id],
  );
  await revalidateDesign(id);
  return { ok: true, versionId: Number(row!.id), number: row!.number };
}

/** Replace the live doc with a snapshot (bumps rev; the current live doc is
 *  first saved as a version labelled "Before restore" so nothing is lost). */
export async function restorePlanVersion(versionId: number): Promise<{ ok: true; rev: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const v = await queryOne<{ design_id: string; number: number; doc: unknown }>(
    `SELECT design_id, number, doc FROM plan_design_versions WHERE id = $1`,
    [versionId],
  );
  if (!v) return { ok: false, error: "Version not found." };
  const designId = Number(v.design_id);
  const live = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [designId]);
  if (!live) return { ok: false, error: "Design not found." };
  await query(
    `INSERT INTO plan_design_versions (design_id, number, label, doc, created_by)
     VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM plan_design_versions WHERE design_id = $1), $2, $3::jsonb, $4)`,
    [designId, `Before restoring v${v.number}`, JSON.stringify(migrateDoc(live.doc)), user.id],
  );
  const updated = await queryOne<{ rev: number }>(
    `UPDATE plan_designs SET doc = $2::jsonb, rev = rev + 1, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING rev`,
    [designId, JSON.stringify(migrateDoc(v.doc)), user.id],
  );
  await revalidateDesign(designId);
  return { ok: true, rev: updated!.rev };
}

export async function deletePlanVersion(versionId: number): Promise<Result> {
  await requireAccess("projects");
  const v = await queryOne<{ design_id: string; published: string | null }>(
    `SELECT v.design_id, (SELECT id FROM project_floorplans f WHERE f.design_version_id = v.id LIMIT 1) AS published
       FROM plan_design_versions v WHERE v.id = $1`,
    [versionId],
  );
  if (!v) return { ok: false, error: "Version not found." };
  if (v.published) return { ok: false, error: "This version was published to the client — remove that floor plan first." };
  await query(`DELETE FROM plan_design_versions WHERE id = $1`, [versionId]);
  await revalidateDesign(Number(v.design_id));
  return { ok: true };
}

/** Persist Settings → Designer defaults (designer.* app_settings keys). */
export async function saveDesignerDefaults(values: Partial<DesignerDefaults>): Promise<Result> {
  await requireAccess("projects");
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    const base = DEFAULTS[k as keyof DesignerDefaults];
    let value: string;
    if (typeof base === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 600) return { ok: false, error: `${k} must be a number of inches.` };
      value = String(n);
    } else value = String(v ?? "").slice(0, 64);
    await query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [`designer.${k}`, value],
    );
  }
  revalidatePath("/settings");
  revalidatePath("/floor");
  return { ok: true };
}
