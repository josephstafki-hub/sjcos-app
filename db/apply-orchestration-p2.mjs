// Migration: allow 'auto' conversations (orchestration phase 2). An 'auto'
// conversation has no pinned model — the router in lib/orchestrator/router.ts
// picks one per message and the dev_agent_runs row records who actually ran.
//
// The agent CHECK on ai_conversations was created inline, so its name is
// whatever Postgres generated — look it up rather than hardcoding.
//
// Idempotent — safe to re-run. Run on the server:
//
//   node db/apply-orchestration-p2.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'ai_conversations'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%agent%'`,
  );
  for (const r of rows) {
    await client.query(`ALTER TABLE ai_conversations DROP CONSTRAINT "${r.conname}"`);
    console.log("dropped:", r.conname);
  }
  await client.query(
    `ALTER TABLE ai_conversations
       ADD CONSTRAINT ai_conversations_agent_check
       CHECK (agent IN ('claude','qwen','hermes','auto'))`,
  );
  console.log("ok: agent CHECK now includes 'auto'");
} finally {
  await client.end();
}
