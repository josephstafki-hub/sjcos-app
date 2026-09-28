// Migration runner for STAFF SEPARATION — the pieces of SJC OS that were
// written for a single owner and have to become per-account now that staff
// logins exist (lib/permissions.ts).
//
// Five independent changes, all idempotent:
//
//  1. work_items.assigned_user_id — which PERSON owns a to-do. NULL = the
//     owner (Joe). Distinct from assignee_kind/assignee_key, which say whether
//     a bot or a human runs it; those stay exactly as they were. Joe's Today
//     shows every human to-do including the ones he handed off; a staff
//     member's Today shows only their own.
//
//  2. notifications.audience_user_id + notification_reads — the feed used to be
//     one global list with one `read` flag, so a staff member would have seen
//     (and could have cleared) Joe's notifications. NULL audience = the owner's
//     company feed, exactly what every existing emit() writes; a row addressed
//     to a staff member carries their id. Read state moves to a per-user table,
//     backfilled from the old flag for the owner.
//
//  3. chat_reads_by_user — one last-read marker per person per channel, and
//     chat_messages.author_user_id so "is this mine" is a fact rather than a
//     guess from the display name. A NEW table rather than a user_id column on
//     chat_reads, on purpose: the old table is keyed on channel_key alone, so
//     adding to its primary key would break the running site's markRead()
//     (`ON CONFLICT (channel_key)`) the moment this migration lands, and stay
//     broken until the deploy. Every statement here is additive, so it can be
//     applied whenever and the deploy can wait. chat_reads is left in place,
//     backfilled from, and then unused.
//
//  4. team_members.user_id — links a chat roster entry to a login, so a staff
//     account and their chat identity are the same person. Owner included: the
//     owner gets a roster row too, which is what makes staff↔staff DMs
//     addressable (see internalDmKey in lib/chat.ts).
//
//  5. user_email_accounts — per-user linked mailbox. Until now the one Gmail
//     refresh token lived in GMAIL_REFRESH_TOKEN and every account saw Joe's
//     mail. A row here wins over the env var; the env var stays as the owner's
//     fallback so live prod keeps working untouched.
//
//   node db/apply-staff-separation.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // ── 1. To-do assignment ────────────────────────────────────────────────
  `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assigned_user_id uuid
     REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_work_items_assigned_user
     ON work_items (assigned_user_id, status)`,

  // ── 2. Notifications: audience + per-user read state ───────────────────
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience_user_id uuid
     REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_audience
     ON notifications (audience_user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_reads (
     notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
     user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     read_at         timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (notification_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id)`,
  // Backfill: everything the owner had already cleared stays cleared for them.
  `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, u.id FROM notifications n CROSS JOIN users u
      WHERE n.read = true AND u.role = 'owner'
   ON CONFLICT DO NOTHING`,

  // ── 3. Chat: per-user reads + authorship ───────────────────────────────
  `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS author_user_id uuid
     REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS chat_reads_by_user (
     channel_key  text NOT NULL,
     user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     last_read_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (channel_key, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_reads_by_user_user ON chat_reads_by_user (user_id)`,
  // Existing markers were the owner's — carry them over so his badges don't all
  // light up on the first render after the deploy.
  `INSERT INTO chat_reads_by_user (channel_key, user_id, last_read_at)
     SELECT r.channel_key, u.id, r.last_read_at
       FROM chat_reads r CROSS JOIN users u
      WHERE u.role = 'owner'
   ON CONFLICT (channel_key, user_id) DO NOTHING`,

  // ── 4. Chat roster ↔ login ─────────────────────────────────────────────
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id uuid
     REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_user
     ON team_members (user_id) WHERE user_id IS NOT NULL`,

  // ── 5. Per-user linked mailbox ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS user_email_accounts (
     user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     email         text NOT NULL,
     refresh_token text NOT NULL,
     connected_at  timestamptz NOT NULL DEFAULT now()
   )`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) await client.query(sql);

  // Every internal login (owner + staff) needs a chat roster row so DMs
  // between any two of them are addressable. Slug from the email local part,
  // de-duplicated against whatever is already in the roster.
  await client.query(
    `INSERT INTO team_members (slug, name, role_label, active, user_id)
       SELECT slug, name, role_label, true, id FROM (
         SELECT u.id, u.name,
                CASE WHEN u.role = 'owner' THEN 'Owner' ELSE 'Team' END AS role_label,
                regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9]+', '-', 'g') AS slug
           FROM users u
          WHERE u.role IN ('owner','staff')
            AND NOT EXISTS (SELECT 1 FROM team_members t WHERE t.user_id = u.id)
       ) c
      WHERE NOT EXISTS (SELECT 1 FROM team_members t WHERE t.slug = c.slug)`,
  );
  // A roster row that already existed under the same name gets adopted rather
  // than duplicated (Joe added "Marco" by hand, then gave Marco a login).
  await client.query(
    `UPDATE team_members t SET user_id = u.id
       FROM users u
      WHERE t.user_id IS NULL
        AND u.role IN ('owner','staff')
        AND lower(t.name) = lower(u.name)
        AND NOT EXISTS (SELECT 1 FROM team_members x WHERE x.user_id = u.id)`,
  );

  const { rows: linked } = await client.query(
    `SELECT t.slug, t.name, u.role FROM team_members t
       JOIN users u ON u.id = t.user_id ORDER BY (u.role = 'owner') DESC, t.name`,
  );
  console.log("chat roster linked to logins:", linked.map((r) => `${r.slug} (${r.role})`).join(", ") || "none");
  console.log("apply-staff-separation: done");
} finally {
  await client.end();
}
