import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import {
  allocateInvoiceNumber,
  issueMilestoneInvoice,
  invoiceBalance,
  recordInvoicePayment,
  voidInvoice,
  creditInvoice,
  recordDeliveryOutcome,
  setInvoiceTerms,
  invoiceCollisionReport,
  verifiedBalances,
  drawEconomicKey,
} from "../lib/billing/core.ts";
import { parseNetTerms } from "../lib/billing/terms.ts";
import { routineReminderCandidates } from "../lib/billing/reminders.ts";
import {
  issueInitialOnAcceptance,
  issueProgressOnOwnerConfirmation,
  issueFinalOnClientSignoff,
  issueFinalFromDecision,
  onSignatureSigned,
  stageMilestoneConfirmation,
  stageInitialInvoiceDecision,
  finalReconciliation,
  POLICY_INITIAL,
  POLICY_FINAL,
} from "../lib/billing/commands.ts";
import { loadInvoiceEmail, invoiceEmailPayload, invoiceSendBlock } from "../lib/billing/invoice-email.ts";
import { proposePolicyVersion, activatePolicy, disablePolicy } from "../lib/commands/policies.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";
import { resolveFromChannel } from "../lib/decisions/resolve.ts";
import { dispatchOnce } from "../lib/dispatch/core.ts";
import { defaultProviders, fakeOutbox, resetFakeOutbox, setFakeOutcome } from "../lib/providers/index.ts";
import { surchargeNotice, DEFAULT_SURCHARGE } from "../lib/payments/surcharge.ts";
import { recordClientPunch, resolveClientPunch } from "../lib/closeout/checklist.ts";

// V10 (invoice identity, numbering, delivery truth, balances, reminders,
// unknown terms), V38 (acceptance → initial invoice) and V44 (sign-off →
// final invoice) against a REAL disposable Postgres. Skipped only when the
// postgres binaries are missing — never redirected at production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: null };

const runOn = (client) => async (sql, params) => (await client.query(sql, params)).rows;

function txOver(url) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(runOn(c));
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      await c.end();
    }
  };
}

async function seed(client, slug = "zz-bill-a") {
  await cleanFoundation(client);
  await client.query(`DELETE FROM app_settings WHERE key IN ('contract.terms','contract.deposit_pct')`);
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  owner.userId = o.rows[0].id;
  const p = await client.query(
    `INSERT INTO projects (slug, name, status, client_name, contract_value) VALUES ($1, $1, 'construction_contract', 'ZZ Client', 50000) RETURNING id`,
    [slug],
  );
  await client.query(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ($2,'x','ZZ Client','client','Z',$1)`, [slug, `zz-client-${slug}@example.test`]);
  await client.query(`INSERT INTO app_settings (key, value) VALUES ('contract.terms', 'Net 30') ON CONFLICT (key) DO UPDATE SET value = 'Net 30'`);
  return p.rows[0].id;
}

async function seedEstimate(client, projectId, { total = 5000000, status = "sent", schedule } = {}) {
  const e = await client.query(
    `INSERT INTO estimates (project_id, title, kind, status, total, draw_schedule, sent_at)
     VALUES ($1, 'Formal', 'formal', $2, $3, $4::jsonb, now() - interval '1 hour') RETURNING id`,
    [projectId, status, total, schedule ? JSON.stringify(schedule) : null],
  );
  const id = Number(e.rows[0].id);
  await client.query(`INSERT INTO estimate_lines (estimate_id, description, qty, unit_cost, extended, created_at) VALUES ($1, 'Work', 1, $2, $2, now() - interval '2 hours')`, [id, total]);
  return id;
}

async function signature(client, { projectId, docType, estimateId = null, status = "sent" }) {
  const r = await client.query(
    `INSERT INTO signature_requests (project_id, doc_type, title, status, estimate_id, sent_at, signed_at, signed_name)
     VALUES ($1, $2, $2, $3, $4, now() - interval '30 minutes', CASE WHEN $3 = 'signed' THEN now() END, CASE WHEN $3 = 'signed' THEN 'ZZ Client' END) RETURNING id`,
    [projectId, docType, status, estimateId],
  );
  return Number(r.rows[0].id);
}

async function sign(client, id) {
  await client.query(`UPDATE signature_requests SET status = 'signed', signed_at = now(), signed_name = 'ZZ Client' WHERE id = $1`, [id]);
}

// What lib/send-ops.ts invoiceEmailExtras adds in the app (stored PDF, portal
// pay link, Square's card-surcharge line), without rendering or minting.
const NOTICE = surchargeNotice(DEFAULT_SURCHARGE);
const mail = {
  async extras(e) {
    return { attachments: [{ filename: `Invoice ${e.number}.pdf`, mimeType: "application/pdf", fileId: `zz-pdf-${e.id}` }], payUrl: `https://os.example.test/client-portal/pay/${e.id}`, surchargeNote: NOTICE };
  },
};

const dispatchDeps = (url, client) => ({ tx: txOver(url), run: runOn(client), providers: defaultProviders(), worker: "zz-billing" });

test("terms parse only what is verifiable", () => {
  assert.deepEqual(parseNetTerms("Net 30"), { netDays: 30, label: "Net 30" });
  assert.deepEqual(parseNetTerms("Payment due within 15 days of invoice"), { netDays: 15, label: "Net 15" });
  assert.deepEqual(parseNetTerms("Balance due upon receipt."), { netDays: 0, label: "Due on receipt" });
  assert.equal(parseNetTerms("Per the agreement"), null);
  assert.equal(parseNetTerms(""), null);
  assert.equal(parseNetTerms("due within 5 business days"), null, "business days are not calendar terms");
});

test("V10 identity: concurrent + replayed milestone → one invoice, gapless numbers; contract revision keeps identity", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client);
    const tx = txOver(url);
    const issue = () =>
      tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "draw:1:rough-in", milestone: "Rough-in", amountCents: 1500000, source: "draw", principal: owner }));
    const results = await Promise.all([issue(), issue(), issue()]);
    const ids = new Set(results.map((r) => r.invoice.id));
    assert.equal(ids.size, 1, "three concurrent issuers share one invoice");
    assert.equal(results.filter((r) => r.created).length, 1);
    const replay = await issue();
    assert.equal(replay.created, false);
    assert.equal(replay.invoice.id, results[0].invoice.id);
    assert.equal(replay.invoice.number, "INV-001");
    assert.equal(replay.invoice.status, "issued");
    assert.equal(replay.invoice.due_at != null, true, "due on receipt → due the day it is issued");
    assert.equal(replay.invoice.terms, "Due on receipt", "the Net 30 company setting does not apply to invoices");

    // A different milestone gets the next number; a changed amount for the same key is NOT a new invoice.
    const second = await tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "draw:2:final", milestone: "Final", amountCents: 100, source: "draw", principal: owner }));
    assert.equal(second.invoice.number, "INV-002");
    const revised = await tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "draw:1:rough-in", milestone: "Rough-in (rev 2)", amountCents: 1600000, source: "draw", principal: owner }));
    assert.equal(revised.created, false);
    assert.equal(revised.invoice.amount, 1500000, "contract revision does not rebill the same economic milestone");

    // numbers come from the allocator, never count(*)+1
    const n = await tx((run) => allocateInvoiceNumber(run, projectId));
    assert.equal(n.number, "INV-003");
    const count = await client.query(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]);
    assert.equal(count.rows[0].n, 2, "no phantom rows");

    // void frees the slot; re-issue supersedes with revision 2
    await tx((run) => voidInvoice(run, { invoiceId: second.invoice.id, reason: "wrong amount", principal: owner }));
    const reissued = await tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "draw:2:final", milestone: "Final", amountCents: 200, source: "draw", principal: owner }));
    assert.equal(reissued.created, true);
    assert.equal(reissued.invoice.revision, 2);
    const voided = await client.query(`SELECT superseded_by, status FROM invoices WHERE id = $1`, [second.invoice.id]);
    assert.equal(Number(voided.rows[0].superseded_by), reissued.invoice.id);
    assert.equal(voided.rows[0].status, "void");
    await assert.rejects(tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "nokey", milestone: "x", amountCents: 1, source: "draw", principal: owner })), /Economic key/);
    await assert.rejects(tx((run) => issueMilestoneInvoice(run, { projectId, economicKey: "draw:9:x", milestone: "x", amountCents: 1.5, source: "draw", principal: owner })), /whole/);
  });
});

test("V10 delivery + balances: failed send never marks sent; partial pay / credit / return sequences; zero balance stops reminders", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-b");
    const tx = txOver(url);
    const run = runOn(client);
    const { invoice } = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:0:deposit", milestone: "Deposit", amountCents: 100000, source: "draw", principal: owner }));

    await tx((r) => recordDeliveryOutcome(r, { invoiceId: invoice.id, ok: false, error: "Gmail is not connected.", principal: owner }));
    let row = (await run(`SELECT status, delivery_state, delivery_error, sent_at FROM invoices WHERE id = $1`, [invoice.id]))[0];
    assert.equal(row.status, "issued", "failed delivery never marks sent");
    assert.equal(row.delivery_state, "failed");
    assert.match(row.delivery_error, /Gmail/);
    assert.equal(row.sent_at, null);

    // reminders: nothing until delivered + past due
    await run(`UPDATE invoices SET due_at = CURRENT_DATE - 3 WHERE id = $1`, [invoice.id]);
    assert.equal((await routineReminderCandidates(run)).length, 0, "undelivered invoice is not reminded");
    await tx((r) => recordDeliveryOutcome(r, { invoiceId: invoice.id, ok: true, principal: owner }));
    let cands = await routineReminderCandidates(run);
    assert.equal(cands.length, 1);
    assert.equal(cands[0].balanceCents, 100000);
    assert.equal(cands[0].clientEmail, "zz-client-zz-bill-b@example.test");

    // partial payment
    const p1 = await tx((r) => recordInvoicePayment(r, { invoiceId: invoice.id, kind: "payment", amountCents: 40000, method: "check", principal: owner }));
    assert.equal(p1.invoice.status, "partially_paid");
    let b = await invoiceBalance(run, invoice.id);
    assert.equal(b.balanceCents, 60000);
    // pending card payment pauses reminders, is not cash
    const pend = await tx((r) => recordInvoicePayment(r, { invoiceId: invoice.id, kind: "payment", amountCents: 60000, method: "ach", provider: "square", providerRef: "pay_1", status: "pending", principal: agent }));
    assert.equal(pend.created, true);
    b = await invoiceBalance(run, invoice.id);
    assert.equal(b.balanceCents, 60000, "pending is not settled");
    assert.equal(b.hasPending, true);
    assert.equal((await routineReminderCandidates(run)).length, 0, "pending payment holds reminders");
    // replayed provider event: same ref, moves pending → settled once
    const s1 = await tx((r) => recordInvoicePayment(r, { invoiceId: invoice.id, kind: "payment", amountCents: 60000, method: "ach", provider: "square", providerRef: "pay_1", status: "settled", principal: agent }));
    const s2 = await tx((r) => recordInvoicePayment(r, { invoiceId: invoice.id, kind: "payment", amountCents: 60000, method: "ach", provider: "square", providerRef: "pay_1", status: "settled", principal: agent }));
    assert.equal(s1.payment.id, s2.payment.id);
    assert.equal(s1.created, false);
    const rows = await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [invoice.id]);
    assert.equal(rows[0].n, 2, "replay created no extra ledger row");
    b = await invoiceBalance(run, invoice.id);
    assert.equal(b.balanceCents, 0);
    assert.equal(s2.invoice.status, "paid");
    assert.equal((await routineReminderCandidates(run)).length, 0, "zero balance stops reminders");
    // a later ACH return restores the balance without a new invoice
    const ret = await tx((r) => recordInvoicePayment(r, { invoiceId: invoice.id, kind: "return", amountCents: 60000, method: "ach", provider: "square", providerRef: "pay_1:return", principal: agent, externalSync: { original: "pay_1" } }));
    assert.equal(ret.invoice.status, "partially_paid");
    b = await invoiceBalance(run, invoice.id);
    assert.equal(b.balanceCents, 60000);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]))[0].n, 1, "no invoice fabricated");
    // credit the rest
    await assert.rejects(tx((r) => creditInvoice(r, { invoiceId: invoice.id, amountCents: 60001, reason: "too much", principal: owner })), /exceeds/);
    const cr = await tx((r) => creditInvoice(r, { invoiceId: invoice.id, amountCents: 60000, reason: "goodwill", principal: owner }));
    assert.equal(cr.invoice.status, "paid");
    assert.equal((await invoiceBalance(run, invoice.id)).balanceCents, 0);
    // void refuses when cash has settled
    await assert.rejects(tx((r) => voidInvoice(r, { invoiceId: invoice.id, reason: "x", principal: owner })), /settled payments/);
    const vb = await verifiedBalances(run, { projectId });
    assert.equal(vb.length, 1);
    assert.deepEqual([vb[0].settledCents, vb[0].creditsCents, vb[0].returnsCents, vb[0].balanceCents], [100000, 60000, 60000, 0]);
    const events = await run(`SELECT kind FROM invoice_events WHERE invoice_id = $1 ORDER BY id`, [invoice.id]);
    assert.deepEqual(events.map((e) => e.kind).slice(0, 3), ["issued", "delivery_failed", "delivered"]);
  });
});

test("V10 terms: every invoice is due on receipt, whatever the contract or caller says; collision report is read-only", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-c");
    const tx = txOver(url);
    const run = runOn(client);
    const today = (await run(`SELECT CURRENT_DATE::text AS d`))[0].d;
    await run(`UPDATE app_settings SET value = 'Per the signed agreement' WHERE key = 'contract.terms'`);
    const { invoice } = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:0:deposit", milestone: "Deposit", amountCents: 5000, source: "draw", terms: "Net 7", principal: owner }));
    assert.equal(invoice.terms, "Due on receipt");
    assert.equal(invoice.due_at, today);
    assert.deepEqual(invoice.exception_flags, []);
    const d = await run(`SELECT 1 FROM decisions WHERE dedupe_key = $1`, [`invoice:${invoice.id}:terms`]);
    assert.equal(d.length, 0, "no terms decision is staged");
    await assert.rejects(tx((r) => setInvoiceTerms(r, { invoiceId: invoice.id, terms: "whenever", principal: owner })), /does not read/);
    await assert.rejects(tx((r) => setInvoiceTerms(r, { invoiceId: invoice.id, terms: "Net 15", principal: owner })), /always due on receipt/);

    // The trigger holds for raw inserts too: a draft has no due date until it goes out.
    const [raw] = await run(
      `INSERT INTO invoices (project_id, number, milestone, amount, status, terms, exception_flags, economic_key) VALUES ($1, 'INV-080', 'Raw', 101, 'draft', 'Net 7', '{terms_unknown}', 'manual:80') RETURNING terms, due_at, exception_flags`,
      [projectId],
    );
    assert.deepEqual([raw.terms, raw.due_at, raw.exception_flags], ["Due on receipt", null, []]);
    const [sent] = await run(`UPDATE invoices SET status = 'sent', sent_at = now() WHERE number = 'INV-080' AND project_id = $1 RETURNING (due_at)::text AS due_at`, [projectId]);
    assert.ok(sent.due_at, "sending sets the due date");

    // collision report: manual invoices without keys + shared labels/amounts
    await run(`INSERT INTO invoices (project_id, number, milestone, amount, status) VALUES ($1, 'INV-090', 'Deposit', 100, 'sent'), ($1, 'INV-091', 'deposit ', 100, 'draft')`, [projectId]);
    const before = await run(`SELECT count(*)::int AS n, sum(amount)::int AS s FROM invoices`);
    const report = await invoiceCollisionReport(run);
    assert.equal(report.noEconomicKey.length, 2);
    assert.equal(report.sharedMilestoneLabels.filter((g) => g.projectSlug === "zz-bill-c").length, 1, "'Deposit' shared across 3 rows (case/space-insensitive)");
    assert.equal(report.sharedMilestoneLabels.find((g) => g.projectSlug === "zz-bill-c").invoiceIds.length, 3);
    assert.equal(report.sharedAmounts.filter((g) => g.projectSlug === "zz-bill-c" && g.amountCents === 100).length, 1);
    const after = await run(`SELECT count(*)::int AS n, sum(amount)::int AS s FROM invoices`);
    assert.deepEqual(after, before, "report wrote nothing");
  });
});

test("V38 acceptance: owner approval alone issues nothing; client acceptance issues once even on repeated events; policy off stages a decision; changed terms refused; contract links without rebilling", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-d");
    const tx = txOver(url);
    const run = runOn(client);
    const estimateId = await seedEstimate(client, projectId, {
      total: 4000000,
      status: "approved",
      schedule: [
        { label: "Deposit (on signing)", percent: 25, triggerStatus: "construction_contract" },
        { label: "Rough-in complete", percent: 50, triggerStatus: "construction" },
        { label: "Final", percent: 25, triggerStatus: "warranty" },
      ],
    });
    // Owner approved the estimate (status 'approved') but the client has not signed.
    const sigId = await signature(client, { projectId, docType: "estimate", estimateId, status: "sent" });
    let out = await onSignatureSigned(tx, sigId, agent);
    assert.equal(out.initial, undefined, "unsigned request: nothing runs");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 0, "owner approval ≠ client acceptance");

    // Policy not active → a decision is staged, still no invoice.
    await sign(client, sigId);
    out = await onSignatureSigned(tx, sigId, agent);
    assert.equal(out.initial.issued, false);
    assert.equal(out.initial.code, "policy_inactive");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 0);
    const staged = await run(`SELECT id, status, amount_cents::int AS amount FROM decisions WHERE dedupe_key = $1`, [`estimate:${estimateId}:initial`]);
    assert.equal(staged.length, 1);
    assert.equal(staged[0].amount, 1000000);
    // Repeated signature event while pending: same decision, no duplicate card.
    out = await onSignatureSigned(tx, sigId, agent);
    assert.equal(out.initial.decisionId, staged[0].id);

    // Joe approves the card → issue with the decision.
    const res = await tx((r) => resolveDecision(r, { id: staged[0].id, outcome: "approved", principal: owner, via: "app" }));
    assert.equal(res.ok, true);
    const viaDecision = await issueInitialOnAcceptance(tx, { signatureRequestId: sigId, principal: owner, decisionId: staged[0].id, mail });
    assert.equal(viaDecision.issued, true);
    assert.equal(viaDecision.created, true);
    const inv = (await run(`SELECT i.*, i.id::int AS id FROM invoices i WHERE id = $1`, [viaDecision.invoiceId]))[0];
    assert.equal(inv.economic_key, `estimate:${estimateId}:initial`);
    assert.equal(inv.amount, 1000000);
    assert.equal(inv.status, "issued");
    assert.equal(inv.source, "acceptance");
    assert.equal(inv.delivery_state, "queued");
    const intents = await run(`SELECT id, operation_key, kind, state, payload, recipient, decision_id, policy_ref FROM action_intents`);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].id, viaDecision.intentId);
    assert.equal(intents[0].operation_key, `invoice:${inv.id}:send:rev1`);
    assert.equal(intents[0].kind, "send_invoice");
    assert.equal(intents[0].payload.to, "zz-client-zz-bill-d@example.test");
    assert.equal(intents[0].recipient, "zz-client-zz-bill-d@example.test");
    // Joe's approval was spent issuing the invoice; the send carries it as his word.
    assert.equal(intents[0].decision_id, null);
    assert.equal(intents[0].policy_ref, `owner:decision:${staged[0].id}`);
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [staged[0].id]))[0].status, "consumed");
    resetFakeOutbox();
    const [sent] = await dispatchOnce(dispatchDeps(url, client), { intentIds: [viaDecision.intentId] });
    assert.equal(sent.responseClass, "accepted", JSON.stringify(sent));
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "sent", "the decision path's send is not refused at dispatch");

    // Repeated signature events with the policy now active: replay, nothing new.
    await tx(async (r) => activatePolicy(r, POLICY_INITIAL, (await proposePolicyVersion(r, POLICY_INITIAL, { note: "test" }, "test")).version));
    for (let i = 0; i < 3; i++) out = await onSignatureSigned(tx, sigId, agent, mail);
    assert.equal(out.initial.issued, true);
    assert.equal(out.initial.invoiceId, inv.id);
    assert.equal(out.initial.intentId, viaDecision.intentId);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 1, "one send intent");
    const sched = (await run(`SELECT draw_schedule FROM estimates WHERE id = $1`, [estimateId]))[0].draw_schedule;
    assert.equal(sched[0].billed, true, "draw hint marked");

    // The draw path for index 0 finds the acceptance invoice — never double-bills the deposit.
    const prog0 = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: 0, principal: owner });
    assert.equal(prog0.issued, true);
    assert.equal(prog0.invoiceId, inv.id);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 1);

    // Changed terms: lines edited after the offer was sent → refused.
    await run(`INSERT INTO estimate_lines (estimate_id, description, qty, unit_cost, extended, created_at) VALUES ($1, 'Added', 1, 100, 100, now())`, [estimateId]);
    const sig2 = await signature(client, { projectId, docType: "estimate", estimateId, status: "signed" });
    const changed = await issueInitialOnAcceptance(tx, { signatureRequestId: sig2, principal: agent });
    assert.equal(changed.issued, false);
    assert.equal(changed.code, "changed");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 1);

    // A precon_change estimate acceptance is not the formal acceptance.
    const pc = await run(`INSERT INTO estimates (project_id, title, kind, status, total) VALUES ($1, 'Add', 'precon_change', 'sent', 500) RETURNING id`, [projectId]);
    const pcSig = await signature(client, { projectId, docType: "estimate", estimateId: Number(pc[0].id), status: "signed" });
    const pcOut = await issueInitialOnAcceptance(tx, { signatureRequestId: pcSig, principal: agent });
    assert.equal(pcOut.issued, false);
    assert.equal(pcOut.code, "not_acceptance");

    // Later signed construction contract links to the same invoice; no rebilling.
    const contractSig = await signature(client, { projectId, docType: "contract", estimateId, status: "signed" });
    out = await onSignatureSigned(tx, contractSig, agent);
    assert.deepEqual(out.contract.linked, [inv.id]);
    assert.equal(Number((await run(`SELECT contract_signature_request_id FROM invoices WHERE id = $1`, [inv.id]))[0].contract_signature_request_id), contractSig);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 1);

    // W10: progress draw needs owner confirmation; an unattended agent cannot; a resolved decision can, once.
    const unauth = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: "rough-in-complete", principal: agent });
    assert.equal(unauth.issued, false);
    assert.equal(unauth.code, "unauthorized");
    const card = await tx((r) => stageMilestoneConfirmation(r, { projectId, milestoneKey: 1, principal: agent, evidence: { photos: 3 } }));
    assert.equal(card.decision.kind, "milestone_confirmation");
    const notYet = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: 1, principal: agent, decisionId: card.decision.id });
    assert.equal(notYet.issued, false, "pending decision is not confirmation");
    await tx((r) => resolveDecision(r, { id: card.decision.id, outcome: "approved", principal: owner, via: "telegram" }));
    const prog = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: 1, principal: agent, decisionId: card.decision.id, mail });
    assert.equal(prog.issued, true);
    assert.equal(prog.created, true);
    assert.ok(prog.intentId, "the progress draw is queued to the client too");
    const progRow = (await run(`SELECT economic_key, amount, source FROM invoices WHERE id = $1`, [prog.invoiceId]))[0];
    assert.equal(progRow.economic_key, drawEconomicKey(1, "Rough-in complete"));
    assert.equal(progRow.amount, 2000000);
    assert.equal(progRow.source, "progress");
    const again = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: "draw:1:rough-in-complete", principal: owner, mail });
    assert.equal(again.replayed, true);
    assert.equal(again.intentId, prog.intentId);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 2);
    await tx((r) => disablePolicy(r, POLICY_INITIAL));
  });
});

test("V44 sign-off: final invoice = verified remainder with CO balances/payments/credits applied once; duplicate sign-off no duplicate; uncertain → exception", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-e");
    const tx = txOver(url);
    const run = runOn(client);
    await run(`UPDATE projects SET price_cents = 10000000, status = 'closeout' WHERE id = $1`, [projectId]);
    await run(`INSERT INTO signature_requests (project_id, doc_type, title, status, signed_at) VALUES ($1, 'contract', 'c', 'signed', now())`, [projectId]);
    await run(`INSERT INTO change_orders (project_id, title, price_cents, status) VALUES ($1, 'Extra', 1000000, 'approved'), ($1, 'Declined', 999999, 'declined')`, [projectId]);
    const a = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:0:deposit", milestone: "Deposit", amountCents: 2500000, source: "draw", principal: owner }));
    const b = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:1:rough", milestone: "Rough", amountCents: 3500000, source: "draw", principal: owner }));
    await tx((r) => recordInvoicePayment(r, { invoiceId: a.invoice.id, kind: "payment", amountCents: 2500000, method: "check", principal: owner }));
    await tx((r) => recordInvoicePayment(r, { invoiceId: b.invoice.id, kind: "payment", amountCents: 3000000, method: "check", principal: owner }));
    await tx((r) => creditInvoice(r, { invoiceId: b.invoice.id, amountCents: 500000, reason: "goodwill", principal: owner }));
    await tx(async (r) => activatePolicy(r, POLICY_FINAL, (await proposePolicyVersion(r, POLICY_FINAL, {}, "test")).version));

    // A pending card payment makes reconciliation uncertain → exception decision, no invoice.
    await tx((r) => recordInvoicePayment(r, { invoiceId: b.invoice.id, kind: "payment", amountCents: 100, method: "card", provider: "square", providerRef: "p_pending", status: "pending", principal: agent }));
    const signoff = await signature(client, { projectId, docType: "completion", status: "signed" });
    let out = await issueFinalOnClientSignoff(tx, { signatureRequestId: signoff, principal: agent });
    assert.equal(out.issued, false, JSON.stringify(out));
    assert.equal(out.code, "uncertain");
    assert.equal((await run(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'billing_exception' AND action = 'final_invoice_review'`))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]))[0].n, 2);
    await tx((r) => recordInvoicePayment(r, { invoiceId: b.invoice.id, kind: "payment", amountCents: 100, method: "card", provider: "square", providerRef: "p_pending", status: "failed", principal: agent }));

    // Clean: 100,000.00 + 10,000.00 − (25,000.00 + 35,000.00) = 50,000.00
    out = await onSignatureSigned(tx, signoff, agent, mail);
    assert.equal(out.final.issued, true, JSON.stringify(out.final));
    assert.equal(out.final.created, true);
    const fin = (await run(`SELECT i.*, i.id::int AS id FROM invoices i WHERE id = $1`, [out.final.invoiceId]))[0];
    assert.equal(fin.amount, 5000000, "remainder counts approved COs once and previously issued invoices once; payments/credits sit on their own invoices");
    assert.equal(fin.economic_key, `project:${projectId}:final`);
    assert.equal(fin.source, "final");
    assert.equal(fin.line_items[0].label, "Final balance — contract $100,000.00 + change orders $10,000.00 − previously invoiced $60,000.00", "the client's line reads in dollars");
    const dup = await onSignatureSigned(tx, signoff, agent, mail);
    assert.equal(dup.final.issued, true);
    assert.equal(dup.final.invoiceId, fin.id);
    assert.equal(dup.final.replayed, true);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]))[0].n, 3);
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents WHERE kind = 'send_invoice'`))[0].n, 1);
    // project-level truth: balances are per invoice, the final does not re-bill the open 500 on b
    const vb = await verifiedBalances(run, { projectId, onlyOpen: true });
    assert.deepEqual(vb.map((r) => r.balanceCents).sort((x, y) => x - y), [5000000], "b was fully settled by payment + credit; only the final is open");
    // second sign-off document (re-signed) → same identity, nothing new
    const signoff2 = await signature(client, { projectId, docType: "completion", status: "signed" });
    const again = await issueFinalOnClientSignoff(tx, { signatureRequestId: signoff2, principal: agent, mail });
    assert.equal(again.issued, true);
    assert.equal(again.invoiceId, fin.id);
  });
});

test("Approving a first-draw invoice card creates the invoice (draft, to email); changed totals refuse; signing on stale lines stages the card", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-card");
    const tx = txOver(url);
    const run = runOn(client);
    const estimateId = await seedEstimate(client, projectId, { total: 4000000, status: "approved" });
    // The client signed, then a line was added: the hook cannot issue on its own.
    const sigId = await signature(client, { projectId, docType: "estimate", estimateId, status: "signed" });
    await run(`INSERT INTO estimate_lines (estimate_id, description, qty, unit_cost, extended, created_at) VALUES ($1, 'Credit', 1, 0, 0, now())`, [estimateId]);
    const out = await onSignatureSigned(tx, sigId, agent);
    assert.equal(out.initial.issued, false);
    assert.equal(out.initial.code, "changed");
    assert.ok(out.initial.decisionId, "a changed acceptance stages Joe's card instead of dropping it");
    const [card] = await run(`SELECT id, kind, action, amount_cents::int AS amount, recipient, summary FROM decisions WHERE id = $1`, [out.initial.decisionId]);
    assert.equal(card.action, "invoice.issue_initial");
    assert.equal(card.amount, 2000000, "50% default first draw");
    assert.equal(card.recipient, "zz-client-zz-bill-card@example.test");
    assert.ok(card.summary.gaps.some((g) => /changed after/.test(g)));

    // An agent staging the same card finds it (same dedupe key + content).
    const again = await tx((r) => stageInitialInvoiceDecision(r, { projectId, principal: agent }));
    assert.equal(again.ok, true);
    assert.equal(again.decisionId, card.id);

    // Joe approves → the invoice exists, as a draft for the email step.
    const r1 = await tx((r) => resolveFromChannel(r, { decisionId: card.id, via: "telegram", principal: owner, outcome: "approved" }));
    assert.equal(r1.ok, true);
    assert.equal(r1.invoice.issued, true);
    assert.equal(r1.invoice.created, true);
    assert.equal(r1.invoice.status, "draft");
    assert.match(r1.reply, /Invoice .* created/);
    const [inv] = await run(`SELECT amount::int AS amount, status, source, economic_key FROM invoices WHERE id = $1`, [r1.invoice.invoiceId]);
    assert.deepEqual(inv, { amount: 2000000, status: "draft", source: "acceptance", economic_key: `estimate:${estimateId}:initial` });
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [card.id]))[0].status, "consumed");
    const r2 = await tx((r) => resolveFromChannel(r, { decisionId: card.id, via: "app", principal: owner, outcome: "approved" }));
    assert.equal(r2.ok, false, "a second tap changes nothing");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices`))[0].n, 1);
    const dup = await tx((r) => stageInitialInvoiceDecision(r, { projectId, principal: agent }));
    assert.equal(dup.ok, false, "no second card once the invoice exists");

    // Total changed between the card and the tap → refused, approval stands, nothing issued.
    const p2 = await seed(client, "zz-bill-card2");
    const e2 = await seedEstimate(client, p2, { total: 1000000, status: "approved" });
    const st = await tx((r) => stageInitialInvoiceDecision(r, { projectId: p2, principal: agent }));
    assert.equal(st.ok, true);
    await run(`UPDATE estimates SET total = 1200000 WHERE id = $1`, [e2]);
    const r3 = await tx((r) => resolveFromChannel(r, { decisionId: st.decisionId, via: "app", principal: owner, outcome: "approved" }));
    assert.equal(r3.ok, true);
    assert.equal(r3.invoice.issued, false);
    assert.match(r3.reply, /No invoice was created: The first draw is now \$6,000\.00/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [p2]))[0].n, 0);
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [st.decisionId]))[0].status, "approved");

    // A draft formal estimate (never sent from the app) still stages the card, flagged.
    // Spaeth, 2026-10-28: the refusal left Joe no way to bill the deposit.
    const p3 = await seed(client, "zz-bill-card3");
    const e3 = await seedEstimate(client, p3, { total: 2000000, status: "draft" });
    const st3 = await tx((r) => stageInitialInvoiceDecision(r, { projectId: p3, principal: agent }));
    assert.equal(st3.ok, true);
    assert.equal(st3.amountCents, 1000000);
    const [card3] = await run(`SELECT target_id, summary FROM decisions WHERE id = $1`, [st3.decisionId]);
    assert.equal(String(card3.target_id), String(e3));
    assert.ok(card3.summary.gaps.some((g) => /never sent to the client/.test(g)));
    const r4 = await tx((r) => resolveFromChannel(r, { decisionId: st3.decisionId, via: "app", principal: owner, outcome: "approved" }));
    assert.equal(r4.invoice.issued, true);
  });
});

test("Approving a progress/final draw card creates that draw's invoice (draft, to email); final remainder ignores a pre-contract design fee", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-draw");
    const tx = txOver(url);
    const run = runOn(client);
    const schedule = [{ label: "Deposit", percent: 50 }, { label: "Cabinets", percent: 40 }, { label: "Upon completion", percent: 10 }];
    const estimateId = await seedEstimate(client, projectId, { total: 2829564, status: "approved", schedule });
    await run(`UPDATE estimates SET approved_at = now() - interval '30 minutes' WHERE id = $1`, [estimateId]);
    // A design fee billed before the estimate was approved, then the two contract draws (hand-entered, no keys).
    await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, source, sent_at, paid_at) VALUES ($1, 'ZZ-D', 'Design fee', 150000, 'paid', 'manual', now() - interval '2 days', now() - interval '2 days')`, [projectId]);
    await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, source, sent_at, paid_at) VALUES ($1, 'ZZ-1', 'Deposit', 1414782, 'paid', 'manual', now(), now()), ($1, 'ZZ-2', 'Cabinets', 1131826, 'paid', 'manual', now(), now())`, [projectId]);
    const rec = await tx((r) => finalReconciliation(r, projectId));
    assert.equal(rec.remainderCents, 282956, "the design fee doesn't come off the contract");

    const card = await tx((r) => stageMilestoneConfirmation(r, { projectId, milestoneKey: 2, principal: agent }));
    const r1 = await tx((r) => resolveFromChannel(r, { decisionId: card.decision.id, via: "app", principal: owner, outcome: "approved" }));
    assert.equal(r1.ok, true);
    assert.equal(r1.invoice.issued, true);
    assert.equal(r1.invoice.status, "draft");
    assert.match(r1.reply, /Invoice .* created/);
    const [inv] = await run(`SELECT amount::int AS amount, status, source, economic_key FROM invoices WHERE id = $1`, [r1.invoice.invoiceId]);
    assert.deepEqual(inv, { amount: 282956, status: "draft", source: "progress", economic_key: "draw:2:upon-completion" });
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [card.decision.id]))[0].status, "consumed");
    const r2 = await tx((r) => resolveFromChannel(r, { decisionId: card.decision.id, via: "telegram", principal: owner, outcome: "approved" }));
    assert.equal(r2.ok, false, "a second tap changes nothing");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE economic_key = 'draw:2:upon-completion'`))[0].n, 1);
  });
});

test("An invoice billing issues on its own is emailed: the Send button's payload, delivered by the dispatcher, marked sent", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-send");
    const tx = txOver(url);
    const run = runOn(client);
    resetFakeOutbox();
    // The harness keeps the database between runs; notifications aren't foundation tables.
    await run(`DELETE FROM notifications WHERE title LIKE '%· zz-bill-%'`);
    const schedule = [{ label: "Deposit", percent: 50 }, { label: "Cabinets", percent: 40 }, { label: "Upon completion", percent: 10 }];
    const estimateId = await seedEstimate(client, projectId, { total: 4000000, status: "approved", schedule });
    await tx(async (r) => activatePolicy(r, POLICY_INITIAL, (await proposePolicyVersion(r, POLICY_INITIAL, {}, "test")).version));
    const sigId = await signature(client, { projectId, docType: "estimate", estimateId, status: "signed" });

    const out = await onSignatureSigned(tx, sigId, agent, mail);
    assert.equal(out.initial.issued, true, JSON.stringify(out.initial));
    assert.ok(out.initial.intentId);
    const [intent] = await run(`SELECT id, operation_key, recipient, policy_ref, decision_id, state, payload FROM action_intents WHERE id = $1`, [out.initial.intentId]);
    assert.equal(intent.operation_key, `invoice:${out.initial.invoiceId}:send:rev1`, "the operation key is unchanged");
    assert.match(intent.policy_ref, /^policy:invoice\.initial_on_acceptance@\d+$/);
    const pl = intent.payload;
    assert.equal(pl.to, "zz-client-zz-bill-send@example.test");
    assert.equal(intent.recipient, pl.to);
    assert.equal(pl.subject, "Invoice INV-001 — zz-bill-send (Deposit)");
    assert.match(pl.bodyText, /^Hi ZZ,/);
    assert.match(pl.bodyText, /invoice INV-001 for "Deposit" on the zz-bill-send project attached/);
    assert.match(pl.bodyText, /Total due: \$20,000\.00/);
    assert.ok(pl.bodyText.includes(`https://os.example.test/client-portal/pay/${out.initial.invoiceId}`), "pay link");
    assert.ok(pl.bodyText.includes("a 3% surcharge"), "card surcharge notice");
    assert.deepEqual(pl.attachments, [{ filename: "Invoice INV-001.pdf", mimeType: "application/pdf", fileId: `zz-pdf-${out.initial.invoiceId}` }]);
    assert.deepEqual(pl._auth, { action: "send_invoice", target_kind: "invoice", target_id: String(out.initial.invoiceId), amount_cents: 2000000 });
    // The same builder sendInvoiceOp stages (lib/send-ops.ts): one email, two paths.
    const built = invoiceEmailPayload(await loadInvoiceEmail(run, out.initial.invoiceId), await mail.extras({ id: out.initial.invoiceId, number: "INV-001" }));
    assert.deepEqual(JSON.parse(JSON.stringify(built)), pl);

    // A repeated signature event finds the queued send; nothing is staged twice.
    const replay = await onSignatureSigned(tx, sigId, agent, mail);
    assert.equal(replay.initial.intentId, intent.id);
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 1);

    // The dispatcher delivers it (fake email provider) and the issued invoice reads sent.
    const [o] = await dispatchOnce(dispatchDeps(url, client), { intentIds: [intent.id] });
    assert.equal(o.responseClass, "accepted", JSON.stringify(o));
    const outbox = fakeOutbox.filter((f) => f.operationKey === intent.operation_key);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].payload.to, "zz-client-zz-bill-send@example.test");
    const [inv] = await run(`SELECT status, delivery_state, delivery_error, sent_at FROM invoices WHERE id = $1`, [out.initial.invoiceId]);
    assert.equal(inv.status, "sent", "an issued invoice is marked sent once the email is accepted");
    assert.equal(inv.delivery_state, "delivered");
    assert.ok(inv.sent_at);
    assert.equal((await run(`SELECT count(*)::int AS n FROM notifications WHERE title = 'Invoice INV-001 sent · zz-bill-send'`))[0].n, 1);

    // A send that fails for good: the invoice reads not sent and Joe is told which, where and why.
    const prog = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: 1, principal: owner, mail });
    assert.equal(prog.issued, true);
    assert.equal((await run(`SELECT policy_ref FROM action_intents WHERE id = $1`, [prog.intentId]))[0].policy_ref, "owner");
    setFakeOutcome(() => ({ responseClass: "permanent", error: "550 5.1.1 mailbox unavailable", transmitted: false }));
    const [f] = await dispatchOnce(dispatchDeps(url, client), { intentIds: [prog.intentId] });
    setFakeOutcome(null);
    assert.equal(f.state, "permanent_failure");
    const [bad] = await run(`SELECT number, status, delivery_state, delivery_error, sent_at FROM invoices WHERE id = $1`, [prog.invoiceId]);
    assert.deepEqual([bad.number, bad.status, bad.delivery_state, bad.sent_at], ["INV-002", "issued", "failed", null]);
    assert.match(bad.delivery_error, /mailbox unavailable/);
    const [bell] = await run(`SELECT subline, flagged, href FROM notifications WHERE title = 'Invoice INV-002 was not emailed · zz-bill-send'`);
    assert.ok(bell, "Joe gets a bell naming the invoice and the job");
    assert.match(bell.subline, /mailbox unavailable/);
    assert.equal(bell.flagged, true);
    assert.equal(bell.href, "/projects/zz-bill-send");
    assert.equal(invoiceSendBlock(await loadInvoiceEmail(run, prog.invoiceId)), null, "a failed issued invoice can still be sent by hand");
    assert.match(invoiceSendBlock(await loadInvoiceEmail(run, out.initial.invoiceId)), /already sent/);

    // No client email: nothing doomed is queued; the invoice reads not sent and Joe is told.
    const [p2] = await run(`INSERT INTO projects (slug, name, status, client_name, contract_value) VALUES ('zz-bill-noemail', 'zz-bill-noemail', 'construction_contract', 'No Email', 10000) RETURNING id`);
    const e2 = await seedEstimate(client, p2.id, { total: 1000000, status: "approved" });
    const sig2 = await signature(client, { projectId: p2.id, docType: "estimate", estimateId: e2, status: "signed" });
    const noEmail = await onSignatureSigned(tx, sig2, agent, mail);
    assert.equal(noEmail.initial.issued, true);
    assert.equal(noEmail.initial.intentId, null);
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents WHERE target_id = $1`, [String(noEmail.initial.invoiceId)]))[0].n, 0, "no doomed intent");
    const [ne] = await run(`SELECT status, delivery_state, delivery_error FROM invoices WHERE id = $1`, [noEmail.initial.invoiceId]);
    assert.deepEqual([ne.status, ne.delivery_state], ["issued", "failed"]);
    assert.match(ne.delivery_error, /No client email on file/);
    const [bell2] = await run(`SELECT subline FROM notifications WHERE title = 'Invoice INV-001 was not emailed · zz-bill-noemail'`);
    assert.match(bell2.subline, /No client email on file/);

    // An address that opted out is not queued either.
    await run(`UPDATE projects SET client_email = 'Optout@Example.test' WHERE id = $1`, [p2.id]);
    await run(`INSERT INTO communication_optouts (channel, address, reason) VALUES ('email', 'optout@example.test', 'zz unsubscribed') ON CONFLICT (channel, address) DO UPDATE SET revoked_at = NULL`);
    assert.equal((await onSignatureSigned(tx, sig2, agent, mail)).initial.intentId, null);
    assert.match((await run(`SELECT delivery_error FROM invoices WHERE id = $1`, [noEmail.initial.invoiceId]))[0].delivery_error, /opted out of email \(zz unsubscribed\)/);
    // Once there is an address to send to, the next signature event queues it.
    await run(`UPDATE projects SET client_email = 'zz-later@example.test' WHERE id = $1`, [p2.id]);
    const later = await onSignatureSigned(tx, sig2, agent, mail);
    assert.ok(later.initial.intentId);
    assert.equal((await run(`SELECT payload->>'to' AS to FROM action_intents WHERE id = $1`, [later.initial.intentId]))[0].to, "zz-later@example.test");
    assert.deepEqual((await run(`SELECT delivery_state, delivery_error FROM invoices WHERE id = $1`, [noEmail.initial.invoiceId]))[0], { delivery_state: "queued", delivery_error: null });
    await run(`DELETE FROM communication_optouts WHERE address = 'optout@example.test'`);
  });
});

test("Final invoice on sign-off: an open punch item stages Joe's card naming it instead of issuing; none open still issues", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-punch");
    const tx = txOver(url);
    const run = runOn(client);
    await run(`UPDATE projects SET price_cents = 3000000, status = 'closeout' WHERE id = $1`, [projectId]);
    await tx(async (r) => activatePolicy(r, POLICY_FINAL, (await proposePolicyVersion(r, POLICY_FINAL, {}, "test")).version));
    const [punch] = await run(`INSERT INTO project_punch (project_id, item) VALUES ($1, 'Touch up hall paint'), ($1, 'Done already') RETURNING id`, [projectId]);
    await run(`UPDATE project_punch SET done = true WHERE project_id = $1 AND item = 'Done already'`, [projectId]);
    await tx((r) => recordClientPunch(r, { projectId, items: [{ label: "Adjust closet door", key: "client:door" }] }));
    const signoff = await signature(client, { projectId, docType: "completion", status: "signed" });

    const held = await onSignatureSigned(tx, signoff, agent, mail);
    assert.equal(held.final.issued, false, JSON.stringify(held.final));
    assert.equal(held.final.code, "open_punch");
    assert.match(held.final.reason, /Touch up hall paint; Adjust closet door/);
    const [card] = await run(`SELECT kind, action, status, amount_cents::int AS amount, title, summary FROM decisions WHERE id = $1`, [held.final.decisionId]);
    assert.deepEqual([card.kind, card.action, card.status, card.amount], ["invoice_issue", "invoice.issue_final", "pending", 3000000], "the no-policy card, for Joe");
    assert.deepEqual(card.summary.gaps, ["Open punch item: Touch up hall paint", "Open punch item: Adjust closet door"]);
    assert.match(card.title, /2 punch items still open/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]))[0].n, 0, "no final invoice");
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 0, "nothing queued to the client");

    // Joe's tap on that card is not a dead end: approved → the final invoice is issued and queued under his decision.
    assert.equal(await tx((r) => issueFinalFromDecision(r, { decisionId: held.final.decisionId, principal: owner, mail })).then((o) => o.issued), false, "pending card issues nothing");
    await tx((r) => resolveDecision(r, { id: held.final.decisionId, outcome: "approved", principal: owner, via: "telegram" }));
    const tapped = await tx((r) => issueFinalFromDecision(r, { decisionId: held.final.decisionId, principal: owner, mail }));
    assert.equal(tapped.issued, true, JSON.stringify(tapped));
    const [queued] = await run(`SELECT payload->>'to' AS to, policy_ref FROM action_intents WHERE target_id = $1`, [String(tapped.invoiceId)]);
    assert.ok(queued?.to, "queued to the client");
    assert.match(queued.policy_ref, new RegExp(`decision:${held.final.decisionId}$`), "under Joe's decision, not the policy");
    await run(`DELETE FROM action_intents`);
    await run(`DELETE FROM invoices WHERE project_id = $1`, [projectId]);
    await run(`DELETE FROM commands WHERE name = 'invoice.issue_final_on_client_signoff'`);

    // Punch closed out → the same sign-off issues and queues the final invoice on the policy.
    await run(`UPDATE project_punch SET done = true WHERE id = $1`, [punch.id]);
    await tx((r) => resolveClientPunch(r, { projectId, itemKey: "client:door", by: "Joe" }));
    const fin = await onSignatureSigned(tx, signoff, agent, mail);
    assert.equal(fin.final.issued, true, JSON.stringify(fin.final));
    assert.ok(fin.final.intentId);
    assert.match((await run(`SELECT policy_ref FROM action_intents WHERE id = $1`, [fin.final.intentId]))[0].policy_ref, /^policy:invoice\.final_on_client_signoff@/);
  });
});

test("the final-invoice policy key in code is the one the migration seeds", async () => {
  const { readFileSync } = await import("node:fs");
  const { POLICY_FINAL, POLICY_INITIAL } = await import("../lib/billing/commands.ts");
  const seed = readFileSync(new URL("../db/migrations/0004_decision_surfaces.sql", import.meta.url), "utf8");
  for (const key of [POLICY_FINAL, POLICY_INITIAL]) assert.ok(seed.includes(`'${key}'`), `${key} is seeded`);
});
