// Migration runner: link each Formal Estimate / Contract document to the
// estimate it was generated from (document_drafts.estimate_id) and backfill the
// existing ones (docs/estimates-and-change-orders.md).
//
// Runs the block between the "Formal Estimate PDF → its estimate (begin)/(end)"
// markers in db/schema.sql VERBATIM, inside one transaction, so the runner and
// the schema file can't drift. Additive and idempotent: safe to re-run, and
// safe against the live DB while the old build is serving (it never reads the
// new column).
//
//   node db/apply-estimate-pdf-link.mjs            # DRY RUN: apply, report, ROLL BACK
//   node db/apply-estimate-pdf-link.mjs --approve  # apply and COMMIT

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const url =
  process.env.DATABASE_URL ??
  readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found (env or ${envFile})`);

const approve = process.argv.includes("--approve");
const schema = readFileSync(path.join(here, "schema.sql"), "utf8");
const block = schema.match(
  /-- ─── Formal Estimate PDF → its estimate \(begin\)[\s\S]*?-- ─── Formal Estimate PDF → its estimate \(end\)[^\n]*\n?/,
)?.[0];
if (!block) throw new Error("Formal Estimate PDF block not found in db/schema.sql");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(block);
  const { rows } = await client.query(
    `SELECT d.id, d.template_key, d.status, COALESCE(p.slug, d.lead_slug) AS job, d.estimate_id
       FROM document_drafts d LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.template_key IN ('estimate_doc', 'contract')
      ORDER BY d.template_key, d.id`,
  );
  console.table(rows);
  const unlinked = rows.filter((r) => r.estimate_id == null);
  if (unlinked.length) console.log(`${unlinked.length} document(s) left unlinked (no matching estimate on the same job).`);
  if (approve) {
    await client.query("COMMIT");
    console.log("COMMITTED.");
  } else {
    await client.query("ROLLBACK");
    console.log("DRY RUN — rolled back. Re-run with --approve to commit.");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
