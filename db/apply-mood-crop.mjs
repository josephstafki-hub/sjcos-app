// Throwaway migration runner for the mood-board crop upgrade: per-item crop
// focal point and zoom, so an image can be panned and magnified inside its
// frame instead of always centre-cropping.
//
// Additive and idempotent — safe to re-run. Defaults (0.5 / 0.5 / 1) reproduce
// the old fixed centre-crop, so existing boards render pixel-identical.
//
//   node db/apply-mood-crop.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_x    real NOT NULL DEFAULT 0.5`,
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_y    real NOT NULL DEFAULT 0.5`,
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_zoom real NOT NULL DEFAULT 1`,
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
  console.log("\nMood-board crop schema applied.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("\nRolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
