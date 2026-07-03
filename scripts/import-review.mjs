#!/usr/bin/env node
// SJC OS — imported-data review report (read-only).
//
// Regenerates docs/import-review.md: a per-record review of everything the temp
// CRM import wrote into official tables, so Joe can check each imported lead /
// project one at a time. Read-only — it never modifies or deletes records, it
// only reports. Re-run any time to refresh the doc.
//
//   node scripts/import-review.mjs
//
// It joins each imported active staging row (sjc_temp_lead_imports) back to the
// official lead/project it produced (by name), lists linked work items and
// knowledge, and raises data-quality FLAGS for a human — it does NOT assume the
// import was perfect.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "docs", "import-review.md");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const IN_CONSTRUCTION = new Set([
  "active_construction", "construction_scheduled", "waiting_on_sub",
  "substantial_completion", "punch_list_active", "milestone_ready_to_invoice",
]);

const d = (v) => (v ? String(v).slice(0, 10) : "—");
const clean = (s) => (s || "").replace(/[\r\n]+/g, " ").trim();

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 3 });
  const c = await pool.connect();
  try {
    // ── Counts (Phase-3 verification) ────────────────────────────────────────
    const counts = {};
    for (const [k, sql] of [
      ["leads", "SELECT count(*) n FROM leads"],
      ["projects", "SELECT count(*) n FROM projects"],
      ["work_items", "SELECT count(*) n FROM work_items"],
      ["knowledge_items", "SELECT count(*) n FROM knowledge_items"],
      ["skills (approved)", "SELECT count(*) n FROM skills WHERE review_status='approved'"],
      ["runbooks", "SELECT count(*) n FROM runbooks"],
      ["sjc_temp_lead_imports", "SELECT count(*) n FROM sjc_temp_lead_imports"],
      ["stage_rules", "SELECT count(*) n FROM stage_rules"],
    ]) counts[k] = Number((await c.query(sql)).rows[0].n);

    const expected = {
      leads: 2, projects: 10, work_items: 12, knowledge_items: 47,
      "skills (approved)": 8, runbooks: 5, sjc_temp_lead_imports: 56, stage_rules: 32,
    };

    // ── Imported active records ──────────────────────────────────────────────
    const { rows: staged } = await c.query(
      `SELECT record_id, proposed_target, import_status, review_notes, raw
         FROM sjc_temp_lead_imports
        WHERE proposed_target IN ('lead','project') AND import_status='imported'
        ORDER BY proposed_target, raw->>'name'`,
    );

    const records = [];
    for (const s of staged) {
      const raw = s.raw; // jsonb → object
      const name = clean(raw.name) || "(unnamed)";
      // Find the official record this staging row produced, by name.
      const tbl = s.proposed_target === "project" ? "projects" : "leads";
      const found = await c.query(`SELECT * FROM ${tbl} WHERE name = $1`, [name]);
      const actual = found.rows[0] || null;
      const actualKind = actual ? s.proposed_target : null;

      let knowledge = 0, work = [], hasContractNote = false;
      if (actual) {
        const col = s.proposed_target === "project" ? "project_id" : "lead_id";
        knowledge = Number(
          (await c.query(`SELECT count(*) n FROM knowledge_items WHERE ${col}=$1`, [actual.id])).rows[0].n,
        );
        hasContractNote = (
          await c.query(
            `SELECT 1 FROM knowledge_items WHERE ${col}=$1 AND content ILIKE '%contract%' AND (content ILIKE '%on file%' OR content ILIKE '%executed%') LIMIT 1`,
            [actual.id],
          )
        ).rowCount > 0;
        work = (
          await c.query(
            `SELECT title, status, due_at, requires_approval FROM work_items WHERE ${col}=$1 ORDER BY due_at NULLS LAST`,
            [actual.id],
          )
        ).rows;
      }

      // ── Flags — do NOT assume the import is perfect ─────────────────────────
      const flags = [];
      const stage = clean(raw.stage);
      const signed = clean(raw.contract_status).toLowerCase() === "signed";
      const email = clean(raw.email), phone = clean(raw.phone);
      if (!actual) flags.push(`Could not locate the official ${tbl} row by name — verify it imported.`);
      // Note (2026-07-03, confirmed by Joe): precon_active jobs are legitimately
      // projects in the preconstruction stage, and the in-construction jobs DO
      // have signed contracts — they live in Joe's external contract system, not
      // the temp CRM (contract_status was simply blank there). So neither is a
      // classification problem; we only surface a mild "mirror the contract"
      // reminder for construction-stage jobs.
      if (IN_CONSTRUCTION.has(stage) && !signed && !hasContractNote)
        flags.push(`Contract executed in Joe's external system but not yet mirrored in SJC OS — capture a contract reference/knowledge note when convenient.`);
      if (s.proposed_target === "lead" && signed)
        flags.push("Classified as a **lead** but a signed contract exists — should this be a project?");
      if (!email && !phone) flags.push("No email or phone on file.");
      if (clean(raw.red_flags)) flags.push(`Temp CRM red_flags: ${clean(raw.red_flags)}`);
      const triage = clean(raw.triage).toUpperCase();
      if (triage && triage !== "GO") flags.push(`Temp CRM triage = ${triage} (was not a clear GO).`);
      if (!work.length) flags.push("No work item (no next_action captured).");

      records.push({ name, s, raw, actual, actualKind, knowledge, work, flags, stage });
    }

    // ── Duplicate detection across leads + projects ──────────────────────────
    const nameHits = (
      await c.query(
        `SELECT lower(name) nm, count(*) n FROM (
           SELECT name FROM leads UNION ALL SELECT name FROM projects
         ) u GROUP BY 1 HAVING count(*) > 1`,
      )
    ).rows;

    // ── Render ───────────────────────────────────────────────────────────────
    const L = [];
    L.push("# Imported data review — temp CRM → SJC OS");
    L.push("");
    L.push(`_Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/import-review.mjs\` (read-only). Re-run to refresh._`);
    L.push("");
    L.push("Source: `/home/joe/SJC OS Temp/data/leads.csv` (legacy/import reference only — SJC OS Postgres is now the source of truth).");
    L.push("");
    // work_items + knowledge_items grow over time (Joe/agents add more), so they
    // pass when actual >= baseline; a drop below baseline would signal data loss.
    // The rest are structural and must match exactly.
    const GROWS = new Set(["work_items", "knowledge_items"]);
    const okFor = (k) =>
      expected[k] === undefined ? "" : (GROWS.has(k) ? counts[k] >= expected[k] : counts[k] === expected[k]) ? "✅" : "⚠️";
    L.push("## Counts");
    L.push("");
    L.push("| Table | Actual | Baseline (Hermes review) | OK |");
    L.push("|---|---:|---:|:--:|");
    for (const k of Object.keys(counts)) {
      const grows = GROWS.has(k) ? " (≥)" : "";
      L.push(`| ${k} | ${counts[k]} | ${expected[k] ?? "—"}${grows} | ${okFor(k)} |`);
    }
    L.push("");
    const flagged = records.filter((r) => r.flags.length);
    L.push(`## Records needing a look: ${flagged.length} of ${records.length}`);
    L.push("");
    L.push("Each imported **active** lead/project is below. Nothing here is auto-changed — this is review only. To roll the whole import back: `node scripts/import-undo.mjs undo --confirm`.");
    L.push("");

    for (const r of records) {
      const kind = r.s.proposed_target;
      const a = r.actual || {};
      const statusVal = kind === "project" ? a.status : a.stage;
      L.push(`### ${r.name} — ${kind}${r.flags.length ? "  ⚠️" : "  ✅"}`);
      L.push("");
      L.push(`- **Source record_id:** \`${r.s.record_id}\``);
      L.push(`- **Classification:** proposed \`${kind}\` → imported as **${r.actual ? kind : "NOT FOUND"}**`);
      L.push(`- **Temp stage:** \`${r.stage || "—"}\`  →  **official ${kind === "project" ? "status" : "stage"}:** \`${statusVal || "—"}\``);
      if (kind === "project" && a.stage_label) L.push(`- **Milestone:** ${clean(a.stage_label)}`);
      L.push(`- **Contact:** ${clean(r.raw.email) || "—"}${r.raw.phone ? " · " + clean(r.raw.phone) : ""}`);
      const nextW = r.work[0];
      L.push(`- **Next action:** ${nextW ? clean(nextW.title) : "—"}${nextW && nextW.due_at ? `  _(due ${d(nextW.due_at)})_` : ""}`);
      L.push(`- **Linked knowledge items:** ${r.knowledge}`);
      L.push(`- **Work items (${r.work.length}):** ${r.work.length ? r.work.map((w) => `${clean(w.title).slice(0, 48)} [${w.status}${w.requires_approval ? ", needs approval" : ""}]`).join("; ") : "—"}`);
      if (clean(r.s.review_notes)) L.push(`- **Import notes:** ${clean(r.s.review_notes)}`);
      if (r.flags.length) {
        L.push(`- **⚠️ Review flags:**`);
        for (const f of r.flags) L.push(`  - ${f}`);
      }
      L.push("");
    }

    L.push("## Duplicate / false-record checks");
    L.push("");
    L.push(nameHits.length
      ? nameHits.map((h) => `- ⚠️ Name appears more than once across leads+projects: **${h.nm}** ×${h.n}`).join("\n")
      : "- ✅ No duplicate names across leads + projects.");
    L.push("");
    L.push("## The 44 closed rows");
    L.push("");
    L.push("The other 44 temp rows classified as `archive` (closed_out / lost / pass / archived / warranty_*) were **left in staging only** (`sjc_temp_lead_imports`, `import_status='staged'`) and were **not** written to official leads/projects. Review them in the staging buffer if any should be revived.");
    L.push("");

    writeFileSync(OUT, L.join("\n"));
    console.log(`Wrote ${OUT}`);
    console.log(`Counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    const mism = Object.keys(expected).filter((k) => (GROWS.has(k) ? counts[k] < expected[k] : counts[k] !== expected[k]));
    console.log(mism.length ? `⚠️ Count issues: ${mism.join(", ")}` : "✅ All counts OK (structural exact; work/knowledge ≥ baseline).");
    console.log(`Flagged for review: ${flagged.length}/${records.length} active records.`);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
