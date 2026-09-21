import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTENTION, buildCompanyMoney } from "../lib/budget-company.ts";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { KITCHEN_RAW, KITCHEN_AS_OF, EGAN_RAW, EGAN_AS_OF } from "../lib/budget-fixtures.ts";

// The company /money page's data (docs/project-financials-plan.md §5): a row
// per job, totals that sum only what is known, and what needs attention.

const project = (over = {}) => ({
  slug: "job", name: "Job", status: "construction", basis: "fixed_price", priceCentsOverride: null,
  contractValueDollars: 0, collectedToDateDollars: 0, approvedEstimateTotalCents: null, budgetComplete: false,
  costsThrough: null, billingSource: "manual", openingCollectedCents: 0, openingBilledCents: 0, ...over,
});
const job = (p, extra = {}) => assembleBudgetView({
  lines: [], changeOrders: [], invoices: [], purchaseOrders: [], subInvoices: [], expenses: [], parties: [], fundingEvents: [], ...extra, project: project(p),
}, { asOf: "2026-09-21" });
const kitchen = (edit) => { const raw = structuredClone(KITCHEN_RAW); edit?.(raw); return assembleBudgetView(raw, { asOf: KITCHEN_AS_OF }); };

const contractOnly = job({ slug: "flanagan", name: "Flanagan", contractValueDollars: 28077, collectedToDateDollars: 25333 });
const precon = job({ slug: "spaeth", name: "Spaeth", status: "floor_plan", contractValueDollars: 8247, collectedToDateDollars: 2247 });
// A closed job WITH problems — a loose receipt and a long-unpaid invoice — so "closed jobs never nag" can actually fail.
const closedJob = job({ slug: "old-deck", name: "Old deck", status: "warranty", contractValueDollars: 12000, collectedToDateDollars: 12000 }, {
  expenses: [{ id: 1, vendorLabel: "Menards", kind: "material", amountCents: 90000, on: "2026-03-01", budgetLineId: null, changeOrderId: null, purchaseOrderId: null }],
  invoices: [{ number: "INV-009", milestone: "Final", amountCents: 250000, status: "sent", createdOn: "2026-03-01", sentOn: "2026-03-01", paidOn: null }],
});

test("open and closed jobs are separate; profit and work done read as unknown, never as zero", () => {
  const c = buildCompanyMoney([contractOnly, kitchen(), closedJob, precon]);
  assert.deepEqual(c.open.map((r) => r.slug), ["sample-kitchen", "flanagan", "spaeth"], "known profit first, then unknown by size");
  assert.deepEqual(c.closed.map((r) => r.slug), ["old-deck"]);

  const [k, f] = c.open;
  assert.deepEqual([k.profitStatus, k.profitCents, k.costCents, k.costIsSoFar], ["projected", 1570000, 4550000, false]);
  assert.deepEqual([k.paidCents, k.owedCents, k.orderedCents, k.estToFinishCents], [1950000, 750000, 600000, 1250000]);
  assert.deepEqual([f.profitStatus, f.profitCents, f.marginPct, f.workDonePct, f.costCents, f.costIsSoFar], ["unknown", null, null, null, 0, true]);
  assert.equal(f.leftToCollectCents, 274400);
  assert.match(f.headline, /^Profit isn't known yet/);
});

test("company totals cover open jobs, say their coverage, and keep closed jobs out", () => {
  const c = buildCompanyMoney([contractOnly, kitchen(), closedJob, precon]);
  assert.deepEqual([c.totals.jobCount, c.closedTotals.jobCount], [3, 1]);
  assert.equal(c.totals.contractedCents, 6120000 + 2807700 + 824700);
  assert.deepEqual([c.totals.profitCents, c.totals.profitJobs, c.totals.profitPriceCoverageCents], [1570000, 1, 6120000]);
  assert.equal(c.totals.leftToCollectCents, 3120000 + 274400 + 600000);
  assert.deepEqual([c.closedTotals.contractedCents, c.closedTotals.leftToCollectCents, c.closedTotals.profitJobs], [1200000, 0, 0]);
});

test("needs attention: most money first, each naming the job and the problem", () => {
  const c = buildCompanyMoney([contractOnly, kitchen(), closedJob, precon]);
  assert.deepEqual(c.attention.map((a) => [a.slug, a.kind, a.amountCents]), [
    ["flanagan", "profit_unknown", 2807700],
    ["sample-kitchen", "invoice_overdue", 1200000],
    ["sample-kitchen", "trade_over", 100000],
    ["sample-kitchen", "unsigned_co_spend", 30000],
  ]);
  assert.equal(c.attention[1].text, "INV-002 ($12,000) has been out 17 days");
  assert.equal(c.attention[2].text, "Cabinets is +$1,000 over budget");
  assert.equal(c.attention[0].href, "/projects/flanagan?tab=Money&section=Overview");
  assert.ok(!c.attention.some((a) => a.slug === "spaeth"), "a pre-construction job with no budget is not a problem yet");
  assert.ok(!c.attention.some((a) => a.slug === "old-deck"), "closed jobs never nag");
  assert.ok(!c.attention.some((a) => a.text.includes("Demo")), `a trade $200 over is under the $${ATTENTION.tradeOverCents / 100} bar`);
});

test("needs attention also catches unbilled work, a stale change order, stale costs, mismatches and loose costs", () => {
  const behind = kitchen((raw) => {
    raw.invoices.pop();                                   // billed $30,000 against $36,316 earned
    raw.changeOrders[1].createdOn = "2026-09-01";        // CO-2 sent 20 days ago
    raw.project.costsThrough = "2026-08-30";             // nobody has entered costs in three weeks
    raw.project.collectedToDateDollars = 27000;          // hand-kept disagrees with the invoices
    raw.expenses.push({ id: 99, vendorLabel: "Menards", kind: "material", amountCents: 45000, on: "2026-09-02", budgetLineId: null, changeOrderId: null, purchaseOrderId: null });
  });
  const kinds = Object.fromEntries(buildCompanyMoney([behind]).attention.map((a) => [a.kind, a]));
  // The $450 loose receipt counts too: 61,200 × 27,450 / 45,950 = $36,560 earned, $30,000 billed.
  assert.equal(kinds.under_billed.text, "About $6,560 of work is done and not billed");
  assert.equal(kinds.co_pending.text, "CO-2 ($5,000) has waited 20 days for a signature");
  assert.equal(kinds.costs_stale.text, "Costs last entered Aug 30");
  assert.equal(kinds.collected_mismatch.text, "Hand-kept collected is $3,000 off the invoices");
  assert.equal(kinds.unassigned_costs.text, "$450 of costs aren't assigned to a trade");
});

test("Egan rolls up as an insurance job with a projected profit below its plan", () => {
  const [row] = buildCompanyMoney([assembleBudgetView(EGAN_RAW, { asOf: EGAN_AS_OF })]).open;
  assert.deepEqual([row.slug, row.profitStatus, row.profitCents, row.priceCents], ["molly-egan", "projected", 958532, 8860331]);
  assert.equal(row.headline, "This job should make about $9,600 (11%) if the remaining work costs what you expect — $4,638 less than planned.");
});
