// Migration runner for STAFF USERS — internal team logins with per-area access.
//
// Adds the 'staff' role and a users.permissions text[] column holding the
// areas a staff account may open (catalog: lib/permissions.ts). Owner rows are
// untouched — owner is implicitly every area. 'money' is the fence for all
// financial surfaces.
//
// Idempotent — safe to re-run.
//
//   node db/apply-staff-users.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}'`,
  // The inline CHECK from CREATE TABLE got an auto name; find and replace it.
  `DO $$
   DECLARE c text;
   BEGIN
     SELECT conname INTO c FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%role%'
        AND pg_get_constraintdef(oid) NOT LIKE '%''staff''%';
     IF c IS NOT NULL THEN
       EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c);
     END IF;
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%''staff''%'
     ) THEN
       ALTER TABLE users ADD CONSTRAINT users_role_check
         CHECK (role IN ('owner','staff','sub','client'));
     END IF;
   END $$`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) await client.query(sql);
  const { rows } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'c'`,
  );
  console.log("users constraints:", rows.map((r) => r.def).join(" | "));
  console.log("apply-staff-users: done");
} finally {
  await client.end();
}
