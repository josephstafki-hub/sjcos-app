"use server";

// Estimate write paths (Phase-2 B2). Owner-gated. Reads stay in lib/estimates.ts.
// Money is cents. Estimate totals are recomputed from the lines after every line
// mutation. Lines snapshot their unit_cost/markup so later cost-book edits don't
// rewrite historical estimates.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { dollarsToCents } from "@/lib/cost-book-units";
import { ai } from "@/lib/ai";
import type { EstimateRail } from "@/lib/estimates";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const RAILS: EstimateRail[] = ["design_build", "plans", "merged"];

/** Recompute + persist an estimate's subtotal / markup / total from its lines. */
async function recompute(estimateId: number) {
  await query(
    `UPDATE estimates
        SET subtotal = s.sub, total = s.tot, markup_total = s.tot - s.sub
       FROM (
         SELECT COALESCE(round(sum(qty * unit_cost)), 0)::int AS sub,
                COALESCE(sum(extended), 0)::int            AS tot
           FROM estimate_lines WHERE estimate_id = $1
       ) s
      WHERE estimates.id = $1`,
    [estimateId],
  );
}

function parseLine(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const section = String(formData.get("section") ?? "General").trim() || "General";
  const unit = String(formData.get("unit") ?? "ea").trim() || "ea";
  const qty = Math.max(0, Number(formData.get("qty")) || 0);
  const unitCost = dollarsToCents(String(formData.get("unitCost") ?? ""));
  const markup = Math.max(0, Math.min(999, Number(formData.get("markup")) || 0));
  const costItemRaw = String(formData.get("costItemId") ?? "").trim();
  const costItemId = costItemRaw && /^\d+$/.test(costItemRaw) ? Number(costItemRaw) : null;
  const extended = Math.round(qty * unitCost * (1 + markup / 100));
  return { description, section, unit, qty, unitCost, markup, costItemId, extended };
}

export async function createEstimate(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const title = String(formData.get("title") ?? "").trim() || "Estimate";
  const railRaw = String(formData.get("rail") ?? "plans") as EstimateRail;
  const rail = RAILS.includes(railRaw) ? railRaw : "plans";

  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO estimates (project_id, title, rail, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [proj.id, title, rail, user.id],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: Number(ins!.id) };
}

export async function deleteEstimate(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM estimates WHERE id = $1`, [id]);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function addEstimateLine(estimateId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  await query(
    `INSERT INTO estimate_lines
       (estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended,
        sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
        COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id = $1), 0))`,
    [estimateId, v.costItemId, v.description, v.section, v.unit, v.qty, v.unitCost, v.markup, v.extended],
  );
  await recompute(estimateId);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function updateEstimateLine(lineId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  const row = await queryOne<{ estimate_id: string }>(
    `UPDATE estimate_lines
        SET description=$2, section=$3, unit=$4, qty=$5, unit_cost=$6, markup=$7, extended=$8,
            cost_item_id=$9
      WHERE id=$1 RETURNING estimate_id`,
    [lineId, v.description, v.section, v.unit, v.qty, v.unitCost, v.markup, v.extended, v.costItemId],
  );
  if (row) await recompute(Number(row.estimate_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function deleteEstimateLine(lineId: number, slug: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ estimate_id: string }>(
    `DELETE FROM estimate_lines WHERE id = $1 RETURNING estimate_id`,
    [lineId],
  );
  if (row) await recompute(Number(row.estimate_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Qwen estimate assist: rough phased ranges to guide the owner (advisory only —
 *  not auto-inserted, since local-model dollar figures aren't precise). */
export async function suggestEstimate(
  slug: string,
  notes: string,
): Promise<{ ok: true; lines: { label: string; value: string }[]; total: string } | { ok: false; error: string }> {
  await requireRole("owner");
  const proj = await queryOne<{ name: string; stage_label: string | null }>(
    `SELECT name, stage_label FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };
  const res = await ai.estimate({
    name: proj.name,
    scope: proj.stage_label || proj.name,
    intake: [],
    notes: notes?.trim() || undefined,
  });
  return { ok: true, lines: res.lines, total: res.total };
}
