// Project financials — the company view, pure. One BudgetView per job in,
// the /money page's data out: a row per job, totals that sum only what is
// known (rollupCompany), and the needs-attention list. No db import.
// Spec: docs/project-financials-plan.md §5.

import {
  computeTotals,
  describeFinancials,
  fmtK,
  fmtSigned,
  isCoCounted,
  rollupCompany,
  type BudgetCompleteness,
  type BudgetView,
  type CompanyTotals,
  type ProfitStatus,
} from "./budget-types.ts";

/** A job is closed once it reaches the warranty stage (it leaves /projects too). */
const CLOSED_STATUS = "warranty";

export const ATTENTION = {
  tradeOverCents: 500_00,
  invoiceOverdueDays: 14,
  underBilledCents: 1_000_00,
  pendingCoDays: 7,
} as const;

export interface CompanyJobRow {
  slug: string;
  name: string;
  /** projects.status. */
  stage: string;
  profitStatus: ProfitStatus;
  billing: BudgetCompleteness["billing"];
  priceCents: number;
  /** Projected cost — or cost so far when profit is unknown. */
  costCents: number;
  costIsSoFar: boolean;
  /** The four cost states, for the row's mini bar. */
  paidCents: number;
  owedCents: number;
  orderedCents: number;
  estToFinishCents: number;
  /** null when unknown — the table shows "—", never 0. */
  profitCents: number | null;
  marginPct: number | null;
  workDonePct: number | null;
  collectedCents: number;
  unpaidInvoicesCents: number;
  leftToCollectCents: number;
  /** Sentence 1 of describeFinancials — the row's tooltip. */
  headline: string;
}

export type AttentionKind =
  | "trade_over" | "invoice_overdue" | "under_billed" | "unsigned_co_spend" | "collected_mismatch"
  | "billed_over_po" | "possible_duplicate" | "profit_unknown" | "costs_stale" | "co_pending" | "unassigned_costs";

export interface AttentionItem {
  slug: string;
  name: string;
  kind: AttentionKind;
  text: string;
  /** What is at stake — the list sorts on it, most money first. */
  amountCents: number;
  href: string;
}

export interface CompanyMoney {
  open: CompanyJobRow[];
  closed: CompanyJobRow[];
  /** Open jobs only. */
  totals: CompanyTotals;
  closedTotals: CompanyTotals;
  attention: AttentionItem[];
}

export function buildCompanyMoney(views: BudgetView[]): CompanyMoney {
  const jobs = views.map((view) => {
    const totals = computeTotals(view);
    const slug = view.project?.slug ?? "";
    const name = view.project?.name ?? slug;
    const unknown = view.completeness.profit === "unknown";
    const row: CompanyJobRow = {
      slug,
      name,
      stage: view.project?.status ?? "",
      profitStatus: view.completeness.profit,
      billing: view.completeness.billing,
      priceCents: totals.priceCents,
      costCents: unknown ? totals.costSoFarCents : totals.projectedCostCents,
      costIsSoFar: unknown,
      paidCents: totals.paidCents,
      owedCents: totals.owedCents,
      orderedCents: totals.orderedCents,
      estToFinishCents: unknown ? 0 : totals.estToFinishCents,
      profitCents: totals.headlineProfitCents,
      marginPct: view.completeness.profit === "projected" ? totals.marginPct : unknown ? null : totals.plannedMarginPct,
      workDonePct: totals.workDonePct,
      collectedCents: totals.collectedCents,
      unpaidInvoicesCents: totals.unpaidInvoicesCents,
      leftToCollectCents: totals.leftToCollectCents,
      headline: describeFinancials(view, totals)[0] ?? "",
    };
    return { view, totals, row, closed: view.project?.status === CLOSED_STATUS };
  });

  // Known profit first, biggest first; jobs whose profit isn't known yet last, biggest job first.
  const byProfit = (a: CompanyJobRow, b: CompanyJobRow) =>
    a.profitCents != null && b.profitCents != null
      ? b.profitCents - a.profitCents
      : a.profitCents != null ? -1 : b.profitCents != null ? 1 : b.priceCents - a.priceCents;
  const company = (closed: boolean) =>
    rollupCompany(jobs.filter((j) => j.closed === closed).map((j) => ({
      slug: j.row.slug, name: j.row.name, completeness: j.view.completeness, totals: j.totals,
    })));

  const attention: AttentionItem[] = [];
  for (const { view, totals: t, row, closed } of jobs) {
    if (closed) continue;
    const add = (kind: AttentionKind, text: string, amountCents: number) =>
      attention.push({ slug: row.slug, name: row.name, kind, text, amountCents, href: `/projects/${row.slug}?tab=Money&section=Overview` });

    for (const o of t.overLines)
      if (o.varianceCents > ATTENTION.tradeOverCents) add("trade_over", `${o.line.trade} is ${fmtSigned(o.varianceCents)} over budget`, o.varianceCents);
    for (const i of view.clientInvoices)
      if (i.status === "sent" && (i.daysOutstanding ?? 0) > ATTENTION.invoiceOverdueDays)
        add("invoice_overdue", `${i.number} (${fmtK(i.amountCents)}) has been out ${i.daysOutstanding} days`, i.amountCents);
    if (t.overUnderBilledCents != null && -t.overUnderBilledCents > ATTENTION.underBilledCents)
      add("under_billed", `About ${fmtK(-t.overUnderBilledCents)} of work is done and not billed`, -t.overUnderBilledCents);
    for (const co of view.changeOrders) {
      const soFar = co.paidCents + co.owedCents + co.orderedCents;
      if (!isCoCounted(co.status) && soFar > 0) add("unsigned_co_spend", `${fmtK(soFar)} spent on ${co.id}, which isn't signed`, soFar);
      if (co.status === "sent" && (co.ageDays ?? 0) > ATTENTION.pendingCoDays)
        add("co_pending", `${co.id} (${fmtK(co.totalCents)}) has waited ${co.ageDays} days for a signature`, Math.abs(co.totalCents));
    }
    if (view.billing.mismatchFlagged)
      add("collected_mismatch", `Hand-kept collected is ${fmtK(Math.abs(view.billing.mismatchCents))} off the invoices`, Math.abs(view.billing.mismatchCents));
    for (const r of view.costs)
      for (const f of r.flags ?? []) if (f.startsWith("billed ")) add("billed_over_po", `${r.vendor}: ${f}`, r.amountCents);
    const dupes = view.costs.filter((r) => r.flags?.includes("possible duplicate"));
    if (dupes.length) add("possible_duplicate", `${dupes.length} costs look like duplicates`, Math.max(...dupes.map((r) => Math.abs(r.amountCents))));
    if (view.project?.status === "construction" && view.completeness.profit === "unknown")
      add("profit_unknown", "On site with no budget — profit isn't known", t.priceCents);
    const stale = view.completeness.missing.find((m) => m.startsWith("Costs last entered"));
    if (stale) add("costs_stale", stale, t.costSoFarCents);
    const loose = view.unassigned.paidCents + view.unassigned.owedCents + view.unassigned.orderedCents;
    if (loose > 0) add("unassigned_costs", `${fmtK(loose)} of costs aren't assigned to a trade`, loose);
  }
  attention.sort((a, b) => b.amountCents - a.amountCents);

  return {
    open: jobs.filter((j) => !j.closed).map((j) => j.row).sort(byProfit),
    closed: jobs.filter((j) => j.closed).map((j) => j.row).sort(byProfit),
    totals: company(false),
    closedTotals: company(true),
    attention,
  };
}
