// Migration runner for project financials (docs/project-financials-plan.md §6):
// budget lines, expenses, the columns that link a cost to a trade / change
// order / purchase order, change-order funding + credits, parties, funding
// events, and the per-job budget + billing settings.
//
// It runs the block between the "Project financials (begin)/(end)" markers in
// db/schema.sql VERBATIM, inside one transaction, so the runner and the schema
// file can never drift. Every statement is additive and idempotent: safe to
// re-run, and safe against the live DB while the old build is serving (nothing
// existing reads the new columns; the one loosened constraint is
// sub_invoices.sub_slug, which every existing writer still supplies).
//
//   node db/apply-project-financials.mjs            # DRY RUN: apply, report, ROLL BACK
//   node db/apply-project-financials.mjs --approve  # apply and COMMIT
//
// lock_timeout keeps a busy table from queueing prod traffic behind the ALTERs:
// the run fails fast instead, and can simply be tried again.

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
const block = schema.match(/-- ─── Project financials \(begin\)[\s\S]*?-- ─── Project financials \(end\)[^\n]*\n?/)?.[0];
if (!block) throw new Error("Project financials block not found in db/schema.sql");

const NEW_TABLES = ["budget_lines", "expenses", "change_order_credits", "budget_parties", "funding_events"];
const NEW_COLUMNS = {
  projects: ["budget_basis", "budget_label", "budget_caption", "price_cents", "retainage_cents", "budget_notes", "budget_complete", "costs_through", "billing_source", "opening_collected_cents", "opening_billed_cents", "opening_note"],
  sub_invoices: ["budget_line_id", "change_order_id", "purchase_order_id", "invoice_date", "paid_at", "paid_cents", "vendor_label", "source_ref"],
  purchase_orders: ["budget_line_id", "change_order_id"],
  change_orders: ["number", "vendor_label", "paid_by", "funder_share_cents", "budget_cost_cents", "est_to_finish_cents"],
};

async function present(client) {
  const { rows: t } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [NEW_TABLES]);
  const { rows: c } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [Object.keys(NEW_COLUMNS)]);
  const cols = new Set(c.map((r) => `${r.table_name}.${r.column_name}`));
  const wanted = Object.entries(NEW_COLUMNS).flatMap(([tbl, names]) => names.map((n) => `${tbl}.${n}`));
  return { tables: t.map((r) => r.table_name).sort(), columns: wanted.filter((w) => cols.has(w)), wanted: wanted.length };
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  const before = await present(client);
  await client.query(block);
  const after = await present(client);
  const { rows: moved } = await client.query(
    `SELECT count(*)::int AS n FROM projects WHERE billing_source <> 'manual' OR budget_complete OR price_cents IS NOT NULL`);
  console.log(`tables : ${before.tables.length}/${NEW_TABLES.length} before → ${after.tables.length}/${NEW_TABLES.length} after`);
  console.log(`columns: ${before.columns.length}/${before.wanted} before → ${after.columns.length}/${after.wanted} after`);
  console.log(`projects whose financial settings differ from the defaults: ${moved[0].n}`);
  if (after.tables.length !== NEW_TABLES.length || after.columns.length !== after.wanted) throw new Error("schema incomplete after apply");
  if (approve) {
    await client.query("COMMIT");
    console.log("project financials schema APPLIED");
  } else {
    await client.query("ROLLBACK");
    console.log("DRY RUN — rolled back, nothing changed. Re-run with --approve to apply.");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("FAILED, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
