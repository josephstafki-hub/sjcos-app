import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedVendor, seedPO } from "./_fixtures-procurement.mjs";
import { projectFunding, projectFundingForecast, reserveFunds, consumeReservationOnPayment, releaseUnusedReservation, escalateShortfall, applyCompanyFunding } from "../lib/funding/index.ts";
import { planBuyout } from "../lib/procurement/buyout.ts";
import { prepareCommitment, stagePurchaseDecision, commitOnApproval } from "../lib/procurement/commitments.ts";
import { recordDelivery, reviewDelivery } from "../lib/procurement/deliveries.ts";
import { receiveBill, stagePaymentDecision, executePayment, recordManualPaymentConfirmation } from "../lib/procurement/bills.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";

// VALIDATION V40 — buyout and cash — against a real disposable Postgres.
const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const gateOk = async () => ({ ok: true, signed: true, initialPaymentReceived: true, unknown: false, reason: "test" });

test("V40 funding: collected is settled payments only; pending ACH and sent invoices are forecast, not funds", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-cash", { collectedCents: 500_000 });
    // pending ACH + a sent invoice
    const inv = await client.query(`INSERT INTO invoices (project_id, number, milestone, amount, status, sent_at) VALUES ($1, 'INV-002', 'Rough-in', 1000000, 'sent', now()) RETURNING id`, [projectId]);
    await client.query(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'payment', 1000000, 'ach', 'pending')`, [inv.rows[0].id]);
    const f = await projectFunding(run, projectId);
    assert.equal(f.status, "known");
    assert.equal(f.collectedSource, "invoice_payments");
    assert.equal(f.collectedCents, 500_000);
    assert.equal(f.availableCents, 500_000, "pending ACH is not cash");
    assert.equal(f.pendingCents, 2_000_000, "pending payment + sent invoice are forecast only");
    const fc = await projectFundingForecast(run, projectId);
    assert.equal(fc.forecastCents, 500_000 + 1_000_000);
    // unknown project → unknown status, reservation refused
    const unknown = await projectFunding(run, "00000000-0000-0000-0000-000000000000");
    assert.equal(unknown.status, "unknown");
    await client.query("BEGIN");
    const r = await reserveFunds(run, { projectId: "00000000-0000-0000-0000-000000000000", commitmentId: null, amountCents: 1 });
    await client.query("ROLLBACK");
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown/);
  });
});

test("V40 long-lead deposit before the milestone → forecast gap surfaced early as a funding decision", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-buyout", { collectedCents: 500_000 });
    const vendorId = await seedVendor(client);
    const d = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await client.query(`INSERT INTO funding_events (project_id, party_key, source, amount_cents, trigger_text, status, status_at) VALUES ($1, 'owner', 'draw', 2000000, 'Framing complete', 'expected', $2::date)`, [projectId, d(30)]);
    await seedPO(client, projectId, vendorId, [{ description: "Windows (long lead)", qty: 1, unitCents: 1_200_000 }], { title: "Windows", needBy: d(20), terms: "50% deposit" });
    const plan = await planBuyout(run, projectId, {
      needs: async () => [{ key: "win", label: "Windows", needOnSite: d(20), amountCents: 1_200_000, leadTimeDays: 14, depositShare: 0.5, vendorName: "ZZ Siweck Lumber" }],
      principal: agent,
      escalate: true,
    });
    assert.equal(plan.lines[0].orderDeadline, d(3), "need − lead − buffer(3)");
    assert.equal(plan.lines[0].depositCents, 600_000);
    assert.ok(plan.shortfall, "deposit lands before the milestone collection");
    assert.equal(plan.shortfall.amountCents, 100_000);
    assert.equal(plan.shortfall.date, d(3));
    assert.ok(plan.shortfall.decisionId);
    const dec = await client.query(`SELECT kind, amount_cents, status, summary FROM decisions WHERE id = $1`, [plan.shortfall.decisionId]);
    assert.equal(dec.rows[0].kind, "funding");
    assert.equal(Number(dec.rows[0].amount_cents), 100_000);
    assert.match(dec.rows[0].summary.effect, /buyout/i);
    // planning never loosened the commit-time guard
    assert.equal((await projectFunding(run, projectId)).availableCents, 500_000);
  });
});

test("V40 two concurrent reservations cannot overspend (two pg clients, row lock)", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const projectId = await seedProject(client, "zz-race", { collectedCents: 500_000 });
    const c1 = new pg.Client({ connectionString: url });
    const c2 = new pg.Client({ connectionString: url });
    await c1.connect();
    await c2.connect();
    const run1 = runOver(c1);
    const run2 = runOver(c2);
    await c1.query("BEGIN");
    await c2.query("BEGIN");
    const r1 = await reserveFunds(run1, { projectId, commitmentId: null, amountCents: 400_000 });
    assert.equal(r1.ok, true);
    const p2 = reserveFunds(run2, { projectId, commitmentId: null, amountCents: 400_000 }); // blocks on the project row
    await new Promise((r) => setTimeout(r, 150));
    await c1.query("COMMIT");
    const r2 = await p2;
    await c2.query(r2.ok ? "COMMIT" : "ROLLBACK");
    assert.equal(r2.ok, false, "second reservation sees the first and refuses");
    assert.equal(r2.shortfallCents, 300_000);
    await c1.end();
    await c2.end();
    const f = await projectFunding(runOver(client), projectId);
    assert.equal(f.reservedCents, 400_000);
    assert.equal(f.availableCents, 100_000);
  });
});

test("V40 bill for a reserved order does not double count; return/shortfall escalates; release only when verified unused", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-bill", { collectedCents: 1_000_000 });
    const vendorId = await seedVendor(client);
    const poId = await seedPO(client, projectId, vendorId, [{ description: "Studs", qty: 100, unitCents: 3_000 }]);
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    assert.equal(prep.ok, true);
    const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
    assert.equal(staged.ok, true);
    const res = await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
    assert.equal(res.ok, true);
    const committed = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(committed.ok, true);
    let f = await projectFunding(run, projectId);
    assert.equal(f.reservedCents, 300_000);
    assert.equal(f.availableCents, 700_000);

    // deliver + accept, bill, approve payment, confirm by hand
    const del = await recordDelivery(run, { commitmentId: prep.commitment.id, lines: [{ lineId: prep.commitment.items[0].lineId, description: "Studs", qtyReceived: 100 }], principal: agent });
    assert.equal(del.ok, true);
    await reviewDelivery(run, { deliveryId: del.delivery.id, accepted: true, principal: owner });
    const bill = await receiveBill(run, { commitmentId: prep.commitment.id, payeeKind: "vendor", vendorId, payeeName: "ZZ Siweck Lumber", amountCents: 300_000, principal: agent });
    assert.equal(bill.ok, true);
    assert.equal(bill.bill.payable_cents, 300_000);
    const pay = await stagePaymentDecision(run, { billId: bill.bill.id, principal: agent });
    assert.equal(pay.ok, true);
    await resolveDecision(run, { id: pay.decision.id, outcome: "approved", principal: owner, via: "app" });
    const exec = await executePayment(run, { billId: bill.bill.id, decisionId: pay.decision.id, principal: agent });
    assert.equal(exec.ok, true);
    assert.equal(exec.outcome, "manual_pending");
    f = await projectFunding(run, projectId);
    assert.equal(f.spentCents, 0, "manual_pending is not spent");
    assert.equal(f.reservedCents, 300_000, "reservation still held while pending");
    const rel = await releaseUnusedReservation(run, { commitmentId: prep.commitment.id, reason: "test" });
    assert.equal(rel.ok, false, "cannot release while a matched bill is unpaid");
    const conf = await recordManualPaymentConfirmation(run, { billId: bill.bill.id, evidence: { method: "check", reference: "1042" }, principal: owner });
    assert.equal(conf.ok, true);
    assert.equal(conf.consumedCents, 300_000);
    f = await projectFunding(run, projectId);
    assert.equal(f.spentCents, 300_000);
    assert.equal(f.reservedCents, 0);
    assert.equal(f.availableCents, 700_000, "order + bill counted once");
    // an expense logged against the same PO is not counted twice either
    await client.query(`INSERT INTO expenses (project_id, vendor_label, kind, amount_cents, purchase_order_id) VALUES ($1, 'Siweck', 'material', 300000, $2)`, [projectId, poId]);
    f = await projectFunding(run, projectId);
    assert.equal(f.spentCents, 300_000, "expense paying a PO with a paid bill is the same money");

    // shortfall: a payment beyond its reservation escalates a funding decision
    const c2 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: await seedPO(client, projectId, vendorId, [{ description: "Sheathing", qty: 10, unitCents: 10_000 }], { number: "PO-002" }) }, principal: agent });
    const s2 = await stagePurchaseDecision(run, { commitmentId: c2.commitment.id, principal: agent });
    await resolveDecision(run, { id: s2.decision.id, outcome: "approved", principal: owner, via: "app" });
    await commitOnApproval(run, { commitmentId: c2.commitment.id, decisionId: s2.decision.id, principal: agent, constructionGate: gateOk });
    const over = await consumeReservationOnPayment(run, { commitmentId: c2.commitment.id, amountCents: 150_000 });
    assert.equal(over.consumedCents, 100_000);
    assert.equal(over.shortfallCents, 50_000);
    const esc = await escalateShortfall(run, { projectId, amountCents: over.shortfallCents, purpose: "overpayment on sheathing", effect: "short", principal: agent, commitmentId: c2.commitment.id });
    assert.equal(esc.created, true);
    assert.equal(esc.decision.kind, "funding");
  });
});

test("V40 company cash requires an explicit approved funding decision; a purchase tap never implies it", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-company", { collectedCents: 100_000 });
    const vendorId = await seedVendor(client);
    const poId = await seedPO(client, projectId, vendorId, [{ description: "Trusses", qty: 1, unitCents: 250_000 }]);
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
    await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
    const first = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(first.ok, false);
    assert.equal(first.code, "funding");
    assert.equal(first.shortfallCents, 150_000);
    assert.ok(first.fundingDecisionId, "a funding decision is staged, not silently used");
    const approvedPurchase = await client.query(`SELECT status, uses FROM decisions WHERE id = $1`, [staged.decision.id]);
    assert.equal(approvedPurchase.rows[0].uses, 0, "the purchase decision was not spent by a refused commit");
    let f = await projectFunding(run, projectId);
    assert.equal(f.companyFundingCents, 0);
    assert.equal(f.reservedCents, 0);
    // owner approves the explicit funding decision
    const res = await resolveDecision(run, { id: first.fundingDecisionId, outcome: "approved", principal: owner, via: "telegram" });
    assert.equal(res.ok, true);
    const applied = await applyCompanyFunding(run, first.fundingDecisionId);
    assert.equal(applied.ok, true);
    f = await projectFunding(run, projectId);
    assert.equal(f.companyFundingCents, 150_000);
    assert.equal(f.availableCents, 250_000);
    const second = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(second.ok, true);
    assert.equal((await projectFunding(run, projectId)).availableCents, 0);
    // the funding decision cannot be reused: same key + same amount returns the existing (now resolved → new) card
    const again = await escalateShortfall(run, { projectId, amountCents: 150_000, purpose: "cover purchase order to ZZ Siweck Lumber", effect: "x", principal: agent });
    assert.notEqual(again.decision.id, first.fundingDecisionId);
    assert.equal(again.decision.status, "pending");
  });
});
