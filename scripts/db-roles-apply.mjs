#!/usr/bin/env node
// Apply (or check) the narrow logins' table grants from
// deploy/db-roles.manifest.json, as the owner login — no sudo (deploy/db-roles.md).
//
//   node scripts/db-roles-apply.mjs           # apply: wipe + re-grant per the manifest, one transaction
//   node scripts/db-roles-apply.mjs --check   # read-only: print what differs from the manifest
//
// Why it exists: migration 0060 grants only to logins that already exist. If a
// normal deploy ran it before Joe's one-time bootstrap created the logins, its
// grants were skipped; run this once after the bootstrap. Running it again is
// harmless. tests/db-roles-manifest-db.test.mjs keeps the manifest equal to
// the migrations, so this lands on exactly what they would have granted.
//
// Database: DATABASE_URL from the environment, else ~/sjcos-app/.env.local
// (SJCOS_ENV to name another file). Must be the owner login (sjcos).

import pg from "pg";
import { resolveDatabaseUrl } from "../lib/db-login.mjs";
import { grantLines, loadManifest, NARROW_ROLES } from "./db-roles-sql.mjs";

const check = process.argv.includes("--check");
const manifest = loadManifest();
const { url } = resolveDatabaseUrl("owner");
const client = new pg.Client({ connectionString: url });
await client.connect();

function parsePriv(p) {
  const m = /^(\w+)(?:\(([^)]*)\))?$/.exec(p);
  return { priv: m[1], cols: m[2] ? m[2].split(",").map((c) => c.trim()) : null };
}

try {
  const [{ me }] = (await client.query(`SELECT current_user AS me`)).rows;
  const roles = (await client.query(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [NARROW_ROLES])).rows.map((r) => r.rolname);
  const missing = NARROW_ROLES.filter((r) => !roles.includes(r));
  if (missing.length) {
    console.error(`missing logins: ${missing.join(", ")} — run the bootstrap first: sudo -u postgres psql -d sjcos -v ON_ERROR_STOP=1 -f deploy/db-roles-bootstrap.sql`);
    process.exit(2);
  }
  const tables = (
    await client.query(`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')`)
  ).rows;
  const unlisted = tables.filter((t) => !manifest.tables[t.relname]).map((t) => t.relname);
  const notMine = tables.filter((t) => t.owner !== me).map((t) => `${t.relname} (owner ${t.owner})`);
  if (unlisted.length) console.log(`not in the manifest (no grants): ${unlisted.join(", ")}`);
  if (notMine.length) {
    console.error(`not owned by ${me} — grants on these would silently do nothing: ${notMine.join(", ")}`);
    process.exit(2);
  }
  const present = new Set(tables.map((t) => t.relname));

  if (!check) {
    await client.query("BEGIN");
    for (const r of NARROW_ROLES) {
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`);
    }
    for (const line of grantLines(manifest, Object.keys(manifest.tables).filter((t) => present.has(t)))) await client.query(line);
    await client.query("COMMIT");
    console.log(`applied deploy/db-roles.manifest.json to ${present.size} tables as ${me}`);
  }

  // What the database grants now vs. the manifest.
  let diffs = 0;
  for (const [t, entry] of Object.entries(manifest.tables)) {
    if (!present.has(t)) continue;
    for (const role of NARROW_ROLES) {
      const want = new Set();
      for (const p of entry[role] ?? []) {
        const { priv, cols } = parsePriv(p);
        if (cols) for (const c of cols) want.add(`${priv}(${c})`);
        else want.add(priv);
      }
      const have = new Set();
      const { rows: tp } = await client.query(
        `SELECT a.privilege_type AS p FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE c.oid = $1::regclass AND r.rolname = $2`,
        [`public.${t}`, role],
      );
      for (const { p } of tp) have.add(p);
      const { rows: cp } = await client.query(
        `SELECT a.privilege_type AS p, att.attname AS c FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE att.attrelid = $1::regclass AND r.rolname = $2`,
        [`public.${t}`, role],
      );
      for (const { p, c } of cp) have.add(`${p}(${c})`);
      const extra = [...have].filter((x) => !want.has(x));
      const lacking = [...want].filter((x) => !have.has(x));
      if (extra.length || lacking.length) {
        diffs++;
        console.log(`${t} / ${role}: ${lacking.length ? `missing ${lacking.join(", ")}` : ""}${lacking.length && extra.length ? "; " : ""}${extra.length ? `extra ${extra.join(", ")}` : ""}`);
      }
    }
  }
  const { rows: probe } = await client.query(
    `SELECT has_table_privilege('sjcos_agent', 'public.users', 'SELECT') AS agent_reads_users,
            has_column_privilege('sjcos_agent', 'public.users', 'password_hash', 'SELECT') AS agent_reads_passwords,
            has_table_privilege('sjcos_agent', 'public.policies', 'UPDATE') AS agent_writes_policies,
            has_table_privilege('sjcos_agent', 'public.work_items', 'INSERT') AS agent_files_todos,
            has_table_privilege('sjcos_worker', 'public.source_events', 'UPDATE') AS worker_processes_events`,
  );
  console.log(JSON.stringify(probe[0]));
  console.log(diffs ? `${diffs} table/login pairs differ from the manifest` : "grants match deploy/db-roles.manifest.json");
  process.exitCode = diffs ? 1 : 0;
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
