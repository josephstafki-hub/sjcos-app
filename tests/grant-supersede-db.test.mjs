// A re-ask for the same send retires the earlier waiting request, against a
// REAL Postgres (lib/decisions/grants.ts supersedeEarlierGrantRequests):
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/grant-supersede-db.test.mjs
//
// Skipped without that variable. Everything happens inside ONE transaction
// that is rolled back, so this leaves nothing behind.
//
// Joe 2026-10-29: after he asked for changes, the agent filed a revised
// request and the old one kept waiting next to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { stageGrantDecision, supersedeEarlierGrantRequests } from "../lib/decisions/grants.ts";

const url = process.env.FIN_TEST_DATABASE_URL;

const COLS = `id, status, actions, target_kind, target_id, scope, reason, requested_by, max_uses, uses,
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, audit, decision_id`;

test("a newer request for the same send replaces the older one", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  const agent = { kind: "agent", agent: "zz-agent", runId: null, onBehalfOf: null };
  const ask = async (action, kind, target, minutesAgo) => {
    const [g] = await run(
      `INSERT INTO owner_grants (status, actions, target_kind, target_id, scope, reason, requested_by, max_uses, expires_at, created_at)
       VALUES ('requested', ARRAY[$1]::text[], $2, $3, '{}'::jsonb, 'ZZ supersede test', 'zz-agent', 1, now() + interval '1 day', now() - ($4::int * interval '1 minute'))
       RETURNING ${COLS}`,
      [action, kind, target, minutesAgo],
    );
    const { decision } = await stageGrantDecision(run, g, agent);
    return { ...g, decision_id: decision.id };
  };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");

    const older = await ask("send_invoice", "invoice", "999001", 10);
    const otherInvoice = await ask("send_invoice", "invoice", "999002", 9);
    const otherAction = await ask("send_purchase_order", "purchase_order", "999001", 8);
    const sameAddressOld = await ask("send_email", "email", "ZZ-Sam@Example.test", 7);
    const [parked] = await run(
      `INSERT INTO action_intents (operation_key, kind, target_kind, target_id, recipient, payload, payload_hash, grant_id, state, hold_reason)
       VALUES ('zz:supersede:parked', 'send_invoice', 'invoice', '999001', 'zz@example.test', '{}'::jsonb, 'zz', $1, 'held', 'awaiting grant')
       RETURNING id`,
      [older.id],
    );
    const newer = await ask("send_invoice", "invoice", "999001", 0);

    const replaced = await supersedeEarlierGrantRequests(run, newer, newer.decision_id);
    assert.deepEqual(replaced.map((r) => r.id), [older.id]);

    const [o] = await run(`SELECT status, audit FROM owner_grants WHERE id = $1`, [older.id]);
    assert.equal(o.status, "revoked");
    assert.equal(o.audit.at(-1).result, "replaced");
    assert.match(o.audit.at(-1).note, new RegExp(newer.id));

    const [od] = await run(`SELECT status, superseded_by FROM decisions WHERE id = $1`, [older.decision_id]);
    assert.equal(od.status, "superseded");
    assert.equal(od.superseded_by, newer.decision_id);

    const [pi] = await run(`SELECT state FROM action_intents WHERE id = $1`, [parked.id]);
    assert.equal(pi.state, "cancelled");

    // Different invoice, different action, and the new request itself: untouched.
    const still = await run(`SELECT id FROM owner_grants WHERE id = ANY($1::uuid[]) AND status = 'requested'`, [[otherInvoice.id, otherAction.id, newer.id]]);
    assert.equal(still.length, 3);
    const [nd] = await run(`SELECT status FROM decisions WHERE id = $1`, [newer.decision_id]);
    assert.equal(nd.status, "pending");

    // Email addresses match case-insensitively.
    const sameAddressNew = await ask("send_email", "email", "zz-sam@example.test", 0);
    const r2 = await supersedeEarlierGrantRequests(run, sameAddressNew, sameAddressNew.decision_id);
    assert.deepEqual(r2.map((r) => r.id), [sameAddressOld.id]);

    // No target → nothing to match on, nothing retired.
    assert.deepEqual(await supersedeEarlierGrantRequests(run, { ...newer, target_id: null }, newer.decision_id), []);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
