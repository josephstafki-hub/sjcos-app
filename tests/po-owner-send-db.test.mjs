import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedVendor, seedPO } from "./_fixtures-procurement.mjs";
import { commitOwnerPurchaseOrder, prepareCommitment, stagePurchaseDecision, commitOnApproval } from "../lib/procurement/commitments.ts";
import { projectFunding } from "../lib/funding/index.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";

// Tier 3 A13: Joe's "Send to vendor" gets the purchase decision's checks
// (construction gate, cash), records the commitment and holds the cash; a PO
// committed through its decision carries its email; money paid outside the
// app counts as the job's cash.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const gateOk = async () => ({ ok: true, signed: true, initialPaymentReceived: true, unknown: false, reason: "test" });

test("owner PO send: gate and cash are checked (Joe can override), the commitment is recorded and cash held once", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const vendorId = await seedVendor(client);

    // No signed contract: held, overridable.
    const pre = await seedProject(client, "zz-po-pre", { signed: false, collectedCents: 500_000 });
    const poPre = await seedPO(client, pre, vendorId, [{ description: "Survey stakes", qty: 1, unitCents: 10_000 }]);
    const held = await commitOwnerPurchaseOrder(run, { purchaseOrderId: poPre, principal: owner });
    assert.equal(held.ok, false);
    assert.equal(held.overridable, true);
    assert.match(held.reason, /^Not ordered yet:/);
    const sent = await commitOwnerPurchaseOrder(run, { purchaseOrderId: poPre, principal: owner, override: true });
    assert.equal(sent.ok, true);
    assert.match(sent.notes[0], /before the construction gate/);

    // Under contract with cash: committed, cash held, PO linked; a second send passes without a second hold.
    const job = await seedProject(client, "zz-po-job", { collectedCents: 500_000 });
    await run(`UPDATE invoices SET economic_key = 'draw:0:deposit' WHERE project_id = $1`, [job]);
    const po = await seedPO(client, job, vendorId, [{ description: "2x6x12", qty: 100, unitCents: 1_200 }]);
    const ok = await commitOwnerPurchaseOrder(run, { purchaseOrderId: po, principal: owner });
    assert.equal(ok.ok, true, ok.reason);
    assert.ok(ok.reservationId);
    const [row] = await run(`SELECT po.commitment_id, c.state, c.total_cents FROM purchase_orders po JOIN commitments c ON c.id = po.commitment_id WHERE po.id = $1`, [po]);
    assert.deepEqual([row.state, Number(row.total_cents)], ["committed", 120_000]);
    assert.equal((await commitOwnerPurchaseOrder(run, { purchaseOrderId: po, principal: owner })).ok, true);
    assert.equal((await run(`SELECT count(*)::int AS n FROM cash_reservations WHERE state = 'reserved' AND commitment_id = $1`, [row.commitment_id]))[0].n, 1);

    // Not enough cash: held; Joe can still send it.
    const big = await seedPO(client, job, vendorId, [{ description: "Windows", qty: 10, unitCents: 100_000 }], { number: "PO-002" });
    const short = await commitOwnerPurchaseOrder(run, { purchaseOrderId: big, principal: owner });
    assert.equal(short.ok, false);
    assert.equal(short.overridable, true);
    const forced = await commitOwnerPurchaseOrder(run, { purchaseOrderId: big, principal: owner, override: true });
    assert.equal(forced.ok, true);
    assert.match(forced.notes.join(" "), /without the cash/);

    // The purchases lane paused: not even Joe's override sends it.
    await run(`INSERT INTO lane_pauses (lane, paused_by, reason) VALUES ('purchases', 'test', 'audit')`);
    const po3 = await seedPO(client, job, vendorId, [{ description: "Nails", qty: 1, unitCents: 500 }], { number: "PO-003" });
    const paused = await commitOwnerPurchaseOrder(run, { purchaseOrderId: po3, principal: owner, override: true });
    assert.equal(paused.ok, false);
    assert.equal(paused.overridable, false);
    await run(`DELETE FROM lane_pauses WHERE lane = 'purchases'`);
  });
});

test("a PO committed through its purchase decision carries the email; outside-the-app payments count as cash", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const vendorId = await seedVendor(client);
    const job = await seedProject(client, "zz-po-dec", { collectedCents: 300_000 });
    const po = await seedPO(client, job, vendorId, [{ description: "Decking", qty: 20, unitCents: 3_000 }]);
    const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: po }, principal: agent });
    const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
    await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
    const c = await commitOnApproval(run, { commitmentId: prep.commitment.id, decisionId: staged.decision.id, principal: agent, constructionGate: gateOk });
    assert.equal(c.ok, true, c.reason);
    const [intent] = await run(`SELECT payload FROM action_intents WHERE id = $1`, [c.intentId]);
    assert.match(intent.payload.subject, /^Purchase Order PO-001/);
    assert.match(intent.payload.bodyText, /Decking: 20 ea/);

    const before = (await projectFunding(run, job)).collectedCents;
    await run(`UPDATE projects SET opening_collected_cents = 150000 WHERE id = $1`, [job]);
    assert.equal((await projectFunding(run, job)).collectedCents, before + 150_000, "paid outside the app counts");
  });
});
