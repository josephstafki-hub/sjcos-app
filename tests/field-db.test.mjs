import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, cleanField, seedField, spyHooks } from "./field-fixtures.mjs";
import { resolveDecision, getDecision } from "../lib/commands/decisions.ts";
import { proposePolicyVersion, activatePolicy } from "../lib/commands/policies.ts";
import { recordSubProgress, completionReportReceived, confirmMilestone, compileWeeklySubReport, FieldAuthError } from "../lib/field/reports.ts";
import { reportSnag, applyOwnerSnagDecision, openIncidents } from "../lib/field/incidents.ts";
import { buildWeeklyClientSummary, dueWeeklySummaries, assembleWeeklyContent } from "../lib/field/weekly-summary.ts";
import { prepareTentativeSchedule, submitScheduleForApproval, confirmSchedule, adjustInternalSchedule, layoutPhases, planBuyout } from "../lib/field/schedule-plans.ts";
import { sweepApprovedFieldDecisions } from "../lib/field/apply-decisions.ts";
import { centralMidnight, weeklySlotInstant, centralWeekStart } from "../lib/field/dates.ts";

// V23 / V41 / V42 / V39 / V18 / V19 for A16 against the disposable harness.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

async function fresh(client) {
  await cleanFoundation(client);
  await cleanField(client);
  return seedField(client);
}

async function activateWeeklyPolicy(run) {
  const p = await proposePolicyVersion(run, "weekly.client_summary", { weekday: 5, hour: 15, minute: 0, send_email: true }, "test");
  await activatePolicy(run, "weekly.client_summary", p.version);
}

test("V23 weekly updates: duplicate upload deduped, conflicting progress not resolved into completion, urgent snag held while other facts publish, private file excluded, replay-safe release", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    const { hooks } = spyHooks();
    await activateWeeklyPolicy(run);
    const ws = await centralWeekStart(run);

    // Same bytes uploaded twice under two ids (sha equal) + a straight duplicate id.
    await recordSubProgress(run, f.subA, { projectId: f.p1, body: "Tile at 50% on the floor", photos: [{ fileId: "zz-f1", sha256: "AAA" }, { fileId: "zz-f1" }], clientEventId: "e1" });
    await recordSubProgress(run, f.subA, { projectId: f.p1, body: "Tile at 80% on the floor", photos: [{ fileId: "zz-f2", sha256: "AAA" }, { fileId: "zz-f3", sha256: "BBB" }], clientEventId: "e2" });
    // Internal note with a private file — never client material.
    await recordSubProgress(run, f.owner, { projectId: f.p1, body: "Sub invoice came in at $4,200 — over the bid", photos: [{ fileId: "zz-priv" }], visibility: "internal", clientEventId: "e3" });
    // A completion CLAIM (unverified) — must not read as done.
    await completionReportReceived(run, f.subA, { projectId: f.p1, milestoneKey: "tile", milestoneLabel: "Tile", body: "Tile complete", photos: [{ fileId: "zz-f4" }], clientEventId: "e4", minPhotos: 1 }, hooks);
    // Urgent snag: cost + delay. Goes to Joe, not the client.
    const snag = await reportSnag(run, f.subA, { projectId: f.p1, body: "Subfloor rotten under the tile — needs replacing, adds 2 days and ~$900", affectedScope: "tile", impacts: { cost: { cents: 90000 }, schedule: { days: 2 } }, recommendation: "Pause tile, replace subfloor first", actualSiteStatus: "crew stopped", clientEventId: "e5" }, hooks);
    assert.equal(snag.decision.kind, "snag_decision");
    assert.deepEqual(snag.decision.options, ["continue", "pause", "other"]);

    const content = await assembleWeeklyContent(run, f.p1, ws);
    // Dedupe: zz-f1 once, zz-f2 (same sha as f1) dropped, zz-f3 kept, zz-f4 on the completion claim.
    assert.ok(!content.photos.includes("zz-f2"), "same-bytes re-upload deduped");
    assert.ok(!content.photos.includes("zz-priv"), "private file excluded");
    const texts = content.claims.map((c) => c.text);
    assert.ok(texts.some((t) => t.includes("50%")) && texts.some((t) => t.includes("80%")), "conflicting progress both kept, source-linked, nothing invented");
    assert.ok(!texts.some((t) => /rotten|\$900|4,200/i.test(t)), "snag/cost text held");
    assert.ok(texts.some((t) => t.includes("pending Joe's site check")), "completion claim marked unverified");
    assert.ok(content.held.length >= 1, "held items recorded internally");
    for (const c of content.claims) assert.ok(c.reportId, "every claim source-linked");

    // Publish under the active policy → intents; second build is a no-op.
    const a = await buildWeeklyClientSummary(run, f.owner, f.p1, ws);
    assert.equal(a.outcome, "published");
    assert.ok(a.summary.publish_intent_id && a.summary.email_intent_id);
    const b = await buildWeeklyClientSummary(run, f.owner, f.p1, ws);
    assert.equal(b.outcome, "already_published");
    assert.equal(b.summary.id, a.summary.id);
    const intents = await run(`SELECT kind, payload FROM action_intents WHERE project_id = $1`, [f.p1]);
    assert.equal(intents.length, 2, "one portal + one email intent, not duplicated");
    for (const i of intents) assert.ok(!JSON.stringify(i.payload).match(/rotten|4,200|zz-priv/), "intent payload carries no held/private content");
  });
});

test("V41 field evidence: weekly photos reused, missing part asked once, completion → decision, Joe confirms → hook once, repeated timer → one summary", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    const { hooks, calls } = spyHooks();
    await activateWeeklyPolicy(run);

    // Proactive photos during the week → weekly report needs nothing more.
    await recordSubProgress(run, f.subA, { projectId: f.p1, body: "Backer board down", photos: [{ fileId: "zz-f1" }], clientEventId: "w1" });
    const wk = await compileWeeklySubReport(run, { projectId: f.p1, subSlug: "zz-sub-a", principal: f.owner }, hooks);
    assert.deepEqual(wk.missing, []);
    assert.equal(wk.requested, false);
    assert.equal(calls.followUps.length, 0);
    // Sub C on p1 supplied nothing → asked once, precisely.
    const c1 = await compileWeeklySubReport(run, { projectId: f.p1, subSlug: "zz-sub-c", principal: f.owner }, hooks);
    assert.equal(c1.requested, true);
    const c2 = await compileWeeklySubReport(run, { projectId: f.p1, subSlug: "zz-sub-c", principal: f.owner }, hooks);
    assert.equal(c2.requested, false, "not asked twice");
    assert.equal(calls.followUps.length, 1);

    // Completion with one photo and no niche view → ask ONLY for the niche once.
    const r1 = await completionReportReceived(run, f.subA, { projectId: f.p1, milestoneKey: "shower", milestoneLabel: "Shower", body: "Shower tile done", photos: [{ fileId: "zz-f2" }], clientEventId: "c1", minPhotos: 1, requiredViews: ["niche"] }, hooks);
    assert.deepEqual(r1.missing, ["photo of the niche"]);
    assert.equal(r1.requested, true);
    assert.equal(r1.decision.status, "pending");
    const r1b = await completionReportReceived(run, f.subA, { projectId: f.p1, milestoneKey: "shower", body: "still done", photos: [{ fileId: "zz-f2" }], clientEventId: "c1b", minPhotos: 1, requiredViews: ["niche"] }, hooks);
    assert.equal(r1b.requested, false, "same missing part is not requested again");
    assert.equal(calls.followUps.length, 2);
    // Niche arrives → nothing missing; decision superseded by the fuller evidence.
    const r2 = await completionReportReceived(run, f.subA, { projectId: f.p1, milestoneKey: "shower", body: "Niche shot", photos: [{ fileId: "zz-f3" }], photoTags: ["niche"], clientEventId: "c2", minPhotos: 1, requiredViews: ["niche"] }, hooks);
    assert.deepEqual(r2.missing, []);
    assert.notEqual(r2.decision.id, r1.decision.id);
    assert.equal((await getDecision(run, r1.decision.id)).status, "superseded");
    // Nothing is confirmed until Joe taps.
    assert.equal(calls.milestones.length, 0);
    const before = await confirmMilestone(run, r2.decision.id, hooks);
    assert.equal(before.ok, false);
    const res = await resolveDecision(run, { id: r2.decision.id, outcome: "approved", principal: f.owner, via: "app" });
    assert.equal(res.ok, true);
    const c = await confirmMilestone(run, r2.decision.id, hooks);
    assert.deepEqual([c.ok, c.confirmed, c.hookFired], [true, true, true]);
    const again = await confirmMilestone(run, r2.decision.id, hooks);
    assert.equal(again.ok, true);
    assert.equal(again.hookFired, false, "hook fires once");
    await sweepApprovedFieldDecisions(run, f.owner, hooks);
    assert.equal(calls.milestones.length, 1);
    const [mc] = await run(`SELECT verification FROM field_reports WHERE claimed_milestone_key = 'shower' LIMIT 1`);
    assert.equal(mc.verification, "owner_confirmed");

    // Repeated weekly timer: Friday 16:00 Central this week → due once; two ticks → one row.
    const ws = await centralWeekStart(run);
    const fridayAfter = new Date(await weeklySlotInstant(run, ws, 5, 16, 0));
    const due1 = (await dueWeeklySummaries(run, fridayAfter)).filter((d) => d.projectId === f.p1);
    assert.equal(due1.length, 1);
    await buildWeeklyClientSummary(run, f.owner, f.p1, ws);
    const due2 = (await dueWeeklySummaries(run, fridayAfter)).filter((d) => d.projectId === f.p1);
    assert.equal(due2.length, 0, "already built this week");
    await buildWeeklyClientSummary(run, f.owner, f.p1, ws);
    const [{ n }] = await run(`SELECT count(*)::int AS n FROM weekly_summaries WHERE project_id = $1`, [f.p1]);
    assert.equal(n, 1);
    // Before the slot (Thursday) nothing is due.
    const thursday = new Date(await weeklySlotInstant(run, ws, 4, 15, 0));
    assert.equal((await dueWeeklySummaries(run, thursday)).filter((d) => d.projectId === f.p2).length, 0);
  });
});

test("V42 schedule and snags: harmless internal move auto, downstream commitment → immediate alert + decision, snag pending → no agent decision, owner instruction applied", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    const { hooks, calls } = spyHooks({ initialPaymentReceived: async () => true });
    await run(`INSERT INTO signature_requests (project_id, doc_type, title, status, signed_at) VALUES ($1, 'contract', 'zz-contract', 'signed', now())`, [f.p1]);

    const plan = await prepareTentativeSchedule(run, f.owner, {
      projectId: f.p1,
      startDate: "2026-10-05",
      phases: [
        { key: "demo", label: "Demo", durationDays: 2 },
        { key: "rough", label: "Rough-in", durationDays: 3, dependsOn: ["demo"], crew: "zz-sub-b" },
        { key: "trim", label: "Trim", durationDays: 2, dependsOn: ["rough"] },
      ],
    }, hooks);
    const sub = await submitScheduleForApproval(run, f.owner, plan.id);
    await resolveDecision(run, { id: sub.decision.id, outcome: "approved", principal: f.owner, via: "app" });
    const conf = await confirmSchedule(run, plan.id, hooks, [{ party: "sub", partyRef: "zz-sub-b", phaseKey: "rough", date: "2026-10-07", promise: "electrician rough-in" }]);
    assert.equal(conf.ok, true);

    // Trim slides 2 days: no commitment, no cost → automatic.
    const ok = await adjustInternalSchedule(run, f.owner, { planId: conf.plan.id, changes: [{ phaseKey: "trim", start: "2026-10-14", end: "2026-10-15" }], costDeltaCents: 0 }, hooks, "policy:schedule.internal_adjust@1");
    assert.equal(ok.applied, true);
    assert.equal(ok.checks.noCommitmentChange.ok, true);
    assert.equal(calls.alerts.length, 0);
    // Demo slips a day → rough-in (a sub promise) moves → immediate alert + decision, nothing applied.
    const bad = await adjustInternalSchedule(run, f.owner, { planId: ok.plan.id, changes: [{ phaseKey: "demo", start: "2026-10-06", end: "2026-10-07" }], costDeltaCents: 0 }, hooks, null);
    assert.equal(bad.applied, false);
    assert.equal(bad.checks.noCommitmentChange.ok, false);
    assert.equal(bad.decision.kind, "schedule_impact");
    assert.equal(calls.alerts.length, 1);
    assert.match(calls.alerts[0].title, /Schedule impact/);
    const [latest] = await run(`SELECT status, revision FROM schedule_plans WHERE project_id = $1 ORDER BY revision DESC LIMIT 1`, [f.p1]);
    assert.equal(latest.status, "confirmed");
    assert.equal(latest.revision, ok.plan.revision, "no new revision from a refused move");
    // Unknown cost effect is not automatic either.
    const unk = await adjustInternalSchedule(run, f.owner, { planId: ok.plan.id, changes: [{ phaseKey: "trim", start: "2026-10-15", end: "2026-10-16" }], costDeltaCents: null }, hooks, null);
    assert.equal(unk.applied, false);

    // Snag: alert immediate, decision pending, the agent cannot decide.
    const snag = await reportSnag(run, f.subB, { projectId: f.p2, body: "Panel is undersized", affectedScope: "electrical", recommendation: "pause", actualSiteStatus: "still working", clientEventId: "s1" }, hooks);
    assert.equal(calls.alerts.length, 2);
    assert.equal(calls.alerts[1].kind, "urgent_item");
    const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: f.owner };
    const refused = await applyOwnerSnagDecision(run, agent, { incidentId: snag.incident.id, choice: "continue" }, hooks);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /Silence is not permission/);
    assert.equal((await openIncidents(run, f.p2))[0].owner_decision, "pending");
    assert.equal((await openIncidents(run, f.p2))[0].actual_site_status, "still working", "site status recorded separately");
    // Joe decides: pause with instructions → recorded, tasks filed.
    await resolveDecision(run, { id: snag.decision.id, outcome: "approved", principal: f.owner, via: "telegram", note: "pause" });
    const applied = await applyOwnerSnagDecision(run, f.owner, { incidentId: snag.incident.id, choice: "pause", instructions: "Stop until the 200A panel arrives" }, hooks);
    assert.equal(applied.ok, true);
    assert.equal(applied.incident.owner_decision, "pause");
    assert.ok(calls.followUps.some((w) => /PAUSE/.test(w.title)));
    const twice = await applyOwnerSnagDecision(run, f.owner, { incidentId: snag.incident.id, choice: "continue" }, hooks);
    assert.equal(twice.incident.owner_decision, "pause", "first recorded instruction stands");
  });
});

test("V39 schedule gates: tentative allowed; signed-unpaid, paid-unsigned, unapproved → no confirmed dates; buyout deadlines computed", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    let paid = false;
    const { hooks } = spyHooks({ initialPaymentReceived: async () => paid });
    const phases = [{ key: "a", label: "A", durationDays: 2 }, { key: "b", label: "B", durationDays: 2, dependsOn: ["a"], materials: [{ item: "cabinets", leadTimeDays: 21, bufferDays: 3 }] }];
    const plan = await prepareTentativeSchedule(run, f.owner, { projectId: f.p1, startDate: "2026-11-02", phases }, hooks);
    assert.equal(plan.status, "tentative");
    assert.equal(plan.material_lead_times[0].orderDeadline, "2026-10-11", "order deadline backward from need-on-site (b starts Nov 4; 21d lead + 3d buffer)");
    // Unapproved
    let r = await confirmSchedule(run, plan.id, hooks);
    assert.equal(r.ok, false);
    assert.deepEqual(r.gates, { approved: false, signedAgreement: false, initialPayment: false });
    const sub = await submitScheduleForApproval(run, f.owner, plan.id);
    await resolveDecision(run, { id: sub.decision.id, outcome: "approved", principal: f.owner, via: "app" });
    // Approved, unsigned, unpaid
    r = await confirmSchedule(run, plan.id, hooks);
    assert.equal(r.ok, false);
    assert.equal(r.gates.approved, true);
    // Paid but unsigned
    paid = true;
    r = await confirmSchedule(run, plan.id, hooks);
    assert.equal(r.ok, false);
    assert.equal(r.gates.signedAgreement, false);
    // Signed but unpaid
    paid = false;
    await run(`INSERT INTO document_drafts (project_id, template_key, title, status) VALUES ($1, 'contract', 'zz-contract-draft', 'signed')`, [f.p1]);
    r = await confirmSchedule(run, plan.id, hooks);
    assert.equal(r.ok, false);
    assert.equal(r.gates.initialPayment, false);
    assert.equal((await run(`SELECT count(*)::int AS n FROM schedule_commitments WHERE project_id = $1`, [f.p1]))[0].n, 0, "no confirmed dates");
    // All three
    paid = true;
    r = await confirmSchedule(run, plan.id, hooks);
    assert.equal(r.ok, true);
    assert.ok((await run(`SELECT count(*)::int AS n FROM schedule_commitments WHERE project_id = $1 AND confirmed`, [f.p1]))[0].n > 0);
    // Buyout
    const b = await planBuyout(run, { projectId: f.p1, planId: plan.id, items: [{ scopeRef: "b", itemLabel: "cabinets", needOnSite: "2026-11-04", leadTimeDays: 21, bufferDays: 3 }, { scopeRef: "a", itemLabel: "tile", needOnSite: "2026-09-25", leadTimeDays: 10 }] });
    assert.equal(b[0].orderDeadline, "2026-10-11");
    assert.equal(b[1].late, true, "deadline already passed → late");
  });
});

test("V18 calendar: Central midnight and weekly slot across both DST transitions; delayed prerequisites push dependents", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const run = runOf(client);
    // Spring forward 2026-03-08: midnight before is CST (UTC-6), after is CDT (UTC-5).
    assert.equal(await centralMidnight(run, "2026-03-08"), "2026-03-08T06:00:00Z");
    assert.equal(await centralMidnight(run, "2026-03-09"), "2026-03-09T05:00:00Z");
    // Fall back 2026-11-01.
    assert.equal(await centralMidnight(run, "2026-11-01"), "2026-11-01T05:00:00Z");
    assert.equal(await centralMidnight(run, "2026-11-02"), "2026-11-02T06:00:00Z");
    // Friday 15:00 Central: 21:00Z in CST week, 20:00Z in CDT week.
    assert.equal(await weeklySlotInstant(run, "2026-03-02", 5, 15, 0), "2026-03-06T21:00:00Z");
    assert.equal(await weeklySlotInstant(run, "2026-03-09", 5, 15, 0), "2026-03-13T20:00:00Z");
    assert.equal(await weeklySlotInstant(run, "2026-10-26", 5, 15, 0), "2026-10-30T20:00:00Z");
    assert.equal(await weeklySlotInstant(run, "2026-11-02", 5, 15, 0), "2026-11-06T21:00:00Z");
    // Week start follows the Central date, not UTC.
    assert.equal(await centralWeekStart(run, "2026-03-09T03:00:00Z"), "2026-03-02", "Sun 22:00 CDT is still last week");
    assert.equal(await centralWeekStart(run, "2026-03-09T06:00:00Z"), "2026-03-09", "Mon 01:00 CDT is this week");
    // Delayed prerequisite: b waits for a; c waits for both.
    const laid = layoutPhases([{ key: "a", label: "a", durationDays: 3 }, { key: "b", label: "b", durationDays: 1, dependsOn: ["a"] }, { key: "c", label: "c", durationDays: 1, dependsOn: ["a", "b"] }], "2026-03-05");
    assert.equal(laid[0].end, "2026-03-09", "3 business days over a weekend");
    assert.equal(laid[1].start, "2026-03-10");
    assert.equal(laid[2].start, "2026-03-11");
    assert.throws(() => layoutPhases([{ key: "x", label: "x", durationDays: 1, dependsOn: ["y"] }, { key: "y", label: "y", durationDays: 1, dependsOn: ["x"] }], "2026-03-05"), /Circular/);
  });
});

test("V19 portals: cross-job sub refused, sub cannot write as another sub, multi-job sub scoped per project, cross-project file ids dropped", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    await assert.rejects(recordSubProgress(run, f.subB, { projectId: f.p1, body: "hi" }), FieldAuthError, "sub B is not on p1");
    await assert.rejects(recordSubProgress(run, f.subA, { projectId: f.p1, subSlug: "zz-sub-c", body: "hi" }), FieldAuthError, "cannot impersonate");
    await assert.rejects(recordSubProgress(run, { kind: "agent", agent: "hermes", runId: null, onBehalfOf: null }, { projectId: f.p1, body: "hi" }), FieldAuthError, "unattended agent cannot write");
    const c1 = await recordSubProgress(run, f.subC, { projectId: f.p1, body: "p1 work", photos: [{ fileId: "zz-p2-f1" }, { fileId: "zz-f1" }] });
    const c2 = await recordSubProgress(run, f.subC, { projectId: f.p2, body: "p2 work", photos: [{ fileId: "zz-p2-f1" }] });
    assert.deepEqual(c1.report.photos.map((p) => p.fileId), ["zz-f1"], "file from another project dropped");
    assert.equal(c2.report.project_id, f.p2);
    const ws = await centralWeekStart(run);
    const s1 = await assembleWeeklyContent(run, f.p1, ws);
    assert.ok(!s1.claims.some((c) => c.text.includes("p2 work")));
    assert.ok(!s1.photos.includes("zz-p2-f1"));
  });
});
