// Throwaway migration runner for the mood-board editor upgrade: free transform
// (height + rotation), text/swatch items, and per-room board settings.
//
// Every statement is additive and idempotent — safe to re-run. The one DROP is
// the kind CHECK constraint, immediately re-added. No data is deleted, and no
// column is back-filled: pos_h stays NULL on existing pins, which is exactly
// the "auto height from the image aspect" behaviour they already had.
//
//   node db/apply-mood-editor.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pin'`,
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_h real`,
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_rot real NOT NULL DEFAULT 0`,
  `ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS swatch text NOT NULL DEFAULT ''`,
  `ALTER TABLE project_mood DROP CONSTRAINT IF EXISTS project_mood_kind_check`,
  `ALTER TABLE project_mood ADD CONSTRAINT project_mood_kind_check
     CHECK (kind IN ('pin','text','swatch'))`,

  `CREATE TABLE IF NOT EXISTS project_mood_boards (
     id         bigserial PRIMARY KEY,
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     room       text NOT NULL,
     title      text NOT NULL DEFAULT '',
     bg_color   text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (project_id, room)
   )`,

  // Back-fill a settings row for every room that already has pins, so existing
  // boards are renameable/stylable straight away instead of only after an edit.
  `INSERT INTO project_mood_boards (project_id, room)
     SELECT DISTINCT project_id, room FROM project_mood
   ON CONFLICT (project_id, room) DO NOTHING`,
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
  console.log("\nMood-board editor schema applied.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("\nRolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
