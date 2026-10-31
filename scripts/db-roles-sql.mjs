#!/usr/bin/env node
// Print the GRANT lines for deploy/db-roles.manifest.json entries, ready to
// paste into a migration (deploy/db-roles.md, "Adding a table").
//
//   node scripts/db-roles-sql.mjs new_table other_table   # lines for those tables
//   node scripts/db-roles-sql.mjs --all                   # every table (0060 used this)
//
// Each line calls sjcos_grant(role, privileges, table) from
// db/migrations/0060_db_roles.sql: it is a no-op with a NOTICE while the role
// does not exist (tests, fresh databases, before Joe's one-time bootstrap) and
// grants the table's own id sequence along with INSERT.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NARROW_ROLES = ["sjcos_agent", "sjcos_worker", "sjcos_readonly", "sjcos_backup"];

export function loadManifest() {
  return JSON.parse(readFileSync(path.join(REPO, "deploy", "db-roles.manifest.json"), "utf8"));
}

/** "SELECT(a,b)" → "SELECT (a, b)"; plain privileges pass through. */
function sqlPriv(p) {
  const m = /^(\w+)\(([^)]*)\)$/.exec(p);
  return m ? `${m[1]} (${m[2].split(",").map((c) => c.trim()).join(", ")})` : p;
}

export function grantLines(manifest, tables) {
  const out = [];
  for (const t of tables) {
    const entry = manifest.tables[t];
    if (!entry) throw new Error(`${t} is not in deploy/db-roles.manifest.json — add it there first`);
    for (const role of NARROW_ROLES) {
      const privs = entry[role];
      if (!privs?.length) continue;
      out.push(`SELECT sjcos_grant('${role}', '${privs.map(sqlPriv).join(", ")}', '${t}');`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = loadManifest();
  const argv = process.argv.slice(2);
  const tables = argv.includes("--all") ? Object.keys(manifest.tables).sort() : argv;
  if (!tables.length) {
    console.error("usage: node scripts/db-roles-sql.mjs <table> [table…] | --all");
    process.exit(2);
  }
  console.log(grantLines(manifest, tables).join("\n"));
}
