#!/usr/bin/env node
// Restore a backup set INTO ISOLATION (A09a). Never touches the running
// database: it creates a FRESH database on the URL you give it, restores the
// dump there, unpacks the files into a directory you give it, verifies
// DB/file consistency, pauses every lane in the restored DB ('all' —
// "restored from backup — reconcile external actions before resuming sends")
// and prints a reconciliation report. It never resumes dispatch.
//
//   node scripts/restore.mjs --set <stamp> --from <staging dir | BACKUP_DIR>
//        --admin-url <postgres url with CREATE DATABASE rights>
//        --database <fresh db name> --files-dir <empty dir>
//        [--mark-tested-url <source db url>]   (stamps restore_tested_at on backup_runs)
//        [--replace]                            (drop --database first if it exists)
//        [--json]
// Env: BACKUP_PASSPHRASE or BACKUP_AGE_IDENTITY (+ BACKUP_AGE_RECIPIENT).
//
// Prints elapsed restore time and the data-loss window (backup timestamp →
// now). Those two numbers are the measured recovery figures STATUS asks for.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { cipherFromEnv, decryptFile, sha256File } from "../lib/backup/crypto.ts";
import { markRestoreTested } from "../lib/backup/runs.ts";
import { pauseLane } from "../lib/commands/policies.ts";

const t0 = Date.now();
const args = parseArgs(process.argv.slice(2));
for (const k of ["set", "from", "admin-url", "database", "files-dir"]) if (!args[k]) fail(`--${k} is required`);
if (!/^[a-z_][a-z0-9_]*$/.test(args.database)) fail("--database must be a plain identifier");
if (/^sjcos$/.test(args.database)) fail("refusing to restore over a database named 'sjcos' — restore into a fresh name");

const setDir = path.join(args.from, args.set);
if (!existsSync(setDir)) fail(`backup set ${setDir} not found`);
const manifestPath = readdirSync(setDir).find((f) => /^sjcos-config-.*\.json$/.test(f));
if (!manifestPath) fail(`no manifest in ${setDir}`);
const manifest = JSON.parse(readFileSync(path.join(setDir, manifestPath), "utf8"));
const cipher = cipherFromEnv();
if (cipher.kind !== manifest.cipher) fail(`backup was encrypted with ${manifest.cipher}, environment provides ${cipher.kind}`);

const report = { backup_set: args.set, backup_created_at: manifest.created_at, database: args.database, files_dir: path.resolve(args["files-dir"]), steps: [], checks: [], reconcile: {}, ok: true };
const step = (s) => {
  report.steps.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  if (!args.json) console.log(`[restore] ${s}`);
};
const check = (name, ok, detail) => {
  report.checks.push({ name, ok, detail });
  if (!ok) report.ok = false;
};

// ── artifact integrity ───────────────────────────────────────────────────────
for (const a of manifest.artifacts) {
  const p = path.join(setDir, a.artifact);
  const ok = existsSync(p) && sha256File(p) === a.checksum;
  check(`artifact ${a.kind} checksum`, ok, a.artifact);
  if (!ok) fail(`artifact ${a.artifact} missing or checksum mismatch`);
}
step("artifact checksums verified");

// ── database ────────────────────────────────────────────────────────────────
const admin = new pg.Client({ connectionString: args["admin-url"] });
await admin.connect();
const exists = (await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [args.database])).rowCount > 0;
if (exists) {
  if (!args.replace) fail(`database ${args.database} already exists (pass --replace to drop it)`);
  await admin.query(`DROP DATABASE ${args.database} WITH (FORCE)`);
}
await admin.query(`CREATE DATABASE ${args.database}`);
await admin.end();
const dbUrl = withDatabase(args["admin-url"], args.database);
const dbArtifact = manifest.artifacts.find((a) => a.kind === "db");
const dumpTmp = path.join(setDir, `.restore-${process.pid}.dump`);
decryptFile(cipher, path.join(setDir, dbArtifact.artifact), dumpTmp);
try {
  execFileSync("pg_restore", ["--no-owner", "--no-acl", "-d", dbUrl, dumpTmp], { stdio: "pipe" });
} catch (e) {
  // pg_restore returns 1 on any warning (e.g. an extension comment). Fail only
  // when the ledger did not come back.
  const err = (e.stderr?.toString() ?? "").trim();
  if (!/warning/i.test(err)) fail(`pg_restore: ${err.slice(0, 500)}`);
} finally {
  rmSync(dumpTmp, { force: true });
}
step(`database ${args.database} restored`);

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const run = async (sql, params) => (await db.query(sql, params)).rows;

const [{ head }] = await run(`SELECT max(id)::int AS head FROM schema_migrations`);
check("schema ledger head matches manifest", head === manifest.schema_head, `restored ${head}, manifest ${manifest.schema_head}`);
for (const [table, n] of Object.entries(manifest.row_counts ?? {})) {
  const [r] = await run(`SELECT count(*)::int AS n FROM ${table}`);
  check(`row count ${table}`, r.n === n, `restored ${r.n}, manifest ${n}`);
}

// ── files ───────────────────────────────────────────────────────────────────
const filesDir = path.resolve(args["files-dir"]);
mkdirSync(filesDir, { recursive: true });
const filesArtifact = manifest.artifacts.find((a) => a.kind === "files");
if (filesArtifact) {
  const tarTmp = path.join(setDir, `.restore-${process.pid}.tar.gz`);
  decryptFile(cipher, path.join(setDir, filesArtifact.artifact), tarTmp);
  try {
    execFileSync("tar", ["-xzf", tarTmp, "-C", filesDir], { stdio: "pipe" });
  } finally {
    rmSync(tarTmp, { force: true });
  }
  const restoredCount = countFiles(filesDir);
  check("file count matches manifest", restoredCount === manifest.files.count, `restored ${restoredCount}, manifest ${manifest.files.count}`);
  // Every blob the database references must exist in the restored file set.
  const refs = await run(`SELECT id, storage_path FROM files WHERE storage_path IS NOT NULL`);
  const missing = refs.filter((r) => !existsSync(path.join(filesDir, "uploads", r.storage_path)));
  check("every files.storage_path exists in the restored uploads", missing.length === 0, missing.length ? `missing: ${missing.slice(0, 10).map((m) => m.storage_path).join(", ")}` : `${refs.length} references`);
  step(`files unpacked into ${filesDir}`);
} else {
  step("db-only set: no files artifact");
}

// ── sends disabled until reconciled ─────────────────────────────────────────
await pauseLane(run, "all", "restore.mjs", `restored from backup ${args.set} — reconcile external actions before resuming sends`);
const lanes = await run(`SELECT lane, reason FROM lane_pauses`);
check("lane_pauses 'all' set in restored database", lanes.some((l) => l.lane === "all"), lanes.map((l) => l.lane).join(","));
step("all lanes paused in the restored database");

// ── reconciliation report ───────────────────────────────────────────────────
const backupAt = new Date(manifest.created_at);
const gapDays = 7;
report.reconcile = {
  intents_in_flight_at_backup: await run(
    `SELECT id, operation_key, kind, state, recipient, provider_ref, created_at::text AS created_at FROM action_intents
      WHERE state IN ('accepted','unknown','leased','pending','retryable_failure') ORDER BY created_at`,
  ),
  decisions_approved_not_consumed: await run(
    `SELECT id, kind, action, target_kind, target_id, recipient, amount_cents, decided_at::text AS decided_at FROM decisions
      WHERE status = 'approved' AND uses < max_uses ORDER BY decided_at`,
  ),
  invoices_sent_unpaid: await run(
    `SELECT id, project_id, status, sent_at::text AS sent_at FROM invoices WHERE status = 'sent' ORDER BY sent_at DESC NULLS LAST LIMIT 50`,
  ),
  invoices_sent_near_backup: await run(
    `SELECT id, project_id, status, sent_at::text AS sent_at FROM invoices WHERE sent_at > $1::timestamptz - ($2::int * interval '1 day') ORDER BY sent_at DESC`,
    [backupAt.toISOString(), gapDays],
  ),
  source_events_unfinished: await run(`SELECT count(*)::int AS n FROM source_events WHERE state NOT IN ('done','ignored')`).then((r) => r[0].n),
  note:
    "Everything that happened between the backup timestamp and now is NOT in this database: emails/texts/calls/payments made in the gap " +
    "must be reconciled against Gmail, Telnyx, Square/QBO and the bank BEFORE lane 'all' is resumed. Intents listed as accepted/unknown " +
    "may already have reached the recipient — never retry them blindly.",
};
await db.end();

if (args["mark-tested-url"]) {
  const src = new pg.Client({ connectionString: args["mark-tested-url"] });
  await src.connect();
  const n = await markRestoreTested(async (sql, params) => (await src.query(sql, params)).rows, args.set, `restored into ${args.database} in ${((Date.now() - t0) / 1000).toFixed(1)}s; checks ${report.checks.filter((c) => c.ok).length}/${report.checks.length} ok`);
  await src.end();
  step(`marked ${n} backup_runs row(s) restore-tested`);
}

report.elapsed_s = Number(((Date.now() - t0) / 1000).toFixed(2));
report.data_loss_window_s = Math.max(0, Math.round((Date.now() - backupAt.getTime()) / 1000));
if (args.json) console.log(JSON.stringify(report));
else {
  console.log(`\n[restore] ${report.ok ? "OK" : "PROBLEMS"} — elapsed ${report.elapsed_s}s, data-loss window ${report.data_loss_window_s}s (backup ${manifest.created_at} → now)`);
  for (const c of report.checks) console.log(`  ${c.ok ? "ok " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  const r = report.reconcile;
  console.log(`\n[restore] reconcile before resuming sends:`);
  console.log(`  ${r.intents_in_flight_at_backup.length} action intent(s) in flight at backup time`);
  for (const i of r.intents_in_flight_at_backup.slice(0, 20)) console.log(`    - ${i.state.padEnd(17)} ${i.kind} ${i.operation_key} → ${i.recipient ?? ""}`);
  console.log(`  ${r.decisions_approved_not_consumed.length} decision(s) approved but not consumed`);
  console.log(`  ${r.invoices_sent_unpaid.length} invoice(s) sent and unpaid; ${r.invoices_sent_near_backup.length} sent within ${gapDays} days of the backup`);
  console.log(`  ${r.source_events_unfinished} source event(s) unfinished`);
  console.log(`  lane 'all' is PAUSED in ${args.database}: resume only after reconciling with the providers.`);
}
process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}
function fail(msg) {
  console.error(`[restore] ${msg}`);
  process.exit(2);
}
function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
function countFiles(dir) {
  let n = 0;
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(p, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}
