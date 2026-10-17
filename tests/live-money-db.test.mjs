import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { txOver, writeTable } from "../mcp/tool-shared.mjs";

// Money that moves on screen without a reload, against a REAL disposable
// Postgres: the "% billed" bar (projects.progress) follows contract and
// collected for every writer (migration 0027), and an MCP tool transaction
// logs what it changed to app_change_log so open tabs refresh.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

test("progress follows contract_value and collected_to_date, whoever writes them", { skip }, async () => {
  await withTestDb(async (url) => {
    await withClient(url, async (c) => {
      await cleanFoundation(c);
      const pct = async () => (await c.query(`SELECT progress FROM projects WHERE slug = 'zz-billed'`)).rows[0].progress;

      // Inserted with a progress that disagrees with the money: the money wins.
      await c.query(`INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date, progress)
                     VALUES ('zz-billed', 'ZZ Billed', 'construction', 'ZZ Client', 63539, 34929, 48)`);
      assert.equal(await pct(), 55);

      // A payment raises collected (a raw write that never recomputed progress).
      await c.query(`UPDATE projects SET collected_to_date = 50000 WHERE slug = 'zz-billed'`);
      assert.equal(await pct(), 79);

      // A change order raises the contract.
      await c.query(`UPDATE projects SET contract_value = 100000 WHERE slug = 'zz-billed'`);
      assert.equal(await pct(), 50);

      // Over-collected caps at 100.
      await c.query(`UPDATE projects SET collected_to_date = 120000 WHERE slug = 'zz-billed'`);
      assert.equal(await pct(), 100);

      // No contract value: whatever progress it had stays (nothing to divide by).
      await c.query(`UPDATE projects SET contract_value = 0, progress = 30 WHERE slug = 'zz-billed'`);
      assert.equal(await pct(), 30);

      // Unrelated writes leave it alone.
      await c.query(`UPDATE projects SET progress = 12, name = 'ZZ Renamed' WHERE slug = 'zz-billed'`);
      assert.equal(await pct(), 12);
    });
  });
});

test("an MCP tool transaction logs each table it changed, after COMMIT only", { skip }, async () => {
  await withTestDb(async (url) => {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      await withClient(url, async (c) => {
        await cleanFoundation(c);
        await c.query(`TRUNCATE app_change_log`);
      });
      const tx = txOver(pool);
      const logged = async () =>
        (await pool.query(`SELECT scope, source FROM app_change_log ORDER BY id`)).rows.map((r) => `${r.source}:${r.scope}`);

      await tx(async (run) => {
        await run(`INSERT INTO projects (slug, name, status, client_name, contract_value) VALUES ('zz-tx', 'ZZ Tx', 'construction', 'ZZ', 1000)`);
        await run(`UPDATE projects SET collected_to_date = 500 WHERE slug = 'zz-tx'`);
        await run(`UPDATE projects SET name = 'nobody' WHERE slug = 'zz-none'`); // 0 rows — not a change
        await run(`SELECT 1`);
      });
      assert.deepEqual(await logged(), ["mcp:projects"]);

      // Rolled back: nothing changed, nothing logged.
      await pool.query(`TRUNCATE app_change_log`);
      await assert.rejects(
        tx(async (run) => {
          await run(`UPDATE projects SET collected_to_date = 900 WHERE slug = 'zz-tx'`);
          throw new Error("boom");
        }),
        /boom/,
      );
      assert.deepEqual(await logged(), []);
      const { rows } = await pool.query(`SELECT collected_to_date, progress FROM projects WHERE slug = 'zz-tx'`);
      assert.deepEqual(rows[0], { collected_to_date: 500, progress: 50 });
    } finally {
      await pool.end();
    }
  });
});

test("writeTable names the table of a single write statement", () => {
  assert.equal(writeTable(`INSERT INTO invoice_payments (a) VALUES (1)`), "invoice_payments");
  assert.equal(writeTable(`  update "Projects" SET x = 1`), "projects");
  assert.equal(writeTable(`DELETE FROM only bills WHERE id = 1`), "bills");
  assert.equal(writeTable(`SELECT * FROM projects`), null);
});
