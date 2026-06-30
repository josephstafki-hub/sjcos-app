"use server";

// Cost book write paths (Phase-2 B1). Owner-gated. Reads stay in lib/cost-book.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { COST_UNIT_VALUES, dollarsToCents } from "@/lib/cost-book-units";

type Result = { ok: true } | { ok: false; error: string };

/** Parse the shared cost-item form fields. Returns null fields validated by caller. */
function parse(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "General").trim() || "General";
  const unitRaw = String(formData.get("unit") ?? "ea");
  const unit = (COST_UNIT_VALUES as string[]).includes(unitRaw) ? unitRaw : "ea";
  const unitCost = dollarsToCents(String(formData.get("unitCost") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim();
  // markup override: blank → null (use company default)
  const markupRaw = String(formData.get("markup") ?? "").trim();
  const markup = markupRaw === "" ? null : Math.max(0, Math.min(999, Number(markupRaw) || 0));
  return { name, category, unit, unitCost, notes, markup };
}

export async function createCostItem(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parse(formData);
  if (!v.name) return { ok: false, error: "Name is required." };
  await query(
    `INSERT INTO cost_items (name, category, unit, unit_cost, default_markup, notes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [v.name, v.category, v.unit, v.unitCost, v.markup, v.notes],
  );
  revalidatePath("/cost-book");
  return { ok: true };
}

export async function updateCostItem(id: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parse(formData);
  if (!v.name) return { ok: false, error: "Name is required." };
  await query(
    `UPDATE cost_items
        SET name = $2, category = $3, unit = $4, unit_cost = $5, default_markup = $6, notes = $7
      WHERE id = $1`,
    [id, v.name, v.category, v.unit, v.unitCost, v.markup, v.notes],
  );
  revalidatePath("/cost-book");
  return { ok: true };
}

export async function setCostItemArchived(id: number, archived: boolean): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE cost_items SET archived = $2 WHERE id = $1`, [id, archived]);
  revalidatePath("/cost-book");
  return { ok: true };
}

export async function deleteCostItem(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM cost_items WHERE id = $1`, [id]);
  revalidatePath("/cost-book");
  return { ok: true };
}

/** Set the company-wide default markup % (app_settings 'estimate.default_markup'). */
export async function setDefaultMarkup(value: number): Promise<Result> {
  await requireRole("owner");
  const pct = Math.max(0, Math.min(999, Number(value) || 0));
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('estimate.default_markup', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(pct)],
  );
  revalidatePath("/cost-book");
  return { ok: true };
}
