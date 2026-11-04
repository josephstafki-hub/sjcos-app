// Only the isolated QA clone on :5499. Each test rolls all records back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { materializeDesignerIntervals } from "../lib/owner-time/designer.ts";
import { correctInterval, reviewRange } from "../lib/owner-time/intervals.ts";
import { COMPLIANCE_SOURCE, CENTRAL_TODAY } from "../lib/compliance-source.mjs";
const url = "postgresql://sjcos:qa@localhost:5499/sjcos";
async function db(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await fn(c, async (s, p = []) => (await c.query(s, p)).rows);
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
test("F1 real SQL: an adjusted designer interval is preserved by the next review sweep", () =>
  db(async (c, run) => {
    const [{ id: owner }] = await run(
      `SELECT id FROM users WHERE role='owner' LIMIT 1`,
    );
    const [{ id: project }] = await run(`SELECT id FROM projects LIMIT 1`);
    const session = randomUUID();
    await run(
      `INSERT INTO designer_activity_events(user_id,project_id,session_id,seq,kind,at) VALUES ($1,$2,$3,1,'focus','2026-10-30T15:00:00Z'),($1,$2,$3,2,'end','2026-10-30T16:00:00Z')`,
      [owner, project, session],
    );
    const [initial] = await materializeDesignerIntervals(run, owner, session, {
      idleThresholdSec: 7200,
    });
    assert.ok(initial);
    const corrected = await correctInterval(run, {
      userId: owner,
      intervalId: initial.id,
      clientEventId: randomUUID(),
      by: "ZZ QA L4a",
      startAt: "2026-10-30T15:00:27.125Z",
      endAt: "2026-10-30T16:00:27.125Z",
      state: "confirmed",
      note: "ZZ QA L4a unchanged save",
    });
    assert.equal(corrected.applied, true);
    await materializeDesignerIntervals(run, owner, session, {
      idleThresholdSec: 7200,
    });
    const [{ start_at, state, correction_history }] = await run(
      `SELECT start_at,state,correction_history FROM time_intervals WHERE id=$1`,
      [initial.id],
    );
    assert.equal(start_at.toISOString(), "2026-10-30T15:00:27.125Z");
    assert.equal(state, "confirmed");
    assert.equal(correction_history.length, 1);
    await correctInterval(run, {
      userId: owner,
      intervalId: initial.id,
      clientEventId: randomUUID(),
      by: "ZZ QA L4a",
      state: "discarded",
    });
    const review = await reviewRange(
      run,
      owner,
      "2026-10-30T00:00:00Z",
      "2026-10-31T00:00:00Z",
    );
    assert.ok(
      review.intervals.some(
        (i) => i.id === initial.id && i.state === "discarded",
      ),
      "discarded records stay recoverable",
    );
  }));
test("F5 real SQL: policy renewal enters the shared source and archive removes it", () =>
  db(async (c, run) => {
    const [{ id }] = await run(
      `INSERT INTO insurance_policies(policy_type,carrier,expires_date) VALUES ('gl','ZZ QA L4a test',${CENTRAL_TODAY}+2) RETURNING id`,
    );
    const [r] = await run(
      `SELECT *,due_date-${CENTRAL_TODAY} AS days FROM (${COMPLIANCE_SOURCE}) source WHERE id=$1`,
      [`insurance:${id}`],
    );
    assert.equal(r.kind, "insurance");
    assert.equal(r.days, 2);
    await run(`UPDATE insurance_policies SET archived=true WHERE id=$1`, [id]);
    assert.equal(
      (
        await run(`SELECT * FROM (${COMPLIANCE_SOURCE}) source WHERE id=$1`, [
          `insurance:${id}`,
        ])
      ).length,
      0,
    );
  }));
test("F1 real SQL: dated labor rates change at Central midnight, not UTC midnight", () =>
  db(async (c, run) => {
    const { verifiedHoursForCloseout } = await import(
      "../lib/owner-time/costing.ts"
    );
    const [{ id: owner }] = await run(
      `SELECT id FROM users WHERE role='owner' LIMIT 1`,
    );
    const [{ id: project }] = await run(`SELECT id FROM projects LIMIT 1`);
    // Rollback-only fixture: isolate this project's hours and the category rates.
    await run(`DELETE FROM time_intervals WHERE project_id=$1`, [project]);
    await run(`DELETE FROM owner_labor_rates WHERE category='other'`);
    await run(
      `INSERT INTO owner_labor_rates(category,rate_cents,effective_from) VALUES ('other',1000,'2026-10-30'),('other',2000,'2026-10-31')`,
    );
    await run(
      `INSERT INTO time_intervals(user_id,project_id,category,start_at,end_at,source,state,note) VALUES ($1,$2,'other','2026-10-31T04:00:00Z','2026-10-31T07:00:00Z','manual','confirmed','ZZ QA L4a rate boundary')`,
      [owner, project],
    );
    const result = await verifiedHoursForCloseout(
      run,
      project,
      new Date("2026-11-01T12:00:00Z"),
    );
    assert.equal(result.totalHours, 3);
    assert.equal(
      result.totalCostCents,
      5000,
      "one hour before Central midnight + two after",
    );
  }));
