// Throwaway migration runner for bid follow-up emails (auto chase + thanks):
// per-package arm switch, the "working on it" invite state, and the
// claim-before-send ledger (see lib/bid-follow-ups.ts).
//
// Pre-existing packages are backfilled follow_ups = FALSE (the column is added
// with DEFAULT false, then the default flips to true) so arming the feature
// never retroactively chases packages sent before it existed — only packages
// created from now on chase by default.
//
// Additive and idempotent — safe to re-run. No data is deleted.
//
//   node db/apply-bid-follow-ups.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // Existing packages get false; new packages default true (two-step on purpose).
  `ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS follow_ups boolean NOT NULL DEFAULT false`,
  `ALTER TABLE bid_packages ALTER COLUMN follow_ups SET DEFAULT true`,
  `ALTER TABLE bid_invites ADD COLUMN IF NOT EXISTS acked_at timestamptz`,
  `ALTER TABLE bid_invites DROP CONSTRAINT IF EXISTS bid_invites_status_check`,
  `ALTER TABLE bid_invites ADD CONSTRAINT bid_invites_status_check
     CHECK (status IN ('draft','sent','viewed','working','submitted','declined','awarded','not_awarded'))`,
  `CREATE TABLE IF NOT EXISTS bid_invite_emails (
     id          bigserial PRIMARY KEY,
     invite_id   bigint NOT NULL REFERENCES bid_invites(id) ON DELETE CASCADE,
     kind        text NOT NULL CHECK (kind IN ('reminder_1','reminder_2','working_nudge','thanks')),
     status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
     subject     text NOT NULL DEFAULT '',
     body        text NOT NULL DEFAULT '',
     error       text,
     created_at  timestamptz NOT NULL DEFAULT now(),
     sent_at     timestamptz,
     UNIQUE (invite_id, kind)
   )`,
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
console.log("Bid follow-ups migration applied.");
