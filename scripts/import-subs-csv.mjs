#!/usr/bin/env node
// SJC OS — import subcontractors from a Houzz-style CSV export into the `subs`
// table (Company Name, First/Last Name, Email, Phone, Address, Internal Notes,
// Website, Trades). One-off import for the file Joe attached in chat.
//
//   node scripts/import-subs-csv.mjs                   # DRY RUN — prints, writes nothing
//   node scripts/import-subs-csv.mjs --approve          # create subs
//   node scripts/import-subs-csv.mjs --undo --confirm   # remove exactly this run's rows
//
// Rows that already have a matching slug in `subs` are skipped (not overwritten).
// No COI data in the source, so every imported sub lands coi_status='missing'.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = process.argv.find((a) => a.endsWith(".csv")) ??
  "/home/joe/sjcos-app/uploads/ai-chat/5249afe8-b659-4ae5-937f-3efe21d1621b-Subcontractors-Export.csv";
const SNAP = path.join(__dirname, "..", "db", ".subs-csv-import-snapshot.json");
const args = process.argv.slice(2);
const DO_APPROVE = args.includes("--approve");
const DO_UNDO = args.includes("--undo");
const CONFIRM = args.includes("--confirm");

function databaseUrl() {
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  return m[1].trim().replace(/^["']|["']$/g, "");
}
function slugify(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "sub";
}

// Minimal RFC4180 CSV parser — handles quoted fields with embedded commas,
// semicolons, and escaped "" quotes (the Trades column needs this).
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? "").trim()])));
}

function toSubRow(rec) {
  const name = rec["Company Name"].trim();
  const contact = [rec["First Name"], rec["Last Name"]].filter(Boolean).join(" ").trim();
  const address = [rec["Address Line 1"], rec["Address Line 2"], rec["City"], rec["State"], rec["Zip Code"]]
    .filter(Boolean).join(", ");
  const noteParts = [];
  if (contact) noteParts.push(`Contact: ${contact}`);
  if (rec["Website"]) noteParts.push(`Website: ${rec["Website"]}`);
  if (address) noteParts.push(`Address: ${address}`);
  if (rec["Internal Notes"]) noteParts.push(rec["Internal Notes"]);
  noteParts.push("Imported from Subcontractors-Export.csv (2026-08-14).");

  return {
    slug: slugify(name),
    name,
    trade: (rec["Trades"] || "").replace(/;/g, " + "),
    email: rec["Email"] || null,
    phone: rec["Phone"] || null,
    notes: noteParts.join(" "),
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    if (DO_UNDO) return undo(client);

    const subs = parseCsv(readFileSync(CSV, "utf8")).map(toSubRow).filter((s) => s.name);
    const L = (s = "") => console.log(s);
    L(`Source: ${CSV}`);
    L(`Mode: ${DO_APPROVE ? "APPROVE (writing subs)" : "DRY RUN (no writes)"}`);
    L(`Rows: ${subs.length}\n`);
    L("  " + "SUB".padEnd(36) + "TRADE".padEnd(28) + "EMAIL".padEnd(30) + "PHONE");
    L("  " + "-".repeat(110));
    for (const s of subs) {
      L("  " + s.name.slice(0, 35).padEnd(36) + s.trade.slice(0, 27).padEnd(28) +
        (s.email || "—").slice(0, 29).padEnd(30) + (s.phone || "—"));
    }
    L("  " + "-".repeat(110));
    L(`\n  coi_status = 'missing' for all (no COI data in source).`);

    if (!DO_APPROVE) { L("\nDry run complete — nothing written. Re-run with --approve to import."); return; }
    await writeAll(client, subs);
  } finally {
    client.release(); await pool.end();
  }
}

async function writeAll(client, subs) {
  const created = { slugs: [] };
  let n = 0, skipped = 0;
  for (const s of subs) {
    if ((await client.query(`SELECT 1 FROM subs WHERE slug=$1`, [s.slug])).rowCount) {
      console.log(`skip existing ${s.slug}`); skipped++; continue;
    }
    await client.query(
      `INSERT INTO subs (slug, name, trade, email, phone, coi_status, notes)
       VALUES ($1,$2,$3,$4,$5,'missing',$6)`,
      [s.slug, s.name, s.trade, s.email, s.phone, s.notes],
    );
    created.slugs.push(s.slug); n++;
  }
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), ...created }, null, 2));
  console.log(`\nImported ${n} subs (${skipped} skipped as already existing).`);
  console.log(`Undo snapshot → ${SNAP}`);
}

async function undo(client) {
  if (!existsSync(SNAP)) { console.error("No subs-csv-import snapshot found."); process.exit(1); }
  const snap = JSON.parse(readFileSync(SNAP, "utf8"));
  console.log(`Would remove ${snap.slugs.length} subs.`);
  if (!CONFIRM) { console.log("Re-run with --undo --confirm to delete."); return; }
  await client.query(`DELETE FROM subs WHERE slug = ANY($1::text[])`, [snap.slugs]);
  console.log(`Undo complete. Removed ${snap.slugs.length} subs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
