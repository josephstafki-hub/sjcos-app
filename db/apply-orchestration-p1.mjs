// Migration: run effects (orchestration phase 1) — which entities an agent
// run actually touched, plus a cache slot for the spoken (TTS) form of a
// run's answer.
//
//   run_effects rows come from three feeds:
//     'app'             — actions the app executed itself (exact)
//     'hermes-reported' — a ```sjcos-effects fence Hermes appended (exact)
//     'hermes-inferred' — app_change_log (source='mcp') rows correlated to the
//                         run's time window (table-level only)
//
// Idempotent — safe to re-run. Run on the server:
//
//   node db/apply-orchestration-p1.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS run_effects (
     id          bigserial PRIMARY KEY,
     run_id      uuid NOT NULL REFERENCES dev_agent_runs(id) ON DELETE CASCADE,
     entity_kind text NOT NULL,
     entity_id   text,
     action      text NOT NULL DEFAULT 'touched',
     source      text NOT NULL DEFAULT 'app'
                 CHECK (source IN ('app','hermes-reported','hermes-inferred','claude')),
     detail      jsonb NOT NULL DEFAULT '{}',
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_run_effects_run ON run_effects (run_id)`,
  `ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS spoken_answer text`,
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
