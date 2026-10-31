#!/usr/bin/env node
// Static scan behind deploy/db-roles.manifest.json: which tables can each
// narrow database login's code reach, and how?
//
//   node scripts/db-roles-scan.mjs                 # per-role table → ops report
//   node scripts/db-roles-scan.mjs --diff          # only what the manifest lacks (a table
//                                                  # with a "note" is withheld on purpose)
//   node scripts/db-roles-scan.mjs --json          # machine-readable
//   node scripts/db-roles-scan.mjs --why <table>   # which files touch it, per role
//
// It walks the import graph from each role's entry points (static imports,
// literal dynamic import()/importApp() calls, "@/..." aliases) and pulls the
// table names out of every SQL string in the reachable files: INSERT INTO /
// UPDATE … SET / DELETE FROM / ON CONFLICT … DO UPDATE / SELECT … FOR UPDATE
// (row locks need UPDATE privilege) / FROM / JOIN. Only names of real tables
// count (the list comes from db/schema.sql + db/migrations/*.sql).
//
// It over-reports on purpose (a module reachable from the MCP server may only
// run from the web app); the manifest is the curated answer and
// tests/db-roles-paths-db.test.mjs is the runtime proof. Use this to find what
// a new tool or worker needs, then decide.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Entry points per narrow login. Kept in sync with the wiring described in
// deploy/db-roles.md: whatever process connects with that login.
// `aliases: false` = the process registers no module hooks, so "@/…" imports
// (and every module that has one) are unreachable there.
export const ROLE_OPTIONS = { sjcos_agent: { aliases: false }, sjcos_worker: { aliases: true } };

export const ENTRY_POINTS = {
  sjcos_agent: [
    "mcp/sjcos-mcp.mjs",
    "mcp/interact-mcp.mjs",
    "scripts/run-business-agent.mjs",
  ],
  sjcos_worker: ["scripts/sjcos-worker.mjs", "lib/worker/telnyx-processor.ts", "lib/worker/square-processor.ts", "lib/worker/esign-processor.ts", "lib/runbook-engine.ts"],
};

/** Every table created by the schema baseline + migration ledger. */
export function knownTables() {
  const files = [path.join(REPO, "db", "schema.sql")];
  const migDir = path.join(REPO, "db", "migrations");
  for (const f of readdirSync(migDir).sort()) if (f.endsWith(".sql")) files.push(path.join(migDir, f));
  const out = new Set();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) out.add(m[1].toLowerCase());
  }
  return out;
}

const EXT = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.mjs", "/index.js"];

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(REPO, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(from), spec);
  else if (/^(lib|mcp|scripts|app|components)\//.test(spec)) base = path.join(REPO, spec);
  else return null; // a package
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const IMPORT_RES = [
  /\bimport\s+(?:type\s+)?[^"'`;]*?\bfrom\s+["']([^"']+)["']/g,
  /\bexport\s+[^"'`;]*?\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
  /\bimportApp\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
  /\bimport\(\s*path\.join\([^)]*?["'`]([^"'`$]+\.(?:m?js|ts))["'`]\s*\)/g,
];

/** Files reachable from the entry points. Type-only imports are followed too
 *  (harmless: they carry no SQL). */
export function reachable(entries, { aliases = true } = {}) {
  const seen = new Set();
  const stack = entries.map((e) => path.join(REPO, e)).filter((p) => existsSync(p));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    // Without lib/worker/node-hooks.mjs a plain node process cannot resolve
    // "@/…": a module importing one never loads there, so its SQL never runs.
    if (!aliases && /from\s+["']@\//.test(text) && !entries.some((e) => f.endsWith(e))) {
      seen.delete(f);
      continue;
    }
    for (const re of IMPORT_RES) {
      for (const m of text.matchAll(re)) {
        if (/^import\s+type\b/.test(m[0])) continue;
        if (!aliases && m[1].startsWith("@/")) continue;
        const r = resolveSpec(f, m[1]);
        if (r && !seen.has(r)) stack.push(r);
      }
    }
  }
  return [...seen];
}

/** SQL-looking string literals in a source file (backtick, double, single). */
function sqlStrings(text) {
  const out = [];
  const re = /`((?:\\[\s\S]|[^`\\])*)`|"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'/g;
  for (const m of text.matchAll(re)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (/\b(select|insert|update|delete|from)\b/i.test(s)) out.push(s.replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

/** table → Set(ops) for one SQL string. */
export function tablesInSql(sql, tables) {
  const hits = new Map();
  const add = (t, op) => {
    t = t.toLowerCase().replace(/^public\./, "");
    if (!tables.has(t)) return;
    if (!hits.has(t)) hits.set(t, new Set());
    hits.get(t).add(op);
  };
  const ident = `(?:public\\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?`;
  for (const m of sql.matchAll(new RegExp(`\\binsert\\s+into\\s+${ident}`, "gi"))) {
    add(m[1], "INSERT");
    if (/\bon\s+conflict\b[\s\S]*?\bdo\s+update\b/i.test(sql.slice(m.index))) add(m[1], "UPDATE");
  }
  for (const m of sql.matchAll(new RegExp(`\\bupdate\\s+(?:only\\s+)?${ident}(?:\\s+(?:as\\s+)?[a-z_][a-z0-9_]*)?\\s+set\\b`, "gi"))) add(m[1], "UPDATE");
  for (const m of sql.matchAll(new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?${ident}`, "gi"))) add(m[1], "DELETE");
  for (const m of sql.matchAll(new RegExp(`\\btruncate\\s+(?:table\\s+)?${ident}`, "gi"))) add(m[1], "TRUNCATE");
  const lock = /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i.test(sql);
  for (const m of sql.matchAll(new RegExp(`\\b(?:from|join|using)\\s+(?:only\\s+)?${ident}`, "gi"))) {
    add(m[1], "SELECT");
    if (lock) add(m[1], "UPDATE");
  }
  return hits;
}

/** role → table → { ops:Set, files:Set } */
export function scan(entryPoints = ENTRY_POINTS) {
  const tables = knownTables();
  const out = {};
  for (const [role, entries] of Object.entries(entryPoints)) {
    const acc = new Map();
    for (const f of reachable(entries, ROLE_OPTIONS[role])) {
      const rel = path.relative(REPO, f);
      for (const s of sqlStrings(readFileSync(f, "utf8"))) {
        for (const [t, ops] of tablesInSql(s, tables)) {
          if (!acc.has(t)) acc.set(t, { ops: new Set(), files: new Set() });
          const e = acc.get(t);
          for (const o of ops) e.ops.add(o);
          e.files.add(rel);
        }
      }
    }
    out[role] = acc;
  }
  return out;
}

function loadManifest() {
  return JSON.parse(readFileSync(path.join(REPO, "deploy", "db-roles.manifest.json"), "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const result = scan();
  const why = argv.includes("--why") ? argv[argv.indexOf("--why") + 1] : null;
  if (why) {
    for (const [role, acc] of Object.entries(result)) {
      const e = acc.get(why);
      console.log(`${role}: ${e ? [...e.ops].join(",") : "-"}`);
      if (e) for (const f of e.files) console.log(`   ${f}`);
    }
    process.exit(0);
  }
  if (argv.includes("--json")) {
    const j = {};
    for (const [role, acc] of Object.entries(result)) {
      j[role] = Object.fromEntries([...acc].sort().map(([t, e]) => [t, [...e.ops].sort()]));
    }
    console.log(JSON.stringify(j, null, 2));
    process.exit(0);
  }
  const manifest = argv.includes("--diff") ? loadManifest() : null;
  for (const [role, acc] of Object.entries(result)) {
    console.log(`\n## ${role} (${acc.size} tables)`);
    for (const [t, e] of [...acc].sort()) {
      let ops = [...e.ops].filter((o) => o !== "SELECT");
      if (manifest) {
        const have = new Set(manifest.tables[t]?.[role] ?? []);
        ops = [...e.ops].filter((o) => !have.has(o));
        if (!ops.length) continue;
      }
      if (!manifest && !ops.length) continue;
      const withheld = manifest?.tables[t]?.note ? `   ← withheld on purpose: ${manifest.tables[t].note}` : "";
      console.log(`  ${t.padEnd(32)} ${ops.join(",")}${withheld}`);
    }
  }
}
