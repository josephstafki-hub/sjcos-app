// Migration runner for ARCHIVING closed work items on /engine (2026-10-02).
//
// Joe: "create a method of archiving done or cancelled work queue items in the
// engine". The board loaded every work item ever filed — 367 done/cancelled
// against 57 open on the day this landed — so the open work drowned.
//
// Adds work_items.archived_at: NULL = on the board, a time = archived (off the
// board, still in the table, still visible to every MCP query and dedup check —
// archiving is display-only, nothing is deleted). Only a done or cancelled item
// can be archived, and reopening one (any writer, any path: /engine, Today,
// MCP update_work_item_status, the inbox sweep) brings it back. Both rules live
// on the table in one BEFORE trigger so no code path can forget them. Mirrors
// db/schema.sql.
//
// Additive and idempotent — safe to re-run, safe while the old build is still
// serving (nothing old reads or writes the column, and the trigger only ever
// clears a value nothing old sets).
//
//   node db/apply-work-item-archive.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const STATEMENTS = [
  `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS idx_work_items_archived ON work_items (archived_at DESC)
     WHERE archived_at IS NOT NULL`,
  `CREATE OR REPLACE FUNCTION work_items_archive_closed_only() RETURNS trigger AS $f$
   BEGIN
     IF NEW.archived_at IS NOT NULL AND NEW.status NOT IN ('done','cancelled') THEN
       NEW.archived_at := NULL;
     END IF;
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_work_items_archive_closed_only ON work_items`,
  `CREATE TRIGGER trg_work_items_archive_closed_only
     BEFORE INSERT OR UPDATE OF status, archived_at ON work_items
     FOR EACH ROW EXECUTE FUNCTION work_items_archive_closed_only()`,
];

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const env = readFileSync(envFile, "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
  if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Don't queue the live site behind us if something holds work_items.
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log(`ok: ${sql.split("\n")[0].trim()}`);
    }
    await client.query("COMMIT");
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE status IN ('done','cancelled') AND archived_at IS NULL)::int AS closed,
              count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived
         FROM work_items`,
    );
    console.log(`closed on the board: ${rows[0].closed}, archived: ${rows[0].archived}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("apply-work-item-archive: done");
}
