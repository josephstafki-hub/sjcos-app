// Throwaway migration runner for the lead first-response feature: the
// lead_first_responses table (one AI-drafted same-day reply per inbound lead).
// Mirrors the CREATE in db/schema.sql.
//
// Additive and idempotent — safe to re-run. No data is deleted.
//
//   node db/apply-lead-first-response.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS lead_first_responses (
     id          bigserial PRIMARY KEY,
     lead_id     uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
     branch      text NOT NULL DEFAULT 'human_review'
                   CHECK (branch IN ('rough_estimate','missing_info','discovery_call','human_review')),
     status      text NOT NULL DEFAULT 'drafting'
                   CHECK (status IN ('drafting','pending','sent','dismissed','human_review','skipped','failed')),
     subject     text NOT NULL DEFAULT '',
     body        text NOT NULL DEFAULT '',
     missing     jsonb NOT NULL DEFAULT '[]',
     signals     jsonb NOT NULL DEFAULT '{}',
     ai          jsonb,
     reason      text NOT NULL DEFAULT '',
     auto_sent   boolean NOT NULL DEFAULT false,
     sent_at     timestamptz,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_lead_first_responses_status ON lead_first_responses(status, updated_at)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log(`ok: ${sql.split("\n")[0].trim()}`);
  }
} finally {
  await client.end();
}
console.log("lead first-response migration applied.");
