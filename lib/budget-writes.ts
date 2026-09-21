// Project financials — writes, with NO db import. Like lib/budget-queries.ts,
// each function takes a `run(sql, params)`; the CALLER owns the transaction
// (the server action opens one on the pool; a script can wrap several writes
// and roll the lot back). Spec: docs/project-financials-plan.md §4.7.

import type { BudgetLineKind } from "./budget-types.ts";
import type { Run } from "./budget-queries.ts";

export interface EstimateLineInput {
  section: string;
  qty: number;
  unitCostCents: number;
  extendedCents: number;
}

export interface PlannedBudgetLine {
  key: string;
  trade: string;
  kind: BudgetLineKind;
  /** Planned cost: Σ round(qty × unit_cost). */
  budgetCents: number;
  /** What the client pays: Σ extended. */
  priceCents: number;
  sortOrder: number;
}

/** "SJ Carpentry labor & general conditions" → "sj-carpentry-labor-general-conditions". */
export function budgetKey(section: string): string {
  return section.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "general";
}

/** Only a section NAMED for what it is leaves `trade`: the kind just decides
 *  whether a line is drawn in the trade chart, so a wrong guess costs little,
 *  and "Materials & allowances" is mostly materials. */
export function guessLineKind(section: string): BudgetLineKind {
  const s = section.trim().toLowerCase();
  if (/^contingency\b/.test(s)) return "contingency";
  if (/^allowances?\b/.test(s)) return "allowance";
  if (/^(gc\s+)?(overhead|o\s*&\s*p|profit)\b/.test(s)) return "overhead";
  if (/^((sales|use)\s+)?tax(es)?\b|^permits?\b/.test(s)) return "tax";
  if (/^(credits?|discounts?)\b/.test(s)) return "other";
  return "trade";
}

/** One budget line per estimate section, in the estimate's order.
 *
 *  `hasMarkup` is false when every line's cost equals its price — true of the
 *  estimates imported from Houzz, which carry CLIENT prices as unit costs. Such
 *  an estimate tells us what each trade sells for and nothing about what it
 *  costs, so adopting it must not be allowed to "plan" a $0 profit. */
export function planBudgetFromEstimate(lines: EstimateLineInput[]): { lines: PlannedBudgetLine[]; hasMarkup: boolean; costCents: number; priceCents: number } {
  const bySection = new Map<string, PlannedBudgetLine>();
  const taken = new Set<string>();
  for (const l of lines) {
    const section = l.section.trim() || "General";
    let row = bySection.get(section);
    if (!row) {
      let key = budgetKey(section);
      for (let n = 2; taken.has(key); n++) key = `${budgetKey(section)}-${n}`;
      taken.add(key);
      row = { key, trade: section, kind: guessLineKind(section), budgetCents: 0, priceCents: 0, sortOrder: bySection.size };
      bySection.set(section, row);
    }
    row.budgetCents += Math.round(l.qty * l.unitCostCents);
    row.priceCents += l.extendedCents;
  }
  const planned = [...bySection.values()];
  const costCents = planned.reduce((s, r) => s + r.budgetCents, 0);
  const priceCents = planned.reduce((s, r) => s + r.priceCents, 0);
  return { lines: planned, hasMarkup: priceCents > costCents, costCents, priceCents };
}

export const NO_MARKUP_NOTE =
  "Budget adopted from an estimate that carries no markup: each trade's planned cost equals its price. " +
  "Set what each trade should actually cost, then mark the budget complete — until then profit isn't shown.";

export type AdoptResult =
  | { ok: true; estimateId: number; linesWritten: number; hasMarkup: boolean; budgetComplete: boolean; warning?: string }
  | { ok: false; error: string };

/** Turn a job's approved estimate (or a named one) into budget lines. Upserts
 *  on (project, key) and never deletes: a line that costs are already linked to
 *  must not vanish because an estimate was re-synced. Pins projects.price_cents
 *  to the estimate total when no price is set. Marks the budget complete ONLY
 *  when the estimate has real markup. */
export async function adoptEstimateAsBudget(
  run: Run,
  args: { projectId: string; estimateId?: number; replace?: boolean },
): Promise<AdoptResult> {
  const [estimate] = args.estimateId != null
    ? await run<{ id: string; total: number }>(`SELECT id, total FROM estimates WHERE id = $1 AND project_id = $2`, [args.estimateId, args.projectId])
    : await run<{ id: string; total: number }>(
        `SELECT id, total FROM estimates WHERE project_id = $1 AND status = 'approved'
          ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT 1`, [args.projectId]);
  if (!estimate) return { ok: false, error: args.estimateId != null ? "That estimate isn't on this job." : "This job has no approved estimate." };
  const estimateId = Number(estimate.id);

  const [{ n }] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM budget_lines WHERE project_id = $1`, [args.projectId]);
  if (n > 0 && !args.replace) return { ok: false, error: "This job already has budget lines. Re-sync from the estimate to update them." };

  const rows = await run<{ section: string; qty: string; unit_cost: number; extended: number }>(
    `SELECT section, qty, unit_cost, extended FROM estimate_lines WHERE estimate_id = $1 ORDER BY sort_order, id`, [estimateId]);
  if (!rows.length) return { ok: false, error: "That estimate has no lines." };
  const plan = planBudgetFromEstimate(rows.map((r) => ({
    section: r.section, qty: Number(r.qty), unitCostCents: Number(r.unit_cost), extendedCents: Number(r.extended),
  })));

  for (const l of plan.lines) {
    await run(
      `INSERT INTO budget_lines (project_id, key, trade, kind, budget_cents, price_cents, source, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, key) DO UPDATE
         SET trade = EXCLUDED.trade, budget_cents = EXCLUDED.budget_cents, price_cents = EXCLUDED.price_cents,
             source = EXCLUDED.source, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [args.projectId, l.key, l.trade, l.kind, l.budgetCents, l.priceCents, `Estimate #${estimateId} · ${l.trade}`, l.sortOrder],
    );
  }

  const [project] = await run<{ budget_complete: boolean }>(
    `UPDATE projects
        SET price_cents = COALESCE(price_cents, $2),
            budget_complete = budget_complete OR $3,
            budget_notes = CASE WHEN $3 OR budget_notes @> to_jsonb($4::text) THEN budget_notes
                                ELSE budget_notes || to_jsonb($4::text) END,
            updated_at = now()
      WHERE id = $1
      RETURNING budget_complete`,
    [args.projectId, Number(estimate.total), plan.hasMarkup, NO_MARKUP_NOTE],
  );

  return {
    ok: true, estimateId, linesWritten: plan.lines.length, hasMarkup: plan.hasMarkup,
    budgetComplete: project?.budget_complete === true,
    warning: plan.hasMarkup ? undefined : NO_MARKUP_NOTE,
  };
}
