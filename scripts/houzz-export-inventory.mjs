#!/usr/bin/env node
// Houzz exit inventory — READ-ONLY. Prints the same checklist/evidence the
// /engine/houzz-exit page shows, as JSON (default) or a short text report.
//
//   node scripts/houzz-export-inventory.mjs            # JSON to stdout
//   node scripts/houzz-export-inventory.mjs --text
//   DATABASE_URL=... node scripts/houzz-export-inventory.mjs   (else .env.local)
//
// It never cancels, deletes or migrates anything.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { houzzExitInventory } from "../lib/houzz-exit.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(REPO, ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
const run = async (sql, params) => (await pool.query(sql, params ?? [])).rows;
try {
  const inv = await houzzExitInventory(run);
  if (process.argv.includes("--text")) {
    console.log(`Houzz exit — ${inv.generated_at} — ${inv.ready_to_cancel ? "READY (every criterion met)" : "NOT READY"}`);
    for (const c of inv.criteria) {
      console.log(`\n${c.n}. [${c.status}] ${c.title}`);
      for (const e of c.evidence) console.log(`   + ${e}`);
      for (const g of c.gaps) console.log(`   - ${g}`);
    }
    console.log(`\nOpen invoices: ${inv.invoices.outstanding.length}`);
    for (const i of inv.invoices.outstanding) console.log(`   ${i.number || "#" + i.id}  ${i.project}  ${i.milestone}  $${(i.amount_cents / 100).toFixed(2)}  sent ${i.sent_at?.slice(0, 10) ?? "?"}  delivery ${i.delivery ?? "unknown"}`);
  } else {
    console.log(JSON.stringify(inv, null, 2));
  }
} finally {
  await pool.end();
}
