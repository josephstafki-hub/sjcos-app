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
  SURCHARGE_MISMATCH,
  squareKeyFor,
  stageRefundDecision,
  executeRefund,
  getAttempt,
  applyProviderDispute,
} from "../lib/payments/service.ts";
import { fakeSquare, FAKE_NOTIFICATION_URL, FAKE_SIGNATURE_KEY } from "../lib/payments/square/fake.ts";
import { verifyWebhookSignature } from "../lib/payments/square/signature.ts";
import { getSquareAdapter } from "../lib/payments/square/index.ts";
import { recordSourceEvent } from "../lib/commands/source-events.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";
import { activatePolicy, proposePolicyVersion } from "../lib/commands/policies.ts";

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
async function checkout(tx, adapter, { invoiceId, method, nonce, sourceId, expectedAmountCents, expectedRevision, card, expectedSurchargeCents }) {
  const prep = await tx((r) => prepareAttempt(r, { invoiceId, method, nonce, expectedAmountCents, expectedRevision, card, expectedSurchargeCents, actor: "portal:client" }));
  if (!prep.ok) return prep;
  if (prep.reused && ["pending", "completed", "refunded"].includes(prep.attempt.state)) return { ok: true, reused: true, attempt: prep.attempt, charged: false };
  const outcome = await chargeAttempt(adapter, prep.attempt, { sourceId, locationId: "L1" });
  if (outcome.kind === "declined") return { ok: true, charged: true, code: outcome.code, attempt: await tx((r) => markAttemptDeclined(r, prep.attempt.id, outcome.code, outcome.reason)) };
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
    const pushFloor = (await run(`SELECT COALESCE(max(id), 0)::bigint AS m FROM push_outbox`))[0].m;

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
    const paid = await run(`SELECT title, body FROM push_outbox WHERE kind = 'payment' AND id > $1 AND title LIKE '%$2,500.00%'`, [pushFloor]);
    assert.equal(paid.length, 1, "one alert for the paid card, despite the repeat tap");
    assert.match(paid[0].body, /^Card · Invoice .* · paid in full$/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM push_outbox WHERE kind = 'payment' AND id > $1 AND title LIKE '%$1,000.00%'`, [pushFloor]))[0].n, 0, "a declined card says nothing");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv2.id]))[0].n, 0);
    // a draft invoice is not payable
    const draft = await tx((r) => issueMilestoneInvoice(r, { projectId, economicKey: "draw:2:x", milestone: "x", amountCents: 100, source: "draw", status: "draft", principal: owner }));
    const np = await checkout(tx, adapter, { invoiceId: draft.invoice.id, method: "card", nonce: "tap-0005-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(np.code, "not_payable");
  });
});

test("V21 card with a real browser nonce: Square key fits its limits; a lost response still reconciles by reference_id; decline → fresh nonce pays", { skip }, async () => {
  // The first live charge (2026-10-10) failed VALUE_TOO_LONG: the intent_key
  // with a crypto.randomUUID() nonce is ~55 chars, over Square's 45 / 40.
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-uuid");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    const inv = await issued(tx, projectId, "draw:0:deposit", 100);
    const uuidNonce = () => crypto.randomUUID();

    // declined first (a typo'd card): nothing charged; the browser drops the
    // nonce, and a fresh one pays.
    const declined = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: uuidNonce(), sourceId: "cnon:card-decline", expectedAmountCents: 100 });
    assert.equal(declined.attempt.state, "failed");
    assert.match(declined.attempt.last_error, /^CARD_DECLINED/, "declined by the card, not by a field limit");

    // response lost after Square took it: unknown, then the sweep finds it by reference_id
    const lost = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: uuidNonce(), sourceId: "cnon:card-timeout", expectedAmountCents: 100 });
    assert.ok(lost.attempt.intent_key.length > 45, "the intent_key itself is too long for Square");
    assert.equal(lost.attempt.state, "unknown");
    await tx((r) => reconcilePendingAttempts(r, adapter, {}));
    const settled = await getAttempt(run, lost.attempt.id);
    assert.equal(settled.state, "completed");
    assert.equal(settled.provider_payment_id != null, true);
    assert.equal((await adapter.getPayment(settled.provider_payment_id)).referenceId, settled.id);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 0);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "paid");
  });
});

test("Payment receipt: one client email per completed Square payment, under the payment.receipt policy; none while ACH is pending; policy off → a decision", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-receipt");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    const receipts = (attemptId) => run(`SELECT operation_key, kind, recipient, policy_ref, decision_id, payload FROM action_intents WHERE operation_key = $1`, [`payment:${attemptId}:receipt`]);

    // Policy OFF (seeded as a draft): the receipt waits on a decision, never sends by itself.
    const inv0 = await issued(tx, projectId, "draw:0:deposit", 500);
    const off = await checkout(tx, adapter, { invoiceId: inv0.id, method: "card", nonce: crypto.randomUUID(), sourceId: "cnon:card-ok" });
    assert.equal(off.attempt.state, "completed");
    let rows = await receipts(off.attempt.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].policy_ref, null);
    assert.ok(rows[0].decision_id, "held behind a decision Joe approves");

    // (the harness empties policies; migration 0024 seeds the same draft in prod)
    await tx(async (r) => {
      const v = await proposePolicyVersion(r, "payment.receipt", { lane: "sends" }, "test");
      await activatePolicy(r, "payment.receipt", v.version);
    });

    // Card: completes → exactly one receipt to the client, with the Square receipt link.
    const inv = await issued(tx, projectId, "draw:1:rough", 1234);
    const paid = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: crypto.randomUUID(), sourceId: "cnon:card-ok" });
    rows = await receipts(paid.attempt.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "send_email");
    assert.equal(rows[0].policy_ref, "policy:payment.receipt@1");
    assert.equal(rows[0].recipient, "zz-client-zz-pay-receipt@example.test");
    const body = rows[0].payload.bodyText;
    assert.match(body, /\$12\.34/);
    assert.match(body, new RegExp(`invoice ${inv.number}`));
    assert.match(body, /paid in full/);
    assert.ok(body.includes(paid.payment.receiptUrl), "Square's receipt link");
    // a duplicate COMPLETED webhook changes nothing and stages nothing new
    const evt = fakeSquare.webhookEvent("payment.updated", paid.payment.id);
    await tx((x) => processSquareEvent(x, { payload: JSON.parse(evt.body), sourceEventId: null }));
    assert.equal((await receipts(paid.attempt.id)).length, 1);

    // ACH: no receipt while pending; one when Square says COMPLETED.
    const inv2 = await issued(tx, projectId, "draw:2:final", 90000);
    const ach = await checkout(tx, adapter, { invoiceId: inv2.id, method: "ach", nonce: crypto.randomUUID(), sourceId: "bauth:ok" });
    assert.equal(ach.attempt.state, "pending");
    assert.equal((await receipts(ach.attempt.id)).length, 0, "pending is not money received");
    fakeSquare.setStatus(ach.payment.id, "COMPLETED");
    const done = fakeSquare.webhookEvent("payment.updated", ach.payment.id);
    const r = await tx((x) => processSquareEvent(x, { payload: JSON.parse(done.body), sourceEventId: null }));
    assert.equal(r.handled, "payment:pending->completed");
    rows = await receipts(ach.attempt.id);
    assert.equal(rows.length, 1);
    assert.equal(r.receiptIntentId != null, true, "webhook hands the receipt to the immediate dispatch");
    assert.match(rows[0].payload.bodyText, /bank transfer payment of \$900\.00/);

    // No client email anywhere: the payment still records; the receipt is skipped.
    await run(`UPDATE users SET email = 'zz-pay-receipt@client-portal.invalid' WHERE link_slug = 'zz-pay-receipt'`);
    await run(`UPDATE projects SET client_email = '' WHERE id = $1`, [projectId]);
    const inv3 = await issued(tx, projectId, "draw:3:extra", 700);
    const noMail = await checkout(tx, adapter, { invoiceId: inv3.id, method: "card", nonce: crypto.randomUUID(), sourceId: "cnon:card-ok" });
    assert.equal(noMail.attempt.state, "completed");
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv3.id]))[0].status, "paid");
    assert.equal((await receipts(noMail.attempt.id)).length, 0);
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

    // Joe's "you got paid" alerts (lib/payments/owner-alert.ts): one per transition.
    const alerts = async () => run(`SELECT title, body, href FROM push_outbox WHERE kind = 'payment' AND sent_at IS NULL ORDER BY id`);
    const cards = async () => run(`SELECT title, flagged FROM notifications WHERE tag = 'Payment' ORDER BY created_at, title`);
    const alertsBefore = (await alerts()).length;
    const cardsBefore = (await cards()).length;

    const ach = await checkout(tx, adapter, { invoiceId: inv.id, method: "ach", nonce: "ach-0001-abcdef", sourceId: "bauth:ok" });
    assert.equal(ach.attempt.state, "pending");
    let al = (await alerts()).slice(alertsBefore);
    assert.equal(al.length, 1, "a started bank transfer tells Joe once");
    assert.match(al[0].title, /^Bank transfer started: \$4,000\.00 from ZZ$/);
    assert.equal(al[0].href, "/projects/zz-pay-b?tab=Money");
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
    al = (await alerts()).slice(alertsBefore);
    assert.equal(al.length, 2, "cleared once after three webhooks");
    assert.match(al[1].title, /^Paid online: \$4,000\.00 from ZZ$/);
    assert.match(al[1].body, /^Bank transfer · Invoice .* · paid in full$/);
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
    al = (await alerts()).slice(alertsBefore);
    assert.equal(al.length, 3);
    assert.match(al[2].title, /^Payment returned: \$4,000\.00 from ZZ$/);
    assert.match(al[2].body, /\$4,000\.00 still owed$/);
    const bell = (await cards()).slice(cardsBefore);
    assert.equal(bell.length, 3, "each alert also lands on the bell");
    assert.equal(bell.filter((c) => c.flagged).length, 1, "only the return is flagged");
    assert.equal((await routineReminderCandidates(run)).length, 1, "reminders resume on the real balance");

    // Missed webhook: an ACH that never got its event is settled by reconciliation (fake settles on the 2nd poll).
    const inv2 = await issued(tx, projectId, "draw:1:rough", 123400);
    const ach2 = await checkout(tx, adapter, { invoiceId: inv2.id, method: "ach", nonce: "ach-0003-abcdef", sourceId: "bauth:ok" });
    assert.equal(ach2.attempt.state, "pending");
    let sum = await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal(sum.changed, 0, "first poll: still pending");
    sum = await tx((x) => reconcilePendingAttempts(x, adapter));
    assert.equal(sum.changed, 1);
    assert.equal(sum.ownerPushIds.length, 1, "the sweep hands its alert back for an immediate send");
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

test("Credit card surcharge: credit pays balance + surcharge, invoice credited the balance only; debit/prepaid none; Square's debit reading voids a surcharged card; stranded authorization finishes; refunds split", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-surcharge");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    // Seeded by migration 0036: Square fee 4%, cap 3% → 3% on every credit card.
    assert.match((await run(`SELECT value FROM app_settings WHERE key = 'payments.card_surcharge'`))[0].value, /"capPct":3/);
    const visaCredit = { brand: "VISA", cardType: "CREDIT", prepaidType: "NOT_PREPAID" };
    const pushFloor = (await run(`SELECT COALESCE(max(id), 0)::bigint AS m FROM push_outbox`))[0].m;

    // 1. Credit card: $22,000 balance + $660 surcharge, authorized then completed.
    const inv = await issued(tx, projectId, "draw:0:deposit", 2200000);
    const stale = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "sur-0001-abcdef", sourceId: "cnon:card-ok", expectedAmountCents: 2200000, card: visaCredit, expectedSurchargeCents: 1 });
    assert.equal(stale.code, "stale", "the page showed a different surcharge");
    const paid = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "sur-0002-abcdef", sourceId: "cnon:card-ok", expectedAmountCents: 2200000, card: visaCredit, expectedSurchargeCents: 66000 });
    assert.equal(paid.attempt.state, "completed");
    assert.equal(paid.attempt.amount_cents, 2266000, "Square charges balance + surcharge");
    assert.equal(paid.attempt.surcharge_cents, 66000);
    assert.equal(paid.attempt.card_type, "CREDIT");
    assert.equal(paid.payment.amountCents, 2266000);
    assert.equal(paid.payment.status, "COMPLETED");
    const [row] = await run(`SELECT amount_cents, external_sync, note FROM invoice_payments WHERE invoice_id = $1`, [inv.id]);
    assert.equal(row.amount_cents, 2200000, "only the balance is credited to the invoice");
    assert.equal(row.external_sync.card_surcharge_cents, 66000);
    assert.equal(row.external_sync.charged_cents, 2266000);
    assert.match(row.note, /\$660\.00 credit card surcharge/);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 0);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "paid", "paid, not overpaid");
    const [alert] = await run(`SELECT title, body FROM push_outbox WHERE kind = 'payment' AND id > $1`, [pushFloor]);
    assert.match(alert.title, /\$22,660\.00/);
    assert.match(alert.body, /incl\. \$660\.00 card surcharge · paid in full/);

    // 2. Debit and prepaid cards carry no surcharge (autocomplete path).
    const inv2 = await issued(tx, projectId, "draw:1:rough", 100000);
    const debit = await checkout(tx, adapter, { invoiceId: inv2.id, method: "card", nonce: "sur-0003-abcdef", sourceId: "cnon:debit-ok", expectedAmountCents: 100000, card: { brand: "VISA", cardType: "DEBIT", prepaidType: "NOT_PREPAID" }, expectedSurchargeCents: 0 });
    assert.equal(debit.attempt.state, "completed");
    assert.equal(debit.attempt.amount_cents, 100000);
    assert.equal(debit.attempt.surcharge_cents, 0);
    const inv3 = await issued(tx, projectId, "draw:2:trim", 100000);
    const prepaidPrep = await tx((r) => prepareAttempt(r, { invoiceId: inv3.id, method: "card", nonce: "sur-0004-abcdef", card: { brand: "VISA", cardType: "CREDIT", prepaidType: "PREPAID" }, actor: "portal:client" }));
    assert.equal(prepaidPrep.attempt.surcharge_cents, 0, "prepaid cards are never surcharged");
    const achPrep = await tx((r) => prepareAttempt(r, { invoiceId: inv3.id, method: "ach", nonce: "sur-0005-abcdef", card: visaCredit, actor: "portal:client" }));
    assert.equal(achPrep.ok, true);
    assert.equal(achPrep.attempt.surcharge_cents, 0, "bank transfer never carries it");
    await run(`DELETE FROM payment_attempts WHERE invoice_id = $1`, [inv3.id]);

    // 3. The page read CREDIT but Square reads DEBIT: voided, nothing charged; retry pays the plain balance.
    const lie = await checkout(tx, adapter, { invoiceId: inv3.id, method: "card", nonce: "sur-0006-abcdef", sourceId: "cnon:debit-ok", card: visaCredit, expectedSurchargeCents: 3000 });
    assert.equal(lie.code, SURCHARGE_MISMATCH);
    assert.equal(lie.attempt.state, "failed");
    assert.equal((await invoiceBalance(run, inv3.id)).balanceCents, 100000);
    assert.equal((await adapter.listPaymentsSince(new Date(Date.now() - 60_000).toISOString())).filter((p) => p.referenceId === lie.attempt.id)[0].status, "CANCELED");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv3.id]))[0].n, 0);
    const retry = await checkout(tx, adapter, { invoiceId: inv3.id, method: "card", nonce: "sur-0007-abcdef", sourceId: "cnon:debit-ok", card: null, expectedSurchargeCents: 0 });
    assert.equal(retry.attempt.state, "completed");
    assert.equal(retry.attempt.amount_cents, 100000);

    // 4. Authorized, then the server died before completing: the sweep finishes it.
    const inv4 = await issued(tx, projectId, "draw:3:final", 50000);
    const prep = await tx((r) => prepareAttempt(r, { invoiceId: inv4.id, method: "card", nonce: "sur-0008-abcdef", card: visaCredit, actor: "portal:client" }));
    assert.equal(prep.attempt.amount_cents, 51500);
    const approved = await adapter.createPayment({ idempotencyKey: squareKeyFor(prep.attempt), sourceId: "cnon:card-ok", amountCents: 51500, currency: "USD", locationId: "L1", method: "card", referenceId: squareKeyFor(prep.attempt), autocomplete: false });
    assert.equal(approved.status, "APPROVED");
    // A payment.created webhook for the authorization is not money yet.
    const early = await tx((r) => applyProviderPayment(r, { attemptId: prep.attempt.id, payment: approved, actor: "webhook:square" }));
    assert.equal(early.changed, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv4.id]))[0].n, 0);
    await tx((r) => reconcilePendingAttempts(r, adapter, {}));
    const finished = await getAttempt(run, prep.attempt.id);
    assert.equal(finished.state, "completed");
    assert.equal((await adapter.getPayment(approved.id)).status, "COMPLETED");
    assert.equal((await invoiceBalance(run, inv4.id)).balanceCents, 0);

    // 5. Refunds: the whole charge is refundable; only the invoice share re-opens the invoice.
    await assert.rejects(tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 2266001, reason: "too much", principal: owner })), /refundable/);
    const staged = await tx((r) => stageRefundDecision(r, { attemptId: paid.attempt.id, amountCents: 2266000, reason: "job cancelled", principal: owner }));
    await tx((r) => resolveDecision(r, { id: staged.decision.id, outcome: "approved", principal: owner, via: "app" }));
    const refunded = await executeRefund(tx, adapter, { decisionId: staged.decision.id, principal: owner });
    assert.equal(refunded.ok, true, JSON.stringify(refunded));
    assert.equal((await run(`SELECT amount_cents FROM invoice_payments WHERE invoice_id = $1 AND kind = 'refund'`, [inv.id]))[0].amount_cents, 2200000);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 2200000, "balance re-opens to the invoice amount, not the surcharged total");
    assert.equal((await getAttempt(run, paid.attempt.id)).state, "refunded");
  });
});

// Tier 3 (A20): Square can still move money after a payment completed.
test("After completion: a Dashboard refund the webhook missed is picked up by the sweep; disputes open, win and lose; each tells Joe once", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const projectId = await seed(client, "zz-pay-late");
    const tx = txOver(url);
    const run = runOn(client);
    const adapter = getSquareAdapter();
    const inv = await issued(tx, projectId, "draw:0:deposit", 200000);
    const paid = await checkout(tx, adapter, { invoiceId: inv.id, method: "card", nonce: "late-0001-abcdef", sourceId: "cnon:card-ok" });
    assert.equal(paid.attempt.state, "completed");
    const floor = (await run(`SELECT COALESCE(max(id), 0)::bigint AS m FROM push_outbox`))[0].m;

    // Refunded in the Square Dashboard; no webhook ever arrives.
    fakeSquare.dashboardRefund(paid.payment.id, 50000);
    const sweep = await tx((r) => reconcilePendingAttempts(r, adapter, { principal: owner }));
    assert.ok(sweep.changed >= 1);
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 50000, "the invoice re-opens by the refund");
    assert.equal(sweep.ownerPushIds.length, 1);
    const again = await tx((r) => reconcilePendingAttempts(r, adapter, { principal: owner }));
    assert.equal(again.changed, 0, "a second sweep changes nothing");
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE kind = 'refund'`))[0].n, 1);
    const outside = await run(`SELECT title FROM push_outbox WHERE kind = 'payment' AND id > $1 AND title LIKE 'Refunded in Square%'`, [floor]);
    assert.equal(outside.length, 1);

    // A dispute opens: money held, not lost; Joe is told to answer it.
    const dispute = { id: "dp_1", paymentId: paid.payment.id, state: "EVIDENCE_REQUIRED", amountCents: 150000, reason: "NOT_AS_DESCRIBED", dueAt: "2026-11-20T00:00:00Z" };
    const open = await tx((r) => applyProviderDispute(r, { dispute, actor: "webhook:square" }));
    assert.equal(open.state, "open");
    assert.equal((await getAttempt(run, paid.attempt.id)).state, "disputed");
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 50000, "an open dispute moves no money");
    const [card] = await run(`SELECT title, body FROM push_outbox WHERE id = $1`, [open.ownerPushId]);
    assert.match(card.title, /Card payment disputed/);
    assert.match(card.body, /not as described · answer by 2026-11-20/);
    const repeat = await tx((r) => applyProviderDispute(r, { dispute: { ...dispute, state: "PROCESSING" }, actor: "webhook:square" }));
    assert.equal(repeat.changed, false, "a later open state is not news");

    // Won: the payment stands.
    const won = await tx((r) => applyProviderDispute(r, { dispute: { ...dispute, state: "WON" }, actor: "webhook:square" }));
    assert.equal(won.changed, true);
    assert.equal((await getAttempt(run, paid.attempt.id)).state, "completed");

    // A second dispute, lost: the card company takes the money back, once.
    const d2 = { ...dispute, id: "dp_2", state: "LOST", amountCents: 150000 };
    const lost = await tx((r) => applyProviderDispute(r, { dispute: d2, actor: "webhook:square" }));
    assert.equal(lost.state, "lost");
    assert.equal((await invoiceBalance(run, inv.id)).balanceCents, 200000, "refund + chargeback re-open the whole invoice");
    assert.equal((await getAttempt(run, paid.attempt.id)).state, "returned");
    const lostAgain = await tx((r) => applyProviderDispute(r, { dispute: d2, actor: "webhook:square" }));
    assert.equal(lostAgain.changed, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoice_payments WHERE kind = 'return'`))[0].n, 1);

    // The webhook path routes dispute events the same way.
    const evt = await processSquareEvent(run, { payload: { type: "dispute.state.updated", event_id: "e-d3", data: { object: { dispute: { id: "dp_2", state: "LOST", amount_money: { amount: 150000 }, disputed_payment: { payment_id: paid.payment.id } } } } }, sourceEventId: null });
    assert.equal(evt.handled, "dispute:lost");
    assert.equal(evt.changed, false);
  });
});
