import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedVendor, seedPO } from "./_fixtures-procurement.mjs";
import { cleanField } from "./field-fixtures.mjs";
import { issueMilestoneInvoice, recordInvoicePayment } from "../lib/billing/core.ts";
import { constructionDepositPaid, DEPOSIT_NOT_PAID } from "../lib/workflow/deposit.ts";
import { defaultFieldHooks } from "../lib/field/hooks.ts";
import { prepareTentativeSchedule, submitScheduleForApproval, confirmSchedule } from "../lib/field/schedule-plans.ts";
import { constructionGateSatisfied } from "../lib/procurement/gate.ts";
import { prepareCommitment, stagePurchaseDecision, commitOnApproval } from "../lib/procurement/commitments.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";

// Larson, 2026-10-30: the job's FIRST invoice is the pre-con fee (precon:fee).
// The schedule hook read the first invoice and the purchase gate took any
// settled payment, so paying the fee unlocked confirmed construction dates and
// committing materials. Both gates now wait on the construction deposit (the
// contract's initial payment), paid in full; a pending ACH is not paid.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

async function fresh(client) {
  await cleanProcurement(client);
  await cleanField(client);
  await seedOwner(client);
}

async function seedJob(client, slug) {
  const p = await client.query(
    `INSERT INTO projects (slug, name, status, client_name, client_email) VALUES ($1, 'ZZ Deposit Job', 'construction_contract', 'ZZ Client', 'zz-client@example.test') RETURNING id`,
    [slug],
  );
  const projectId = p.rows[0].id;
  const e = await client.query(
    `INSERT INTO estimates (project_id, title, kind, status, total, draw_schedule, sent_at, approved_at)
     VALUES ($1, 'Formal', 'formal', 'approved', 4000000, $2::jsonb, now(), now()) RETURNING id`,
    [projectId, JSON.stringify([{ label: "Deposit (on signing)", percent: 50, triggerStatus: "construction_contract" }, { label: "Final", percent: 50, triggerStatus: "warranty" }])],
  );
  return { projectId, estimateId: Number(e.rows[0].id) };
}

async function stagePurchase(run, client, projectId) {
  const vendorId = await seedVendor(client);
  const poId = await seedPO(client, projectId, vendorId, [{ description: "Cabinets", qty: 1, unitCents: 10_000 }]);
  const prep = await prepareCommitment(run, { source: { kind: "purchase_order", purchaseOrderId: poId }, principal: agent });
  assert.equal(prep.ok, true, prep.reason);
  const staged = await stagePurchaseDecision(run, { commitmentId: prep.commitment.id, principal: agent });
  assert.equal(staged.ok, true, staged.reason);
  await resolveDecision(run, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" });
  return { commitmentId: prep.commitment.id, decisionId: staged.decision.id };
}

test("pre-con fee paid + contract signed + deposit unpaid → no confirmed dates, no purchase; pending ACH still refused; deposit settled → both pass", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await fresh(client);
    const run = runOver(client);
    const hooks = defaultFieldHooks();
    const { projectId, estimateId } = await seedJob(client, "zz-deposit-a");

    // The pre-con fee is the job's first invoice, and it is paid.
    const fee = await issueMilestoneInvoice(run, { projectId, economicKey: "precon:fee", milestone: "Pre-construction fee", amountCents: 175_000, source: "manual", principal: owner });
    await recordInvoicePayment(run, { invoiceId: fee.invoice.id, kind: "payment", amountCents: 175_000, method: "card", principal: owner });
    // Contract signed; the deposit is issued but unpaid.
    await client.query(`INSERT INTO signature_requests (project_id, doc_type, title, status, signed_at) VALUES ($1, 'contract', 'zz-Construction Contract', 'signed', now())`, [projectId]);
    const dep = await issueMilestoneInvoice(run, { projectId, economicKey: `estimate:${estimateId}:initial`, milestone: "Deposit (on signing)", amountCents: 2_000_000, source: "acceptance", estimateId, principal: owner });
    const [first] = await run(`SELECT economic_key, status FROM invoices WHERE project_id = $1 ORDER BY id LIMIT 1`, [projectId]);
    assert.deepEqual(first, { economic_key: "precon:fee", status: "paid" }, "the first invoice is the paid pre-con fee");
    assert.equal(await constructionDepositPaid(run, projectId), false);

    // Schedule: approved plan, signed contract, pre-con fee paid → refused.
    const plan = await prepareTentativeSchedule(run, owner, { projectId, startDate: "2026-11-16", phases: [{ key: "demo", label: "Demo", durationDays: 2 }, { key: "cab", label: "Cabinets", durationDays: 3, dependsOn: ["demo"], crew: "zz-sub-a" }] }, hooks);
    const sub = await submitScheduleForApproval(run, owner, plan.id);
    await resolveDecision(run, { id: sub.decision.id, outcome: "approved", principal: owner, via: "app" });
    let conf = await confirmSchedule(run, plan.id, hooks);
    assert.equal(conf.ok, false);
    assert.deepEqual(conf.gates, { approved: true, signedAgreement: true, initialPayment: false });
    assert.equal((await run(`SELECT count(*)::int AS n FROM schedule_commitments WHERE project_id = $1`, [projectId]))[0].n, 0, "no confirmed dates");

    // Purchases: the gate refuses, in plain words, and the decision is not spent.
    let g = await constructionGateSatisfied(run, projectId);
    assert.deepEqual([g.ok, g.signed, g.initialPaymentReceived, g.unknown], [false, true, false, false]);
    assert.equal(g.reason, "construction gate not met: construction deposit not paid yet (the pre-con fee doesn't count)");
    const purchase = await stagePurchase(run, client, projectId);
    let commit = await commitOnApproval(run, { ...purchase, principal: agent });
    assert.equal(commit.ok, false);
    assert.equal(commit.code, "gate");
    assert.ok(commit.reason.includes(DEPOSIT_NOT_PAID), commit.reason);
    assert.equal((await client.query(`SELECT uses FROM decisions WHERE id = $1`, [purchase.decisionId])).rows[0].uses, 0);

    // The deposit comes in by ACH: pending is not paid.
    await recordInvoicePayment(run, { invoiceId: dep.invoice.id, kind: "payment", amountCents: 2_000_000, method: "ach", provider: "square", providerRef: "zz-ach-1", status: "pending", principal: owner });
    assert.notEqual((await run(`SELECT status FROM invoices WHERE id = $1`, [dep.invoice.id]))[0].status, "paid");
    assert.equal(await constructionDepositPaid(run, projectId), false);
    conf = await confirmSchedule(run, plan.id, hooks);
    assert.equal(conf.ok, false);
    assert.equal(conf.gates.initialPayment, false);
    g = await constructionGateSatisfied(run, projectId);
    assert.equal(g.ok, false);
    assert.match(g.reason, /construction deposit not paid yet/);

    // It settles: both gates open.
    await recordInvoicePayment(run, { invoiceId: dep.invoice.id, kind: "payment", amountCents: 2_000_000, method: "ach", provider: "square", providerRef: "zz-ach-1", status: "settled", principal: owner });
    assert.equal(await constructionDepositPaid(run, projectId), true);
    conf = await confirmSchedule(run, plan.id, hooks);
    assert.equal(conf.ok, true, conf.blockers?.join("; "));
    assert.ok((await run(`SELECT count(*)::int AS n FROM schedule_commitments WHERE project_id = $1 AND confirmed`, [projectId]))[0].n > 0);
    g = await constructionGateSatisfied(run, projectId);
    assert.deepEqual([g.ok, g.signed, g.initialPaymentReceived], [true, true, true]);
    assert.equal(g.reason, "construction agreement signed and construction deposit paid");
    commit = await commitOnApproval(run, { ...purchase, principal: agent });
    assert.equal(commit.ok, true, commit.reason);
    assert.equal(commit.commitment.state, "committed");
  });
});

test("the deposit is the initial invoice or draw 0 only: later draws, manual and unkeyed invoices don't count", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await fresh(client);
    const run = runOver(client);
    const { projectId, estimateId } = await seedJob(client, "zz-deposit-b");
    const paidInvoice = async (economicKey, amountCents) => {
      const r = await issueMilestoneInvoice(run, { projectId, economicKey, milestone: economicKey, amountCents, source: "manual", estimateId, principal: owner });
      await recordInvoicePayment(run, { invoiceId: r.invoice.id, kind: "payment", amountCents, method: "check", principal: owner });
    };
    await paidInvoice("precon:fee", 175_000);
    await paidInvoice("manual:deposit", 50_000);
    await paidInvoice("draw:1:final", 50_000);
    const [legacy] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, paid_at) VALUES ($1, 'INV-090', 'Deposit', 50000, 'paid', now()) RETURNING id`, [projectId]);
    await run(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'payment', 50000, 'check', 'settled')`, [legacy.id]);
    assert.equal(await constructionDepositPaid(run, projectId), false);
    assert.equal((await defaultFieldHooks().initialPaymentReceived(run, projectId)), false);

    await paidInvoice("draw:0:deposit-on-signing", 2_000_000);
    assert.equal(await constructionDepositPaid(run, projectId), true);
    assert.equal((await defaultFieldHooks().initialPaymentReceived(run, projectId)), true);
  });
});
