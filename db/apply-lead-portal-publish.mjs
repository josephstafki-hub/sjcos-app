// Migration: lead-stage client portal + per-item dashboard publishing.
//
// 1. client_portal_invites scopes to a project XOR a lead, so the dashboard can
//    open during the lead stage and carry over when the lead converts.
// 2. files.client_visible + document_drafts.client_visible — the owner decides,
//    per document/file (lead- or project-scoped), what the client dashboard
//    shows. Default false: nothing already uploaded becomes visible.
// 3. project_floorplans.published_at + project_mood_boards.published_at — plans
//    and mood boards now reach the portal only once explicitly published.
//    BACKFILL (one-time, see below): existing rows are marked published so
//    nothing a client can already see disappears when this deploys.
// 4. project_mood_feedback — per-board client feedback notes from the portal.
//
// Every DDL statement is additive and idempotent. The two backfill UPDATEs are
// meant to run ONCE at deploy time — re-running them later would re-publish
// anything the owner has since unpublished, so don't re-run this script after
// boards/plans have been curated.
//
//   node db/apply-lead-portal-publish.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // ── Lead-scoped portal invites ────────────────────────────────────────────
  `ALTER TABLE client_portal_invites ALTER COLUMN project_slug DROP NOT NULL`,
  `ALTER TABLE client_portal_invites ADD COLUMN IF NOT EXISTS lead_slug text REFERENCES leads(slug) ON DELETE CASCADE`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_client_invites_lead
     ON client_portal_invites(lead_slug) WHERE lead_slug IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_client_invites_lead
     ON client_portal_invites(lead_slug, status)`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_invites_scope_xor') THEN
       ALTER TABLE client_portal_invites ADD CONSTRAINT client_portal_invites_scope_xor
         CHECK ((project_slug IS NULL) <> (lead_slug IS NULL));
     END IF;
   END $$`,

  // ── Owner-controlled client visibility on documents + files ──────────────
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false`,
  `ALTER TABLE document_drafts ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false`,

  // ── Publish switches for floor plans + mood boards ────────────────────────
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS published_at timestamptz`,
  `ALTER TABLE project_mood_boards ADD COLUMN IF NOT EXISTS published_at timestamptz`,

  // One-time backfill: before this migration every plan version and mood board
  // was visible in the portal, so mark what exists as published. (Do NOT re-run
  // after the owner has started unpublishing things.)
  `UPDATE project_floorplans SET published_at = created_at WHERE published_at IS NULL`,
  `UPDATE project_mood_boards SET published_at = created_at WHERE published_at IS NULL`,

  // ── Per-board client feedback ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS project_mood_feedback (
     id           bigserial PRIMARY KEY,
     project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     room         text NOT NULL,
     author_name  text NOT NULL DEFAULT '',
     body         text NOT NULL,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mood_feedback_board
     ON project_mood_feedback(project_id, room, created_at)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.slice(0, 72).replace(/\s+/g, " "), "…");
  }
  console.log("\nlead-portal + dashboard-publish migration applied.");
} finally {
  await client.end();
}
