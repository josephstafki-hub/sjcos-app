// Throwaway migration runner for live updates: a tiny append-only change log
// that every writer (the app's query() helper and the MCP server's rows()
// helper) bumps on INSERT/UPDATE/DELETE. Open browser tabs poll the max id
// (components/shell/LiveUpdates.tsx) and router.refresh() when it advances, so
// agent edits show up without a reload.
//
// Idempotent — safe to re-run.
//
//   node db/apply-live-changes.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_change_log (
     id         bigserial PRIMARY KEY,
     scope      text NOT NULL DEFAULT '',   -- table the write touched ('' = unknown)
     source     text NOT NULL DEFAULT 'app',-- 'app' | 'mcp'
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_app_change_log_created ON app_change_log (created_at)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.split("\n")[0].trim().slice(0, 78));
  }
  await client.query("COMMIT");
  console.log("\nLive-changes schema applied.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("\nRolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
