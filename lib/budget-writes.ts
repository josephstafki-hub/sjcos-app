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

/** Costs pointing at the line become unassigned — they still count. */
export async function deleteBudgetLine(run: Run, projectId: string, id: number): Promise<WriteResult> {
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
  target: CostTarget;
  /** The PO this payment is for, so the two count once. */
  purchaseOrderId: number | null;
}

export async function saveExpense(run: Run, projectId: string, input: ExpenseInput, userId?: string): Promise<WriteResult<{ id: number }>> {
  if (!isDay(input.date)) return fail("Pick the date it was paid.");
  const vendor = clip(input.vendorLabel, 120);
  if (!vendor) return fail("Who was paid?");
  if (!EXPENSE_KINDS.includes(input.kind)) return fail("Unknown kind of expense.");
  if (!PAID_FROM.includes(input.paidFrom)) return fail("Unknown payment method.");
  if (!isCents(input.amountCents) || input.amountCents === 0) return fail("Enter an amount (negative for a return).");
  const target = await resolveTarget(run, projectId, input.target);
  if (typeof target === "string") return fail(target);
  const poError = await ownPurchaseOrder(run, projectId, input.purchaseOrderId);
  if (poError) return fail(poError);
  const fields = [input.date, vendor, input.kind, input.amountCents, clip(input.memo, 300), input.paidFrom, target.lineId, target.coId, input.purchaseOrderId];

  if (input.id != null) {
    const rows = await run<{ id: string }>(
      `UPDATE expenses SET expense_date = $3, vendor_label = $4, kind = $5, amount_cents = $6, memo = $7, paid_from = $8,
              budget_line_id = $9, change_order_id = $10, purchase_order_id = $11
        WHERE id = $1 AND project_id = $2 RETURNING id`, [input.id, projectId, ...fields]);
    return rows.length ? { ok: true, id: Number(rows[0].id) } : fail("That expense isn't on this job.");
  }
  const [row] = await run<{ id: string }>(
    `INSERT INTO expenses (project_id, expense_date, vendor_label, kind, amount_cents, memo, paid_from,
                           budget_line_id, change_order_id, purchase_order_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [projectId, ...fields, userId ?? null]);
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
