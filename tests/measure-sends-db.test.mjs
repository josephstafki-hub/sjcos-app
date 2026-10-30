import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { enqueueIntent } from "../lib/commands/intents.ts";
import { stageDecision } from "../lib/commands/decisions.ts";
import { proposeMarkupChange } from "../lib/estimating/learning.ts";
import { resolveFromChannel } from "../lib/decisions/resolve.ts";

// Tier 3 (A18): every send is a measurement case (migration 0051 trigger),
// and the default markup changes only through its decision.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const staff = { kind: "user", userId: null, role: "staff", name: "Abigail", permissions: ["cost_book"] };

test("sends open a measurement case with the right mode and close it with the outcome", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`TRUNCATE measurement_cases RESTART IDENTITY CASCADE`);
    const mk = async (key, extra) => (await enqueueIntent(run, { operationKey: key, kind: "send_email", recipient: "c@example.test", payload: { to: "c@example.test" }, principal: owner, ...extra })).intent;
    const policySend = await mk("zz-m1", { policyRef: "policy:payment.receipt@1" });
    const ownerSend = await mk("zz-m2", { policyRef: "owner:click" });
    const d = (await stageDecision(run, { kind: "other", action: "send_email", title: "zz", summary: {}, requestedBy: owner })).decision;
    const cardSend = await mk("zz-m3", { decisionId: d.id });
    const cases = async () => Object.fromEntries((await run(`SELECT ref_id, kind, mode, outcome, auth_ref, closed_at FROM measurement_cases WHERE ref_kind = 'intent'`)).map((c) => [c.ref_id, c]));
    let c = await cases();
    assert.equal(c[policySend.id].mode, "unattended");
    assert.equal(c[policySend.id].kind, "send:send_email");
    assert.equal(c[ownerSend.id].mode, "manual");
    assert.equal(c[cardSend.id].mode, "one_tap");
    assert.equal(c[cardSend.id].auth_ref, `decision:${d.id}`);
    assert.equal(c[policySend.id].outcome, "pending");

    await run(`UPDATE action_intents SET state = 'accepted' WHERE id = $1`, [policySend.id]);
    await run(`UPDATE action_intents SET state = 'permanent_failure', last_error = 'bounced' WHERE id = $1`, [ownerSend.id]);
    await run(`UPDATE action_intents SET state = 'cancelled', last_error = 'Joe rejected it' WHERE id = $1`, [cardSend.id]);
    c = await cases();
    assert.equal(c[policySend.id].outcome, "verified_success");
    assert.ok(c[policySend.id].closed_at);
    assert.equal(c[ownerSend.id].outcome, "failed");
    assert.equal(c[cardSend.id].outcome, "corrected");
    // Accepted → confirmed later doesn't reopen or double-count.
    await run(`UPDATE action_intents SET state = 'confirmed' WHERE id = $1`, [policySend.id]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM measurement_cases`))[0].n, 3);
  });
});

test("default markup: a staff change is a card; approving it changes the pricing setup and the setting", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`DELETE FROM pricing_setups`);
    await client.query(`DELETE FROM cost_learning_revisions`);
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '25') ON CONFLICT (key) DO UPDATE SET value = '25'`);
    await client.query(`INSERT INTO pricing_setups (version, state, config, evidence, proposed_by, activated_at) VALUES (1, 'active', '{"markup_pct":25}', '{}', 'test', now())`);

    const p = await proposeMarkupChange(run, { markup_pct: 30, reason: "Set from the Cost book by Abigail", principal: staff });
    assert.equal(p.current_pct, 25);
    assert.equal((await run(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`))[0].value, "25", "nothing changes until Joe approves");

    await client.query("BEGIN");
    const r = await resolveFromChannel(run, { decisionId: p.decision_id, via: "app", principal: owner, outcome: "approved" });
    await client.query("COMMIT");
    assert.equal(r.ok, true, r.reply);
    assert.match(r.reply, /Default markup is now 30%/);
    assert.equal((await run(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`))[0].value, "30");
    const [active] = await run(`SELECT version, config FROM pricing_setups WHERE state = 'active'`);
    assert.equal(active.version, 2);
    assert.equal(active.config.markup_pct, 30);
  });
});
