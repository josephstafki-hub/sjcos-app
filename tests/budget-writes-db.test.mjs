import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import * as w from "../lib/budget-writes.ts";
import { loadRawProjectMoney } from "../lib/budget-queries.ts";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { computeTotals } from "../lib/budget-types.ts";

// The Money › Overview write layer against a REAL Postgres: the SQL, the
// ownership checks, and the read-back through the same loader the page uses.
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/budget-writes-db.test.mjs
//
// Skipped without that variable, so `npm test` needs no database. Everything
// happens inside ONE transaction that is rolled back, on throwaway jobs the
// test creates itself — nothing is left behind whichever database it is aimed at.

const url = process.env.FIN_TEST_DATABASE_URL;
const $ = (dollars) => Math.round(dollars * 100);

test("every Money › Overview write round-trips through the real loader", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  const view = async (id) => assembleBudgetView((await loadRawProjectMoney(run, [id], { sequential: true })).get(id), { asOf: "2026-09-21" });
  try {
    await client.query("BEGIN");
    const mk = async (slug) => (await run(
      `INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date)
       VALUES ($1, $1, 'construction', 'ZZ Test', 60000, 9000) RETURNING id`, [slug]))[0].id;
    const job = await mk("zz-fin-test-a");
    const other = await mk("zz-fin-test-b");

    // ---- budget lines
    const a = await w.saveBudgetLine(run, job, { trade: "Cabinets", kind: "trade", budgetCents: $(20000), priceCents: $(27000), estToFinishCents: null, percentComplete: null });
    const b = await w.saveBudgetLine(run, job, { trade: "Cabinets", kind: "trade", budgetCents: $(5000), priceCents: null, estToFinishCents: 0, percentComplete: null });
    assert.ok(a.ok && b.ok);
    assert.deepEqual((await view(job)).lines.map((l) => l.id), ["cabinets", "cabinets-2"], "a second line of the same name gets its own key");

    assert.deepEqual(await w.saveBudgetLine(run, job, { trade: " ", kind: "trade", budgetCents: 0, priceCents: null, estToFinishCents: null, percentComplete: null }), { ok: false, error: "Give the trade a name." });
    assert.equal((await w.saveBudgetLine(run, job, { trade: "X", kind: "trade", budgetCents: -1, priceCents: null, estToFinishCents: null, percentComplete: null })).ok, false);
    assert.equal((await w.saveBudgetLine(run, job, { trade: "X", kind: "trade", budgetCents: 1.5, priceCents: null, estToFinishCents: null, percentComplete: null })).ok, false, "cents are integers");
    assert.equal((await w.saveBudgetLine(run, job, { trade: "X", kind: "trade", budgetCents: 0, priceCents: null, estToFinishCents: null, percentComplete: 101 })).ok, false);

    const edited = await w.saveBudgetLine(run, job, { id: a.id, trade: "Cabinets & install", kind: "trade", budgetCents: $(21000), priceCents: $(27000), estToFinishCents: $(3000), percentComplete: 10, status: "In progress", statusKind: "accent" });
    assert.ok(edited.ok);
    const line = (await view(job)).lines[0];
    assert.deepEqual([line.id, line.trade, line.budgetCents, line.estToFinishCents, line.percentComplete, line.statusKind], ["cabinets", "Cabinets & install", $(21000), $(3000), 10, "accent"], "the key is stable across a rename");

    assert.deepEqual(await w.saveBudgetLine(run, other, { id: a.id, trade: "Hijack", kind: "trade", budgetCents: 0, priceCents: null, estToFinishCents: null, percentComplete: null }), { ok: false, error: "That line isn't on this job." });
    assert.equal((await w.deleteBudgetLine(run, other, a.id)).ok, false, "one job can never reach into another");

    // ---- a PO, an expense paid against it, a loose receipt
    const [po] = await run(
      `INSERT INTO purchase_orders (project_id, po_number, vendor_kind, vendor_name, title, status, subtotal, budget_line_id)
       VALUES ($1, 'PO-001', 'one_off', 'ZZ Cabinets', 'Boxes', 'sent', $2, $3) RETURNING id`, [job, $(18000), a.id]);
    const deposit = await w.saveExpense(run, job, { date: "2026-08-12", vendorLabel: "ZZ Cabinets", kind: "material", amountCents: $(10000), paidFrom: "checking", target: null, purchaseOrderId: Number(po.id) });
    const loose = await w.saveExpense(run, job, { date: "2026-09-02", vendorLabel: "ZZ Store", kind: "material", amountCents: $(450), paidFrom: "card", target: null, purchaseOrderId: null });
    assert.ok(deposit.ok && loose.ok);
    let v = await view(job);
    assert.deepEqual([v.lines[0].paidCents, v.lines[0].orderedCents], [$(10000), $(8000)], "the deposit inherits the PO's trade and consumes the order: 18,000 counted once");
    assert.deepEqual(v.unassigned, { paidCents: $(450), owedCents: 0, orderedCents: 0 });

    assert.equal((await w.saveExpense(run, job, { date: "nope", vendorLabel: "V", kind: "material", amountCents: 100, paidFrom: "card", target: null, purchaseOrderId: null })).ok, false);
    assert.equal((await w.saveExpense(run, job, { date: "2026-09-02", vendorLabel: "V", kind: "material", amountCents: 0, paidFrom: "card", target: null, purchaseOrderId: null })).ok, false);
    assert.equal((await w.saveExpense(run, other, { date: "2026-09-02", vendorLabel: "V", kind: "material", amountCents: 100, paidFrom: "card", target: { kind: "line", id: a.id }, purchaseOrderId: null })).ok, false, "can't file a cost under another job's trade");
    assert.equal((await w.saveExpense(run, other, { date: "2026-09-02", vendorLabel: "V", kind: "material", amountCents: 100, paidFrom: "card", target: null, purchaseOrderId: Number(po.id) })).ok, false, "…or against another job's PO");

    assert.ok((await w.assignCost(run, job, { source: "expense", id: loose.id, target: { kind: "line", id: b.id } })).ok);
    assert.equal((await w.assignCost(run, other, { source: "expense", id: loose.id, target: null })).ok, false);
    v = await view(job);
    assert.equal(v.lines[1].paidCents, $(450));
    assert.deepEqual(v.unassigned, { paidCents: 0, owedCents: 0, orderedCents: 0 });
    assert.ok((await w.saveExpense(run, job, { id: loose.id, date: "2026-09-03", vendorLabel: "ZZ Store", kind: "material", amountCents: -$(50), paidFrom: "card", target: { kind: "line", id: b.id }, purchaseOrderId: null })).ok, "a return is a negative expense");
    assert.equal((await view(job)).lines[1].paidCents, -$(50));

    // ---- a bill from someone outside the subs roster, part paid then paid
    const [bill] = await run(
      `INSERT INTO sub_invoices (sub_slug, vendor_label, project_id, amount, status, budget_line_id)
       VALUES (NULL, 'ZZ Radiator Co', $1, $2, 'approved', $3) RETURNING id`, [job, $(1125), b.id]);
    assert.ok((await w.setSubInvoicePayment(run, job, { id: Number(bill.id), status: "approved", paidCents: $(562.5) })).ok);
    v = await view(job);
    assert.deepEqual([v.lines[1].paidCents, v.lines[1].owedCents], [-$(50) + $(562.5), $(562.5)]);
    assert.equal(v.costs.find((r) => r.source === "sub_invoice").vendor, "ZZ Radiator Co");
    assert.equal((await w.setSubInvoicePayment(run, job, { id: Number(bill.id), status: "approved", paidCents: $(5000) })).ok, false, "never more than the invoice");
    assert.ok((await w.setSubInvoicePayment(run, job, { id: Number(bill.id), status: "paid" })).ok);
    assert.deepEqual([(await view(job)).lines[1].owedCents], [0]);
    assert.ok((await w.linkCostToPurchaseOrder(run, job, { source: "sub_invoice", id: Number(bill.id), purchaseOrderId: Number(po.id) })).ok);
    assert.equal((await view(job)).lines[0].orderedCents, $(18000) - $(10000) - $(1125), "the bill now consumes the PO too");
    assert.ok((await w.linkCostToPurchaseOrder(run, job, { source: "sub_invoice", id: Number(bill.id), purchaseOrderId: null })).ok);

    // ---- a change order's budget side, and its credits
    const [co] = await run(`INSERT INTO change_orders (project_id, number, title, price_cents, status) VALUES ($1, 'CO-1', 'ZZ Upgrade', $2, 'approved') RETURNING id`, [job, $(9000)]);
    const costs = { id: Number(co.id), paidBy: "owner", funderShareCents: 0, budgetCostCents: $(7000), estToFinishCents: null, credits: [{ lineId: b.id, amountCents: $(5000) }] };
    assert.ok((await w.saveChangeOrderCosts(run, job, costs)).ok);
    v = await view(job);
    assert.deepEqual([v.lines[1].credited, v.lines[1].creditedTo, v.changeOrders[0].credits], [true, "CO-1", [{ lineId: "cabinets-2", amountCents: $(5000) }]]);
    assert.equal(computeTotals(v).priceCents, $(60000) + $(9000) - $(5000));
    assert.equal((await w.saveChangeOrderCosts(run, other, costs)).ok, false);
    assert.equal((await w.saveChangeOrderCosts(run, job, { ...costs, credits: [{ lineId: b.id, amountCents: 1 }, { lineId: b.id, amountCents: 2 }] })).ok, false);
    assert.ok((await w.saveChangeOrderCosts(run, job, { ...costs, credits: [] })).ok);
    assert.equal((await view(job)).lines[1].credited, false, "removing the credit un-credits the line");
    const [coAfter] = await run(`SELECT status, price_cents FROM change_orders WHERE id = $1`, [co.id]);
    assert.deepEqual([coAfter.status, coAfter.price_cents], ["approved", $(9000)], "the budget form never touches a CO's status or price");

    // ---- settings: marking the budget complete is what allows a profit
    assert.equal((await view(job)).completeness.profit, "unknown");
    assert.ok((await w.saveBudgetSettings(run, job, { basis: "fixed_price", budgetLabel: "contract", budgetCaption: "", priceCents: null, retainageCents: 0, budgetComplete: true, costsThrough: "2026-09-14", notes: ["  Check the cabinet quote  ", ""] })).ok);
    v = await view(job);
    assert.deepEqual([v.completeness.profit, v.completeness.costsThrough, v.notes], ["projected", "2026-09-14", ["Check the cabinet quote"]]);
    assert.equal((await w.saveBudgetSettings(run, job, { basis: "fixed_price", budgetLabel: "", budgetCaption: "", priceCents: null, retainageCents: 0, budgetComplete: true, costsThrough: "2026-13-45", notes: [] })).ok, false);

    // ---- billing: the reviewed switch, and back
    await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, sent_at, paid_at) VALUES ($1, 'INV-001', 'Draw 1', $2, 'paid', now(), now())`, [job, $(4000)]);
    assert.equal((await view(job)).billing.collectedCents, $(9000), "a paid invoice does not move a manual job");
    // An opening balance that makes the reconciled figure DIFFER from the hand-kept $9,000 —
    // otherwise "did it leave the hand-kept total alone?" can't be told from "did it overwrite it?".
    const r = await w.reconcileBilling(run, job, { openingCollectedCents: $(5500), openingBilledCents: $(5500), note: "Houzz deposit", alsoUpdateHandKept: false });
    assert.deepEqual(r, { ok: true, collectedCents: $(9500) });
    v = await view(job);
    assert.deepEqual([v.billing.source, v.billing.collectedCents, v.billing.billedCents], ["invoices", $(9500), $(9500)]);
    assert.equal((await run(`SELECT collected_to_date FROM projects WHERE id = $1`, [job]))[0].collected_to_date, 9000, "the hand-kept total is left alone unless asked");
    assert.deepEqual([v.billing.mismatchCents, v.billing.mismatchFlagged], [-$(500), true], "…and the page says the two now disagree");
    assert.equal((await w.reconcileBilling(run, job, { openingCollectedCents: $(5000), openingBilledCents: $(100), note: "", alsoUpdateHandKept: false })).ok, false);
    assert.ok((await w.reconcileBilling(run, job, { openingCollectedCents: $(6000), openingBilledCents: $(6000), note: "", alsoUpdateHandKept: true })).ok);
    assert.equal((await run(`SELECT collected_to_date FROM projects WHERE id = $1`, [job]))[0].collected_to_date, 10000, "the hand-kept total follows only when asked to");
    assert.ok((await w.unreconcileBilling(run, job)).ok);
    assert.equal((await view(job)).billing.source, "manual");

    // ---- bulk lines: merge keeps what you left out, replace refuses to orphan money
    const bulk = await w.setBudgetLines(run, job, [
      { key: "cabinets", trade: "Cabinets", budgetCents: $(22000) },                                   // existing: price, est, % done left out → kept
      { trade: "Tile", budgetCents: $(4000), priceCents: $(5500), status: "Not started" },
    ]);
    assert.deepEqual(bulk, { ok: true, written: 2, removed: 0 });
    v = await view(job);
    const cab = v.lines.find((l) => l.id === "cabinets");
    assert.deepEqual([cab.budgetCents, cab.priceCents, cab.estToFinishCents, cab.percentComplete], [$(22000), $(27000), $(3000), 10], "fields left out of a merge keep their values");
    assert.deepEqual(v.lines.map((l) => l.id), ["cabinets", "cabinets-2", "tile"]);
    assert.ok((await w.setBudgetLines(run, job, [{ key: "cabinets", trade: "Cabinets", budgetCents: $(22000), estToFinishCents: null }])).ok);
    assert.equal((await view(job)).lines[0].estToFinishCents, null, "…while an explicit null clears it");
    const refused = await w.setBudgetLines(run, job, [{ trade: "Tile", budgetCents: $(4000) }], "replace");
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Cabinets.*costs or credits/, "replace names the trades it would orphan, and does nothing");
    assert.equal((await view(job)).lines.length, 3);
    assert.equal((await w.setBudgetLines(run, job, [{ trade: "A", budgetCents: 1 }, { trade: "a", budgetCents: 2 }])).ok, false, "two lines, one key");

    // ---- a bill recorded twice is one bill
    const inv = { vendorLabel: "ZZ Tile Co", amountCents: $(900), date: "2026-09-10", status: "approved", paidCents: $(300), target: { kind: "line", id: b.id }, sourceRef: "zztile:77" };
    const first = await w.recordSubInvoice(run, job, inv);
    const second = await w.recordSubInvoice(run, job, { ...inv, note: "re-imported" });
    assert.deepEqual([first.ok, first.updated, second.updated, second.id], [true, false, true, first.id]);
    assert.equal((await view(job)).costs.filter((r) => r.sourceRef === "zztile:77").length, 1);
    assert.equal((await w.recordSubInvoice(run, job, { amountCents: $(10), target: null })).ok, false, "a bill has to be from someone");
    assert.equal((await w.recordSubInvoice(run, job, { subSlug: "no-such-sub", amountCents: $(10), target: null })).ok, false);
    const e1 = await w.saveExpense(run, job, { date: "2026-09-11", vendorLabel: "ZZ Store", kind: "material", amountCents: $(75), paidFrom: "card", target: null, purchaseOrderId: null, sourceRef: "receipt:zz-1" });
    const e2 = await w.saveExpense(run, job, { date: "2026-09-11", vendorLabel: "ZZ Store", kind: "material", amountCents: $(80), paidFrom: "card", target: null, purchaseOrderId: null, sourceRef: "receipt:zz-1" });
    assert.equal(e2.id, e1.id, "the same receipt logged twice is one expense, updated");
    assert.ok((await w.deleteExpense(run, job, e1.id)).ok);

    // ---- payers and expected payments
    assert.ok((await w.saveParties(run, job, [{ key: "insurer", label: "ZZ Mutual", baseShareCents: $(50000) }, { key: "owner", label: "Pat", baseShareCents: $(8000), isOwner: true }])).ok);
    assert.ok((await w.saveFundingEvents(run, job, [{ partyKey: "insurer", source: "Initial payment", amountCents: $(40000), trigger: "On the estimate", status: "received" }])).ok);
    v = await view(job);
    assert.deepEqual(v.parties.map((p) => [p.key, p.baseShareCents, !!p.isOwner]), [["insurer", $(50000), false], ["owner", $(8000), true]]);
    assert.equal(computeTotals(v).unfundedCents, $(60000) - $(58000));
    assert.match(v.fundingEvents[0].statusLabel, /^Received /);
    assert.equal((await w.saveParties(run, job, [{ key: "a", label: "A", baseShareCents: 1, isOwner: true }, { key: "b", label: "B", baseShareCents: 1, isOwner: true }])).ok, false, "one client");
    assert.ok((await w.saveParties(run, job, [])).ok);
    assert.ok((await w.patchBudgetSettings(run, job, { costsThrough: "2026-09-20" })).ok);
    v = await view(job);
    assert.deepEqual([v.completeness.costsThrough, v.completeness.budget, v.notes], ["2026-09-20", true, ["Check the cabinet quote"]], "a patch changes only what it names");

    // ---- deleting a line never loses its costs
    const before = computeTotals(await view(job)).paidCents;
    assert.ok((await w.deleteBudgetLine(run, job, a.id)).ok);
    v = await view(job);
    assert.equal(computeTotals(v).paidCents, before, "the money is still counted…");
    assert.ok(v.unassigned.paidCents > 0, "…as unassigned");
    assert.ok((await w.deleteExpense(run, job, deposit.id)).ok);
    assert.equal((await w.deleteExpense(run, job, deposit.id)).ok, false);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
