import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { issueMilestoneInvoice, recordInvoicePayment } from "../lib/billing/core.ts";
import { onSignatureSigned } from "../lib/workflow/engine.ts";
import { isInitialInvoiceKey } from "../lib/workflow/construction-start.ts";

// Libby Mahowald, 2026-10-14: the deposit was paid and the contract signed, but
// the job sat in "construction contract" with nobody told. A fully paid initial
// invoice — whichever path paid it — records initial_paid; with the contract
// signed the job moves to construction, construction-start draws are DRAFTED
// (never sent), and the agent gets one 'permit' trigger. Either order works.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };

const SCHEDULE = [
  { label: "Deposit", percent: 10, triggerStatus: "construction_contract" },
  { label: "Construction start", percent: 20, triggerStatus: "construction" },
  { label: "Final", percent: 70, triggerStatus: "warranty" },
];

async function seed(client, slug) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE project_workflow_events, project_workflows, agent_triggers RESTART IDENTITY CASCADE`).catch(() => {});
  await client.query(`DELETE FROM signature_requests WHERE title LIKE 'zz-%'`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM notifications WHERE title = 'ZZ Start → Construction'`);
  const p = await client.query(
    `INSERT INTO projects (slug, name, status, client_name, address, contract_value, collected_to_date, progress, value_display) VALUES ($1, 'ZZ Start', 'construction_contract', 'ZZ Client', '1271 Berkeley Ave, Saint Paul, MN 55105', 17580, 17580, 100, '$17,580 pre-con (remodel TBD)') RETURNING id`,
    [slug],
  );
  const projectId = p.rows[0].id;
  const e = await client.query(
    `INSERT INTO estimates (project_id, title, kind, status, total, draw_schedule, sent_at, approved_at)
     VALUES ($1, 'Formal', 'formal', 'approved', 1000000, $2::jsonb, now(), now()) RETURNING id`,
    [projectId, JSON.stringify(SCHEDULE)],
  );
  return { projectId, estimateId: Number(e.rows[0].id) };
}

async function initialInvoice(run, projectId, estimateId) {
  const r = await issueMilestoneInvoice(run, { projectId, economicKey: `estimate:${estimateId}:initial`, milestone: "Deposit", amountCents: 100000, source: "acceptance", estimateId, principal: owner });
  return r.invoice.id;
}

async function signContract(client, run, projectId) {
  const s = await client.query(
    `INSERT INTO signature_requests (project_id, doc_type, title, status, sent_at, signed_at, signed_name)
     VALUES ($1, 'contract', 'zz-Construction Contract', 'signed', now(), now(), 'ZZ Client') RETURNING id`,
    [projectId],
  );
  return onSignatureSigned(run, Number(s.rows[0].id), owner);
}

test("initial invoice keys", () => {
  assert.equal(isInitialInvoiceKey("estimate:16:initial"), true);
  assert.equal(isInitialInvoiceKey("draw:0:deposit-on-signing"), true);
  assert.equal(isInitialInvoiceKey("draw:1:rough-in-complete"), false);
  assert.equal(isInitialInvoiceKey(null), false);
});

test("signed contract, then the deposit is paid → construction, draft draw, one permit trigger", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    const { projectId, estimateId } = await seed(client, "zz-start-a");
    await signContract(client, run, projectId);
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction_contract", "signing alone does not start construction");
    const invId = await initialInvoice(run, projectId, estimateId);

    // A partial payment changes nothing.
    await recordInvoicePayment(run, { invoiceId: invId, kind: "payment", amountCents: 40000, method: "ach", principal: owner });
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction_contract");
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE kind = 'permit'`))[0].n, 0);

    // The rest lands: paid.
    await recordInvoicePayment(run, { invoiceId: invId, kind: "payment", amountCents: 60000, method: "ach", principal: owner });
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction");
    const kinds = (await run(`SELECT kind FROM project_workflow_events WHERE project_id = $1 ORDER BY id`, [projectId])).map((r) => r.kind);
    assert.ok(kinds.includes("initial_paid") && kinds.includes("construction_started"), kinds.join(","));
    assert.ok((await run(`SELECT initial_paid_at FROM project_workflows WHERE project_id = $1`, [projectId]))[0].initial_paid_at);

    const draws = await run(`SELECT status, amount, economic_key FROM invoices WHERE project_id = $1 AND economic_key LIKE 'draw:%'`, [projectId]);
    assert.deepEqual(draws.map((d) => [d.status, Number(d.amount), d.economic_key]), [["draft", 200000, "draw:1:construction-start"]], "construction-start draw drafted, not sent");
    const [trig] = await run(`SELECT kind, ref, project_id, payload FROM agent_triggers WHERE kind = 'permit'`);
    assert.equal(trig.ref, `project:${projectId}:permit`);
    assert.equal(trig.payload.address, "1271 Berkeley Ave, Saint Paul, MN 55105");
    assert.equal((await run(`SELECT count(*)::int AS n FROM notifications WHERE title = 'ZZ Start → Construction'`))[0].n, 1);

    // The projects-list total: pre-con $17,580 + the $10,000 contract; the
    // $1,000 deposit is collected; invoice-tracked from here on.
    const [pj] = await run(`SELECT contract_value, collected_to_date, progress, value_display, billing_source, opening_collected_cents::int AS opening, price_cents::int AS price FROM projects WHERE id = $1`, [projectId]);
    assert.deepEqual(pj, { contract_value: 27580, collected_to_date: 18580, progress: 67, value_display: "$27,580 ($10,000 contract + $17,580 pre-con)", billing_source: "invoices", opening: 1758000, price: 2758000 });
    // A later draw, once paid, moves collected and the bar on its own.
    const [draw] = await run(`SELECT id::int AS id FROM invoices WHERE project_id = $1 AND economic_key = 'draw:1:construction-start'`, [projectId]);
    await run(`UPDATE invoices SET status = 'sent' WHERE id = $1`, [draw.id]);
    await recordInvoicePayment(run, { invoiceId: draw.id, kind: "payment", amountCents: 200000, method: "check", principal: owner });
    const [pj2] = await run(`SELECT collected_to_date, progress FROM projects WHERE id = $1`, [projectId]);
    assert.deepEqual(pj2, { collected_to_date: 20580, progress: 75 });

    // Replays change nothing.
    await signContract(client, run, projectId);
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE kind = 'permit'`))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1 AND economic_key LIKE 'draw:%'`, [projectId]))[0].n, 1);
  });
});

test("deposit paid first, contract signed later → construction on signing", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    const { projectId, estimateId } = await seed(client, "zz-start-b");
    const invId = await initialInvoice(run, projectId, estimateId);
    await recordInvoicePayment(run, { invoiceId: invId, kind: "payment", amountCents: 100000, method: "check", principal: owner });
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction_contract", "no contract yet: stays put");
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE kind = 'permit'`))[0].n, 0);
    await signContract(client, run, projectId);
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction");
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE kind = 'permit'`))[0].n, 1);
  });
});

test("a paid progress draw is not a deposit: nothing starts", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    const { projectId, estimateId } = await seed(client, "zz-start-c");
    await signContract(client, run, projectId);
    const r = await issueMilestoneInvoice(run, { projectId, economicKey: "draw:2:final", milestone: "Final", amountCents: 5000, source: "draw", estimateId, principal: owner });
    await recordInvoicePayment(run, { invoiceId: r.invoice.id, kind: "payment", amountCents: 5000, method: "check", principal: owner });
    assert.equal((await run(`SELECT status FROM projects WHERE id = $1`, [projectId]))[0].status, "construction_contract");
  });
});
