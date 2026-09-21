import { test } from "node:test";
import assert from "node:assert/strict";
import { findProjects, loadRawProjectMoney, todayCentral } from "../lib/budget-queries.ts";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { computeTotals } from "../lib/budget-types.ts";

// lib/budget-queries.ts is the only place DB rows become the assembler's raw
// rows. pg hands back bigint / numeric as STRINGS and the two projects money
// columns in whole DOLLARS — these pin that nothing downstream ever sees either.

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const ROUTES = [
  [/FROM projects\b/, "projects"], [/FROM estimates\b/, "estimates"], [/FROM budget_lines\b/, "budget_lines"],
  [/FROM change_order_credits\b/, "change_order_credits"], [/FROM change_orders WHERE/, "change_orders"],
  [/FROM invoices\b/, "invoices"], [/FROM purchase_orders po\b/, "purchase_orders"], [/FROM sub_invoices si\b/, "sub_invoices"],
  [/FROM expenses\b/, "expenses"], [/FROM budget_parties\b/, "budget_parties"], [/FROM funding_events\b/, "funding_events"],
];

/** A fake `run`: answers each query by the table it reads, the way pg would. */
function fakeDb(tables) {
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql, params });
    // By the OUTER table: the purchase-order query's first FROM is a subquery.
    const table = ROUTES.find(([re]) => re.test(sql))?.[1];
    assert.ok(table, `unrouted query: ${sql.slice(0, 80)}`);
    return tables[table] ?? [];
  };
  return { run, calls };
}

const projectRow = (over = {}) => ({
  id: P1, slug: "job-one", name: "Job One", status: "construction", client_name: "Pat",
  contract_value: 28296, collected_to_date: 14148, budget_basis: "fixed_price", budget_label: "", budget_caption: "",
  price_cents: null, retainage_cents: 0, budget_notes: [], budget_complete: false, costs_through: null,
  billing_source: "manual", opening_collected_cents: 0, opening_billed_cents: 0, opening_note: "", ...over,
});

test("rows become raw rows: string ids and numerics are numbers, dollars stay dollars until the assembler", async () => {
  const { run } = fakeDb({
    projects: [projectRow({ budget_complete: true, costs_through: "2026-09-14" })],
    estimates: [{ project_id: P1, total: "2829564" }],
    budget_lines: [{ id: "7", project_id: P1, key: "cabinets", trade: "Cabinets", detail: "", source: "", kind: "trade", budget_cents: 2000000, price_cents: null, est_to_finish_cents: null, percent_complete: null, status: "", status_kind: "", credited_co_id: "3", flags: ["Quote expired"] }],
    change_orders: [{ id: "3", project_id: P1, number: "CO-1", title: "Add", description: "", vendor_label: "", price_cents: 120000, status: "approved", paid_by: "owner", funder_share_cents: 0, budget_cost_cents: null, est_to_finish_cents: null, created_on: "2026-09-01" }],
    change_order_credits: [{ change_order_id: "3", budget_line_id: "7", amount_cents: 50000 }],
    purchase_orders: [{ id: "31", project_id: P1, po_number: "PO-001", vendor_name: "Northland", title: "Boxes", status: "partial", subtotal: 1800000, received_value: "1200000", on_day: "2026-08-12", budget_line_id: "7", change_order_id: null }],
    sub_invoices: [{ id: "41", project_id: P1, vendor: "Minne Movers", amount: 42500, status: "approved", paid_cents: 20000, note: "", on_day: "2026-05-11", budget_line_id: null, change_order_id: "3", purchase_order_id: null, source_ref: "minne:1004" }],
    expenses: [{ id: "51", project_id: P1, vendor_label: "Northland", kind: "material", amount_cents: 1000000, memo: "", on_day: "2026-08-12", budget_line_id: null, change_order_id: null, purchase_order_id: "31", source_ref: "" }],
  });
  const raw = (await loadRawProjectMoney(run, [P1])).get(P1);

  assert.deepEqual([raw.project.contractValueDollars, raw.project.collectedToDateDollars], [28296, 14148]);
  assert.equal(raw.project.approvedEstimateTotalCents, 2829564);
  assert.deepEqual([raw.project.budgetComplete, raw.project.costsThrough, raw.project.priceCentsOverride], [true, "2026-09-14", null]);
  assert.deepEqual([raw.lines[0].id, raw.lines[0].creditedCoId, raw.lines[0].priceCents, raw.lines[0].statusKind], [7, 3, null, "ghost"]);
  assert.deepEqual(raw.changeOrders[0].credits, [{ budgetLineId: 7, amountCents: 50000 }]);
  assert.strictEqual(raw.purchaseOrders[0].receivedValueCents, 1200000);
  assert.deepEqual([raw.subInvoices[0].paidCents, raw.subInvoices[0].changeOrderId, raw.subInvoices[0].sourceRef], [20000, 3, "minne:1004"]);
  assert.deepEqual([raw.expenses[0].purchaseOrderId, raw.expenses[0].sourceRef], [31, undefined]);

  // …and the whole thing assembles: the expense consumed the PO, the dollars became cents once.
  const view = assembleBudgetView(raw, { asOf: "2026-09-21" });
  const t = computeTotals(view);
  assert.equal(view.priceCents, 2829564);
  assert.equal(view.billing.collectedCents, 1414800);
  assert.deepEqual([t.paidCents, t.owedCents, t.orderedCents], [1000000 + 20000, 200000 + 22500, 600000]);
  assert.equal(view.changeOrders[0].ageDays, 20);
});

test("many projects load in one query per table, and rows land on their own project", async () => {
  const { run, calls } = fakeDb({
    projects: [projectRow(), projectRow({ id: P2, slug: "job-two", name: "Job Two", contract_value: 8000, collected_to_date: 4000 })],
    expenses: [
      { id: "1", project_id: P1, vendor_label: "A", kind: "material", amount_cents: 100, memo: "", on_day: null, budget_line_id: null, change_order_id: null, purchase_order_id: null, source_ref: "" },
      { id: "2", project_id: P2, vendor_label: "B", kind: "material", amount_cents: 200, memo: "", on_day: null, budget_line_id: null, change_order_id: null, purchase_order_id: null, source_ref: "" },
    ],
  });
  const raw = await loadRawProjectMoney(run, [P1, P2]);
  assert.equal(calls.length, 11, "one query per table, however many projects");
  assert.ok(calls.every((c) => /ANY\(\$1::uuid\[\]\)/.test(c.sql) && c.params[0].length === 2));
  assert.deepEqual([raw.get(P1).expenses.map((e) => e.amountCents), raw.get(P2).expenses.map((e) => e.amountCents)], [[100], [200]]);
});

test("a closed PO is still loaded — its cost must survive — and no projects means no queries", async () => {
  const { run, calls } = fakeDb({ projects: [projectRow()] });
  await loadRawProjectMoney(run, [P1]);
  const poSql = calls.find((c) => /FROM purchase_orders/.test(c.sql)).sql;
  assert.ok(!/status\s+IN/i.test(poSql), "the packet filtered to sent/partial/fulfilled, which erased a closed PO's cost");

  const empty = fakeDb({});
  assert.equal((await loadRawProjectMoney(empty.run, [])).size, 0);
  assert.equal(empty.calls.length, 0);
});

test("a job with nothing but a contract and a hand-kept total still assembles to something honest", async () => {
  const { run } = fakeDb({ projects: [projectRow()] });
  const view = assembleBudgetView((await loadRawProjectMoney(run, [P1])).get(P1), { asOf: "2026-09-21" });
  const t = computeTotals(view);
  assert.deepEqual([t.priceCents, t.collectedCents, t.leftToCollectCents], [2829600, 1414800, 1414800]);
  assert.deepEqual([view.completeness.profit, t.headlineProfitCents, t.billedCents], ["unknown", null, null]);
});

test("findProjects by slug, or all; the as-of day is the shop's day, not UTC's", async () => {
  const { run, calls } = fakeDb({ projects: [{ id: P1, slug: "job-one", name: "Job One", status: "construction" }] });
  await findProjects(run, { slug: "job-one" });
  await findProjects(run, "all");
  assert.deepEqual(calls[0].params, ["job-one"]);
  assert.equal(calls[1].params, undefined);
  assert.equal(todayCentral(new Date("2026-09-22T03:30:00Z")), "2026-09-21", "10:30pm Central is still the 21st");
});

test("on a single connection the queries run one at a time; on a pool they overlap", async () => {
  const overlap = async (opts) => {
    let inFlight = 0, worst = 0;
    const run = async (sql) => {
      worst = Math.max(worst, ++inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return /FROM projects\b/.test(sql) ? [projectRow()] : [];
    };
    await loadRawProjectMoney(run, [P1], opts);
    return worst;
  };
  assert.equal(await overlap({ sequential: true }), 1, "a transaction client cannot have two queries in flight");
  assert.ok((await overlap({})) > 1);
});
