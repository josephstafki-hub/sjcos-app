// Migration runner for the bidding system (project Bidding tab + sub portal).
// A BID PACKAGE is a request for pricing on one category of work — it carries
// the plans/takeoffs to price and goes out to several subs at once. Each sub
// gets an INVITE (their own portal view of the packet, with an optional note
// written just for them), and answers with a SUBMISSION: a total, line items,
// exclusions, and any uploaded bid documents. Submissions line up side by side
// on the owner's compare view; awarding one closes the package.
//
// Every statement is additive and idempotent — safe to re-run.
//
//   node db/apply-bidding.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // ── The package: one bid request, usually one trade ("Framing", "HVAC").
  //    scope_notes is the cover message every invited sub sees; per-sub notes
  //    live on the invite. Status: draft (being assembled) → open (out to
  //    subs) → awarded / closed.
  `CREATE TABLE IF NOT EXISTS bid_packages (
     id           bigserial PRIMARY KEY,
     project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title        text NOT NULL,
     trade        text NOT NULL DEFAULT '',
     scope_notes  text NOT NULL DEFAULT '',
     due_date     date,
     status       text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','open','awarded','closed')),
     sent_at      timestamptz,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bid_packages_project
     ON bid_packages(project_id, trade, status)`,

  // ── The packet contents: plans, material takeoffs, specs. Rows point at the
  //    existing files table (uploads or generated PDFs); label lets "takeoff-v3
  //    -final.pdf" read as "Material takeoff" in the sub's portal.
  `CREATE TABLE IF NOT EXISTS bid_package_files (
     id          bigserial PRIMARY KEY,
     package_id  bigint NOT NULL REFERENCES bid_packages(id) ON DELETE CASCADE,
     file_id     text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
     label       text NOT NULL DEFAULT '',
     sort_order  integer NOT NULL DEFAULT 0,
     created_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (package_id, file_id)
   )`,

  // ── One row per invited sub. draft = picked but not yet published; sent =
  //    live in their portal; viewed / submitted / declined are the sub's side;
  //    awarded / not_awarded land when the owner picks a winner. message is the
  //    per-sub customization on top of the package scope_notes.
  `CREATE TABLE IF NOT EXISTS bid_invites (
     id            bigserial PRIMARY KEY,
     package_id    bigint NOT NULL REFERENCES bid_packages(id) ON DELETE CASCADE,
     sub_slug      text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
     message       text NOT NULL DEFAULT '',
     status        text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','viewed','submitted','declined','awarded','not_awarded')),
     sent_at       timestamptz,
     viewed_at     timestamptz,
     responded_at  timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now(),
     UNIQUE (package_id, sub_slug)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bid_invites_sub ON bid_invites(sub_slug, status)`,

  // ── The sub's answer. Money is CENTS (house rule for new tables — matches
  //    estimates / purchase_orders / sub_invoices). Re-submitting bumps
  //    revision; the compare view reads the latest one per invite.
  `CREATE TABLE IF NOT EXISTS bid_submissions (
     id            bigserial PRIMARY KEY,
     invite_id     bigint NOT NULL REFERENCES bid_invites(id) ON DELETE CASCADE,
     total         integer NOT NULL DEFAULT 0,
     notes         text NOT NULL DEFAULT '',
     exclusions    text NOT NULL DEFAULT '',
     lead_time     text NOT NULL DEFAULT '',
     revision      integer NOT NULL DEFAULT 1,
     submitted_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (invite_id, revision)
   )`,

  // ── Optional line-item breakdown — what makes bids comparable row by row
  //    instead of one opaque number. amount is CENTS.
  `CREATE TABLE IF NOT EXISTS bid_submission_lines (
     id             bigserial PRIMARY KEY,
     submission_id  bigint NOT NULL REFERENCES bid_submissions(id) ON DELETE CASCADE,
     description    text NOT NULL,
     amount         integer NOT NULL DEFAULT 0,
     sort_order     integer NOT NULL DEFAULT 0
   )`,

  // ── The sub's uploaded bid documents (their own PDF/spreadsheet).
  `CREATE TABLE IF NOT EXISTS bid_submission_files (
     id             bigserial PRIMARY KEY,
     submission_id  bigint NOT NULL REFERENCES bid_submissions(id) ON DELETE CASCADE,
     file_id        text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,

  // The winner FK is added after bid_invites exists. SET NULL so removing the
  // winning invite reopens the question instead of deleting the package.
  `ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS awarded_invite_id bigint`,
  `ALTER TABLE bid_packages DROP CONSTRAINT IF EXISTS bid_packages_awarded_invite_fkey`,
  `ALTER TABLE bid_packages ADD CONSTRAINT bid_packages_awarded_invite_fkey
     FOREIGN KEY (awarded_invite_id) REFERENCES bid_invites(id) ON DELETE SET NULL`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nbidding migration complete.");
} finally {
  await client.end();
}
