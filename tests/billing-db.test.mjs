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
  onSignatureSigned,
  stageMilestoneConfirmation,
  POLICY_INITIAL,
  POLICY_FINAL,
} from "../lib/billing/commands.ts";
import { proposePolicyVersion, activatePolicy, disablePolicy } from "../lib/commands/policies.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";

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
    assert.equal(replay.invoice.due_at != null, true, "Net 30 company default → due date");
    assert.equal(replay.invoice.terms, "Net 30");

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

test("V10 terms: unknown terms → due_at NULL + terms_unknown exception, never a guessed Net 7; collision report is read-only", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-bill-c");
    const tx = txOver(url);
    const run = runOn(client);
    await run(`UPDATE app_settings SET value = 'Per the signed agreement' WHERE key = 'contract.terms'`);
    const { invoice } = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:0:deposit", milestone: "Deposit", amountCents: 5000, source: "draw", principal: owner }));
    assert.equal(invoice.due_at, null);
    assert.deepEqual(invoice.exception_flags, ["terms_unknown"]);
    const d = await run(`SELECT kind, action, status FROM decisions WHERE dedupe_key = $1`, [`invoice:${invoice.id}:terms`]);
    assert.equal(d.length, 1);
    assert.equal(d[0].action, "set_invoice_terms");
    await run(`UPDATE invoices SET delivery_state = 'delivered' WHERE id = $1`, [invoice.id]);
    assert.equal((await routineReminderCandidates(run)).length, 0, "unknown terms never start reminders");
    await assert.rejects(tx((r) => setInvoiceTerms(r, { invoiceId: invoice.id, terms: "whenever", principal: owner })), /does not read/);
    const fixed = await tx((r) => setInvoiceTerms(r, { invoiceId: invoice.id, terms: "Net 15", principal: owner }));
    assert.equal(fixed.exception_flags.length, 0);
    assert.ok(fixed.due_at);
    // explicit terms on the input win over the company default
    const e2 = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:1:x", milestone: "X", amountCents: 100, source: "draw", terms: "Due on receipt", principal: owner }));
    assert.equal(e2.invoice.terms, "Due on receipt");
    assert.equal(e2.invoice.due_at, (await run(`SELECT CURRENT_DATE::text AS d`))[0].d);

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
    const viaDecision = await issueInitialOnAcceptance(tx, { signatureRequestId: sigId, principal: owner, decisionId: staged[0].id });
    assert.equal(viaDecision.issued, true);
    assert.equal(viaDecision.created, true);
    const inv = (await run(`SELECT i.*, i.id::int AS id FROM invoices i WHERE id = $1`, [viaDecision.invoiceId]))[0];
    assert.equal(inv.economic_key, `estimate:${estimateId}:initial`);
    assert.equal(inv.amount, 1000000);
    assert.equal(inv.status, "issued");
    assert.equal(inv.source, "acceptance");
    assert.equal(inv.delivery_state, "queued");
    const intents = await run(`SELECT operation_key, kind, state, payload FROM action_intents`);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].operation_key, `invoice:${inv.id}:send:rev1`);
    assert.equal(intents[0].kind, "send_invoice");
    assert.deepEqual(intents[0].payload, { invoiceId: inv.id });
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [staged[0].id]))[0].status, "consumed");

    // Repeated signature events with the policy now active: replay, nothing new.
    await tx(async (r) => activatePolicy(r, POLICY_INITIAL, (await proposePolicyVersion(r, POLICY_INITIAL, { note: "test" }, "test")).version));
    for (let i = 0; i < 3; i++) out = await onSignatureSigned(tx, sigId, agent);
    assert.equal(out.initial.issued, true);
    assert.equal(out.initial.invoiceId, inv.id);
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
    const prog = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: 1, principal: agent, decisionId: card.decision.id });
    assert.equal(prog.issued, true);
    assert.equal(prog.created, true);
    const progRow = (await run(`SELECT economic_key, amount, source FROM invoices WHERE id = $1`, [prog.invoiceId]))[0];
    assert.equal(progRow.economic_key, drawEconomicKey(1, "Rough-in complete"));
    assert.equal(progRow.amount, 2000000);
    assert.equal(progRow.source, "progress");
    const again = await issueProgressOnOwnerConfirmation(tx, { projectId, milestoneKey: "draw:1:rough-in-complete", principal: owner });
    assert.equal(again.replayed, true);
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
    out = await onSignatureSigned(tx, signoff, agent);
    assert.equal(out.final.issued, true, JSON.stringify(out.final));
    assert.equal(out.final.created, true);
    const fin = (await run(`SELECT i.*, i.id::int AS id FROM invoices i WHERE id = $1`, [out.final.invoiceId]))[0];
    assert.equal(fin.amount, 5000000, "remainder counts approved COs once and previously issued invoices once; payments/credits sit on their own invoices");
    assert.equal(fin.economic_key, `project:${projectId}:final`);
    assert.equal(fin.source, "final");
    const dup = await onSignatureSigned(tx, signoff, agent);
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
    const again = await issueFinalOnClientSignoff(tx, { signatureRequestId: signoff2, principal: agent });
    assert.equal(again.issued, true);
    assert.equal(again.invoiceId, fin.id);
  });
});
