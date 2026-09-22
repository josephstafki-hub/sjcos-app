import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateCosts, assembleBudgetView, receivedValue } from "../lib/budget-assemble.ts";
import { computeTotals, describeFinancials, proposeBillingReconciliation } from "../lib/budget-types.ts";
import { KITCHEN_RAW, KITCHEN_AS_OF } from "../lib/budget-fixtures.ts";

// The pure half of the project-financials builder (docs/project-financials-plan.md
// §3.3, §7). These pin the rules a reviewer had to correct in the first draft:
// every cost is counted once, a PO is never "spent", closing a PO never erases
// cost, and billing history is never inferred from whether invoice rows exist.

const $ = (dollars) => Math.round(dollars * 100);
const AS_OF = "2026-09-21";

const project = (over = {}) => ({
  slug: "job", name: "Job", status: "construction", basis: "fixed_price",
  priceCentsOverride: null, contractValueDollars: 0, collectedToDateDollars: 0,
  approvedEstimateTotalCents: null, budgetComplete: false, costsThrough: null,
  billingSource: "manual", openingCollectedCents: 0, openingBilledCents: 0, ...over,
});
const raw = (over = {}) => ({
  lines: [], changeOrders: [], invoices: [], purchaseOrders: [], subInvoices: [], expenses: [],
  parties: [], fundingEvents: [], ...over, project: project(over.project),
});
const po = (over = {}) => ({
  id: 7, poNumber: "PO-7", vendorName: "Vendor", title: "Order", status: "sent", subtotalCents: $(10000),
  receivedValueCents: 0, on: "2026-09-01", budgetLineId: null, changeOrderId: null, ...over,
});
const bill = (over = {}) => ({
  id: 1, vendor: "Sub", amountCents: 0, status: "approved", on: "2026-09-05",
  budgetLineId: null, changeOrderId: null, purchaseOrderId: null, ...over,
});
const expense = (over = {}) => ({
  id: 1, vendorLabel: "Store", kind: "material", amountCents: 0, on: "2026-09-05",
  budgetLineId: null, changeOrderId: null, purchaseOrderId: null, ...over,
});
const line = (over = {}) => ({
  id: 1, key: "trade", trade: "Trade", kind: "trade", budgetCents: 0, priceCents: null,
  estToFinishCents: null, percentComplete: null, creditedCoId: null, ...over,
});
const invoice = (over = {}) => ({
  number: "INV-001", milestone: "Draw", amountCents: 0, status: "paid",
  createdOn: "2026-08-01", sentOn: "2026-08-01", paidOn: "2026-08-10", ...over,
});
const alloc = (o) => allocateCosts({ purchaseOrders: [], subInvoices: [], expenses: [], ...o });
const states = (rows) => ({
  paid: rows.reduce((s, r) => s + r.paidCents, 0),
  owed: rows.reduce((s, r) => s + r.owedCents, 0),
  ordered: rows.reduce((s, r) => s + r.orderedCents, 0),
});
const cost = (rows) => { const s = states(rows); return s.paid + s.owed + s.ordered; };

// ─── Acceptance case 1 ──────────────────────────────────────────────────────

test("a PO, its invoice and its payment count once — $10,000 at every step", () => {
  const sent = alloc({ purchaseOrders: [po()] }).rows;
  assert.deepEqual(states(sent), { paid: 0, owed: 0, ordered: $(10000) });

  const received = alloc({ purchaseOrders: [po({ status: "fulfilled", receivedValueCents: $(10000) })] }).rows;
  assert.deepEqual(states(received), { paid: 0, owed: $(10000), ordered: 0 }, "fulfilled means received, never spent");

  const invoiced = alloc({
    purchaseOrders: [po({ status: "fulfilled", receivedValueCents: $(10000) })],
    subInvoices: [bill({ amountCents: $(10000), purchaseOrderId: 7 })],
  }).rows;
  assert.deepEqual(states(invoiced), { paid: 0, owed: $(10000), ordered: 0 });
  assert.equal(cost(invoiced.filter((r) => r.source === "po")), 0, "the invoice consumed the PO");

  const paid = alloc({
    purchaseOrders: [po({ status: "fulfilled", receivedValueCents: $(10000) })],
    subInvoices: [bill({ amountCents: $(10000), purchaseOrderId: 7, status: "paid" })],
  }).rows;
  assert.deepEqual(states(paid), { paid: $(10000), owed: 0, ordered: 0 });

  for (const rows of [sent, received, invoiced, paid]) assert.equal(cost(rows), $(10000));
});

// ─── Acceptance case 2 ──────────────────────────────────────────────────────

test("partial receiving, partial billing, and closing a PO", () => {
  const partial = { status: "partial", receivedValueCents: $(4000) };
  const linked = [bill({ amountCents: $(6000), purchaseOrderId: 7 })];

  const open = alloc({ purchaseOrders: [po(partial)], subInvoices: linked }).rows;
  assert.deepEqual(states(open), { paid: 0, owed: $(6000), ordered: $(4000) });
  assert.equal(cost(open), $(10000));

  const closed = alloc({ purchaseOrders: [po({ ...partial, status: "closed" })], subInvoices: linked }).rows;
  assert.deepEqual(states(closed), { paid: 0, owed: $(6000), ordered: 0 }, "closing releases only the unbilled, unreceived balance");

  const closedUnbilled = alloc({ purchaseOrders: [po({ ...partial, status: "closed" })] }).rows;
  assert.deepEqual(states(closedUnbilled), { paid: 0, owed: $(4000), ordered: 0 }, "closing never erases received cost");

  assert.equal(alloc({ purchaseOrders: [po({ status: "void", receivedValueCents: $(4000) })] }).rows.length, 0);
  for (const status of ["draft", "queued"])
    assert.equal(cost(alloc({ purchaseOrders: [po({ status })] }).rows), 0, `${status} is not a promise yet`);
});

test("bills above the PO total count in full and are flagged", () => {
  const { rows } = alloc({
    purchaseOrders: [po({ status: "fulfilled", receivedValueCents: $(10000) })],
    subInvoices: [bill({ id: 1, amountCents: $(6000), purchaseOrderId: 7 }), bill({ id: 2, amountCents: $(5000), purchaseOrderId: 7 })],
  });
  assert.equal(cost(rows), $(11000));
  assert.deepEqual(rows.find((r) => r.source === "po").flags, ["billed $1,000 over PO-7"]);
});

test("an expense paid against a PO consumes it: spent, owed and on order from one order", () => {
  const { rows } = alloc({
    purchaseOrders: [po({ status: "partial", subtotalCents: $(18000), receivedValueCents: $(12000) })],
    expenses: [expense({ amountCents: $(10000), purchaseOrderId: 7 })],
  });
  assert.deepEqual(states(rows), { paid: $(10000), owed: $(2000), ordered: $(6000) });
  assert.equal(cost(rows), $(18000));
});

// ─── Payment states ─────────────────────────────────────────────────────────

test("a sub invoice can be partly paid; an expense is always paid; a refund is negative", () => {
  const half = alloc({ subInvoices: [bill({ amountCents: $(1125), paidCents: $(562.5) })] }).rows;
  assert.deepEqual(states(half), { paid: $(562.5), owed: $(562.5), ordered: 0 });

  const settled = alloc({ subInvoices: [bill({ amountCents: $(1125), paidCents: $(100), status: "paid" })] }).rows;
  assert.deepEqual(states(settled), { paid: $(1125), owed: 0, ordered: 0 }, "status paid wins");

  const overpaid = alloc({ subInvoices: [bill({ amountCents: $(1125), paidCents: $(5000) })] }).rows;
  assert.deepEqual(states(overpaid), { paid: $(1125), owed: 0, ordered: 0 }, "never more than the invoice");

  const refund = alloc({ expenses: [expense({ id: 1, amountCents: $(900) }), expense({ id: 2, amountCents: -$(120), on: "2026-08-01" })] }).rows;
  assert.deepEqual(states(refund), { paid: $(780), owed: 0, ordered: 0 });
});

test("a linked bill inherits its PO's trade unless it names its own", () => {
  const { rows } = alloc({
    purchaseOrders: [po({ budgetLineId: 2 })],
    subInvoices: [bill({ id: 1, amountCents: $(100), purchaseOrderId: 7 }), bill({ id: 2, amountCents: $(200), purchaseOrderId: 7, changeOrderId: 11 })],
  });
  const [, inherits, own] = rows;
  assert.deepEqual([inherits.budgetLineId, inherits.changeOrderId], [2, null]);
  assert.deepEqual([own.budgetLineId, own.changeOrderId], [null, 11]);
});

// ─── Duplicates ─────────────────────────────────────────────────────────────

test("look-alike costs are flagged and both still count — never merged", () => {
  const dupes = alloc({
    subInvoices: [bill({ amountCents: $(3150), on: "2026-09-01", sourceRef: "cpk:1745" })],
    expenses: [expense({ amountCents: $(3150), on: "2026-09-10" })],
  }).rows;
  assert.equal(cost(dupes), $(6300));
  assert.ok(dupes.every((r) => r.flags.includes("possible duplicate")));

  const farApart = alloc({
    subInvoices: [bill({ amountCents: $(3150), on: "2026-08-01" })],
    expenses: [expense({ amountCents: $(3150), on: "2026-09-10" })],
  }).rows;
  assert.ok(farApart.every((r) => r.flags.length === 0), "more than 14 days apart");

  const twoDocuments = alloc({
    subInvoices: [
      bill({ id: 1, amountCents: $(3150), on: "2026-09-01", sourceRef: "cpk:1745" }),
      bill({ id: 2, amountCents: $(3150), on: "2026-09-08", sourceRef: "cpk:1750" }),
    ],
  }).rows;
  assert.ok(twoDocuments.every((r) => r.flags.length === 0), "two invoices with their own import keys are two documents");

  const progressBills = alloc({
    purchaseOrders: [po()],
    subInvoices: [bill({ id: 1, amountCents: $(3000), purchaseOrderId: 7 }), bill({ id: 2, amountCents: $(3000), purchaseOrderId: 7 })],
  }).rows;
  assert.ok(progressBills.every((r) => r.flags.length === 0), "bills linked to a PO are not look-alikes");

  const unlinkedPoBill = alloc({ purchaseOrders: [po()], subInvoices: [bill({ amountCents: $(10000), on: "2026-11-30" })] }).rows;
  assert.equal(cost(unlinkedPoBill), $(20000), "counted twice until someone links them…");
  assert.ok(unlinkedPoBill.every((r) => r.flags.includes("possible duplicate")), "…so both are flagged, whatever the dates");
});

test("a retried import cannot duplicate a cost: one row per source_ref", () => {
  const once = bill({ id: 1, amountCents: $(425), sourceRef: "minne:1004" });
  const { rows, duplicatesIgnored } = alloc({ subInvoices: [once, { ...once, id: 2 }], expenses: [expense({ amountCents: $(50), sourceRef: "minne:1004" })] });
  assert.equal(rows.filter((r) => r.source === "sub_invoice").length, 1);
  assert.deepEqual(duplicatesIgnored, ["minne:1004"]);
  assert.equal(cost(rows), $(475), "the same key on a different record type is a different record");
});

test("receivedValue rounds each line the way the PO screen does", () => {
  assert.equal(receivedValue([{ qtyReceived: 2.5, unitCostCents: 1999 }, { qtyReceived: 0, unitCostCents: 50000 }]), 4998);
});

// ─── The assembler ──────────────────────────────────────────────────────────

test("the kitchen's one cabinet PO lands as spent, owed and on order on its trade", () => {
  const view = assembleBudgetView(KITCHEN_RAW, { asOf: KITCHEN_AS_OF });
  const cabinets = view.lines.find((l) => l.id === "cabinets");
  assert.deepEqual([cabinets.paidCents, cabinets.owedCents, cabinets.orderedCents], [$(10000), $(2000), $(6000)]);
  const co1 = view.changeOrders.find((c) => c.id === "CO-1");
  assert.deepEqual([co1.paidCents, co1.owedCents, co1.orderedCents], [0, $(700), 0]);
  assert.deepEqual(view.unassigned, { paidCents: 0, owedCents: 0, orderedCents: 0 });
});

test("the ledger always sums to the totals", () => {
  const view = assembleBudgetView(KITCHEN_RAW, { asOf: KITCHEN_AS_OF });
  const t = computeTotals(view);
  assert.deepEqual(states(view.costs), { paid: t.paidCents, owed: t.owedCents, ordered: t.orderedCents });
});

test("a cost on an unsigned change order is flagged in the ledger and in what's missing", () => {
  const view = assembleBudgetView(KITCHEN_RAW, { asOf: KITCHEN_AS_OF });
  assert.deepEqual(view.costs.find((r) => r.vendor === "Menards").flags, ["on an unsigned change order"]);
  assert.deepEqual(view.completeness.missing, ["CO-1 cost not planned; assumed at price", "$300 spent on CO-2, which isn't signed"]);
});

test("a cost that names a trade that no longer exists is unassigned, and still counted", () => {
  const view = assembleBudgetView(raw({ expenses: [expense({ amountCents: $(1450), budgetLineId: 999 })] }), { asOf: AS_OF });
  assert.deepEqual(view.unassigned, { paidCents: $(1450), owedCents: 0, orderedCents: 0 });
  assert.equal(computeTotals(view).paidCents, $(1450));
  assert.ok(view.completeness.missing.includes("$1,450 of costs not assigned to a trade"));
});

// ─── Acceptance case 3: the first invoice into a job with history ───────────

test("Alcantara's shape: a draft invoice never moves a hand-kept collected total", () => {
  const view = assembleBudgetView(
    raw({ project: { contractValueDollars: 7452, collectedToDateDollars: 3726 }, invoices: [invoice({ amountCents: 371054, status: "draft", sentOn: null, paidOn: null })] }),
    { asOf: AS_OF },
  );
  assert.equal(view.billing.collectedCents, $(3726), "the draft's rule showed $0 here");
  assert.equal(view.billing.billedCents, null, "billing is unknown on a manual job, never assumed");
  assert.equal(view.billing.mismatchFlagged, false, "history not entered yet is not a problem to flag");
  assert.equal(view.completeness.billing, "partial");
  const t = computeTotals(view);
  assert.equal(t.leftToBillCents, null);
  assert.equal(t.overUnderBilledCents, null);
  assert.equal(t.leftToCollectCents, $(3726));
  assert.match(describeFinancials(view, t)[1], /50% of the price has been collected; billing history isn't tracked here yet\./);

  const p = proposeBillingReconciliation(view.billing);
  assert.deepEqual([p.proposedOpeningCollectedCents, p.handKeptLooksStale], [$(3726), false]);
});

test("Louiselle's shape: invoices showing MORE than the hand-kept total are flagged, not adopted", () => {
  const job = { contractValueDollars: 28296, collectedToDateDollars: 14148 };
  const invoices = [invoice({ number: "INV-001", amountCents: 1414800 }), invoice({ number: "INV-002", amountCents: 149982 })];
  const manual = assembleBudgetView(raw({ project: job, invoices }), { asOf: AS_OF });
  assert.equal(manual.billing.collectedCents, $(14148));
  assert.equal(manual.billing.mismatchCents, -149982);
  assert.equal(manual.billing.mismatchFlagged, true);
  assert.ok(manual.completeness.missing.includes("Hand-kept collected is $1,500 off the invoices"));

  const p = proposeBillingReconciliation(manual.billing);
  assert.deepEqual([p.proposedOpeningCollectedCents, p.handKeptLooksStale], [0, true]);

  const reconciled = assembleBudgetView(raw({ project: { ...job, billingSource: "invoices" }, invoices }), { asOf: AS_OF });
  assert.equal(reconciled.billing.collectedCents, 1564782);
  assert.equal(reconciled.billing.billedCents, 1564782);
  assert.equal(reconciled.completeness.billing, "tracked");
});

test("Egan's shape: a deposit carried on the estimate is an opening balance, counted once", () => {
  const invoices = [4350, 15720, 562.5].map((d, i) => invoice({ number: `IN-${i}`, amountCents: $(d) }));
  const job = { contractValueDollars: 63539, collectedToDateDollars: 30633, billingSource: "invoices", openingCollectedCents: $(10000), openingBilledCents: $(10000) };
  const view = assembleBudgetView(raw({ project: job, invoices }), { asOf: AS_OF });
  assert.equal(view.billing.collectedCents, $(30632.5), "never $40,632.50 and never $20,632.50");
  assert.equal(view.billing.mismatchFlagged, false, "a hand-kept total in whole dollars is within $1");
});

test("reconciling with the proposed opening balance never changes what was collected", () => {
  const job = { contractValueDollars: 7452, collectedToDateDollars: 3726 };
  const invoices = [invoice({ amountCents: $(1000) })];
  const before = assembleBudgetView(raw({ project: job, invoices }), { asOf: AS_OF });
  const p = proposeBillingReconciliation(before.billing);
  const after = assembleBudgetView(
    raw({ project: { ...job, billingSource: "invoices", openingCollectedCents: p.proposedOpeningCollectedCents, openingBilledCents: p.proposedOpeningBilledCents }, invoices }),
    { asOf: AS_OF },
  );
  assert.equal(after.billing.collectedCents, before.billing.collectedCents);
});

// ─── Acceptance case 5: a receipt on a job without a complete budget ────────

test("one receipt on an unbudgeted job raises cost so far — and claims nothing else", () => {
  const view = assembleBudgetView(
    raw({ project: { contractValueDollars: 8000, collectedToDateDollars: 4000 }, expenses: [expense({ amountCents: $(200) })] }),
    { asOf: AS_OF },
  );
  assert.equal(view.completeness.profit, "unknown");
  const t = computeTotals(view);
  assert.equal(t.costSoFarCents, $(200));
  for (const k of ["projectedProfitCents", "marginPct", "plannedProfitCents", "headlineProfitCents", "workDonePct", "earnedCents"])
    assert.equal(t[k], null, k);
  const [profit] = describeFinancials(view, t);
  assert.equal(profit, "Profit isn't known yet: there is no budget for this job yet. $200 of cost has been logged so far.");
  assert.ok(!profit.includes("%"), "the draft would have shown a 97% margin here");
});

// ─── Completeness, price, labels ────────────────────────────────────────────

test("profit is planned with a complete budget and no costs, and unknown without lines", () => {
  const budgeted = { lines: [line({ budgetCents: $(6000), priceCents: $(8000) })], project: { contractValueDollars: 8000, budgetComplete: true } };
  const planned = assembleBudgetView(raw(budgeted), { asOf: AS_OF });
  assert.equal(planned.completeness.profit, "planned");
  assert.equal(computeTotals(planned).headlineProfitCents, $(2000));

  const ticked = assembleBudgetView(raw({ project: { contractValueDollars: 8000, budgetComplete: true } }), { asOf: AS_OF });
  assert.equal(ticked.completeness.budget, false, "a ticked box with no lines covers nothing");
  assert.deepEqual(ticked.completeness.missing.slice(0, 1), ["No budget yet"]);

  const partial = assembleBudgetView(raw({ ...budgeted, project: { contractValueDollars: 8000, budgetComplete: false } }), { asOf: AS_OF });
  assert.deepEqual(partial.completeness.missing.slice(0, 1), ["Budget isn't finished — not marked as covering the whole job"]);
});

test("costs that were never dated, or have gone stale on a live job, say so", () => {
  const withCosts = (p) => assembleBudgetView(raw({ project: p, expenses: [expense({ amountCents: $(50) })] }), { asOf: AS_OF });
  assert.ok(withCosts({}).completeness.missing.includes("Costs not dated"));
  assert.ok(withCosts({ costsThrough: "2026-09-01" }).completeness.missing.includes("Costs last entered Sep 1"));
  assert.ok(!withCosts({ costsThrough: "2026-09-10" }).completeness.missing.some((m) => m.startsWith("Costs")));
  assert.ok(!withCosts({ costsThrough: "2026-09-01", status: "warranty" }).completeness.missing.some((m) => m.startsWith("Costs")));
});

test("the base price: override, then approved estimate, then the hand-kept contract — in cents", () => {
  const price = (p, extra = {}) => assembleBudgetView(raw({ project: p, ...extra }), { asOf: AS_OF });
  assert.equal(price({ contractValueDollars: 63539 }).priceCents, 6353900, "whole dollars become cents at the boundary, once");
  assert.equal(price({ contractValueDollars: 28296, approvedEstimateTotalCents: 2829564 }).priceCents, 2829564);
  assert.equal(price({ contractValueDollars: 28296, approvedEstimateTotalCents: 2829564, priceCentsOverride: $(30000) }).priceCents, $(30000));

  const rounding = price({ contractValueDollars: 28296, approvedEstimateTotalCents: 2829564 });
  assert.ok(!rounding.completeness.missing.some((m) => m.includes("differ")), "36¢ of rounding is not a disagreement");
  const differs = price({ contractValueDollars: 31000, approvedEstimateTotalCents: 2829564 });
  assert.ok(differs.completeness.missing.some((m) => m.startsWith("Approved estimate ($28,296) and hand-kept contract ($31,000) differ")));

  const co = { id: 11, number: "CO-1", title: "Add", priceCents: $(1200), status: "approved", budgetCostCents: $(900), estToFinishCents: null, credits: [] };
  const fromContract = price({ contractValueDollars: 60000 }, { changeOrders: [co] });
  assert.ok(fromContract.completeness.missing.includes("Price comes from the hand-kept contract total — confirm it excludes change orders"));
});

test("budget lines that don't add up to the price are warned about, not blocked", () => {
  const view = assembleBudgetView(
    raw({ project: { contractValueDollars: 60000, budgetComplete: true }, lines: [line({ budgetCents: $(40000), priceCents: $(56000) })] }),
    { asOf: AS_OF },
  );
  assert.equal(view.completeness.budget, true);
  assert.ok(view.completeness.missing.includes("Budget line prices add up to $56,000, not the $60,000 price"));
});

test("a change order is 'billed' once it is approved and fully on client invoices", () => {
  const co = { id: 11, number: "", title: "Add", priceCents: $(1200), status: "approved", budgetCostCents: null, estToFinishCents: null, credits: [] };
  const inv = invoice({ amountCents: $(1200), lineItems: [{ label: "CO", amount: $(1200), co_id: 11 }] });
  const view = assembleBudgetView(raw({ changeOrders: [co], invoices: [inv] }), { asOf: AS_OF });
  assert.deepEqual([view.changeOrders[0].id, view.changeOrders[0].status, view.changeOrders[0].billedCents], ["CO-11", "billed", $(1200)]);
  assert.deepEqual(view.clientInvoices[0].allocations, [{ key: "CO-11", amountCents: $(1200) }]);
});

test("invoice labels and days outstanding come from the as-of day, not the clock", () => {
  const view = assembleBudgetView(KITCHEN_RAW, { asOf: KITCHEN_AS_OF });
  assert.equal(view.asOfLabel, "Sep 21, 2026");
  assert.deepEqual(view.clientInvoices.map((i) => [i.statusLabel, i.daysOutstanding]), [["Paid Aug 10", null], ["Sent Sep 4 · 17 days", 17]]);
});

test("a job with one payer gets an owner party at the base price", () => {
  const view = assembleBudgetView(KITCHEN_RAW, { asOf: KITCHEN_AS_OF });
  assert.deepEqual(view.parties, [{ key: "owner", label: "Sample Client", baseShareCents: $(60000), isOwner: true }]);
});

test("cost-plus pricing is not modeled, and the view says so", () => {
  const view = assembleBudgetView(raw({ project: { basis: "cost_plus", contractValueDollars: 50000 } }), { asOf: AS_OF });
  assert.ok(view.completeness.missing.includes("Cost-plus pricing isn't modeled; the price shown is the target"));
});

test("what was billed before invoices were tracked, and is still unpaid, counts as unpaid", () => {
  const job = { contractValueDollars: 20000, collectedToDateDollars: 5000, billingSource: "invoices", openingCollectedCents: $(5000), openingBilledCents: $(10000) };
  const view = assembleBudgetView(raw({ project: job, invoices: [invoice({ number: "INV-001", amountCents: $(2000), status: "sent", paidOn: null })] }), { asOf: AS_OF });
  assert.deepEqual([view.billing.billedCents, view.billing.collectedCents], [$(12000), $(5000)]);
  assert.equal(view.billing.openingUnpaidCents, $(5000));
  assert.equal(view.billing.unpaidInvoicesCents, $(7000), "the $5,000 opening receivable plus the $2,000 sent invoice — never just the in-app invoice");
  const t = computeTotals(view);
  assert.equal(t.unpaidInvoicesCents, t.billedCents - t.collectedCents, "on a reconciled job unpaid is exactly billed minus collected");

  const manual = assembleBudgetView(raw({ project: { ...job, billingSource: "manual" } }), { asOf: AS_OF });
  assert.equal(manual.billing.openingUnpaidCents, 0, "an opening balance means nothing until the job is reconciled");
});
