import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { openCase, closeCase, recordOwnerTouch, measurementSummary, getCase } from "../lib/measure/cases.ts";
import { baselineOwnerTouches } from "../lib/measure/baseline.ts";
import { setCapabilityState, capabilityReport, ensureCapabilities, CAPABILITIES, CapabilityEvidenceRequired } from "../lib/measure/capabilities.ts";
import { snapshotProcedures, checkProcedures, listOpenChecks, classifyPendingMemories } from "../lib/measure/procedures.ts";
import { activatePolicy, proposePolicyVersion } from "../lib/commands/policies.ts";
import { addSubscription, addMeteredCharge, overheadSummary, reconcileWithExpenses, DuplicateOverheadError, setAlertThreshold, checkOverheadAlert, listSubscriptions } from "../lib/overhead/overhead.ts";

// V20 (measurement) against a REAL disposable Postgres (SJC_TEST_CLUSTER_TAG=measure).
// Skipped only when the postgres binaries are missing — never production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const runOver = (client) => async (sql, params) => (await client.query(sql, params)).rows;

async function cleanMeasure(client) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE measurement_cases, procedure_versions, procedure_checks, metered_charges RESTART IDENTITY`);
  await client.query(`DELETE FROM overhead_subscriptions WHERE name LIKE 'zz-%' OR external_ref LIKE 'zz-%'`);
  await client.query(`DELETE FROM agent_memories WHERE summary LIKE 'zz-%'`);
  await client.query(`DELETE FROM skills WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM runbooks WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM expenses WHERE source_ref LIKE 'zz-%'`);
  await client.query(`DELETE FROM work_items WHERE title LIKE 'zz-%'`);
  await client.query(`DELETE FROM notifications WHERE title LIKE '%Overhead for%'`);
  await client.query(`DELETE FROM app_settings WHERE key LIKE 'overhead.%'`);
  await client.query(`UPDATE capability_status SET implemented=false, deployed=false, enabled=false, proven=false, evidence='[]'::jsonb WHERE key LIKE 'zz-%' OR key = 'A18'`);
}

const WINDOW = { from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" };

test("V20 cases: failed case stays in the denominator; manual correction counts as owner time; unknowns labelled", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    const [wi] = await run(`INSERT INTO work_items (title) VALUES ('zz-follow up Larson') RETURNING id`);

    const ok = await openCase(run, { kind: "lead_followup", ref: { kind: "lead", id: "zz-l1" } });
    const again = await openCase(run, { kind: "lead_followup", ref: { kind: "lead", id: "zz-l1" } });
    assert.equal(again.id, ok.id, "re-opening the same reference returns the existing case");
    const fail = await openCase(run, { kind: "lead_followup", ref: { kind: "lead", id: "zz-l2" } });
    const corrected = await openCase(run, { kind: "lead_followup", ref: { kind: "lead", id: "zz-l3" }, workItemId: wi.id });
    const missed = await openCase(run, { kind: "invoice", ref: { kind: "invoice", id: "zz-i1" } });
    const excluded = await openCase(run, { kind: "invoice", ref: { kind: "invoice", id: "zz-i2" }, eligible: false, notes: "test fixture" });
    await openCase(run, { kind: "invoice", ref: { kind: "invoice", id: "zz-i3" } }); // stays pending

    await closeCase(run, ok.id, { outcome: "verified_success", mode: "unattended", costUsd: 0.12, latencyMs: 4000 });
    await closeCase(run, fail.id, { outcome: "failed", notes: "provider rejected" });
    // Joe corrected the agent's draft by hand: a review touch (timed) + an approve tap (untimed) on the work item.
    await recordOwnerTouch(run, { kind: "correction", workItemId: wi.id, seconds: 240, detail: { what: "rewrote the draft" } });
    await recordOwnerTouch(run, { kind: "approve", workItemId: wi.id });
    await closeCase(run, corrected.id, { outcome: "corrected" });
    await closeCase(run, missed.id, { outcome: "missed_commitment" });
    await closeCase(run, excluded.id, { outcome: "verified_success" });

    const c = await getCase(run, corrected.id);
    assert.equal(c.owner_seconds, 240, "manual correction time is derived from the linked owner touch");
    assert.equal(c.mode, "assisted", "a correction is assisted work, not one-tap and never unattended");
    const f = await getCase(run, fail.id);
    assert.equal(f.outcome, "failed");
    assert.equal(f.eligible, true, "a failed case is still eligible (in the denominator)");
    assert.equal(f.owner_seconds, null, "no touch → owner time unknown, not zero");
    assert.ok(Number(f.latency_ms) >= 0, "latency computed at close");

    const s = await measurementSummary(run, WINDOW);
    const lead = s.kinds.find((k) => k.kind === "lead_followup");
    assert.equal(lead.eligible, 3);
    assert.deepEqual(lead.verified_rate, { numerator: 1, denominator: 3, value: 1 / 3 }, "failed + corrected cases stay in the denominator");
    assert.equal(lead.unattended, 1);
    assert.equal(lead.assisted, 1);
    assert.equal(lead.owner_minutes, 4);
    assert.equal(lead.owner_minutes_unknown, 2, "cases without touches are labelled unknown, not 0");
    const inv = s.kinds.find((k) => k.kind === "invoice");
    assert.equal(inv.eligible, 2);
    assert.equal(inv.excluded, 1, "explicit exclusions are visible");
    assert.equal(inv.pending, 1);
    assert.equal(inv.missed_commitment, 1);
    assert.deepEqual(inv.verified_rate, { numerator: 0, denominator: 1, value: 0 });
    assert.equal(s.totals.eligible, 5);
    assert.deepEqual(s.window, WINDOW, "the observation window is part of the summary");
    assert.ok(s.caveats.some((x) => /denominator/.test(x)));
    assert.ok(s.caveats.some((x) => /unknown cost/.test(x)), "unknown cost is labelled");
    assert.equal(s.owner_touches.touches, 2);
    assert.equal(s.owner_touches.touches_unknown_seconds, 1);
    assert.equal(s.owner_touches.minutes_known, 4);
    assert.equal(typeof s.agent_cost.known_total_usd, "number");
    assert.equal(s.agent_cost.agent_usage_usd !== undefined, true, "agent_usage guarded (null when absent, number when present)");
    assert.ok(!("automation_pct" in s) && !("automation_percentage" in s.totals), "no company-wide automation percentage");
  });
});

test("V20 baseline: computes from existing shapes (grants, decisions, work items, notifications, runs)", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    // schema.sql seeds demo rows in some of these tables — assert on deltas.
    const before = await baselineOwnerTouches(run, WINDOW);
    const b0 = Object.fromEntries(before.sources.map((s) => [s.source, s]));
    await run(`INSERT INTO owner_grants (status, actions, decided_at, audit) VALUES ('approved', ARRAY['send_email'], now(), '[{"at":"x"}]'::jsonb), ('denied', ARRAY['send_sms'], now(), '[]'::jsonb)`);
    await run(`INSERT INTO decisions (kind, action, title, status, decided_via, decided_at) VALUES ('package_release','send_bid_package','zz d','approved','telegram', now())`);
    await run(`INSERT INTO work_items (title, approval_status) VALUES ('zz-approved item', 'approved'), ('zz-rejected item', 'rejected')`);
    await run(`INSERT INTO notifications (kind, title, read) VALUES ('decision', 'zz read', true), ('decision', 'zz unread', false)`);
    await run(`INSERT INTO agent_runs (runtime_name, status, cost_usd) VALUES ('hermes', 'failed', NULL), ('claude', 'succeeded', 0.5)`);
    await run(`INSERT INTO dev_agent_runs (prompt, status, cost_usd) VALUES ('zz', 'done', 0.25)`);
    await recordOwnerTouch(run, { kind: "review", seconds: 60 });

    const b = await baselineOwnerTouches(run, WINDOW);
    const by = Object.fromEntries(b.sources.map((s) => [s.source, s]));
    const d = (k) => by[k].touches - b0[k].touches;
    assert.equal(d("owner_grants"), 2);
    assert.equal(by.owner_grants.detail.spent_uses - b0.owner_grants.detail.spent_uses, 1);
    assert.equal(d("decisions"), 1);
    assert.equal(by.decisions.detail.telegram, 1);
    assert.equal(d("work_items"), 2);
    assert.equal(d("notifications"), 1);
    assert.equal(d("owner_touches"), 1);
    assert.equal(by.owner_touches.seconds_known, 60);
    assert.equal(b.owner_touches_estimated - before.owner_touches_estimated, 2 + 1 + 2 + 1, "notification reads are attention, not touches");
    assert.equal(b.owner_seconds_known, 60);
    assert.equal(by.owner_grants.seconds_known, 0, "derived sources never invent seconds");
    assert.equal(b.agent_activity.agent_runs - before.agent_activity.agent_runs, 2);
    assert.equal(b.agent_activity.agent_runs_failed - before.agent_activity.agent_runs_failed, 1);
    assert.equal(Math.round((b.agent_activity.known_cost_usd - before.agent_activity.known_cost_usd) * 100) / 100, 0.75);
    assert.ok(b.caveats.some((c) => /not an automation percentage/.test(c)));
  });
});

test("V20 overhead: seeds present, duplicate import refused, subscription ≠ credits, threshold only notifies, reconcile by ref only", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    const seeded = await listSubscriptions(run);
    const anth = seeded.find((s) => s.vendor === "Anthropic");
    const oai = seeded.find((s) => s.vendor === "OpenAI");
    assert.equal(anth?.amount_cents, 20000);
    assert.equal(oai?.amount_cents, 1000);
    assert.equal(anth.source, "owner_reported");
    assert.match(anth.notes, /does not include API credits/);

    const sub = await addSubscription(run, { name: "zz-Telnyx", vendor: "zz-Telnyx", amountCents: 1500, startedOn: "2026-01-01", externalRef: "zz-qbo-bill-1" });
    await assert.rejects(addSubscription(run, { name: "zz-Telnyx again", vendor: "zz-Telnyx", amountCents: 1500, startedOn: "2026-02-01", externalRef: "zz-qbo-bill-1" }), DuplicateOverheadError, "same external_ref refused");
    await assert.rejects(addSubscription(run, { name: "zz-Telnyx", vendor: "zz-Telnyx", amountCents: 9999, startedOn: "2026-01-01" }), DuplicateOverheadError, "same name+vendor+start refused even at a different amount");
    // A different amount with a different ref is NOT deduped on amount — it is a second, distinct line.
    const other = await addSubscription(run, { name: "zz-Telnyx numbers", vendor: "zz-Telnyx", amountCents: 1500, startedOn: "2026-03-01", externalRef: "zz-qbo-bill-2" });
    assert.notEqual(other.id, sub.id);
    const yearly = await addSubscription(run, { name: "zz-Domain", vendor: "zz-Registrar", amountCents: 12000, cadence: "yearly", startedOn: "2025-06-01" });
    assert.ok(yearly.id);

    await addMeteredCharge(run, { provider: "Anthropic", period: "2026-09", amountCents: 3450, source: "bill", externalRef: "zz-anth-2026-09" });
    await assert.rejects(addMeteredCharge(run, { provider: "Anthropic", period: "2026-09", amountCents: 3450, source: "bill", externalRef: "zz-anth-2026-09" }), DuplicateOverheadError);

    const s = await overheadSummary(run, "2026-09");
    assert.equal(s.fixed.monthly_cents, 20000 + 1000 + 1500 + 1500 + 1000, "yearly normalised to monthly; fixed excludes metered");
    assert.equal(s.metered.cents, 3450);
    assert.deepEqual(s.metered.by_provider, [{ provider: "anthropic", cents: 3450, source: ["bill"] }]);
    assert.ok(s.metered.unknown_providers.includes("openai"), "OpenAI has a subscription but no metered record → unknown, not $0");
    assert.equal(s.total_known_cents, 25000 + 3450);
    assert.ok(s.caveats.some((c) => /does not include API credits/.test(c)));
    assert.ok(s.caveats.some((c) => /owner-reported and not yet reconciled/.test(c)));
    assert.equal(s.alert.threshold_cents, null);

    await setAlertThreshold(run, 20000);
    const a1 = await checkOverheadAlert(run, "2026-09");
    assert.equal(a1.exceeded, true);
    assert.equal(a1.notified, true);
    const a2 = await checkOverheadAlert(run, "2026-09");
    assert.equal(a2.notified, false, "notifies once per month");
    const [n] = await run(`SELECT count(*)::int AS c FROM notifications WHERE kind = 'money' AND title LIKE 'Overhead for 2026-09%'`);
    assert.equal(n.c, 1);
    const [lanes] = await run(`SELECT count(*)::int AS c FROM lane_pauses`);
    assert.equal(lanes.c, 0, "threshold only notifies — no lane paused");

    await run(`INSERT INTO expenses (expense_date, vendor_label, kind, amount_cents, source_ref) VALUES ('2026-09-01', 'zz-Telnyx', 'other', 1500, 'zz-qbo-bill-1'), ('2026-09-02', 'zz-Telnyx', 'other', 1500, 'zz-other-ref')`);
    const rec = await reconcileWithExpenses(run);
    const line = rec.lines.find((l) => l.subscription.id === sub.id);
    assert.equal(line.status, "matched");
    assert.equal(line.matches.length, 1, "matched by external_ref only");
    assert.equal(line.candidates.length, 1, "same-amount same-vendor expense is a candidate, never auto-linked");
    const line2 = rec.lines.find((l) => l.subscription.id === other.id);
    assert.equal(line2.status, "unmatched", "ref with no expense is unmatched, not matched on amount");
    const anthLine = rec.lines.find((l) => l.subscription.id === anth.id);
    assert.equal(anthLine.status, "no_external_ref");
  });
});

test("V20 capabilities: four states independent; evidence required to claim; all 28 tasks seeded false", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    await ensureCapabilities(run);
    const before = await capabilityReport(run);
    const tasks = before.rows.filter((r) => r.group === "task");
    assert.equal(tasks.length, 28);
    assert.equal(CAPABILITIES.filter((c) => c.group === "task").length, 28);
    assert.ok(tasks.every((r) => !r.implemented && !r.deployed && !r.enabled && !r.proven), "seeded as not implemented");

    await assert.rejects(setCapabilityState(run, "A18", { implemented: true }), CapabilityEvidenceRequired);
    const r1 = await setCapabilityState(run, "A18", { implemented: true, evidence: { version: "abc123", note: "tests green on harness", date: "2026-09-23" } });
    assert.deepEqual([r1.implemented, r1.deployed, r1.enabled, r1.proven], [true, false, false, false]);
    const r2 = await setCapabilityState(run, "A18", { proven: true, evidence: { version: "abc123", note: "fixture only", date: "2026-09-23" } });
    assert.deepEqual([r2.implemented, r2.deployed, r2.enabled, r2.proven], [true, false, false, true], "proven does not imply deployed or enabled");
    const r3 = await setCapabilityState(run, "A18", { implemented: false });
    assert.deepEqual([r3.implemented, r3.deployed, r3.enabled, r3.proven], [false, false, false, true], "clearing one state leaves the others");
    assert.equal(r3.evidence.length, 2);
    assert.deepEqual(r3.evidence[1].states, ["proven"]);
    const after = await capabilityReport(run);
    assert.equal(after.counts.proven, 1);
    assert.equal(after.counts.implemented, 0);
  });
});

test("V20 procedures: snapshot versions; flag missing tool, retired field, contradiction, unapproved rule; resolve when fixed", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    const [skill] = await run(`INSERT INTO skills (slug, title, review_status, active) VALUES ('zz-invoicing', 'zz invoicing', 'approved', true) RETURNING id`);
    const [v] = await run(
      `INSERT INTO skill_versions (skill_id, version, body_markdown, status) VALUES ($1, 1, $2, 'approved') RETURNING id`,
      [skill.id, "Call get_project then send_invoice_magic to the client. Invoices always need Joe's send. Check retainer_status before billing."],
    );
    await run(`UPDATE skills SET current_version_id = $1 WHERE id = $2`, [v.id, skill.id]);
    const [prop] = await run(`INSERT INTO skills (slug, title, review_status, active, proposed_by) VALUES ('zz-auto-pay', 'zz auto pay', 'proposed', true, 'hermes') RETURNING id`);
    const [pv] = await run(`INSERT INTO skill_versions (skill_id, version, body_markdown, status) VALUES ($1, 1, 'From now on always pay vendor invoices without asking Joe.', 'proposed') RETURNING id`, [prop.id]);
    await run(`UPDATE skills SET current_version_id = $1 WHERE id = $2`, [pv.id, prop.id]);
    await run(`INSERT INTO runbooks (slug, title, body_markdown) VALUES ('zz-rb', 'zz rb', 'Use list_work_items and record_receipt.')`);
    await run(`INSERT INTO agent_memories (summary, content, memory_type, review_status) VALUES ('zz-rule', 'From now on always send invoices the same day without approval.', 'instruction', 'pending')`);
    await run(`INSERT INTO agent_memories (summary, content, memory_type, review_status, lead_id) VALUES ('zz-pref', 'The Larsons prefer texts instead of email.', 'preference', 'pending', NULL)`);
    await run(`INSERT INTO agent_memories (summary, content, memory_type, review_status) VALUES ('zz-fact', 'The deck is actually 14x20 ft, not 12x20.', 'fact', 'pending')`);

    const snap = await snapshotProcedures(run, { knownTools: ["get_project", "send_invoice", "list_work_items", "record_receipt"] });
    const sk = snap.procedures.find((p) => p.key === "zz-invoicing");
    assert.deepEqual(sk.tool_refs, ["get_project", "send_invoice_magic"]);
    assert.deepEqual(sk.field_refs, ["retainer_status"]);
    assert.ok(snap.recorded >= 3);
    const snap2 = await snapshotProcedures(run, { knownTools: ["get_project"] });
    assert.equal(snap2.recorded, 0, "unchanged bodies are not re-recorded");

    const known = ["get_project", "send_invoice", "list_work_items", "record_receipt"];
    // Without the invoice policy active, "invoices always need Joe's send" is not a contradiction.
    const r0 = await checkProcedures(run, { knownTools: known });
    const kinds0 = r0.findings.filter((f) => f.procedure_key === "zz-invoicing").map((f) => f.check_kind).sort();
    assert.deepEqual(kinds0, ["missing_tool", "retired_field"]);
    assert.ok(r0.findings.some((f) => f.check_kind === "unapproved_authority_change" && f.procedure_kind === "memory"), "pending authority memory flagged as proposed rule");
    assert.ok(r0.findings.some((f) => f.check_kind === "unapproved_authority_change" && f.procedure_key === "zz-auto-pay"), "proposed skill changing pay authority flagged");
    assert.ok(!r0.findings.some((f) => f.procedure_key === "zz-rb"), "runbook naming only real tools is clean");

    const p = await proposePolicyVersion(run, "invoice.initial_on_acceptance", { enabled: true }, "test");
    await activatePolicy(run, p.key, p.version);
    const r1 = await checkProcedures(run, { knownTools: known });
    const kinds1 = r1.findings.filter((f) => f.procedure_key === "zz-invoicing").map((f) => f.check_kind).sort();
    assert.deepEqual(kinds1, ["contradiction", "missing_tool", "retired_field"]);
    assert.equal(r1.opened, 1, "only the new contradiction opened; existing rows kept");
    const open = await listOpenChecks(run);
    const fpSet = new Set(open.map((c) => c.fingerprint));
    assert.equal(fpSet.size, open.length, "one open row per finding");

    // Fix the skill: real tool, no retired field, no contradiction.
    await run(`UPDATE skill_versions SET body_markdown = 'Call get_project then send_invoice.' WHERE id = $1`, [v.id]);
    const r2 = await checkProcedures(run, { knownTools: known });
    assert.equal(r2.resolved, 3);
    assert.ok(!(await listOpenChecks(run)).some((c) => c.procedure_key === "zz-invoicing"));

    // Nothing promoted: memories and skills untouched.
    const [m] = await run(`SELECT review_status, can_use_as_instruction FROM agent_memories WHERE summary = 'zz-rule'`);
    assert.deepEqual(m, { review_status: "pending", can_use_as_instruction: false });
    const [ps] = await run(`SELECT review_status FROM skills WHERE slug = 'zz-auto-pay'`);
    assert.equal(ps.review_status, "proposed");

    const classified = await classifyPendingMemories(run);
    const byS = Object.fromEntries(classified.filter((c) => c.summary.startsWith("zz-")).map((c) => [c.summary, c.classification]));
    assert.equal(byS["zz-rule"], "proposed_company_rule");
    assert.equal(byS["zz-fact"], "factual_correction");
    assert.equal(byS["zz-pref"], "one_job_preference");
  });
});

test("V20 MCP: measure tools register and answer against the harness; procedure_checks records the server's tool list", { skip }, async () => {
  const { registerMeasureTools, registeredToolNames } = await import("../mcp/measure-tools.mjs");
  await withTestDb(async (url, client) => {
    await cleanMeasure(client);
    const run = runOver(client);
    const tools = {};
    const server = { _registeredTools: { get_project: {}, send_invoice: {} }, registerTool(name, meta, handler) { tools[name] = handler; this._registeredTools[name] = {}; } };
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url, max: 2 });
    try {
      registerMeasureTools(server, { rows: run, json: (d) => ({ content: [{ type: "text", text: JSON.stringify(d) }] }), pool });
      assert.deepEqual(Object.keys(tools).sort(), ["capability_report", "measurement_summary", "overhead_summary", "procedure_checks"]);
      assert.ok(registeredToolNames(server).includes("measurement_summary"));
      await run(`INSERT INTO runbooks (slug, title, body_markdown) VALUES ('zz-rb2', 'zz', 'Use get_project then send_invoice_magic.')`);
      const parse = (r) => JSON.parse(r.content[0].text);
      const pc = parse(await tools.procedure_checks({}));
      assert.ok(pc.open.some((c) => c.check_kind === "missing_tool" && c.procedure_key === "zz-rb2"));
      const [setting] = await run(`SELECT value FROM app_settings WHERE key = 'measure.known_tools'`);
      assert.ok(JSON.parse(setting.value).includes("procedure_checks"), "server tool list recorded for the in-app re-run");
      const ms = parse(await tools.measurement_summary({ days: 7 }));
      assert.ok(ms.summary.window.from && ms.baseline.sources.length >= 5);
      const cr = parse(await tools.capability_report({}));
      assert.equal(cr.rows.filter((r) => r.group === "task").length, 28);
      const os = parse(await tools.overhead_summary({ include_reconciliation: true }));
      assert.ok(os.summary.fixed.monthly_cents >= 21000 && os.reconciliation.lines.length >= 2);
    } finally {
      await pool.end();
    }
  });
});
