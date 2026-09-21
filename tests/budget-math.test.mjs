import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTotals, describeFinancials, rollupCompany, resolveCoEst, resolveLineEst,
  fmtAbout, fmtK, fmtPct, fmtSigned,
} from "../lib/budget-types.ts";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { KITCHEN_RAW, KITCHEN_AS_OF, EGAN_RAW, EGAN_AS_OF } from "../lib/budget-fixtures.ts";

// computeTotals() is the one place the project-financials math lives
// (docs/project-financials-plan.md §3.3). The kitchen fixture is sized so every
// expected number below can be checked by hand against §9 of the plan.

const $ = (dollars) => Math.round(dollars * 100);

const billing = (over = {}) => ({
  source: "invoices", collectedCents: 0, billedCents: 0, unpaidInvoicesCents: 0,
  openingCollectedCents: 0, openingBilledCents: 0, handKeptCollectedCents: 0,
  paidInvoicesCents: 0, invoiceCount: 0, mismatchCents: 0, mismatchFlagged: false, ...over,
});
const completeness = (over = {}) => ({
  basedOn: [], budget: true, costsThrough: null, billing: "tracked", profit: "projected", missing: [], ...over,
});
const line = (id, over = {}) => ({
  id, trade: id, kind: "trade", budgetCents: 0, priceCents: null,
  paidCents: 0, owedCents: 0, orderedCents: 0, estToFinishCents: null, ...over,
});
const co = (id, over = {}) => ({
  id, title: id, status: "approved", totalCents: 0, credits: [], billedCents: 0,
  paidCents: 0, owedCents: 0, orderedCents: 0, ...over,
});
const view = (over = {}) => ({
  basis: "fixed_price", asOfLabel: "", budgetLabel: "contract", priceCents: 0, parties: [], lines: [],
  changeOrders: [], fundingEvents: [], clientInvoices: [], costs: [],
  unassigned: { paidCents: 0, owedCents: 0, orderedCents: 0 }, ...over,
  billing: billing(over.billing), completeness: completeness(over.completeness),
});
const kitchen = (edit) => {
  const raw = structuredClone(KITCHEN_RAW);
  edit?.(raw);
  return assembleBudgetView(raw, { asOf: KITCHEN_AS_OF });
};
const egan = (edit) => {
  const raw = structuredClone(EGAN_RAW);
  edit?.(raw);
  return assembleBudgetView(raw, { asOf: EGAN_AS_OF });
};
const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-4, `${msg ?? ""} ${actual} ≉ ${expected}`);

// ─── The kitchen: plan §9 ───────────────────────────────────────────────────

test("kitchen — cost, price and profit", () => {
  const t = computeTotals(kitchen());
  assert.deepEqual(
    [t.paidCents, t.owedCents, t.orderedCents, t.estToFinishCents, t.projectedCostCents],
    [$(19500), $(7500), $(6000), $(12500), $(45500)],
  );
  assert.deepEqual([t.incurredCents, t.costSoFarCents], [$(27000), $(33000)]);
  assert.deepEqual([t.budgetCostCents, t.coBudgetCostCents, t.costHeadroomCents, t.unsignedCoCostCents], [$(43000), $(1200), -$(1300), $(300)]);
  assert.deepEqual([t.basePriceCents, t.coNetCents, t.coPendingCents, t.priceCents], [$(60000), $(1200), $(5000), $(61200)]);
  assert.deepEqual([t.projectedProfitCents, t.plannedProfitCents, t.headlineProfitCents], [$(15700), $(17000), $(15700)]);
  close(t.marginPct, 0.2565);
});

test("kitchen — work done counts spent + owed, never what is on order", () => {
  const t = computeTotals(kitchen());
  close(t.workDonePct, 27000 / 45500);
  assert.notEqual(Math.round(t.workDonePct * 100), 73, "the draft counted the $6,000 cabinet order as work: 33,000 / 45,500");
  assert.equal(t.earnedCents, 3631648);
  assert.equal(t.overUnderBilledCents, 568352, "billed AHEAD of the work; the draft's rule said $2,387 of unbilled work");
});

test("kitchen — a hand-set % on one trade overrides cost where cost misleads", () => {
  const t = computeTotals(kitchen((raw) => { raw.lines.find((l) => l.key === "cabinets").percentComplete = 10; }));
  assert.equal(t.lines.find((l) => l.id === "cabinets").doneCents, $(2100), "10% of the trade's $21,000, not the $12,000 incurred");
  close(t.workDonePct, 17100 / 45500);
});

test("kitchen — billing", () => {
  const t = computeTotals(kitchen());
  assert.deepEqual([t.billedCents, t.collectedCents, t.unpaidInvoicesCents], [$(42000), $(30000), $(12000)]);
  assert.deepEqual([t.leftToBillCents, t.leftToCollectCents], [$(19200), $(31200)]);
  close(t.billedPct, 42000 / 61200);
  close(t.collectedPct, 30000 / 61200);
});

test("kitchen — trades over and under budget, with their margins", () => {
  const t = computeTotals(kitchen());
  assert.deepEqual(t.overLines.map((x) => [x.line.id, x.varianceCents]), [["cabinets", $(1000)], ["demo", $(200)]]);
  assert.deepEqual(t.underLines.map((x) => [x.line.id, x.varianceCents]), [["electrical", -$(200)]]);
  assert.deepEqual(t.lines.map((l) => l.marginCents), [$(800), $(6000), $(3200), $(6000)]);
});

test("kitchen — change orders: a signed one with no cost plan, an unsigned one with money in it", () => {
  const [co1, co2] = computeTotals(kitchen()).changeOrders;
  assert.deepEqual([co1.counted, co1.estState, co1.notPlanned, co1.estCents, co1.costCents, co1.marginCents], [true, 3, true, $(500), $(1200), 0]);
  assert.deepEqual([co2.counted, co2.estCents, co2.costCents, co2.budgetCostCents, co2.marginCents], [false, 0, $(300), 0, null]);
});

test("kitchen — the four sentences", () => {
  const v = kitchen();
  assert.deepEqual(describeFinancials(v, computeTotals(v)), [
    "This job should make about $15,700 (26%) if the remaining work costs what you expect — $1,300 less than planned.",
    "About 59% of the work is done (by cost) and 69% of the price is billed — you've billed about $5,700 ahead of the work.",
    "$12,000 of invoices are sent and not yet paid; INV-002 is 17 days out. $31,200 is left to collect on this job.",
    "2 trades are over budget (Cabinets +$1,000, Demo +$200). $300 has been spent on CO-2, which isn't signed. 1 change order ($5,000) is waiting on a signature and is not counted.",
  ]);
});

// ─── Egan: insurance, two payers, credited lines ────────────────────────────

test("Egan — what subs charged is cost; what the client paid is billing", () => {
  const t = computeTotals(egan());
  assert.deepEqual([t.paidCents, t.owedCents, t.orderedCents, t.estToFinishCents], [832136, 1642250, 0, 5427413]);
  assert.deepEqual([t.projectedCostCents, t.budgetCostCents, t.costHeadroomCents], [7901799, 7161459, -463840]);
  assert.deepEqual([t.priceCents, t.projectedProfitCents], [8860331, 958532]);
  assert.equal(t.plannedProfitCents, 1422372, "the plan's profit is exactly GC overhead & profit");
  assert.deepEqual([t.collectedCents, t.billedCents], [3166636, 3166636]);
  assert.deepEqual(t.overLines.map((x) => x.line.id), ["moving", "electrical", "plumbing"]);
  assert.deepEqual(t.underLines.map((x) => x.line.id), ["demo"]);
});

test("Egan — who pays: the insurer's share, and the client's deductible plus their change order", () => {
  const t = computeTotals(egan());
  assert.deepEqual(t.paidBy.map((p) => [p.label, p.amountCents]), [["USAA", 7583831], ["Client", 1276500]]);
  assert.equal(t.paidBy.reduce((s, p) => s + p.amountCents, 0), t.priceCents);
  assert.equal(t.unfundedCents, 0);
});

test("Egan — a credit takes effect only once its change order is signed", () => {
  const before = computeTotals(egan());
  assert.equal(before.creditedCents, 0, "CO-1 and CO-2 are unsigned: the base insulation and bath scope may still get built");
  assert.ok(before.lines.every((l) => !l.credited));

  const after = computeTotals(egan((raw) => { raw.changeOrders.find((c) => c.number === "CO-1").status = "approved"; }));
  assert.equal(after.lines.find((l) => l.id === "insulation").credited, true);
  assert.equal(after.creditedCents, 187841);
  assert.equal(after.budgetCostCents, before.budgetCostCents - 187841);
  assert.equal(after.priceCents, before.priceCents + 1000039, "the client pays the CO less the credit");
  assert.equal(after.projectedProfitCents, before.projectedProfitCents, "spray foam at the sub's price replaces blown-in at cost: no profit appears from nowhere");
});

test("money already spent on a line still counts after the line is credited away", () => {
  const v = view({
    priceCents: $(10000),
    lines: [line("old", { budgetCents: $(2000), paidCents: $(400), credited: true, creditedTo: "CO-1" })],
    changeOrders: [co("CO-1", { totalCents: $(5000), budgetCostCents: $(4000), credits: [{ lineId: "old", amountCents: $(2000) }] })],
  });
  const t = computeTotals(v);
  assert.equal(t.paidCents, $(400));
  assert.equal(t.budgetCostCents, 0);
  assert.equal(t.projectedCostCents, $(4400));
});

// ─── Change-order cost: the three states ────────────────────────────────────

test("a change order's remaining cost: given, derived from its plan, or assumed at its price", () => {
  assert.deepEqual(resolveCoEst(co("a", { totalCents: $(1000), estToFinishCents: 0, owedCents: $(100) })), { cents: 0, state: 1, notPlanned: false });
  assert.deepEqual(resolveCoEst(co("b", { totalCents: $(1000), budgetCostCents: $(800), paidCents: $(300) })), { cents: $(500), state: 2, notPlanned: false });
  assert.deepEqual(resolveCoEst(co("c", { totalCents: $(1200), owedCents: $(700) })), { cents: $(500), state: 3, notPlanned: true });
  assert.deepEqual(resolveCoEst(co("d", { totalCents: -$(3000) })), { cents: 0, state: 3, notPlanned: true });
});

test("an unplanned change order is assumed to cost its FULL price, not its price net of credits", () => {
  const base = { priceCents: $(10000), lines: [line("swap", { budgetCents: $(1500), priceCents: $(2000) }), line("rest", { budgetCents: $(6000), priceCents: $(8000) })] };
  const before = computeTotals(view(base));
  assert.equal(before.projectedProfitCents, $(2500));

  const swapped = view({
    ...base,
    lines: [{ ...base.lines[0], credited: true, creditedTo: "CO-1" }, base.lines[1]],
    changeOrders: [co("CO-1", { totalCents: $(10000), credits: [{ lineId: "swap", amountCents: $(2000) }] })],
  });
  const after = computeTotals(swapped);
  assert.equal(after.changeOrders[0].costCents, $(10000));
  assert.equal(after.priceCents, $(18000));
  assert.equal(after.projectedProfitCents, $(2000), "you give up the swapped trade's $500 margin and gain nothing — never +$1,500 from thin air");
});

test("a change order over its planned cost shows as an overrun; the plan does not move", () => {
  const job = (paid) => view({ priceCents: $(10000), lines: [line("all", { budgetCents: $(7000) })], changeOrders: [co("CO-1", { totalCents: $(1200), budgetCostCents: $(800), paidCents: paid })] });
  const onPlan = computeTotals(job(0)), over = computeTotals(job($(1000)));
  assert.deepEqual([over.changeOrders[0].estCents, over.changeOrders[0].costCents], [0, $(1000)]);
  assert.equal(over.costHeadroomCents, -$(200));
  assert.equal(over.plannedProfitCents, onPlan.plannedProfitCents);
  assert.equal(over.projectedProfitCents, onPlan.projectedProfitCents - $(200));
});

test("a deductive change order lowers the price; a declined one still counts what was spent", () => {
  const t = computeTotals(view({
    priceCents: $(20000),
    changeOrders: [co("CO-1", { totalCents: -$(3000) }), co("CO-2", { status: "declined", totalCents: $(4000), owedCents: $(250) })],
  }));
  assert.equal(t.priceCents, $(17000));
  assert.equal(t.changeOrders[0].estCents, 0);
  assert.deepEqual([t.owedCents, t.unsignedCoCostCents, t.coPendingCents], [$(250), $(250), 0]);
});

test("a change order the insurer approves as a supplement is paid by the funder, whole or in part", () => {
  const parties = [{ key: "insurer", label: "USAA", baseShareCents: $(9000) }, { key: "owner", label: "Client", baseShareCents: $(1000), isOwner: true }];
  const t = computeTotals(view({
    priceCents: $(10000), parties,
    changeOrders: [co("CO-1", { totalCents: $(2000), paidBy: "funder" }), co("CO-2", { totalCents: $(1000), paidBy: "split", funderShareCents: $(400) })],
  }));
  assert.deepEqual([t.coFunderCents, t.coOwnerCents], [$(2400), $(600)]);
  assert.deepEqual(t.paidBy.map((p) => p.amountCents), [$(11400), $(1600)]);
});

test("a base price the parties don't cover is unfunded, and lands on the owner", () => {
  const t = computeTotals(view({ priceCents: $(10000), parties: [{ key: "lender", label: "Bank", baseShareCents: $(7000) }, { key: "owner", label: "Client", baseShareCents: $(2000), isOwner: true }] }));
  assert.equal(t.unfundedCents, $(1000));
  assert.deepEqual(t.paidBy.map((p) => p.amountCents), [$(7000), $(3000)]);
});

// ─── Lines ──────────────────────────────────────────────────────────────────

test("a line's est-to-finish: an explicit 0, null (derive), and 100% complete are three different things", () => {
  const l = (over) => line("x", { budgetCents: $(5000), paidCents: $(1000), ...over });
  assert.deepEqual(resolveLineEst(l({ estToFinishCents: 0 })), { cents: 0, derived: false });
  assert.deepEqual(resolveLineEst(l({})), { cents: $(4000), derived: true });
  assert.deepEqual(resolveLineEst(l({ percentComplete: 100 })), { cents: 0, derived: true });
  assert.deepEqual(resolveLineEst(l({ paidCents: $(9000) })), { cents: 0, derived: true }, "never negative");
  assert.deepEqual(resolveLineEst(l({ estToFinishCents: $(250), percentComplete: 100 })), { cents: $(250), derived: false }, "a given number always wins");
});

test("work that was never budgeted shows fully over; within a dollar is on budget", () => {
  const t = computeTotals(view({
    priceCents: $(10000),
    lines: [line("radiators", { budgetCents: 0, paidCents: $(562.5), owedCents: $(562.5), estToFinishCents: 0 }), line("paint", { budgetCents: $(3000), estToFinishCents: $(3000.5) })],
  }));
  assert.deepEqual(t.overLines.map((x) => [x.line.id, x.varianceCents]), [["radiators", $(1125)]]);
  assert.equal(t.underLines.length, 0);
});

// ─── What may be claimed ────────────────────────────────────────────────────

test("without a complete budget there is no profit, no margin, no work done — only cost so far", () => {
  const v = view({ priceCents: $(8000), lines: [line("demo", { budgetCents: $(1000), paidCents: $(1200) })], completeness: { budget: false, profit: "unknown" } });
  const t = computeTotals(v);
  for (const k of ["projectedProfitCents", "marginPct", "plannedProfitCents", "plannedMarginPct", "headlineProfitCents", "workDonePct", "earnedCents", "overUnderBilledCents"])
    assert.equal(t[k], null, k);
  assert.equal(t.costSoFarCents, $(1200));
  assert.equal(describeFinancials(v, t)[0], "Profit isn't known yet: the budget doesn't cover the whole job. $1,200 of cost has been logged so far.");
});

test("on a manual job billed is unknown, so nothing is derived from it — but left to collect is always known", () => {
  const v = view({
    priceCents: $(20000), lines: [line("all", { budgetCents: $(15000), paidCents: $(6000) })],
    billing: { source: "manual", collectedCents: $(9600), billedCents: null, unpaidInvoicesCents: $(1500) },
    completeness: { billing: "partial" },
  });
  const t = computeTotals(v);
  assert.deepEqual([t.billedCents, t.leftToBillCents, t.overUnderBilledCents, t.billedPct], [null, null, null, null]);
  assert.deepEqual([t.leftToCollectCents, t.unpaidInvoicesCents], [$(10400), $(1500)]);
  const s = describeFinancials(v, t);
  assert.equal(s[1], "About 40% of the work is done (by cost). 48% of the price has been collected; billing history isn't tracked here yet.");
  assert.equal(s[2], "$1,500 of invoices are sent and not yet paid. $10,400 is left to collect on this job.");
});

// ─── Acceptance case 7: the company rollup ──────────────────────────────────

const companyJob = (slug, v) => ({ slug, name: slug, completeness: v.completeness, totals: computeTotals(v) });
const plannedJob = () => view({
  priceCents: 2829600, lines: [line("all", { budgetCents: 2229600, priceCents: 2829600 })],
  billing: { source: "manual", collectedCents: 1414800, billedCents: null }, completeness: { profit: "planned", billing: "none" },
});
const unknownJob = () => view({
  priceCents: 6353900, billing: { source: "manual", collectedCents: 3166700, billedCents: null },
  completeness: { budget: false, profit: "unknown", billing: "none" },
});

test("company totals sum only what is known, over the same jobs top and bottom", () => {
  const c = rollupCompany([companyJob("a", kitchen()), companyJob("b", plannedJob()), companyJob("c", unknownJob())]);
  assert.deepEqual([c.jobCount, c.contractedCents], [3, 15303500]);
  assert.deepEqual([c.profitCents, c.profitJobs, c.projectedJobs, c.plannedJobs], [$(21700), 2, 1, 1]);
  assert.equal(c.profitPriceCoverageCents, 8949600, "covers $89k of $153k");
  close(c.blendedMarginPct, 21700 / 89496);
  assert.ok(Math.abs(c.blendedMarginPct - 21700 / 153035) > 0.05, "never profit of 2 jobs over the price of 3");
  assert.equal(c.leftToCollectCents, 3120000 + 1414800 + 3187200, "left to collect is always known, so every job counts");
  assert.deepEqual([c.unpaidInvoicesCents, c.billingTrackedJobs], [$(12000), 1]);
  assert.deepEqual([c.unbilledCents, c.unbilledJobs], [0, 1], "only the job with a complete budget AND tracked billing; it is billed ahead");
});

test("unbilled work is counted when a tracked job has done more than it has billed", () => {
  const behind = kitchen((raw) => { raw.invoices.pop(); });
  const c = rollupCompany([companyJob("a", behind), companyJob("b", plannedJob())]);
  assert.equal(c.unbilledCents, 631648, "earned $36,316.48, billed $30,000");
  assert.equal(c.unbilledJobs, 1);
});

test("a company with no known profit has no blended margin", () => {
  const c = rollupCompany([companyJob("c", unknownJob())]);
  assert.deepEqual([c.profitCents, c.profitJobs, c.blendedMarginPct], [0, 0, null]);
});

// ─── Sentences ──────────────────────────────────────────────────────────────

test("a planned profit is labeled as the plan, not a forecast", () => {
  const v = plannedJob();
  assert.equal(
    describeFinancials(v, computeTotals(v))[0],
    "The budget plans a profit of about $6,000 (21%). No costs have been entered yet, so this is the plan, not a forecast.",
  );
});

test("billing behind the work, on pace, a loss, and a fully collected job each read plainly", () => {
  const job = (over) => view({ priceCents: $(50000), lines: [line("all", { budgetCents: $(40000), paidCents: $(20000) })], ...over });
  const sentences = (v) => describeFinancials(v, computeTotals(v));

  assert.equal(sentences(job({ billing: { billedCents: $(15000), collectedCents: $(15000) } }))[1],
    "About 50% of the work is done (by cost) and 30% of the price is billed — there is about $10,000 of unbilled work to invoice.");
  assert.equal(sentences(job({ billing: { billedCents: $(26000), collectedCents: $(26000) } }))[1],
    "About 50% of the work is done (by cost) and 52% of the price is billed — billing is roughly on pace.");
  assert.equal(sentences(job({ lines: [line("all", { budgetCents: $(40000), paidCents: $(53200), estToFinishCents: 0 })] }))[0],
    "This job is on track to lose about $3,200 if the remaining work costs what you expect — $13,200 less than planned.");
  assert.equal(sentences(job({ billing: { billedCents: $(50000), collectedCents: $(50000) } }))[2], "This job is fully collected.");
  assert.equal(sentences(job({ lines: [line("all", { budgetCents: $(40000), paidCents: $(20000), estToFinishCents: $(20050) })] }))[0],
    "This job should make about $10,000 (20%) if the remaining work costs what you expect — right on plan.");
});

test("problems name unassigned costs and a collected total that disagrees with the invoices", () => {
  const v = view({
    priceCents: $(10000), lines: [line("all", { budgetCents: $(7000) })],
    unassigned: { paidCents: $(1000), owedCents: $(450), orderedCents: 0 },
    billing: { mismatchCents: -149982, mismatchFlagged: true },
  });
  assert.equal(
    describeFinancials(v, computeTotals(v)).at(-1),
    "$1,450 of costs are not assigned to a trade. The hand-kept collected total is $1,500 off the invoices — reconcile billing.",
  );
});

// ─── Robustness and formatting ──────────────────────────────────────────────

test("an empty job produces no NaN anywhere, and still says something true", () => {
  const v = view({ completeness: { budget: false, profit: "unknown", billing: "none" } });
  const t = computeTotals(v);
  const walk = (x, path) => {
    if (typeof x === "number") assert.ok(Number.isFinite(x), `${path} is ${x}`);
    else if (x && typeof x === "object") for (const [k, val] of Object.entries(x)) walk(val, `${path}.${k}`);
  };
  walk(t, "totals");
  walk(rollupCompany([]), "company");
  assert.deepEqual(describeFinancials(v, t), [
    "Profit isn't known yet: there is no budget for this job yet. No costs have been logged.",
    "No price is set for this job yet.",
  ]);
});

test("money and percent formatting", () => {
  assert.deepEqual([fmtK(2166636), fmtK(-70815), fmtK(0)], ["$21,666", "-$708", "$0"]);
  assert.deepEqual([fmtSigned(157500), fmtSigned(-70815)], ["+$1,575", "-$708"]);
  assert.deepEqual([fmtAbout(568352), fmtAbout(1570000), fmtAbout(84700), fmtAbout(4200)], ["$5,700", "$15,700", "$850", "$42"]);
  assert.deepEqual([fmtPct(0.2565), fmtPct(0.0565), fmtPct(0.07), fmtPct(-0.12), fmtPct(null)], ["26%", "5.7%", "7%", "-12%", "—"]);
});
