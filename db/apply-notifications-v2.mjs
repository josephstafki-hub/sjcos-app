// Migration runner for NOTIFICATIONS v2 (2026-10-17).
//
// Joe: "if an action that I take in app triggers a notification it should show
// in my user account as a notification. an example is changing a project or
// lead stage." And: approvals he'd already given kept sitting in the bell as
// "needs a decision".
//
// Adds to notifications:
//   ref           what the card is about ("decision:<uuid>", "work_item:<uuid>",
//                 "lead:<uuid>", "project:<uuid>", "grant:<uuid>")
//   resolved_at   set the moment that subject is decided — on ANY channel
//   resolution    approved / rejected / expired / … (shown on the card)
//   actor_user_id who caused it (their own feed shows it; see lib/notifications.ts)
//
// Triggers (so no code path, MCP tool or agent can forget):
//   • leads.stage / projects.status change → one feed card, attributed to the
//     signed-in person when the writer set sjcos.actor_user_id (lib/db.ts
//     queryAs), otherwise unattributed (agents, timers, MCP).
//   • decisions leaving 'pending' and work_items.approval_status leaving
//     'requested' → their cards are marked resolved.
//
// Backfills refs on existing decision / approval cards and resolves the ones
// already decided, so the bell stops asking about settled things.
//
// Additive and idempotent — safe to re-run, safe while the old build is still
// serving (old code doesn't read the columns; its inserts leave them NULL).
//
//   node db/apply-notifications-v2.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const LEAD_LABEL = `CASE $1
  WHEN 'intake' THEN 'Intake'
  WHEN 'qualified' THEN 'Qualified'
  WHEN 'discovery_call' THEN 'Discovery call'
  WHEN 'rough_estimate' THEN 'Rough estimate'
  WHEN 'precon_signed' THEN 'Pre-con contract sent'
  WHEN 'lost' THEN 'Lost / Archived'
  ELSE initcap(replace(coalesce($1, '?'), '_', ' ')) END`;

const PROJECT_LABEL = `CASE $1
  WHEN 'precon_signed' THEN 'Pre-con signed'
  WHEN 'floor_plan' THEN 'Floor plan'
  WHEN 'mood_board' THEN 'Mood board'
  WHEN 'selections' THEN 'Selections'
  WHEN 'bidding' THEN 'Bidding'
  WHEN 'construction_contract' THEN 'Construction contract'
  WHEN 'construction' THEN 'Construction'
  WHEN 'closeout' THEN 'Closeout'
  WHEN 'warranty' THEN 'Warranty'
  ELSE initcap(replace(coalesce($1, '?'), '_', ' ')) END`;

export const STATEMENTS = [
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref text`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at timestamptz`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolution text`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications (ref) WHERE ref IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL`,

  // ── labels ────────────────────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION sjc_lead_stage_label(text) RETURNS text AS $f$ SELECT ${LEAD_LABEL} $f$ LANGUAGE sql IMMUTABLE`,
  `CREATE OR REPLACE FUNCTION sjc_project_status_label(text) RETURNS text AS $f$ SELECT ${PROJECT_LABEL} $f$ LANGUAGE sql IMMUTABLE`,
  `CREATE OR REPLACE FUNCTION sjc_current_actor() RETURNS uuid AS $f$
     SELECT CASE WHEN current_setting('sjcos.actor_user_id', true) ~ '^[0-9a-f-]{36}$'
                 THEN current_setting('sjcos.actor_user_id', true)::uuid END
   $f$ LANGUAGE sql STABLE`,

  // ── stage-change cards ────────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION notify_lead_stage_change() RETURNS trigger AS $f$
   DECLARE
     actor uuid := sjc_current_actor();
     actor_name text;
   BEGIN
     IF actor IS NOT NULL THEN SELECT name INTO actor_name FROM users WHERE id = actor; END IF;
     INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href, ref, actor_user_id)
     VALUES ('job', 'Lead', CASE WHEN NEW.stage = 'lost' THEN 'ghost' ELSE 'accent' END, 'site',
             NEW.name || ' → ' || sjc_lead_stage_label(NEW.stage),
             'Lead moved from ' || sjc_lead_stage_label(OLD.stage) || COALESCE(' · by ' || actor_name, ''),
             'Just now', false, '/leads/' || NEW.slug, 'lead:' || NEW.id, actor);
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_notify_lead_stage_change ON leads`,
  `CREATE TRIGGER trg_notify_lead_stage_change
     AFTER UPDATE OF stage ON leads
     FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
     EXECUTE FUNCTION notify_lead_stage_change()`,

  `CREATE OR REPLACE FUNCTION notify_project_status_change() RETURNS trigger AS $f$
   DECLARE
     actor uuid := sjc_current_actor();
     actor_name text;
   BEGIN
     IF actor IS NOT NULL THEN SELECT name INTO actor_name FROM users WHERE id = actor; END IF;
     INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href, ref, actor_user_id)
     VALUES ('job', 'Job', 'accent', 'project',
             NEW.name || ' → ' || sjc_project_status_label(NEW.status),
             'Stage moved from ' || sjc_project_status_label(OLD.status) || COALESCE(' · by ' || actor_name, ''),
             'Just now', false, '/projects/' || NEW.slug, 'project:' || NEW.id, actor);
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_notify_project_status_change ON projects`,
  `CREATE TRIGGER trg_notify_project_status_change
     AFTER UPDATE OF status ON projects
     FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
     EXECUTE FUNCTION notify_project_status_change()`,

  // ── resolve approval cards when their subject is decided ─────────────────
  `CREATE OR REPLACE FUNCTION notify_resolve_decision() RETURNS trigger AS $f$
   BEGIN
     UPDATE notifications SET resolved_at = now(), resolution = NEW.status
      WHERE ref = 'decision:' || NEW.id AND resolved_at IS NULL;
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_notify_resolve_decision ON decisions`,
  `CREATE TRIGGER trg_notify_resolve_decision
     AFTER UPDATE OF status ON decisions
     FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
     EXECUTE FUNCTION notify_resolve_decision()`,

  // A failed send after Approve puts the gate back to 'requested'
  // (lib/approved-draft-send.ts reopenApprovalAfterFailedSend) — the card
  // must come back with it, or the bell says "approved" for a draft that
  // never went out.
  `CREATE OR REPLACE FUNCTION notify_resolve_work_item() RETURNS trigger AS $f$
   BEGIN
     IF NEW.approval_status = 'requested' THEN
       UPDATE notifications SET resolved_at = NULL, resolution = NULL
        WHERE ref = 'work_item:' || NEW.id AND resolved_at IS NOT NULL;
     ELSIF OLD.approval_status = 'requested' THEN
       UPDATE notifications SET resolved_at = now(), resolution = NEW.approval_status
        WHERE ref = 'work_item:' || NEW.id AND resolved_at IS NULL;
     END IF;
     RETURN NEW;
   END;
   $f$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_notify_resolve_work_item ON work_items`,
  `CREATE TRIGGER trg_notify_resolve_work_item
     AFTER UPDATE OF approval_status ON work_items
     FOR EACH ROW WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
     EXECUTE FUNCTION notify_resolve_work_item()`,

  // ── backfill ──────────────────────────────────────────────────────────────
  `UPDATE notifications SET ref = 'decision:' || substring(href from 'd=([0-9a-f-]{36})')
    WHERE ref IS NULL AND href ~ '/engine/decisions\\?d=[0-9a-f-]{36}'`,
  // "Permission" cards point at /engine/permissions; match them to their
  // grant decision by title + time.
  `UPDATE notifications n SET ref = 'decision:' || d.id
     FROM decisions d
    WHERE n.ref IS NULL AND n.tag = 'Permission' AND d.kind = 'grant'
      AND d.title = n.title AND abs(extract(epoch FROM d.created_at - n.created_at)) < 120`,
  `UPDATE notifications n SET ref = 'work_item:' || w.id
     FROM work_items w
    WHERE n.ref IS NULL AND n.kind = 'decision' AND n.tag = 'Approval'
      AND regexp_replace(n.title, '^(Approve: |Approval waiting [0-9]+h: )', '') = w.title`,
  `UPDATE notifications n SET resolved_at = COALESCE(d.decided_at, d.updated_at, now()), resolution = d.status
     FROM decisions d
    WHERE n.ref = 'decision:' || d.id AND n.resolved_at IS NULL AND d.status <> 'pending'`,
  `UPDATE notifications n SET resolved_at = COALESCE(w.updated_at, now()), resolution = w.approval_status
     FROM work_items w
    WHERE n.ref = 'work_item:' || w.id AND n.resolved_at IS NULL AND w.approval_status <> 'requested'`,
  // Old stale-grant nudges carry no id; any older than a day is about a
  // request that has since lapsed (requests live 24 h).
  `UPDATE notifications SET resolved_at = now(), resolution = 'closed'
    WHERE ref IS NULL AND resolved_at IS NULL AND title LIKE 'Grant request waiting%'
      AND created_at < now() - interval '1 day'`,
  // A card whose decision was deleted can never be answered.
  `UPDATE notifications n SET resolved_at = now(), resolution = 'closed'
    WHERE n.ref LIKE 'decision:%' AND n.resolved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM decisions d WHERE 'decision:' || d.id = n.ref)`,
  // Permission cards from before grants had decisions (no ref to follow):
  // requests live 24 h, so any older than a day has lapsed or been answered.
  `UPDATE notifications SET resolved_at = now(), resolution = 'closed'
    WHERE ref IS NULL AND resolved_at IS NULL AND tag = 'Permission'
      AND created_at < now() - interval '1 day'`,
  // "Decision approved: …" rows were a second card per resolution (the
  // Telegram refresh used to emit one); they are history, not asks.
  `UPDATE notifications SET resolved_at = created_at, resolution = 'info'
    WHERE resolved_at IS NULL AND kind = 'decision' AND title ~ '^Decision (approved|rejected|expired|revoked|consumed|superseded):'`,
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
    // Don't queue the live site behind us if something holds these tables.
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const sql of STATEMENTS) {
      const r = await client.query(sql);
      console.log(`ok: ${sql.split("\n")[0].trim().slice(0, 100)}${r.command === "UPDATE" ? ` (${r.rowCount} rows)` : ""}`);
    }
    await client.query("COMMIT");
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE ref IS NOT NULL)::int AS with_ref,
              count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
              count(*) FILTER (WHERE kind = 'decision' AND resolved_at IS NULL)::int AS open_decisions
         FROM notifications`,
    );
    console.log(`with ref: ${rows[0].with_ref}, resolved: ${rows[0].resolved}, open decision cards: ${rows[0].open_decisions}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("apply-notifications-v2: done");
}
