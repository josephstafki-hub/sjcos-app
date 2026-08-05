// Migration: the Claude↔Hermes ladder (orchestration phase 4). A task groups
// the rounds of one piece of work (Hermes attempt → Claude review → retry …
// → possible Claude takeover); events are the append-only trail behind the
// "Hermes retrying (round 2)" progress line. dev_agent_runs learns which task
// a run belongs to and whether a Claude run gets the sjcos MCP tools
// (takeover only — the token tax is acceptable on the rare last rung).
//
// Idempotent — safe to re-run. Run on the server:
//
//   node db/apply-orchestration-p4.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS orchestration_tasks (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
     task_prompt     text NOT NULL,
     status          text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','done','error','cancelled')),
     stage           text NOT NULL DEFAULT 'hermes',
     round           int  NOT NULL DEFAULT 0,
     max_rounds      int  NOT NULL DEFAULT 3,
     final_run_id    uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS orchestration_events (
     id         bigserial PRIMARY KEY,
     task_id    uuid NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
     actor      text NOT NULL,
     kind       text NOT NULL,
     run_id     uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL,
     note       text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_orch_events_task ON orchestration_events (task_id, id)`,
  `ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS orchestration_task_id uuid
     REFERENCES orchestration_tasks(id) ON DELETE SET NULL`,
  `ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS with_mcp boolean NOT NULL DEFAULT false`,
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
