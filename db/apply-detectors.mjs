// Migration runner for the W1 detector layer: the detector_state dedup table
// (one row per condition a deterministic detector has seen — see
// lib/detectors.ts) and work_items.enriched_at (stamped by the enrich_work_item
// MCP tool when Hermes rewrites a detector item's factual body).
//
// Idempotent — safe to re-run.
//
//   node db/apply-detectors.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS detector_state (
     dedup_key    text PRIMARY KEY,
     detector_key text NOT NULL,
     work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
     first_seen   timestamptz NOT NULL DEFAULT now(),
     last_seen    timestamptz NOT NULL DEFAULT now(),
     resolved_at  timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS idx_detector_state_open
     ON detector_state(detector_key) WHERE resolved_at IS NULL`,
  `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS enriched_at timestamptz`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\ndetector-layer migration complete.");
} finally {
  await client.end();
}
