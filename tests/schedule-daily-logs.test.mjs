// Exercise the actual schedule read against the isolated QA clone. Roll back
// every fixture, including replacement of that day's pre-existing logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import pg from "pg";

const dbURL = new URL("../lib/db.ts", import.meta.url).href;
registerHooks({
  resolve(s, c, next) {
    const url = /^\.\.?\//.test(s) && !/\.[cm]?[jt]s$/.test(s) && c.parentURL?.endsWith(".ts")
      ? new URL(`${s}.ts`, c.parentURL).href : s;
    return url === dbURL ? { url: "stub:schedule-db", shortCircuit: true } : next(url, c);
  },
  load(url, c, next) {
    return url === "stub:schedule-db"
      ? { format: "module", source: "export const query = (s,p) => globalThis.__scheduleQA.query(s,p);", shortCircuit: true }
      : next(url, c);
  },
});

test("Schedule daily logs include project drafts, identify the job and retain the global log", async () => {
  const client = new pg.Client({ connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos" });
  await client.connect();
  globalThis.__scheduleQA = client;
  try {
    await client.query("BEGIN");
    const { getScheduleData } = await import("../lib/schedule.ts");
    const initial = await getScheduleData();
    const date = initial.days[0].iso;
    const { rows: [project] } = await client.query("SELECT id,name FROM projects ORDER BY id LIMIT 1");
    await client.query("DELETE FROM daily_logs WHERE log_date=$1", [date]);
    await client.query(
      `INSERT INTO daily_logs(log_date,project_id,body,photos) VALUES
       ($1,NULL,'ZZ QA global log',2),($1,$2,'ZZ QA project photo draft',3)`,
      [date, project.id],
    );
    const result = await getScheduleData();
    const log = result.logs.entries.find((l) => l.iso === date);
    assert.match(log.body, /ZZ QA global log/);
    assert.match(log.body, /ZZ QA project photo draft/);
    assert.ok(log.body.includes(project.name), "Project entries identify their job");
    assert.equal(log.photos, 5);
    assert.equal(log.logged, true);
    assert.equal(result.logs.loggedCount, initial.logs.entries.filter((l) => l.iso !== date && l.logged).length + 1);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    delete globalThis.__scheduleQA;
  }
});
