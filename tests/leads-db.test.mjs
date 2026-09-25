import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { agent, runOver, cleanProcurement, seedOwner, seedFile, activateRoutinePolicy, IN_WINDOW, OUT_OF_WINDOW } from "./_fixtures-procurement.mjs";
import { matchIntake } from "../lib/leads/match.ts";
import { qualificationChecklist, recordFact } from "../lib/leads/qualification.ts";
import { collectMissingFacts, previewLeadFollowups, stopLeadFollowups, draftMissingFactsEmail, leadFollowupMetrics } from "../lib/leads/facts.ts";
import { prepareEstimateInputPackage, routeLeadIssueToDecision } from "../lib/leads/package.ts";

// VALIDATION V15 (reply/decline/opt-out), V02 (many open issues), V28 (style).
const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

async function seedLead(client, slug, opts = {}) {
  const r = await client.query(
    `INSERT INTO leads (slug, name, scope, stage, email, phone, address, scope_city) VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7) RETURNING id`,
    [slug, opts.name ?? "ZZ Lead", opts.scope ?? "", opts.email ?? `${slug}@example.test`, opts.phone ?? null, opts.address ?? null, opts.city ?? null],
  );
  for (const [q, a] of Object.entries(opts.intake ?? {})) await client.query(`INSERT INTO lead_intake (lead_id, question, answer) VALUES ($1, $2, $3)`, [r.rows[0].id, q, a]);
  return r.rows[0].id;
}

test("V15 identity: exact match, unknown → review (never a guessed merge), conflicting → review with candidates", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const l1 = await seedLead(client, "zz-lead-1", { email: "one@example.test", phone: "(612) 555-0101" });
    const l2 = await seedLead(client, "zz-lead-2", { email: "two@example.test", phone: "612-555-0102" });
    const m = await matchIntake(run, { email: "ONE@example.test" });
    assert.deepEqual([m.kind, m.leadId, m.via], ["matched", l1, "email"]);
    const byPhone = await matchIntake(run, { phone: "+16125550102" });
    assert.deepEqual([byPhone.kind, byPhone.leadId], ["matched", l2]);
    const fresh = await matchIntake(run, { email: "nobody@example.test" });
    assert.equal(fresh.kind, "new");
    const anon = await matchIntake(run, { name: "Someone" }, { payload: { body: "hi" } });
    assert.equal(anon.kind, "review");
    const conflict = await matchIntake(run, { email: "one@example.test", phone: "612-555-0102" });
    assert.equal(conflict.kind, "review");
    assert.equal(conflict.candidates.length, 2);
    const reviews = await client.query(`SELECT reason FROM lead_intake_reviews ORDER BY id`);
    assert.deepEqual(reviews.rows.map((r) => r.reason), ["unknown_identity", "conflicting_match"]);
  });
});

test("W01 collector asks only for missing facts, in plain words, no price/call; policy inactive → parked draft; active → sent under policy", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const leadId = await seedLead(client, "zz-lead-3", { name: "Pat Larson", scope: "Finish the basement: family room, bathroom and a bedroom, about 900 sq ft.", city: "Edina", intake: { Timeline: "this winter" } });
    const check = await qualificationChecklist(run, leadId);
    assert.equal(check.facts.scope.status, "known");
    assert.equal(check.facts.timeline.status, "known");
    assert.equal(check.facts.measurements.status, "known", "'900 sq ft' counts");
    assert.equal(check.facts.service_area.status, "known");
    assert.deepEqual(check.missing, ["budget_fit", "goals", "photos", "address"]);
    assert.equal(check.verdict, "incomplete");

    // policy inactive → staged decision, draft parked, nothing enqueued
    let out = await collectMissingFacts(run, { leadId, principal: agent, at: IN_WINDOW });
    assert.equal(out.action, "staged");
    assert.deepEqual(out.asked, ["photos", "budget_fit", "address", "goals"]);
    assert.doesNotMatch(out.body, /scope|timeline/i, "does not re-ask what is known");
    assert.doesNotMatch(out.body, /\$\d|per square|price|quote is/i, "no unsolicited price");
    assert.doesNotMatch(out.body, /we spoke|our call|I called|inspection/i, "no invented call");
    assert.doesNotMatch(out.body, /—/, "no em dashes in Joe's voice");
    assert.equal(out.decision.kind, "routine_message");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents`)).rows[0].n, 0);
    assert.equal((await client.query(`SELECT state FROM lead_followups WHERE id = $1`, [out.followupId])).rows[0].state, "staged");
    const draft = draftMissingFactsEmail("Pat", ["photos"], {});
    assert.match(draft.body, /^Pat, Thanks for reaching out/);

    // active policy, in window → sent as an intent citing the policy
    await activateRoutinePolicy(client);
    await client.query(`DELETE FROM lead_followups`);
    await client.query(`UPDATE decisions SET status = 'revoked'`);
    out = await collectMissingFacts(run, { leadId, principal: agent, at: IN_WINDOW });
    assert.equal(out.action, "sent");
    assert.equal(out.policyRef, "policy:routine.followup@1");
    const intent = await client.query(`SELECT kind, recipient, policy_ref, payload FROM action_intents WHERE id = $1`, [out.intentId]);
    assert.equal(intent.rows[0].kind, "send_email");
    assert.equal(intent.rows[0].recipient, "zz-lead-3@example.test");
    assert.deepEqual(intent.rows[0].payload.askedKeys, ["photos", "budget_fit", "address", "goals"]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM lead_facts WHERE lead_id = $1 AND asked_at IS NOT NULL`, [leadId])).rows[0].n, 4);
    // immediately again: nothing (cadence) — and out of window: staged not dropped
    const again = await collectMissingFacts(run, { leadId, principal: agent, at: IN_WINDOW });
    assert.equal(again.action, "staged");
    assert.match(again.reason, /within the last 48h/);
    await client.query(`UPDATE decisions SET status = 'revoked'`);
    await client.query(`DELETE FROM lead_followups WHERE state = 'staged'`);
    const weekend = await collectMissingFacts(run, { leadId, principal: agent, at: OUT_OF_WINDOW });
    assert.equal(weekend.action, "staged");
    assert.match(weekend.reason, /window/);

    // answers arrive → facts recorded, second ask only for what is still missing
    await recordFact(run, { leadId, key: "budget_fit", value: "$40-50k", sourceRef: "message:abc" });
    await recordFact(run, { leadId, key: "address", value: "123 Main St, Edina", sourceRef: "message:abc" });
    await seedFile(client, "zz-photo-1", { type: "img", leadSlug: "zz-lead-3", mime: "image/jpeg", name: "basement.jpg" });
    await client.query(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'contact', 'Client replied with budget and address', 'Pat Larson')`, [leadId]);
    await stopLeadFollowups(run, leadId, "replied");
    await client.query(`UPDATE decisions SET status = 'revoked'`);
    // Next weekday send window clear of the 48 h cadence measured from the real
    // creation time of the first send: Monday after IN_WINDOW (Wed → +5 days).
    const later = new Date(IN_WINDOW.getTime() + 5 * 86_400_000);
    const second = await collectMissingFacts(run, { leadId, principal: agent, at: later });
    assert.equal(second.action, "sent");
    assert.deepEqual(second.asked, ["goals"], "asks only for what is still missing");
    assert.match(second.body, /Circling back/);
    const conflict = await recordFact(run, { leadId, key: "budget_fit", value: "$20k", sourceRef: "message:def" });
    assert.equal(conflict.status, "conflicting");
    // third time: stop chasing
    await client.query(`UPDATE decisions SET status = 'revoked'`);
    const third = await collectMissingFacts(run, { leadId, principal: agent, at: new Date(later.getTime() + 3 * 86_400_000) });
    assert.equal(third.action, "nothing");
    assert.match(third.reason, /already asked twice/);
    const metrics = await leadFollowupMetrics(run);
    assert.equal(metrics.asks >= 2, true);
  });
});

test("V15 direct owner reply, decline and opt-out stop follow-up; preview dry-run writes nothing; multiple issues → one decision each", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    await activateRoutinePolicy(client);
    const run = runOver(client);
    const joe = await seedLead(client, "zz-lead-joe", { scope: "Replace the deck boards and railing, roughly 12x16 deck." });
    await client.query(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'email', 'Replied by hand', 'Joe')`, [joe]);
    const r1 = await collectMissingFacts(run, { leadId: joe, principal: agent, at: IN_WINDOW });
    assert.equal(r1.action, "nothing");
    assert.match(r1.reason, /Joe replied directly/);

    const declined = await seedLead(client, "zz-lead-declined", { scope: "Kitchen remodel, full gut, about 200 sq ft of cabinets and counters." });
    await client.query(`UPDATE leads SET stage = 'lost' WHERE id = $1`, [declined]);
    const r2 = await collectMissingFacts(run, { leadId: declined, principal: agent, at: IN_WINDOW });
    assert.equal(r2.action, "nothing");

    const opted = await seedLead(client, "zz-lead-opt", { scope: "Build a 10x12 shed with a loft and a small porch on the front side." });
    await client.query(`INSERT INTO communication_optouts (channel, address, reason) VALUES ('email', 'zz-lead-opt@example.test', 'unsubscribe')`);
    const r3 = await collectMissingFacts(run, { leadId: opted, principal: agent, at: IN_WINDOW });
    assert.equal(r3.action, "nothing");
    assert.match(r3.reason, /opted out/);
    const nl = await seedLead(client, "zz-lead-nl", { scope: "Add a mudroom off the garage entry with built-in bench and cubbies." });
    await client.query(`INSERT INTO newsletter_recipients (email, name, active) VALUES ('zz-lead-nl@example.test', 'x', false)`);
    assert.equal((await collectMissingFacts(run, { leadId: nl, principal: agent, at: IN_WINDOW })).action, "nothing");

    // preview: what would go out, with reasons; no writes
    const ready = await seedLead(client, "zz-lead-ready", { scope: "Finish attic into an office, roughly 14x20 with a dormer and new stairs." });
    const before = await client.query(`SELECT (SELECT count(*) FROM action_intents) AS i, (SELECT count(*) FROM decisions) AS d, (SELECT count(*) FROM lead_followups) AS f`);
    const preview = await previewLeadFollowups(run, { dryRun: true, principal: agent, at: IN_WINDOW });
    const byLead = Object.fromEntries(preview.map((p) => [p.slug, p.result.action]));
    assert.equal(byLead["zz-lead-ready"], "would_send");
    assert.equal(byLead["zz-lead-joe"], "nothing");
    assert.equal(byLead["zz-lead-opt"], "nothing");
    const previewOff = await previewLeadFollowups(run, { dryRun: true, principal: agent, at: OUT_OF_WINDOW, leadIds: [ready] });
    assert.equal(previewOff[0].result.action, "would_stage");
    const after = await client.query(`SELECT (SELECT count(*) FROM action_intents) AS i, (SELECT count(*) FROM decisions) AS d, (SELECT count(*) FROM lead_followups) AS f`);
    assert.deepEqual(after.rows[0], before.rows[0], "dry run wrote nothing");

    // unusual scope / business choice → one decision, deduped
    const d1 = await routeLeadIssueToDecision(run, { leadId: ready, issue: "Client wants us to also do the roofing; outside our trades?", options: ["take it", "refer out"], principal: agent });
    const d2 = await routeLeadIssueToDecision(run, { leadId: ready, issue: "Client wants us to also do the roofing; outside our trades?", options: ["take it", "refer out"], principal: agent });
    assert.equal(d1.created, true);
    assert.equal(d2.created, false);
    assert.equal(d1.decision.kind, "other");
    const d3 = await routeLeadIssueToDecision(run, { leadId: ready, issue: "Client disputes the site-visit fee", principal: agent });
    assert.notEqual(d3.decision.id, d1.decision.id);
    // a pending owner decision on the lead holds the routine chase
    const held = await collectMissingFacts(run, { leadId: ready, principal: agent, at: IN_WINDOW });
    assert.equal(held.action, "staged");
    assert.match(held.reason, /owner decision is pending/);

    // estimate input package hand-off with the injected hook
    await seedFile(client, "zz-photo-r", { type: "img", leadSlug: "zz-lead-ready", mime: "image/jpeg" });
    const calls = [];
    const pkg = await prepareEstimateInputPackage(run, { leadId: ready, principal: agent, hook: async (_run, leadId, packageId) => calls.push([leadId, packageId]) });
    assert.equal(pkg.ok, true);
    assert.equal(pkg.package.revision, 1);
    assert.deepEqual(pkg.package.photos, ["zz-photo-r"]);
    assert.ok(pkg.package.open_questions.length > 0);
    assert.deepEqual(calls, [[ready, pkg.package.id]]);
    const same = await prepareEstimateInputPackage(run, { leadId: ready, principal: agent, hook: null });
    assert.equal(same.created, false);
    await recordFact(run, { leadId: ready, key: "budget_fit", value: "$60k", sourceRef: "call:1" });
    const rev2 = await prepareEstimateInputPackage(run, { leadId: ready, principal: agent, hook: null });
    assert.equal(rev2.package.revision, 2);
  });
});
