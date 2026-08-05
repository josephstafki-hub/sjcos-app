// Migration: Qwen pending writes (orchestration phase 3). Qwen has no tools —
// it proposes OS changes in a ```sjcos-proposal fence; each lands here as a
// row held 'proposed' until Claude reviews it. Approved rows execute through
// the app's own whitelisted executors (lib/orchestrator/execute.ts); nothing
// in this table grants the model any capability beyond selecting among them.
//
// Idempotent — safe to re-run. Run on the server:
//
//   node db/apply-orchestration-p3.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agent_pending_actions (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     run_id          uuid NOT NULL REFERENCES dev_agent_runs(id) ON DELETE CASCADE,
     conversation_id uuid REFERENCES ai_conversations(id) ON DELETE CASCADE,
     kind            text NOT NULL,
     payload         jsonb NOT NULL DEFAULT '{}',
     entity_kind     text NOT NULL DEFAULT '',
     entity_id       text,
     status          text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','reviewing','approved','executed','failed','rejected','escalated','cancelled')),
     review_note     text,
     review_cost_usd numeric,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_pending_run ON agent_pending_actions (run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_pending_status ON agent_pending_actions (status, created_at DESC)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.slice(0, 60).replace(/\s+/g, " "), "…");
  }
} finally {
  await client.end();
}
