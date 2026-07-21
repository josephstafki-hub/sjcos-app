// Migration: client portal invites — link-in access for homeowners.
//
// A client should never have to create an account to see their contract,
// selections, or schedule. The invite link carries an opaque bearer token that
// /client-portal/enter trades for the normal sjcos_session cookie, exactly as
// sub_portal_invites already does for subcontractors.
//
// The upgrade path is the difference from the sub flow: a client can CLAIM the
// portal by setting a password (users.portal_claimed_at). Once claimed, the
// bearer link stops working and they sign in like anyone else — so a forwarded
// or leaked email can't reopen a portal its owner has locked.
//
// Every statement is additive and idempotent — safe to re-run. Nothing is
// dropped and no data is deleted.
//
//   node db/apply-client-portal-invites.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // Marks the moment a client set a real password. Non-null ⇒ bearer links for
  // that account are refused; password login is the only way in from then on.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_claimed_at timestamptz`,

  `CREATE TABLE IF NOT EXISTS client_portal_invites (
     id          bigserial PRIMARY KEY,
     project_slug text NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
     to_email    text,                              -- client email at issue time
     to_name     text NOT NULL DEFAULT '',
     token       text UNIQUE NOT NULL,              -- opaque bearer token
     status      text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','dismissed')),
     expires_at  timestamptz NOT NULL,
     used_at     timestamptz,                       -- first successful entry (audit)
     created_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (project_slug)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_client_invites_project
     ON client_portal_invites(project_slug, status)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.slice(0, 72).replace(/\s+/g, " "), "…");
  }
  console.log("\nclient portal invites migration applied.");
} finally {
  await client.end();
}
