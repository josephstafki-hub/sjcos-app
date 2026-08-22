// Migration runner for OWNER GRANTS — express permission for agents.
//
// Agents (Claude in the Ask window, Hermes, any MCP client) may not send
// client-/vendor-facing email on their own. A grant is the owner saying "for
// THIS action on THIS target, go ahead": it is created either by the owner
// (Ask-window "Express permission" checkbox, or /engine/permissions) or
// requested by an agent and approved by the owner. Every gated send consumes
// a grant and appends to its audit trail, so the proof of who allowed what
// lives in one place.
//
// Idempotent — safe to re-run.
//
//   node db/apply-owner-grants.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS owner_grants (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     status          text NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','approved','denied','revoked')),
     actions         text[] NOT NULL,
     target_kind     text,
     target_id       text,
     scope           jsonb NOT NULL DEFAULT '{}'::jsonb,
     reason          text NOT NULL DEFAULT '',
     requested_by    text NOT NULL DEFAULT 'agent',
     conversation_id uuid,
     run_id          uuid,
     max_uses        integer NOT NULL DEFAULT 1,
     uses            integer NOT NULL DEFAULT 0,
     expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
     decided_at      timestamptz,
     used_at         timestamptz,
     audit           jsonb NOT NULL DEFAULT '[]'::jsonb,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS owner_grants_status_idx ON owner_grants (status, created_at DESC)`,
  `ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS grant_id uuid`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nowner grants migration complete.");
} finally {
  await client.end();
}
