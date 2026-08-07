// Migration runner for the client-portal rework: floor-plan versions become
// client-approvable (a lightweight in-portal acknowledgment, distinct from the
// e-sign engine which stays the path for contracts/estimates/change orders).
//
// Every statement is additive and idempotent — safe to re-run.
//
//   node db/apply-portal-approvals.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // ── A client can approve a specific plan version from their portal. The
  //    typed name is captured so the approval reads like a record, not a click.
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS client_approved_at timestamptz`,
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS client_approved_name text NOT NULL DEFAULT ''`,
  // ── Same lightweight approval on a mood board (per room). Re-curating a
  //    board after approval is the owner's call; the approval simply records
  //    the direction was signed off at that point.
  `ALTER TABLE project_mood_boards ADD COLUMN IF NOT EXISTS client_approved_at timestamptz`,
  `ALTER TABLE project_mood_boards ADD COLUMN IF NOT EXISTS client_approved_name text NOT NULL DEFAULT ''`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nportal approvals migration complete.");
} finally {
  await client.end();
}
