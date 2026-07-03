#!/usr/bin/env node
// SJC OS — import subcontractors + their W-9 / COI documents from the
// 2026-06-18 subcontractor audit into the official `subs` + `sub_documents`
// tables. The audit lives on disk (NOT in the DB); this brings the clean subset
// (real company-style names that actually have a W-9 or COI file) into SJC OS.
//
//   node scripts/import-subs-audit.mjs                 # DRY RUN — prints, writes nothing
//   node scripts/import-subs-audit.mjs --approve       # create subs + upload docs
//   node scripts/import-subs-audit.mjs --undo --confirm # remove exactly this run's rows
//
// Honesty rules: the audit could NOT verify COI expiry, so every sub is imported
// coi_status='missing' (= no VERIFIED current COI) with the on-file docs attached
// and a note to verify expiry. No phones in the source. No emails/sends.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Mirror lib/upload-store.ts persistBlob — the app serves blobs from
// process.cwd()/uploads and indexes them in `files`. Run this from the project
// root so cwd matches the running server's UPLOAD_DIR.
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT = "/home/joe/SJC OS Temp/subcontractors_docs/2026-06-18/audit_report.json";
const SNAP = path.join(__dirname, "..", "db", ".subs-import-snapshot.json");
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
function inferTrade(name) {
  const n = name.toLowerCase();
  const map = [
    [/electric/, "Electrical"], [/plumb/, "Plumbing"], [/roof/, "Roofing"],
    [/drywall/, "Drywall"], [/demolition|demo\b/, "Demolition"],
    [/heating|cooling|hvac|\bair\b|furnace/, "HVAC"], [/paint/, "Painting"],
    [/exterior|siding/, "Exteriors"], [/mover|moving/, "Moving"],
    [/concrete|masonry/, "Concrete"], [/floor/, "Flooring"],
    [/construction|builder|remodel|carpentry/, "General contractor"],
  ];
  for (const [re, t] of map) if (re.test(n)) return t;
  return "General";
}
function mimeOf(fn) {
  const e = fn.toLowerCase().split(".").pop();
  return { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" }[e] || "application/octet-stream";
}

// Emails the "first email on the thread" heuristic caught wrong — they belong to
// the sub's insurance agency, a third party, or (Top Tier) Joe's own address, or
// are an inline-image cid. Blanked on Joe's instruction (better empty than wrong).
const BAD_EMAILS = new Set([
  "akraft@millerhartwig.com",         // CW Services (insurance)
  "anowak@newkingdomhealthcare.com",  // Hybrid Banker
  "ellen@unidaleinsurance.com",       // M Scott Company (insurance)
  "dstocker@stockeragency.com",       // MTM Services (agency)
  "critemon@insaudit.com",            // Omni Plumbing (insurance audit)
  "kate@ourwisechoice.com",           // Power Up Builders
  "fmorales@mninsuranceagencies.com", // Rancho Construction (insurance)
  "josephstafki@sjcarpentryllc.com",  // Top Tier (Joe's own thread-starter)
]);
function pickEmail(emails) {
  const e = (emails || [])[0];
  if (!e) return null;
  if (BAD_EMAILS.has(e.toLowerCase())) return null;
  if (/\.(png|jpe?g|gif)@/i.test(e)) return null; // inline-image cid (Joey Roofing)
  return e;
}

// The clean subset: company-style name (no email fragments) that has ≥1 real doc.
function cleanSubs() {
  const j = JSON.parse(readFileSync(AUDIT, "utf8"));
  return j.subs
    .filter((s) => !/[<@]/.test(s.name) && ((s.w9_files || []).length || (s.coi_files || []).length))
    .map((s) => ({
      name: s.name.trim(),
      email: pickEmail(s.emails),
      trade: inferTrade(s.name),
      w9: s.w9_files || [],
      coi: s.coi_files || [],
    }));
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    if (DO_UNDO) return undo(client);
    const subs = cleanSubs();
    const L = (s = "") => console.log(s);
    L(`Mode: ${DO_APPROVE ? "APPROVE (writing subs + uploading docs)" : "DRY RUN (no writes)"}`);
    L(`Clean subs with docs: ${subs.length}\n`);
    L("  " + "SUB".padEnd(34) + "TRADE".padEnd(20) + "W9  COI  EMAIL");
    L("  " + "-".repeat(84));
    let tw = 0, tc = 0;
    for (const s of subs) {
      tw += s.w9.length; tc += s.coi.length;
      L("  " + s.name.slice(0, 33).padEnd(34) + s.trade.padEnd(20) +
        String(s.w9.length).padEnd(4) + String(s.coi.length).padEnd(5) + (s.email || "—"));
    }
    L("  " + "-".repeat(84));
    L(`  TOTAL: ${subs.length} subs · ${tw} W-9 files · ${tc} COI files → sub_documents`);
    L(`\n  coi_status = 'missing' for all (expiry unverified in the audit); docs attached; note added.`);

    if (!DO_APPROVE) { L("\nDry run complete — nothing written. Re-run with --approve to import."); return; }
    await writeAll(client, subs);
  } finally {
    client.release(); await pool.end();
  }
}

function sizeLabel(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
// Write a blob to uploads/ + insert a files row — a faithful copy of
// lib/upload-store.ts persistBlob (a plain node script can't import the TS lib).
async function storeFile(client, srcPath, filename, mime, tag) {
  const id = `subdoc-${randomUUID()}`;
  const safe = path.basename(filename).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const storedName = `${id}__${safe}`;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const bytes = readFileSync(srcPath);
  writeFileSync(path.join(UPLOAD_DIR, storedName), bytes);
  const isImage = mime.startsWith("image/");
  await client.query(
    `INSERT INTO files
       (id, project_key, type, name, tag, ai_origin, modified_label, size_label,
        subtitle, ai_tags, sort, storage_path, mime_type)
     VALUES ($1,'',$2,$3,$4,false,'just now',$5,$6,'{}',-1,$7,$8)`,
    [id, isImage ? "img" : "doc", safe, tag, sizeLabel(bytes.length), "From 2026-06 sub audit", storedName, mime],
  );
  return id;
}

async function writeAll(client, subs) {
  const created = { slugs: [], fileIds: [] };
  let subN = 0, docN = 0, missing = 0;
  for (const s of subs) {
    const slug = slugify(s.name);
    if ((await client.query(`SELECT 1 FROM subs WHERE slug=$1`, [slug])).rowCount) { console.log(`skip existing ${slug}`); continue; }
    const note = `Imported from the 2026-06 subcontractor audit. On file: ` +
      `${s.w9.length ? "W-9 ✓" : "no W-9"}, ${s.coi.length ? s.coi.length + " COI file(s)" : "no COI"}. ` +
      `Verify current COI + expiry date.`;
    await client.query(
      `INSERT INTO subs (slug, name, trade, email, coi_status, notes) VALUES ($1,$2,$3,$4,'missing',$5)`,
      [slug, s.name, s.trade, s.email, note],
    );
    created.slugs.push(slug); subN++;
    for (const [list, docType] of [[s.w9, "w9"], [s.coi, "coi"]]) {
      for (const f of list) {
        let fileId = null;
        if (existsSync(f.path)) {
          fileId = await storeFile(client, f.path, f.filename, mimeOf(f.filename), `${docType.toUpperCase()} · ${s.name}`);
          created.fileIds.push(fileId);
        } else missing++;
        await client.query(`INSERT INTO sub_documents (sub_slug, doc_type, file_id) VALUES ($1,$2,$3)`, [slug, docType, fileId]);
        docN++;
      }
    }
  }
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), ...created }, null, 2));
  console.log(`\nImported ${subN} subs, ${docN} sub_documents (${created.fileIds.length} files stored${missing ? `, ${missing} source files missing → row w/o file` : ""}).`);
  console.log(`Undo snapshot → ${SNAP}`);
}

async function undo(client) {
  if (!existsSync(SNAP)) { console.error("No subs-import snapshot found."); process.exit(1); }
  const snap = JSON.parse(readFileSync(SNAP, "utf8"));
  console.log(`Would remove ${snap.slugs.length} subs (+ their sub_documents) and ${snap.fileIds.length} files.`);
  if (!CONFIRM) { console.log("Re-run with --undo --confirm to delete."); return; }
  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM subs WHERE slug = ANY($1::text[])`, [snap.slugs]); // cascades sub_documents
    if (snap.fileIds.length) await client.query(`DELETE FROM files WHERE id = ANY($1::text[])`, [snap.fileIds]);
    await client.query("COMMIT");
    console.log(`Undo complete. Removed ${snap.slugs.length} subs + ${snap.fileIds.length} files.`);
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}

main().catch((e) => { console.error(e); process.exit(1); });
