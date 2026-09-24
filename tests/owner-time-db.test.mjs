import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, cleanField, seedField } from "./field-fixtures.mjs";
import { stageDecision, resolveDecision } from "../lib/commands/decisions.ts";
import { ingestLocationEvent, confirmClockIn, clockOut, proposeClockIn } from "../lib/owner-time/location.ts";
import { startTimer, stopTimer, correctInterval, reviewRange, closeStaleIntervals, TimeConflictError } from "../lib/owner-time/intervals.ts";
import { ingestDesignerActivity } from "../lib/owner-time/designer.ts";
import { verifiedHoursForCloseout, setOwnerLaborRate } from "../lib/owner-time/costing.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const T0 = Date.parse("2026-09-21T14:00:00Z"); // Monday 09:00 CDT
const at = (min) => new Date(T0 + min * 60_000).toISOString();

async function fresh(client) {
  await cleanFoundation(client);
  await cleanField(client);
  const f = await seedField(client);
  await client.query(`INSERT INTO job_sites (project_id, lat, lng, radius_m, dwell_s, cooldown_s) VALUES ($1, 44.9778, -93.2650, 150, 300, 1800)`, [f.p1]);
  return f;
}

const loc = (f, id, kind, min, extra = {}) => ({ userId: f.owner.userId, deviceId: "iphone", clientEventId: id, kind, lat: 44.9778, lng: -93.265, accuracyM: 20, at: at(min), ...extra });

test("V24 site: drive-by discards, flapping is one prompt, prompt needs a tap, replay-safe, exit only suggests, two jobs nearby require a choice", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    // Drive-by: enter then exit inside the dwell window.
    const p1 = await ingestLocationEvent(run, loc(f, "L1", "enter", 0));
    assert.equal(p1.kind, "prompt");
    assert.equal(p1.interval.state, "inferred");
    const x1 = await ingestLocationEvent(run, loc(f, "L2", "exit", 2));
    assert.equal(x1.kind, "discarded_drive_by");
    assert.equal((await run(`SELECT count(*)::int AS n FROM time_intervals WHERE state = 'confirmed'`))[0].n, 0);
    // Replay of the same event id → duplicate, nothing new.
    assert.equal((await ingestLocationEvent(run, loc(f, "L1", "enter", 0))).kind, "duplicate");
    // Flapping inside the cooldown: no second prompt.
    assert.equal((await ingestLocationEvent(run, loc(f, "L3", "enter", 5))).kind, "ignored");
    // Real arrival after the cooldown → prompt → Joe taps → confirmed (start editable).
    const p2 = await ingestLocationEvent(run, loc(f, "L4", "enter", 40));
    assert.equal(p2.kind, "prompt");
    const c = await confirmClockIn(run, { userId: f.owner.userId, clientEventId: "C1", intervalId: p2.interval.id, startAt: at(38) });
    assert.equal(c.interval.state, "confirmed");
    assert.equal(c.interval.project_id, f.p1);
    const cAgain = await confirmClockIn(run, { userId: f.owner.userId, clientEventId: "C1", intervalId: p2.interval.id });
    assert.equal(cAgain.applied, false, "replayed tap");
    // A second session cannot be confirmed while one runs.
    const p3 = await proposeClockIn(run, { userId: f.owner.userId, clientEventId: "P3", projectId: f.p2, at: at(60) });
    await assert.rejects(confirmClockIn(run, { userId: f.owner.userId, clientEventId: "C2", intervalId: p3.interval.id }), TimeConflictError);
    // Exit suggests, never clocks out.
    const x2 = await ingestLocationEvent(run, loc(f, "L5", "exit", 200));
    assert.equal(x2.kind, "exit_suggested");
    assert.equal(x2.interval.end_at, null);
    assert.ok(x2.interval.suggested_end_at);
    // Offline clock-out arrives later with its ORIGINAL timestamp; replay is a no-op.
    const out = await clockOut(run, { userId: f.owner.userId, clientEventId: "O1", intervalId: c.interval.id, endAt: at(190) });
    assert.equal(new Date(out.interval.end_at).toISOString(), at(190));
    assert.equal((await clockOut(run, { userId: f.owner.userId, clientEventId: "O1", intervalId: c.interval.id, endAt: at(300) })).applied, false);
    // Two jobs nearby → choices, no auto-pick.
    await run(`INSERT INTO job_sites (project_id, lat, lng, radius_m, dwell_s, cooldown_s) VALUES ($1, 44.9779, -93.2651, 150, 300, 1800)`, [f.p2]);
    const p4 = await ingestLocationEvent(run, loc(f, "L6", "enter", 400));
    assert.equal(p4.kind, "prompt");
    assert.equal(p4.interval.project_id, null);
    assert.equal(p4.choices.length, 2);
    await assert.rejects(confirmClockIn(run, { userId: f.owner.userId, clientEventId: "C3", intervalId: p4.interval.id }), /pick which one/);
    const c4 = await confirmClockIn(run, { userId: f.owner.userId, clientEventId: "C4", intervalId: p4.interval.id, projectId: f.p2 });
    assert.equal(c4.interval.project_id, f.p2);
    // Poor accuracy → no prompt. Non-owner → refused.
    await clockOut(run, { userId: f.owner.userId, clientEventId: "O2", intervalId: c4.interval.id, endAt: at(500) });
    assert.equal((await ingestLocationEvent(run, loc(f, "L7", "enter", 3000, { accuracyM: 900 }))).kind, "ignored");
    await assert.rejects(ingestLocationEvent(run, { ...loc(f, "L8", "enter", 3100), userId: f.subA.userId }), /owner-only/);
    // Unanswered prompt + departure → review item, not a confirmed session.
    const p5 = await ingestLocationEvent(run, loc(f, "L9", "enter", 6000));
    assert.equal(p5.kind, "prompt");
    const x5 = await ingestLocationEvent(run, loc(f, "L10", "exit", 6400));
    assert.equal(x5.kind, "exit_review");
    assert.equal(x5.interval.state, "review");
  });
});

test("V24 manual + office: denied location leaves manual timers usable; idle tab bounded with a reviewable gap; two devices merged; site/office overlap counted once; missing exit → review; no rate → cost not configured", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    // Manual timer with no location at all.
    const t = await startTimer(run, { userId: f.owner.userId, clientEventId: "T1", projectId: f.p1, category: "site", startAt: at(0) });
    assert.equal(t.interval.state, "confirmed");
    await assert.rejects(startTimer(run, { userId: f.owner.userId, clientEventId: "T2", projectId: f.p2, startAt: at(10) }), TimeConflictError, "one running timer");
    assert.equal((await startTimer(run, { userId: f.owner.userId, clientEventId: "T1", projectId: f.p1 })).applied, false, "replay");
    await stopTimer(run, { userId: f.owner.userId, clientEventId: "T3", endAt: at(180) }); // 09:00–12:00 site

    // Designer session on the p1 design: active 10:00–10:02, idle 20 min, active 10:22–10:23, then end.
    const [d] = await run(`INSERT INTO plan_designs (project_id, name, doc) VALUES ($1, 'zz-design', '{}'::jsonb) RETURNING id`, [f.p1]);
    const ev = (seq, kind, min, session = "S1", device = "mac") => ingestDesignerActivity(run, { userId: f.owner.userId, designId: Number(d.id), sessionId: session, seq, kind, at: at(min), deviceId: device }, { idleThresholdSec: 300 });
    await ev(1, "focus", 60);
    await ev(2, "heartbeat", 61);
    await ev(3, "heartbeat", 62);
    await ev(4, "heartbeat", 82);
    await ev(5, "heartbeat", 83);
    await ev(6, "end", 83.5);
    assert.equal((await ev(6, "end", 83.5)).recorded, false, "replayed event");
    let rows = await run(`SELECT state, note, start_at, end_at FROM time_intervals WHERE session_id = 'S1' ORDER BY start_at`);
    assert.deepEqual(rows.map((r) => `${r.state}:${r.note}`), ["inferred:active designer work", "review:gap", "inferred:active designer work"]);
    const activeMin = rows.filter((r) => r.state === "inferred").reduce((s, r) => s + (Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000, 0);
    assert.ok(activeMin < 4, `idle gap not counted (${activeMin} min active)`);
    // Second device overlapping the first run → merged, not doubled.
    await ev(1, "focus", 60.5, "S2", "ipad");
    await ev(2, "heartbeat", 61.5, "S2", "ipad");
    await ev(3, "end", 62.5, "S2", "ipad");
    rows = await run(`SELECT count(*)::int AS n FROM time_intervals WHERE source = 'designer_activity' AND state = 'inferred'`);
    assert.equal(rows[0].n, 2, "overlapping device session merged into the first run");
    // Owner keeps the design time (10:00–10:02.5) — it overlaps the confirmed site timer.
    const [first] = await run(`SELECT id FROM time_intervals WHERE session_id = 'S1' AND state = 'inferred' ORDER BY start_at LIMIT 1`);
    await correctInterval(run, { userId: f.owner.userId, intervalId: first.id, clientEventId: "K1", by: "Joe", state: "confirmed" });
    const review = await reviewRange(run, f.owner.userId, at(-60), at(600));
    assert.ok(review.flags.some((x) => x.flag === "overlap"), "site/office overlap flagged");
    assert.ok(review.flags.some((x) => x.flag === "review"), "gap awaits keep/adjust/discard");
    assert.equal(Math.round(review.totals.site * 100) / 100, 3, "3h site; overlapping design minutes not added on top");
    assert.equal(review.totals.office, 0);
    // Verified hours: only confirmed, union, and NO rate → cost not configured (never zero).
    let vh = await verifiedHoursForCloseout(run, f.p1, new Date(at(600)));
    assert.equal(vh.totalHours, 3);
    assert.equal(vh.totalCostCents, null);
    assert.equal(vh.categories.find((c) => c.category === "site").costStatus, "cost not configured");
    assert.ok(vh.unresolved.review >= 1);
    // A dated approved rate → valued.
    const { decision } = await stageDecision(run, { kind: "owner_rate", action: "set_owner_rate", title: "Site rate", summary: {}, amountCents: 8500, requestedBy: f.owner, content: { category: "site", rate: 8500 } });
    await resolveDecision(run, { id: decision.id, outcome: "approved", principal: f.owner, via: "app" });
    const bad = await setOwnerLaborRate(run, { category: "site", rateCents: 9000, effectiveFrom: "2026-01-01", decisionId: decision.id, approvedBy: f.owner.userId });
    assert.equal(bad.ok, false, "rate must match the approved amount");
    assert.equal((await setOwnerLaborRate(run, { category: "site", rateCents: 8500, effectiveFrom: "2026-01-01", decisionId: decision.id, approvedBy: f.owner.userId })).ok, true);
    vh = await verifiedHoursForCloseout(run, f.p1, new Date(at(600)));
    assert.equal(vh.categories.find((c) => c.category === "site").costCents, 25500);
    assert.equal(vh.categories.find((c) => c.category === "site").rateEffectiveFrom, "2026-01-01");
    // Missing exit: a timer that started 20h ago goes to review, never silently closed.
    await run(`INSERT INTO time_intervals (user_id, project_id, category, start_at, source, state) VALUES ($1, $2, 'site', now() - interval '20 hours', 'timer', 'confirmed')`, [f.owner.userId, f.p1]);
    const stale = await closeStaleIntervals(run, { maxHours: 14 });
    assert.equal(stale.toReview, 1);
    // Cross-user: another user's event id / interval is refused.
    await assert.rejects(correctInterval(run, { userId: f.subA.userId, intervalId: first.id, clientEventId: "K2", by: "x" }), /No such interval/);
    await assert.rejects(startTimer(run, { userId: f.subA.userId, clientEventId: "T1", projectId: null }), TimeConflictError);
  });
});
