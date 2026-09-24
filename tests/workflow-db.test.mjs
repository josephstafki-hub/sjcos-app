import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { onSignatureSigned, prepareFromSignedPrecon, projectWorkflowView, classifySignedDoc, noteWorkflowEvent } from "../lib/workflow/engine.ts";

// A23 / V31: a verified signed pre-construction agreement starts one scope
// register, one site-visit plan, the design paths and the working formal
// estimate — with the invoice unpaid and no site visit — exactly once, and
// wakes the operating agent once. Invalid or unsigned evidence starts nothing.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };

async function clean(client) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE project_workflow_events, project_workflows, agent_triggers RESTART IDENTITY CASCADE`).catch(() => {});
  await client.query(`DELETE FROM signature_requests WHERE title LIKE 'zz-%'`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%' OR name LIKE 'ZZ %'`);
  await client.query(`DELETE FROM leads WHERE slug LIKE 'zz-%'`);
}

test("classifySignedDoc reads the records, not the prose", () => {
  assert.equal(classifySignedDoc({ doc_type: "other", template_key: "precon_agreement", title: "x" }), "precon");
  assert.equal(classifySignedDoc({ doc_type: "other", template_key: null, title: "Pre-Construction Agreement — Larson" }), "precon");
  assert.equal(classifySignedDoc({ doc_type: "estimate", template_key: null, title: "Estimate" }), "estimate");
  assert.equal(classifySignedDoc({ doc_type: "contract", template_key: "contract", title: "c" }), "contract");
  assert.equal(classifySignedDoc({ doc_type: "completion", template_key: null, title: "Certificate" }), "completion");
  assert.equal(classifySignedDoc({ doc_type: "other", template_key: "lien_release", title: "Lien release" }), "other");
});

test("V31 signature preparation: signed pre-con (unpaid, no visit) prepares once; duplicate resumes; unsigned/void starts nothing", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await clean(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const [lead] = await run(`INSERT INTO leads (slug, name, scope, stage, email) VALUES ('zz-wf-lead', 'ZZ Wf Client', 'Finish the basement: family room, bathroom and a bedroom, about 900 sq ft with a shaker style kitchenette.', 'precon_signed', 'zz-wf@example.test') RETURNING id`);
    await run(`INSERT INTO lead_intake (lead_id, sort_order, question, answer) VALUES ($1, 0, 'Budget', 'around 60k'), ($1, 1, 'Style', 'warm modern, shaker doors')`, [lead.id]);
    // The pre-con invoice is NOT paid and there is no project yet.
    const [sig] = await run(`INSERT INTO signature_requests (lead_slug, doc_type, title, body, status, signer_name, signer_email) VALUES ('zz-wf-lead', 'other', 'zz-Pre-Construction Agreement', 'terms', 'sent', 'ZZ', 'zz-wf@example.test') RETURNING id`);
    // Not signed yet → nothing starts.
    const notYet = await prepareFromSignedPrecon(run, Number(sig.id), owner);
    assert.equal(notYet.ok, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM projects WHERE lead_id = $1`, [lead.id]))[0].n, 0, "no project from an unsigned agreement");
    // A voided one starts nothing either.
    await run(`UPDATE signature_requests SET status = 'void' WHERE id = $1`, [sig.id]);
    assert.equal((await prepareFromSignedPrecon(run, Number(sig.id), owner)).ok, false);
    // Verified signature.
    await run(`UPDATE signature_requests SET status = 'signed', signed_at = now(), signed_name = 'ZZ Wf Client' WHERE id = $1`, [sig.id]);
    const first = await onSignatureSigned(run, Number(sig.id), owner);
    assert.equal(first.kind, "precon");
    const prep = first.preparation;
    assert.ok(prep && "projectId" in prep, JSON.stringify(prep));
    assert.equal(prep.projectCreated, true, "one project workflow started from the lead");
    assert.equal(prep.scope.created, true);
    assert.ok(prep.scope.items_created > 0, "scope broken into work packages");
    assert.equal(prep.scope.plan_created, true, "site-visit plan prepared");
    assert.equal(prep.estimate.created, true, "working formal estimate structure exists");
    assert.ok(prep.estimate.unknown_cost_lines > 0, "missing values are explicit gaps, not zero");
    assert.equal(prep.event_created, true);
    assert.equal(prep.trigger_created, true, "operating agent woken");
    assert.equal((await run(`SELECT total FROM estimates WHERE id = $1`, [prep.estimate.id]))[0].total, 0);
    assert.equal((await run(`SELECT count(*)::int AS n FROM estimate_gaps WHERE estimate_id = $1 AND kind = 'unknown_cost'`, [prep.estimate.id]))[0].n, prep.estimate.unknown_cost_lines);
    const [wf] = await run(`SELECT stage, precon_signed_at, scope_prepared_at FROM project_workflows WHERE project_id = $1`, [prep.projectId]);
    assert.equal(wf.stage, "W02");
    assert.ok(wf.precon_signed_at && wf.scope_prepared_at);
    assert.ok((await run(`SELECT count(*)::int AS n FROM design_decisions WHERE project_id = $1`, [prep.projectId]))[0].n >= 1, "design path decided per scope with finishes");
    // Repeated event (webhook replay / second processor): resumes, duplicates nothing.
    const again = await onSignatureSigned(run, Number(sig.id), owner);
    const p2 = again.preparation;
    assert.equal(p2.projectCreated, false);
    assert.equal(p2.scope.created, false);
    assert.equal(p2.scope.items_created, 0);
    assert.equal(p2.estimate.created, false);
    assert.equal(p2.event_created, false);
    assert.equal(p2.trigger_created, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM projects WHERE lead_id = $1`, [lead.id]))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM scope_registers WHERE project_id = $1`, [prep.projectId]))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM site_visit_plans WHERE project_id = $1`, [prep.projectId]))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM estimates WHERE project_id = $1 AND kind = 'formal'`, [prep.projectId]))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE project_id = $1`, [prep.projectId]))[0].n, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM project_workflow_events WHERE project_id = $1 AND kind = 'precon_signed'`, [prep.projectId]))[0].n, 1);

    // The view: gates derived from records; payment is not a gate for preparation.
    const view = await projectWorkflowView(run, prep.projectId);
    assert.equal(view.stage, "W02");
    const gate = (k) => view.gates.find((g) => g.key === k);
    assert.equal(gate("precon_signed").met, true);
    assert.equal(gate("scope_prepared").met, true);
    assert.equal(gate("scope_allocated").met, false, "Joe's allocation review is still owed");
    assert.equal(gate("accepted").met, false);
    assert.ok(view.next_actions.some((a) => /Scope allocation/.test(a)));
    assert.ok(view.history.some((h) => h.kind === "precon_signed") && view.history.some((h) => h.kind === "scope_prepared"));

    // Later events move the stage once; replays are ignored.
    const e1 = await noteWorkflowEvent(run, { projectId: prep.projectId, kind: "schedule_confirmed", ref: "plan:1" });
    const e2 = await noteWorkflowEvent(run, { projectId: prep.projectId, kind: "schedule_confirmed", ref: "plan:1" });
    assert.deepEqual([e1.created, e2.created], [true, false]);
    assert.equal((await run(`SELECT stage FROM project_workflows WHERE project_id = $1`, [prep.projectId]))[0].stage, "W10");
  });
});

test("V38: an estimate signature records acceptance (W08) only for the formal estimate; contract and completion move the stage; other docs do not", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await clean(client);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-wf-p', 'ZZ Wf P', 'selections', 'ZZ') RETURNING id`);
    const [formal] = await run(`INSERT INTO estimates (project_id, title, kind, status) VALUES ($1, 'Formal estimate', 'formal', 'sent') RETURNING id`, [p.id]);
    const [change] = await run(`INSERT INTO estimates (project_id, title, kind, status) VALUES ($1, 'Add a closet', 'precon_change', 'sent') RETURNING id`, [p.id]);
    const mkSig = async (doc_type, estimate_id, title) => (await run(`INSERT INTO signature_requests (project_id, doc_type, title, body, status, signed_at, estimate_id) VALUES ($1, $2, $3, '', 'signed', now(), $4) RETURNING id`, [p.id, doc_type, title, estimate_id]))[0].id;
    const chg = await onSignatureSigned(run, Number(await mkSig("estimate", change.id, "zz-change")), owner);
    assert.equal(chg.event.created, true);
    assert.equal((await run(`SELECT stage, accepted_at FROM project_workflows WHERE project_id = $1`, [p.id]))[0].accepted_at, null, "a pre-con change is not the formal acceptance");
    const acc = await onSignatureSigned(run, Number(await mkSig("estimate", formal.id, "zz-formal")), owner);
    assert.equal(acc.kind, "estimate");
    let [wf] = await run(`SELECT stage, accepted_at, accepted_estimate_id FROM project_workflows WHERE project_id = $1`, [p.id]);
    assert.equal(wf.stage, "W08");
    assert.equal(Number(wf.accepted_estimate_id), Number(formal.id));
    await onSignatureSigned(run, Number(await mkSig("contract", null, "zz-contract")), owner);
    [wf] = await run(`SELECT stage, contract_signed_at FROM project_workflows WHERE project_id = $1`, [p.id]);
    assert.equal(wf.stage, "W09");
    assert.ok(wf.contract_signed_at);
    const other = await onSignatureSigned(run, Number(await mkSig("other", null, "zz-lien")), owner);
    assert.equal(other.kind, "other");
    await onSignatureSigned(run, Number(await mkSig("completion", null, "zz-signoff")), owner);
    [wf] = await run(`SELECT stage, client_signoff_at FROM project_workflows WHERE project_id = $1`, [p.id]);
    assert.equal(wf.stage, "W12");
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE project_id = $1`, [p.id]))[0].n, 4, "one trigger per signature event (change, acceptance, contract, sign-off)");
  });
});
