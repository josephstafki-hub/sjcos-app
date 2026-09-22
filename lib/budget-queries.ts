// Project financials — the read queries, with NO db import. Every function
// takes a `run(sql, params)` so one set of SQL serves the app's pool
// (lib/budget.ts), the MCP server's rows() helper (mcp/financials-tools.mjs),
// and a transaction client (scripts/seed-egan-financials.mjs verifies its
// writes through these exact queries before anything is committed).
//
// One query per table over `project_id = ANY($1)`, grouped in JS — never the
// single-project loader in a loop. Spec: docs/project-financials-plan.md §7.
//
// pg returns bigint and numeric as strings and `date` as a local-time Date, so
// ids are Number()ed here and every day is selected as 'YYYY-MM-DD' text in the
// shop's timezone. After this module everything is plain cents and ISO days.

import type { ChipKind } from "@/components/ui/Chip";
import type {
  RawBudgetLine,
  RawChangeOrder,
  RawExpense,
  RawInvoice,
  RawPoStatus,
  RawProjectMoney,
  RawPurchaseOrder,
  RawSubInvoice,
} from "./budget-assemble.ts";
import type { BillingSource, BudgetBasis, BudgetLineKind, BudgetParty, FundingEvent, FundingStatus } from "./budget-types.ts";

export type Run = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

const TZ = "America/Chicago";
const day = (col: string) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;

/** Today in the shop's timezone, as an ISO day — the view's "as of". */
export function todayCentral(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ProjectRef {
  id: string;
  slug: string;
  name: string;
  status: string;
}

/** Which projects to load: one by slug, or every project (the company page). */
export async function findProjects(run: Run, where: { slug: string } | "all"): Promise<ProjectRef[]> {
  if (where === "all") return run<ProjectRef>(`SELECT id, slug, name, status FROM projects ORDER BY name`);
  return run<ProjectRef>(`SELECT id, slug, name, status FROM projects WHERE slug = $1`, [where.slug]);
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const text = (v: unknown): string => (v == null ? "" : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Everything the assembler needs for these projects, keyed by project id.
 *
 *  The eleven queries run in parallel on a pool. Pass `sequential` when `run`
 *  is ONE connection — a transaction client — because a single pg client cannot
 *  have two queries in flight. */
export async function loadRawProjectMoney(
  run: Run,
  projectIds: string[],
  opts: { sequential?: boolean } = {},
): Promise<Map<string, RawProjectMoney>> {
  const out = new Map<string, RawProjectMoney>();
  if (!projectIds.length) return out;
  const ids = [projectIds];
  const q = (sql: string, params: unknown[]) => () => run(sql, params);
  const settle = async (tasks: (() => Promise<Record<string, unknown>[]>)[]) => {
    if (!opts.sequential) return Promise.all(tasks.map((t) => t()));
    const results: Record<string, unknown>[][] = [];
    for (const t of tasks) results.push(await t());
    return results;
  };

  const [projects, estimates, lines, cos, credits, invoices, pos, subInvoices, expenses, parties, funding] = await settle([
    q(
      `SELECT id, slug, name, status, client_name, contract_value, collected_to_date,
              budget_basis, budget_label, budget_caption, price_cents, retainage_cents, budget_notes,
              budget_complete, to_char(costs_through, 'YYYY-MM-DD') AS costs_through,
              billing_source, opening_collected_cents, opening_billed_cents, opening_note
         FROM projects WHERE id = ANY($1::uuid[])`, ids),
    // The job's approved estimate: the newest one if there are several.
    q(
      `SELECT DISTINCT ON (project_id) project_id, total
         FROM estimates WHERE project_id = ANY($1::uuid[]) AND status = 'approved'
        ORDER BY project_id, approved_at DESC NULLS LAST, created_at DESC`, ids),
    q(
      `SELECT id, project_id, key, trade, detail, source, kind, budget_cents, price_cents, est_to_finish_cents,
              percent_complete, status, status_kind, credited_co_id, flags
         FROM budget_lines WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, id`, ids),
    q(
      `SELECT id, project_id, number, title, description, vendor_label, price_cents, status, paid_by,
              funder_share_cents, budget_cost_cents, est_to_finish_cents, ${day("created_at")} AS created_on
         FROM change_orders WHERE project_id = ANY($1::uuid[]) ORDER BY created_at, id`, ids),
    q(
      `SELECT c.change_order_id, c.budget_line_id, c.amount_cents
         FROM change_order_credits c JOIN change_orders co ON co.id = c.change_order_id
        WHERE co.project_id = ANY($1::uuid[]) ORDER BY c.id`, ids),
    q(
      `SELECT project_id, number, milestone, amount, status, line_items,
              ${day("created_at")} AS created_on, ${day("sent_at")} AS sent_on, ${day("paid_at")} AS paid_on
         FROM invoices WHERE project_id = ANY($1::uuid[]) ORDER BY created_at, id`, ids),
    // `closed` is included on purpose: closing a PO must never erase its cost.
    q(
      `SELECT po.id, po.project_id, po.po_number, po.vendor_name, po.title, po.status, po.subtotal,
              COALESCE((SELECT SUM(round(l.qty_received * l.unit_cost))
                          FROM purchase_order_lines l WHERE l.purchase_order_id = po.id), 0) AS received_value,
              ${day("COALESCE(po.sent_at, po.created_at)")} AS on_day, po.budget_line_id, po.change_order_id
         FROM purchase_orders po WHERE po.project_id = ANY($1::uuid[]) ORDER BY po.created_at, po.id`, ids),
    // A bill may come from someone outside the subs roster: LEFT JOIN, then the label.
    q(
      `SELECT si.id, si.project_id, COALESCE(NULLIF(s.name, ''), NULLIF(si.vendor_label, ''), 'Unnamed vendor') AS vendor,
              si.amount, si.status, si.paid_cents, si.note,
              COALESCE(to_char(si.invoice_date, 'YYYY-MM-DD'), ${day("si.created_at")}) AS on_day,
              si.budget_line_id, si.change_order_id, si.purchase_order_id, si.source_ref
         FROM sub_invoices si LEFT JOIN subs s ON s.slug = si.sub_slug
        WHERE si.project_id = ANY($1::uuid[]) ORDER BY si.created_at, si.id`, ids),
    q(
      `SELECT id, project_id, vendor_label, kind, amount_cents, memo, paid_from, to_char(expense_date, 'YYYY-MM-DD') AS on_day,
              budget_line_id, change_order_id, purchase_order_id, source_ref
         FROM expenses WHERE project_id = ANY($1::uuid[]) ORDER BY expense_date, id`, ids),
    q(
      `SELECT project_id, key, label, base_share_cents, is_owner
         FROM budget_parties WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, id`, ids),
    q(
      `SELECT project_id, party_key, source, amount_cents, trigger_text, status,
              CASE WHEN status_at IS NULL THEN NULL
                   ELSE initcap(status) || ' ' || to_char(status_at AT TIME ZONE '${TZ}', 'Mon FMDD') END AS status_label
         FROM funding_events WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, id`, ids),
  ]);

  const estimateTotal = new Map(estimates.map((e) => [text(e.project_id), num(e.total)]));
  const creditsByCo = new Map<number, { budgetLineId: number; amountCents: number }[]>();
  for (const c of credits) {
    const k = num(c.change_order_id);
    if (!creditsByCo.has(k)) creditsByCo.set(k, []);
    creditsByCo.get(k)!.push({ budgetLineId: num(c.budget_line_id), amountCents: num(c.amount_cents) });
  }

  for (const p of projects) {
    out.set(text(p.id), {
      project: {
        slug: text(p.slug),
        name: text(p.name),
        status: text(p.status),
        clientName: text(p.client_name) || undefined,
        basis: text(p.budget_basis) as BudgetBasis,
        budgetLabel: text(p.budget_label) || undefined,
        budgetCaption: text(p.budget_caption) || undefined,
        priceCentsOverride: numOrNull(p.price_cents),
        contractValueDollars: num(p.contract_value), // WHOLE DOLLARS — converted once, in the assembler
        collectedToDateDollars: num(p.collected_to_date), // WHOLE DOLLARS
        approvedEstimateTotalCents: estimateTotal.get(text(p.id)) ?? null,
        retainageCents: num(p.retainage_cents),
        notes: list(p.budget_notes),
        budgetComplete: p.budget_complete === true,
        costsThrough: p.costs_through == null ? null : text(p.costs_through),
        billingSource: text(p.billing_source) as BillingSource,
        openingCollectedCents: num(p.opening_collected_cents),
        openingBilledCents: num(p.opening_billed_cents),
        openingNote: text(p.opening_note) || undefined,
      },
      lines: [], changeOrders: [], invoices: [], purchaseOrders: [], subInvoices: [], expenses: [], parties: [], fundingEvents: [],
    });
  }
  const of = (row: Record<string, unknown>) => out.get(text(row.project_id));

  for (const l of lines)
    of(l)?.lines.push({
      id: num(l.id), key: text(l.key), trade: text(l.trade), detail: text(l.detail) || undefined,
      source: text(l.source) || undefined, kind: text(l.kind) as BudgetLineKind, budgetCents: num(l.budget_cents),
      priceCents: numOrNull(l.price_cents), estToFinishCents: numOrNull(l.est_to_finish_cents),
      percentComplete: numOrNull(l.percent_complete), status: text(l.status) || undefined,
      statusKind: (text(l.status_kind) || "ghost") as ChipKind, creditedCoId: numOrNull(l.credited_co_id),
      flags: list(l.flags),
    } satisfies RawBudgetLine);

  for (const c of cos)
    of(c)?.changeOrders.push({
      id: num(c.id), number: text(c.number), title: text(c.title), description: text(c.description) || undefined,
      vendorLabel: text(c.vendor_label) || undefined, priceCents: num(c.price_cents),
      status: text(c.status) as RawChangeOrder["status"], paidBy: (text(c.paid_by) || "owner") as RawChangeOrder["paidBy"],
      funderShareCents: num(c.funder_share_cents), budgetCostCents: numOrNull(c.budget_cost_cents),
      estToFinishCents: numOrNull(c.est_to_finish_cents), createdOn: c.created_on == null ? null : text(c.created_on),
      credits: creditsByCo.get(num(c.id)) ?? [],
    } satisfies RawChangeOrder);

  for (const i of invoices)
    of(i)?.invoices.push({
      number: text(i.number), milestone: text(i.milestone), amountCents: num(i.amount),
      status: text(i.status) as RawInvoice["status"],
      createdOn: i.created_on == null ? null : text(i.created_on),
      sentOn: i.sent_on == null ? null : text(i.sent_on),
      paidOn: i.paid_on == null ? null : text(i.paid_on),
      lineItems: Array.isArray(i.line_items) ? (i.line_items as RawInvoice["lineItems"]) : [],
    } satisfies RawInvoice);

  for (const po of pos)
    of(po)?.purchaseOrders.push({
      id: num(po.id), poNumber: text(po.po_number), vendorName: text(po.vendor_name), title: text(po.title),
      status: text(po.status) as RawPoStatus, subtotalCents: num(po.subtotal), receivedValueCents: num(po.received_value),
      on: po.on_day == null ? null : text(po.on_day), budgetLineId: numOrNull(po.budget_line_id),
      changeOrderId: numOrNull(po.change_order_id),
    } satisfies RawPurchaseOrder);

  for (const s of subInvoices)
    of(s)?.subInvoices.push({
      id: num(s.id), vendor: text(s.vendor), amountCents: num(s.amount), status: text(s.status) as RawSubInvoice["status"],
      paidCents: num(s.paid_cents), note: text(s.note) || undefined, on: s.on_day == null ? null : text(s.on_day),
      budgetLineId: numOrNull(s.budget_line_id), changeOrderId: numOrNull(s.change_order_id),
      purchaseOrderId: numOrNull(s.purchase_order_id), sourceRef: text(s.source_ref) || undefined,
    } satisfies RawSubInvoice);

  for (const e of expenses)
    of(e)?.expenses.push({
      id: num(e.id), vendorLabel: text(e.vendor_label), kind: text(e.kind), amountCents: num(e.amount_cents),
      memo: text(e.memo) || undefined, paidFrom: text(e.paid_from) || undefined, on: e.on_day == null ? null : text(e.on_day),
      budgetLineId: numOrNull(e.budget_line_id), changeOrderId: numOrNull(e.change_order_id),
      purchaseOrderId: numOrNull(e.purchase_order_id), sourceRef: text(e.source_ref) || undefined,
    } satisfies RawExpense);

  for (const p of parties)
    of(p)?.parties.push({
      key: text(p.key), label: text(p.label), baseShareCents: num(p.base_share_cents), isOwner: p.is_owner === true,
    } satisfies BudgetParty);

  for (const f of funding)
    of(f)?.fundingEvents.push({
      partyKey: text(f.party_key), source: text(f.source), amountCents: num(f.amount_cents),
      trigger: text(f.trigger_text) || undefined, status: text(f.status) as FundingStatus,
      statusLabel: f.status_label == null ? undefined : text(f.status_label),
    } satisfies FundingEvent);

  return out;
}
