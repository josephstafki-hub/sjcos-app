// Migration runner for in-person / drawn signatures: signed_method,
// signature_file_id and witness_name on signature_requests, plus the
// 'presented' signature_events kind.
//
// Runs the block between the "In-person signing (begin)/(end)" markers in
// db/schema.sql VERBATIM inside one transaction, so the runner and the schema
// file can never drift. Every statement is additive and idempotent: safe to
// re-run, and safe against the live DB while the old build is serving (the
// new columns default to the legacy behaviour; nothing existing reads them).
//
//   node db/apply-in-person-signing.mjs            # DRY RUN: apply, report, ROLL BACK
//   node db/apply-in-person-signing.mjs --approve  # apply and COMMIT

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
const block = schema.match(/-- ─── In-person signing \(begin\)[\s\S]*?-- ─── In-person signing \(end\)[^\n]*\n?/)?.[0];
if (!block) throw new Error("In-person signing block not found in db/schema.sql");

const WANTED = ["signed_method", "signature_file_id", "witness_name"];

async function present(client) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'signature_requests' AND column_name = ANY($1)`,
    [WANTED],
  );
  const { rows: chk } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'signature_events_kind_check'`,
  );
  return {
    columns: rows.map((r) => r.column_name).sort(),
    presented: (chk[0]?.def ?? "").includes("'presented'"),
  };
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  const before = await present(client);
  await client.query(block);
  const after = await present(client);
  console.log(`columns : ${before.columns.length}/${WANTED.length} before → ${after.columns.length}/${WANTED.length} after`);
  console.log(`'presented' event kind: ${before.presented ? "yes" : "no"} before → ${after.presented ? "yes" : "no"} after`);
  if (after.columns.length !== WANTED.length || !after.presented) throw new Error("schema incomplete after apply");
  if (approve) {
    await client.query("COMMIT");
    console.log("in-person signing schema APPLIED");
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
