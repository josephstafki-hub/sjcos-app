// Project financials — the pure half of the builder. NO db import: plain rows
// in, a BudgetView out, so every contested rule is unit-testable
// (tests/budget-assemble.test.mjs) and the MCP .mjs server can load the same
// code. lib/budget.ts (server-only) just runs the queries and hands rows over.
// Spec: docs/project-financials-plan.md §3.2–§3.3, §3.6, §7.
//
// Sibling imports carry a `.ts` extension so `node --test` resolves them.
//
// UNITS: every field is integer cents except the two explicitly named
// `…Dollars` on RawProject (projects.contract_value / collected_to_date are
// whole dollars in the DB). They are converted here, at the boundary, once.

import type { ChipKind } from "@/components/ui/Chip";
import {
  computeTotals,
  fmtK,
  isCoCounted,
  type BillingSource,
  type BudgetBasis,
  type BudgetBilling,
  type BudgetChangeOrder,
  type BudgetClientInvoice,
  type BudgetCompleteness,
  type BudgetCoStatus,
  type BudgetCostRow,
  type BudgetLine,
  type BudgetLineKind,
  type BudgetParty,
  type BudgetView,
  type FundingEvent,
} from "./budget-types.ts";

// ---------------------------------------------------------------------------
// Raw rows — what the query layer (or a fixture) supplies
// ---------------------------------------------------------------------------

export interface RawProject {
  slug: string;
  name: string;
  /** projects.status — only "construction" matters here (stale-cost warning). */
  status?: string;
  clientName?: string;
  basis: BudgetBasis;
  budgetLabel?: string;
  budgetCaption?: string;
  /** projects.price_cents: the base price EXCLUDING change orders. null = not set. */
  priceCentsOverride: number | null;
  /** projects.contract_value — WHOLE DOLLARS. */
  contractValueDollars: number;
  /** projects.collected_to_date — WHOLE DOLLARS. */
  collectedToDateDollars: number;
  /** total of the project's approved estimate, if there is one. */
  approvedEstimateTotalCents: number | null;
  retainageCents?: number;
  notes?: string[];
  /** projects.budget_complete: the lines cover the whole scope. */
  budgetComplete: boolean;
  /** projects.costs_through, ISO day. */
  costsThrough: string | null;
  billingSource: BillingSource;
  openingCollectedCents: number;
  openingBilledCents: number;
  openingNote?: string;
}

export interface RawBudgetLine {
  id: number;
  key: string;
  trade: string;
  detail?: string;
  source?: string;
  kind: BudgetLineKind;
  budgetCents: number;
  priceCents: number | null;
  estToFinishCents: number | null;
  percentComplete: number | null;
  status?: string;
  statusKind?: ChipKind;
  creditedCoId: number | null;
  flags?: string[];
}

export interface RawChangeOrder {
  id: number;
  /** "CO-1". Blank falls back to `CO-<id>`. */
  number: string;
  title: string;
  description?: string;
  vendorLabel?: string;
  priceCents: number;
  status: "draft" | "sent" | "approved" | "declined";
  paidBy?: "owner" | "funder" | "split";
  funderShareCents?: number;
  budgetCostCents: number | null;
  estToFinishCents: number | null;
  /** created_at, ISO day. */
  createdOn?: string | null;
  credits: { budgetLineId: number; amountCents: number }[];
}

export interface RawInvoice {
  number: string;
  milestone: string;
  amountCents: number;
  status: "draft" | "sent" | "paid";
  createdOn: string | null;
  sentOn: string | null;
  paidOn: string | null;
  /** invoices.line_items; optional `budget_key` / `co_id` allocate a line item. */
  lineItems?: { label: string; amount: number; budget_key?: string; co_id?: number }[];
}

export type RawPoStatus = "draft" | "queued" | "sent" | "partial" | "fulfilled" | "closed" | "void";

export interface RawPurchaseOrder {
  id: number;
  poNumber: string;
  vendorName: string;
  title: string;
  status: RawPoStatus;
  subtotalCents: number;
  /** Σ round(qty_received × unit_cost) over its lines — see receivedValue(). */
  receivedValueCents: number;
  /** sent_at ?? created_at, ISO day. */
  on: string | null;
  budgetLineId: number | null;
  changeOrderId: number | null;
}

export interface RawSubInvoice {
  id: number;
  vendor: string;
  amountCents: number;
  status: "submitted" | "approved" | "paid";
  /** Paid so far on an invoice that is not fully paid (a 50% deposit). */
  paidCents?: number | null;
  note?: string;
  on: string | null;
  budgetLineId: number | null;
  changeOrderId: number | null;
  /** The PO this invoice bills against, so the two count once. */
  purchaseOrderId: number | null;
  /** Stable import key ("cpk:1745"). Writes upsert on it. */
  sourceRef?: string;
}

export interface RawExpense {
  id: number;
  vendorLabel: string;
  kind: string;
  /** May be negative: a return or refund. */
  amountCents: number;
  memo?: string;
  paidFrom?: string;
  on: string | null;
  budgetLineId: number | null;
  changeOrderId: number | null;
  purchaseOrderId: number | null;
  sourceRef?: string;
}

export interface RawProjectMoney {
  project: RawProject;
  lines: RawBudgetLine[];
  changeOrders: RawChangeOrder[];
  invoices: RawInvoice[];
  purchaseOrders: RawPurchaseOrder[];
  subInvoices: RawSubInvoice[];
  expenses: RawExpense[];
  parties: BudgetParty[];
  fundingEvents: FundingEvent[];
}

// ---------------------------------------------------------------------------
// Counting each cost once
// ---------------------------------------------------------------------------

export interface AllocatedCost {
  source: "sub_invoice" | "po" | "expense";
  sourceId: number;
  amountCents: number;
  paidCents: number;
  owedCents: number;
  orderedCents: number;
  /** Effective target, after a linked bill inherits its PO's. */
  budgetLineId: number | null;
  changeOrderId: number | null;
  purchaseOrderId: number | null;
  on: string | null;
  flags: string[];
}

export interface CostAllocation {
  rows: AllocatedCost[];
  /** source_refs seen twice within one record type; the repeat is dropped. */
  duplicatesIgnored: string[];
}

/** A PO counts only once it is a real promise. */
const PO_LIVE: readonly RawPoStatus[] = ["sent", "partial", "fulfilled", "closed"];
const DUPLICATE_WINDOW_DAYS = 14;

/** Σ round(qty_received × unit_cost): what a PO's receiving says has arrived. */
export function receivedValue(lines: { qtyReceived: number; unitCostCents: number }[]): number {
  return lines.reduce((s, l) => s + Math.round(l.qtyReceived * l.unitCostCents), 0);
}

/** Three kinds of record can describe one purchase: a PO (a promise), a sub
 *  invoice (a bill), an expense (a payment SJC made directly). A bill that
 *  names its PO CONSUMES it, so the purchase is counted once:
 *
 *    R = received value      B = Σ bills linked to the PO, in any payment state
 *    PO.owed    = max(0, R − B)                      received, nobody billed it yet
 *    PO.ordered = closed ? 0 : max(0, subtotal − max(R, B))
 *    PO.paid    = 0          a PO is never "spent" — `fulfilled` only means received
 *
 *  Closing a PO releases what was never received or billed; it never erases
 *  cost. Bills above the PO total count in full and are flagged. */
export function allocateCosts(input: {
  purchaseOrders: RawPurchaseOrder[];
  subInvoices: RawSubInvoice[];
  expenses: RawExpense[];
}): CostAllocation {
  const duplicatesIgnored: string[] = [];
  const firstByRef = <T extends { sourceRef?: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const ref = (r.sourceRef ?? "").trim();
      if (!ref) return true;
      if (seen.has(ref)) {
        duplicatesIgnored.push(ref);
        return false;
      }
      seen.add(ref);
      return true;
    });
  };
  const subInvoices = firstByRef(input.subInvoices);
  const expenses = firstByRef(input.expenses);

  const poById = new Map(input.purchaseOrders.map((po) => [po.id, po]));
  const billed = new Map<number, number>();
  for (const b of [...subInvoices, ...expenses]) {
    if (b.purchaseOrderId != null)
      billed.set(b.purchaseOrderId, (billed.get(b.purchaseOrderId) ?? 0) + b.amountCents);
  }

  const rows: AllocatedCost[] = [];

  for (const po of input.purchaseOrders) {
    if (po.status === "void") continue;
    const live = PO_LIVE.includes(po.status);
    const R = po.receivedValueCents;
    const B = billed.get(po.id) ?? 0;
    const flags: string[] = [];
    if (live && B > po.subtotalCents) flags.push(`billed ${fmtK(B - po.subtotalCents)} over ${po.poNumber || "the PO"}`);
    rows.push({
      source: "po",
      sourceId: po.id,
      amountCents: po.subtotalCents,
      paidCents: 0,
      owedCents: live ? Math.max(0, R - B) : 0,
      orderedCents: live && po.status !== "closed" ? Math.max(0, po.subtotalCents - Math.max(R, B)) : 0,
      budgetLineId: po.budgetLineId,
      changeOrderId: po.changeOrderId,
      purchaseOrderId: null,
      on: po.on,
      flags,
    });
  }

  // A linked bill inherits its PO's trade / CO unless it names its own.
  const target = (b: { budgetLineId: number | null; changeOrderId: number | null; purchaseOrderId: number | null }) => {
    if (b.budgetLineId != null || b.changeOrderId != null) return { budgetLineId: b.budgetLineId, changeOrderId: b.changeOrderId };
    const po = b.purchaseOrderId != null ? poById.get(b.purchaseOrderId) : undefined;
    return { budgetLineId: po?.budgetLineId ?? null, changeOrderId: po?.changeOrderId ?? null };
  };

  for (const s of subInvoices) {
    const paidCents = s.status === "paid" ? s.amountCents : Math.max(0, Math.min(s.amountCents, s.paidCents ?? 0));
    rows.push({
      source: "sub_invoice",
      sourceId: s.id,
      amountCents: s.amountCents,
      paidCents,
      owedCents: s.amountCents - paidCents,
      orderedCents: 0,
      ...target(s),
      purchaseOrderId: s.purchaseOrderId,
      on: s.on,
      flags: [],
    });
  }
  for (const e of expenses) {
    rows.push({
      source: "expense",
      sourceId: e.id,
      amountCents: e.amountCents,
      paidCents: e.amountCents,
      owedCents: 0,
      orderedCents: 0,
      ...target(e),
      purchaseOrderId: e.purchaseOrderId,
      on: e.on,
      flags: [],
    });
  }

  // Look-alikes are flagged, never merged: both still count.
  const refOf = new Map<AllocatedCost, string>();
  for (const s of subInvoices) refOf.set(rows.find((r) => r.source === "sub_invoice" && r.sourceId === s.id)!, (s.sourceRef ?? "").trim());
  for (const e of expenses) refOf.set(rows.find((r) => r.source === "expense" && r.sourceId === e.id)!, (e.sourceRef ?? "").trim());
  const flagPair = (a: AllocatedCost, b: AllocatedCost) => {
    for (const r of [a, b]) if (!r.flags.includes("possible duplicate")) r.flags.push("possible duplicate");
  };
  const unlinkedBills = rows.filter((r) => r.source !== "po" && r.purchaseOrderId == null && r.amountCents !== 0);
  for (let i = 0; i < unlinkedBills.length; i++) {
    for (let j = i + 1; j < unlinkedBills.length; j++) {
      const a = unlinkedBills[i], b = unlinkedBills[j];
      if (a.amountCents !== b.amountCents) continue;
      const da = dayNumber(a.on), db = dayNumber(b.on);
      if (da != null && db != null && Math.abs(da - db) > DUPLICATE_WINDOW_DAYS) continue;
      // Two records of one type that each carry their own import key are two documents.
      if (a.source === b.source && refOf.get(a) && refOf.get(b)) continue;
      flagPair(a, b);
    }
  }
  // An unlinked bill for exactly a live PO's total is probably that PO's bill.
  for (const po of rows.filter((r) => r.source === "po")) {
    const raw = poById.get(po.sourceId)!;
    if (!PO_LIVE.includes(raw.status) || po.amountCents === 0) continue;
    for (const b of unlinkedBills) if (b.amountCents === po.amountCents) flagPair(po, b);
  }

  return { rows, duplicatesIgnored };
}

// ---------------------------------------------------------------------------
// Rows → BudgetView
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STALE_COST_DAYS = 14;
const ONE_DOLLAR = 100;

/** Days since the epoch for an ISO day; UTC so a label never shifts by timezone. */
function dayNumber(iso: string | null | undefined): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000) : null;
}

function dayLabel(iso: string | null | undefined, withYear = false): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "";
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${withYear ? `, ${m[1]}` : ""}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function assembleBudgetView(raw: RawProjectMoney, opts: { asOf: string }): BudgetView {
  const p = raw.project;
  const asOfDay = dayNumber(opts.asOf);
  const lineById = new Map(raw.lines.map((l) => [l.id, l]));
  const coById = new Map(raw.changeOrders.map((c) => [c.id, c]));
  const coNumber = (c: RawChangeOrder) => c.number || `CO-${c.id}`;

  // ---- costs, counted once, then summed onto their line / CO / "unassigned"
  const allocation = allocateCosts(raw);
  const blank = () => ({ paidCents: 0, owedCents: 0, orderedCents: 0 });
  const onLine = new Map<number, ReturnType<typeof blank>>();
  const onCo = new Map<number, ReturnType<typeof blank>>();
  const unassigned = blank();
  const bucketFor = (r: AllocatedCost) => {
    if (r.budgetLineId != null && lineById.has(r.budgetLineId)) {
      if (!onLine.has(r.budgetLineId)) onLine.set(r.budgetLineId, blank());
      return onLine.get(r.budgetLineId)!;
    }
    if (r.changeOrderId != null && coById.has(r.changeOrderId)) {
      if (!onCo.has(r.changeOrderId)) onCo.set(r.changeOrderId, blank());
      return onCo.get(r.changeOrderId)!;
    }
    return unassigned;
  };
  for (const r of allocation.rows) {
    const b = bucketFor(r);
    b.paidCents += r.paidCents;
    b.owedCents += r.owedCents;
    b.orderedCents += r.orderedCents;
  }

  // ---- lines
  const lines: BudgetLine[] = raw.lines.map((l) => {
    const creditCo = l.creditedCoId != null ? coById.get(l.creditedCoId) : undefined;
    return {
      id: l.key,
      rowId: l.id,
      trade: l.trade,
      detail: l.detail || undefined,
      source: l.source || undefined,
      kind: l.kind,
      budgetCents: l.budgetCents,
      priceCents: l.priceCents,
      ...(onLine.get(l.id) ?? blank()),
      estToFinishCents: l.estToFinishCents,
      percentComplete: l.percentComplete,
      status: l.status || undefined,
      statusKind: l.statusKind,
      credited: !!creditCo,
      creditedTo: creditCo ? coNumber(creditCo) : undefined,
      flags: l.flags?.length ? l.flags : undefined,
    };
  });

  // ---- change orders. `billed` is derived: approved and fully on client invoices.
  const billedOnCo = new Map<number, number>();
  for (const inv of raw.invoices) {
    if (inv.status === "draft") continue;
    for (const li of inv.lineItems ?? [])
      if (li.co_id != null) billedOnCo.set(li.co_id, (billedOnCo.get(li.co_id) ?? 0) + (li.amount ?? 0));
  }
  const changeOrders: BudgetChangeOrder[] = raw.changeOrders.map((c) => {
    const billedCents = billedOnCo.get(c.id) ?? 0;
    const status: BudgetCoStatus =
      c.status === "approved" && c.priceCents > 0 && billedCents >= c.priceCents ? "billed" : c.status;
    return {
      id: coNumber(c),
      rowId: c.id,
      title: c.title,
      description: c.description || undefined,
      vendor: c.vendorLabel || undefined,
      status,
      totalCents: c.priceCents,
      credits: c.credits
        .filter((x) => lineById.has(x.budgetLineId))
        .map((x) => ({ lineId: lineById.get(x.budgetLineId)!.key, amountCents: x.amountCents })),
      billedCents,
      budgetCostCents: c.budgetCostCents,
      ...(onCo.get(c.id) ?? blank()),
      estToFinishCents: c.estToFinishCents,
      paidBy: c.paidBy,
      funderShareCents: c.funderShareCents || undefined,
      ageDays: dayNumber(c.createdOn) != null && asOfDay != null ? Math.max(0, asOfDay - dayNumber(c.createdOn)!) : null,
    };
  });

  // ---- client invoices
  const clientInvoices: BudgetClientInvoice[] = raw.invoices.map((i) => {
    const sentDay = dayNumber(i.sentOn);
    const days = i.status === "sent" && sentDay != null && asOfDay != null ? Math.max(0, asOfDay - sentDay) : null;
    const statusLabel =
      i.status === "paid"
        ? `Paid ${dayLabel(i.paidOn)}`.trim()
        : i.status === "sent"
          ? `Sent ${dayLabel(i.sentOn)}${days != null ? ` · ${plural(days, "day")}` : ""}`.trim()
          : "Draft";
    const allocations = (i.lineItems ?? [])
      .filter((li) => li.budget_key || li.co_id != null)
      .map((li) => ({
        key: li.budget_key ?? (coById.has(li.co_id!) ? coNumber(coById.get(li.co_id!)!) : `CO-${li.co_id}`),
        amountCents: li.amount,
      }));
    return {
      number: i.number,
      dateLabel: dayLabel(i.sentOn ?? i.createdOn),
      label: i.milestone,
      amountCents: i.amountCents,
      status: i.status,
      statusLabel,
      daysOutstanding: days,
      allocations: allocations.length ? allocations : undefined,
    };
  });

  // ---- billing. The source is a per-job setting, never inferred from whether
  // invoice rows exist: nothing keeps projects.collected_to_date in step with
  // the invoices table, and on live jobs the two already disagree.
  const handKept = Math.round(p.collectedToDateDollars * 100);
  const paidInvoices = raw.invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
  const sentInvoices = raw.invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amountCents, 0);
  const tracked = p.billingSource === "invoices";
  const openingCollected = tracked ? p.openingCollectedCents : 0;
  const openingBilled = tracked ? p.openingBilledCents : 0;
  const mismatchCents = handKept - (openingCollected + paidInvoices);
  const billing: BudgetBilling = {
    source: p.billingSource,
    collectedCents: tracked ? openingCollected + paidInvoices : handKept,
    billedCents: tracked ? openingBilled + paidInvoices + sentInvoices : null,
    unpaidInvoicesCents: sentInvoices,
    openingCollectedCents: openingCollected,
    openingBilledCents: openingBilled,
    openingNote: tracked ? p.openingNote || undefined : undefined,
    handKeptCollectedCents: handKept,
    paidInvoicesCents: paidInvoices,
    invoiceCount: raw.invoices.length,
    mismatchCents,
    mismatchFlagged: tracked
      ? Math.abs(mismatchCents) >= ONE_DOLLAR
      : raw.invoices.length > 0 && mismatchCents <= -ONE_DOLLAR,
  };

  // ---- the base price, EXCLUDING change orders
  const contractCents = Math.round(p.contractValueDollars * 100);
  const linePrices = raw.lines.map((l) => l.priceCents);
  const allLinesPriced = raw.lines.length > 0 && linePrices.every((x) => x != null);
  const linePriceSum = linePrices.reduce((s: number, x) => s + (x ?? 0), 0);
  let priceCents = 0;
  let priceSource: "override" | "estimate" | "contract" | "lines" | "none" = "none";
  if (p.priceCentsOverride != null) [priceCents, priceSource] = [p.priceCentsOverride, "override"];
  else if (p.approvedEstimateTotalCents != null) [priceCents, priceSource] = [p.approvedEstimateTotalCents, "estimate"];
  else if (contractCents > 0) [priceCents, priceSource] = [contractCents, "contract"];
  else if (allLinesPriced && linePriceSum > 0) [priceCents, priceSource] = [linePriceSum, "lines"];

  const parties: BudgetParty[] = raw.parties.length
    ? raw.parties
    : [{ key: "owner", label: p.clientName || "Client", baseShareCents: priceCents, isOwner: true }];

  // ---- the ledger
  const poById = new Map(raw.purchaseOrders.map((po) => [po.id, po]));
  const subById = new Map(raw.subInvoices.map((s) => [s.id, s]));
  const expById = new Map(raw.expenses.map((e) => [e.id, e]));
  const costs: BudgetCostRow[] = allocation.rows.map((r) => {
    const line = r.budgetLineId != null ? lineById.get(r.budgetLineId) : undefined;
    const co = !line && r.changeOrderId != null ? coById.get(r.changeOrderId) : undefined;
    const flags = [...r.flags];
    if (co && !isCoCounted(co.status) && r.paidCents + r.owedCents + r.orderedCents !== 0)
      flags.push("on an unsigned change order");
    const linkedPo = r.purchaseOrderId != null ? poById.get(r.purchaseOrderId) : undefined;
    const base = {
      source: r.source,
      sourceId: r.sourceId,
      dateLabel: dayLabel(r.on),
      on: r.on,
      amountCents: r.amountCents,
      paidCents: r.paidCents,
      owedCents: r.owedCents,
      orderedCents: r.orderedCents,
      key: line ? line.key : co ? coNumber(co) : undefined,
      keyKind: line ? ("line" as const) : co ? ("co" as const) : undefined,
      purchaseOrderId: r.purchaseOrderId ?? undefined,
      poNumber: linkedPo?.poNumber || undefined,
      flags: flags.length ? flags : undefined,
    };
    if (r.source === "po") {
      const po = poById.get(r.sourceId)!;
      return { ...base, vendor: po.vendorName, status: po.status, note: [po.poNumber, po.title].filter(Boolean).join(" · ") || undefined };
    }
    if (r.source === "sub_invoice") {
      const s = subById.get(r.sourceId)!;
      return { ...base, vendor: s.vendor, status: s.status, note: s.note || undefined, sourceRef: s.sourceRef || undefined };
    }
    const e = expById.get(r.sourceId)!;
    return { ...base, vendor: e.vendorLabel, status: "paid", kind: e.kind, paidFrom: e.paidFrom, note: e.memo || undefined, sourceRef: e.sourceRef || undefined };
  });

  // ---- completeness: what exists, what is claimed complete, what that allows
  const hasCosts = allocation.rows.some((r) => r.paidCents + r.owedCents + r.orderedCents !== 0);
  const completeness: BudgetCompleteness = {
    basedOn: [],
    budget: p.budgetComplete && raw.lines.length > 0,
    costsThrough: p.costsThrough,
    billing: tracked ? "tracked" : raw.invoices.length > 0 ? "partial" : "none",
    profit: "unknown",
    missing: [],
  };
  completeness.profit = !completeness.budget ? "unknown" : hasCosts ? "projected" : "planned";

  const view: BudgetView = {
    project: { slug: p.slug, name: p.name, status: p.status },
    basis: p.basis,
    asOfLabel: dayLabel(opts.asOf, true),
    budgetLabel: p.budgetLabel || (p.basis === "insurance" ? "insurance budget" : "contract"),
    budgetCaption: p.budgetCaption || undefined,
    priceCents,
    priceSource,
    parties,
    lines,
    changeOrders,
    fundingEvents: raw.fundingEvents,
    clientInvoices,
    costs,
    unassigned,
    billing,
    completeness,
    retainageCents: p.retainageCents || undefined,
    notes: p.notes?.length ? p.notes : undefined,
  };
  const t = computeTotals(view);

  // what exists
  const b = completeness.basedOn;
  if (priceSource === "override") b.push(`Price set to ${fmtK(priceCents)}`);
  if (priceSource === "estimate") b.push(`Approved estimate ${fmtK(priceCents)}`);
  if (priceSource === "contract") b.push(`Contract ${fmtK(priceCents)}`);
  if (priceSource === "lines") b.push(`Budget line prices ${fmtK(priceCents)}`);
  if (raw.lines.length) b.push(plural(raw.lines.length, "budget line"));
  if (raw.changeOrders.length) b.push(plural(raw.changeOrders.length, "change order"));
  if (raw.invoices.length) b.push(plural(raw.invoices.length, "invoice"));
  if (!tracked) b.push(`Hand-kept collected ${fmtK(handKept)}`);
  if (tracked && openingCollected > 0) b.push(`Opening balance ${fmtK(openingCollected)}`);
  if (raw.subInvoices.length) b.push(plural(raw.subInvoices.length, "sub invoice"));
  const livePos = raw.purchaseOrders.filter((po) => po.status !== "void").length;
  if (livePos) b.push(plural(livePos, "purchase order"));
  if (raw.expenses.length) b.push(plural(raw.expenses.length, "receipt"));

  // what is missing or soft
  const m = completeness.missing;
  if (!completeness.budget) m.push(raw.lines.length ? "Budget isn't finished — not marked as covering the whole job" : "No budget yet");
  if (priceSource === "none") m.push("No price set");
  if (
    priceSource === "estimate" && contractCents > 0 &&
    Math.abs((p.approvedEstimateTotalCents ?? 0) - contractCents) > ONE_DOLLAR
  )
    m.push(`Approved estimate (${fmtK(priceCents)}) and hand-kept contract (${fmtK(contractCents)}) differ — set the price`);
  if (priceSource === "contract" && changeOrders.some((c) => isCoCounted(c.status)))
    m.push("Price comes from the hand-kept contract total — confirm it excludes change orders");
  if (completeness.budget && allLinesPriced && priceCents > 0 && Math.abs(linePriceSum - priceCents) > priceCents * 0.02)
    m.push(`Budget line prices add up to ${fmtK(linePriceSum)}, not the ${fmtK(priceCents)} price`);
  for (const [i, co] of changeOrders.entries()) {
    if (!t.changeOrders[i].notPlanned) continue;
    m.push(
      co.totalCents <= 0
        ? `${co.id} is deductive: reduce the affected trade's still-to-spend`
        : `${co.id} cost not planned; assumed at price`,
    );
  }
  for (const co of changeOrders) {
    const soFar = co.paidCents + co.owedCents + co.orderedCents;
    if (!isCoCounted(co.status) && soFar > 0) m.push(`${fmtK(soFar)} spent on ${co.id}, which isn't signed`);
  }
  const loose = unassigned.paidCents + unassigned.owedCents + unassigned.orderedCents;
  if (loose > 0) m.push(`${fmtK(loose)} of costs not assigned to a trade`);
  for (const r of costs) for (const f of r.flags ?? []) if (f.startsWith("billed ")) m.push(`${r.vendor}: ${f}`);
  const dupes = costs.filter((r) => r.flags?.includes("possible duplicate")).length;
  if (dupes) m.push(plural(dupes, "possible duplicate cost"));
  for (const ref of allocation.duplicatesIgnored) m.push(`Duplicate import ignored: ${ref}`);
  const derived = t.lines.filter((r) => r.estDerived && r.estCents > 0).length;
  if (derived) m.push(`Est. to finish derived on ${plural(derived, "line")}`);
  if (hasCosts) {
    const through = dayNumber(p.costsThrough);
    if (through == null) m.push("Costs not dated");
    else if (p.status === "construction" && asOfDay != null && asOfDay - through > STALE_COST_DAYS)
      m.push(`Costs last entered ${dayLabel(p.costsThrough)}`);
  }
  if (completeness.billing === "none") m.push("Billing history isn't tracked here yet");
  if (completeness.billing === "partial") m.push("Billing history partial");
  if (billing.mismatchFlagged) m.push(`Hand-kept collected is ${fmtK(Math.abs(mismatchCents))} off the invoices`);
  if (p.basis === "cost_plus" || p.basis === "time_materials")
    m.push("Cost-plus pricing isn't modeled; the price shown is the target");

  return view;
}
