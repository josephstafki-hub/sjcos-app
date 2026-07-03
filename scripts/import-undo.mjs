#!/usr/bin/env node
// SJC OS — reversible safety net for the temp CRM import (`import-temp-leads.mjs --approve`).
//
// `--approve` writes into four official tables: leads, projects, work_items,
// knowledge_items. This tool lets you roll that back cleanly by snapshotting the
// exact set of row IDs that exist BEFORE the import, then deleting only the rows
// whose IDs appeared AFTER it. Because it works by ID diff (not markers), it can
// never delete anything that existed before the snapshot — including any leads/
// projects you created by hand.
//
//   node scripts/import-undo.mjs snapshot        # capture current IDs → db/.import-snapshot.json
//   node scripts/import-undo.mjs preview         # show what an undo WOULD delete (no writes)
//   node scripts/import-undo.mjs undo --confirm  # delete rows added since the snapshot
//
// Intended flow around a real import:
//   1) node scripts/import-undo.mjs snapshot
//   2) node scripts/import-temp-leads.mjs --stage --approve
//   3) inspect /engine, /leads, /projects
//   4) happy?  keep it. Not happy?  node scripts/import-undo.mjs undo --confirm
//
// Notes:
//   • Take the snapshot IMMEDIATELY before --approve. Any lead/project/work_item/
//     knowledge_item created by ANY means after the snapshot is considered "new"
//     and will be removed by undo — so don't do other data entry in between.
//   • Deletes children before parents to respect foreign keys.
//   • undo also resets sjc_temp_lead_imports rows from 'imported' back to 'staged'.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, "..", "db", ".import-snapshot.json");
const TABLES = ["knowledge_items", "work_items", "leads", "projects"]; // child → parent delete order

const mode = process.argv[2];
const CONFIRM = process.argv.includes("--confirm");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function allIds(client, table) {
  const { rows } = await client.query(`SELECT id::text FROM ${table}`);
  return rows.map((r) => r.id);
}

async function main() {
  if (!["snapshot", "preview", "undo"].includes(mode)) {
    console.error("Usage: import-undo.mjs <snapshot|preview|undo [--confirm]>");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    if (mode === "snapshot") {
      const snap = { takenAt: new Date().toISOString(), ids: {} };
      for (const t of TABLES) snap.ids[t] = await allIds(client, t);
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
      console.log(`Snapshot written to ${SNAPSHOT_PATH}`);
      console.log(`Taken at ${snap.takenAt}. Current row counts:`);
      for (const t of TABLES) console.log(`  ${t.padEnd(16)} ${snap.ids[t].length}`);
      console.log("\nNow safe to run: node scripts/import-temp-leads.mjs --stage --approve");
      return;
    }

    if (!existsSync(SNAPSHOT_PATH)) {
      console.error(`No snapshot found at ${SNAPSHOT_PATH}. Run 'snapshot' before importing.`);
      process.exit(1);
    }
    const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    console.log(`Using snapshot from ${snap.takenAt}\n`);

    // Compute the "new since snapshot" set for each table.
    const newIds = {};
    let total = 0;
    for (const t of TABLES) {
      const before = new Set(snap.ids[t] || []);
      const now = await allIds(client, t);
      newIds[t] = now.filter((id) => !before.has(id));
      total += newIds[t].length;
      console.log(`  ${t.padEnd(16)} +${newIds[t].length} new since snapshot`);
    }
    console.log(`\nTotal rows added since snapshot: ${total}`);

    if (mode === "preview") {
      console.log("\nPreview only — nothing deleted. Run 'undo --confirm' to remove these rows.");
      return;
    }

    // mode === "undo"
    if (!CONFIRM) {
      console.log("\nRefusing to delete without --confirm. Re-run: import-undo.mjs undo --confirm");
      return;
    }
    if (total === 0) {
      console.log("\nNothing to undo — no rows were added since the snapshot.");
      return;
    }

    await client.query("BEGIN");
    try {
      let deleted = 0;
      for (const t of TABLES) {
        if (!newIds[t].length) continue;
        const res = await client.query(`DELETE FROM ${t} WHERE id::text = ANY($1::text[])`, [newIds[t]]);
        console.log(`  deleted ${res.rowCount} from ${t}`);
        deleted += res.rowCount;
      }
      const reset = await client.query(
        `UPDATE sjc_temp_lead_imports SET import_status = 'staged' WHERE import_status = 'imported'`,
      );
      console.log(`  reset ${reset.rowCount} sjc_temp_lead_imports rows back to 'staged'`);
      await client.query("COMMIT");
      console.log(`\nUndo complete. Removed ${deleted} rows. The staging buffer is preserved.`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
