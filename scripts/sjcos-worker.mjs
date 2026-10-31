#!/usr/bin/env node
// SJC OS supervised worker (A03b) — the long-running systemd user service
// deploy/sjcos-worker.service (Restart=always). NOT a timer.
//
//   node scripts/sjcos-worker.mjs            # supervise until SIGTERM
//   node scripts/sjcos-worker.mjs --once     # one iteration, print result, exit
//   --url <pg url>       override the database (harness runs); otherwise
//                        DATABASE_URL_WORKER, else DATABASE_URL (lib/db-login.mjs)
//   --stop-file <path>   halt processing while the file exists (default
//                        ~/sjcos-backups/worker.stop)
//
// Each iteration (lib/worker/loop.ts): stop-file / lane pause check → sweeps
// (expired source-event + intent leases, stale decisions) → source events per
// provider (Telnyx today) → WS-approvals' intent dispatcher when lib/dispatch
// exposes one → lost-wakeup poll (runbook_wakeups). Heartbeats every 15s on
// the `workers` row; a newer instance fences this one out.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import pg from "pg";
import { importApp, loadEnvFile, REPO_ROOT } from "../lib/worker/load-app.mjs";
import { resolveDatabaseUrl } from "../lib/db-login.mjs";
import { runOnce, supervise, WORKER_NAME } from "../lib/worker/loop.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(a.slice(2), next);
    i++;
  } else args.set(a.slice(2), true);
}

loadEnvFile(process.env.SJCOS_ENV ?? path.join(REPO_ROOT, ".env.local"));
if (args.get("url")) {
  process.env.DATABASE_URL = args.get("url");
  process.env.DATABASE_URL_WORKER = args.get("url");
}
// The worker's own login (deploy/db-roles.md): DATABASE_URL_WORKER, falling
// back to DATABASE_URL until Joe adds that line. The app modules it imports
// below (lib/db.ts) read DATABASE_URL, so point that at the same login.
let login;
try {
  login = resolveDatabaseUrl("worker");
} catch {
  console.error("[worker] DATABASE_URL is not set (pass --url or SJCOS_ENV)");
  process.exit(2);
}
process.env.DATABASE_URL = login.url;

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);
log(`[worker] database login: ${login.fallback ? "DATABASE_URL (DATABASE_URL_WORKER not set yet)" : login.key}`);
const pool = new pg.Pool({ connectionString: login.url, max: 4 });
// Live-update signal for the user-visible writes the loop makes (expiring a
// stale decision card also clears its notification by trigger): log them to
// app_change_log like lib/db.ts query() does, so open tabs refresh. Its own
// bookkeeping (workers, source_events, action_intents) stays out — it runs
// every few seconds and would refresh every tab for nothing.
const LIVE_TABLES = new Set(["decisions", "decision_events"]);
const WRITE_SQL = /^\s*(insert\s+into|update|delete\s+from)\s+(?:only\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i;
const run = async (sql, params) => {
  const r = await pool.query(sql, params);
  const table = WRITE_SQL.exec(sql)?.[2]?.toLowerCase();
  if (table && LIVE_TABLES.has(table) && (r.rowCount ?? 1) > 0) {
    await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ($1, 'app')`, [table]).catch(() => {});
  }
  return r.rows;
};

function version() {
  const r = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  try {
    return `pkg:${JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version}`;
  } catch {
    return "unknown";
  }
}

/** Guarded optional pieces owned by other workstreams. */
async function optional(label, loader) {
  try {
    const v = await loader();
    if (v) log(`[worker] ${label}: wired`);
    else log(`[worker] ${label}: not present (skipped)`);
    return v ?? null;
  } catch (e) {
    log(`[worker] ${label}: unavailable (${(e?.message ?? String(e)).split("\n")[0].slice(0, 160)})`);
    return null;
  }
}

const processors = [];
const telnyx = await optional("telnyx processor", async () => (await importApp("lib/worker/telnyx-processor.ts")).telnyxProcessor);
if (telnyx) processors.push(telnyx);
const square = await optional("square processor", async () => (await importApp("lib/worker/square-processor.ts")).squareProcessor);
if (square) processors.push(square);
const esign = await optional("esign processor", async () => (await importApp("lib/worker/esign-processor.ts")).esignProcessor);
if (esign) processors.push(esign);

const dispatcher = await optional("intent dispatcher (lib/dispatch)", async () => {
  for (const file of ["lib/dispatch/index.ts", "lib/dispatch/dispatcher.ts", "lib/dispatch/run.ts"]) {
    let mod;
    try {
      mod = await importApp(file);
    } catch (e) {
      if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e?.message))) continue;
      throw e;
    }
    for (const name of ["runDispatcher", "dispatchOnce", "dispatchPending", "dispatch"]) {
      if (typeof mod[name] === "function") return () => mod[name]({ worker: WORKER_NAME });
    }
  }
  return null;
});

const wakeupDrainer = await optional("runbook wakeup drainer", async () => {
  const mod = await importApp("lib/runbook-engine.ts");
  return typeof mod.drainRunbookWakeups === "function" ? (limit) => mod.drainRunbookWakeups(limit) : null;
});

const deps = {
  run,
  name: WORKER_NAME,
  instanceId: `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`,
  version: version(),
  processors,
  dispatcher,
  wakeupDrainer,
  stopFile: args.get("stop-file") ?? path.join(process.env.HOME ?? "/tmp", "sjcos-backups", "worker.stop"),
  log,
};

if (args.get("once")) {
  const { registerWorker } = await import("../lib/worker/registry.ts");
  await registerWorker(run, { name: deps.name, instanceId: deps.instanceId, version: deps.version });
  const r = await runOnce(deps);
  console.log(JSON.stringify(r, null, 2));
  await pool.end();
  process.exit(r.error ? 1 : 0);
}

const sup = supervise(deps);
let stopping = false;
const stop = async (sig) => {
  if (stopping) return;
  stopping = true;
  log(`[worker] ${sig} received; finishing the current iteration`);
  await sup.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
await sup.done;
await pool.end();
