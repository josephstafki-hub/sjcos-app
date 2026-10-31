import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { dailyCostCap, DAILY_COST_CAP_KEY } from "../lib/agent-runtime/worker.ts";

// Tier 4: background agent runs stop for the day at a dollar cap; Joe hears once.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("daily agent cost cap: under it runs, at it stops with one alert a day; 0 turns it off", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`TRUNCATE agent_executions RESTART IDENTITY CASCADE`);
    await client.query(`DELETE FROM reminder_log WHERE dedup_key LIKE 'agent-cost-cap:%'`);
    await client.query(`DELETE FROM push_outbox WHERE kind = 'agent_failure' AND title LIKE 'Agents hit%'`);
    await client.query(`DELETE FROM app_settings WHERE key = $1`, [DAILY_COST_CAP_KEY]);
    await run(`INSERT INTO agent_executions (entry_point, cost_usd) VALUES ('worker', 4.5), ('worker', 3.0)`);
    let c = await dailyCostCap(run);
    assert.deepEqual([c.reached, c.capUsd, c.spentUsd], [false, 25, 7.5], "default $25 cap");
    await run(`INSERT INTO app_settings (key, value) VALUES ($1, '7')`, [DAILY_COST_CAP_KEY]);
    c = await dailyCostCap(run);
    assert.equal(c.reached, true);
    assert.match(c.reason, /\$7\.50 spent, over the \$7\.00 daily cap/);
    await dailyCostCap(run);
    assert.equal((await run(`SELECT count(*)::int AS n FROM push_outbox WHERE kind = 'agent_failure' AND title LIKE 'Agents hit%'`))[0].n, 1, "one alert a day");
    await run(`UPDATE app_settings SET value = '0' WHERE key = $1`, [DAILY_COST_CAP_KEY]);
    assert.equal((await dailyCostCap(run)).reached, false, "0 = no cap");
  });
});
