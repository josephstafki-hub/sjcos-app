// Migration: thread continuity for 'auto' conversations (orchestration
// phase 5). Two additive columns on ai_messages:
//
//   agent        — who authored an assistant message ('claude'|'qwen'|'hermes',
//                  'concierge' for the voice ack). The router uses the last
//                  answering agent to keep follow-ups on the same model, and
//                  each agent is told the turns it hasn't seen (Hermes' gateway
//                  session and Claude's CLI session only hold their own turns).
//   attachments  — [{name,path}] on a user message, so a file uploaded on turn
//                  1 is still readable by whoever answers turn 3.
//
// Backfills `agent` for existing rows from the run that produced them (auto
// threads) or the conversation's pinned agent.
//
// Idempotent — safe to re-run. Run on the server:
//
//   node db/apply-orchestration-p5.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS agent text`,
  `ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS attachments jsonb`,
  // Backfill: an assistant message whose body equals a run's answer in the
  // same thread was written by that run's agent.
  `UPDATE ai_messages m SET agent = r.agent
     FROM dev_agent_runs r
    WHERE m.agent IS NULL AND m.role = 'assistant'
      AND r.conversation_id = m.conversation_id AND r.answer = m.body`,
  // Pinned threads: every assistant message is the pinned agent's.
  `UPDATE ai_messages m SET agent = c.agent
     FROM ai_conversations c
    WHERE m.agent IS NULL AND m.role = 'assistant'
      AND c.id = m.conversation_id AND c.agent <> 'auto'`,
  `UPDATE ai_messages SET agent = 'concierge'
    WHERE agent IS NULL AND role = 'assistant' AND body LIKE '🗣 %'`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    const r = await client.query(sql);
    console.log("ok:", sql.slice(0, 60).replace(/\s+/g, " "), "…", r.rowCount ?? "");
  }
} finally {
  await client.end();
}
