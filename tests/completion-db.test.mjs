import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, loadSchema } from "./_harness/testdb.mjs";
import { completeWorkItem, recordRevision } from "../lib/completion/complete.ts";
import { ensureCallFollowUps } from "../lib/completion/call-followups.ts";
import { startRunbookTx } from "../lib/completion/runbook-core.ts";
import { enqueueIntent } from "../lib/commands/intents.ts";
import { createOrTouchObligation, resolveObligation, getObligation } from "../lib/obligations/core.ts";

// A04 — evidence-backed completion against a REAL disposable Postgres
// (VALIDATION.md V06). Skipped only when the postgres binaries are missing.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

// Own database per test FILE on the shared harness cluster: node --test runs
// files in parallel and the foundation tests truncate shared tables, so a
// shared sjcos_test would race. Created once per file, cleaned per test.
const OWN_DB = "sjcos_test_completion";
let ownUrl = null;
async function withDb(fn) {
  if (!ownUrl) {
    ownUrl = withTestDb(async (url) => {
      const admin = url.replace("/sjcos_test?", "/postgres?");
      const own = url.replace("/sjcos_test?", `/${OWN_DB}?`);
      const a = new pg.Client({ connectionString: admin });
      await a.connect();
      try {
        await a.query(`DROP DATABASE IF EXISTS ${OWN_DB} WITH (FORCE)`);
        await a.query(`CREATE DATABASE ${OWN_DB}`);
      } finally {
        await a.end();
      }
      await loadSchema(own);
      return own;
    });
  }
  const url = await ownUrl;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(url, client);
  } finally {
    await client.end();
  }
}

const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: null };

function txOver(url) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const run = async (sql, params) => (await c.query(sql, params)).rows;
    try {
      await c.query("BEGIN");
      const out = await fn(run);
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

async function clean(client) {
  await client.query(`TRUNCATE work_items, obligations, runbook_instances, agent_runs, agent_receipts, action_intents, action_attempts, calls, knowledge_items, commands RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM runbook_definition_versions WHERE runbook_slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM runbooks WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM leads WHERE slug LIKE 'zz-%'`);
}

const receipts = async (client, id) => (await client.query(`SELECT * FROM agent_receipts WHERE work_item_id = $1 ORDER BY created_at`, [id])).rows;
const status = async (client, id) => (await client.query(`SELECT status FROM work_items WHERE id = $1`, [id])).rows[0].status;

test("V06 missing / wrong / stale evidence is refused; a valid retry writes exactly one receipt", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const tx = txOver(url);
    const lead = (await client.query(`INSERT INTO leads (slug, name) VALUES ('zz-c-lead', 'ZZ') RETURNING id`)).rows[0].id;
    const rb = (await client.query(`INSERT INTO runbooks (slug, title) VALUES ('zz-c-runbook', 'ZZ C') RETURNING id`)).rows[0].id;
    await client.query(
      `INSERT INTO runbook_steps (runbook_id, step_order, title, assigned_to, required_evidence) VALUES ($1, 1, 'Draft it', 'agent', 'draft'), ($1, 2, 'Send it', 'agent', 'provider_accepted')`,
      [rb],
    );
    const start = await tx((run) => startRunbookTx(run, "zz-c-runbook", { leadId: lead }, "test"));
    const step1 = start.workItemId;

    // Missing.
    const r0 = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: null }));
    assert.equal(r0.ok, false);
    // Wrong kind for the contract.
    const r1 = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: { kind: "manual", actor: "claude", reason: "I wrote it" } }));
    assert.equal(r1.ok, false);
    assert.match(r1.error, /requires 'draft'/);
    // Right kind, artifact does not exist.
    const r2 = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: { kind: "draft", knowledge_item_id: "00000000-0000-0000-0000-000000000001" } }));
    assert.equal(r2.ok, false);
    assert.match(r2.error, /does not exist/);
    // A description is not an artifact.
    const r3 = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: { kind: "draft", label: "trust me" } }));
    assert.equal(r3.ok, false);
    assert.equal(await status(client, step1), "queued");
    assert.equal((await receipts(client, step1)).length, 0, "refusals write no receipt");

    // Valid: the draft exists.
    const k = (await client.query(`INSERT INTO knowledge_items (content, kind, source) VALUES ('Dear client…', 'draft', 'agent') RETURNING id`)).rows[0].id;
    const ok = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: { kind: "draft", knowledge_item_id: k } }));
    assert.equal(ok.ok, true);
    assert.equal(ok.alreadyDone, false);
    assert.equal(ok.required, "draft");
    assert.equal(ok.runbook.outcome, "advanced", "successor spawned in the same transaction");
    assert.equal(await status(client, step1), "done");
    const rs = await receipts(client, step1);
    assert.equal(rs.length, 1);
    assert.equal(rs[0].receipt_kind, "draft");
    assert.equal(rs[0].metadata.knowledge_item_id, k);
    assert.equal(rs[0].metadata.principal.agent, "claude");
    // Retry of the same completion: idempotent, no second receipt, no second successor.
    const again = await tx((run) => completeWorkItem(run, { workItemId: step1, principal: agent, evidence: { kind: "draft", knowledge_item_id: k } }));
    assert.equal(again.ok, true);
    assert.equal(again.alreadyDone, true);
    assert.equal((await receipts(client, step1)).length, 1);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE runbook_instance_id = $1`, [start.instanceId])).rows[0].n, 2);

    // Step 2 needs provider acceptance: a pending intent is not proof; an accepted one is.
    const step2 = (await client.query(`SELECT id FROM work_items WHERE runbook_instance_id = $1 AND runbook_step_order = 2`, [start.instanceId])).rows[0].id;
    const { intent } = await tx((run) => enqueueIntent(run, { operationKey: "zz:send:1", kind: "send_email", payload: { a: 1 }, principal: owner }));
    const pend = await tx((run) => completeWorkItem(run, { workItemId: step2, principal: agent, evidence: { kind: "provider_accepted", intent_id: intent.id } }));
    assert.equal(pend.ok, false);
    assert.match(pend.error, /'pending'/);
    await client.query(`UPDATE action_intents SET state = 'accepted', provider_ref = 'gm-123' WHERE id = $1`, [intent.id]);
    const deliveredTooStrong = await tx((run) => completeWorkItem(run, { workItemId: step2, principal: agent, evidence: { kind: "delivered", intent_id: intent.id } }));
    assert.equal(deliveredTooStrong.ok, false, "accepted is not delivered");
    const acc = await tx((run) => completeWorkItem(run, { workItemId: step2, principal: agent, evidence: { kind: "provider_accepted", intent_id: intent.id } }));
    assert.equal(acc.ok, true);
    assert.equal(acc.runbook.outcome, "done");
    assert.equal((await receipts(client, step2))[0].uri, "gm-123");
  });
});

test("V06 record evidence checks the revision; manual completion on a legacy item is reported, not blocked; obligations resolve with the item", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const tx = txOver(url);
    const run0 = async (sql, p) => (await client.query(sql, p)).rows;
    const lead = (await client.query(`INSERT INTO leads (slug, name) VALUES ('zz-r-lead', 'ZZ R') RETURNING id`)).rows[0].id;
    const ob = await createOrTouchObligation(run0, { source: { provider: "gmail", threadId: "t-r", messageId: "m-r" }, title: "Reply about tile", leadId: lead, createdBy: "test" });
    const item = (await client.query(
      `INSERT INTO work_items (title, body, status, lead_id, obligation_id, created_by) VALUES ('Reply about tile', '', 'queued', $1, $2, 'test') RETURNING id`,
      [lead, ob.obligation.id],
    )).rows[0].id;

    // Stale record: the lead changed after the caller read it.
    const rev = await recordRevision(run0, "leads", lead);
    assert.ok(rev);
    await client.query(`SELECT pg_sleep(0.01)`);
    await client.query(`UPDATE leads SET name = 'ZZ R2' WHERE id = $1`, [lead]);
    const stale = await tx((run) => completeWorkItem(run, { workItemId: item, principal: owner, evidence: { kind: "record", table: "leads", id: lead, revision: rev } }));
    assert.equal(stale.ok, false);
    assert.match(stale.error, /stale/);
    const bogus = await tx((run) => completeWorkItem(run, { workItemId: item, principal: owner, evidence: { kind: "record", table: "users", id: lead, revision: rev } }));
    assert.equal(bogus.ok, false, "table not in the accepted set");
    const noReason = await tx((run) => completeWorkItem(run, { workItemId: item, principal: owner, evidence: { kind: "manual", actor: "Joe", reason: " " } }));
    assert.equal(noReason.ok, false);
    assert.equal(await status(client, item), "queued");

    // Legacy item (no contract): manual with actor + reason is accepted and reported.
    const manual = await tx((run) => completeWorkItem(run, { workItemId: item, principal: owner, evidence: { kind: "manual", actor: "Joe", reason: "answered by phone" }, note: "phoned" }));
    assert.equal(manual.ok, true);
    assert.equal(manual.legacy, true);
    assert.equal(manual.required, "any");
    const rs = await receipts(client, item);
    assert.equal(rs.length, 1);
    assert.equal(rs[0].receipt_kind, "manual");
    assert.equal(rs[0].uri, null, "no invented provider receipt");
    assert.deepEqual({ actor: rs[0].metadata.actor, reason: rs[0].metadata.reason }, { actor: "Joe", reason: "answered by phone" });
    const o = await getObligation(run0, ob.obligation.id);
    assert.equal(o.status, "done");
    assert.equal(o.resolution.kind, "work_item_done");
    assert.equal(o.resolution.receipt_id, rs[0].id);

    // business_response needs a RESOLVED obligation.
    const ob2 = await createOrTouchObligation(run0, { source: { provider: "gmail", threadId: "t-b", messageId: "m-b" }, title: "Waiting on them", createdBy: "test" });
    const item2 = (await client.query(`INSERT INTO work_items (title, status, created_by) VALUES ('Chase them', 'queued', 'test') RETURNING id`)).rows[0].id;
    const notYet = await tx((run) => completeWorkItem(run, { workItemId: item2, principal: owner, evidence: { kind: "business_response", obligation_id: ob2.obligation.id } }));
    assert.equal(notYet.ok, false);
    await resolveObligation(run0, ob2.obligation.id, { kind: "business_response", message_id: "m-b2" }, "gmail");
    const yes = await tx((run) => completeWorkItem(run, { workItemId: item2, principal: owner, evidence: { kind: "business_response", obligation_id: ob2.obligation.id } }));
    assert.equal(yes.ok, true);
    assert.equal(yes.legacy, false);
  });
});

test("V06 call follow-ups: a partial failure resumes only the missing actions; nothing is created twice", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const tx = txOver(url);
    const lead = (await client.query(`INSERT INTO leads (slug, name) VALUES ('zz-call-lead', 'ZZ Call') RETURNING id`)).rows[0].id;
    const vm = (await client.query(`INSERT INTO work_items (title, body, status, created_by) VALUES ('Voicemail from ZZ', 'callback', 'queued', 'voice') RETURNING id`)).rows[0].id;
    const notes = {
      summary: "Talked about the deck.",
      decisions: [],
      action_items: [
        { text: "Send the deck estimate", owner: "Joe", due: null },
        { text: "Pick a stain colour", owner: "client", due: null },
        { text: "Call the railing supplier", owner: "we", due: "2026-10-01" },
      ],
      flags: [],
    };
    const call = (await client.query(
      `INSERT INTO calls (direction, counterparty_number, business_number, contact_name, lead_id, status, notes, notes_status, work_item_id)
       VALUES ('inbound', '+16125550100', '+16125550199', 'ZZ Call', $1, 'completed', $2::jsonb, 'done', $3) RETURNING id`,
      [lead, JSON.stringify(notes), vm],
    )).rows[0].id;

    const first = await tx((run) => ensureCallFollowUps(run, call, { by: "test" }));
    assert.deepEqual(first.created.map((c) => c.key), [`call:${call}:action:0`, `call:${call}:action:2`], "only Joe's actions");
    assert.equal(first.voicemailNote, "appended");
    const dueItem = (await client.query(`SELECT due_at, snoozed_until, obligation_id FROM work_items WHERE source_id = $1`, [`call:${call}:action:2`])).rows[0];
    assert.ok(dueItem.due_at);
    assert.ok(dueItem.snoozed_until, "future due day → snoozed by the Central trigger");
    assert.ok(dueItem.obligation_id);

    // Partial failure: one of the two items is lost; re-run recreates only it.
    await client.query(`DELETE FROM work_items WHERE source_id = $1`, [`call:${call}:action:0`]);
    const second = await tx((run) => ensureCallFollowUps(run, call, { by: "test" }));
    assert.deepEqual(second.created.map((c) => c.key), [`call:${call}:action:0`]);
    assert.deepEqual(second.existing.map((c) => c.key), [`call:${call}:action:2`]);
    assert.equal(second.voicemailNote, "already");
    const third = await tx((run) => ensureCallFollowUps(run, call, { by: "test" }));
    assert.deepEqual(third.created, []);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_kind = 'call'`)).rows[0].n, 2);
    const body = (await client.query(`SELECT body FROM work_items WHERE id = $1`, [vm])).rows[0].body;
    assert.equal((body.match(/Voicemail:/g) ?? []).length, 1, "summary appended once");

    // A Joe-completed action is not resurrected by a later re-run.
    await client.query(`UPDATE work_items SET status = 'done' WHERE source_id = $1`, [`call:${call}:action:2`]);
    const fourth = await tx((run) => ensureCallFollowUps(run, call, { by: "test" }));
    assert.deepEqual(fourth.created, []);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_kind = 'call'`)).rows[0].n, 2);
  });
});
