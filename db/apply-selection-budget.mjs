// Migration runner for the overall selections budget: one whole-dollar figure
// per project that the client's running total is measured against, on top of
// the per-room / per-sub-section budgets that already exist. 0 means "not set"
// and the board falls back to summing the room budgets, so nothing changes for
// projects that never touch it.
//
// Idempotent — safe to re-run.
//
//   node db/apply-selection-budget.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS selections_budget integer NOT NULL DEFAULT 0`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nselections budget migration complete.");
} finally {
  await client.end();
}
