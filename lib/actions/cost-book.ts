"use server";

// Cost book write paths (Phase-2 B1). Owner-gated. Reads stay in lib/cost-book.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { COST_UNIT_VALUES, dollarsToCents } from "@/lib/cost-book-units";
import { userPrincipal, withTransaction } from "@/lib/commands/db";
import { resolveDecision } from "@/lib/commands/decisions";
import { applyMarkupDecision, proposeMarkupChange } from "@/lib/estimating/learning";

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
  await requireAccess("cost_book");
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
  await requireAccess("cost_book");
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
  await requireAccess("cost_book");
  await query(`UPDATE cost_items SET archived = $2 WHERE id = $1`, [id, archived]);
  revalidatePath("/cost-book");
  return { ok: true };
}

export async function deleteCostItem(id: number): Promise<Result> {
  await requireAccess("cost_book");
  await query(`DELETE FROM cost_items WHERE id = $1`, [id]);
  revalidatePath("/cost-book");
  return { ok: true };
}

/** Change the company-wide default markup %. It prices every new estimate,
 *  so it goes through the markup decision (A18): Joe's own change is applied
 *  at once (a new pricing setup version when one is active, plus the
 *  estimate.default_markup setting); anyone else's becomes a card Joe
 *  approves on Decisions. */
export async function setDefaultMarkup(value: number): Promise<Result & { notice?: string }> {
  const user = await requireAccess("cost_book");
  const pct = Math.max(0, Math.min(999, Number(value) || 0));
  const principal = userPrincipal(user);
  const reason = `Set from the Cost book by ${user.name || user.role}`;
  if (user.role !== "owner") {
    await withTransaction((run) => proposeMarkupChange(run, { markup_pct: pct, reason, principal }));
    revalidatePath("/cost-book");
    return { ok: true, notice: `Asked Joe to change the default markup to ${pct}%. It changes once he approves it on Decisions.` };
  }
  const r = await withTransaction(async (run) => {
    const p = await proposeMarkupChange(run, { markup_pct: pct, reason, principal });
    if (p.current_pct === pct) return { ok: true as const, markup_pct: pct };
    const res = await resolveDecision(run, { id: p.decision_id, outcome: "approved", principal, via: "app" });
    if (!res.ok) return { ok: false as const, error: res.reason };
    return applyMarkupDecision(run, p.decision_id, principal);
  });
  revalidatePath("/cost-book");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
