// Migration runner for the W5 learning layer. The agent_memories +
// agent_memory_source_refs tables already exist (dormant since the Open Brain
// phase) — this only adds the two draft-edit snapshot columns the capture
// hooks diff against (lib/agent-draft-diff.ts).
//
// Idempotent — safe to re-run.
//
//   node db/apply-agent-memory.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS agent_submitted_snapshot jsonb`,
  `ALTER TABLE document_drafts ADD COLUMN IF NOT EXISTS agent_submitted_snapshot jsonb`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nagent-memory migration complete.");
} finally {
  await client.end();
}
