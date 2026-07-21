// Throwaway migration runner for the P7-N newsletter upgrade (rich content,
// design settings, public image assets, unsubscribe tokens, drip sequences).
//
// Every statement is additive and idempotent — safe to re-run. The one
// DROP is the outbox kind CHECK constraint, immediately re-added with 'drip'
// included. No data is deleted.
//
//   node db/apply-newsletter-p7n.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE newsletter_recipients ADD COLUMN IF NOT EXISTS unsub_token text
     NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_recipients_unsub ON newsletter_recipients(unsub_token)`,

  `ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'`,

  `CREATE TABLE IF NOT EXISTS newsletter_assets (
     id          bigserial PRIMARY KEY,
     file_id     text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
     token       text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
     alt         text NOT NULL DEFAULT '',
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_nl_assets_file ON newsletter_assets(file_id)`,

  `CREATE TABLE IF NOT EXISTS newsletter_sequences (
     id          bigserial PRIMARY KEY,
     name        text NOT NULL DEFAULT 'Welcome series',
     active      boolean NOT NULL DEFAULT false,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS newsletter_sequence_steps (
     id            bigserial PRIMARY KEY,
     sequence_id   bigint NOT NULL REFERENCES newsletter_sequences(id) ON DELETE CASCADE,
     newsletter_id bigint NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
     delay_days    integer NOT NULL DEFAULT 0 CHECK (delay_days >= 0 AND delay_days <= 3650),
     position      integer NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_nl_steps_seq ON newsletter_sequence_steps(sequence_id, delay_days, position)`,
  `CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
     id            bigserial PRIMARY KEY,
     recipient_id  bigint NOT NULL REFERENCES newsletter_recipients(id) ON DELETE CASCADE,
     sequence_id   bigint NOT NULL REFERENCES newsletter_sequences(id) ON DELETE CASCADE,
     subscribed_at timestamptz NOT NULL DEFAULT now(),
     sent_steps    integer NOT NULL DEFAULT 0,
     status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
     last_sent_at  timestamptz,
     UNIQUE (recipient_id, sequence_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_nl_subs_due ON newsletter_subscriptions(sequence_id, subscribed_at) WHERE status = 'active'`,

  `ALTER TABLE newsletter_outbox ADD COLUMN IF NOT EXISTS body_html text`,
  `ALTER TABLE newsletter_outbox DROP CONSTRAINT IF EXISTS newsletter_outbox_kind_check`,
  `ALTER TABLE newsletter_outbox ADD CONSTRAINT newsletter_outbox_kind_check
     CHECK (kind IN ('issue','greeting','drip'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_outbox_drip ON newsletter_outbox(newsletter_id, email) WHERE kind = 'drip'`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.split("\n")[0].trim().slice(0, 78));
  }
  await client.query("COMMIT");
  console.log("\nP7-N newsletter schema applied.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("\nRolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
