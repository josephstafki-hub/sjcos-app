import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, assertNotProduction, ProductionTargetError, cleanFoundation } from "./_harness/testdb.mjs";
import { runCommand, CommandConflictError, hashInput } from "../lib/commands/core.ts";
import { enqueueIntent, claimIntents, finishAttempt, sweepExpiredLeases, getIntentByKey, IntentPayloadMismatchError } from "../lib/commands/intents.ts";
import { stageDecision, resolveDecision, consumeDecision, authorityFor } from "../lib/commands/decisions.ts";
import { recordSourceEvent, claimSourceEvents, finishSourceEvent } from "../lib/commands/source-events.ts";
import { activePolicy, proposePolicyVersion, activatePolicy, laneOpen, pauseLane } from "../lib/commands/policies.ts";

// V05 (commands), V07 (ambiguous send), V09 (approvals), V04 (intake), V14
// (decisions/kill switch) against a REAL disposable Postgres. Skipped only when
// the postgres binaries are missing — never redirected at production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const staff = { kind: "user", userId: null, role: "staff", name: "Sam", permissions: ["estimates"] };
const agentFor = (u) => ({ kind: "agent", agent: "claude", runId: null, onBehalfOf: u });
const unattended = { kind: "agent", agent: "hermes", runId: null, onBehalfOf: null };

async function seedUsers(client) {
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  const s = await client.query(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-staff@example.test','x','Sam','staff','S', ARRAY['estimates']) RETURNING id`);
  owner.userId = o.rows[0].id;
  staff.userId = s.rows[0].id;
}

/** A tx runner over a fresh client each call (real COMMIT/ROLLBACK). */
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

test("harness refuses the production database shape", () => {
  assert.throws(() => assertNotProduction("postgresql://sjcos:x@localhost:5432/sjcos"), ProductionTargetError);
  assert.throws(() => assertNotProduction("postgresql://sjcos:x@127.0.0.1/sjcos"), ProductionTargetError);
  assert.throws(() => assertNotProduction("postgresql://a@localhost:54100/sjcos_test"), ProductionTargetError, "unmarked url");
  assert.ok(assertNotProduction("postgresql://a@localhost/sjcos_test?host=%2Ftmp%2Fx&port=54100&application_name=sjc_test_harness"));
});

test("V05 commands: same key+input replays, changed input refuses, rollback leaves no intent, spoofed owner is just data", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seedUsers(client);
    const tx = txOver(url);
    let runs = 0;
    const handler = async ({ run, commandId }, input) => {
      runs++;
      const { intent } = await enqueueIntent(run, {
        operationKey: `test:email:${input.n}`,
        kind: "send_email",
        recipient: "Client@Example.test",
        payload: { subject: "hi", body: "x" },
        principal: owner,
        commandId,
      });
      if (input.fail) throw new Error("boom");
      return { result: { intentId: intent.id, n: input.n } };
    };
    const spec = { name: "test.send", requestKey: "k1", input: { n: 1 }, principal: owner, authRef: "owner" };
    const a = await runCommand(tx, spec, handler);
    const b = await runCommand(tx, spec, handler);
    assert.equal(runs, 1, "handler ran once");
    assert.equal(b.replayed, true);
    assert.deepEqual(a.result, b.result);
    await assert.rejects(runCommand(tx, { ...spec, input: { n: 2 } }, handler), CommandConflictError);
    // rollback → no dispatchable intent
    await assert.rejects(runCommand(tx, { name: "test.send", requestKey: "k2", input: { n: 9, fail: true }, principal: owner }, handler), /boom/);
    assert.equal(await getIntentByKey(async (s, p) => (await client.query(s, p)).rows, "test:email:9"), null);
    const cmd = await client.query(`SELECT status, error FROM commands WHERE name='test.send' AND request_key='k2'`);
    assert.equal(cmd.rows[0].status, "failed");
    // a caller cannot become the owner by saying so: principal is what the server passes, and
    // an agent with no human behind it has no authority
    const { decision } = await stageDecision(async (s, p) => (await client.query(s, p)).rows, {
      kind: "proposal", action: "send_estimate", title: "t", summary: {}, requestedBy: unattended, content: { a: 1 },
    });
    const verdict = await authorityFor(async (s, p) => (await client.query(s, p)).rows, unattended, decision);
    assert.equal(verdict.ok, false);
    // concurrent same-key callers: exactly one handler execution
    runs = 0;
    const spec3 = { name: "test.send", requestKey: "k3", input: { n: 3 }, principal: owner };
    const results = await Promise.all([runCommand(tx, spec3, handler), runCommand(tx, spec3, handler), runCommand(tx, spec3, handler)]);
    assert.equal(runs, 1);
    assert.equal(results.filter((r) => r.replayed).length, 2);
    assert.equal(hashInput({ b: 1, a: [1, { d: 2, c: 3 }] }), hashInput({ a: [1, { c: 3, d: 2 }], b: 1 }), "canonical hashing");
  });
});

test("V07 intents: one claim per intent, fenced writes, accepted-then-timeout is unknown (held), retryable backs off, expired lease → unknown", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const { intent, created } = await enqueueIntent(run, { operationKey: "test:po:1:send", kind: "send_purchase_order", payload: { po: 1 }, principal: owner });
    assert.equal(created, true);
    const again = await enqueueIntent(run, { operationKey: "test:po:1:send", kind: "send_purchase_order", payload: { po: 1 }, principal: owner });
    assert.equal(again.created, false);
    assert.equal(again.intent.id, intent.id);
    await assert.rejects(enqueueIntent(run, { operationKey: "test:po:1:send", kind: "send_purchase_order", payload: { po: 2 }, principal: owner }), IntentPayloadMismatchError);

    // two workers race: only one gets it
    const c2 = new pg.Client({ connectionString: url });
    await c2.connect();
    const run2 = async (s, p) => (await c2.query(s, p)).rows;
    await client.query("BEGIN");
    const w1 = await claimIntents(run, { kinds: ["send_purchase_order"], worker: "w1" });
    const w2p = claimIntents(run2, { kinds: ["send_purchase_order"], worker: "w2" });
    await client.query("COMMIT");
    const w2 = await w2p;
    assert.equal(w1.intents.length + w2.intents.length, 1, "exactly one claim");
    const winner = w1.intents.length ? { token: w1.token, r: run } : { token: w2.token, r: run2 };
    const loserToken = w1.intents.length ? w2.token : w1.token;
    // stale token cannot flip state
    assert.equal(await finishAttempt(run, intent.id, loserToken, "stale", { responseClass: "confirmed" }), null);
    // accepted then timeout → unknown, no auto-retry
    assert.equal(await finishAttempt(winner.r, intent.id, winner.token, "w", { responseClass: "unknown", error: "timeout after transmit" }), "unknown");
    const held = await claimIntents(run, { kinds: ["send_purchase_order"], worker: "w3" });
    assert.equal(held.intents.length, 0, "unknown is never re-dispatched");
    const [row] = await run(`SELECT state, attempts FROM action_intents WHERE id = $1`, [intent.id]);
    assert.equal(row.state, "unknown");
    const attempts = await run(`SELECT count(*)::int AS n FROM action_attempts WHERE intent_id = $1`, [intent.id]);
    assert.equal(attempts[0].n, 1);

    // retryable → backoff → eventually permanent
    const { intent: i2 } = await enqueueIntent(run, { operationKey: "test:sms:1", kind: "send_sms", payload: { to: "+1" }, principal: owner, maxAttempts: 2 });
    const c1 = await claimIntents(run, { kinds: ["send_sms"], worker: "w" });
    assert.equal(await finishAttempt(run, i2.id, c1.token, "w", { responseClass: "retryable", error: "429", retryInSeconds: 0 }), "retryable_failure");
    const c2b = await claimIntents(run, { kinds: ["send_sms"], worker: "w" });
    assert.equal(c2b.intents.length, 1);
    assert.equal(await finishAttempt(run, i2.id, c2b.token, "w", { responseClass: "retryable", error: "429" }), "permanent_failure");

    // expired lease (worker died mid-call) → unknown
    const { intent: i3 } = await enqueueIntent(run, { operationKey: "test:email:3", kind: "send_email", payload: {}, principal: owner });
    await claimIntents(run, { kinds: ["send_email"], worker: "w", leaseSeconds: -1 });
    const swept = await sweepExpiredLeases(run);
    assert.equal(swept.unknown, 1);
    assert.equal((await run(`SELECT state FROM action_intents WHERE id = $1`, [i3.id]))[0].state, "unknown");
    await c2.end();
  });
});

test("V09/V14 decisions: exact binding, first tap wins across channels, staff needs authority, revocation bites, changed content needs fresh approval", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seedUsers(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const content = { package: 12, rev: 1, lines: ["a", "b"] };
    const { decision, created } = await stageDecision(run, {
      kind: "package_release", action: "send_bid_package", title: "Bid package 12 → Dave", summary: { recipients: [{ name: "Dave" }], exclusions: ["Joe's trim"] },
      targetKind: "bid_package", targetId: 12, recipient: "dave@sub.test", content, dedupeKey: "bid:12", requestedBy: agentFor(owner),
    });
    assert.equal(created, true);
    // same content re-staged → same decision, no duplicate
    const dup = await stageDecision(run, { kind: "package_release", action: "send_bid_package", title: "x", summary: {}, targetKind: "bid_package", targetId: 12, recipient: "dave@sub.test", content, dedupeKey: "bid:12", requestedBy: agentFor(owner) });
    assert.equal(dup.created, false);
    assert.equal(dup.decision.id, decision.id);
    // staff without authority
    const denied = await resolveDecision(run, { id: decision.id, outcome: "approved", principal: staff, via: "app" });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "unauthorized");
    // agent acting for staff is still staff
    const deniedAgent = await resolveDecision(run, { id: decision.id, outcome: "approved", principal: agentFor(staff), via: "mcp" });
    assert.equal(deniedAgent.ok, false);
    // consume before approval refuses
    assert.equal((await consumeDecision(run, { id: decision.id, action: "send_bid_package", contentHash: decision.content_hash, recipient: "dave@sub.test", consumer: "t" })).ok, false);
    // owner approves on telegram; repeat tap on app is ignored
    const ok = await resolveDecision(run, { id: decision.id, outcome: "approved", principal: owner, via: "telegram" });
    assert.equal(ok.ok, true);
    const replay = await resolveDecision(run, { id: decision.id, outcome: "rejected", principal: owner, via: "app" });
    assert.equal(replay.ok, false);
    assert.equal(replay.code, "already_resolved");
    assert.equal(replay.decision.status, "approved");
    // consume: wrong recipient / changed content refused; exact match spends once
    assert.match((await consumeDecision(run, { id: decision.id, action: "send_bid_package", contentHash: decision.content_hash, recipient: "other@sub.test", consumer: "t" })).reason, /dave@sub.test/);
    assert.match((await consumeDecision(run, { id: decision.id, action: "send_bid_package", contentHash: "deadbeef", recipient: "dave@sub.test", consumer: "t" })).reason, /changed/);
    const spend = await consumeDecision(run, { id: decision.id, action: "send_bid_package", contentHash: decision.content_hash, recipient: "dave@sub.test", consumer: "t" });
    assert.equal(spend.ok, true);
    assert.equal(spend.decision.status, "consumed");
    assert.equal((await consumeDecision(run, { id: decision.id, action: "send_bid_package", contentHash: decision.content_hash, recipient: "dave@sub.test", consumer: "t" })).ok, false, "single use");
    const events = await run(`SELECT kind FROM decision_events WHERE decision_id = $1 ORDER BY id`, [decision.id]);
    assert.deepEqual(events.map((e) => e.kind), ["staged", "unauthorized", "unauthorized", "approved", "replay_ignored", "consumed"]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM owner_touches WHERE decision_id = $1`, [decision.id]))[0].n, 1, "owner touch measured");

    // changed content supersedes the pending decision
    const d2 = await stageDecision(run, { kind: "package_release", action: "send_bid_package", title: "x", summary: {}, targetKind: "bid_package", targetId: 13, recipient: "dave@sub.test", content: { rev: 1 }, dedupeKey: "bid:13", requestedBy: owner });
    const d3 = await stageDecision(run, { kind: "package_release", action: "send_bid_package", title: "x", summary: {}, targetKind: "bid_package", targetId: 13, recipient: "dave@sub.test", content: { rev: 2 }, dedupeKey: "bid:13", requestedBy: owner });
    assert.equal(d3.superseded, d2.decision.id);
    const stale = await resolveDecision(run, { id: d2.decision.id, outcome: "approved", principal: owner, via: "push" });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "already_resolved");

    // staff with a bounded authority grant: amount limit and project scope apply; revocation bites without re-login
    const [proj] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-auth-p', 'ZZ', 'construction', 'ZZ') RETURNING id`);
    await run(`INSERT INTO authority_grants (user_id, action_type, project_id, max_amount_cents, granted_by) VALUES ($1, 'purchase', $2, 50000, $3)`, [staff.userId, proj.id, owner.userId]);
    const small = await stageDecision(run, { kind: "purchase", action: "send_purchase_order", title: "PO", summary: {}, amountCents: 40000, projectId: proj.id, content: { po: 1 }, requestedBy: owner });
    const big = await stageDecision(run, { kind: "purchase", action: "send_purchase_order", title: "PO", summary: {}, amountCents: 90000, projectId: proj.id, content: { po: 2 }, requestedBy: owner });
    const elsewhere = await stageDecision(run, { kind: "purchase", action: "send_purchase_order", title: "PO", summary: {}, amountCents: 100, projectId: null, content: { po: 3 }, requestedBy: owner });
    assert.equal((await resolveDecision(run, { id: big.decision.id, outcome: "approved", principal: staff, via: "app" })).code, "unauthorized");
    assert.equal((await resolveDecision(run, { id: elsewhere.decision.id, outcome: "approved", principal: staff, via: "app" })).code, "unauthorized");
    assert.equal((await resolveDecision(run, { id: small.decision.id, outcome: "approved", principal: staff, via: "app" })).ok, true);
    await run(`UPDATE authority_grants SET revoked_at = now() WHERE user_id = $1`, [staff.userId]);
    const after = await stageDecision(run, { kind: "purchase", action: "send_purchase_order", title: "PO", summary: {}, amountCents: 100, projectId: proj.id, content: { po: 4 }, requestedBy: owner });
    assert.equal((await resolveDecision(run, { id: after.decision.id, outcome: "approved", principal: staff, via: "telegram" })).code, "unauthorized", "revoked grant, stale button");
    // expiry
    await run(`UPDATE decisions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [after.decision.id]);
    assert.equal((await resolveDecision(run, { id: after.decision.id, outcome: "approved", principal: owner, via: "app" })).code, "expired");
  });
});

test("V04 intake + policies + lanes: duplicate event is not re-created, lease/finish, policy versions, kill switch", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const a = await recordSourceEvent(run, { provider: "square", account: "L1", eventId: "ev1", eventType: "payment.updated", payload: { id: 1 }, verified: true });
    const b = await recordSourceEvent(run, { provider: "square", account: "L1", eventId: "ev1", eventType: "payment.updated", payload: { id: 1 }, verified: true });
    const c = await recordSourceEvent(run, { provider: "square", account: "L2", eventId: "ev1", eventType: "payment.updated", payload: { id: 1 }, verified: true });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(c.created, true, "account is part of identity");
    const claim = await claimSourceEvents(run, { provider: "square" });
    assert.equal(claim.events.length, 2);
    assert.equal(await finishSourceEvent(run, claim.events[0].id, claim.token, { ok: true }), true);
    assert.equal(await finishSourceEvent(run, claim.events[1].id, "wrong-token", { ok: true }), false);
    assert.equal(await finishSourceEvent(run, claim.events[1].id, claim.token, { ok: false, error: "db down", retryInSeconds: 0 }), true);
    const again = await claimSourceEvents(run, { provider: "square" });
    assert.equal(again.events.length, 1, "failed event comes back; done one does not");

    assert.equal(await activePolicy(run, "routine.followup"), null);
    const v1 = await proposePolicyVersion(run, "routine.followup", { cadenceDays: [2, 5] }, "test");
    assert.equal(await activePolicy(run, "routine.followup"), null, "draft is not active");
    await activatePolicy(run, "routine.followup", v1.version);
    const v2 = await proposePolicyVersion(run, "routine.followup", { cadenceDays: [3] }, "test");
    await activatePolicy(run, "routine.followup", v2.version);
    const act = await activePolicy(run, "routine.followup");
    assert.equal(act.version, 2);
    assert.equal((await run(`SELECT count(*)::int AS n FROM policies WHERE key='routine.followup' AND state='active'`))[0].n, 1);

    assert.deepEqual(await laneOpen(run, "sends"), { open: true });
    await pauseLane(run, "all", "joe", "incident");
    assert.equal((await laneOpen(run, "sends")).open, false);
  });
});
