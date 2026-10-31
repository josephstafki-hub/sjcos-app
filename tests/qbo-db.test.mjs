import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { FakeQbo } from "../lib/accounting/qbo/fake.ts";
import { ensureConnection, importPostedEntities, exportIssuedInvoice, exportConfirmedPayment, reconcilePayout, confirmMapping, rejectMapping, setSwitch, qboSummary } from "../lib/accounting/qbo/sync.ts";

// V16 accounting (A14) against a REAL Postgres with the fake QBO company:
// re-import/export create no duplicate revenue or cash; external edits and
// voids surface as conflicts (+ a decision) instead of being overwritten;
// unmatched imports stay unmapped with proposals only; gross/fee/net
// reconcile as one economic event; switches OFF = dry run.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };

async function clean(client) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE qbo_mappings, qbo_import_batches, qbo_connection RESTART IDENTITY CASCADE`);
  await client.query(`UPDATE qbo_sync_settings SET enabled = false`);
  await client.query(`DELETE FROM invoice_payments WHERE invoice_id IN (SELECT i.id FROM invoices i JOIN projects p ON p.id = i.project_id WHERE p.slug LIKE 'zz-%')`);
  await client.query(`DELETE FROM invoices WHERE project_id IN (SELECT id FROM projects WHERE slug LIKE 'zz-%')`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%'`);
}

test("V16: import twice → no duplicates; export twice → one QBO invoice/payment; edit/void → conflict + decision; unmatched stays unmapped; switches OFF = dry run", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await clean(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const qbo = new FakeQbo();
    const realm = qbo.realmId;
    await ensureConnection(run, { realmId: realm, environment: "fake", companyName: qbo.companyName });
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-qbo-p', 'ZZ QBO', 'construction', 'ZZ Client') RETURNING id`);
    const [inv] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, issued_at, sent_at, economic_key) VALUES ($1, 'INV-901', 'Deposit', 250000, 'sent', now(), now(), 'zz:deposit') RETURNING id`, [p.id]);
    const [draft] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status) VALUES ($1, 'INV-902', 'Draft', 100, 'draft') RETURNING id`, [p.id]);
    const [pay] = await run(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, provider, provider_ref, status, received_at) VALUES ($1, 'payment', 250000, 'card', 'square', 'sq-pay-1', 'settled', '2026-09-22') RETURNING id`, [inv.id]);

    // Bookkeeper's own entries in QBO (posted outside SJC OS).
    await qbo.create("Bill", { TxnDate: "2026-09-10", TotalAmt: 420.0, DocNumber: "SIWECK-1" });
    await run(`INSERT INTO expenses (project_id, expense_date, vendor_label, kind, amount_cents, source_ref) VALUES ($1, '2026-09-10', 'Siweck Lumber', 'material', 42000, 'card:9')`, [p.id]);
    await qbo.create("Purchase", { TxnDate: "2026-09-11", TotalAmt: 99.99 });

    // Switches OFF → dry run: counts only, no rows, no cursor.
    const dry = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.kinds.Bill.created, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM qbo_mappings`))[0].n, 0, "dry run writes no mappings");
    assert.equal((await run(`SELECT cursors FROM qbo_connection WHERE realm_id = $1`, [realm]))[0].cursors.Bill, undefined, "dry run moves no cursor");
    assert.equal((await run(`SELECT count(*)::int AS n FROM qbo_import_batches WHERE dry_run`))[0].n, 6, "one batch row per kind, marked dry run");

    // Import ON: proposals only.
    await setSwitch(run, "import_read", true, "test");
    const first = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(first.dryRun, false);
    assert.equal(first.kinds.Bill.created, 1);
    const [billMap] = await run(`SELECT * FROM qbo_mappings WHERE entity_kind = 'Bill'`);
    assert.equal(billMap.state, "unmapped");
    assert.equal(billMap.candidates.length, 1, "same amount+date expense proposed");
    assert.equal(billMap.candidates[0].internal_kind, "expense");
    assert.equal(billMap.internal_id, null, "never attached automatically");
    const [purchMap] = await run(`SELECT * FROM qbo_mappings WHERE entity_kind = 'Purchase'`);
    assert.equal(purchMap.candidates.length, 0, "no candidate → stays unmapped, not attached to the nearest amount");
    // Re-import: nothing new.
    const again = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(again.kinds.Bill.created, 0);
    assert.equal(again.kinds.Bill.updated, 0);
    assert.equal((await run(`SELECT count(*)::int AS n FROM qbo_mappings WHERE entity_kind IN ('Bill','Purchase')`))[0].n, 2);

    // Export invoice: switch OFF refuses; ON mirrors once; repeat is a no-op; drafts never.
    const off = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv.id), by: "test" });
    assert.equal(off.ok, false);
    assert.equal(off.code, "switch_off");
    await setSwitch(run, "export_invoices", true, "test");
    const e1 = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv.id), by: "test" });
    const e2 = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv.id), by: "test" });
    assert.equal(e1.ok && e1.created, true);
    assert.equal(e2.ok && e2.created, false);
    assert.equal(e2.qboId, e1.qboId);
    assert.equal((await qbo.listChanges("Invoice", null)).length, 1, "one QBO invoice");
    assert.equal((await run(`SELECT external_ref->'qbo'->>'id' AS id FROM invoices WHERE id = $1`, [inv.id]))[0].id, e1.qboId);
    const d = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(draft.id), by: "test" });
    assert.equal(d.code, "not_issued");
    // Export payment: needs its switch + the invoice mapping; once.
    await setSwitch(run, "export_payments", true, "test");
    const p1 = await exportConfirmedPayment(run, qbo, { realmId: realm, invoicePaymentId: Number(pay.id), by: "test" });
    const p2 = await exportConfirmedPayment(run, qbo, { realmId: realm, invoicePaymentId: Number(pay.id), by: "test" });
    assert.equal(p1.ok && p1.created, true);
    assert.equal(p2.ok && p2.created, false);
    assert.equal((await qbo.listChanges("Payment", null)).length, 1, "one QBO payment");
    // Re-import after export: our own posted records come back unchanged (no conflict, no duplicate row).
    const back = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(back.kinds.Invoice.created, 0);
    assert.equal(back.conflicts.length, 0);
    assert.equal((await run(`SELECT count(*)::int AS n FROM qbo_mappings WHERE entity_kind = 'Invoice'`))[0].n, 1);

    // Gross/fee/net: one economic event.
    const dep = await qbo.create("Deposit", { TxnDate: "2026-09-23", TotalAmt: 2427.5 });
    const rp = await reconcilePayout(run, { realmId: realm, provider: "square", payoutRef: "po-1", grossCents: 250000, feeCents: 7250, netCents: 242750, invoicePaymentIds: [Number(pay.id)], depositQboId: dep.Id, by: "test" });
    assert.equal(rp.ok && rp.created, true);
    assert.equal(rp.reconciled, 1);
    const rp2 = await reconcilePayout(run, { realmId: realm, provider: "square", payoutRef: "po-1", grossCents: 250000, feeCents: 7250, netCents: 242750, invoicePaymentIds: [Number(pay.id)], depositQboId: dep.Id, by: "test" });
    assert.equal(rp2.ok && rp2.created, false, "repeat payout changes nothing");
    assert.equal((await run(`SELECT count(*)::int AS n FROM qbo_mappings WHERE internal_kind = 'processor_fee'`))[0].n, 1);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE entity_kind = 'Payment'`))[0].state, "reconciled");
    const bad = await reconcilePayout(run, { realmId: realm, provider: "square", payoutRef: "po-2", grossCents: 250000, feeCents: 7250, netCents: 242000, invoicePaymentIds: [Number(pay.id)], by: "test" });
    assert.equal(bad.ok, false, "gross − fee ≠ net is an exception, never guessed");
    const income = await run(`SELECT count(*)::int AS n FROM qbo_mappings WHERE entity_kind IN ('Invoice','Payment') AND internal_id IN ($1, $2)`, [String(inv.id), String(pay.id)]);
    assert.equal(income[0].n, 2, "payment + fee + deposit never became a second invoice or payment");

    // External edit → conflict + one decision; void → flagged.
    qbo.mutate("Invoice", e1.qboId, { TotalAmt: 2600 });
    const conf = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(conf.conflicts.length, 1);
    assert.ok(conf.conflicts[0].decision_id);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE qbo_id = $1 AND entity_kind = 'Invoice'`, [e1.qboId]))[0].state, "conflict");
    assert.equal((await run(`SELECT amount FROM invoices WHERE id = $1`, [inv.id]))[0].amount, 250000, "SJC invoice untouched by the QBO edit");
    const conf2 = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(conf2.conflicts.length, 0, "same version: no second decision");
    assert.equal((await run(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'other' AND action = 'resolve_accounting_conflict'`))[0].n, 1);
    qbo.void_("Payment", p1.qboId);
    const v = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(v.conflicts.length, 1);
    assert.match(v.conflicts[0].reason, /voided/);
    assert.equal((await run(`SELECT qbo_voided FROM qbo_mappings WHERE qbo_id = $1 AND entity_kind = 'Payment'`, [p1.qboId]))[0].qbo_voided, true);

    // Owner review: confirm a proposal (once; duplicates refused), reject another.
    const ok = await confirmMapping(run, { mappingId: billMap.id, internalKind: "expense", internalId: billMap.candidates[0].internal_id, by: "test" });
    assert.equal(ok.ok, true);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE id = $1`, [billMap.id]))[0].state, "posted");
    const bill2 = await qbo.create("Bill", { TxnDate: "2026-09-10", TotalAmt: 420.0, DocNumber: "SIWECK-1-dup" });
    await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    const [dupMap] = await run(`SELECT id FROM qbo_mappings WHERE qbo_id = $1`, [bill2.Id]);
    const dup = await confirmMapping(run, { mappingId: dupMap.id, internalKind: "expense", internalId: billMap.candidates[0].internal_id, by: "test" });
    assert.equal(dup.ok, false, "one internal record maps to one QBO bill");
    assert.equal(await rejectMapping(run, purchMap.id, "test", "personal card"), true);
    const sum = await qboSummary(run, realm);
    assert.equal(sum.switches.import_read, true);
    assert.equal(sum.counts.rejected, 1);
    assert.ok(sum.batches.length >= 6);
  });
});

// Simple Start has no bills: QuickBooks refuses the Bill query. The import
// must skip that record type (noted, cursor untouched, retried next pass)
// and still bring in everything else. Not connected still stops the pass.
test("a record type the QuickBooks plan refuses is skipped, not fatal; it is retried next pass and works after an upgrade", { skip }, async () => {
  const { QboNotConnectedError } = await import("../lib/accounting/qbo/types.ts");
  await withTestDb(async (url, client) => {
    await clean(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const qbo = new FakeQbo();
    const realm = qbo.realmId;
    await ensureConnection(run, { realmId: realm, environment: "fake", companyName: qbo.companyName });
    await setSwitch(run, "import_read", true, "test");
    await qbo.create("Invoice", { TxnDate: "2026-10-01", TotalAmt: 100 });
    await qbo.create("Bill", { TxnDate: "2026-10-02", TotalAmt: 50 });
    let simpleStart = true;
    const real = qbo.listChanges.bind(qbo);
    qbo.listChanges = async (kind, since) => {
      if (kind === "Bill" && simpleStart) throw new Error('QuickBooks GET /query → 400: {"Fault":{"Error":[{"Message":"Feature Not Supported","code":"5020"}]}}');
      return real(kind, since);
    };

    const first = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(first.kinds.Invoice.created, 1, "other kinds still import");
    assert.equal(first.kinds.Bill, undefined);
    assert.equal(first.skipped.length, 1);
    assert.equal(first.skipped[0].entity_kind, "Bill");
    assert.match(first.skipped[0].reason, /plan probably doesn't include them/);
    const [batch] = await run(`SELECT error, seen FROM qbo_import_batches WHERE entity_kind = 'Bill'`);
    assert.match(batch.error, /refused Bill/);
    const [conn] = await run(`SELECT cursors FROM qbo_connection WHERE realm_id = $1`, [realm]);
    assert.equal(conn.cursors.Bill, undefined, "Bill cursor untouched, so the next pass asks again");
    const [sum] = [await qboSummary(run, realm)];
    assert.ok(sum.batches.some((b) => b.entity_kind === "Bill" && b.error), "the Accounting page sees the skip");

    // Upgraded plan: the very next pass imports the bill, no setting changed.
    simpleStart = false;
    const second = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(second.skipped.length, 0);
    assert.equal(second.kinds.Bill.created, 1);

    // Not connected is not a per-kind skip: the whole pass stops.
    qbo.listChanges = async () => {
      throw new QboNotConnectedError("reconnect QuickBooks");
    };
    await assert.rejects(importPostedEntities(run, qbo, { realmId: realm, principal: owner }), /reconnect QuickBooks/);
  });
});

// Before exports go on (Tier 3, A14): an export never duplicates what
// QuickBooks already has, a delete in QuickBooks surfaces, and Joe's answer
// on a conflict card does something.
test("exports reuse the QuickBooks customer and hold back a likely duplicate invoice or payment; deletes surface; the conflict card settles the mapping", { skip }, async () => {
  const { resolveAccountingConflict } = await import("../lib/accounting/qbo/sync.ts");
  const { resolveFromChannel } = await import("../lib/decisions/resolve.ts");
  await withTestDb(async (url, client) => {
    await clean(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const qbo = new FakeQbo();
    const realm = qbo.realmId;
    await ensureConnection(run, { realmId: realm, environment: "fake", companyName: qbo.companyName });
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-qbo-d', 'ZZ Dup', 'construction', 'ZZ Larsen') RETURNING id`);
    const [inv1] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, issued_at, sent_at, economic_key) VALUES ($1, 'INV-501', 'Deposit', 1000000, 'sent', '2026-09-15', '2026-09-15', 'zz:d1') RETURNING id`, [p.id]);
    const [inv2] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, issued_at, sent_at, economic_key) VALUES ($1, 'INV-502', 'Draw 1', 500000, 'sent', '2026-09-25', '2026-09-25', 'zz:d2') RETURNING id`, [p.id]);
    const [inv3] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, issued_at, sent_at, economic_key) VALUES ($1, 'INV-503', 'Draw 2', 300000, 'sent', '2026-09-28', '2026-09-28', 'zz:d3') RETURNING id`, [p.id]);
    const [pay1] = await run(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status, received_at) VALUES ($1, 'payment', 500000, 'check', 'settled', '2026-09-27') RETURNING id`, [inv2.id]);

    // The bookkeeper already keyed the customer, the deposit invoice and a check into QuickBooks.
    const cust = await qbo.create("Customer", { DisplayName: "ZZ Larsen" });
    await qbo.create("Invoice", { DocNumber: "INV-501", TxnDate: "2026-09-15", TotalAmt: 10000, CustomerRef: { value: cust.Id, name: "ZZ Larsen" } });
    await qbo.create("Payment", { TxnDate: "2026-09-26", TotalAmt: 5000, CustomerRef: { value: cust.Id, name: "ZZ Larsen" } });
    await setSwitch(run, "import_read", true, "test");
    await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    await setSwitch(run, "export_invoices", true, "test");
    await setSwitch(run, "export_payments", true, "test");

    const dup = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv1.id), by: "test" });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "possible_duplicate");
    assert.match(dup.reason, /#INV-501 for \$10,000\.00 \(ZZ Larsen\)/);

    const e2 = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv2.id), by: "test" });
    assert.equal(e2.ok && e2.created, true, e2.reason);
    assert.equal((await qbo.listChanges("Customer", null)).length, 1, "the existing customer is reused, not duplicated");
    const [cmap] = await run(`SELECT internal_id, state FROM qbo_mappings WHERE entity_kind = 'Customer' AND qbo_id = $1`, [cust.Id]);
    assert.deepEqual([cmap.internal_id, cmap.state], ["zz larsen", "posted"]);

    const pd = await exportConfirmedPayment(run, qbo, { realmId: realm, invoicePaymentId: Number(pay1.id), by: "test" });
    assert.equal(pd.ok, false);
    assert.equal(pd.code, "possible_duplicate");
    assert.equal((await qbo.listChanges("Payment", null)).length, 1, "no second payment in QuickBooks");

    // Rejecting the proposed match lets the invoice go.
    const [m1] = await run(`SELECT id FROM qbo_mappings WHERE entity_kind = 'Invoice' AND snapshot->>'DocNumber' = 'INV-501'`);
    assert.equal(await rejectMapping(run, m1.id, "test", "different job"), true);
    const e1 = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv1.id), by: "test" });
    assert.equal(e1.ok && e1.created, true, e1.reason);

    // Keyed into QuickBooks after the last import: QuickBooks itself is asked.
    await qbo.create("Invoice", { DocNumber: "INV-503", TotalAmt: 3000 });
    const live = await exportIssuedInvoice(run, qbo, { realmId: realm, invoiceId: Number(inv3.id), by: "test" });
    assert.equal(live.code, "possible_duplicate");
    assert.match(live.reason, /hasn't matched/);

    // Edited in QuickBooks → conflict card; Approve = QuickBooks is right.
    qbo.mutate("Invoice", e2.qboId, { TotalAmt: 5100 });
    const conf = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(conf.conflicts.length, 1);
    await client.query("BEGIN");
    const r = await resolveFromChannel(run, { decisionId: conf.conflicts[0].decision_id, via: "app", principal: owner, outcome: "approved" });
    await client.query("COMMIT");
    assert.equal(r.ok, true, r.reply);
    assert.match(r.reply, /QuickBooks' version is accepted/);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE id = $1`, [conf.conflicts[0].mapping_id]))[0].state, "posted");
    assert.equal((await importPostedEntities(run, qbo, { realmId: realm, principal: owner })).conflicts.length, 0, "accepted version doesn't flag again");

    // Deleted in QuickBooks → conflict; Reject keeps it flagged, Approve stops tracking it.
    qbo.delete_("Invoice", e1.qboId);
    const del = await importPostedEntities(run, qbo, { realmId: realm, principal: owner });
    assert.equal(del.conflicts.length, 1);
    assert.match(del.conflicts[0].reason, /deleted in QuickBooks/);
    const mid = del.conflicts[0].mapping_id;
    assert.match(await resolveAccountingConflict(run, { mappingId: mid, outcome: "rejected", by: "Joe" }), /stays flagged/);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE id = $1`, [mid]))[0].state, "conflict");
    assert.match(await resolveAccountingConflict(run, { mappingId: mid, outcome: "approved", by: "Joe" }), /stops tracking it/);
    assert.equal((await run(`SELECT state FROM qbo_mappings WHERE id = $1`, [mid]))[0].state, "rejected");
    assert.equal((await importPostedEntities(run, qbo, { realmId: realm, principal: owner })).conflicts.length, 0, "a delete is reported once");
  });
});
