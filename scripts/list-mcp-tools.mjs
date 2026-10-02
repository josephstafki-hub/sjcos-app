#!/usr/bin/env node
// Print the MCP tool names SJC OS registers — READ-ONLY, no database, no
// network. The list is the input for lib/measure/procedures.ts
// checkProcedures({ knownTools }) so a procedure naming a tool that does not
// exist is flagged.
//
//   node scripts/list-mcp-tools.mjs            # one name per line
//   node scripts/list-mcp-tools.mjs --json     # JSON array (paste into app_settings 'measure.known_tools')
//
// How: every mcp/*-tools.mjs module exports register<Area>Tools(server, deps);
// each is called with a stub server that only records names, and stub deps
// that never touch a database. Inline tools in mcp/sjcos-mcp.mjs (which
// connects to Postgres at import time, so it is NOT imported) are read from
// the source text: server.registerTool("name", …).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = path.join(__dirname, "..", "mcp");

const names = new Set();
const stubServer = {
  _registeredTools: {},
  registerTool(name) {
    names.add(name);
    this._registeredTools[name] = true;
  },
  tool(name) {
    names.add(name);
    this._registeredTools[name] = true;
  },
};
const refuse = async () => {
  throw new Error("list-mcp-tools: stub — no database access");
};
const stubDeps = new Proxy(
  { rows: refuse, json: (d) => d, pool: { connect: refuse, query: refuse }, appCall: refuse, grantsCall: refuse, runbooksCall: refuse, biddingCall: refuse, strippedDollarError: () => null, uploadDir: "/nonexistent", envValue: () => "", appUrl: "http://localhost" },
  { get: (t, k) => (k in t ? t[k] : refuse) },
);

const problems = [];
for (const file of readdirSync(MCP_DIR).filter((f) => /-tools\.mjs$/.test(f)).sort()) {
  const mod = await import(path.join(MCP_DIR, file));
  for (const [exportName, fn] of Object.entries(mod)) {
    if (!/^register\w+$/.test(exportName) || typeof fn !== "function") continue;
    try {
      fn(stubServer, stubDeps);
    } catch (e) {
      problems.push(`${file}#${exportName}: ${e.message}`);
    }
  }
}

// Inline registrations in the main server file (not imported: it opens a pool).
const main = readFileSync(path.join(MCP_DIR, "sjcos-mcp.mjs"), "utf8");
for (const m of main.matchAll(/server\.registerTool\(\s*["']([a-z0-9_]+)["']/g)) names.add(m[1]);

const list = [...names].sort();
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(list) + "\n");
else process.stdout.write(list.join("\n") + "\n");
if (problems.length) process.stderr.write(`warnings:\n  ${problems.join("\n  ")}\n`);
