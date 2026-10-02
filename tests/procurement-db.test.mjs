import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedVendor, seedSub, seedPO, seedFile } from "./_fixtures-procurement.mjs";
import { prepareCommitment, stagePurchaseDecision, commitOnApproval, latestCommitment } from "../lib/procurement/commitments.ts";
import { recordAcknowledgement, recordDelivery, reviewDelivery, listDeliveries } from "../lib/procurement/deliveries.ts";
import { receiveBill, matchBill, stagePaymentDecision, executePayment, recordManualPaymentConfirmation, proposePayeeValidation, validatedDestination } from "../lib/procurement/bills.ts";
import { stagePackageRelease, selectBidForEstimate, awardBid, stageSupplierPricingRequest } from "../lib/procurement/packages.ts";
import { constructionGateSatisfied } from "../lib/procurement/gate.ts";
import { vendorRestrictions } from "../lib/procurement/vendor-rules.ts";
import { projectFunding } from "../lib/funding/index.ts";
import { resolveDecision, consumeDecision } from "../lib/commands/decisions.ts";

// VALIDATION V22 (purchase vs payment), V35 (release cards), V15 (partial
// service deliverable) against a real disposable Postgres.
const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const gateOk = async () => ({ ok: true, signed: true, initialPaymentReceived: true, unknown: false, reason: "test" });

async function commitPo(run, client, projectId, vendorId, lines, opts = {}) {
  const poId = await seedPO(client, projectId, vendorId, lines, opts);
  const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
  assert.equal(prep.ok, true, prep.reason);
  const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent, payNowBundled: opts.payNow });
  assert.equal(staged.ok, true, staged.reason);
  const res = await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
  assert.equal(res.ok, true);
  const committed = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
  assert.equal(committed.ok, true, committed.reason);
  return { poId, commitment: committed.commitment, decision: staged.decision, intentId: committed.intentId };
}

test("V22 approved order → bill → SEPARATE payment decision; no rail → manual_pending, never 'paid' until confirmed; retry cannot duplicate", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-p1", { collectedCents: 2_000_000 });
    const vendorId = await seedVendor(client);
    const { poId, commitment, decision, intentId } = await commitPo(run, client, projectId, vendorId, [{ description: "2x6x12", qty: 50, unitCents: 1_200 }], { taxCents: 4_500, shippingCents: 5_000 });
    assert.equal(commitment.total_cents, 60_000 + 4_500 + 5_000, "total includes tax and shipping");
    assert.equal(commitment.state, "committed");
    assert.equal(commitment.payee_contact, "zz-siweck@example.test", "payee from the trusted vendor record, not the PO snapshot");
    const po = await client.query(`SELECT status, commitment_id, send_intent_id FROM purchase_orders WHERE id = $1`, [poId]);
    assert.equal(po.rows[0].status, "queued");
    assert.equal(Number(po.rows[0].commitment_id), commitment.id);
    const intent = await client.query(`SELECT kind, state, operation_key, decision_id, recipient FROM action_intents WHERE id = $1`, [intentId]);
    assert.equal(intent.rows[0].kind, "send_purchase_order");
    assert.equal(intent.rows[0].state, "pending", "the dispatcher (WS-approvals) delivers it; nothing was emailed here");
    assert.equal(intent.rows[0].operation_key, `po:${poId}:send:rev1`);
    assert.equal(intent.rows[0].decision_id, decision.id);
    const usedDecision = await client.query(`SELECT status, uses FROM decisions WHERE id = $1`, [decision.id]);
    assert.equal(usedDecision.rows[0].status, "consumed");
    // a repeat commit is a no-op
    const again = await commitOnApproval(run, { commitmentId: commitment.id, decisionId: decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(again.ok, true);
    assert.equal(again.already, true);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM cash_reservations WHERE state = 'reserved'`)).rows[0].n, 1);

    // acknowledgement + delivery + review → accepted
    const ack = await recordAcknowledgement(run, { commitmentId: commitment.id, promisedDate: "2026-10-01", via: "email", principal: agent });
    assert.equal(ack.ok, true);
    assert.equal(ack.commitment.state, "acknowledged");
    const del = await recordDelivery(run, { commitmentId: commitment.id, lines: [{ lineId: commitment.items[0].lineId, description: "2x6x12", qtyReceived: 50 }], receivedAt: "2026-09-30T12:00:00Z", principal: agent });
    assert.equal(del.ok, true);
    assert.equal(del.late, false);
    assert.equal(del.commitment.state, "delivered");
    assert.equal(Number((await client.query(`SELECT qty_received FROM purchase_order_lines WHERE id = $1`, [commitment.items[0].lineId])).rows[0].qty_received), 50);

    // a bill file arriving makes nothing payable
    await seedFile(client, "zz-bill-1");
    const bill = await receiveBill(run, { projectId, payeeKind: "vendor", vendorId, payeeName: "ZZ Siweck Lumber", billNumber: "S-1001", amountCents: 69_500, fileId: "zz-bill-1", principal: agent });
    assert.equal(bill.ok, true);
    assert.equal(bill.bill.matched_state, "unmatched");
    assert.equal(bill.bill.payable_cents, null);
    let pay = await stagePaymentDecision(run, { billId: bill.bill.id, principal: agent });
    assert.equal(pay.ok, false);
    assert.match(pay.reason, /Nothing is payable/);
    // matched but not yet accepted → still not payable
    let m = await matchBill(run, { billId: bill.bill.id, commitmentId: commitment.id });
    assert.equal(m.ok, true);
    assert.equal(m.payable, false);
    assert.equal(m.bill.payable_cents, null);
    const rev = await reviewDelivery(run, { deliveryId: del.delivery.id, accepted: true, principal: owner });
    assert.equal(rev.commitmentState, "accepted");
    m = await matchBill(run, { billId: bill.bill.id, commitmentId: commitment.id });
    assert.equal(m.bill.payable_cents, 69_500);

    // payment is its own decision; the purchase approval did not imply it
    pay = await stagePaymentDecision(run, { billId: bill.bill.id, principal: agent });
    assert.equal(pay.ok, true);
    assert.equal(pay.bundled, false);
    assert.equal(pay.decision.kind, "payment");
    assert.notEqual(pay.decision.id, decision.id);
    assert.equal(Number(pay.decision.amount_cents), 69_500);
    assert.equal(pay.decision.recipient, "zz-siweck@example.test");
    let exec = await executePayment(run, { billId: bill.bill.id, decisionId: pay.decision.id, principal: agent });
    assert.equal(exec.ok, false, "cannot pay before the payment decision is approved");
    assert.match(exec.reason, /waiting for approval/);
    // a changed destination (untrusted email) never reaches the decision
    await proposePayeeValidation(run, { payeeKind: "vendor", vendorId, field: "bank", value: "routing 000 acct 999", source: "email:spoof", sourceTrusted: false });
    const dest = await validatedDestination(run, pay.bill);
    assert.equal(dest.ok, true);
    assert.equal(dest.destination.bank, undefined, "proposed bank change is ignored until the owner confirms it");
    await resolveDecision(run, { id: pay.decision.id, outcome: "approved", principal: owner, via: "telegram" });
    exec = await executePayment(run, { billId: bill.bill.id, decisionId: pay.decision.id, principal: agent });
    assert.equal(exec.ok, true);
    assert.equal(exec.outcome, "manual_pending");
    assert.equal(exec.bill.state, "manual_pending");
    assert.match(exec.instructions, /No outgoing payment rail/);
    const step = await client.query(`SELECT title, status FROM work_items WHERE source_id = $1`, [`bill:${bill.bill.id}:manual-payment`]);
    assert.equal(step.rows.length, 1, "owner execution step created");
    // retry: idempotent, one intent, no second disbursement
    const retry = await executePayment(run, { billId: bill.bill.id, decisionId: pay.decision.id, principal: agent });
    assert.equal(retry.ok, true);
    assert.equal(retry.already, true);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents WHERE kind = 'pay_bill'`)).rows[0].n, 1);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_id = $1`, [`bill:${bill.bill.id}:manual-payment`])).rows[0].n, 1);
    assert.equal((await client.query(`SELECT state FROM bills WHERE id = $1`, [bill.bill.id])).rows[0].state, "manual_pending", "still not paid");
    const conf = await recordManualPaymentConfirmation(run, { billId: bill.bill.id, evidence: { method: "ach", reference: "TRACE-77" }, principal: owner });
    assert.equal(conf.ok, true);
    assert.equal(conf.bill.state, "paid");
    assert.equal((await client.query(`SELECT status FROM work_items WHERE source_id = $1`, [`bill:${bill.bill.id}:manual-payment`])).rows[0].status, "done");
    assert.equal((await client.query(`SELECT state FROM commitments WHERE id = $1`, [commitment.id])).rows[0].state, "paid");
    const confAgain = await recordManualPaymentConfirmation(run, { billId: bill.bill.id, evidence: { method: "ach" }, principal: owner });
    assert.equal(confAgain.already, true);
  });
});

test("V22 changed total or payee invalidates the approval; a stale decision cannot be consumed", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-p2", { collectedCents: 2_000_000 });
    const vendorId = await seedVendor(client);
    const poId = await seedPO(client, projectId, vendorId, [{ description: "Plywood", qty: 20, unitCents: 5_000 }]);
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
    await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
    // total changes before commit
    await client.query(`UPDATE purchase_order_lines SET qty_ordered = 30, extended = 150000 WHERE purchase_order_id = $1`, [poId]);
    const prep2 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    assert.equal(prep2.created, true);
    assert.equal(prep2.commitment.revision, 2);
    assert.equal(prep2.supersededRevision, 1);
    assert.equal((await client.query(`SELECT state FROM commitments WHERE id = $1`, [prep.commitment.id])).rows[0].state, "void");
    assert.equal((await client.query(`SELECT status FROM decisions WHERE id = $1`, [staged.decision.id])).rows[0].status, "superseded");
    const stale = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(stale.ok, false);
    const stale2 = await commitOnApproval(run, { commitmentId: prep2.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(stale2.ok, false);
    assert.equal(stale2.code, "decision");
    // fresh decision on the new revision works; same content re-prepare is a no-op
    const staged2 = await stagePurchaseDecision(run, { commitmentId: prep2.commitment.id, principal: agent });
    assert.equal(Number(staged2.decision.amount_cents), 150_000);
    const same = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    assert.equal(same.created, false);
    // payee changes → new revision again, even after approval
    await resolveDecision(run, { id: staged2.decision.id, outcome: "approved", principal: owner, via: "app" });
    const vendor2 = await seedVendor(client, "zz-other", { name: "ZZ Other Yard" });
    await client.query(`UPDATE purchase_orders SET vendor_id = $2 WHERE id = $1`, [poId, vendor2]);
    const prep3 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    assert.equal(prep3.commitment.revision, 3);
    assert.equal(prep3.commitment.payee_name, "ZZ Other Yard");
    const direct = await consumeDecision(run, { id: staged2.decision.id, action: "commit_purchase", contentHash: prep3.commitment.content_hash, recipient: prep3.commitment.payee_contact, amountCents: prep3.commitment.total_cents, consumer: "test" });
    assert.equal(direct.ok, false, "approved decision for the old payee cannot pay the new one");
  });
});

test("V22 repeated pay-now request → one commitment, one payment", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-p3", { collectedCents: 2_000_000 });
    const vendorId = await seedVendor(client);
    const { poId, commitment, decision } = await commitPo(run, client, projectId, vendorId, [{ description: "Hardware", qty: 1, unitCents: 20_000 }], { payNow: true });
    const d = await client.query(`SELECT action, max_uses, uses, summary FROM decisions WHERE id = $1`, [decision.id]);
    assert.equal(d.rows[0].action, "commit_and_pay_purchase");
    assert.match(d.rows[0].summary.effect, /immediate payment/);
    assert.match(d.rows[0].summary.effect, /No later bill/);
    // second "pay now" request for the same PO: same commitment, same decision
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    assert.equal(prep.commitment.id, commitment.id);
    const dup = await commitOnApproval(run, { commitmentId: commitment.id, decisionId: decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(dup.already, true);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM commitments`)).rows[0].n, 1);
    // deliver + accept, then the bill uses the bundled decision — no second card
    const del = await recordDelivery(run, { commitmentId: commitment.id, lines: [{ lineId: commitment.items[0].lineId, description: "Hardware", qtyReceived: 1 }], principal: agent });
    await reviewDelivery(run, { deliveryId: del.delivery.id, accepted: true, principal: owner });
    const bill = await receiveBill(run, { commitmentId: commitment.id, payeeKind: "vendor", vendorId, payeeName: "x", amountCents: 20_000, principal: agent });
    const pay = await stagePaymentDecision(run, { billId: bill.bill.id, principal: agent });
    assert.equal(pay.ok, true);
    assert.equal(pay.bundled, true);
    assert.equal(pay.decision.id, decision.id);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'payment'`)).rows[0].n, 0);
    const exec = await executePayment(run, { billId: bill.bill.id, decisionId: decision.id, principal: agent });
    assert.equal(exec.ok, true);
    assert.equal(exec.outcome, "manual_pending");
    const spent = await client.query(`SELECT status, uses FROM decisions WHERE id = $1`, [decision.id]);
    assert.equal(spent.rows[0].uses, 2);
    assert.equal(spent.rows[0].status, "consumed");
    const exec2 = await executePayment(run, { billId: bill.bill.id, decisionId: decision.id, principal: agent });
    assert.equal(exec2.already, true);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents WHERE kind = 'pay_bill'`)).rows[0].n, 1);
    // a later bill on the same commitment is NOT covered by the bundle
    const bill2 = await receiveBill(run, { commitmentId: commitment.id, payeeKind: "vendor", vendorId, payeeName: "x", amountCents: 1_000, principal: agent });
    assert.equal(bill2.matched.bill.matched_state, "disputed", "exceeds the committed total");
  });
});

test("V22/V15 partial, late, wrong and revised deliveries reconcile distinctly; two orders per vendor stay distinct; partial service deliverable limits payable", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-p4", { collectedCents: 5_000_000 });
    const vendorId = await seedVendor(client);
    const a = await commitPo(run, client, projectId, vendorId, [{ description: "Joists", qty: 40, unitCents: 2_500 }, { description: "Hangers", qty: 80, unitCents: 150 }], { number: "PO-010" });
    const b = await commitPo(run, client, projectId, vendorId, [{ description: "Siding", qty: 30, unitCents: 9_000 }], { number: "PO-011" });
    await recordAcknowledgement(run, { commitmentId: a.commitment.id, promisedDate: "2026-09-20", via: "email", principal: agent });
    const partial = await recordDelivery(run, { commitmentId: a.commitment.id, lines: [{ lineId: a.commitment.items[0].lineId, description: "Joists", qtyReceived: 25 }], receivedAt: "2026-09-22T10:00:00Z", principal: agent });
    assert.equal(partial.commitment.state, "partially_delivered");
    assert.equal(partial.late, true, "after the promised date");
    const wrong = await recordDelivery(run, { commitmentId: a.commitment.id, lines: [{ description: "2x4 (not ordered)", qtyReceived: 40 }], wrong: true, issues: ["wrong product"], principal: agent });
    assert.equal(wrong.commitment.state, "partially_delivered", "a wrong delivery does not advance the order");
    const revised = await recordDelivery(run, { commitmentId: a.commitment.id, lines: [{ lineId: a.commitment.items[0].lineId, description: "Joists", qtyReceived: 15 }, { lineId: a.commitment.items[1].lineId, description: "Hangers", qtyReceived: 80 }], revised: true, note: "vendor re-shipped", principal: agent });
    assert.equal(revised.commitment.state, "delivered");
    const rows = await listDeliveries(run, a.commitment.id);
    assert.deepEqual(rows.map((r) => [r.kind, r.late, r.wrong, r.revised]), [["acknowledgement", false, false, false], ["receipt", true, false, false], ["receipt", false, true, false], ["receipt", false, false, true]]);
    assert.equal((await client.query(`SELECT state FROM commitments WHERE id = $1`, [b.commitment.id])).rows[0].state, "committed", "the other order for the same vendor is untouched");
    // reviews: accept partial + revised → accepted; bill limited to accepted value
    await reviewDelivery(run, { deliveryId: partial.delivery.id, accepted: true, principal: owner });
    const r = await reviewDelivery(run, { deliveryId: revised.delivery.id, accepted: true, principal: owner });
    assert.equal(r.commitmentState, "accepted");
    const bill = await receiveBill(run, { commitmentId: a.commitment.id, payeeKind: "vendor", vendorId, payeeName: "x", amountCents: 112_000, principal: agent });
    assert.equal(bill.bill.payable_cents, 112_000);
    // a bill against order B before anything was delivered/accepted stays unpayable and does not touch A
    const billB = await receiveBill(run, { commitmentId: b.commitment.id, payeeKind: "vendor", vendorId, payeeName: "x", amountCents: 270_000, principal: agent });
    assert.equal(billB.bill.payable_cents, null);

    // V15 partial service deliverable (sub award): 40% delivered and accepted → only that is payable
    const sub = await seedSub(client, "zz-sub-a", { trade: "Drafting" });
    const pkg = await client.query(`INSERT INTO bid_packages (project_id, title, trade, scope_notes, status) VALUES ($1, 'Drawings', 'Drafting', 'Full plan set', 'open') RETURNING id`, [projectId]);
    const inv = await client.query(`INSERT INTO bid_invites (package_id, sub_slug, status) VALUES ($1, $2, 'submitted') RETURNING id`, [pkg.rows[0].id, sub]);
    await client.query(`INSERT INTO bid_submissions (invite_id, total, notes) VALUES ($1, 1000000, '2 revisions included')`, [inv.rows[0].id]);
    const noDecision = await awardBid(run, { inviteId: Number(inv.rows[0].id), principal: agent });
    assert.equal(noDecision.ok, false);
    assert.ok(noDecision.staged.decisionId, "award without a purchase decision only stages one");
    assert.equal((await client.query(`SELECT status FROM bid_invites WHERE id = $1`, [inv.rows[0].id])).rows[0].status, "submitted");
    await resolveDecision(run, { id: noDecision.staged.decisionId, outcome: "approved", principal: owner, via: "app" });
    const awarded = await awardBid(run, { inviteId: Number(inv.rows[0].id), decisionId: noDecision.staged.decisionId, principal: agent, constructionGate: gateOk });
    assert.equal(awarded.ok, true);
    assert.equal(awarded.result.ok, true);
    assert.equal((await client.query(`SELECT status FROM bid_invites WHERE id = $1`, [inv.rows[0].id])).rows[0].status, "awarded");
    assert.equal((await client.query(`SELECT status FROM bid_packages WHERE id = $1`, [pkg.rows[0].id])).rows[0].status, "awarded");
    const svc = await recordDelivery(run, { commitmentId: awarded.commitmentId, lines: [{ description: "Schematic set", qtyReceived: 1, amountCents: 400_000 }], principal: agent });
    assert.equal(svc.commitment.state, "partially_delivered");
    await reviewDelivery(run, { deliveryId: svc.delivery.id, accepted: true, principal: owner });
    const svcBill = await receiveBill(run, { commitmentId: awarded.commitmentId, payeeKind: "sub", subSlug: sub, payeeName: "ZZ Sub A", amountCents: 1_000_000, principal: agent });
    assert.equal(svcBill.bill.payable_cents, 400_000, "only the accepted partial deliverable is payable");
    assert.match(svcBill.bill.match_note, /limited to accepted work/);
  });
});

test("construction gate blocks purchases until signed + initial payment; unknown refuses", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const unsigned = await seedProject(client, "zz-unsigned", { signed: false, collectedCents: 1_000_000 });
    const vendorId = await seedVendor(client);
    const poId = await seedPO(client, unsigned, vendorId, [{ description: "Lumber", qty: 1, unitCents: 10_000 }]);
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
    const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
    await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
    const blocked = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "gate");
    assert.match(blocked.reason, /no signed construction agreement/);
    assert.equal((await client.query(`SELECT uses FROM decisions WHERE id = $1`, [staged.decision.id])).rows[0].uses, 0);
    const g = await constructionGateSatisfied(run, unsigned);
    assert.equal(g.signed, false);
    assert.equal(g.initialPaymentReceived, true);
    const gUnknown = await constructionGateSatisfied(run, "00000000-0000-0000-0000-000000000000");
    assert.equal(gUnknown.unknown, true);
    await client.query(`INSERT INTO signature_requests (project_id, doc_type, title, status, signed_at) VALUES ($1, 'contract', 'CA', 'signed', now())`, [unsigned]);
    const ok = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent });
    assert.equal(ok.ok, true);
    // pre-construction service (drawings) may state the exemption explicitly
    const precon = await seedProject(client, "zz-precon", { signed: false, collectedCents: 100_000 });
    const drafter = await seedVendor(client, "zz-fiverr-draft", { name: "ZZ Drafter (Fiverr)", email: "zz-draft@example.test" });
    const po2 = await seedPO(client, precon, drafter, [{ description: "Plan set", qty: 1, unitCents: 50_000 }]);
    const p2 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: po2 }, principal: agent });
    assert.equal(p2.restrictions.manual.marketplace, "fiverr");
    const s2 = await stagePurchaseDecision(run, { commitmentId: p2.commitment.id, principal: agent });
    assert.ok(s2.manualSteps.some((s) => /Joe opens Fiverr himself/.test(s)), "Fiverr is handed off, never automated");
    await resolveDecision(run, { id: s2.decision.id, outcome: "approved", principal: owner, via: "app" });
    const c2 = await commitOnApproval(run, { commitmentId: p2.commitment.id, decisionId: s2.decision.id, principal: agent, preconstructionService: true });
    assert.equal(c2.ok, true);
    // owner restriction lines on the vendor record stop staging
    const banned = await seedVendor(client, "zz-banned", { notes: "RESTRICT: do not order without calling first" });
    assert.equal(vendorRestrictions({ name: "x", notes: "RESTRICT: no" }).ok, false);
    const po3 = await seedPO(client, unsigned, banned, [{ description: "x", qty: 1, unitCents: 100 }], { number: "PO-003" });
    const p3 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: po3 }, principal: agent });
    const s3 = await stagePurchaseDecision(run, { commitmentId: p3.commitment.id, principal: agent });
    assert.equal(s3.ok, false);
    assert.match(s3.reason, /Owner restriction/);
    // one-off payee cannot be validated
    const oneOff = await client.query(`INSERT INTO purchase_orders (project_id, po_number, vendor_kind, vendor_name, vendor_email, title) VALUES ($1, 'PO-004', 'one_off', 'Some Guy', 'guy@example.test', 'x') RETURNING id`, [unsigned]);
    await client.query(`INSERT INTO purchase_order_lines (purchase_order_id, description, qty_ordered, unit_cost, extended) VALUES ($1, 'x', 1, 100, 100)`, [oneOff.rows[0].id]);
    const p4 = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: Number(oneOff.rows[0].id) }, principal: agent });
    assert.equal(p4.ok, false);
    assert.match(p4.reason, /vendor or sub records/);
    assert.equal((await projectFunding(run, unsigned)).reservedCents, 10_000);
  });
});

test("V35 release cards: per-recipient exact revision, required fields, one card per revision, changes since last review; bid choice is not an award", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-p5", { collectedCents: 100 });
    const a = await seedSub(client, "zz-sub-a", { trade: "Electrical" });
    const b = await seedSub(client, "zz-sub-b", { trade: "Electrical" });
    await seedFile(client, "zz-plan-a1", { projectKey: "zz-p5", name: "Plan A1.pdf" });
    const pkg = await client.query(`INSERT INTO bid_packages (project_id, title, trade, scope_notes, due_date) VALUES ($1, 'Electrical rough-in', 'Electrical', 'Rough-in per plan A1\nPanel upgrade to 200A', '2026-10-05') RETURNING id`, [projectId]);
    const pid = Number(pkg.rows[0].id);
    await client.query(`INSERT INTO bid_package_files (package_id, file_id, label) VALUES ($1, 'zz-plan-a1', 'Plan A1')`, [pid]);
    const ia = await client.query(`INSERT INTO bid_invites (package_id, sub_slug, message) VALUES ($1, $2, 'Hi, plans attached') RETURNING id`, [pid, a]);
    const ib = await client.query(`INSERT INTO bid_invites (package_id, sub_slug, message) VALUES ($1, $2, 'Hi there') RETURNING id`, [pid, b]);
    const rel = await stagePackageRelease(run, { packageId: pid, exclusions: ["Joe installs the fixtures himself", "No low-voltage"], quantities: [{ label: "Recessed cans", qty: 18, unit: "ea" }], assumptions: ["Attic accessible"], gaps: ["Panel location not confirmed"], principal: agent });
    assert.equal(rel.ok, true, rel.reason);
    assert.equal(rel.cards.length, 2, "one card per recipient");
    for (const card of rel.cards) {
      const s = card.decision.summary;
      assert.equal(card.decision.kind, "package_release");
      assert.equal(card.decision.artifact_revision, rel.packageRevision);
      assert.equal(s.recipients.length, 1);
      assert.equal(s.recipients[0].address, card.recipient.address);
      assert.deepEqual(s.inclusions, ["Rough-in per plan A1", "Panel upgrade to 200A"]);
      assert.ok(s.exclusions.some((x) => /Joe/.test(x)), "Joe's retained work is named");
      assert.equal(s.quantities[0].qty, 18);
      assert.equal(s.attachments[0].fileId, "zz-plan-a1");
      assert.ok(s.attachments[0].revision);
      assert.deepEqual(s.gaps, ["Panel location not confirmed"]);
      assert.deepEqual(s.changes, ["First release of this package to this recipient."]);
      assert.match(s.effect, new RegExp(`to .*<${card.recipient.address}> only`));
      assert.deepEqual(card.decision.options, ["approve", "request_changes", "hold"]);
    }
    assert.equal(rel.cards[0].decision.recipient, "zz-sub-a@example.test");
    // re-staging the same revision: no duplicate card
    const again = await stagePackageRelease(run, { packageId: pid, exclusions: ["Joe installs the fixtures himself", "No low-voltage"], quantities: [{ label: "Recessed cans", qty: 18, unit: "ea" }], assumptions: ["Attic accessible"], gaps: ["Panel location not confirmed"], principal: agent });
    assert.equal(again.cards.every((c) => !c.created), true);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'package_release' AND status = 'pending'`)).rows[0].n, 2);
    // a revised package supersedes the pending card and lists what changed
    const rev = await stagePackageRelease(run, { packageId: pid, inviteIds: [Number(ia.rows[0].id)], exclusions: ["Joe installs the fixtures himself"], quantities: [{ label: "Recessed cans", qty: 22, unit: "ea" }], assumptions: ["Attic accessible"], gaps: [], principal: agent });
    assert.equal(rev.cards.length, 1);
    assert.equal(rev.cards[0].created, true);
    assert.equal(rev.cards[0].superseded, rel.cards[0].decision.id);
    assert.notEqual(rev.packageRevision, rel.packageRevision);
    assert.deepEqual(rev.cards[0].changes, ["Exclusions changed", "Quantities changed", "Open gaps changed"]);
    assert.equal((await client.query(`SELECT status FROM decisions WHERE id = $1`, [rel.cards[0].decision.id])).rows[0].status, "superseded");
    assert.equal((await client.query(`SELECT status FROM decisions WHERE id = $1`, [rel.cards[1].decision.id])).rows[0].status, "pending", "the other recipient's card is untouched");
    // staged cards changed nothing on the package or invites
    assert.equal((await client.query(`SELECT status FROM bid_packages WHERE id = $1`, [pid])).rows[0].status, "draft");
    assert.equal((await client.query(`SELECT status, sent_at FROM bid_invites WHERE id = $1`, [ia.rows[0].id])).rows[0].sent_at, null);

    // choosing a bid for the estimate is not an award
    await client.query(`UPDATE bid_invites SET status = 'submitted' WHERE package_id = $1`, [pid]);
    await client.query(`INSERT INTO bid_submissions (invite_id, total, exclusions, lead_time) VALUES ($1, 850000, 'no permits', '2 weeks'), ($2, 910000, '', '1 week')`, [ia.rows[0].id, ib.rows[0].id]);
    const choice = await selectBidForEstimate(run, { inviteId: Number(ia.rows[0].id), principal: agent, rationale: "lowest, exclusions acceptable" });
    assert.equal(choice.ok, true);
    assert.equal(choice.decision.kind, "bid_choice");
    assert.match(choice.decision.summary.effect, /does NOT award/);
    assert.equal(choice.decision.summary.comparison.length, 2);
    await resolveDecision(run, { id: choice.decision.id, outcome: "approved", principal: owner, via: "app" });
    assert.equal((await client.query(`SELECT status FROM bid_invites WHERE id = $1`, [ia.rows[0].id])).rows[0].status, "submitted", "approving the choice awarded nothing");
    assert.equal((await client.query(`SELECT status FROM bid_packages WHERE id = $1`, [pid])).rows[0].status, "draft");

    // supplier pricing request card
    const vendorId = await seedVendor(client);
    const spr = await stageSupplierPricingRequest(run, { projectId, vendorId, products: [{ description: "Andersen 400 DH window", model: "TW3046", finish: "white", unit: "ea", qty: 6 }, { description: "LP SmartSide lap 8in", unit: "sq", qty: null, qtyGap: "siding takeoff pending" }], neededBy: "2026-10-20", principal: agent });
    assert.equal(spr.ok, true);
    assert.equal(spr.decision.action, "send_supplier_pricing_request");
    assert.equal(spr.decision.summary.gaps.length, 1);
    assert.match(spr.decision.summary.effect, /commits nothing/);
  });
});
