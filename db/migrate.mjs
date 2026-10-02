#!/usr/bin/env node
// Ordered, checksummed migration ledger (A00).
//
// db/schema.sql + the historical db/apply-*.mjs scripts are the BASELINE that
// every existing database already carries (they are idempotent and were run by
// hand, in order, on the live database through 2026-09-23). From here on, new
// schema changes are numbered files in db/migrations/NNNN_name.sql, applied in
// order exactly once, and recorded in schema_migrations with a sha256 of the
// file. A file whose checksum no longer matches its recorded row aborts the
// run — edit history by adding a new migration, never by rewriting an applied
// one. Each file runs inside its own transaction.
//
//   node db/migrate.mjs                # apply pending to DATABASE_URL (.env.local)
//   node db/migrate.mjs --status       # list applied / pending, verify checksums
//   node db/migrate.mjs --dry-run      # print what would run
//   DATABASE_URL=… node db/migrate.mjs # explicit target
//
// The test harness (tests/_harness/testdb.mjs) calls migrate({ url }) after
// loading schema.sql, so a fresh database and an upgraded production database
// end at the same ledger.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      return { id: Number(file.slice(0, 4)), name: file, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

function envDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const env = readFileSync(envFile, "utf8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error(`DATABASE_URL not found in ${envFile}`);
  return m[1].trim().replace(/^"|"$/g, "");
}

export async function migrate({ url, dryRun = false, status = false, quiet = false } = {}) {
  const target = url ?? envDatabaseUrl();
  const files = listMigrationFiles();
  const dupes = files.filter((f, i) => files.findIndex((g) => g.id === f.id) !== i);
  if (dupes.length) throw new Error(`duplicate migration numbers: ${dupes.map((d) => d.name).join(", ")}`);
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  const log = (...a) => (quiet ? undefined : console.log(...a));
  const out = { applied: [], pending: [], mismatched: [] };
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query(`SELECT id, name, checksum FROM schema_migrations ORDER BY id`);
    const applied = new Map(rows.map((r) => [r.id, r]));
    for (const f of files) {
      const row = applied.get(f.id);
      if (row) {
        if (row.checksum !== f.checksum) out.mismatched.push(f.name);
        else out.applied.push(f.name);
      } else out.pending.push(f.name);
    }
    if (out.mismatched.length) {
      throw new Error(`applied migration(s) changed on disk: ${out.mismatched.join(", ")} — add a new migration instead of editing an applied one`);
    }
    if (status || dryRun) {
      log(`applied: ${out.applied.length}\n  ${out.applied.join("\n  ") || "(none)"}`);
      log(`pending: ${out.pending.length}\n  ${out.pending.join("\n  ") || "(none)"}`);
      return out;
    }
    // Serialize concurrent migrators (two deploys, a test and a deploy…).
    await client.query(`SELECT pg_advisory_lock(7263054)`);
    for (const f of files) {
      if (applied.has(f.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(f.sql);
        await client.query(`INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)`, [f.id, f.name, f.checksum]);
        await client.query("COMMIT");
        log(`applied ${f.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${f.name} failed: ${err.message}`);
      }
    }
    await client.query(`SELECT pg_advisory_unlock(7263054)`);
    return out;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  migrate({ dryRun: args.has("--dry-run"), status: args.has("--status") })
    .then((r) => {
      if (!args.has("--dry-run") && !args.has("--status")) console.log(`migrations complete (${r.pending.length} applied this run).`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
