// Migration: client activity ledger + lead-stage file carry-over backfill.
//
// 1. client_activity — one row per thing a client did in their portal (visit,
//    upload, message, approvals, signatures, …). Read by the owner-side
//    "Client portal" tab on leads and projects. Additive, idempotent.
// 2. BACKFILL: files uploaded during the lead stage never gained the project
//    key when the lead converted (lib/actions/leads.ts now does this on
//    conversion). Re-key every such file onto its project so the project's
//    Files tab shows them again, and re-point a client's own uploads
//    (files.client_slug 'lead:<slug>' → project slug) so the client sees them
//    in the portal too. Idempotent — only touches rows still missing the key.
//
//   node db/apply-client-activity.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS client_activity (
     id           bigserial PRIMARY KEY,
     lead_id      uuid REFERENCES leads(id) ON DELETE CASCADE,
     project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
     kind         text NOT NULL,
     summary      text NOT NULL,
     detail       text,
     entity_kind  text,
     entity_id    text,
     actor_name   text NOT NULL DEFAULT '',
     href         text,
     created_at   timestamptz NOT NULL DEFAULT now(),
     CHECK ((lead_id IS NULL) <> (project_id IS NULL))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_client_activity_project ON client_activity(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_client_activity_lead    ON client_activity(lead_id, created_at DESC)`,

  // Backfill: lead-stage files → converted project.
  `UPDATE files f
      SET project_key = p.slug,
          client_slug = CASE WHEN f.client_slug = 'lead:' || l.slug THEN p.slug ELSE f.client_slug END
     FROM leads l
     JOIN projects p ON p.lead_id = l.id
    WHERE f.lead_slug = l.slug
      AND (f.project_key IS NULL OR f.project_key = '')`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    const res = await client.query(sql);
    const n = typeof res.rowCount === "number" && sql.trimStart().startsWith("UPDATE") ? ` (${res.rowCount} rows)` : "";
    console.log("ok:", sql.slice(0, 72).replace(/\s+/g, " "), "…" + n);
  }
  console.log("\nclient-activity migration applied.");
} finally {
  await client.end();
}
