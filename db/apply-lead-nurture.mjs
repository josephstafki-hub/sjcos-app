// Throwaway migration runner for W4-L (lead nurture via the drip scheme):
// scope a drip sequence to one audience group. NULL group_id = whole list,
// which is exactly the pre-W4-L behaviour, so existing sequences are untouched.
//
// Additive and idempotent — safe to re-run. No data is deleted.
//
//   node db/apply-lead-nurture.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE newsletter_sequences ADD COLUMN IF NOT EXISTS group_id bigint
     REFERENCES newsletter_groups(id) ON DELETE SET NULL`,
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
console.log("W4-L migration applied.");
