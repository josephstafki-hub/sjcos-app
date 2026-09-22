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

  // With markup the estimate's costs are real, so the budget is confirmed. Without
  // it the lines now carry client PRICES as costs — unverified — so any earlier
  // confirmation is withdrawn until someone sets real costs and ticks it again.
  const [project] = await run<{ budget_complete: boolean }>(
    `UPDATE projects
        SET price_cents = COALESCE(price_cents, $2),
            budget_complete = $3,
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

// ---------------------------------------------------------------------------
// The Money › Overview edit forms (docs/project-financials-plan.md §4.7).
// Every write takes the project id and checks that the row it touches belongs
// to that job, so a forged id can never reach into another project. Money is
// integer cents; the forms convert typed dollars before they call in.
//
// Nothing here creates a change order or moves one out of draft: the client
// portal lists every non-draft change order (plan §14 #19).
// ---------------------------------------------------------------------------

export type WriteResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const LINE_KINDS: readonly BudgetLineKind[] = ["trade", "allowance", "overhead", "tax", "contingency", "other"];
const CHIP_KINDS = ["default", "accent", "ai", "flag", "money", "info", "ghost", "solid"];
const EXPENSE_KINDS = ["labor", "material", "sub", "equipment", "permit", "other"];
const PAID_FROM = ["checking", "card", "cash"];
const BASES = ["fixed_price", "insurance", "cost_plus", "time_materials"];
/** A Postgres `integer` column, in cents: about ±$21M. */
const MAX_CENTS = 2_000_000_000;

const isCents = (v: unknown, min = -MAX_CENTS): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX_CENTS;
const isCentsOrNull = (v: unknown, min = -MAX_CENTS) => v === null || isCents(v, min);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const fail = (error: string) => ({ ok: false as const, error });

export interface BudgetLineInput {
  /** Omit to add a line. */
  id?: number;
  trade: string;
  kind: BudgetLineKind;
  budgetCents: number;
  priceCents: number | null;
  /** null = derive it. 0 = nothing left. */
  estToFinishCents: number | null;
  percentComplete: number | null;
  status?: string;
  statusKind?: string;
  detail?: string;
}

export async function saveBudgetLine(run: Run, projectId: string, input: BudgetLineInput): Promise<WriteResult<{ id: number }>> {
  const trade = clip(input.trade, 80);
  if (!trade) return fail("Give the trade a name.");
  if (!LINE_KINDS.includes(input.kind)) return fail("Unknown kind of line.");
  if (!isCents(input.budgetCents, 0)) return fail("The budget has to be $0 or more.");
  if (!isCentsOrNull(input.priceCents)) return fail("That price isn't a valid amount.");
  if (!isCentsOrNull(input.estToFinishCents, 0)) return fail("Still-to-spend has to be $0 or more, or left blank.");
  const pct = input.percentComplete;
  if (pct !== null && !(Number.isInteger(pct) && pct >= 0 && pct <= 100)) return fail("% done runs from 0 to 100.");
  const statusKind = CHIP_KINDS.includes(input.statusKind ?? "") ? input.statusKind : "ghost";
  const fields = [trade, input.kind, input.budgetCents, input.priceCents, input.estToFinishCents, pct, clip(input.status, 60), statusKind, clip(input.detail, 200)];

  if (input.id != null) {
    const rows = await run<{ id: string }>(
      `UPDATE budget_lines SET trade = $3, kind = $4, budget_cents = $5, price_cents = $6, est_to_finish_cents = $7,
              percent_complete = $8, status = $9, status_kind = $10, detail = $11, updated_at = now()
        WHERE id = $1 AND project_id = $2 RETURNING id`, [input.id, projectId, ...fields]);
    return rows.length ? { ok: true, id: Number(rows[0].id) } : fail("That line isn't on this job.");
  }
  const taken = new Set((await run<{ key: string }>(`SELECT key FROM budget_lines WHERE project_id = $1`, [projectId])).map((r) => r.key));
  let key = budgetKey(trade);
  for (let n = 2; taken.has(key); n++) key = `${budgetKey(trade)}-${n}`;
  const [row] = await run<{ id: string }>(
    `INSERT INTO budget_lines (project_id, key, trade, kind, budget_cents, price_cents, est_to_finish_cents, percent_complete,
                               status, status_kind, detail, source, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Entered by hand',
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM budget_lines WHERE project_id = $1))
     RETURNING id`, [projectId, key, ...fields]);
  return { ok: true, id: Number(row.id) };
}

/** Costs pointing at the line become unassigned — they still count. A line a
 *  change order credits cannot go: the cascade would erase the credit and the
 *  client's price would rise by it. Remove the credit on the CO first. */
export async function deleteBudgetLine(run: Run, projectId: string, id: number): Promise<WriteResult> {
  const credited = await run<{ number: string }>(
    `SELECT COALESCE(NULLIF(co.number, ''), 'CO-' || co.id) AS number
       FROM change_order_credits c JOIN change_orders co ON co.id = c.change_order_id
      WHERE c.budget_line_id = $1 AND co.project_id = $2`, [id, projectId]);
  if (credited.length) return fail(`This trade is credited on ${credited.map((c) => c.number).join(", ")}. Remove that credit first.`);
  const rows = await run(`DELETE FROM budget_lines WHERE id = $1 AND project_id = $2 RETURNING id`, [id, projectId]);
  return rows.length ? { ok: true } : fail("That line isn't on this job.");
}

export interface BudgetSettingsInput {
  basis: string;
  budgetLabel: string;
  budgetCaption: string;
  /** The base price EXCLUDING change orders. null = use the estimate / contract. */
  priceCents: number | null;
  retainageCents: number;
  /** The lines cover the whole job, with real costs: profit may be shown. */
  budgetComplete: boolean;
  costsThrough: string | null;
  notes: string[];
}

export async function saveBudgetSettings(run: Run, projectId: string, input: BudgetSettingsInput): Promise<WriteResult> {
  if (!BASES.includes(input.basis)) return fail("Unknown pricing basis.");
  if (!isCentsOrNull(input.priceCents, 0)) return fail("The price has to be $0 or more, or left blank.");
  if (!isCents(input.retainageCents, 0)) return fail("Retainage has to be $0 or more.");
  if (input.costsThrough !== null && !isDay(input.costsThrough)) return fail("That date isn't valid.");
  const notes = (Array.isArray(input.notes) ? input.notes : []).map((n) => clip(n, 500)).filter(Boolean).slice(0, 40);
  const rows = await run(
    `UPDATE projects SET budget_basis = $2, budget_label = $3, budget_caption = $4, price_cents = $5, retainage_cents = $6,
            budget_complete = $7, costs_through = $8, budget_notes = $9::jsonb, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [projectId, input.basis, clip(input.budgetLabel, 60), clip(input.budgetCaption, 300), input.priceCents, input.retainageCents,
     input.budgetComplete === true, input.costsThrough, JSON.stringify(notes)]);
  return rows.length ? { ok: true } : fail("Project not found.");
}

/** Where a cost belongs: a budget line, a change order, or nowhere yet. */
export type CostTarget = { kind: "line" | "co"; id: number } | null;

async function resolveTarget(run: Run, projectId: string, target: CostTarget): Promise<{ lineId: number | null; coId: number | null } | string> {
  if (target === null) return { lineId: null, coId: null };
  if (!Number.isInteger(target?.id) || (target.kind !== "line" && target.kind !== "co")) return "Unknown trade or change order.";
  const table = target.kind === "line" ? "budget_lines" : "change_orders";
  const rows = await run(`SELECT id FROM ${table} WHERE id = $1 AND project_id = $2`, [target.id, projectId]);
  if (!rows.length) return "That trade or change order isn't on this job.";
  return target.kind === "line" ? { lineId: target.id, coId: null } : { lineId: null, coId: target.id };
}

async function ownPurchaseOrder(run: Run, projectId: string, poId: number | null): Promise<string | null> {
  if (poId === null) return null;
  if (!Number.isInteger(poId)) return "Unknown purchase order.";
  const rows = await run(`SELECT id FROM purchase_orders WHERE id = $1 AND project_id = $2`, [poId, projectId]);
  return rows.length ? null : "That purchase order isn't on this job.";
}

export interface ExpenseInput {
  id?: number;
  date: string;
  vendorLabel: string;
  kind: string;
  /** Negative for a return or refund. */
  amountCents: number;
  memo?: string;
  paidFrom: string;
  /** Where it is filed. null = unassigned. On a re-import (same `sourceRef`),
   *  leaving it undefined KEEPS the filing someone already did. */
  target?: CostTarget;
  /** The PO this payment is for, so the two count once. Same rule: undefined keeps. */
  purchaseOrderId?: number | null;
  /** Stable import key ("bank:0514-3150"). Saving the same key again UPDATES that row. */
  sourceRef?: string;
}

export async function saveExpense(run: Run, projectId: string, input: ExpenseInput, userId?: string): Promise<WriteResult<{ id: number }>> {
  if (!isDay(input.date)) return fail("Pick the date it was paid.");
  const vendor = clip(input.vendorLabel, 120);
  if (!vendor) return fail("Who was paid?");
  if (!EXPENSE_KINDS.includes(input.kind)) return fail("Unknown kind of expense.");
  if (!PAID_FROM.includes(input.paidFrom)) return fail("Unknown payment method.");
  if (!isCents(input.amountCents) || input.amountCents === 0) return fail("Enter an amount (negative for a return).");
  const target = input.target === undefined ? undefined : await resolveTarget(run, projectId, input.target);
  if (typeof target === "string") return fail(target);
  const poError = input.purchaseOrderId === undefined ? null : await ownPurchaseOrder(run, projectId, input.purchaseOrderId);
  if (poError) return fail(poError);
  const doc = [input.date, vendor, input.kind, input.amountCents, clip(input.memo, 300), input.paidFrom];
  const sourceRef = clip(input.sourceRef, 120);
  if (input.id == null && sourceRef) {
    const [seen] = await run<{ id: string }>(`SELECT id FROM expenses WHERE project_id = $1 AND source_ref = $2`, [projectId, sourceRef]);
    if (seen) input = { ...input, id: Number(seen.id) };
  }

  if (input.id != null) {
    // The document decides what it says; the filing (trade, PO) only changes when the caller says so.
    const rows = await run<{ id: string }>(
      `UPDATE expenses SET expense_date = $3, vendor_label = $4, kind = $5, amount_cents = $6, memo = $7, paid_from = $8,
              budget_line_id = CASE WHEN $9 THEN $10 ELSE budget_line_id END,
              change_order_id = CASE WHEN $9 THEN $11 ELSE change_order_id END,
              purchase_order_id = CASE WHEN $12 THEN $13 ELSE purchase_order_id END
        WHERE id = $1 AND project_id = $2 RETURNING id`,
      [input.id, projectId, ...doc, target !== undefined, target?.lineId ?? null, target?.coId ?? null, input.purchaseOrderId !== undefined, input.purchaseOrderId ?? null]);
    return rows.length ? { ok: true, id: Number(rows[0].id) } : fail("That expense isn't on this job.");
  }
  const [row] = await run<{ id: string }>(
    `INSERT INTO expenses (project_id, expense_date, vendor_label, kind, amount_cents, memo, paid_from,
                           budget_line_id, change_order_id, purchase_order_id, created_by, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [projectId, ...doc, target?.lineId ?? null, target?.coId ?? null, input.purchaseOrderId ?? null, userId ?? null, sourceRef]);
  return { ok: true, id: Number(row.id) };
}

export async function deleteExpense(run: Run, projectId: string, id: number): Promise<WriteResult> {
  const rows = await run(`DELETE FROM expenses WHERE id = $1 AND project_id = $2 RETURNING id`, [id, projectId]);
  return rows.length ? { ok: true } : fail("That expense isn't on this job.");
}

const COST_TABLES = { sub_invoice: "sub_invoices", po: "purchase_orders", expense: "expenses" } as const;
export type CostSource = keyof typeof COST_TABLES;

/** File a sub invoice, a PO or an expense under a trade or a change order. */
export async function assignCost(run: Run, projectId: string, args: { source: CostSource; id: number; target: CostTarget }): Promise<WriteResult> {
  const table = COST_TABLES[args.source];
  if (!table || !Number.isInteger(args.id)) return fail("Unknown cost.");
  const target = await resolveTarget(run, projectId, args.target);
  if (typeof target === "string") return fail(target);
  const rows = await run(
    `UPDATE ${table} SET budget_line_id = $3, change_order_id = $4 WHERE id = $1 AND project_id = $2 RETURNING id`,
    [args.id, projectId, target.lineId, target.coId]);
  return rows.length ? { ok: true } : fail("That cost isn't on this job.");
}

/** Say which PO a bill or a payment is against, so the purchase counts once. */
export async function linkCostToPurchaseOrder(
  run: Run, projectId: string, args: { source: "sub_invoice" | "expense"; id: number; purchaseOrderId: number | null },
): Promise<WriteResult> {
  if ((args.source !== "sub_invoice" && args.source !== "expense") || !Number.isInteger(args.id)) return fail("Unknown cost.");
  const poError = await ownPurchaseOrder(run, projectId, args.purchaseOrderId);
  if (poError) return fail(poError);
  const rows = await run(
    `UPDATE ${COST_TABLES[args.source]} SET purchase_order_id = $3 WHERE id = $1 AND project_id = $2 RETURNING id`,
    [args.id, projectId, args.purchaseOrderId]);
  return rows.length ? { ok: true } : fail("That cost isn't on this job.");
}

/** Approve a sub's invoice, record a part payment, or mark it paid. Nothing in
 *  the app could do this before, and "spent" depends on it. */
export async function setSubInvoicePayment(
  run: Run, projectId: string, args: { id: number; status: "submitted" | "approved" | "paid"; paidCents?: number },
): Promise<WriteResult> {
  if (!["submitted", "approved", "paid"].includes(args.status) || !Number.isInteger(args.id)) return fail("Unknown status.");
  const [inv] = await run<{ amount: number }>(`SELECT amount FROM sub_invoices WHERE id = $1 AND project_id = $2`, [args.id, projectId]);
  if (!inv) return fail("That invoice isn't on this job.");
  const paid = args.status === "paid" ? Number(inv.amount) : (args.paidCents ?? 0);
  if (!isCents(paid, 0) || paid > Number(inv.amount)) return fail("Paid so far can't be more than the invoice.");
  await run(
    `UPDATE sub_invoices SET status = $3, paid_cents = $4, paid_at = CASE WHEN $3 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END
      WHERE id = $1 AND project_id = $2`, [args.id, projectId, args.status, paid]);
  return { ok: true };
}

export interface ChangeOrderCostsInput {
  id: number;
  paidBy: "owner" | "funder" | "split";
  funderShareCents: number;
  /** Planned cost, fixed when priced. null = not planned (assumed at price). */
  budgetCostCents: number | null;
  /** null = derive. 0 = nothing left. */
  estToFinishCents: number | null;
  /** Base-scope lines this CO replaces, and the price credited back for each. */
  credits: { lineId: number; amountCents: number }[];
}

/** The budget side of an EXISTING change order. Never its status or price. */
export async function saveChangeOrderCosts(run: Run, projectId: string, input: ChangeOrderCostsInput): Promise<WriteResult> {
  if (!["owner", "funder", "split"].includes(input.paidBy)) return fail("Unknown payer.");
  if (!isCents(input.funderShareCents, 0)) return fail("The funder's share has to be $0 or more.");
  if (!isCentsOrNull(input.budgetCostCents, 0)) return fail("Planned cost has to be $0 or more, or left blank.");
  if (!isCentsOrNull(input.estToFinishCents, 0)) return fail("Still-to-spend has to be $0 or more, or left blank.");
  const credits = Array.isArray(input.credits) ? input.credits : [];
  if (credits.some((c) => !Number.isInteger(c.lineId) || !isCents(c.amountCents, 0))) return fail("A credit isn't a valid amount.");
  if (new Set(credits.map((c) => c.lineId)).size !== credits.length) return fail("A trade can be credited once per change order.");

  const rows = await run(
    `UPDATE change_orders SET paid_by = $3, funder_share_cents = $4, budget_cost_cents = $5, est_to_finish_cents = $6
      WHERE id = $1 AND project_id = $2 RETURNING id`,
    [input.id, projectId, input.paidBy, input.funderShareCents, input.budgetCostCents, input.estToFinishCents]);
  if (!rows.length) return fail("That change order isn't on this job.");
  if (credits.length) {
    const own = await run<{ id: string }>(`SELECT id FROM budget_lines WHERE project_id = $1 AND id = ANY($2::bigint[])`, [projectId, credits.map((c) => c.lineId)]);
    if (own.length !== credits.length) return fail("A credited trade isn't on this job.");
    // A trade's scope is replaced by ONE change order. Two claiming it would both
    // lower the price while the trade's cost left the job only once.
    const taken = await run<{ trade: string; number: string }>(
      `SELECT bl.trade, COALESCE(NULLIF(co.number, ''), 'CO-' || co.id) AS number
         FROM change_order_credits c JOIN budget_lines bl ON bl.id = c.budget_line_id JOIN change_orders co ON co.id = c.change_order_id
        WHERE c.budget_line_id = ANY($1::bigint[]) AND c.change_order_id <> $2`, [credits.map((c) => c.lineId), input.id]);
    if (taken.length) return fail(`${taken.map((t) => `${t.trade} is already credited on ${t.number}`).join("; ")}. Remove that credit first.`);
  }
  // Replace the set: a line is "credited to" this CO exactly while a credit row says so.
  await run(`UPDATE budget_lines SET credited_co_id = NULL WHERE project_id = $1 AND credited_co_id = $2`, [projectId, input.id]);
  await run(`DELETE FROM change_order_credits WHERE change_order_id = $1`, [input.id]);
  for (const c of credits) {
    await run(`INSERT INTO change_order_credits (change_order_id, budget_line_id, amount_cents) VALUES ($1, $2, $3)`, [input.id, c.lineId, c.amountCents]);
    await run(`UPDATE budget_lines SET credited_co_id = $2 WHERE id = $1 AND project_id = $3`, [c.lineId, input.id, projectId]);
  }
  return { ok: true };
}

export interface ReconcileBillingInput {
  /** Money collected before invoices were tracked here (a Houzz deposit). */
  openingCollectedCents: number;
  openingBilledCents: number;
  note: string;
  /** Also bring projects.collected_to_date (what /today and the projects list
   *  read) into line with the reconciled figure. */
  alsoUpdateHandKept: boolean;
}

/** The reviewed switch from the hand-kept collected total to invoices + an
 *  opening balance. The caller shows both totals side by side first. */
export async function reconcileBilling(run: Run, projectId: string, input: ReconcileBillingInput): Promise<WriteResult<{ collectedCents: number }>> {
  if (!isCents(input.openingCollectedCents, 0) || !isCents(input.openingBilledCents, 0)) return fail("Opening balances have to be $0 or more.");
  if (input.openingBilledCents < input.openingCollectedCents) return fail("What was billed before can't be less than what was collected before.");
  const [{ paid }] = await run<{ paid: string }>(`SELECT COALESCE(SUM(amount), 0) AS paid FROM invoices WHERE project_id = $1 AND status = 'paid'`, [projectId]);
  const collectedCents = input.openingCollectedCents + Number(paid);
  const rows = await run(
    `UPDATE projects SET billing_source = 'invoices', opening_collected_cents = $2, opening_billed_cents = $3, opening_note = $4,
            collected_to_date = CASE WHEN $5 THEN $6 ELSE collected_to_date END, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [projectId, input.openingCollectedCents, input.openingBilledCents, clip(input.note, 300), input.alsoUpdateHandKept === true, Math.round(collectedCents / 100)]);
  return rows.length ? { ok: true, collectedCents } : fail("Project not found.");
}

/** Back to the hand-kept total. The opening balance is kept, not erased. */
export async function unreconcileBilling(run: Run, projectId: string): Promise<WriteResult> {
  const rows = await run(`UPDATE projects SET billing_source = 'manual', updated_at = now() WHERE id = $1 RETURNING id`, [projectId]);
  return rows.length ? { ok: true } : fail("Project not found.");
}

// ---------------------------------------------------------------------------
// Bulk and import-shaped writes — what an agent filling a job from documents
// needs (docs/project-financials-plan.md §8). Same rules as the forms above;
// every import-shaped write is idempotent on a stable key, so a retried import
// changes nothing.
// ---------------------------------------------------------------------------

export interface BudgetLineSpec {
  /** Stable slug. Omit to derive it from the trade name. */
  key?: string;
  trade: string;
  kind?: BudgetLineKind;
  budgetCents: number;
  priceCents?: number | null;
  estToFinishCents?: number | null;
  percentComplete?: number | null;
  status?: string;
  statusKind?: string;
  detail?: string;
  source?: string;
  flags?: string[];
}

/** Upsert many budget lines by key. `replace` also removes lines that are not
 *  in the list — but REFUSES if any of those has costs or credits pointing at
 *  it, naming them, rather than quietly turning real money into "unassigned". */
export async function setBudgetLines(
  run: Run, projectId: string, specs: BudgetLineSpec[], mode: "merge" | "replace" = "merge",
): Promise<WriteResult<{ written: number; removed: number }>> {
  if (!Array.isArray(specs) || !specs.length) return fail("Give at least one line.");
  const keys = specs.map((l) => budgetKey(clip(l.key, 60) || clip(l.trade, 80)));
  if (new Set(keys).size !== keys.length) return fail("Two lines share a key. Give each trade its own.");
  for (const [i, l] of specs.entries()) {
    if (!clip(l.trade, 80)) return fail(`Line ${i + 1} has no trade name.`);
    if (l.kind != null && !LINE_KINDS.includes(l.kind)) return fail(`${l.trade}: unknown kind.`);
    if (!isCents(l.budgetCents, 0)) return fail(`${l.trade}: the budget has to be $0 or more, in whole cents.`);
    if (l.priceCents != null && !isCents(l.priceCents)) return fail(`${l.trade}: that price isn't a valid amount.`);
    if (l.estToFinishCents != null && !isCents(l.estToFinishCents, 0)) return fail(`${l.trade}: still-to-spend has to be $0 or more.`);
    if (l.percentComplete != null && !(Number.isInteger(l.percentComplete) && l.percentComplete >= 0 && l.percentComplete <= 100)) return fail(`${l.trade}: % done runs from 0 to 100.`);
  }

  let removed = 0;
  if (mode === "replace") {
    const gone = await run<{ id: string; trade: string; costs: number }>(
      `SELECT bl.id, bl.trade,
              ((SELECT count(*) FROM sub_invoices x WHERE x.budget_line_id = bl.id) + (SELECT count(*) FROM expenses x WHERE x.budget_line_id = bl.id) +
               (SELECT count(*) FROM purchase_orders x WHERE x.budget_line_id = bl.id) + (SELECT count(*) FROM change_order_credits x WHERE x.budget_line_id = bl.id))::int AS costs
         FROM budget_lines bl WHERE bl.project_id = $1 AND NOT (bl.key = ANY($2::text[]))`, [projectId, keys]);
    const inUse = gone.filter((g) => g.costs > 0);
    if (inUse.length) return fail(`Can't replace: ${inUse.map((g) => g.trade).join(", ")} ${inUse.length === 1 ? "has" : "have"} costs or credits filed under ${inUse.length === 1 ? "it" : "them"}. Move those first, or merge instead.`);
    if (gone.length) await run(`DELETE FROM budget_lines WHERE id = ANY($1::bigint[])`, [gone.map((g) => Number(g.id))]);
    removed = gone.length;
  }

  for (const [i, l] of specs.entries()) {
    // On an existing line, a field the caller left out keeps its value.
    await run(
      `INSERT INTO budget_lines (project_id, key, trade, kind, budget_cents, price_cents, est_to_finish_cents, percent_complete,
                                 status, status_kind, detail, source, flags, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 'trade'), $5, $6, $7, $8, COALESCE($9, ''), COALESCE($10, 'ghost'), COALESCE($11, ''), COALESCE($12, ''), COALESCE($13::jsonb, '[]'),
               (SELECT COALESCE(MAX(sort_order), -1) + 1 + $14 FROM budget_lines WHERE project_id = $1))
       ON CONFLICT (project_id, key) DO UPDATE SET
         trade = EXCLUDED.trade, budget_cents = EXCLUDED.budget_cents,
         kind = COALESCE($4, budget_lines.kind),
         price_cents = CASE WHEN $15 THEN $6 ELSE budget_lines.price_cents END,
         est_to_finish_cents = CASE WHEN $16 THEN $7 ELSE budget_lines.est_to_finish_cents END,
         percent_complete = CASE WHEN $17 THEN $8 ELSE budget_lines.percent_complete END,
         status = COALESCE($9, budget_lines.status), status_kind = COALESCE($10, budget_lines.status_kind),
         detail = COALESCE($11, budget_lines.detail), source = COALESCE($12, budget_lines.source),
         flags = COALESCE($13::jsonb, budget_lines.flags), updated_at = now()`,
      [projectId, keys[i], clip(l.trade, 80), l.kind ?? null, l.budgetCents, l.priceCents ?? null, l.estToFinishCents ?? null, l.percentComplete ?? null,
       l.status == null ? null : clip(l.status, 60), l.statusKind == null ? null : (CHIP_KINDS.includes(l.statusKind) ? l.statusKind : "ghost"),
       l.detail == null ? null : clip(l.detail, 200), l.source == null ? null : clip(l.source, 200),
       l.flags == null ? null : JSON.stringify(l.flags.map((f) => clip(f, 60)).filter(Boolean).slice(0, 8)), i,
       "priceCents" in l, "estToFinishCents" in l, "percentComplete" in l],
    );
  }
  return { ok: true, written: specs.length, removed };
}

/** Change only the settings that were passed; the rest keep their values. */
export async function patchBudgetSettings(run: Run, projectId: string, patch: Partial<BudgetSettingsInput>): Promise<WriteResult> {
  const [p] = await run<Record<string, unknown>>(
    `SELECT budget_basis, budget_label, budget_caption, price_cents, retainage_cents, budget_complete,
            to_char(costs_through, 'YYYY-MM-DD') AS costs_through, budget_notes FROM projects WHERE id = $1`, [projectId]);
  if (!p) return fail("Project not found.");
  return saveBudgetSettings(run, projectId, {
    basis: String(p.budget_basis), budgetLabel: String(p.budget_label ?? ""), budgetCaption: String(p.budget_caption ?? ""),
    priceCents: p.price_cents == null ? null : Number(p.price_cents), retainageCents: Number(p.retainage_cents ?? 0),
    budgetComplete: p.budget_complete === true, costsThrough: p.costs_through == null ? null : String(p.costs_through),
    notes: Array.isArray(p.budget_notes) ? p.budget_notes.map(String) : [],
    ...patch,
  });
}

export interface PartyInput { key: string; label: string; baseShareCents: number; isOwner?: boolean }

/** Who pays for the base price. Replaces the list. At most one is the owner. */
export async function saveParties(run: Run, projectId: string, parties: PartyInput[]): Promise<WriteResult> {
  if (!Array.isArray(parties)) return fail("Give the list of payers.");
  const clean = parties.map((p) => ({ key: budgetKey(clip(p.key, 40) || clip(p.label, 40)), label: clip(p.label, 60), baseShareCents: p.baseShareCents, isOwner: p.isOwner === true }));
  if (clean.some((p) => !p.label)) return fail("Every payer needs a name.");
  if (clean.some((p) => !isCents(p.baseShareCents, 0))) return fail("A payer's share has to be $0 or more.");
  if (new Set(clean.map((p) => p.key)).size !== clean.length) return fail("Two payers share a key.");
  if (clean.filter((p) => p.isOwner).length > 1) return fail("Only one payer can be the client.");
  await run(`DELETE FROM budget_parties WHERE project_id = $1`, [projectId]);
  for (const [i, p] of clean.entries())
    await run(`INSERT INTO budget_parties (project_id, key, label, base_share_cents, is_owner, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, p.key, p.label, p.baseShareCents, p.isOwner, i]);
  return { ok: true };
}

export interface FundingEventInput { partyKey: string; source: string; amountCents: number; trigger?: string; status: "expected" | "requested" | "received" }

/** Expected inflows and what triggers them. Replaces the list. */
export async function saveFundingEvents(run: Run, projectId: string, events: FundingEventInput[]): Promise<WriteResult> {
  if (!Array.isArray(events)) return fail("Give the list of expected payments.");
  for (const e of events) {
    if (!clip(e.source, 160)) return fail("Every expected payment needs a description.");
    if (!isCents(e.amountCents, 0)) return fail(`${e.source}: the amount has to be $0 or more.`);
    if (!["expected", "requested", "received"].includes(e.status)) return fail(`${e.source}: unknown status.`);
  }
  await run(`DELETE FROM funding_events WHERE project_id = $1`, [projectId]);
  for (const [i, e] of events.entries())
    await run(
      `INSERT INTO funding_events (project_id, party_key, source, amount_cents, trigger_text, status, status_at, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'expected' THEN NULL ELSE now() END, $7)`,
      [projectId, budgetKey(clip(e.partyKey, 40)), clip(e.source, 160), e.amountCents, clip(e.trigger, 200), e.status, i]);
  return { ok: true };
}

export interface SubInvoiceInput {
  /** A sub from the roster… */
  subSlug?: string | null;
  /** …or, for a bill from someone outside it, their name. One of the two is required. */
  vendorLabel?: string;
  amountCents: number;
  date?: string | null;
  note?: string;
  /** On a re-import (same `sourceRef`) anything left undefined here KEEPS its
   *  value — a payment recorded since is never undone by the document. */
  status?: "submitted" | "approved" | "paid";
  paidCents?: number;
  target?: CostTarget;
  purchaseOrderId?: number | null;
  /** Stable import key ("cpk:1745"). Recording the same key again UPDATES that row. */
  sourceRef?: string;
}

/** Record a bill from a sub or vendor — the paper invoices the sub portal never
 *  sees. Idempotent on source_ref. */
export async function recordSubInvoice(run: Run, projectId: string, input: SubInvoiceInput): Promise<WriteResult<{ id: number; updated: boolean }>> {
  const subSlug = clip(input.subSlug, 120) || null;
  const vendor = clip(input.vendorLabel, 120);
  if (!subSlug && !vendor) return fail("Say who the bill is from: a roster sub (sub_slug) or a name (vendor_label).");
  if (subSlug && !(await run(`SELECT 1 FROM subs WHERE slug = $1`, [subSlug])).length) return fail(`No sub with slug "${subSlug}". Use vendor_label for someone outside the roster.`);
  if (!isCents(input.amountCents, 0) || input.amountCents === 0) return fail("Enter the invoice amount, in whole cents.");
  if (input.status != null && !["submitted", "approved", "paid"].includes(input.status)) return fail("Unknown status.");
  if (input.paidCents != null && !isCents(input.paidCents, 0)) return fail("Paid so far isn't a valid amount.");
  if (input.date != null && !isDay(input.date)) return fail("That date isn't valid (YYYY-MM-DD).");
  const target = input.target === undefined ? undefined : await resolveTarget(run, projectId, input.target);
  if (typeof target === "string") return fail(target);
  const poError = input.purchaseOrderId === undefined ? null : await ownPurchaseOrder(run, projectId, input.purchaseOrderId);
  if (poError) return fail(poError);
  const sourceRef = clip(input.sourceRef, 120);
  const doc = [subSlug, vendor, input.amountCents, clip(input.note, 300), input.date ?? null];
  // Payment state: what was passed, over what is already there, capped at the (possibly new) amount.
  const settle = (status: string, paidSoFar: number) => (status === "paid" ? input.amountCents : Math.min(paidSoFar, input.amountCents));

  const [seen] = sourceRef
    ? await run<{ id: string; status: string; paid_cents: number }>(`SELECT id, status, paid_cents FROM sub_invoices WHERE project_id = $1 AND source_ref = $2`, [projectId, sourceRef])
    : [];
  if (seen) {
    const status = input.status ?? seen.status;
    const paid = settle(status, input.paidCents ?? Number(seen.paid_cents));
    if (paid > input.amountCents) return fail("Paid so far can't be more than the invoice.");
    await run(
      `UPDATE sub_invoices SET sub_slug = $3, vendor_label = $4, amount = $5, note = $6, invoice_date = $7,
              status = $8, paid_cents = $9,
              paid_at = CASE WHEN $8 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
              budget_line_id = CASE WHEN $10 THEN $11 ELSE budget_line_id END,
              change_order_id = CASE WHEN $10 THEN $12 ELSE change_order_id END,
              purchase_order_id = CASE WHEN $13 THEN $14 ELSE purchase_order_id END
        WHERE id = $1 AND project_id = $2`,
      [Number(seen.id), projectId, ...doc, status, paid, target !== undefined, target?.lineId ?? null, target?.coId ?? null, input.purchaseOrderId !== undefined, input.purchaseOrderId ?? null]);
    return { ok: true, id: Number(seen.id), updated: true };
  }
  const status = input.status ?? "approved";
  const paid = settle(status, input.paidCents ?? 0);
  if (paid > input.amountCents) return fail("Paid so far can't be more than the invoice.");
  const [row] = await run<{ id: string }>(
    `INSERT INTO sub_invoices (project_id, sub_slug, vendor_label, amount, note, invoice_date, status, paid_cents,
                               budget_line_id, change_order_id, purchase_order_id, source_ref, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $7 = 'paid' THEN now() ELSE NULL END) RETURNING id`,
    [projectId, ...doc, status, paid, target?.lineId ?? null, target?.coId ?? null, input.purchaseOrderId ?? null, sourceRef]);
  return { ok: true, id: Number(row.id), updated: false };
}
