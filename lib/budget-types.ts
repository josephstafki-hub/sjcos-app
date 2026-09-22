// Project financials — shared types + the one place the math lives. NO db
// import: safe in client bundles, and loadable as-is by `node --test` and the
// MCP .mjs server (same split as lib/co-types.ts / lib/thread-rail.ts).
// Spec: docs/project-financials-plan.md §3. Money is integer CENTS everywhere.
//
// Two axes that never mix:
//   COST  — what the job costs SJC: a planned `budget`, then four states of
//           real money in order of certainty: paid → owed → ordered → est.
//   PRICE — what the payer pays: the base price + counted change orders.
// Money the client has paid is `collected`, a project-level billing fact. It
// is never a per-line "spent" — that is what kept the original packet from
// stating profit on a fixed-price job (plan §3.1).
//
// A BudgetView is built by lib/budget-assemble.ts from plain rows; everything
// derived from it comes from computeTotals() so the panel, the company page,
// the MCP tools and the plain-English summary can never disagree.

import type { ChipKind } from "@/components/ui/Chip";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** How the base scope is priced. SJC's regular work is `fixed_price`;
 *  `insurance` adds a funder party. Cost-plus / T&M pricing is NOT modeled —
 *  on those the price shown is the target, and the view says so. */
export type BudgetBasis = "fixed_price" | "insurance" | "cost_plus" | "time_materials";

/** Only `trade` lines are drawn in the trade chart; the rest are listed. */
export type BudgetLineKind = "trade" | "allowance" | "overhead" | "tax" | "contingency" | "other";

/** `billed` is derived (approved + fully invoiced). Only approved / billed /
 *  paid change orders are COUNTED: they add price and est-to-finish. Money
 *  already spent on any CO counts whatever its status. */
export type BudgetCoStatus = "draft" | "sent" | "approved" | "declined" | "billed" | "paid";

export type FundingStatus = "expected" | "requested" | "received";

/** Where `collected` comes from. An explicit per-job setting, never inferred
 *  from whether invoice rows exist (plan §2.1 item 5, §3.2 "Billing"). */
export type BillingSource = "manual" | "invoices";

/** What the page may claim about profit (plan §3.6). */
export type ProfitStatus = "unknown" | "planned" | "projected";

// ---------------------------------------------------------------------------
// Core records
// ---------------------------------------------------------------------------

/** One row of the base budget: a trade or category. */
export interface BudgetLine {
  /** Stable slug. Change orders credit it; cost rows point at it. */
  id: string;
  /** budget_lines.id — what the edit forms write to. */
  rowId?: number;
  trade: string;
  detail?: string;
  /** Where the budget number came from ("Estimate #12 · Plumbing"). */
  source?: string;
  kind: BudgetLineKind;

  /** What this line was PLANNED to cost SJC. 0 is valid: work that has to
   *  happen but was never budgeted. */
  budgetCents: number;
  /** What the payer pays for this scope. null = unknown. */
  priceCents?: number | null;

  // The three states below are DERIVED from linked cost records by
  // allocateCosts() — nobody types them.
  /** Cost SJC has paid (expenses; the paid part of a sub invoice). */
  paidCents: number;
  /** Incurred, not yet paid: an unpaid sub invoice; PO material received and
   *  not yet billed. */
  owedCents: number;
  /** Promised, not yet incurred: the unreceived, unbilled balance of a sent PO. */
  orderedCents: number;

  /** Remaining cost that is not on order. A number (including an explicit 0)
   *  is used as given; null means derive `max(0, budget − paid − owed −
   *  ordered)`, or 0 once the line is 100% complete. */
  estToFinishCents: number | null;
  /** Optional hand-set physical % (0–100) for a trade where cost misleads —
   *  cabinets delivered and paid for, not installed. 100 marks the line
   *  complete. */
  percentComplete?: number | null;

  status?: string;
  statusKind?: ChipKind;

  /** This line's scope is replaced by a change order. The credit only takes
   *  EFFECT once that CO is counted; until it is signed the base scope may
   *  still have to be built, so the line stays in the cost. */
  credited?: boolean;
  creditedTo?: string;
  flags?: string[];
}

/** Price the client is credited on a CO for base scope it replaces. */
export interface BudgetCoCredit {
  lineId: string;
  amountCents: number;
}

export interface BudgetChangeOrder {
  /** Display id: "CO-1". */
  id: string;
  /** change_orders.id — what the edit forms write to. */
  rowId?: number;
  title: string;
  description?: string;
  vendor?: string;
  status: BudgetCoStatus;
  /** Full price to the client BEFORE credits. Negative = deductive. */
  totalCents: number;
  credits: BudgetCoCredit[];
  /** Already on client invoices. */
  billedCents: number;

  /** The CO's planned cost, fixed when it is priced. null = not planned. Never
   *  rebuilt from the forecast, so an overrun stays visible. */
  budgetCostCents?: number | null;
  /** Derived from linked costs, exactly as for a line. */
  paidCents: number;
  owedCents: number;
  orderedCents: number;
  /** Remaining cost. See resolveCoEst() for the three defined states. */
  estToFinishCents?: number | null;

  paidBy?: "owner" | "funder" | "split";
  funderShareCents?: number;
  /** Days since it was created, as of the view's date. */
  ageDays?: number | null;
  flags?: string[];
}

export interface FundingEvent {
  source: string;
  amountCents: number;
  trigger?: string;
  status: FundingStatus;
  statusLabel?: string;
  partyKey: string;
}

export interface BudgetParty {
  key: string;
  label: string;
  /** The most this party pays toward the BASE price. */
  baseShareCents: number;
  isOwner?: boolean;
}

export interface BudgetClientInvoice {
  number: string;
  dateLabel: string;
  label: string;
  amountCents: number;
  status: "draft" | "sent" | "paid";
  statusLabel: string;
  /** Days since it was sent, while unpaid. */
  daysOutstanding?: number | null;
  allocations?: { key: string; amountCents: number }[];
}

/** One cost record in the ledger: a sub invoice, a PO, or an expense. The
 *  three state fields are what the row CONTRIBUTES after allocation — a PO
 *  fully billed by its linked invoice contributes 0 — so the ledger always
 *  sums to the totals. */
export interface BudgetCostRow {
  source: "sub_invoice" | "po" | "expense";
  sourceId: number;
  vendor: string;
  dateLabel: string;
  /** ISO day, for the edit form. */
  on?: string | null;
  amountCents: number;
  paidCents: number;
  owedCents: number;
  orderedCents: number;
  /** Expense kind (labor / material / …), when it is one. */
  kind?: string;
  /** How an expense was paid: checking / card / cash. */
  paidFrom?: string;
  status: string;
  note?: string;
  /** Budget line id or CO id. Absent = unassigned (still counted). */
  key?: string;
  keyKind?: "line" | "co";
  purchaseOrderId?: number;
  poNumber?: string;
  sourceRef?: string;
  flags?: string[];
}

export interface BudgetBilling {
  source: BillingSource;
  /** What the page shows as collected. */
  collectedCents: number;
  /** null on a `manual` job: billing is UNKNOWN, never assumed = collected. */
  billedCents: number | null;
  /** Sent invoices in SJC OS that are not paid. A fact at any coverage. */
  unpaidInvoicesCents: number;
  openingCollectedCents: number;
  openingBilledCents: number;
  openingNote?: string;
  /** projects.collected_to_date, in cents. */
  handKeptCollectedCents: number;
  paidInvoicesCents: number;
  invoiceCount: number;
  /** hand-kept − (opening + paid invoices). */
  mismatchCents: number;
  /** True when the mismatch deserves a flag: on an `invoices` job, any gap of
   *  $1 or more; on a `manual` job, only invoices showing MORE collected than
   *  the hand-kept total (the rest is just history not entered yet). */
  mismatchFlagged: boolean;
}

/** Sources and completeness are separate things, never merged into one
 *  "confidence" grade (plan §3.6). */
export interface BudgetCompleteness {
  /** What exists. Says nothing about whether it is all of it. */
  basedOn: string[];
  /** The budget lines cover the WHOLE scope. */
  budget: boolean;
  /** "Costs entered through" (ISO day), asserted by whoever filled them. */
  costsThrough: string | null;
  billing: "tracked" | "partial" | "none";
  /** unknown = !budget · planned = budget, no costs · projected = budget + costs. */
  profit: ProfitStatus;
  missing: string[];
}

export interface BudgetView {
  project?: { slug: string; name: string; status?: string };
  basis: BudgetBasis;
  asOfLabel: string;
  budgetLabel: string;
  budgetCaption?: string;
  /** The base price: what the payer pays before change orders. */
  priceCents: number;
  /** Where that price came from. "override" = set by hand in Budget settings. */
  priceSource?: "override" | "estimate" | "contract" | "lines" | "none";
  parties: BudgetParty[];
  lines: BudgetLine[];
  changeOrders: BudgetChangeOrder[];
  fundingEvents: FundingEvent[];
  clientInvoices: BudgetClientInvoice[];
  costs: BudgetCostRow[];
  /** Cost rows that name no trade and no CO. Always counted. */
  unassigned: { paidCents: number; owedCents: number; orderedCents: number };
  billing: BudgetBilling;
  completeness: BudgetCompleteness;
  retainageCents?: number;
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Small rules, exported so the UI explains them the same way the math uses them
// ---------------------------------------------------------------------------

const CO_COUNTS: readonly BudgetCoStatus[] = ["approved", "billed", "paid"];
const CO_PENDING: readonly BudgetCoStatus[] = ["draft", "sent"];
/** Within $1 is "on budget" / "no mismatch". */
const ONE_DOLLAR = 100;

export function isCoCounted(status: BudgetCoStatus): boolean {
  return CO_COUNTS.includes(status);
}

export function coCredit(c: BudgetChangeOrder): number {
  return c.credits.reduce((s, x) => s + x.amountCents, 0);
}

/** What the client pays extra for this CO: total − credits. */
export function coNetPrice(c: BudgetChangeOrder): number {
  return c.totalCents - coCredit(c);
}

/** A line's credit is in effect only once the CO it names is counted. */
export function isLineCredited(l: BudgetLine, v: Pick<BudgetView, "changeOrders">): boolean {
  if (!l.credited || !l.creditedTo) return false;
  return v.changeOrders.some((c) => c.id === l.creditedTo && isCoCounted(c.status));
}

export function isLineComplete(l: BudgetLine): boolean {
  return l.percentComplete === 100;
}

/** A line's est-to-finish: given, or derived. */
export function resolveLineEst(l: BudgetLine): { cents: number; derived: boolean } {
  if (l.estToFinishCents != null) return { cents: l.estToFinishCents, derived: false };
  if (isLineComplete(l)) return { cents: 0, derived: true };
  return { cents: Math.max(0, l.budgetCents - l.paidCents - l.owedCents - l.orderedCents), derived: true };
}

/** A change order's remaining cost has three defined states:
 *    1 est set (incl. an explicit 0)      → as given
 *    2 est null, budgetCost set           → max(0, budgetCost − paid − owed − ordered)
 *    3 both null ("cost not planned")     → conservative: the CO is assumed to
 *      cost its FULL price (before credits — a credit's line drops out of the
 *      cost, so defaulting to the net price would invent profit), whether none
 *      or only part of its cost has been linked. A deductive CO derives to 0.
 *  Not counted (draft / sent / declined) → 0: no est-to-finish until signed. */
export function resolveCoEst(c: BudgetChangeOrder): { cents: number; state: 1 | 2 | 3; notPlanned: boolean } {
  const soFar = c.paidCents + c.owedCents + c.orderedCents;
  if (c.estToFinishCents != null) return { cents: c.estToFinishCents, state: 1, notPlanned: false };
  if (c.budgetCostCents != null) return { cents: Math.max(0, c.budgetCostCents - soFar), state: 2, notPlanned: false };
  return { cents: c.totalCents > 0 ? Math.max(0, c.totalCents - soFar) : 0, state: 3, notPlanned: true };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface BudgetLineTotals {
  id: string;
  /** The line's credit is in effect: budget and est are out of the cost. */
  credited: boolean;
  estCents: number;
  estDerived: boolean;
  /** paid + owed + ordered + est. */
  projectedCents: number;
  /** projected − budget. 0 for a credited line. */
  varianceCents: number;
  /** price − projected; null when the line has no price. */
  marginCents: number | null;
  /** Cost that counts as work done on this line. */
  doneCents: number;
}

export interface BudgetCoTotals {
  id: string;
  counted: boolean;
  netPriceCents: number;
  creditCents: number;
  estCents: number;
  estState: 1 | 2 | 3;
  notPlanned: boolean;
  /** paid + owed + ordered (+ est when counted). */
  costCents: number;
  /** budgetCost ?? max(0, total). 0 when not counted. */
  budgetCostCents: number;
  /** total − cost, when counted. */
  marginCents: number | null;
}

export interface BudgetTotals {
  // cost
  paidCents: number;
  owedCents: number;
  orderedCents: number;
  estToFinishCents: number;
  /** paid + owed. */
  incurredCents: number;
  /** incurred + ordered + est. */
  projectedCostCents: number;
  /** incurred + ordered. Shown instead of projected cost when profit is unknown. */
  costSoFarCents: number;
  budgetCostCents: number;
  coBudgetCostCents: number;
  /** budgetCost + coBudgetCost − projectedCost. Negative = over. */
  costHeadroomCents: number;
  /** Money in draft / sent / declined change orders. Counted, and flagged. */
  unsignedCoCostCents: number;
  /** Budget of lines whose credit is in effect ("moved to change orders"). */
  creditedCents: number;

  // price
  basePriceCents: number;
  coTotalCents: number;
  coCreditCents: number;
  coNetCents: number;
  coOwnerCents: number;
  coFunderCents: number;
  /** Draft + sent CO totals. Informational, never counted. */
  coPendingCents: number;
  priceCents: number;

  // profit — all null unless completeness.budget
  projectedProfitCents: number | null;
  marginPct: number | null;
  plannedProfitCents: number | null;
  plannedMarginPct: number | null;
  /** The one profit figure the page leads with: projected, else planned, else null. */
  headlineProfitCents: number | null;

  // work done, by cost — on order NEVER counts
  workDonePct: number | null;
  earnedCents: number | null;

  // billing
  collectedCents: number;
  /** price − collected. Always known. NOT "outstanding". */
  leftToCollectCents: number;
  unpaidInvoicesCents: number;
  billedCents: number | null;
  leftToBillCents: number | null;
  /** billed − earned. + = billed ahead of the work, − = unbilled work. */
  overUnderBilledCents: number | null;
  billedPct: number | null;
  collectedPct: number | null;

  // who pays (price side)
  paidBy: { key: string; label: string; amountCents: number; isOwner: boolean }[];
  unfundedCents: number;

  lines: BudgetLineTotals[];
  changeOrders: BudgetCoTotals[];
  overLines: { line: BudgetLine; varianceCents: number }[];
  underLines: { line: BudgetLine; varianceCents: number }[];
}

export function computeTotals(v: BudgetView): BudgetTotals {
  // ---- lines
  const lines: BudgetLineTotals[] = v.lines.map((l) => {
    const credited = isLineCredited(l, v);
    const est = credited ? { cents: 0, derived: false } : resolveLineEst(l);
    const incurred = l.paidCents + l.owedCents;
    const projectedCents = incurred + l.orderedCents + est.cents;
    const doneCents =
      !credited && l.percentComplete != null
        ? Math.round((projectedCents * l.percentComplete) / 100)
        : Math.min(projectedCents, incurred);
    return {
      id: l.id,
      credited,
      estCents: est.cents,
      estDerived: est.derived,
      projectedCents,
      varianceCents: credited ? 0 : projectedCents - l.budgetCents,
      marginCents: l.priceCents == null || credited ? null : l.priceCents - projectedCents,
      doneCents,
    };
  });
  const active = (i: number) => !lines[i].credited;

  // ---- change orders
  const changeOrders: BudgetCoTotals[] = v.changeOrders.map((c) => {
    const counted = isCoCounted(c.status);
    const est = resolveCoEst(c);
    const estCents = counted ? est.cents : 0;
    const costCents = c.paidCents + c.owedCents + c.orderedCents + estCents;
    return {
      id: c.id,
      counted,
      netPriceCents: coNetPrice(c),
      creditCents: coCredit(c),
      estCents,
      estState: est.state,
      notPlanned: counted && est.notPlanned,
      costCents,
      budgetCostCents: counted ? (c.budgetCostCents ?? Math.max(0, c.totalCents)) : 0,
      marginCents: counted ? c.totalCents - costCents : null,
    };
  });

  // ---- cost side. Real money ALWAYS counts: every line (credited or not),
  // every change order (signed or not), and whatever is unassigned.
  const sumLines = (f: (l: BudgetLine) => number) => v.lines.reduce((s, l) => s + f(l), 0);
  const sumCos = (f: (c: BudgetChangeOrder) => number) => v.changeOrders.reduce((s, c) => s + f(c), 0);
  const u = v.unassigned;
  const paidCents = sumLines((l) => l.paidCents) + sumCos((c) => c.paidCents) + u.paidCents;
  const owedCents = sumLines((l) => l.owedCents) + sumCos((c) => c.owedCents) + u.owedCents;
  const orderedCents = sumLines((l) => l.orderedCents) + sumCos((c) => c.orderedCents) + u.orderedCents;
  const estToFinishCents =
    lines.reduce((s, r) => s + r.estCents, 0) + changeOrders.reduce((s, r) => s + r.estCents, 0);
  const incurredCents = paidCents + owedCents;
  const costSoFarCents = incurredCents + orderedCents;
  const projectedCostCents = costSoFarCents + estToFinishCents;

  const budgetCostCents = v.lines.reduce((s, l, i) => s + (active(i) ? l.budgetCents : 0), 0);
  const creditedCents = v.lines.reduce((s, l, i) => s + (active(i) ? 0 : l.budgetCents), 0);
  const coBudgetCostCents = changeOrders.reduce((s, r) => s + r.budgetCostCents, 0);
  const costHeadroomCents = budgetCostCents + coBudgetCostCents - projectedCostCents;
  const unsignedCoCostCents = v.changeOrders.reduce(
    (s, c) => s + (isCoCounted(c.status) ? 0 : c.paidCents + c.owedCents + c.orderedCents),
    0,
  );

  // ---- price side
  const counted = v.changeOrders.filter((c) => isCoCounted(c.status));
  const basePriceCents = v.priceCents;
  const coTotalCents = counted.reduce((s, c) => s + c.totalCents, 0);
  const coCreditCents = counted.reduce((s, c) => s + coCredit(c), 0);
  const coNetCents = coTotalCents - coCreditCents;
  const coFunderCents = counted.reduce((s, c) => {
    const net = coNetPrice(c);
    if (c.paidBy === "funder") return s + net;
    if (c.paidBy === "split") return s + Math.min(net, c.funderShareCents ?? 0);
    return s;
  }, 0);
  const coOwnerCents = coNetCents - coFunderCents;
  const coPendingCents = v.changeOrders
    .filter((c) => CO_PENDING.includes(c.status))
    .reduce((s, c) => s + c.totalCents, 0);
  const priceCents = basePriceCents + coNetCents;

  // ---- profit: only a complete budget may claim one
  const known = v.completeness.budget;
  const projectedProfitCents = known ? priceCents - projectedCostCents : null;
  const plannedProfitCents = known ? priceCents - (budgetCostCents + coBudgetCostCents) : null;
  const ratio = (a: number | null, b: number) => (a == null || b <= 0 ? null : a / b);
  const marginPct = ratio(projectedProfitCents, priceCents);
  const plannedMarginPct = ratio(plannedProfitCents, priceCents);
  const headlineProfitCents =
    v.completeness.profit === "projected"
      ? projectedProfitCents
      : v.completeness.profit === "planned"
        ? plannedProfitCents
        : null;

  // ---- work done, by cost. Without the whole scope there is no denominator.
  const doneCents =
    lines.reduce((s, r) => s + r.doneCents, 0) +
    sumCos((c) => c.paidCents + c.owedCents) +
    u.paidCents +
    u.owedCents;
  const workDonePct =
    known && projectedCostCents > 0 ? Math.max(0, Math.min(1, doneCents / projectedCostCents)) : null;
  const earnedCents = workDonePct == null ? null : Math.round(priceCents * workDonePct);

  // ---- billing
  const collectedCents = v.billing.collectedCents;
  const billedCents = v.billing.billedCents;
  const leftToBillCents = billedCents == null ? null : priceCents - billedCents;
  const overUnderBilledCents = billedCents == null || earnedCents == null ? null : billedCents - earnedCents;

  // ---- who pays (price side). The owner takes owner-paid COs and any gap
  // between the base price and what the parties cover.
  const shares = v.parties.reduce((s, p) => s + p.baseShareCents, 0);
  const unfundedCents = v.parties.length ? Math.max(0, basePriceCents - shares) : 0;
  const funder = v.parties.find((p) => !p.isOwner);
  const hasOwner = v.parties.some((p) => p.isOwner);
  const paidBy = v.parties.map((p, i) => {
    let amountCents = Math.min(p.baseShareCents, Math.max(0, basePriceCents));
    if (p.isOwner || (!hasOwner && i === 0)) amountCents += coOwnerCents + unfundedCents;
    if (p === funder && hasOwner) amountCents += coFunderCents;
    return { key: p.key, label: p.label, amountCents, isOwner: !!p.isOwner };
  });

  // ---- over / under
  const withVar = v.lines
    .map((line, i) => ({ line, varianceCents: lines[i].varianceCents, credited: lines[i].credited }))
    .filter((x) => !x.credited);
  const overLines = withVar
    .filter((x) => x.varianceCents > ONE_DOLLAR)
    .sort((a, b) => b.varianceCents - a.varianceCents)
    .map(({ line, varianceCents }) => ({ line, varianceCents }));
  const underLines = withVar
    .filter((x) => x.varianceCents < -ONE_DOLLAR)
    .sort((a, b) => a.varianceCents - b.varianceCents)
    .map(({ line, varianceCents }) => ({ line, varianceCents }));

  return {
    paidCents, owedCents, orderedCents, estToFinishCents, incurredCents, projectedCostCents,
    costSoFarCents, budgetCostCents, coBudgetCostCents, costHeadroomCents, unsignedCoCostCents,
    creditedCents,
    basePriceCents, coTotalCents, coCreditCents, coNetCents, coOwnerCents, coFunderCents,
    coPendingCents, priceCents,
    projectedProfitCents, marginPct, plannedProfitCents, plannedMarginPct, headlineProfitCents,
    workDonePct, earnedCents,
    collectedCents,
    leftToCollectCents: priceCents - collectedCents,
    unpaidInvoicesCents: v.billing.unpaidInvoicesCents,
    billedCents, leftToBillCents, overUnderBilledCents,
    billedPct: ratio(billedCents, priceCents),
    collectedPct: ratio(collectedCents, priceCents),
    paidBy, unfundedCents,
    lines, changeOrders, overLines, underLines,
  };
}

// ---------------------------------------------------------------------------
// Billing reconciliation (the reviewed switch from `manual` to `invoices`)
// ---------------------------------------------------------------------------

export interface BillingReconciliationProposal {
  handKeptCents: number;
  paidInvoicesCents: number;
  /** hand-kept − paid invoices. */
  differenceCents: number;
  /** Money collected before invoices were tracked here. */
  proposedOpeningCollectedCents: number;
  proposedOpeningBilledCents: number;
  /** The invoices show more collected than the hand-kept total. */
  handKeptLooksStale: boolean;
}

/** Side-by-side numbers for the reconcile screen. Proposes, never applies. */
export function proposeBillingReconciliation(
  b: Pick<BudgetBilling, "handKeptCollectedCents" | "paidInvoicesCents">,
): BillingReconciliationProposal {
  const differenceCents = b.handKeptCollectedCents - b.paidInvoicesCents;
  const opening = Math.max(0, differenceCents);
  return {
    handKeptCents: b.handKeptCollectedCents,
    paidInvoicesCents: b.paidInvoicesCents,
    differenceCents,
    proposedOpeningCollectedCents: opening,
    proposedOpeningBilledCents: opening,
    handKeptLooksStale: differenceCents <= -ONE_DOLLAR,
  };
}

// ---------------------------------------------------------------------------
// Company rollup — sums only what is known and comparable, and says its coverage
// ---------------------------------------------------------------------------

export interface CompanyJob {
  slug: string;
  name: string;
  completeness: Pick<BudgetCompleteness, "profit" | "billing" | "budget">;
  totals: BudgetTotals;
}

export interface CompanyTotals {
  jobCount: number;
  contractedCents: number;
  collectedCents: number;
  leftToCollectCents: number;
  unpaidInvoicesCents: number;
  billingTrackedJobs: number;
  /** Σ headline profit over jobs whose profit is planned or projected. */
  profitCents: number;
  profitJobs: number;
  projectedJobs: number;
  plannedJobs: number;
  /** Σ price of those SAME jobs — the margin's denominator and the coverage. */
  profitPriceCoverageCents: number;
  blendedMarginPct: number | null;
  /** Σ max(0, −overUnderBilled) over jobs with a complete budget AND tracked billing. */
  unbilledCents: number;
  unbilledJobs: number;
}

export function rollupCompany(jobs: CompanyJob[]): CompanyTotals {
  const sum = (f: (j: CompanyJob) => number) => jobs.reduce((s, j) => s + f(j), 0);
  const withProfit = jobs.filter((j) => j.totals.headlineProfitCents != null);
  const profitCents = withProfit.reduce((s, j) => s + (j.totals.headlineProfitCents ?? 0), 0);
  const profitPriceCoverageCents = withProfit.reduce((s, j) => s + j.totals.priceCents, 0);
  const billable = jobs.filter((j) => j.totals.overUnderBilledCents != null);
  return {
    jobCount: jobs.length,
    contractedCents: sum((j) => j.totals.priceCents),
    collectedCents: sum((j) => j.totals.collectedCents),
    leftToCollectCents: sum((j) => j.totals.leftToCollectCents),
    unpaidInvoicesCents: sum((j) => j.totals.unpaidInvoicesCents),
    billingTrackedJobs: jobs.filter((j) => j.completeness.billing === "tracked").length,
    profitCents,
    profitJobs: withProfit.length,
    projectedJobs: withProfit.filter((j) => j.completeness.profit === "projected").length,
    plannedJobs: withProfit.filter((j) => j.completeness.profit === "planned").length,
    profitPriceCoverageCents,
    blendedMarginPct: profitPriceCoverageCents > 0 ? profitCents / profitPriceCoverageCents : null,
    unbilledCents: billable.reduce((s, j) => s + Math.max(0, -(j.totals.overUnderBilledCents ?? 0)), 0),
    unbilledJobs: billable.length,
  };
}

// ---------------------------------------------------------------------------
// The plain-English layer. Deterministic templates, never AI, so the summary
// is always true. Plain strings (no markup) — the same text serves the page,
// the MCP tools and the Ask-window context.
// ---------------------------------------------------------------------------

export function describeFinancials(v: BudgetView, t: BudgetTotals): string[] {
  const out: string[] = [];
  const c = v.completeness;
  const manual = v.billing.source === "manual";

  // 1 — profit
  if (c.profit === "projected" && t.projectedProfitCents != null) {
    const p = t.projectedProfitCents;
    const vsPlan = p - (t.plannedProfitCents ?? p);
    const tail =
      Math.abs(vsPlan) < 100 * ONE_DOLLAR
        ? " — right on plan"
        : vsPlan < 0
          ? ` — ${fmtK(-vsPlan)} less than planned`
          : ` — ${fmtK(vsPlan)} more than planned`;
    out.push(
      p >= 0
        ? `This job should make about ${fmtAbout(p)} (${fmtPct(t.marginPct)}) if the remaining work costs what you expect${tail}.`
        : `This job is on track to lose about ${fmtAbout(-p)} if the remaining work costs what you expect${tail}.`,
    );
  } else if (c.profit === "planned" && t.plannedProfitCents != null) {
    out.push(
      `The budget plans a profit of about ${fmtAbout(t.plannedProfitCents)} (${fmtPct(t.plannedMarginPct)}). ` +
        `No costs have been entered yet, so this is the plan, not a forecast.`,
    );
  } else {
    // True whether trades are missing or their costs just aren't real yet (an adopted no-markup estimate).
    const why = v.lines.length ? "the budget for this job isn't finished" : "there is no budget for this job yet";
    const logged = t.costSoFarCents > 0 ? `${fmtK(t.costSoFarCents)} of cost has been logged so far.` : "No costs have been logged.";
    out.push(`Profit isn't known yet: ${why}. ${logged}`);
  }

  // 2 — progress
  if (t.priceCents <= 0) {
    out.push("No price is set for this job yet.");
  } else if (t.workDonePct != null && t.billedPct != null && t.overUnderBilledCents != null) {
    const lead = `About ${fmtPct(t.workDonePct)} of the work is done (by cost) and ${fmtPct(t.billedPct)} of the price is billed`;
    const gapPoints = Math.abs(t.billedPct - t.workDonePct) * 100;
    if (gapPoints <= 5) out.push(`${lead} — billing is roughly on pace.`);
    else if (t.overUnderBilledCents > 0) out.push(`${lead} — you've billed about ${fmtAbout(t.overUnderBilledCents)} ahead of the work.`);
    else out.push(`${lead} — there is about ${fmtAbout(-t.overUnderBilledCents)} of unbilled work to invoice.`);
  } else {
    const work = t.workDonePct != null ? `About ${fmtPct(t.workDonePct)} of the work is done (by cost). ` : "";
    const tracked = manual ? "; billing history isn't tracked here yet." : ".";
    out.push(`${work}${fmtPct(t.collectedPct)} of the price has been collected${tracked}`);
  }

  // 3 — cash. "Left to collect" is never called "outstanding".
  if (t.priceCents > 0) {
    let cash = "";
    if (t.unpaidInvoicesCents > 0) {
      const oldest = v.clientInvoices
        .filter((i) => i.status === "sent" && (i.daysOutstanding ?? 0) > 0)
        .sort((a, b) => (b.daysOutstanding ?? 0) - (a.daysOutstanding ?? 0))[0];
      cash = `${fmtK(t.unpaidInvoicesCents)} of invoices are sent and not yet paid`;
      if (oldest) cash += `; ${oldest.number} is ${oldest.daysOutstanding} days out`;
      cash += ". ";
    }
    out.push(
      t.leftToCollectCents > 0
        ? `${cash}${fmtK(t.leftToCollectCents)} is left to collect on this job.`
        : `${cash}This job is fully collected.`,
    );
  }

  // 4 — problems, only when there are any
  const problems: string[] = [];
  if (t.overLines.length) {
    const named = t.overLines.slice(0, 3).map((x) => `${x.line.trade} ${fmtSigned(x.varianceCents)}`).join(", ");
    const n = t.overLines.length;
    problems.push(`${n} ${n === 1 ? "trade is" : "trades are"} over budget (${named}${n > 3 ? ", …" : ""}).`);
  }
  for (const co of v.changeOrders) {
    const soFar = co.paidCents + co.owedCents + co.orderedCents;
    if (!isCoCounted(co.status) && soFar > 0) problems.push(`${fmtK(soFar)} has been spent on ${co.id}, which isn't signed.`);
  }
  const waiting = v.changeOrders.filter((co) => co.status === "sent");
  if (waiting.length) {
    const amt = fmtK(waiting.reduce((s, co) => s + co.totalCents, 0));
    problems.push(
      waiting.length === 1
        ? `1 change order (${amt}) is waiting on a signature and is not counted.`
        : `${waiting.length} change orders (${amt}) are waiting on a signature and are not counted.`,
    );
  }
  const unassigned = v.unassigned.paidCents + v.unassigned.owedCents + v.unassigned.orderedCents;
  if (unassigned > 0) problems.push(`${fmtK(unassigned)} of costs are not assigned to a trade.`);
  if (v.billing.mismatchFlagged)
    problems.push(`The hand-kept collected total is ${fmtK(Math.abs(v.billing.mismatchCents))} off the invoices — reconcile billing.`);
  if (problems.length) out.push(problems.join(" "));

  return out;
}

// ---------------------------------------------------------------------------
// Formatting. Whole dollars for headlines and charts; tables use fmtUsd
// (lib/cost-book-units) for cents.
// ---------------------------------------------------------------------------

/** "$21,666" — whole dollars. */
export function fmtK(cents: number): string {
  const n = Math.round((cents || 0) / 100);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
}

/** "+$1,575" / "-$708". */
export function fmtSigned(cents: number): string {
  return `${cents >= 0 ? "+" : "-"}${fmtK(Math.abs(cents))}`;
}

/** A figure introduced with "about": nearest $100 from $1,000 up, nearest $10
 *  from $100, else the dollar. */
export function fmtAbout(cents: number): string {
  const dollars = Math.abs(cents || 0) / 100;
  const step = dollars >= 1000 ? 100 : dollars >= 100 ? 10 : 1;
  const rounded = Math.round(dollars / step) * step;
  return `${cents < 0 ? "-" : ""}$${rounded.toLocaleString("en-US")}`;
}

/** "24%"; one decimal under 10% ("5.7%"); "—" when unknown. */
export function fmtPct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const p = ratio * 100;
  if (Math.abs(p) < 10 && Math.abs(p - Math.round(p)) >= 0.05) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}
