// Throwaway migration runner for the "scheduled to-dos stay out of Today until
// their day" rule (Joe, 2026-09-02): whenever a work item gets a due date on a
// future day — created or moved, by any writer (MCP create_work_item /
// snooze_work_item, detectors, /engine + record forms, Hermes, raw SQL) — the
// row is snoozed until 00:00 America/Chicago of that day and dropped out of the
// Priorities rail (promoted_at = NULL). Moving a due date back to today or
// earlier lifts the snooze so the item surfaces at once. The rule lives on the
// table (BEFORE trigger) so no code path can forget it. Mirrors db/schema.sql.
//
// Also backfills: every open item already due on a future day is snoozed to
// that day, with a receipt per row (same shape snooze_work_item writes).
//
// Additive and idempotent — safe to re-run. No data is deleted.
//
//   node db/apply-scheduled-snooze.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

export const STATEMENTS = [
  `CREATE OR REPLACE FUNCTION work_item_due_day_start(due timestamptz) RETURNS timestamptz
   LANGUAGE sql STABLE AS $f$
     SELECT CASE
       WHEN due IS NULL THEN NULL
       -- A date-only due ("2026-09-08") lands at midnight of the session zone;
       -- take the calendar date as written instead of shifting it into Central.
       WHEN due = date_trunc('day', due) THEN (due::date)::timestamp AT TIME ZONE 'America/Chicago'
       ELSE date_trunc('day', due AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'
     END
   $f$`,
  `CREATE OR REPLACE FUNCTION work_items_snooze_until_due() RETURNS trigger AS $f$
   DECLARE day_start timestamptz;
   BEGIN
     IF NEW.due_at IS NULL OR NEW.status IN ('done','cancelled') THEN RETURN NEW; END IF;
     IF TG_OP = 'UPDATE' AND NEW.due_at IS NOT DISTINCT FROM OLD.due_at THEN RETURN NEW; END IF;
     day_start := work_item_due_day_start(NEW.due_at);
     IF day_start > now() THEN
       -- Scheduled for a later day: hold it in the backlog until that morning.
       NEW.snoozed_until := day_start;
       NEW.promoted_at := NULL;
     ELSIF NEW.snoozed_until IS NOT NULL AND NEW.snoozed_until > now() THEN
       -- Due moved back to today/past: lift the snooze so it surfaces now.
       NEW.snoozed_until := NULL;
     END IF;
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_work_items_snooze_until_due ON work_items`,
  `CREATE TRIGGER trg_work_items_snooze_until_due
     BEFORE INSERT OR UPDATE OF due_at ON work_items
     FOR EACH ROW EXECUTE FUNCTION work_items_snooze_until_due()`,
  // Backfill: open items already scheduled for a later day. Receipt per row.
  `WITH s AS (
     UPDATE work_items w
        SET snoozed_until = work_item_due_day_start(w.due_at),
            promoted_at = NULL,
            updated_at = now()
      WHERE w.status NOT IN ('done','cancelled')
        AND w.due_at IS NOT NULL
        AND work_item_due_day_start(w.due_at) > now()
        AND w.snoozed_until IS DISTINCT FROM work_item_due_day_start(w.due_at)
      RETURNING w.id, w.snoozed_until)
   INSERT INTO agent_receipts (work_item_id, receipt_kind, label)
   SELECT id, 'db_row',
          'snoozed until scheduled day '
            || to_char(snoozed_until AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD')
            || ' (Joe rule 2026-09-02: scheduled to-dos wait for their day)'
     FROM s`,
];

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const sql of STATEMENTS) {
      const r = await client.query(sql);
      console.log(`ok: ${sql.split("\n")[0].trim()}${r.rowCount != null && sql.startsWith("WITH") ? ` (${r.rowCount} rows)` : ""}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("Scheduled-snooze rule applied.");
}
