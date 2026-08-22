// Portal links stop expiring.
//
// The app used to stamp a 30-day expires_at on every client and sub portal
// invite. It no longer sets one at all (lib/client-invites.ts, lib/sub-invites.ts)
// — the emailed link is the client's or sub's only credential, and a clock on it
// only ever produced the same support call: "the link you sent me doesn't work."
// Killing a link is now always a deliberate act — Revoke / Dismiss
// (status='dismissed') or users.active = false — never the passage of time.
//
// This does two things:
//   1. Makes expires_at nullable on both invite tables. NULL = never expires.
//   2. Clears the expiry on every link that was not deliberately revoked,
//      INCLUDING ones that already lapsed. That is the point of the change:
//      links already sitting in inboxes start working again. Rows with
//      status='dismissed' are left alone — somebody killed those on purpose.
//
// Idempotent — safe to re-run.
//
//   node db/apply-portal-link-window.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE client_portal_invites ALTER COLUMN expires_at DROP NOT NULL`,
  `ALTER TABLE sub_portal_invites ALTER COLUMN expires_at DROP NOT NULL`,
  `UPDATE client_portal_invites SET expires_at = NULL
    WHERE status <> 'dismissed' AND expires_at IS NOT NULL`,
  `UPDATE sub_portal_invites SET expires_at = NULL
    WHERE status <> 'dismissed' AND expires_at IS NOT NULL`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    const res = await client.query(sql);
    const n = res.rowCount === null ? "" : ` (${res.rowCount} rows)`;
    console.log(`ok${n}:`, sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nportal links no longer expire.");
} finally {
  await client.end();
}
