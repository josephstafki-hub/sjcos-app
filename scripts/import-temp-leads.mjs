#!/usr/bin/env node
// SJC OS — temp CRM CSV importer (Open Brain / Open Engine migration, Phase 2).
//
// Reads the temporary CRM tracker (/home/joe/SJC OS Temp/data/leads.csv), maps
// each row to a proposed official target (lead / project / archive / knowledge /
// review), and produces a DRY-RUN REPORT. It NEVER writes official
// leads/projects/work_items unless you explicitly pass --approve.
//
//   node scripts/import-temp-leads.mjs                  # dry run: report only, writes NOTHING
//   node scripts/import-temp-leads.mjs --stage          # + upsert raw rows into sjc_temp_lead_imports (reversible buffer)
//   node scripts/import-temp-leads.mjs --stage --approve  # + write approved rows into official tables
//   node scripts/import-temp-leads.mjs --csv <path>     # override the CSV path
//
// Safety model:
//   • Default is a pure dry run — parse, classify, print. Zero side effects.
//   • --stage writes ONLY to sjc_temp_lead_imports (raw JSON preserved exactly,
//     so nothing from the temp tracker is ever lost and the step is reversible).
//   • --approve (requires --stage) is the ONLY thing that touches official
//     records, and only rows whose proposed target is lead/project. archive/
//     review rows are never auto-written.
//   • All SQL is parameterized. No email/SMS/invoices are ever sent.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DO_STAGE = has("--stage") || has("--approve");
const DO_APPROVE = has("--approve");
const CSV_PATH = flag("--csv", "/home/joe/SJC OS Temp/data/leads.csv");

// ─── DB connection (reads DATABASE_URL from the app .env.local) ──────────────
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

// ─── CSV parser (RFC-4180-ish: quoted fields, doubled quotes, embedded \n) ───
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c === "\r") {
      // ignore; \n handles the row break
    } else field += c;
  }
  // trailing field/row (no final newline)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Stage classification ────────────────────────────────────────────────────
// Buckets the temp stage into a proposed official target. Signals on the row
// (signed contract / paid retainer / paid deposit) can promote a "lead" stage to
// a real project. Anything unknown falls to "review" so a human decides.

const PROJECT_STAGES = new Set([
  "active_construction", "construction_scheduled", "waiting_on_sub",
  "waiting_on_client", "change_order_pending", "milestone_ready_to_invoice",
  "substantial_completion", "final_invoice_sent", "punch_list_active",
  "construction_contract", "contract_signed", "retainer_paid",
  "site_visit_scheduled", "site_visit_completed", "precon_active",
  "formal_estimate_needed", "formal_estimate_sent", "contract_requested",
]);
const LEAD_STAGES = new Set([
  "new", "needs_response", "discovery_scheduled", "discovery_completed",
  "rough_estimate_needed", "rough_estimate_sent", "follow_up_needed",
  "precon_deposit_requested", "precon_deposit_paid",
]);
const ARCHIVE_STAGES = new Set([
  "closed_out", "closed", "lost", "pass", "archived", "warranty_active",
  "warranty_claim_open",
]);

const KNOWN_STAGES = new Set([
  ...PROJECT_STAGES, ...LEAD_STAGES, ...ARCHIVE_STAGES,
]);

function classify(r) {
  const stage = (r.stage || "").trim().toLowerCase();
  const signed = (r.contract_status || "").toLowerCase() === "signed";
  const retainerPaid = (r.retainer_status || "").toLowerCase() === "paid";
  const depositPaid = (r.precon_deposit_status || "").toLowerCase() === "paid";
  const promote = signed || retainerPaid || depositPaid;

  const reasons = [];
  let target;
  if (!stage) { target = "review"; reasons.push("no stage value"); }
  else if (ARCHIVE_STAGES.has(stage)) target = "archive";
  else if (PROJECT_STAGES.has(stage)) target = "project";
  else if (LEAD_STAGES.has(stage)) target = promote ? "project" : "lead";
  else { target = "review"; reasons.push(`unrecognized stage "${stage}"`); }

  // Promotion note for transparency.
  if (LEAD_STAGES.has(stage) && promote) {
    reasons.push(
      `promoted lead→project (${[signed && "contract signed", retainerPaid && "retainer paid", depositPaid && "deposit paid"].filter(Boolean).join(", ")})`,
    );
  }

  // Needs-review conditions for records we'd otherwise treat as active.
  if ((target === "lead" || target === "project")) {
    if (!(r.email || "").trim() && !(r.phone || "").trim()) {
      reasons.push("no email or phone");
    }
  }
  return { target, stage, reasons };
}

// ─── Knowledge extraction ────────────────────────────────────────────────────
// Long-form context fields become knowledge_items so history is preserved.
const KNOWLEDGE_FIELDS = [
  ["status_notes", "admin_note"],
  ["qualification_notes", "followup_context"],
  ["scope_summary", "project_decision"],
  ["draft_response", "followup_context"],
];

function main() {
  const raw = readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(raw);
  const header = table[0].map((h) => h.trim());
  const dataRows = table.slice(1).filter((r) => r.some((c) => c && c.trim()));

  const records = dataRows.map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });

  // Classify every row.
  const classified = records.map((r) => ({ r, ...classify(r) }));

  const byTarget = (t) => classified.filter((c) => c.target === t);
  const leads = byTarget("lead");
  const projects = byTarget("project");
  const archives = byTarget("archive");
  const reviews = byTarget("review");

  // Proposed work items: rows with a next_action, on active (lead/project) rows.
  const proposedWork = classified
    .filter((c) => (c.target === "lead" || c.target === "project") && (c.r.next_action || "").trim())
    .map((c) => ({
      name: c.r.name,
      title: c.r.next_action.trim().split("\n")[0].slice(0, 90),
      due: (c.r.next_action_due || "").trim() || null,
      target: c.target,
    }));

  // Proposed knowledge items.
  let knowledgeCount = 0;
  for (const c of classified) {
    for (const [field] of KNOWLEDGE_FIELDS) {
      if ((c.r[field] || "").trim()) knowledgeCount++;
    }
  }

  // Data-quality checks.
  const unrecognized = [...new Set(
    classified.filter((c) => c.reasons.some((x) => x.startsWith("unrecognized")))
      .map((c) => c.stage || "(blank)"),
  )];
  const needsReview = classified.filter((c) =>
    c.target === "review" ||
    c.reasons.some((x) => x === "no email or phone" || x === "no stage value"),
  );

  // Duplicate detection.
  const nameCounts = {};
  const emailCounts = {};
  for (const r of records) {
    const n = (r.name || "").trim().toLowerCase();
    if (n) nameCounts[n] = (nameCounts[n] || 0) + 1;
    const firstEmail = (r.email || "").split(/[;,]/)[0].trim().toLowerCase();
    if (firstEmail) emailCounts[firstEmail] = (emailCounts[firstEmail] || 0) + 1;
  }
  const dupNames = Object.entries(nameCounts).filter(([, n]) => n > 1);
  const dupEmails = Object.entries(emailCounts).filter(([, n]) => n > 1);

  // ─── Report ────────────────────────────────────────────────────────────────
  const L = (s = "") => console.log(s);
  L("╔══════════════════════════════════════════════════════════════════════╗");
  L("║  SJC OS — TEMP CRM IMPORT DRY RUN                                       ║");
  L("╚══════════════════════════════════════════════════════════════════════╝");
  L(`CSV: ${CSV_PATH}`);
  L(`Mode: ${DO_APPROVE ? "APPROVE (writes official records)" : DO_STAGE ? "STAGE (writes staging buffer only)" : "DRY RUN (no writes)"}`);
  L("");
  L(`Total rows: ${records.length}`);
  L(`  Active   → ${leads.length + projects.length}  (${leads.length} lead · ${projects.length} project)`);
  L(`  Closed   → ${archives.length}  (closed_out / lost / pass / archived)`);
  L(`  Review   → ${reviews.length}  (need a human before import)`);
  L("");
  L(`Proposed work_items (from next_action / next_action_due): ${proposedWork.length}`);
  L(`Proposed knowledge_items (status/qualification/scope/draft): ${knowledgeCount}`);
  L("");

  L("── Proposed LEADS ──────────────────────────────────────────────────────");
  for (const c of leads) L(`  • ${c.r.name}  [${c.stage}]  ${(c.r.email || c.r.phone || "no contact").split(/[;,]/)[0].trim()}`);
  L("");
  L("── Proposed PROJECTS ───────────────────────────────────────────────────");
  for (const c of projects) {
    const promo = c.reasons.find((x) => x.startsWith("promoted"));
    L(`  • ${c.r.name}  [${c.stage}]${promo ? "  ← " + promo : ""}`);
  }
  L("");
  L("── Proposed WORK ITEMS ─────────────────────────────────────────────────");
  for (const w of proposedWork) L(`  • (${w.target}) ${w.name}: ${w.title}${w.due ? `  ⟶ due ${w.due}` : ""}`);
  L("");
  L("── Unrecognized stages ─────────────────────────────────────────────────");
  L(unrecognized.length ? "  " + unrecognized.join(", ") : "  (none — all stages recognized)");
  L("");
  L("── Rows needing human review ───────────────────────────────────────────");
  for (const c of needsReview) L(`  • ${c.r.name || "(unnamed)"}  [${c.stage || "blank"}]  — ${c.reasons.join("; ")}`);
  if (!needsReview.length) L("  (none)");
  L("");
  L("── Duplicate names ─────────────────────────────────────────────────────");
  L(dupNames.length ? dupNames.map(([n, k]) => `  • ${n} ×${k}`).join("\n") : "  (none)");
  L("── Duplicate emails ────────────────────────────────────────────────────");
  L(dupEmails.length ? dupEmails.map(([e, k]) => `  • ${e} ×${k}`).join("\n") : "  (none)");
  L("");

  if (!DO_STAGE) {
    L("Dry run complete. Nothing was written. Re-run with --stage to buffer rows,");
    L("then --stage --approve to import approved lead/project rows.");
    return Promise.resolve();
  }

  return writeToDb(classified, proposedWork);
}

// ─── Writes (gated) ──────────────────────────────────────────────────────────
async function writeToDb(classified, _proposedWork) {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    // Always: stage raw rows into sjc_temp_lead_imports (reversible buffer).
    let staged = 0;
    for (const c of classified) {
      const recordId = (c.r.record_id || "").trim();
      if (!recordId) continue;
      await client.query(
        `INSERT INTO sjc_temp_lead_imports (record_id, raw, proposed_target, import_status, review_notes)
         VALUES ($1, $2, $3, 'staged', $4)
         ON CONFLICT (record_id) DO UPDATE
           SET raw = EXCLUDED.raw, proposed_target = EXCLUDED.proposed_target,
               review_notes = EXCLUDED.review_notes`,
        [recordId, JSON.stringify(c.r), c.target, c.reasons.join("; ")],
      );
      staged++;
    }
    console.log(`\nStaged ${staged} rows into sjc_temp_lead_imports.`);

    if (!DO_APPROVE) {
      console.log("Staging complete. Re-run with --approve to write official records.");
      return;
    }

    console.log("\n--approve set: writing official lead/project records…");
    // Load the temp-stage → official-status crosswalk once (Phase-3 stage_rules).
    const crosswalk = await loadStageCrosswalk(client);
    let leadsWritten = 0, projectsWritten = 0, workWritten = 0, knowledgeWritten = 0;
    for (const c of classified) {
      if (c.target !== "lead" && c.target !== "project") continue;
      const res = await importOne(client, c, crosswalk);
      if (res.kind === "lead") leadsWritten++;
      if (res.kind === "project") projectsWritten++;
      workWritten += res.work;
      knowledgeWritten += res.knowledge;
      await client.query(
        `UPDATE sjc_temp_lead_imports SET import_status = 'imported' WHERE record_id = $1`,
        [(c.r.record_id || "").trim()],
      );
    }
    console.log(`Imported: ${leadsWritten} leads, ${projectsWritten} projects, ${workWritten} work items, ${knowledgeWritten} knowledge items.`);
  } finally {
    client.release();
    await pool.end();
  }
}

function slugify(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "record";
}

// The temp-stage → official-status crosswalk is NOT hardcoded here — it is read
// from the stage_rules table (Phase-3 alignment) so there is a single source of
// truth. Loaded once per --approve run.
async function loadStageCrosswalk(client) {
  const { rows } = await client.query(
    `SELECT stage, maps_to_lead_stage, maps_to_project_status FROM stage_rules`,
  );
  const map = {};
  for (const row of rows) map[row.stage] = row;
  return map;
}

async function importOne(client, c, crosswalk) {
  const r = c.r;
  const name = (r.name || "").trim() || "Unnamed";
  const rule = crosswalk[c.stage] || {};
  let kind, id, slug;
  if (c.target === "lead") {
    kind = "lead";
    slug = await uniqueSlug(client, "leads", slugify(name));
    const stage = rule.maps_to_lead_stage || "intake";
    const email = (r.email || "").split(/[;,]/)[0].trim() || null;
    const row = await client.query(
      `INSERT INTO leads (slug, name, scope, stage, email, phone, source, scope_city, last_contact_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NULLIF($9,'')::timestamptz)
       RETURNING id`,
      [slug, name, (r.project_type || "").trim(), stage, email, (r.phone || "").trim() || null,
       (r.source || "").trim() || "Temp CRM import", (r.city || "").trim() || null, (r.last_contact_at || "").trim()],
    );
    id = row.rows[0].id;
  } else {
    kind = "project";
    slug = await uniqueSlug(client, "projects", slugify(name));
    // Map the temp business stage → official projects.status via the crosswalk.
    const status = rule.maps_to_project_status || "precon_signed";
    const row = await client.query(
      `INSERT INTO projects (slug, name, status, client_name, address, stage_label)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [slug, name, status, name, (r.project_address || "").trim() || null, (r.current_milestone || "").trim() || null],
    );
    id = row.rows[0].id;
  }

  // Work item from next_action.
  let work = 0;
  if ((r.next_action || "").trim()) {
    await client.query(
      `INSERT INTO work_items (title, body, status, ${kind}_id, source_kind, source_id, requires_approval, created_by, due_at)
       VALUES ($1,$2,'queued',$3,'import',$4,true,'import', NULLIF($5,'')::timestamptz)`,
      [r.next_action.trim().split("\n")[0].slice(0, 120), r.next_action.trim(), id, (r.record_id || "").trim(), (r.next_action_due || "").trim()],
    );
    work = 1;
  }

  // Knowledge items from the long-form context fields.
  let knowledge = 0;
  for (const [field, kkind] of KNOWLEDGE_FIELDS) {
    const content = (r[field] || "").trim();
    if (!content) continue;
    // Fingerprint (record + field scoped) so re-running --approve is idempotent
    // and matches the partial unique index on content_fingerprint.
    const fp = createHash("md5").update(`${r.record_id}:${field}:${content}`).digest("hex");
    await client.query(
      `INSERT INTO knowledge_items (content, kind, source, ${kind}_id, content_fingerprint, created_by)
       VALUES ($1,$2,'import',$3,$4,'import')
       ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING`,
      [content, kkind, id, fp],
    );
    knowledge++;
  }
  return { kind, work, knowledge };
}

async function uniqueSlug(client, tableSafe, base) {
  // tableSafe is one of our own literals ("leads"/"projects"), never user input.
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await client.query(`SELECT 1 FROM ${tableSafe} WHERE slug = $1`, [slug]);
    if (hit.rowCount === 0) return slug;
    slug = `${base}-${i}`;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
