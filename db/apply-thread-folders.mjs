// Migration runner for panel threads v2 (docs/thread-folders-plan.md): thread
// folders (one per job, optionally bound to a project/lead), the T3-style
// settled / archived / pinned lifecycle columns, and last_activity_at as the
// auto-settle clock.
//
// Every statement is additive and idempotent — safe to re-run against the live
// DB while the old build is still serving (it never reads the new columns).
// Backfills: archived_at from the legacy `archived` boolean (kept in sync both
// ways by the app for one release), last_activity_at from the newest message.
//
//   node db/apply-thread-folders.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ai_folders (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name         text NOT NULL DEFAULT '',
     entity_kind  text CHECK (entity_kind IN ('project','lead','vendor','sub')),
     entity_id    text,
     collapsed    boolean NOT NULL DEFAULT false,
     sort_key     text,
     archived_at  timestamptz,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_folders_entity_idx
     ON ai_folders (entity_kind, entity_id) WHERE entity_id IS NOT NULL`,
  `ALTER TABLE ai_conversations
     ADD COLUMN IF NOT EXISTS folder_id        uuid REFERENCES ai_folders(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS settled_override text CHECK (settled_override IN ('settled','active')),
     ADD COLUMN IF NOT EXISTS settled_at       timestamptz,
     ADD COLUMN IF NOT EXISTS unsettled_at     timestamptz,
     ADD COLUMN IF NOT EXISTS archived_at      timestamptz,
     ADD COLUMN IF NOT EXISTS pinned_at        timestamptz,
     ADD COLUMN IF NOT EXISTS pin_order_key    text,
     ADD COLUMN IF NOT EXISTS snoozed_until    timestamptz,
     ADD COLUMN IF NOT EXISTS snoozed_at       timestamptz,
     ADD COLUMN IF NOT EXISTS last_activity_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS ai_conversations_rail_idx
     ON ai_conversations (archived_at, folder_id, settled_override, created_at DESC)`,
  // Backfills — only rows the new columns haven't been set on yet.
  `UPDATE ai_conversations SET archived_at = updated_at
    WHERE archived = true AND archived_at IS NULL`,
  `UPDATE ai_conversations c SET last_activity_at = m.last
     FROM (SELECT conversation_id, max(created_at) AS last FROM ai_messages GROUP BY conversation_id) m
    WHERE m.conversation_id = c.id AND c.last_activity_at IS NULL`,
  `UPDATE ai_conversations SET last_activity_at = updated_at WHERE last_activity_at IS NULL`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.trim().split("\n")[0].slice(0, 90));
  }
  const { rows } = await client.query(
    `SELECT count(*)::int AS threads,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
            count(*) FILTER (WHERE last_activity_at IS NULL)::int AS missing_activity
       FROM ai_conversations`,
  );
  console.log("ai_conversations:", rows[0]);
} finally {
  await client.end();
}
