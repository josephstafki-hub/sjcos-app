import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { prepareScopeRegisterFromLead, allocateScope, applySiteFindings, getScopeRegister, loadLeadFacts } from "../lib/estimating/scope.ts";
import { setDesignPath, applyClientDirectionApproval, applySelectionChoice, applyClientExactProduct, applyFeedback, getDesignDecisions } from "../lib/estimating/design.ts";
import { researchPrice, candidateSuppliers, recordPriceObservation, stageSupplierPricingRequest } from "../lib/estimating/pricing.ts";
import { recomputeDraftEstimate, upsertEstimateLine, freezeOfferedPrices, marginExposureReport, applyOwnerPricing, recordQuote, incorporateQuote, compareCompetingQuotes, chooseSupplierQuote, incorporateSubBid, stageAllowanceOverage, loadLines } from "../lib/estimating/assembly.ts";
import { estimateReadiness, acceptAssumptions } from "../lib/estimating/readiness.ts";
import { ingestCloseoutActuals, costLearningPreview, rollbackLearningRevision, proposeMarkupChange } from "../lib/estimating/learning.ts";
import { proposePricingSetup, activatePricingSetup } from "../lib/estimating/setup.ts";
import { fakeFetcher } from "../lib/estimating/fetcher.ts";
import { resolveDecision } from "../lib/commands/decisions.ts";
import { proposePolicyVersion, activatePolicy } from "../lib/commands/policies.ts";

// V17 / V25 / V32 / V33 / V34 / V36 / V37 against a REAL disposable Postgres
// (tests/_harness). Migrations 0010/0011 are loaded by the harness. Skipped
// only when the postgres binaries are missing — never pointed at production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const staff = { kind: "user", userId: null, role: "staff", name: "Sam", permissions: ["estimates"] };
const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: null };

async function seed(client) {
  await cleanFoundation(client);
  await client.query(`DELETE FROM subs WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM vendors WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM cost_items WHERE name LIKE 'ZZ %'`);
  await client.query(`DELETE FROM app_settings WHERE key = 'estimate.default_markup'`);
  await client.query(`DELETE FROM pricing_setups`);
  await client.query(`DELETE FROM cost_learning_revisions`);
  await client.query(`DELETE FROM supplier_capabilities WHERE name LIKE 'ZZ %'`);
  await client.query(`DELETE FROM price_observations WHERE product_key LIKE 'zz%'`);
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  const s = await client.query(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-staff@example.test','x','Sam','staff','S', ARRAY['estimates']) RETURNING id`);
  owner.userId = o.rows[0].id;
  staff.userId = s.rows[0].id;
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  return run;
}

async function mkProject(run, slug, scope = "Full kitchen remodel, about 220 sq ft") {
  const [lead] = await run(`INSERT INTO leads (slug, name, scope, stage) VALUES ($1, $2, $3, 'precon_signed') RETURNING id`, [`${slug}-lead`, `ZZ ${slug}`, scope]);
  await run(`INSERT INTO lead_intake (lead_id, sort_order, question, answer) VALUES ($1, 0, 'Budget', 'around 60k'), ($1, 1, 'Style', 'warm modern')`, [lead.id]);
  const [p] = await run(`INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date, lead_id) VALUES ($1, $1, 'precon_signed', 'ZZ Client', 0, 0, $2) RETURNING id`, [slug, lead.id]);
  const [e] = await run(`INSERT INTO estimates (project_id, title, kind) VALUES ($1, 'Formal estimate', 'formal') RETURNING id`, [p.id]);
  return { projectId: p.id, leadId: lead.id, estimateId: Number(e.id) };
}

test("V32 scope + site evidence: Joe retains labor (materials stay), findings update quantities and add scope with sources, no package send", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId } = await mkProject(run, "zz-est-v32");
    const facts = await loadLeadFacts(run, projectId);
    assert.equal(facts.intake.length, 2);
    const first = await prepareScopeRegisterFromLead(run, projectId, facts, { principal: owner });
    assert.ok(first.created && first.items_created > 5 && first.plan_created);
    const again = await prepareScopeRegisterFromLead(run, projectId, facts, { principal: owner });
    assert.equal(again.created, false);
    assert.equal(again.items_created, 0, "repeated trigger resumes, never duplicates");
    assert.equal(again.plan_id, first.plan_id);

    // ambiguous basis → a question, not a guess
    const amb = await allocateScope(run, projectId, { key: "kitchen.cabinetry", responsibility: "joe", dedicated_price_cents: 800000, principal: owner });
    assert.equal(amb.ok, false);
    assert.match(amb.ask, /internal cost|client/);
    const alloc = await allocateScope(run, projectId, { key: "kitchen.cabinetry", responsibility: "joe", dedicated_price_cents: 800000, price_basis: "client_price", principal: owner });
    assert.equal(alloc.ok, true);
    assert.equal(alloc.labor_solicited, false, "Joe's retained labor leaves the sub solicitation");
    assert.equal(alloc.materials_still_needed, true, "materials still need a supplier");
    const view = await getScopeRegister(run, projectId);
    assert.ok(!view.solicitation.labor.includes("kitchen.cabinetry"));
    assert.ok(view.solicitation.materials.some((m) => m.key === "kitchen.cabinetry"));
    assert.ok(view.solicitation.labor.includes("kitchen.plumbing"));

    // site findings: measurement, new work, repeat upload
    const findings = [
      { fact_key: "notes1#1", scope_key: "kitchen.countertops", kind: "measurement", statement: "Countertop area 48 sq ft", measurement: 48, unit: "sf", source_note: "file:notes1", quantity_label: "Countertop area" },
      { fact_key: "notes1#2", scope_key: "kitchen.cabinetry", kind: "measurement", statement: "Cabinet run 22 lf", measurement: 22, unit: "lf", source_note: "file:notes1", quantity_label: "Cabinet run" },
      { fact_key: "notes1#3", scope_key: null, kind: "new_work", statement: "Subfloor is rotten under the sink", source_note: "file:notes1", new_scope: { key: "kitchen.subfloor_repair", title: "Subfloor repair at sink", trade: "Framing", room: "Kitchen" } },
      { fact_key: "notes1#4", scope_key: "kitchen.plumbing", kind: "measurement", statement: "some length", measurement: null, unit: null, source_note: "file:notes1" },
    ];
    const r1 = await applySiteFindings(run, projectId, findings, { principal: owner });
    assert.equal(r1.recorded, 4);
    assert.deepEqual(r1.new_scope_keys, ["kitchen.subfloor_repair"]);
    assert.ok(r1.clarifications.some((c) => /missing a value or unit/.test(c)), "ambiguous finding → targeted clarification");
    assert.deepEqual(r1.price_protected, ["kitchen.cabinetry"], "quantity change on Joe's priced scope does not expand his price");
    const r2 = await applySiteFindings(run, projectId, findings, { principal: owner });
    assert.equal(r2.recorded, 0);
    assert.equal(r2.duplicates, 4, "re-uploading the same notes changes nothing");
    const after = await getScopeRegister(run, projectId);
    const tops = after.items.find((i) => i.key === "kitchen.countertops");
    const q = tops.quantities.find((x) => x.label === "Countertop area");
    assert.equal(q.qty, 48);
    assert.equal(q.basis, "site_measurement");
    assert.match(q.source, /^finding:/);
    assert.equal(tops.unverified, false);
    const cab = after.items.find((i) => i.key === "kitchen.cabinetry");
    assert.equal(cab.dedicated_price_cents, 800000, "allocation preserved");
    assert.equal(cab.price_basis, "client_price");
    const sub = after.items.find((i) => i.key === "kitchen.subfloor_repair");
    assert.equal(sub.dedicated_price_cents, null, "new work is a separate unpriced item");
    assert.ok(sub.source_refs.some((s) => s.kind === "site_finding"));
    assert.ok(after.plan.items.some((p) => p.scope_key === "kitchen.countertops" && p.kind === "measure" && p.status === "answered"));
    assert.ok(after.plan.items.filter((p) => p.status === "open").length > 0, "checklist is not blanket-completed");
    const sends = await run(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'package_release'`);
    assert.equal(sends[0].n, 0, "no package send was staged or sent");
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 0);
  });
});

test("V33 design paths: unclear/defined/exact per room, board approval prepares selections, partial choices, comments ≠ approval, change requests need owner review", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId, estimateId } = await mkProject(run, "zz-est-v33", "Kitchen remodel and a bathroom refresh");
    await prepareScopeRegisterFromLead(run, projectId, await loadLeadFacts(run, projectId));
    const k = await setDesignPath(run, { project_id: projectId, scope_key: "kitchen.cabinetry", room: "Kitchen", direction: "undefined" });
    assert.equal(k.path, "mood_board");
    const b = await setDesignPath(run, { project_id: projectId, scope_key: "bath.tile", room: "Bathroom", direction: "defined" });
    assert.equal(b.path, "selections");
    const x = await setDesignPath(run, { project_id: projectId, scope_key: "bath.vanity", room: "Bathroom", direction: "exact" });
    assert.equal(x.path, "direct_estimate");
    assert.equal((await getDesignDecisions(run, projectId)).length, 3, "mixed rooms follow different paths side by side");

    // client approves the Kitchen board → selections prepared for undecided kitchen finishes, once
    await run(`INSERT INTO project_mood_boards (project_id, room, published_at, client_approved_at, client_approved_name) VALUES ($1, 'Kitchen', now(), now(), 'ZZ Client')`, [projectId]);
    const a1 = await applyClientDirectionApproval(run, { project_id: projectId, room: "Kitchen", principal: owner });
    assert.ok(a1.selections_created.length >= 5);
    const a2 = await applyClientDirectionApproval(run, { project_id: projectId, room: "Kitchen", principal: owner });
    assert.equal(a2.selections_created.length, 0, "re-running prepares nothing twice");
    const dd = (await getDesignDecisions(run, projectId)).find((d) => d.scope_key === "kitchen.cabinetry");
    assert.equal(dd.path, "selections");
    assert.ok(dd.client_direction_approved_at);
    assert.equal(dd.partial_choices.chosen.length, 0);
    const drafts = await run(`SELECT status FROM project_selections WHERE project_id = $1`, [projectId]);
    assert.ok(drafts.every((s) => s.status === "draft"), "owner reviews before the client sees them");

    // client chooses one of two cabinetry selections → estimate item, partial choice tracked, no duplicate on retry
    const [selA, selB] = dd.selection_ids;
    const [opt] = await run(`INSERT INTO project_selection_options (selection_id, name, brand, price, product_url) VALUES ($1, 'Shaker White', 'ZZ Cab Co', 4200, 'https://example.test/cab') RETURNING id`, [selA]);
    await run(`UPDATE project_selections SET status = 'approved', chosen_option_id = $2, decided_at = now() WHERE id = $1`, [selA, opt.id]);
    const c1 = await applySelectionChoice(run, { selection_id: selA, estimate_id: estimateId, principal: owner });
    assert.deepEqual(c1.partial, { chosen: [Number(selA)], open: dd.selection_ids.filter((i) => i !== selA).map(Number) });
    assert.equal(c1.research_needed, false);
    const c2 = await applySelectionChoice(run, { selection_id: selA, estimate_id: estimateId, principal: owner });
    assert.equal(c2.line_id, c1.line_id, "same choice, same line");
    const lines = await loadLines(run, estimateId);
    const chosen = lines.filter((l) => l.item_key === `selection:${selA}`);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].internal_cost_cents, 420000, "option dollars → cents");
    assert.equal(chosen[0].provisional, true, "listed price until a quote confirms it");
    assert.ok(!lines.some((l) => l.item_key === `selection:${selB}`), "unselected options are not added to the total");

    // exact client product → direct estimate item + research task, no board
    const ex = await applyClientExactProduct(run, { project_id: projectId, estimate_id: estimateId, scope_key: "bath.vanity", product: { brand: "Kohler", model: "K-2210", finish: "White", name: "Undermount sink" }, qty: 1, unit: "ea", instruction_ref: "email:123", principal: owner });
    assert.equal(ex.research.exact, true);
    const exLine = (await loadLines(run, estimateId)).find((l) => l.id === ex.line_id);
    assert.equal(exLine.internal_cost_cents, null, "no invented cost");
    assert.ok(ex.recompute.gaps.some((g) => g.kind === "unknown_cost" && g.ref === ex.item_key));
    assert.equal((await run(`SELECT count(*)::int AS n FROM project_selections WHERE project_id = $1 AND area ILIKE '%vanity%'`, [projectId]))[0].n, 0, "no redundant selection board");

    // feedback
    await run(`UPDATE design_decisions SET owner_release_approved_at = now(), status = 'presented' WHERE project_id = $1 AND scope_key = 'bath.tile'`, [projectId]);
    const f1 = await applyFeedback(run, { project_id: projectId, scope_key: "bath.tile", author: "ZZ Client", body: "Love these, looks great!" });
    assert.equal(f1.kind, "comment");
    assert.equal(f1.approval_changed, false);
    assert.equal(f1.needs_owner_review, false);
    const f2 = await applyFeedback(run, { project_id: projectId, scope_key: "bath.tile", author: "ZZ Client", body: "Closer, but warmer tones please" });
    assert.equal(f2.kind, "change_request");
    assert.equal(f2.revision, 2);
    const [tile] = await run(`SELECT owner_release_approved_at, status, feedback_log FROM design_decisions WHERE project_id = $1 AND scope_key = 'bath.tile'`, [projectId]);
    assert.equal(tile.owner_release_approved_at, null, "revised package needs Joe's review before release");
    assert.equal(tile.feedback_log.length, 2, "revision history kept");
    // a changed direction lists what it affects rather than restarting
    const chg = await setDesignPath(run, { project_id: projectId, scope_key: "kitchen.cabinetry", direction: "exact", principal: owner });
    assert.equal(chg.changed, true);
    assert.ok(chg.affected.some((a) => /selection/.test(a)) && chg.affected.some((a) => /estimate item/.test(a)));
  });
});

test("V34 supplier research: online price sourced+dated, Siweck category clue separated from price, old quote dated, missing unit/freight/qty → gaps, request staged not sent", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId, estimateId } = await mkProject(run, "zz-est-v34");
    await prepareScopeRegisterFromLead(run, projectId, await loadLeadFacts(run, projectId));
    await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '20')`);
    const product = { brand: "ZZ Andersen", model: "400 Series DH", finish: "White" };
    const key = "zz-andersen|400-series-dh||white";
    await upsertEstimateLine(run, estimateId, { item_key: "client_product:" + key, description: "Windows", unit: "ea", qty: 6, scope_item_key: "kitchen.electrical", source_kind: "client_product", source_ref: { product }, internal_cost_cents: null, provisional: true });

    // no unit in the fixture → unit gap, no provisional support; no quantity → quantity gap
    const noUnit = await researchPrice(run, { product, unit: null, qty: null, project_id: projectId }, fakeFetcher({ [key]: [{ price_cents: 61000, unit: null, url: "https://example.test/w" }] }));
    assert.equal(noUnit.fetcher, "fake");
    assert.equal(noUnit.provisional, null);
    assert.ok(noUnit.gaps.some((g) => g.kind === "missing_unit") && noUnit.gaps.some((g) => g.kind === "missing_quantity"));
    assert.ok(noUnit.observations[0].gaps.some((g) => g.kind === "missing_freight"));
    // sourced + dated price with unit and quantity → provisional draft cost on the line
    const hit = await researchPrice(run, { product, unit: "ea", qty: 6, project_id: projectId, estimate_id: estimateId, item_key: "client_product:" + key }, fakeFetcher({ [key]: [{ price_cents: 61000, unit: "ea", url: "https://example.test/w2", includes_tax: false, includes_freight: false, observed_at: "2026-09-22T00:00:00Z" }] }));
    assert.equal(hit.provisional.per_qty_cents, 366000);
    const [obs] = await run(`SELECT source_kind, source_url, observed_at, unit, price_cents::int AS price_cents FROM price_observations WHERE id = $1`, [hit.provisional.observation_id]);
    assert.equal(obs.source_kind, "online");
    assert.equal(obs.source_url, "https://example.test/w2");
    assert.equal(obs.unit, "ea");
    const line = (await loadLines(run, estimateId)).find((l) => l.item_key === "client_product:" + key);
    assert.equal(line.internal_cost_cents, 366000);
    assert.equal(line.provisional, true, "provisional, supplier quote pending");
    assert.equal(line.extended, 439200, "client price = cost × 1.20");
    // a "similar" product is not substituted silently
    const sub = await researchPrice(run, { product, unit: "ea", qty: 6 }, fakeFetcher({ [key]: [{ price_cents: 50000, unit: "ea", url: "https://example.test/w3", substitution_note: "200 Series, not 400" }] }));
    assert.equal(sub.provisional, null);

    // supplier knowledge: levels separated; Siweck is a lumber relationship (2) and a doors/windows candidate (1), never a price
    const lumber = await candidateSuppliers(run, "lumber");
    assert.ok(lumber.history.some((h) => h.name === "Siweck Lumber"));
    assert.equal(lumber.current.length, 0);
    const windows = await candidateSuppliers(run, "windows");
    assert.ok(windows.inferred.some((h) => h.name === "Siweck Lumber"));
    assert.ok(!windows.history.some((h) => h.name === "Siweck Lumber"));
    assert.equal((await run(`SELECT count(*)::int AS n FROM price_observations WHERE supplier_name = 'Siweck Lumber'`))[0].n, 0);
    // an old quote is dated evidence
    const old = await recordPriceObservation(run, { product, unit: "ea", price_cents: 52000, source_kind: "historical_quote", source_ref: "quote-2025-11", observed_at: "2025-11-01T00:00:00Z", supplier_name: "Siweck Lumber", includes_tax: true, includes_freight: true });
    assert.ok(old.gaps.some((g) => g.kind === "stale_price"));
    const again = await researchPrice(run, { product, unit: "ea", qty: 6 }, fakeFetcher());
    assert.equal(again.historical[0].stale, true);
    assert.equal(again.historical[0].source_kind, "historical_quote");

    // staged supplier pricing request: exact payload, resolved recipient, decision, nothing sent
    const [vendor] = await run(`INSERT INTO vendors (slug, name, trade, email) VALUES ('zz-siweck', 'Siweck Lumber', 'Lumber', 'quotes@siweck.test') RETURNING id`);
    const req = await stageSupplierPricingRequest(run, { project_id: projectId, supplier_name: "Siweck Lumber", vendor_id: vendor.id, products: [{ product, qty: 6, unit: "ea", item_key: "client_product:" + key }, { product: { brand: "ZZ Trex", model: "Enhance", finish: "Clam Shell" }, qty: null, unit: "sf" }], need_dates: { quote_by: "2026-10-01" }, principal: agent });
    assert.equal(req.sent, false);
    assert.equal(req.recipient, "quotes@siweck.test");
    assert.ok(req.gaps.some((g) => /quantity not yet measured/.test(g)), "quantity gap stated, not invented");
    const [d] = await run(`SELECT kind, action, status, recipient, target_id FROM decisions WHERE id = $1`, [req.decision_id]);
    assert.deepEqual([d.kind, d.action, d.status, d.recipient], ["package_release", "send_supplier_pricing_request", "pending", "quotes@siweck.test"]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 0, "not sent");
    const same = await stageSupplierPricingRequest(run, { project_id: projectId, supplier_name: "Siweck Lumber", vendor_id: vendor.id, products: [{ product, qty: 6, unit: "ea", item_key: "client_product:" + key }, { product: { brand: "ZZ Trex", model: "Enhance", finish: "Clam Shell" }, qty: null, unit: "sf" }], need_dates: { quote_by: "2026-10-01" }, principal: agent });
    assert.equal(same.decision_id, req.decision_id, "same content → same pending decision, no duplicate alert");
    assert.equal(same.revision, 1);
    const changed = await stageSupplierPricingRequest(run, { project_id: projectId, supplier_name: "Siweck Lumber", vendor_id: vendor.id, products: [{ product, qty: 8, unit: "ea" }], principal: agent });
    assert.equal(changed.revision, 2);
    assert.notEqual(changed.decision_id, req.decision_id);
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [req.decision_id]))[0].status, "superseded");
    const noContact = await stageSupplierPricingRequest(run, { project_id: projectId, supplier_name: "ZZ Unknown Supply", products: [{ product, qty: 1, unit: "ea" }], principal: agent });
    assert.equal(noContact.recipient, null);
    assert.ok(noContact.gaps.some((g) => /No trusted contact/.test(g)), "no invented contact");
  });
});

test("V36 incorporation: chosen finish, approved sub bid (no award), eligible quote replaces provisional, competing quotes held, multi-item counted once, owner price no double markup, no purchase", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId, estimateId } = await mkProject(run, "zz-est-v36");
    await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '20')`);
    await prepareScopeRegisterFromLead(run, projectId, await loadLeadFacts(run, projectId));
    await allocateScope(run, projectId, { key: "kitchen.plumbing", responsibility: "sub", principal: owner });
    const rc0 = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    assert.ok(rc0.unknown_cost_lines > 5, "scope items start unpriced");
    assert.equal(rc0.total_cents, 0);

    // approved sub bid → cost on the covered scope, exclusions recorded, NO award
    await run(`INSERT INTO subs (slug, name, trade) VALUES ('zz-plumber', 'ZZ Plumbing', 'Plumbing')`);
    const [pkg] = await run(`INSERT INTO bid_packages (project_id, title, trade, status) VALUES ($1, 'Plumbing', 'Plumbing', 'open') RETURNING id`, [projectId]);
    const [inv] = await run(`INSERT INTO bid_invites (package_id, sub_slug, status) VALUES ($1, 'zz-plumber', 'submitted') RETURNING id`, [pkg.id]);
    const [bid] = await run(`INSERT INTO bid_submissions (invite_id, total, exclusions) VALUES ($1, 450000, 'Fixtures by others') RETURNING id`, [inv.id]);
    const staffTry = await incorporateSubBid(run, { bid_submission_id: Number(bid.id), estimate_id: estimateId, scope_keys: ["kitchen.plumbing"], principal: staff });
    assert.equal(staffTry.ok, false, "approving a bid for the estimate is Joe's call");
    const sb = await incorporateSubBid(run, { bid_submission_id: Number(bid.id), estimate_id: estimateId, scope_keys: ["kitchen.plumbing"], principal: owner });
    assert.equal(sb.state, "incorporated");
    let lines = await loadLines(run, estimateId);
    const plumb = lines.find((l) => l.scope_item_key === "kitchen.plumbing");
    assert.equal(plumb.internal_cost_cents, 450000);
    assert.equal(plumb.source_kind, "sub_bid");
    assert.equal(plumb.extended, 540000);
    assert.equal((await run(`SELECT awarded_invite_id FROM bid_packages WHERE id = $1`, [pkg.id]))[0].awarded_invite_id, null, "estimate use is not an award");
    assert.ok((await run(`SELECT detail FROM estimate_gaps WHERE estimate_id = $1 AND kind = 'coverage_missing'`, [estimateId])).some((g) => /Fixtures by others/.test(g.detail)));
    const sbAgain = await incorporateSubBid(run, { bid_submission_id: Number(bid.id), estimate_id: estimateId, scope_keys: ["kitchen.plumbing"], principal: owner });
    assert.equal(sbAgain.state, "incorporated");
    assert.equal((await loadLines(run, estimateId)).find((l) => l.scope_item_key === "kitchen.plumbing").internal_cost_cents, 450000, "re-incorporating the same bid does not add it again");

    // provisional online cost on flooring, then a non-competitive supplier quote replaces it (after unit/qty check)
    const floorProduct = { brand: "ZZ Shaw", model: "Endura", finish: "Oak" };
    await upsertEstimateLine(run, estimateId, { item_key: "scope:kitchen.flooring", description: "Kitchen flooring", unit: "sf", qty: 220, scope_item_key: "kitchen.flooring", source_kind: "online_price", source_ref: { product: floorProduct }, internal_cost_cents: 110000, cost_basis: "online:x", cost_observed_at: new Date().toISOString(), provisional: true });
    const bad = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Floor Supply", quote_ref: "Q-1", lines: [{ description: "Endura Oak", product: floorProduct, unit: "lf", quantity: 220, extended_cents: 99000, scope_key: "kitchen.flooring" }] });
    const badInc = await incorporateQuote(run, { quote_id: bad.quote_id, estimate_id: estimateId, principal: owner });
    assert.equal(badInc.applied.length, 0);
    assert.match(badInc.skipped[0].reason, /per lf/, "wrong unit is reported, not forced");
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.flooring").internal_cost_cents, 110000);
    const good = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Floor Supply", quote_ref: "Q-1", revision: 2, includes_tax: true, includes_freight: true, lines: [{ description: "Endura Oak", product: floorProduct, unit: "sq ft", quantity: 220, extended_cents: 99000, scope_key: "kitchen.flooring" }] });
    const inc = await incorporateQuote(run, { quote_id: good.quote_id, estimate_id: estimateId, principal: owner });
    assert.equal(inc.state, "incorporated");
    const floor = (await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.flooring");
    assert.equal(floor.internal_cost_cents, 99000);
    assert.equal(floor.provisional, false);
    assert.equal(floor.cost_basis, `quote:${good.quote_id}`);
    assert.equal((await run(`SELECT approval_state FROM quotes WHERE id = $1`, [bad.quote_id]))[0].approval_state, "superseded", "revision lineage");

    // competing quotes are compared and held; nothing summed or picked
    await upsertEstimateLine(run, estimateId, { item_key: "scope:kitchen.backsplash", description: "Backsplash tile", unit: "sf", qty: 40, scope_item_key: "kitchen.backsplash", source_kind: "assumption", internal_cost_cents: null, provisional: true });
    const qa = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Tile A", quote_ref: "A1", competing_group: "backsplash", lines: [{ description: "Subway 3x6", unit: "sf", quantity: 40, extended_cents: 30000, scope_key: "kitchen.backsplash" }] });
    const qb = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Tile B", quote_ref: "B1", competing_group: "backsplash", lines: [{ description: "Subway 3x6", unit: "sf", quantity: 40, extended_cents: 27000, scope_key: "kitchen.backsplash" }] });
    const held = await incorporateQuote(run, { quote_id: qa.quote_id, estimate_id: estimateId, principal: owner });
    assert.equal(held.state, "held_competing");
    assert.deepEqual(held.competitors.sort(), ["ZZ Tile A", "ZZ Tile B"]);
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.backsplash").internal_cost_cents, null, "nothing applied automatically");
    const [sc] = await run(`SELECT kind, status FROM decisions WHERE id = $1`, [held.decision_id]);
    assert.deepEqual([sc.kind, sc.status], ["supplier_choice", "pending"]);
    const cmp = await compareCompetingQuotes(run, projectId, "backsplash", owner);
    assert.equal(cmp.decision_id, held.decision_id, "one decision per group");
    assert.deepEqual(cmp.quotes.map((q) => q.total_cents), [30000, 27000]);
    const rc1 = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    assert.ok(rc1.gaps.some((g) => g.kind === "competing_quotes"));
    // Joe chooses B
    const res = await resolveDecision(run, { id: held.decision_id, outcome: "approved", principal: owner, via: "app" });
    assert.equal(res.ok, true);
    const chosen = await chooseSupplierQuote(run, { quote_id: qb.quote_id, decision_id: held.decision_id, estimate_id: estimateId, principal: owner });
    assert.equal(chosen.state, "incorporated");
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.backsplash").internal_cost_cents, 27000);
    assert.equal((await run(`SELECT approval_state FROM quotes WHERE id = $1`, [qa.quote_id]))[0].approval_state, "rejected");
    const reuse = await chooseSupplierQuote(run, { quote_id: qa.quote_id, decision_id: held.decision_id, estimate_id: estimateId, principal: owner });
    assert.equal(reuse.ok, false, "a spent decision cannot pick the other quote");

    // multi-item quote allocated per line, counted once even if incorporated twice
    await upsertEstimateLine(run, estimateId, { item_key: "item:sink", description: "Sink", unit: "ea", qty: 1, scope_item_key: "kitchen.plumbing", source_kind: "client_product", internal_cost_cents: null, provisional: true });
    await upsertEstimateLine(run, estimateId, { item_key: "item:faucet", description: "Faucet", unit: "ea", qty: 1, scope_item_key: "kitchen.plumbing", source_kind: "client_product", internal_cost_cents: null, provisional: true });
    const multi = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Plumb Supply", quote_ref: "M1", includes_tax: true, includes_freight: true, lines: [{ description: "Sink", unit: "ea", quantity: 1, extended_cents: 40000, item_key: "item:sink" }, { description: "Faucet", unit: "ea", quantity: 1, extended_cents: 25000, item_key: "item:faucet" }] });
    await incorporateQuote(run, { quote_id: multi.quote_id, estimate_id: estimateId, principal: owner });
    const twice = await incorporateQuote(run, { quote_id: multi.quote_id, estimate_id: estimateId, principal: owner });
    assert.equal(twice.applied.length, 2);
    lines = await loadLines(run, estimateId);
    assert.equal(lines.find((l) => l.item_key === "item:sink").internal_cost_cents, 40000);
    assert.equal(lines.find((l) => l.item_key === "item:faucet").internal_cost_cents, 25000);
    assert.equal(lines.filter((l) => (l.cost_basis ?? "").startsWith(`quote:${multi.quote_id}`)).reduce((s, l) => s + l.internal_cost_cents, 0), 65000, "quote total counted once across its lines");

    // owner dedicated pricing: client price used as-is (no markup), internal cost marked up once
    const op = await applyOwnerPricing(run, { estimate_id: estimateId, item_key: "scope:kitchen.paint", price_cents: 100000, basis: "client_price", principal: owner });
    assert.ok(op.total_cents > 0);
    const paint = (await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.paint");
    assert.equal(paint.extended, 100000, "no double markup");
    await applyOwnerPricing(run, { estimate_id: estimateId, item_key: "scope:kitchen.demo", price_cents: 50000, basis: "internal_cost", principal: owner });
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.demo").extended, 60000, "internal cost marked up exactly once");
    const [sc2] = await run(`SELECT dedicated_price_cents::int AS c, price_basis FROM scope_items WHERE project_id = $1 AND key = 'kitchen.paint'`, [projectId]);
    assert.deepEqual([sc2.c, sc2.price_basis], [100000, "client_price"], "owner input preserved on the scope");
    // a later quote never overrides Joe's client price
    const q3 = await recordQuote(run, { project_id: projectId, supplier_kind: "sub", supplier_name: "ZZ Painter", quote_ref: "P1", lines: [{ description: "paint", unit: "ls", quantity: 1, extended_cents: 70000, scope_key: "kitchen.paint" }] });
    const q3r = await incorporateQuote(run, { quote_id: q3.quote_id, estimate_id: estimateId, principal: owner });
    assert.match(q3r.skipped[0].reason, /owner client price stands/);
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "scope:kitchen.paint").extended, 100000);

    assert.equal((await run(`SELECT count(*)::int AS n FROM purchase_orders WHERE project_id = $1`, [projectId]))[0].n, 0, "no implied purchase");
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 0);
  });
});

test("V37 + V17 price commitment: offer frozen at send, later supplier cost moves margin only, revised offer needs a fresh decision, allowance overage → CO payload + decision", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId, estimateId } = await mkProject(run, "zz-est-v37", "Replace 6 windows");
    await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '20')`);
    await prepareScopeRegisterFromLead(run, projectId, await loadLeadFacts(run, projectId));
    const product = { brand: "ZZ Marvin", model: "Elevate DH", finish: "Stone White" };
    await upsertEstimateLine(run, estimateId, { item_key: "item:windows", description: "Windows (6)", unit: "ea", qty: 6, scope_item_key: "windows.replace", source_kind: "online_price", source_ref: { product }, internal_cost_cents: 360000, cost_basis: "online:o1", cost_observed_at: new Date().toISOString(), provisional: true });
    await upsertEstimateLine(run, estimateId, { item_key: "allow:hardware", description: "Window hardware allowance", unit: "ls", qty: 1, scope_item_key: "windows.replace", source_kind: "allowance", is_allowance: true, allowance_cents: 60000, allowance_scope: "Window hardware" });
    await applyOwnerPricing(run, { estimate_id: estimateId, item_key: "scope:windows.replace", price_cents: 240000, basis: "client_price", principal: owner });
    await applyOwnerPricing(run, { estimate_id: estimateId, item_key: "scope:general.permits", price_cents: 30000, basis: "client_price", principal: owner });
    await applyOwnerPricing(run, { estimate_id: estimateId, item_key: "scope:general.pm", price_cents: 50000, basis: "client_price", principal: owner });
    let r = await estimateReadiness(run, estimateId);
    assert.ok(r.hard_gaps.length === 0, JSON.stringify(r.hard_gaps));
    assert.equal(r.eligibility, "fixed_proposal");
    assert.equal(r.margin.offered_cents, 360000 * 1.2 + 60000 + 240000 + 30000 + 50000);

    // Joe sends: freeze the offered prices
    const snap = await freezeOfferedPrices(run, estimateId, owner);
    await run(`UPDATE estimates SET status = 'sent', sent_at = now() WHERE id = $1`, [estimateId]);
    assert.equal(snap.lines.find((l) => l.item_key === "item:windows").extended, 432000);
    assert.equal(snap.total, 812000);

    // supplier quote comes in HIGHER → client price unchanged, margin down
    const up = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Window Co", quote_ref: "W1", includes_tax: true, includes_freight: true, lines: [{ description: "Elevate DH", product, unit: "ea", quantity: 6, extended_cents: 400000, item_key: "item:windows" }] });
    await incorporateQuote(run, { quote_id: up.quote_id, estimate_id: estimateId, principal: owner });
    let win = (await loadLines(run, estimateId)).find((l) => l.item_key === "item:windows");
    assert.equal(win.extended, 432000, "offered price immutable");
    assert.equal(win.internal_cost_cents, 400000);
    assert.equal(win.provisional, false);
    let m = await marginExposureReport(run, estimateId);
    assert.equal(m.offered_total_cents, 812000);
    assert.equal(m.lines.find((l) => l.item_key === "item:windows").margin_delta_cents, -40000);
    assert.equal((await run(`SELECT offer_stale, total FROM estimates WHERE id = $1`, [estimateId]))[0].offer_stale, false, "a cost change is not an offer change");
    // LOWER (revision 2) → margin up, client price still unchanged
    const down = await recordQuote(run, { project_id: projectId, supplier_kind: "vendor", supplier_name: "ZZ Window Co", quote_ref: "W1", revision: 2, includes_tax: true, includes_freight: true, lines: [{ description: "Elevate DH", product, unit: "ea", quantity: 6, extended_cents: 330000, item_key: "item:windows" }] });
    await incorporateQuote(run, { quote_id: down.quote_id, estimate_id: estimateId, principal: owner });
    win = (await loadLines(run, estimateId)).find((l) => l.item_key === "item:windows");
    assert.equal(win.extended, 432000);
    assert.equal(win.internal_cost_cents, 330000);
    m = await marginExposureReport(run, estimateId);
    assert.equal(m.lines.find((l) => l.item_key === "item:windows").margin_delta_cents, 30000);
    assert.equal((await run(`SELECT total FROM estimates WHERE id = $1`, [estimateId]))[0].total, 812000);
    assert.equal((await run(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'proposal'`))[0].n, 0, "no re-approval needed for an internal cost move");

    // V17: an estimate CHANGE after the offer invalidates it → proposal decision, superseded on the next change
    await upsertEstimateLine(run, estimateId, { item_key: "item:screens", description: "Screens", unit: "ea", qty: 6, source_kind: "owner_price", internal_cost_cents: 12000, cost_basis: "owner" });
    const rc = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    assert.equal(rc.offer_invalidated, true);
    assert.ok(rc.proposal_decision_id);
    const [d1] = await run(`SELECT kind, action, status FROM decisions WHERE id = $1`, [rc.proposal_decision_id]);
    assert.deepEqual([d1.kind, d1.action, d1.status], ["proposal", "send_estimate", "pending"]);
    assert.equal((await run(`SELECT offer_stale FROM estimates WHERE id = $1`, [estimateId]))[0].offer_stale, true);
    await run(`UPDATE estimate_lines SET qty = 7 WHERE estimate_id = $1 AND item_key = 'item:windows'`, [estimateId]);
    const rc2 = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    assert.notEqual(rc2.proposal_decision_id, rc.proposal_decision_id);
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [rc.proposal_decision_id]))[0].status, "superseded", "changed content supersedes the earlier proposal");
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "item:windows").extended, 432000, "still never silently repriced");
    r = await estimateReadiness(run, estimateId);
    assert.ok(r.hard_gaps.some((g) => g.kind === "offer_changed"));

    // allowance exceeded → priced CO payload + change_order decision, no change_orders row
    const over = await stageAllowanceOverage(run, { estimate_id: estimateId, item_key: "allow:hardware", chosen: { description: "Brass hardware set", cost_cents: 70000 }, principal: owner });
    assert.equal(over.payload.overage_cents, 84000 - 60000);
    assert.equal(over.payload.price_cents, 24000);
    const [co] = await run(`SELECT kind, action, amount_cents::int AS amt, status FROM decisions WHERE id = $1`, [over.decision_id]);
    assert.deepEqual([co.kind, co.action, co.amt, co.status], ["change_order", "prepare_change_order", 24000, "pending"]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM change_orders WHERE project_id = $1`, [projectId]))[0].n, 0, "the CO row is another workstream's write");
    const under = await stageAllowanceOverage(run, { estimate_id: estimateId, item_key: "allow:hardware", chosen: { description: "Basic hardware", cost_cents: 40000 }, principal: owner });
    assert.equal(under.payload, null);
    assert.equal(under.credit_cents, 12000);

    // V17: unknown / stale / wrong-unit never become a price
    await upsertEstimateLine(run, estimateId, { item_key: "item:mystery", description: "Trim", unit: "bananas", qty: 0, source_kind: "assumption", internal_cost_cents: null });
    const rc3 = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    const kinds = rc3.gaps.filter((g) => g.ref === "item:mystery").map((g) => g.kind).sort();
    assert.deepEqual(kinds, ["missing_quantity", "missing_unit", "unknown_cost"]);
    assert.equal((await loadLines(run, estimateId)).find((l) => l.item_key === "item:mystery").extended, 0);
    assert.ok(rc3.gaps.some((g) => g.kind === "unknown_cost"), "zero in the column is a gap on the record, not a price");
    await upsertEstimateLine(run, estimateId, { item_key: "item:old", description: "Old quote item", unit: "ea", qty: 1, source_kind: "supplier_quote", internal_cost_cents: 1000, cost_basis: "quote:old", cost_observed_at: "2025-01-01T00:00:00Z" });
    const rc4 = await recomputeDraftEstimate(run, estimateId, { principal: owner });
    assert.ok(rc4.gaps.some((g) => g.kind === "stale_price" && g.ref === "item:old"));
    const accepted = await acceptAssumptions(run, estimateId, owner.userId, ["missing_unit|item:mystery"]);
    assert.equal(accepted, 1);
    r = await estimateReadiness(run, estimateId);
    assert.ok(r.gaps_accepted.some((g) => g.ref === "item:mystery" && g.kind === "missing_unit"));
    assert.ok(r.hard_gaps.some((g) => g.ref === "item:mystery" && g.kind === "unknown_cost"), "accepting one assumption does not hide the rest");
  });
});

test("V25 learning: repeated ingestion does not amplify, late adjustment is a revision, outlier/small-sample guards, policy-gated auto update with rollback, markup change is a decision, pricing setup activation is owner-only", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = await seed(client);
    const { projectId } = await mkProject(run, "zz-est-v25");
    const p2 = await mkProject(run, "zz-est-v25b");
    const p3 = await mkProject(run, "zz-est-v25c");
    const [ci] = await run(`INSERT INTO cost_items (name, category, unit, unit_cost) VALUES ('ZZ Tile install', 'Tile', 'sf', 1000) RETURNING id`);
    const itemId = Number(ci.id);
    const actualsFor = (u) => [{ scope_key: "bath.tile", cost_item_id: itemId, unit: "sq ft", quantity: 100, actual_cost_cents: u * 100, source: "closeout" }];
    // wrong unit is rejected, not normalized into the wrong bucket
    const bad = await ingestCloseoutActuals(run, projectId, [{ scope_key: "x", cost_item_id: itemId, unit: "lf", quantity: 10, actual_cost_cents: 1000, source: "t" }], { learn: false });
    assert.match(bad.rejected[0].reason, /does not match/);
    // no policy → proposals only; cost book untouched
    const i1 = await ingestCloseoutActuals(run, projectId, actualsFor(1100), { principal: owner });
    assert.equal(i1.inserted, 1);
    assert.equal(i1.learning.mode, "proposed");
    assert.equal(i1.learning.policy, null);
    const i1b = await ingestCloseoutActuals(run, projectId, actualsFor(1100), { principal: owner });
    assert.equal(i1b.inserted, 0);
    assert.equal(i1b.duplicates, 1, "repeated closeout ingestion is a no-op");
    assert.equal((await run(`SELECT count(*)::int AS n FROM cost_observations WHERE cost_item_id = $1`, [itemId]))[0].n, 1, "not amplified");
    assert.equal((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [itemId]))[0].unit_cost, 1000);
    // two more jobs → 3 samples, still no policy → proposed
    await ingestCloseoutActuals(run, p2.projectId, actualsFor(1150));
    const i3 = await ingestCloseoutActuals(run, p3.projectId, actualsFor(1050));
    assert.equal(i3.learning.changes[0].verdict.apply, true, "guard passes with 3 samples within 25%");
    assert.equal(i3.learning.changes[0].applied, false, "…but policy learning.cost_update is not active");
    assert.equal((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [itemId]))[0].unit_cost, 1000);
    const prev = await costLearningPreview(run);
    assert.equal(prev.mode, "preview");
    assert.ok(prev.history.some((h) => h.kind === "proposal"));
    // activate policy → applied automatically, recorded with before value
    const pol = await proposePolicyVersion(run, "learning.cost_update", { min_samples: 3, max_delta_pct: 25 }, "owner:Joe");
    await activatePolicy(run, "learning.cost_update", pol.version);
    const i4 = await ingestCloseoutActuals(run, p3.projectId, actualsFor(1050), { principal: owner });
    assert.equal(i4.duplicates, 1);
    assert.equal(i4.learning.mode, "applied");
    assert.equal(i4.learning.policy, "policy:learning.cost_update@1");
    assert.equal((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [itemId]))[0].unit_cost, 1100);
    const [rev] = await run(`SELECT id, kind, status, changes, policy_ref FROM cost_learning_revisions WHERE id = $1`, [i4.learning.revision_id]);
    assert.equal(rev.kind, "auto_cost_update");
    assert.deepEqual(rev.changes[0], { cost_item_id: itemId, field: "unit_cost", before: 1000, after: 1100, sample_n: 3, delta_pct: 10 });
    // late adjustment = new revision, old row superseded, no double count
    const late = await ingestCloseoutActuals(run, p3.projectId, actualsFor(1200), { ingest_revision: 2, principal: owner });
    assert.equal(late.inserted, 1);
    assert.equal(late.superseded, 1);
    assert.equal((await run(`SELECT count(*)::int AS n FROM cost_observations WHERE cost_item_id = $1 AND superseded_by IS NULL`, [itemId]))[0].n, 3);
    // outlier: a 10× sample is flagged and excluded, not learned
    const p4 = await mkProject(run, "zz-est-v25d");
    const out = await ingestCloseoutActuals(run, p4.projectId, actualsFor(11000), { principal: owner });
    assert.deepEqual(out.learning.changes[0]?.verdict.outliers ?? [], [11000]);
    assert.equal((await run(`SELECT outlier FROM cost_observations WHERE project_id = $1`, [p4.projectId]))[0].outlier, true);
    assert.ok((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [itemId]))[0].unit_cost < 2000, "outlier did not move the cost");
    // big jump (3 samples all +60%) is held for review under the policy
    const [ci2] = await run(`INSERT INTO cost_items (name, category, unit, unit_cost) VALUES ('ZZ Demo', 'Demolition', 'sf', 500) RETURNING id`);
    for (const [pj, u] of [[projectId, 800], [p2.projectId, 810], [p3.projectId, 790]]) await ingestCloseoutActuals(run, pj, [{ scope_key: "kitchen.demo", cost_item_id: Number(ci2.id), unit: "sf", quantity: 10, actual_cost_cents: u * 10, source: "closeout" }], { principal: owner });
    assert.equal((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [ci2.id]))[0].unit_cost, 500, "beyond 25% → review, not applied");
    assert.ok((await run(`SELECT reason FROM cost_learning_revisions WHERE kind = 'proposal' ORDER BY created_at DESC LIMIT 1`))[0].reason.includes("exceeds 25%"));
    // rollback restores the before value (owner only)
    assert.equal((await rollbackLearningRevision(run, rev.id, staff)).ok, false);
    const rb = await rollbackLearningRevision(run, rev.id, owner);
    assert.equal(rb.ok, true);
    assert.equal((await run(`SELECT unit_cost FROM cost_items WHERE id = $1`, [itemId]))[0].unit_cost, 1000);
    assert.equal((await run(`SELECT status FROM cost_learning_revisions WHERE id = $1`, [rev.id]))[0].status, "rolled_back");
    // markup / profit change: decision only, nothing applied
    await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '20')`);
    const mk = await proposeMarkupChange(run, { markup_pct: 25, reason: "margin on closed jobs", principal: agent });
    assert.equal((await run(`SELECT kind, status FROM decisions WHERE id = $1`, [mk.decision_id]))[0].kind, "markup");
    assert.equal((await run(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`))[0].value, "20", "unchanged until Joe approves");
    // pricing setup: evidence-backed proposal with NULLs + reasons; activation is a decision; staff cannot activate
    const ps = await proposePricingSetup(run, agent);
    assert.equal(ps.state, "draft");
    assert.equal(ps.config.markup_pct, 20, "the current setting is evidence");
    assert.equal(ps.config.margin_target_pct, null);
    assert.match(ps.evidence.margin_target_pct.reason, /need 3/);
    assert.ok(Object.values(ps.config.labor_rates).every((r) => r.cents_per_hour === null && r.reason.length > 0), "unsupported rates are NULL with a reason, never 0");
    const st = await activatePricingSetup(run, ps.version, staff, "app");
    assert.equal(st.state, "pending_decision");
    assert.equal((await run(`SELECT state FROM pricing_setups WHERE version = $1`, [ps.version]))[0].state, "draft");
    const act = await activatePricingSetup(run, ps.version, owner, "app");
    assert.equal(act.state, "active");
    assert.equal((await run(`SELECT state FROM pricing_setups WHERE version = $1`, [ps.version]))[0].state, "active");
    assert.equal((await run(`SELECT status, decided_via FROM decisions WHERE id = $1`, [act.decision_id]))[0].decided_via, "app");
  });
});
