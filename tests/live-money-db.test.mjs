import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { txOver, writeTable } from "../mcp/tool-shared.mjs";

// Money that moves on screen without a reload, against a REAL disposable
// Postgres: a job's total, paid amount and "% paid" bar follow its records for
// every writer (migration 0037), and an MCP tool transaction logs what it
// changed to app_change_log so open tabs refresh.

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

// Spaeth, 2026-10-29: the $22,043.56 deposit on a $44,087.12 estimate was paid
// by card, and the list still read "$2,200 · 100% billed" — the total was the
// pre-con figure an agent had typed, and the job was still "hand-kept". The
// figures now come from the records alone (migration 0037), on every write.
test("a job's total and paid amount follow its records, and a typed figure never sticks", { skip }, async () => {
  await withTestDb(async (url) => {
    await withClient(url, async (c) => {
      await cleanFoundation(c);
      const q = async (sql, params) => (await c.query(sql, params)).rows;
      const money = async () =>
        (await q(`SELECT total_cents::int AS total, collected_cents::int AS paid, contract_value AS cv, collected_to_date AS col, progress AS pct
                    FROM projects WHERE slug = 'zz-ledger'`))[0];

      // A new job: nothing on it, nothing typed sticks (not even on insert).
      await q(`INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date, progress)
               VALUES ('zz-ledger', 'ZZ Ledger', 'construction', 'ZZ', 2200, 2200, 100)`);
      assert.deepEqual(await money(), { total: 0, paid: 0, cv: 0, col: 0, pct: 0 });
      const [{ id: pid }] = await q(`SELECT id FROM projects WHERE slug = 'zz-ledger'`);

      // The pre-con fee paid before the app billed it: entered outside the app.
      await q(`UPDATE projects SET opening_total_cents = 220000, opening_collected_cents = 220000 WHERE id = $1`, [pid]);
      assert.deepEqual(await money(), { total: 220000, paid: 220000, cv: 2200, col: 2200, pct: 100 });

      // A DRAFT formal estimate is not the contract yet.
      const [{ id: est }] = await q(`INSERT INTO estimates (project_id, title, kind, status, total) VALUES ($1, 'Formal', 'formal', 'draft', 4408712) RETURNING id`, [pid]);
      assert.equal((await money()).total, 220000);

      // Billed against (a sent deposit invoice): now it is. Spaeth's shape.
      const [{ id: dep }] = await q(
        `INSERT INTO invoices (project_id, number, milestone, amount, status, economic_key, estimate_id)
         VALUES ($1, 'INV-001', 'Deposit', 2204356, 'sent', $2, $3) RETURNING id`, [pid, `estimate:${est}:initial`, est]);
      assert.deepEqual(await money(), { total: 4628712, paid: 220000, cv: 46287, col: 2200, pct: 5 });

      // The card payment settles: paid moves, whatever path recorded it.
      const [{ id: pay }] = await q(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'payment', 2204356, 'card', 'settled') RETURNING id`, [dep]);
      assert.deepEqual(await money(), { total: 4628712, paid: 2424356, cv: 46287, col: 24244, pct: 52 });

      // A pending ACH is not paid; a refund comes off.
      await q(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'payment', 50000, 'ach', 'pending')`, [dep]);
      assert.equal((await money()).paid, 2424356);
      const [{ id: refund }] = await q(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'refund', 4356, 'card', 'settled') RETURNING id`, [dep]);
      assert.equal((await money()).paid, 2420000);
      await q(`DELETE FROM invoice_payments WHERE id = $1`, [refund]);
      assert.equal((await money()).paid, 2424356);

      // Approved change orders add (net of their credits); drafts don't.
      const [{ id: co }] = await q(`INSERT INTO change_orders (project_id, title, price_cents, status) VALUES ($1, 'Add a window', 150000, 'draft') RETURNING id`, [pid]).catch(async () => {
        // change_orders refuses rows before the contract; the job is in construction, so it shouldn't.
        throw new Error("change order refused");
      });
      assert.equal((await money()).total, 4628712);
      await q(`UPDATE change_orders SET status = 'approved' WHERE id = $1`, [co]);
      assert.equal((await money()).total, 4778712);
      const [{ id: line }] = await q(`INSERT INTO budget_lines (project_id, key, trade, kind, budget_cents) VALUES ($1, 'trim', 'Trim', 'trade', 0) RETURNING id`, [pid]);
      await q(`INSERT INTO change_order_credits (change_order_id, budget_line_id, amount_cents) VALUES ($1, $2, 50000)`, [co, line]);
      assert.equal((await money()).total, 4728712);

      // A pre-con fee invoice adds to the total once it is issued; void takes it back off.
      const [{ id: fee }] = await q(`INSERT INTO invoices (project_id, number, milestone, amount, status, economic_key) VALUES ($1, 'INV-002', 'Pre-con fee', 30000, 'draft', 'precon:fee') RETURNING id`, [pid]);
      assert.equal((await money()).total, 4728712);
      await q(`UPDATE invoices SET status = 'sent' WHERE id = $1`, [fee]);
      assert.equal((await money()).total, 4758712);
      await q(`UPDATE invoices SET status = 'void' WHERE id = $1`, [fee]);
      assert.equal((await money()).total, 4728712);

      // Any direct write to the computed columns is overwritten — by any writer.
      await q(`UPDATE projects SET contract_value = 2200, collected_to_date = 2200, progress = 100, total_cents = 1, collected_cents = 1 WHERE id = $1`, [pid]);
      assert.deepEqual(await money(), { total: 4728712, paid: 2424356, cv: 47287, col: 24244, pct: 51 });

      // Over-paid caps the bar at 100.
      await q(`UPDATE projects SET opening_collected_cents = 9000000 WHERE id = $1`, [pid]);
      assert.equal((await money()).pct, 100);
      await q(`UPDATE projects SET opening_collected_cents = 220000 WHERE id = $1`, [pid]);

      // Deleting the payment's invoice row's payment and the estimate unwinds them.
      await q(`DELETE FROM invoice_payments WHERE id = $1`, [pay]);
      assert.equal((await money()).paid, 220000);
      await q(`UPDATE invoices SET status = 'void' WHERE id = $1`, [dep]);
      assert.equal((await money()).total, 220000 + 100000, "estimate no longer billed against: only outside + approved CO");
      await q(`UPDATE estimates SET status = 'approved', approved_at = now() WHERE id = $1`, [est]);
      assert.equal((await money()).total, 4728712, "approved: the estimate is the contract again");
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
        await run(`INSERT INTO projects (slug, name, status, client_name, opening_total_cents) VALUES ('zz-tx', 'ZZ Tx', 'construction', 'ZZ', 100000)`);
        await run(`UPDATE projects SET opening_collected_cents = 50000 WHERE slug = 'zz-tx'`);
        await run(`UPDATE projects SET name = 'nobody' WHERE slug = 'zz-none'`); // 0 rows — not a change
        await run(`SELECT 1`);
      });
      assert.deepEqual(await logged(), ["mcp:projects"]);

      // Rolled back: nothing changed, nothing logged.
      await pool.query(`TRUNCATE app_change_log`);
      await assert.rejects(
        tx(async (run) => {
          await run(`UPDATE projects SET opening_collected_cents = 90000 WHERE slug = 'zz-tx'`);
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
