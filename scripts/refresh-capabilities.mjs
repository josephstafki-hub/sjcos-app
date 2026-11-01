#!/usr/bin/env node
// Re-state the capability ledger (/engine/capabilities, MCP capability_report)
// from the live system: deployed from the live build, enabled from the switches
// (policies, timers, logins/keys), proven from real cases in the database. See
// lib/measure/capability-checks.ts for what each claim is derived from.
//
// Run it from the LIVE checkout after a deploy (it reads .next/BUILD_ID, the
// git history and the systemd timers of the box it runs on):
//
//   cd ~/sjcos-app && node scripts/refresh-capabilities.mjs            # dry run: what would change
//   cd ~/sjcos-app && node scripts/refresh-capabilities.mjs --apply    # write it, with evidence
//   node scripts/refresh-capabilities.mjs --repo ~/sjcos-app            # from a worktree, inspecting the live checkout
//
// Only states whose derived value differs from the ledger are written, each
// with a dated evidence entry (version = live build), so re-running is cheap
// and the evidence trail stays readable. It never un-proves anything, and it
// only turns `enabled` off when that switch is verifiably off. `implemented`
// is untouched (scripts/record-capability-evidence.mjs). Owner login
// (DATABASE_URL): it reads qbo_connection, which the narrow logins can't.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { CAPABILITIES, CAPABILITY_STATES, ensureCapabilities, setCapabilityState } from "../lib/measure/capabilities.ts";
import { deriveCapabilities } from "../lib/measure/capability-checks.ts";

const execFileAsync = promisify(execFile);
const argAt = process.argv.indexOf("--repo");
/** The checkout to inspect: this one, or --repo <path> (e.g. run from a worktree against ~/sjcos-app). */
const REPO = argAt > 0 ? path.resolve(process.argv[argAt + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
/** The automation build (PR #44) — capabilities are live once this is in the live checkout. */
const AUTOMATION_BUILD_COMMIT = "29b7702a";

let envFile = null;
function envValue(key) {
  if (process.env[key]) return process.env[key];
  if (envFile == null) {
    try {
      envFile = readFileSync(path.join(REPO, ".env.local"), "utf8");
    } catch {
      envFile = "";
    }
  }
  const m = envFile.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

const probe = {
  async deployedVersion() {
    try {
      await execFileAsync("git", ["-C", REPO, "merge-base", "--is-ancestor", AUTOMATION_BUILD_COMMIT, "HEAD"]);
    } catch {
      return null;
    }
    const dist = process.env.SJC_DIST_DIR || envValue("SJC_DIST_DIR") || ".next";
    const buildIdFile = path.join(REPO, dist, "BUILD_ID");
    if (!existsSync(buildIdFile)) return null;
    const buildId = readFileSync(buildIdFile, "utf8").trim();
    const { stdout } = await execFileAsync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]);
    return `${buildId} (main ${stdout.trim()})`;
  },
  async timerActive(unit) {
    try {
      const { stdout } = await execFileAsync("systemctl", ["--user", "is-active", unit]);
      return stdout.trim() === "active";
    } catch (e) {
      // is-active exits non-zero for inactive/failed/unknown units but still
      // prints the state; no output at all = systemctl itself didn't run.
      return String(e?.stdout ?? "").trim() ? false : null;
    }
  },
  configured: (key) => Boolean(envValue(key)),
  async migrationFiles() {
    try {
      return (await readdir(path.join(REPO, "db/migrations"))).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    } catch {
      return [];
    }
  },
};

const pool = new pg.Pool({ connectionString: envValue("DATABASE_URL"), max: 2 });
const run = async (sql, params) => (await pool.query(sql, params ?? [])).rows;
const today = new Date().toISOString().slice(0, 10);

try {
  if (apply) await ensureCapabilities(run);
  const current = new Map((await run(`SELECT key, implemented, deployed, enabled, proven FROM capability_status`)).map((r) => [r.key, r]));
  const derived = await deriveCapabilities(run, probe, CAPABILITIES.map((c) => c.key));
  const version = (await probe.deployedVersion()) ?? "not deployed";
  let changes = 0;
  for (const d of derived) {
    const now = current.get(d.key) ?? { implemented: false, deployed: false, enabled: false, proven: false };
    const set = {};
    const notes = [];
    if (d.deployed?.on && !now.deployed) { set.deployed = true; notes.push(`deployed: ${d.deployed.note}`); }
    if (d.enabled && d.enabled.on !== now.enabled) { set.enabled = d.enabled.on; notes.push(`enabled ${d.enabled.on ? "on" : "off"}: ${d.enabled.note}`); }
    if (d.proven?.on && !now.proven) { set.proven = true; notes.push(`proven: ${d.proven.note}`); }
    const states = CAPABILITY_STATES.map((s) => `${s[0]}${(s in set ? set[s] : now[s]) ? "✓" : "·"}`).join(" ");
    const why = [d.enabled && !d.enabled.on ? `enabled: ${d.enabled.note}` : null, d.proven && !d.proven.on ? `not proven: ${d.proven.note}` : null].filter(Boolean).join(" | ");
    if (!Object.keys(set).length) {
      console.log(`  ${d.key.padEnd(24)} ${states}  unchanged${why ? `  (${why})` : ""}`);
      continue;
    }
    changes++;
    console.log(`${apply ? "✎" : "→"} ${d.key.padEnd(24)} ${states}  ${notes.join(" | ")}${why ? `  (${why})` : ""}`);
    if (apply) {
      await setCapabilityState(run, d.key, { ...set, evidence: { date: today, version, note: notes.join(" | ").slice(0, 1000), by: "refresh-capabilities.mjs" } });
    }
  }
  console.log(`\n${changes} capabilit${changes === 1 ? "y" : "ies"} ${apply ? "updated" : "would change (dry run; --apply to write)"} · version ${version}`);
} finally {
  await pool.end();
}
