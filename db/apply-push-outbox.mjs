// Migration runner for the W3 owner-push layer: the push_outbox parking table
// (pushes held through quiet hours / the hourly throttle until the push-drain
// cron transmits them — see lib/notify-owner.ts). The reminder_log table the
// collapse keys use already exists (Phase-1 scheduler).
//
// Idempotent — safe to re-run.
//
//   node db/apply-push-outbox.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS push_outbox (
     id         bigserial PRIMARY KEY,
     kind       text NOT NULL CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed')),
     title      text NOT NULL,
     body       text,
     href       text,
     created_at timestamptz NOT NULL DEFAULT now(),
     send_after timestamptz NOT NULL DEFAULT now(),
     sent_at    timestamptz
   )`,
  // Re-assert the kind list on an existing table (adds approval_needed; keeps
  // sms_inbound, which was added to the live constraint by the SMS seam).
  `ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check`,
  `ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
     CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed'))`,
  `CREATE INDEX IF NOT EXISTS idx_push_outbox_due
     ON push_outbox(send_after) WHERE sent_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_push_outbox_sent
     ON push_outbox(sent_at) WHERE sent_at IS NOT NULL`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\npush-outbox migration complete.");
} finally {
  await client.end();
}
