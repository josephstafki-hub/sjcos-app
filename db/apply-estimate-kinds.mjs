// Migration runner for estimate kinds + the scope-change path
// (docs/estimates-and-change-orders.md): `estimates.kind`, the
// project_has_signed_contract() / project_scope_change_path() functions, and
// the two triggers that refuse a change order before the contract is signed
// and a pre-con change estimate after it.
//
// Runs the block between the "Estimate kinds + scope-change path
// (begin)/(end)" markers in db/schema.sql VERBATIM, inside one transaction, so
// the runner and the schema file can never drift. Additive and idempotent:
// safe to re-run, and safe against the live DB while the old build is serving
// (the column defaults to 'formal', which is what every existing writer
// meant; the triggers only refuse rows the rule says must not exist).
//
// One data fix rides along: worksheets titled "Revision …" were pre-con
// changes in all but name — they are re-tagged `precon_change`, and listed.
//
//   node db/apply-estimate-kinds.mjs            # DRY RUN: apply, report, ROLL BACK
//   node db/apply-estimate-kinds.mjs --approve  # apply and COMMIT

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
  /-- ─── Estimate kinds \+ scope-change path \(begin\)[\s\S]*?-- ─── Estimate kinds \+ scope-change path \(end\)[^\n]*\n?/,
)?.[0];
if (!block) throw new Error("Estimate kinds block not found in db/schema.sql");

async function present(client) {
  const { rows: col } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'kind'`,
  );
  const { rows: fns } = await client.query(
    `SELECT proname FROM pg_proc WHERE proname IN ('project_has_signed_contract','project_scope_change_path',
       'change_orders_require_contract','estimates_precon_change_before_contract') ORDER BY proname`,
  );
  const { rows: trg } = await client.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
       ('trg_change_orders_require_contract','trg_estimates_precon_change_before_contract') ORDER BY tgname`,
  );
  return { kind_column: col.length > 0, functions: fns.map((r) => r.proname), triggers: trg.map((r) => r.tgname) };
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  const before = await present(client);
  await client.query(block);
  const { rows: retagged } = await client.query(
    `UPDATE estimates SET kind = 'precon_change'
      WHERE kind = 'formal' AND project_id IS NOT NULL AND title ~* '^revision\\M'
      RETURNING id, title`,
  );
  const after = await present(client);
  const { rows: paths } = await client.query(
    `SELECT p.slug, p.status, project_scope_change_path(p.id) AS path
       FROM projects p WHERE p.status <> 'warranty' ORDER BY p.status, p.slug`,
  );
  console.log(JSON.stringify({ before, after, retagged, scope_change_paths: paths }, null, 2));
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
