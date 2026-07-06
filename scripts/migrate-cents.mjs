#!/usr/bin/env node
// Phase 5.0 — migrate transactional money from integer DOLLARS to integer CENTS.
// Scope (locked with Joe 2026-07-05): invoices.amount + each line_items[].amount,
// retainers.collected/applied, sub_invoices.amount. Everything else (projects
// contract_value/collected_to_date, section budgets, selection prices, estimates,
// cost_items) is out of scope — estimates/cost_items are ALREADY cents; the
// project display figures stay dollars until 5.8 makes the A/R headline
// ledger-derived.
//
// Safety (house pattern, cf. scripts/import-undo.mjs):
//   node scripts/migrate-cents.mjs                 # DRY RUN (default) — no writes
//   node scripts/migrate-cents.mjs --approve       # apply ×100 in one transaction
//   node scripts/migrate-cents.mjs --undo --confirm# restore exact pre-migration values
// A JSON snapshot of every touched row's ORIGINAL value is written to
// db/.cents-snapshot.json before --approve; undo restores from it (never divides,
// so it is safe even if a value was hand-edited). A double-apply guard refuses a
// second --approve while an un-undone snapshot exists.

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SNAPSHOT = join(ROOT, "db", ".cents-snapshot.json");

function databaseUrl() {
  const env = readFileSync(join(ROOT, ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const args = new Set(process.argv.slice(2));
const APPROVE = args.has("--approve");
const UNDO = args.has("--undo");
const CONFIRM = args.has("--confirm");

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    if (UNDO) return await undo(client);
    return await migrate(client);
  } finally {
    await client.end();
  }
}

// ── Read current rows (original values) ──
async function readRows(client) {
  const invoices = (
    await client.query(`SELECT id, amount, line_items FROM invoices ORDER BY id`)
  ).rows;
  const retainers = (
    await client.query(`SELECT project_id, collected, applied FROM retainers ORDER BY project_id`)
  ).rows;
  const subInvoices = (
    await client.query(`SELECT id, amount FROM sub_invoices ORDER BY id`)
  ).rows;
  return { invoices, retainers, subInvoices };
}

function lineItemsToCents(lineItems) {
  if (!Array.isArray(lineItems)) return lineItems;
  return lineItems.map((l) =>
    l && typeof l === "object" && typeof l.amount === "number"
      ? { ...l, amount: Math.round(l.amount * 100) }
      : l,
  );
}

async function migrate(client) {
  const rows = await readRows(client);
  const total =
    rows.invoices.length + rows.retainers.length + rows.subInvoices.length;

  console.log("Phase 5.0 cents migration — scope: invoices, retainers, sub_invoices\n");
  console.log(`  invoices      : ${rows.invoices.length} rows`);
  console.log(`  retainers     : ${rows.retainers.length} rows`);
  console.log(`  sub_invoices  : ${rows.subInvoices.length} rows`);
  console.log(`  total         : ${total} rows\n`);

  // Show a few before→after examples.
  const sample = rows.invoices.slice(0, 3);
  for (const r of sample) {
    console.log(
      `  invoice #${r.id}: amount ${r.amount} → ${r.amount * 100} cents; ` +
        `lines ${JSON.stringify((r.line_items || []).map((l) => l.amount))} → ` +
        `${JSON.stringify(lineItemsToCents(r.line_items).map((l) => l.amount))}`,
    );
  }

  if (!APPROVE) {
    console.log(
      `\nDRY RUN — no changes written. Re-run with --approve to apply ×100.` +
        (total === 0 ? "\n(0 rows — this is a no-op on the current database.)" : ""),
    );
    return;
  }

  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    if (snap.approved) {
      throw new Error(
        "Refusing to re-apply: db/.cents-snapshot.json shows a prior --approve. " +
          "Run --undo --confirm first, or delete the snapshot if the migration is already correct.",
      );
    }
  }

  // Write the snapshot (original values) BEFORE mutating.
  const snapshot = {
    approved: false,
    createdAt: new Date().toISOString(),
    ...rows,
  };
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));

  await client.query("BEGIN");
  try {
    for (const r of rows.invoices) {
      await client.query(
        `UPDATE invoices SET amount = $2, line_items = $3::jsonb WHERE id = $1`,
        [r.id, r.amount * 100, JSON.stringify(lineItemsToCents(r.line_items))],
      );
    }
    for (const r of rows.retainers) {
      await client.query(
        `UPDATE retainers SET collected = $2, applied = $3 WHERE project_id = $1`,
        [r.project_id, r.collected * 100, r.applied * 100],
      );
    }
    for (const r of rows.subInvoices) {
      await client.query(`UPDATE sub_invoices SET amount = $2 WHERE id = $1`, [
        r.id,
        r.amount * 100,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  snapshot.approved = true;
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓ Applied ×100 to ${total} rows. Snapshot: db/.cents-snapshot.json`);
}

async function undo(client) {
  if (!existsSync(SNAPSHOT)) throw new Error("No db/.cents-snapshot.json to undo from.");
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  if (!snap.approved) {
    console.log("Snapshot is not marked approved — nothing was applied. Nothing to undo.");
    return;
  }
  const total =
    snap.invoices.length + snap.retainers.length + snap.subInvoices.length;
  if (!CONFIRM) {
    console.log(
      `Would restore ${total} rows to their pre-migration (dollar) values from the snapshot.\n` +
        `Re-run with --undo --confirm to apply.`,
    );
    return;
  }

  await client.query("BEGIN");
  try {
    for (const r of snap.invoices) {
      await client.query(
        `UPDATE invoices SET amount = $2, line_items = $3::jsonb WHERE id = $1`,
        [r.id, r.amount, JSON.stringify(r.line_items)],
      );
    }
    for (const r of snap.retainers) {
      await client.query(
        `UPDATE retainers SET collected = $2, applied = $3 WHERE project_id = $1`,
        [r.project_id, r.collected, r.applied],
      );
    }
    for (const r of snap.subInvoices) {
      await client.query(`UPDATE sub_invoices SET amount = $2 WHERE id = $1`, [r.id, r.amount]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  rmSync(SNAPSHOT);
  console.log(`✓ Restored ${total} rows to dollar values; removed the snapshot.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
