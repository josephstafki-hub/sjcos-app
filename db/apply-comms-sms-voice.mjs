// Migration runner for two-way SMS + voice on Telnyx (SJCOS_Comms_Build_Prompt,
// 2026-09-02). Extends the existing messaging model instead of inventing a
// parallel one:
//
//   sms_threads     + opt-out state (STOP/START honoured locally), last in/out
//                     stamps, the business number the thread lives on (one
//                     number today, designed for more), 'vendor' link type.
//   sms_messages    + MMS media (re-stored files), delivery error detail, who
//                     sent it and under which owner grant.
//   calls           one row per phone call (inbound forward-to-cell, voicemail,
//                     click-to-call): legs, outcome, recording (a files row),
//                     transcript, AI notes, links to the record + work item.
//   call_events     the Call Control webhook trail per call (dedup on event id).
//   push_outbox     + 'voice_call' / 'comms' push kinds.
//
// Recordings and transcripts are client data: they live in Postgres / uploads
// on Joe's box, never in the repo. Mirrors db/schema.sql.
//
// Additive and idempotent — safe to re-run. No data is deleted.
//
//   node db/apply-comms-sms-voice.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

export const STATEMENTS = [
  // ── sms_threads ──────────────────────────────────────────────────────────
  `ALTER TABLE sms_threads DROP CONSTRAINT IF EXISTS sms_threads_link_type_check`,
  `ALTER TABLE sms_threads ADD CONSTRAINT sms_threads_link_type_check
     CHECK (link_type IN ('lead','sub','client','project','vendor'))`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS opted_out       boolean NOT NULL DEFAULT false`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS opted_out_at    timestamptz`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS opted_in_at     timestamptz`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz`,
  `ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS business_number text`,
  // ── sms_messages ─────────────────────────────────────────────────────────
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS media        jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS from_number  text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS to_number    text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS error_code   text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS error_detail text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS failure_kind text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS sent_by      text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS grant_id     uuid`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS keyword      text`,
  `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now()`,
  // ── calls ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS calls (
     id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     direction            text NOT NULL CHECK (direction IN ('inbound','outbound')),
     provider             text NOT NULL DEFAULT 'telnyx',
     call_session_id      text,
     counterparty_leg_id  text,
     owner_leg_id         text,
     counterparty_number  text NOT NULL,
     business_number      text NOT NULL,
     owner_number         text,
     contact_name         text,
     link_type            text CHECK (link_type IN ('lead','sub','client','project','vendor')),
     link_slug            text,
     lead_id              uuid REFERENCES leads(id)      ON DELETE SET NULL,
     project_id           uuid REFERENCES projects(id)   ON DELETE SET NULL,
     status               text NOT NULL DEFAULT 'ringing'
                            CHECK (status IN ('ringing','bridged','voicemail','completed','missed','no_answer','failed')),
     outcome              text CHECK (outcome IN ('answered','voicemail','missed','no_answer','failed')),
     bridged              boolean NOT NULL DEFAULT false,
     voicemail            boolean NOT NULL DEFAULT false,
     recording            boolean NOT NULL DEFAULT false,
     ended                boolean NOT NULL DEFAULT false,
     started_at           timestamptz NOT NULL DEFAULT now(),
     answered_at          timestamptz,
     ended_at             timestamptz,
     duration_s           integer,
     hangup_cause         text,
     recording_status     text NOT NULL DEFAULT 'none'
                            CHECK (recording_status IN ('none','recording','saved','failed')),
     recording_id         text,
     recording_file_id    text REFERENCES files(id) ON DELETE SET NULL,
     recording_channels   text,
     recording_error      text,
     transcript           text,
     transcript_status    text NOT NULL DEFAULT 'none'
                            CHECK (transcript_status IN ('none','pending','done','failed')),
     transcript_engine    text,
     notes                jsonb,
     notes_text           text,
     notes_status         text NOT NULL DEFAULT 'none'
                            CHECK (notes_status IN ('none','pending','done','failed','skipped')),
     notes_error          text,
     notes_attempts       integer NOT NULL DEFAULT 0,
     knowledge_item_id    uuid,
     work_item_id         uuid REFERENCES work_items(id) ON DELETE SET NULL,
     grant_id             uuid,
     placed_by            text,
     error                text,
     created_at           timestamptz NOT NULL DEFAULT now(),
     updated_at           timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_calls_counterparty ON calls(counterparty_number)`,
  `CREATE INDEX IF NOT EXISTS idx_calls_open ON calls(ended) WHERE ended = false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_session ON calls(call_session_id) WHERE call_session_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS call_events (
     id           bigserial PRIMARY KEY,
     call_id      uuid REFERENCES calls(id) ON DELETE CASCADE,
     event_id     text UNIQUE,
     event_type   text NOT NULL,
     leg_id       text,
     note         text NOT NULL DEFAULT '',
     payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
     occurred_at  timestamptz,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_call_events_call ON call_events(call_id, id)`,
  // ── push kinds ───────────────────────────────────────────────────────────
  `ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check`,
  `ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
     CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed','voice_call','comms'))`,
];

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log(`ok: ${sql.replace(/\s+/g, " ").slice(0, 96)}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("\nComms (SMS + voice) migration complete.");
}
