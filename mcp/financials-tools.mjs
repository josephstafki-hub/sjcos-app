// SJC OS MCP — project financials (job costing). Wired from sjcos-mcp.mjs:
//
//   import { registerFinancialsTools } from "./financials-tools.mjs";
//   registerFinancialsTools(server, { rows, json });
//
// docs/project-financials-plan.md §8. READ tools only for now: what a job is
// priced at, what it has cost, what it should make, and what the numbers rest
// on. The write tools (budget lines, expenses, cost assignment) land in a later
// phase; nothing here changes a row.
//
// Runtime note: like floor-tools.mjs this is plain Node ESM importing the pure
// TypeScript libs directly (Node 22 strips types unflagged; every lib/budget-*.ts
// imports its siblings with a `.ts` extension for exactly this). The app and
// this server therefore run the SAME queries and the SAME math — only
// lib/budget.ts and lib/actions/budget.ts ("server-only" / "use server") are
// off limits here.
//
// MONEY IS INTEGER CENTS in every field of every result. (projects.contract_value
// and collected_to_date are whole dollars in the DB; they are converted before
// anything leaves this module.)

import { z } from "zod";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { buildCompanyMoney } from "../lib/budget-company.ts";
import { findProjects, loadRawProjectMoney, todayCentral } from "../lib/budget-queries.ts";
import { computeTotals, describeFinancials, proposeBillingReconciliation } from "../lib/budget-types.ts";

const pct = (r) => (r == null ? null : Math.round(r * 1000) / 10);

function projectPayload(view) {
  const t = computeTotals(view);
  const needsReconcile = view.billing.source === "manual" && view.billing.invoiceCount > 0;
  return {
    project: view.project,
    as_of: view.asOfLabel,
    units: "every *_cents field is integer cents; *_pct is a percentage",
    summary: describeFinancials(view, t),
    completeness: {
      profit: view.completeness.profit,
      budget_covers_whole_job: view.completeness.budget,
      costs_through: view.completeness.costsThrough,
      billing: view.completeness.billing,
      based_on: view.completeness.basedOn,
      missing: view.completeness.missing,
    },
    price: {
      price_cents: t.priceCents,
      base_price_cents: t.basePriceCents,
      change_orders_net_cents: t.coNetCents,
      pending_change_orders_cents: t.coPendingCents,
    },
    cost: {
      spent_cents: t.paidCents,
      owed_cents: t.owedCents,
      on_order_cents: t.orderedCents,
      still_to_spend_cents: t.estToFinishCents,
      projected_cost_cents: t.projectedCostCents,
      cost_so_far_cents: t.costSoFarCents,
      budget_cost_cents: t.budgetCostCents + t.coBudgetCostCents,
      cost_headroom_cents: t.costHeadroomCents,
      on_unsigned_change_orders_cents: t.unsignedCoCostCents,
      unassigned_cents: view.unassigned.paidCents + view.unassigned.owedCents + view.unassigned.orderedCents,
    },
    profit: {
      status: view.completeness.profit,
      projected_profit_cents: t.projectedProfitCents,
      planned_profit_cents: t.plannedProfitCents,
      margin_pct: pct(t.marginPct),
      planned_margin_pct: pct(t.plannedMarginPct),
    },
    progress: { work_done_by_cost_pct: pct(t.workDonePct), earned_cents: t.earnedCents },
    billing: {
      source: view.billing.source,
      collected_cents: t.collectedCents,
      left_to_collect_cents: t.leftToCollectCents,
      unpaid_invoices_cents: t.unpaidInvoicesCents,
      billed_cents: t.billedCents,
      left_to_bill_cents: t.leftToBillCents,
      billed_ahead_of_work_cents: t.overUnderBilledCents,
      opening_collected_cents: view.billing.openingCollectedCents,
      hand_kept_collected_cents: view.billing.handKeptCollectedCents,
      paid_invoices_cents: view.billing.paidInvoicesCents,
      mismatch_cents: view.billing.mismatchCents,
      mismatch_flagged: view.billing.mismatchFlagged,
      reconciliation_proposal: needsReconcile ? proposeBillingReconciliation(view.billing) : null,
    },
    who_pays: t.paidBy.map((p) => ({ party: p.label, amount_cents: p.amountCents, is_owner: p.isOwner })),
    lines: view.lines.map((l, i) => ({
      key: l.id, trade: l.trade, kind: l.kind, status: l.status ?? null,
      budget_cents: l.budgetCents, price_cents: l.priceCents ?? null,
      spent_cents: l.paidCents, owed_cents: l.owedCents, on_order_cents: l.orderedCents,
      still_to_spend_cents: t.lines[i].estCents, still_to_spend_derived: t.lines[i].estDerived,
      projected_cents: t.lines[i].projectedCents, variance_cents: t.lines[i].varianceCents,
      margin_cents: t.lines[i].marginCents, percent_complete: l.percentComplete ?? null,
      credited_to: l.creditedTo ?? null, credit_in_effect: t.lines[i].credited, flags: l.flags ?? [],
    })),
    change_orders: view.changeOrders.map((c, i) => ({
      number: c.id, title: c.title, status: c.status, counted: t.changeOrders[i].counted,
      total_cents: c.totalCents, credit_cents: t.changeOrders[i].creditCents, net_to_client_cents: t.changeOrders[i].netPriceCents,
      billed_cents: c.billedCents, budget_cost_cents: c.budgetCostCents ?? null,
      spent_cents: c.paidCents, owed_cents: c.owedCents, on_order_cents: c.orderedCents,
      still_to_spend_cents: t.changeOrders[i].estCents, cost_not_planned: t.changeOrders[i].notPlanned,
      margin_cents: t.changeOrders[i].marginCents, age_days: c.ageDays ?? null,
    })),
    costs: view.costs.map((r) => ({
      source: r.source, id: r.sourceId, vendor: r.vendor, date: r.dateLabel, status: r.status, note: r.note ?? null,
      amount_cents: r.amountCents, counts_as: { spent_cents: r.paidCents, owed_cents: r.owedCents, on_order_cents: r.orderedCents },
      assigned_to: r.key ?? null, bills_against_po: r.poNumber ?? r.purchaseOrderId ?? null,
      source_ref: r.sourceRef ?? null, flags: r.flags ?? [],
    })),
    client_invoices: view.clientInvoices.map((i) => ({
      number: i.number, label: i.label, amount_cents: i.amountCents, status: i.status, status_label: i.statusLabel,
      days_outstanding: i.daysOutstanding ?? null,
    })),
    funding_events: view.fundingEvents,
    notes: view.notes ?? [],
  };
}

const jobRow = (r) => ({
  slug: r.slug, name: r.name, stage: r.stage, profit_status: r.profitStatus, billing: r.billing,
  price_cents: r.priceCents, cost_cents: r.costCents, cost_is_so_far: r.costIsSoFar,
  profit_cents: r.profitCents, margin_pct: pct(r.marginPct), work_done_by_cost_pct: pct(r.workDonePct),
  collected_cents: r.collectedCents, unpaid_invoices_cents: r.unpaidInvoicesCents, left_to_collect_cents: r.leftToCollectCents,
  headline: r.headline,
});
const totalsRow = (c) => ({
  jobs: c.jobCount, contracted_cents: c.contractedCents, collected_cents: c.collectedCents,
  left_to_collect_cents: c.leftToCollectCents, unpaid_invoices_cents: c.unpaidInvoicesCents,
  billing_tracked_on_jobs: c.billingTrackedJobs,
  profit_cents: c.profitCents, profit_known_on_jobs: c.profitJobs, of_which_projected: c.projectedJobs,
  of_which_planned: c.plannedJobs, profit_covers_price_cents: c.profitPriceCoverageCents,
  blended_margin_pct: pct(c.blendedMarginPct), unbilled_work_cents: c.unbilledCents, unbilled_known_on_jobs: c.unbilledJobs,
});

/** The open-jobs block of business_snapshot: the same totals `company_financials` reports. */
export async function openJobsSnapshot(rows) {
  const projects = await findProjects(rows, "all");
  const raw = await loadRawProjectMoney(rows, projects.map((p) => p.id));
  const asOf = todayCentral();
  return totalsRow(buildCompanyMoney(projects.map((p) => assembleBudgetView(raw.get(p.id), { asOf }))).totals);
}

export function registerFinancialsTools(server, { rows, json }) {
  server.registerTool(
    "get_project_financials",
    {
      title: "Get a project's financials",
      description:
        "What one job is priced at, what it has cost, what it should make, how far along it is, and what those " +
        "numbers rest on. Returns plain-English summary sentences, price / cost / profit / progress / billing totals, " +
        "every budget line with its spent · owed · on order · still to spend, change orders, the cost ledger " +
        "(sub invoices, POs, expenses — each counted once), client invoices and notes. ALL MONEY IS INTEGER CENTS. " +
        "`completeness.profit` is 'unknown' until the budget covers the whole job: then no profit or margin is " +
        "given, only cost so far — do not compute one yourself. `billing.source` 'manual' means collected is the " +
        "hand-kept total and billed is unknown. Read-only.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const [project] = await findProjects(rows, { slug: project_slug });
      if (!project) return json({ error: `No project with slug "${project_slug}"` });
      const money = (await loadRawProjectMoney(rows, [project.id])).get(project.id);
      return json(projectPayload(assembleBudgetView(money, { asOf: todayCentral() })));
    },
  );

  server.registerTool(
    "company_financials",
    {
      title: "Company financials across all jobs",
      description:
        "Every job side by side: price, cost, profit, margin, work done, collected, unpaid invoices and left to " +
        "collect — open jobs and closed (warranty) jobs separately — plus company totals and a needs-attention " +
        "list, most money first. Totals sum ONLY what is known and say their coverage: profit and blended margin " +
        "cover just the jobs whose profit is known (`profit_known_on_jobs`, `profit_covers_price_cents`), never " +
        "the price of jobs with no budget. `left_to_collect` is price minus collected and includes unbilled work — " +
        "it is not receivables; `unpaid_invoices` is. ALL MONEY IS INTEGER CENTS. Read-only.",
      inputSchema: {},
    },
    async () => {
      const projects = await findProjects(rows, "all");
      const raw = await loadRawProjectMoney(rows, projects.map((p) => p.id));
      const asOf = todayCentral();
      const company = buildCompanyMoney(projects.map((p) => assembleBudgetView(raw.get(p.id), { asOf })));
      return json({
        as_of: asOf,
        units: "every *_cents field is integer cents; *_pct is a percentage",
        open_totals: totalsRow(company.totals),
        closed_totals: totalsRow(company.closedTotals),
        needs_attention: company.attention.map((a) => ({ slug: a.slug, job: a.name, kind: a.kind, what: a.text, amount_cents: a.amountCents })),
        open_jobs: company.open.map(jobRow),
        closed_jobs: company.closed.map(jobRow),
      });
    },
  );
}
