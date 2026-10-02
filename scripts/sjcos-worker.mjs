#!/usr/bin/env node
// SJC OS supervised worker (A03b) — the long-running systemd user service
// deploy/sjcos-worker.service (Restart=always). NOT a timer.
//
//   node scripts/sjcos-worker.mjs            # supervise until SIGTERM
//   node scripts/sjcos-worker.mjs --once     # one iteration, print result, exit
//   --url <pg url>       override DATABASE_URL (harness runs)
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
if (args.get("url")) process.env.DATABASE_URL = args.get("url");
if (!process.env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL is not set (pass --url or SJCOS_ENV)");
  process.exit(2);
}

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = async (sql, params) => (await pool.query(sql, params)).rows;

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
