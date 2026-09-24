#!/usr/bin/env node
// Record IMPLEMENTED evidence for the automation build (A18 capability
// status). Run after the branch is merged/deployed, against the target
// database, by the owner. It only sets `implemented = true` with the commit
// and the test-run summary as evidence; deployed / enabled / proven stay
// owner claims made on /engine/capabilities with their own evidence.
//
//   DATABASE_URL=... node scripts/record-capability-evidence.mjs --commit <sha> --tests "404 tests, 402 pass, 2 skipped" [--dry-run]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CAPABILITIES, ensureCapabilities, setCapabilityState } from "../lib/measure/capabilities.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes("--dry-run");
const commit = arg("--commit", null);
const tests = arg("--tests", null);
if (!commit || !tests) { console.error("usage: --commit <sha> --tests \"<summary>\" [--dry-run]"); process.exit(2); }

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(REPO, ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

// Tasks whose implementation this build delivered (docs/automation-reliability/status/*.md).
const IMPLEMENTED = new Set(["A00","A01","A02","A03a","A03b","A04","A05_A06","A07a","A07b","A08a","A08b","A09a","A09b","A10","A11","A12","A13","A14","A15","A16","A17","A18","A19","A20","A21","A22","A23","A24",
  "feature.decisions","feature.dispatcher","feature.square","feature.qbo","feature.weekly_summary","feature.owner_time","feature.measurement","feature.overhead","feature.procedure_checks"]);

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
const client = await pool.connect();
const run = async (sql, params) => (await client.query(sql, params ?? [])).rows;
try {
  await client.query("BEGIN");
  await ensureCapabilities(run);
  for (const c of CAPABILITIES) {
    if (!IMPLEMENTED.has(c.key)) continue;
    const note = `Automation build 2026-09-23: code + tests on branch t3code/build-sjc-os-plan (${tests}). See docs/automation-reliability/status/${c.key}.md. Deployed/enabled/proven NOT claimed here.`;
    if (dry) { console.log(`would set ${c.key} implemented=true (${commit})`); continue; }
    await setCapabilityState(run, c.key, { implemented: true, evidence: { version: commit, note, by: "record-capability-evidence.mjs", date: new Date().toISOString().slice(0, 10) } });
    console.log(`${c.key} implemented=true`);
  }
  await client.query(dry ? "ROLLBACK" : "COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
