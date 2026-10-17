// Migration runner for the team-chat ROOM LIFECYCLE (2026-10-16).
//
// Joe: "only active leads and projects have channels and once a lead closes or
// project finishes archive them in a way that can easily be reversed."
//
// Rooms used to be opened and closed by hand-placed calls in a few server
// actions, so every other path (MCP tools, Hermes, the construction-start
// workflow, lead first-response, deletes, imports) left them behind. On the day
// this landed /chat listed 63 open rooms against 9 active projects and 6 live
// leads: 42 warranty rooms for finished jobs, rooms for lost and deleted leads,
// and a project room for a job already in warranty.
//
// Now the rule lives on the tables, like the work_items snooze/archive rules:
//
//   chat_room_entities   view — the rooms that SHOULD be open: one per lead that
//                        is neither lost nor converted, one per project not yet
//                        in warranty ("finished" = reached warranty).
//   sync_chat_rooms()    reconciles chat_rooms against that view: opens (or
//                        reopens) a room for every active entity, archives
//                        (closed_at) every other room. Nothing is deleted —
//                        membership and transcript stay under the key, so a
//                        restore brings the room back exactly as it was.
//   chat_rooms.hold      the owner's override, so the reconcile never fights
//                        a deliberate click: 'open' = restored by hand though
//                        the job is done, 'archived' = archived by hand though
//                        the job is live. NULL = follow the entity. A hold
//                        clears itself once the entity's state agrees with it.
//   triggers             statement-level, on leads (stage/name/insert/delete)
//                        and projects (status/name/lead_id/insert/delete), so
//                        every writer keeps rooms in step. A failure in the
//                        reconcile is caught and logged — room bookkeeping
//                        must never block a lead or project write.
//
// Warranty rooms (room:wty:*) are no longer opened: a finished project's room
// archives, and Restore brings it back if a callback needs it.
//
// Additive and idempotent — safe to re-run, safe while the old build is still
// serving (the old build never reads `hold`, and its open/close calls agree
// with the reconcile). Runs one reconcile at the end, which archives the stale
// rooms. Mirrors db/schema.sql.
//
//   node db/apply-chat-room-lifecycle.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const STATEMENTS = [
  `ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS hold text`,
  `ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_hold_check`,
  `ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_hold_check CHECK (hold IN ('open','archived'))`,
  `CREATE OR REPLACE VIEW chat_room_entities AS
     SELECT 'room:lead:' || l.slug AS key, 'lead'::text AS entity_type, l.slug AS entity_ref, l.name
       FROM leads l
      WHERE l.stage <> 'lost'
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)
     UNION ALL
     SELECT 'room:' || p.slug, 'project', p.slug, p.name
       FROM projects p
      WHERE p.status <> 'warranty'`,
  `CREATE OR REPLACE FUNCTION sync_chat_rooms() RETURNS void AS $f$
   BEGIN
     -- Active entity: open its room (new, or reopened unless the owner archived
     -- it by hand), keep the name current, and drop an 'open' hold it no
     -- longer needs.
     INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
     SELECT key, entity_type, entity_ref, name FROM chat_room_entities
     ON CONFLICT (key) DO UPDATE
        SET closed_at = CASE WHEN chat_rooms.hold = 'archived' THEN chat_rooms.closed_at END,
            name      = EXCLUDED.name,
            hold      = NULLIF(chat_rooms.hold, 'open')
      WHERE (chat_rooms.closed_at IS NOT NULL AND chat_rooms.hold IS DISTINCT FROM 'archived')
         OR chat_rooms.name IS DISTINCT FROM EXCLUDED.name
         OR chat_rooms.hold = 'open';

     -- Lost, converted, finished, deleted (and every warranty room): archive,
     -- unless the owner restored it by hand.
     UPDATE chat_rooms r
        SET closed_at = now()
      WHERE r.closed_at IS NULL
        AND r.hold IS DISTINCT FROM 'open'
        AND NOT EXISTS (SELECT 1 FROM chat_room_entities e WHERE e.key = r.key);

     -- An 'archived' hold on a room whose entity is now inactive anyway is spent.
     UPDATE chat_rooms r
        SET hold = NULL
      WHERE r.hold = 'archived'
        AND NOT EXISTS (SELECT 1 FROM chat_room_entities e WHERE e.key = r.key);
   END;
   $f$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION trg_sync_chat_rooms() RETURNS trigger AS $f$
   BEGIN
     BEGIN
       PERFORM sync_chat_rooms();
     EXCEPTION WHEN OTHERS THEN
       RAISE WARNING 'sync_chat_rooms failed: %', SQLERRM;
     END;
     RETURN NULL;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_leads_sync_chat_rooms ON leads`,
  `CREATE TRIGGER trg_leads_sync_chat_rooms
     AFTER INSERT OR DELETE OR UPDATE OF stage, name ON leads
     FOR EACH STATEMENT EXECUTE FUNCTION trg_sync_chat_rooms()`,
  `DROP TRIGGER IF EXISTS trg_projects_sync_chat_rooms ON projects`,
  `CREATE TRIGGER trg_projects_sync_chat_rooms
     AFTER INSERT OR DELETE OR UPDATE OF status, name, lead_id ON projects
     FOR EACH STATEMENT EXECUTE FUNCTION trg_sync_chat_rooms()`,
  `SELECT sync_chat_rooms()`,
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
    // Don't queue the live site behind us if something holds leads/projects.
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log(`ok: ${sql.split("\n")[0].trim()}`);
    }
    await client.query("COMMIT");
    const { rows } = await client.query(
      `SELECT entity_type,
              count(*) FILTER (WHERE closed_at IS NULL)::int AS open,
              count(*) FILTER (WHERE closed_at IS NOT NULL)::int AS archived
         FROM chat_rooms GROUP BY entity_type ORDER BY entity_type`,
    );
    for (const r of rows) console.log(`${r.entity_type}: ${r.open} open, ${r.archived} archived`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("apply-chat-room-lifecycle: done");
}
