import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { onInboundMessage, onClientSelection, onMoodBoardApproved, onPaymentReceived, onQuoteRecorded, onSubReport, EVENT_WAKEUPS_POLICY } from "../lib/agent-runtime/hooks.ts";
import { activatePolicy, proposePolicyVersion, disablePolicy } from "../lib/commands/policies.ts";
import { readFileSync } from "node:fs";

// Tier 3 (A24): what clients, subs and suppliers do wakes the operating
// agent, but only while Joe has agent.event_wakeups on (seeded off, 0049),
// and only for the kinds it lists.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("event wake-ups: off by default; on → one trigger per event, per kind; a message needs a job or lead", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`TRUNCATE agent_triggers RESTART IDENTITY CASCADE`).catch(() => {});
    await client.query(`DELETE FROM projects WHERE slug = 'zz-wake'`);
    // cleanFoundation empties policies: put the 0049 seed back as shipped.
    await client.query(readFileSync(new URL("../db/migrations/0049_agent_event_wakeups_policy.sql", import.meta.url), "utf8"));
    const [seeded] = await run(`SELECT state FROM policies WHERE key = $1 AND version = 1`, [EVENT_WAKEUPS_POLICY]);
    assert.equal(seeded.state, "draft", "ships off");

    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-wake', 'ZZ Wake', 'construction', 'ZZ') RETURNING id`);
    const [sel] = await run(`INSERT INTO project_selections (project_id, area, status, choice, price, decided_at) VALUES ($1, 'Kitchen faucet', 'approved', 'Delta Trinsic', 42900, now()) RETURNING id`, [p.id]);

    // Off: nothing wakes.
    assert.equal(await onInboundMessage(run, { provider: "sms", messageId: "m1", projectId: p.id, text: "Can we move Tuesday?" }), null);
    assert.equal(await onClientSelection(run, Number(sel.id)), null);
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers`))[0].n, 0);

    // Joe turns it on.
    await activatePolicy(run, EVENT_WAKEUPS_POLICY, 1);
    const m = await onInboundMessage(run, { provider: "sms", messageId: "m1", projectId: p.id, from: "ZZ", text: "Can we move Tuesday?" });
    assert.equal(m.kind, "message");
    assert.equal(m.ref, "sms:m1");
    assert.equal(await onInboundMessage(run, { provider: "sms", messageId: "m2", text: "unknown number" }), null, "a stranger's text wakes nothing");
    const s1 = await onClientSelection(run, Number(sel.id));
    assert.equal(s1.kind, "selection");
    assert.equal(s1.payload.choice, "Delta Trinsic");
    const mood = await onMoodBoardApproved(run, { projectId: p.id, room: "Kitchen", approvedName: "ZZ" });
    assert.equal(mood.ref, `mood_board:${p.id}:Kitchen:approved`);
    const [inv] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status) VALUES ($1, 'INV-W1', 'Deposit', 100000, 'sent') RETURNING id`, [p.id]);
    const pay = await onPaymentReceived(run, { attemptId: "00000000-0000-0000-0000-0000000000aa", invoiceId: Number(inv.id), amountCents: 100000, method: "card" });
    assert.equal(pay.kind, "payment");
    assert.equal(pay.project_id, p.id);
    await run(`INSERT INTO subs (slug, name, trade) VALUES ('zz-wake-sub', 'ZZ Tile', 'Tile') ON CONFLICT DO NOTHING`);
    const [pkg] = await run(`INSERT INTO bid_packages (project_id, title, trade) VALUES ($1, 'Tile', 'Tile') RETURNING id`, [p.id]);
    const [invt] = await run(`INSERT INTO bid_invites (package_id, sub_slug) VALUES ($1, 'zz-wake-sub') RETURNING id`, [pkg.id]);
    const [bid] = await run(`INSERT INTO bid_submissions (invite_id, total) VALUES ($1, 880000) RETURNING id`, [invt.id]);
    const q = await onQuoteRecorded(run, Number(bid.id));
    assert.equal(q.kind, "quote");
    assert.equal(q.payload.total_cents, 880000);
    const [fr] = await run(`INSERT INTO field_reports (project_id, sub_slug, kind, body, author, source, week_start) VALUES ($1, 'zz-wake-sub', 'progress', 'Set the shower pan', 'ZZ Tile', 'portal', date_trunc('week', now())::date) RETURNING id`, [p.id]);
    const r = await onSubReport(run, fr.id);
    assert.equal(r.kind, "field_report");
    // The same event twice is one trigger.
    await onInboundMessage(run, { provider: "sms", messageId: "m1", projectId: p.id, text: "Can we move Tuesday?" });
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE ref = 'sms:m1'`))[0].n, 1);

    // A version that lists only payments: messages stop waking.
    await proposePolicyVersion(run, EVENT_WAKEUPS_POLICY, { lane: "agents", kinds: ["payment"] }, "test");
    const [v2] = await run(`SELECT version FROM policies WHERE key = $1 ORDER BY version DESC LIMIT 1`, [EVENT_WAKEUPS_POLICY]);
    await activatePolicy(run, EVENT_WAKEUPS_POLICY, v2.version);
    assert.equal(await onInboundMessage(run, { provider: "sms", messageId: "m3", projectId: p.id, text: "hi" }), null);
    await disablePolicy(run, EVENT_WAKEUPS_POLICY);
    assert.equal(await onPaymentReceived(run, { attemptId: "00000000-0000-0000-0000-0000000000ab", invoiceId: Number(inv.id), amountCents: 1, method: "card" }), null, "off again → nothing");
  });
});
