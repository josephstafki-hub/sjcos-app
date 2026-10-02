import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { issueMilestoneInvoice, invoiceBalance, recordDeliveryOutcome } from "../lib/billing/core.ts";
import { routineReminderCandidates } from "../lib/billing/reminders.ts";
import {
  prepareAttempt,
  chargeAttempt,
  applyProviderPayment,
  markAttemptDeclined,
  markAttemptUnknown,
  processSquareEvent,
  reconcilePendingAttempts,
  stageRefundDecision,
  executeRefund,
  getAttempt,
} from "../lib/payments/service.ts";
import { fakeSquare, FAKE_NOTIFICATION_URL, FAKE_SIGNATURE_KEY } from "../lib/payments/square/fake.ts";
import { verifyWebhookSignature } from "../lib/payments/square/signature.ts";
import { getSquareAdapter } from "../lib/payments/square/index.ts";
import { recordSourceEvent } from "../lib/commands/source-events.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";

// V21 (customer payments) on a REAL disposable Postgres with the fake Square:
// repeat checkout, stale amount/link, missed + repeated webhooks, pending ACH
// is not paid, late failure/return restores the balance without a new
// invoice, refunds need a consumed decision.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
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

async function seed(client, slug) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE payment_attempts, refunds RESTART IDENTITY CASCADE`);
  fakeSquare.reset();
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  owner.userId = o.rows[0].id;
  const p = await client.query(`INSERT INTO projects (slug, name, status, client_name) VALUES ($1, $1, 'construction', 'ZZ') RETURNING id`, [slug]);
  await client.query(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ($2,'x','ZZ Client','client','Z',$1)`, [slug, `zz-client-${slug}@example.test`]);
  await client.query(`INSERT INTO app_settings (key, value) VALUES ('contract.terms', 'Net 30') ON CONFLICT (key) DO UPDATE SET value = 'Net 30'`);
  return p.rows[0].id;
}

async function issued(tx, projectId, key, amount) {
  const { invoice } = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: key, milestone: key, amountCents: amount, source: "draw", principal: owner }));
  await tx((r) => recordDeliveryOutcome(r, { invoiceId: invoice.id, ok: true, principal: owner }));
  return invoice;
}

/** The create route's core, without HTTP: prepare → charge → apply. */
async function checkout(tx, adapter, { invoiceId, method, nonce, sourceId, expectedAmountCents, expectedRevision }) {
  const prep = await tx((r) => prepareAttempt(r, { invoiceId, method, nonce, expectedAmountCents, expectedRevision, actor: "portal:client" }));
  if (!prep.ok) return prep;
  if (prep.reused && ["pending", "completed", "refunded"].includes(prep.attempt.state)) return { ok: true, reused: true, attempt: prep.attempt, charged: false };
  const outcome = await chargeAttempt(adapter, prep.attempt, { sourceId, locationId: "L1" });
  if (outcome.kind === "declined") return { ok: true, charged: true, attempt: await tx((r) => markAttemptDeclined(r, prep.attempt.id, outcome.code, outcome.reason)) };
  if (outcome.kind === "unknown") return { ok: true, charged: true, attempt: await tx((r) => markAttemptUnknown(r, prep.attempt.id, outcome.reason)) };
  const applied = await tx((r) => applyProviderPayment(r, { attemptId: prep.attempt.id, payment: outcome.payment, actor: "portal:client" }));
  return { ok: true, charged: true, reused: prep.reused, attempt: applied.attempt, payment: outcome.payment };
}

test("V21 card: repeat taps/refresh reuse one attempt; stale amount and stale revision fail; declined restores nothing because nothing moved", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-a");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    assert.equal(adapter.environment, "fake", "tests never touch the real Square");
    const inv = await issued(tx, projectId, "draw:0:deposit", 250000);

    const nonce = "tap-0001-abcdef";
    const first = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce, sourceId: "cnon:card-ok", expectedAmountCents: 250000, expectedRevision: 1 });
    assert.equal(first.attempt.state, "completed");
    assert.equal(first.attempt.amount_cents, 250000, "server-computed amount");
    // second tap / refresh with the same nonce: no second charge, same attempt
    const second = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce, sourceId: "cnon:card-ok", expectedAmountCents: 250000 });
    assert.equal(second.reused, true);
    assert.equal(second.charged, false);
    assert.equal(second.attempt.id, first.attempt.id);
    assert.equal((await run(`SELECT count(*)::int AS n FROM payment_attempts`))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv.id]))[0].n, 1);
    const b = await invoiceBalance(run, inv.id);
    assert.equal(b.balanceCents, 0);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "paid");
    // a brand-new nonce after it is paid: nothing due
    const again = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "tap-0002-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(again.ok, false);
    assert.equal(again.code, "nothing_due");

    // stale: the browser shows an old amount / an old revision
    const inv2 = await issued(tx, projectId, "draw:1:rough", 100000);
    const stale = await checkout(tx, adapter, { invoiceId: inv2.id, method: "card", nonce: "tap-0003-abcdef", sourceId: "cnon:card-ok", expectedAmountCents: 90000 });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "stale");
    const staleRev = await checkout(tx, adapter, { invoiceId: inv2.id, method: "card", nonce: "tap-0003-abcdef", sourceId: "cnon:card-ok", expectedAmountCents: 100000, expectedRevision: 9 });
    assert.equal(staleRev.code, "stale");
    assert.equal((await run(`SELECT count(*)::int AS n FROM payment_attempts WHERE invoice_id = $1`, [inv2.id]))[0].n, 0, "stale never creates an attempt");
    // declined card: attempt failed, no ledger row, balance untouched
    const declined = await checkout(tx, adapter, { invoiceId: inv2.id, method: "card", nonce: "tap-0004-abcdef", sourceId: "cnon:card-decline" });
    assert.equal(declined.attempt.state, "failed");
    assert.equal((await invoiceBalance(run, inv2.id)).balanceCents, 100000);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv2.id]))[0].n, 0);
    // a draft invoice is not payable
    const draft = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:2:x", milestone: "x", amountCents: 100, source: "draw", status: "draft", principal: owner }));
    const np = await checkout(tx, adapter, { invoiceId: draft.invoice.id, method: "card", nonce: "tap-0005-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(np.code, "not_payable");
  });
});

test("V21 ACH: pending is not paid and pauses reminders; missed webhook → reconcile; repeated/out-of-order webhooks are no-ops; late return restores the balance without a new invoice", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-b");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    const inv = await issued(tx, projectId, "draw:0:deposit", 400000);
    await run(`UPDATE invoices SET due_at = CURRENT_DATE - 2 WHERE id = $1`, [inv.id]);
    assert.equal((await routineReminderCandidates(run)).length, 1);

    const ach = await checkout(tx, adapter, { invoiceId: inv.id, method: "ach", nonce: "ach-0001-abcdef", sourceId: "bauth:ok" });
    assert.equal(ach.attempt.state, "pending");
    let b = await invoiceBalance(run, inv.id);
    assert.equal(b.balanceCents, 400000, "pending ACH is not cash");
    assert.equal(b.hasPending, true);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "sent", "not paid");
    assert.equal((await routineReminderCandidates(run)).length, 0, "reminders pause while genuinely pending");
    // a second checkout on the same invoice while in flight is refused
    const dup = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "ach-0002-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "in_flight");

    // Out-of-order: a COMPLETED webhook, then a stale PENDING replay, then the same COMPLETED again.
    fakeSquare.setStatus(ach.payment.id, "COMPLETED");
    const done = fakeSquare.webhookEvent("payment.updated", ach.payment.id);
    assert.equal(verifyWebhookSignature(done.body, done.signature, FAKE_NOTIFICATION_URL, FAKE_SIGNATURE_KEY), true);
    const persist = async (evt) => (await recordSourceEvent(run, { provider: "square", eventId: evt.eventId, eventType: "payment.updated", payload: JSON.parse(evt.body), verified: true })).event;
    const e1 = await persist(done);
    let r = await tx((x) => processSquareEvent(x, { payload: JSON.parse(done.body), sourceEventId: e1.id }));
    assert.equal(r.changed, true);
    assert.equal(r.handled, "payment:pending->completed");
    b = await invoiceBalance(run, inv.id);
    assert.equal(b.balanceCents, 0);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "paid");
    fakeSquare.setStatus(ach.payment.id, "PENDING");
    const late = fakeSquare.webhookEvent("payment.updated", ach.payment.id);
    const e2 = await persist(late);
    r = await tx((x) => processSquareEvent(x, { payload: JSON.parse(late.body), sourceEventId: e2.id }));
    assert.equal(r.changed, false, "an older provider state arriving late is ignored");
    fakeSquare.setStatus(ach.payment.id, "COMPLETED");
    const replay = await persist({ ...done });
    assert.equal(replay.id, e1.id, "duplicate event id → same source event, not a new one");
    r = await tx((x) => processSquareEvent(x, { payload: JSON.parse(done.body), sourceEventId: e1.id }));
    assert.equal(r.changed, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv.id]))[0].n, 1, "one ledger row after three webhooks");
    const a = await getAttempt(run, ach.attempt.id);
    assert.equal(a.source_event_ids.length, 2, "evidence recorded per distinct event");

    // Late bank return → balance restored, no new invoice
    fakeSquare.setStatus(ach.payment.id, "FAILED");
    const ret = fakeSquare.webhookEvent("payment.updated", ach.payment.id);
    const e3 = await persist(ret);
    r = await tx((x) => processSquareEvent(x, { payload: JSON.parse(ret.body), sourceEventId: e3.id }));
    assert.equal(r.handled, "payment:completed->returned");
    b = await invoiceBalance(run, inv.id);
    assert.equal(b.balanceCents, 400000);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "sent");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [projectId]))[0].n, 1, "no invoice fabricated");
    assert.equal((await routineReminderCandidates(run)).length, 1, "reminders resume on the real balance");

    // Missed webhook: an ACH that never got its event is settled by reconciliation (fake settles on the 2nd poll).
    const inv2 = await issued(tx, projectId, "draw:1:rough", 123400);
    const ach2 = await checkout(tx, adapter, { invoiceId: inv2.id, method: "ach", nonce: "ach-0003-abcdef", sourceId: "bauth:ok" });
    assert.equal(ach2.attempt.state, "pending");
    let sum = await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal(sum.changed, 0, "first poll: still pending");
    sum = await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal(sum.changed, 1);
    assert.equal((await invoiceBalance(run, inv2.id)).balanceCents, 0);
    // and one that fails at the bank (amount ends in 99)
    const inv3 = await issued(tx, projectId, "draw:2:x", 5099);
    const ach3 = await checkout(tx, adapter, { invoiceId: inv3.id, method: "ach", nonce: "ach-0004-abcdef", sourceId: "bauth:ok" });
    await tx((x) => reconcilePendingAttempts(x, adapter));
    await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal((await getAttempt(run, ach3.attempt.id)).state, "failed");
    assert.equal((await invoiceBalance(run, inv3.id)).balanceCents, 5099);
    assert.equal((await invoiceBalance(run, inv3.id)).hasPending, false);

    // accepted-then-timeout: attempt unknown, reconciliation finds it by reference and settles; stale pending escalates
    const inv4 = await issued(tx, projectId, "draw:3:y", 700);
    const unk = await checkout(tx, adapter, { invoiceId: inv4.id, method: "card", nonce: "card-0005-abcdef", sourceId: "cnon:timeout" });
    assert.equal(unk.attempt.state, "unknown");
    assert.equal((await invoiceBalance(run, inv4.id)).balanceCents, 700);
    sum = await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal((await getAttempt(run, unk.attempt.id)).state, "completed");
    assert.equal((await invoiceBalance(run, inv4.id)).balanceCents, 0);
    const inv5 = await issued(tx, projectId, "draw:4:z", 800);
    const old = await checkout(tx, adapter, { invoiceId: inv5.id, method: "ach", nonce: "ach-0006-abcdef", sourceId: "bauth:ok" });
    await run(`UPDATE payment_attempts SET created_at = now() - interval '4 days' WHERE id = $1`, [old.attempt.id]);
    fakeSquare.setStatus(old.payment.id, "PENDING");
    sum = await tx((x) => reconcilePendingAttempts(x, adapter, { staleAfterHours: 72 }));
    assert.equal(sum.stale, 1);
    const stale = await run(`SELECT kind, status FROM decisions WHERE dedupe_key = $1`, [`payment:${old.attempt.id}:stale`]);
    assert.equal(stale[0].kind, "payment_stale");
    sum = await tx((x) => reconcilePendingAttempts(x, adapter, { staleAfterHours: 72 }));
    assert.equal(sum.stale, 0, "same card, no duplicate escalation");
  });
});

test("V21 refunds: need an approved, consumed decision bound to the payment + amount; idempotent; balance re-opens once", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-c");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    const inv = await issued(tx, projectId, "draw:0:deposit", 100000);
    const paid = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "card-0001-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(paid.attempt.state, "completed");

    await assert.rejects(tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 100001, reason: "too much", principal: owner })), /refundable/);
    const staged = await tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 30000, reason: "overcharge", principal: owner }));
    // not approved yet → refused, nothing moves
    let res = await executeRefund(tx, adapter, { decisionId: staged.decision.id, principal: owner });
    assert.equal(res.ok, false);
    assert.match(res.reason, /waiting for approval/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM refunds`))[0].n, 0);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 0);
    // approve → executes once; a second execute replays
    await tx((r) => resolveDecision(r, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" }));
    res = await executeRefund(tx, adapter, { decisionId: staged.decision.id, principal: owner });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.refund.state, "completed");
    assert.ok(res.refund.provider_ref);
    let b = await invoiceBalance(run, inv.id);
    assert.equal(b.balanceCents, 30000);
    assert.equal(b.returnsCents, 30000);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "partially_paid");
    const again = await executeRefund(tx, adapter, { decisionId: staged.decision.id, principal: owner });
    assert.equal(again.ok, true);
    assert.equal(again.refund.id, res.refund.id);
    assert.equal((await run(`SELECT count(*)::int AS n FROM refunds`))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE kind = 'refund'`))[0].n, 1);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 30000, "refund applied once");
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [staged.decision.id]))[0].status, "consumed");
    // a decision for a different amount cannot be reused for this refund; refunding the rest works with its own card
    const rest = await tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 70000, reason: "cancel", principal: owner }));
    await tx((r) => resolveDecision(r, { id: rest.decision.id, outcome: "approved", principal: owner, via: "telegram" }));
    res = await executeRefund(tx, adapter, { decisionId: rest.decision.id, principal: owner });
    assert.equal(res.ok, true);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 100000);
    assert.equal((await getAttempt(run, paid.attempt.id)).state, "refunded");
    await assert.rejects(tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 1, reason: "x", principal: owner })), /Only 0 cents/);
  });
});
