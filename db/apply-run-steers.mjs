// Migration runner for STEERING a live run from the AI panel (2026-10-17).
//
// Joe: "add the ability to send steer messages to session in the ai panel …
// make sure they work properly for each provider."
//
// While an agent is working, the panel's composer no longer waits: what Joe
// types goes INTO the running turn (lib/run-steers.ts has the per-provider
// delivery). The tables:
//
//   run_steers                   one row per steer. pending → delivered once
//                                the runtime took it (via = how: mid-turn,
//                                follow-up, restart, round). relay_run_id lets
//                                the Hermes ladder hand steers to a Claude
//                                takeover run without losing the row the
//                                panel is watching.
//   dev_agent_runs.steer_closed_at
//                                set when a run takes its LAST look at pending
//                                steers before settling. A steer is only
//                                accepted while it is NULL, under a row lock,
//                                so a steer is either delivered or refused
//                                (and the panel sends it as the next message)
//                                — never stranded on a finished run.
//   ai_messages.steer            the transcript line is a steer, not a fresh
//                                ask (rendered "↪ Steer").
//
// Additive and idempotent — safe to re-run, safe while the old build is still
// serving (it never reads these). Apply BEFORE deploying the build that reads
// ai_messages.steer. Mirrors db/schema.sql.
//
//   node db/apply-run-steers.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const STATEMENTS = [
  `ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS steer_closed_at timestamptz`,
  `ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS steer boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS run_steers (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     run_id          uuid NOT NULL REFERENCES dev_agent_runs(id) ON DELETE CASCADE,
     relay_run_id    uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL,
     conversation_id uuid REFERENCES ai_conversations(id) ON DELETE CASCADE,
     message_id      uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
     body            text NOT NULL,
     status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered')),
     via             text CHECK (via IN ('mid-turn','follow-up','restart','round')),
     created_at      timestamptz NOT NULL DEFAULT now(),
     delivered_at    timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS run_steers_run_idx ON run_steers (run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS run_steers_pending_idx ON run_steers (run_id) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS run_steers_relay_pending_idx ON run_steers (relay_run_id) WHERE status = 'pending' AND relay_run_id IS NOT NULL`,
];

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const env = readFileSync(envFile, "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
  if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Don't queue the live site behind us if a long run holds dev_agent_runs.
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log(`ok: ${sql.split("\n")[0].trim()}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("apply-run-steers: done");
}
