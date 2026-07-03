#!/usr/bin/env node
// SJC OS — import the ARCHIVED Open-Brain rows into official records.
//
// The Phase-2 temp-CRM import (import-temp-leads.mjs) wrote only the 12 ACTIVE
// rows (2 leads + 10 projects) and left the 44 closed/dead rows buffered in
// sjc_temp_lead_imports with import_status='staged'. This tool brings those in:
//
//   • closed_out          → projects (status via stage_rules crosswalk = warranty)
//   • lost / pass / archived → leads (terminal stage 'lost')
//
// Each carries its status-notes → a knowledge_item (idempotent by fingerprint).
// No work_items are created (these records are done/dead). No emails/sends.
//
//   node scripts/import-brain-archives.mjs             # DRY RUN — prints, writes nothing
//   node scripts/import-brain-archives.mjs --approve   # writes official records
//   node scripts/import-brain-archives.mjs --projects-only --approve  # skip the 8 dead leads
//
// Reversible: take an ID snapshot first (scripts/import-undo.mjs snapshot), then
// undo with import-undo.mjs undo --confirm.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DO_APPROVE = args.includes("--approve");
const PROJECTS_ONLY = args.includes("--projects-only");

const PROJECT_STAGES = new Set(["closed_out", "closed", "final_invoice_sent", "warranty_active", "warranty_claim_open"]);
const LEAD_LOST_STAGES = new Set(["lost", "pass", "archived"]);

function databaseUrl() {
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found");
  return m[1].trim().replace(/^["']|["']$/g, "");
}
function slugify(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "record";
}
async function uniqueSlug(client, tableSafe, base) {
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await client.query(`SELECT 1 FROM ${tableSafe} WHERE slug = $1`, [slug]);
    if (hit.rowCount === 0) return slug;
    slug = `${base}-${i}`;
  }
}
async function addKnowledge(client, kind, id, recordId, content, itemKind) {
  const text = (content || "").trim();
  if (!text) return 0;
  const fp = createHash("md5").update(`${recordId}:${itemKind}:${text}`).digest("hex");
  await client.query(
    `INSERT INTO knowledge_items (content, kind, source, ${kind}_id, content_fingerprint, created_by)
     VALUES ($1,$2,'import',$3,$4,'import')
     ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING`,
    [text, itemKind, id, fp],
  );
  return 1;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT record_id, raw FROM sjc_temp_lead_imports WHERE import_status = 'staged' ORDER BY raw->>'name'`,
    );
    // crosswalk stage → official project status
    const cw = {};
    for (const r of (await client.query(`SELECT stage, maps_to_project_status FROM stage_rules`)).rows) cw[r.stage] = r;

    const plan = { projects: [], leads: [], skipped: [] };
    for (const row of rows) {
      const r = row.raw;
      const stage = (r.stage || "").trim().toLowerCase();
      if (PROJECT_STAGES.has(stage)) plan.projects.push({ record_id: row.record_id, r, stage });
      else if (LEAD_LOST_STAGES.has(stage)) plan.leads.push({ record_id: row.record_id, r, stage });
      else plan.skipped.push({ record_id: row.record_id, r, stage });
    }

    const L = (s = "") => console.log(s);
    L(`Mode: ${DO_APPROVE ? "APPROVE (writing official records)" : "DRY RUN (no writes)"}${PROJECTS_ONLY ? " · projects-only" : ""}`);
    L(`Staged rows: ${rows.length}`);
    L(`  → projects (past jobs, status warranty): ${plan.projects.length}`);
    L(`  → leads (lost/archived):                 ${plan.leads.length}${PROJECTS_ONLY ? "  [SKIPPED via --projects-only]" : ""}`);
    L(`  → unmapped (left staged):                ${plan.skipped.length}`);
    L("");
    L("PROJECTS:");
    for (const p of plan.projects) L(`  • ${p.r.name}  [${p.stage} → ${cw[p.stage]?.maps_to_project_status || "warranty"}]`);
    if (!PROJECTS_ONLY) {
      L("\nLOST LEADS:");
      for (const p of plan.leads) L(`  • ${p.r.name}  [${p.stage} → lost]  ${(p.r.email || p.r.phone || "no contact")}`);
    }
    if (plan.skipped.length) {
      L("\nUNMAPPED (still staged):");
      for (const p of plan.skipped) L(`  • ${p.r.name}  [${p.stage || "blank"}]`);
    }

    if (!DO_APPROVE) {
      L("\nDry run complete — nothing written. Re-run with --approve to import.");
      return;
    }

    let projW = 0, leadW = 0, knowW = 0;
    // Projects
    for (const p of plan.projects) {
      const r = p.r, name = (r.name || "").trim() || "Unnamed";
      const slug = await uniqueSlug(client, "projects", slugify(name));
      const status = cw[p.stage]?.maps_to_project_status || "warranty";
      const ins = await client.query(
        `INSERT INTO projects (slug, name, status, client_name, address, stage_label)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [slug, name, status, name, (r.project_address || "").trim() || null, (r.current_milestone || "").trim() || null],
      );
      const id = ins.rows[0].id;
      knowW += await addKnowledge(client, "project", id, p.record_id, r.status_notes, "project_decision");
      knowW += await addKnowledge(client, "project", id, p.record_id, r.next_action, "admin_note");
      await client.query(`UPDATE sjc_temp_lead_imports SET import_status='imported' WHERE record_id=$1`, [p.record_id]);
      projW++;
    }
    // Lost leads
    if (!PROJECTS_ONLY) {
      for (const p of plan.leads) {
        const r = p.r, name = (r.name || "").trim() || "Unnamed";
        const slug = await uniqueSlug(client, "leads", slugify(name));
        const email = (r.email || "").split(/[;,]/)[0].trim() || null;
        const ins = await client.query(
          `INSERT INTO leads (slug, name, scope, stage, email, phone, source, scope_city, value_display, flag_label, flag_kind)
           VALUES ($1,$2,$3,'lost',$4,$5,$6,$7,$8,$9,'ghost') RETURNING id`,
          [slug, name, (r.project_type || "").trim(), email, (r.phone || "").trim() || null,
           (r.source || "").trim() || "Temp CRM import", (r.city || "").trim() || null,
           (r.budget_range || "").trim() || null,
           p.stage === "pass" ? "Passed" : p.stage === "lost" ? "Lost" : "Archived"],
        );
        const id = ins.rows[0].id;
        knowW += await addKnowledge(client, "lead", id, p.record_id, r.status_notes, "admin_note");
        knowW += await addKnowledge(client, "lead", id, p.record_id, r.next_action, "followup_context");
        await client.query(`UPDATE sjc_temp_lead_imports SET import_status='imported' WHERE record_id=$1`, [p.record_id]);
        leadW++;
      }
    }
    L(`\nImported: ${projW} projects, ${leadW} lost leads, ${knowW} knowledge items.`);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
