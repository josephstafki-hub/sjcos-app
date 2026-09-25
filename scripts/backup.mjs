#!/usr/bin/env node
// Off-host backup (A09a). Produces ONE backup set (stamp YYYYMMDDTHHMMSSZ):
//   sjcos-db-<stamp>.dump.enc        pg_dump -Fc of the database, encrypted
//   sjcos-files-<stamp>.tar.gz.enc   uploads/ + drafts/ + reports/ + .10dlc-state.json
//   sjcos-config-<stamp>.json        recovery manifest: required env KEY NAMES
//                                    (never values), versions, artifact checksums,
//                                    row counts, file counts
// then uploads the set to the configured off-host target, applies retention
// (daily 14 / weekly 8 / monthly 6) locally and remotely, and records every
// kind in backup_runs. No destination or no passphrase → exits non-zero AND
// records a failed run, so staleness/failure alerts fire.
//
// Production is referenced ONLY through --url or the env file named by
// SJCOS_ENV (the systemd unit sets it). Tests pass --url of the harness.
//
//   node scripts/backup.mjs --url <pg url> [--db-only] [--staging <dir>]
//        [--files-root <dir>] [--now <iso>] [--no-alert] [--host <name>]
//   SJCOS_ENV=~/sjcos-app/.env.local node scripts/backup.mjs       (systemd)
//
// Env: BACKUP_PASSPHRASE (or BACKUP_AGE_RECIPIENT), and one of
//      BACKUP_RCLONE_REMOTE | BACKUP_SSH_TARGET | BACKUP_DIR.
//      BACKUP_STAGING_DIR (default ~/sjcos-backups/staging), BACKUP_RETENTION
//      "14/8/6".

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import pg from "pg";
import { finishBackupRun, latestBackupRuns, recordFailedBackup, startBackupRun } from "../lib/backup/runs.ts";
import { DEFAULT_RETENTION, parseSetStamp, planRetention, setStamp } from "../lib/backup/retention.ts";
import { ARTIFACT_EXT, cipherFromEnv, encryptFile, fileSize, sha256File } from "../lib/backup/crypto.ts";
import { targetFromEnv } from "../lib/backup/targets.ts";
import { alertOnBackupHealth, backupHealth } from "../lib/backup/status.ts";
import { loadEnvFile, REPO_ROOT } from "../lib/worker/load-app.mjs";

const args = parseArgs(process.argv.slice(2));

// Env file: only when SJCOS_ENV names it (systemd) — never a silent default to
// the live .env.local from a developer shell.
if (process.env.SJCOS_ENV) loadEnvFile(process.env.SJCOS_ENV);
const url = args.url ?? (process.env.SJCOS_ENV ? process.env.DATABASE_URL : undefined);
if (!url) fail("no database: pass --url <postgres url> or run with SJCOS_ENV=<env file> (systemd)");

const now = args.now ? new Date(args.now) : new Date();
const dbOnly = Boolean(args["db-only"]);
const mode = dbOnly ? "db-only" : "full";
const stamp = setStamp(now, dbOnly ? "-db" : "");
const staging = path.resolve(args.staging ?? process.env.BACKUP_STAGING_DIR ?? path.join(process.env.HOME ?? "/tmp", "sjcos-backups", "staging"));
const filesRoot = path.resolve(args["files-root"] ?? REPO_ROOT);
const host = args.host ?? hostname();
const codeVersion = gitSha();
const retention = parseRetention(process.env.BACKUP_RETENTION) ?? DEFAULT_RETENTION;
const FILE_SETS = ["uploads", "drafts", "reports", ".10dlc-state.json"];
const REQUIRED_ENV_KEYS = [
  "DATABASE_URL", "SESSION_SECRET", "CRON_SECRET", "MCP_HTTP_TOKEN", "NEXT_PUBLIC_APP_URL",
  "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_REDIRECT_URI",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID",
  "SMS_PROVIDER", "SMS_PUBLIC_KEY", "SMS_MESSAGING_PROFILE_ID", "SMS_FROM_NUMBER", "TELNYX_API_KEY",
  "VOICE_APPLICATION_ID", "VOICE_FORWARD_TO",
  "BACKUP_PASSPHRASE", "BACKUP_RCLONE_REMOTE", "BACKUP_SSH_TARGET", "BACKUP_DIR",
];

const client = new pg.Client({ connectionString: url });
await client.connect();
const run = async (sql, params) => (await client.query(sql, params)).rows;
const log = (l) => console.log(`[backup ${stamp}] ${l}`);

let exitCode = 0;
try {
  // ── Preconditions: destination + cipher. Both failures are RECORDED. ──────
  const target = targetFromEnv();
  let cipher = null;
  let preError = null;
  if (!target) preError = "no off-host destination configured (set BACKUP_RCLONE_REMOTE, BACKUP_SSH_TARGET or BACKUP_DIR)";
  else {
    try {
      cipher = cipherFromEnv();
    } catch (e) {
      preError = e.message;
    }
  }
  if (preError) {
    for (const kind of dbOnly ? ["db"] : ["db", "files", "config"]) {
      await recordFailedBackup(run, { kind, mode, backupSet: stamp, error: preError, host, codeVersion });
    }
    console.error(`[backup ${stamp}] FAILED: ${preError}`);
    exitCode = 2;
  } else {
    const setDir = path.join(staging, stamp);
    mkdirSync(setDir, { recursive: true });
    const ext = ARTIFACT_EXT[cipher.kind];
    const artifacts = [];

    // ── DB ────────────────────────────────────────────────────────────────
    const dbRun = await startBackupRun(run, { kind: "db", mode, backupSet: stamp, destination: target.label, host, codeVersion });
    try {
      const plain = path.join(setDir, `sjcos-db-${stamp}.dump`);
      execFileSync("pg_dump", ["-Fc", "--no-owner", "--no-acl", "-f", plain, url], { stdio: "pipe" });
      const enc = `${plain}${ext}`;
      encryptFile(cipher, plain, enc);
      rmSync(plain);
      const a = { kind: "db", artifact: path.basename(enc), bytes: fileSize(enc), checksum: sha256File(enc) };
      artifacts.push(a);
      await finishBackupRun(run, dbRun, { ok: true, ...a });
      log(`db dump ${a.bytes} bytes`);
    } catch (e) {
      await finishBackupRun(run, dbRun, { ok: false, error: `pg_dump: ${stderrOf(e)}` });
      throw e;
    }

    // ── Files ─────────────────────────────────────────────────────────────
    let fileIndex = { count: 0, bytes: 0, roots: [] };
    if (!dbOnly) {
      const fRun = await startBackupRun(run, { kind: "files", mode, backupSet: stamp, destination: target.label, host, codeVersion });
      try {
        const present = FILE_SETS.filter((f) => existsSync(path.join(filesRoot, f)));
        fileIndex = indexFiles(filesRoot, present);
        const plain = path.join(setDir, `sjcos-files-${stamp}.tar.gz`);
        if (present.length) execFileSync("tar", ["-czf", plain, "-C", filesRoot, ...present], { stdio: "pipe" });
        else execFileSync("tar", ["-czf", plain, "-T", "/dev/null"], { stdio: "pipe" });
        const enc = `${plain}${ext}`;
        encryptFile(cipher, plain, enc);
        rmSync(plain);
        const a = { kind: "files", artifact: path.basename(enc), bytes: fileSize(enc), checksum: sha256File(enc) };
        artifacts.push(a);
        await finishBackupRun(run, fRun, { ok: true, ...a });
        log(`files ${fileIndex.count} entries in ${present.join(", ") || "(none present)"} → ${a.bytes} bytes`);
      } catch (e) {
        await finishBackupRun(run, fRun, { ok: false, error: `files: ${stderrOf(e)}` });
        throw e;
      }
    }

    // ── Config / recovery manifest (names only, never values) ─────────────
    if (!dbOnly) {
      const cRun = await startBackupRun(run, { kind: "config", mode, backupSet: stamp, destination: target.label, host, codeVersion });
      try {
        const manifest = await buildManifest({ run, stamp, now, host, codeVersion, cipher, target, artifacts, fileIndex });
        const p = path.join(setDir, `sjcos-config-${stamp}.json`);
        writeFileSync(p, JSON.stringify(manifest, null, 2));
        const a = { kind: "config", artifact: path.basename(p), bytes: fileSize(p), checksum: sha256File(p) };
        await finishBackupRun(run, cRun, { ok: true, ...a });
        log(`manifest written (${manifest.required_env_keys.length} env key names, ${Object.keys(manifest.row_counts).length} table counts)`);
      } catch (e) {
        await finishBackupRun(run, cRun, { ok: false, error: `manifest: ${e.message}` });
        throw e;
      }
    } else {
      // db-only sets still carry a tiny manifest so restore can verify them.
      const manifest = await buildManifest({ run, stamp, now, host, codeVersion, cipher, target, artifacts, fileIndex: null });
      writeFileSync(path.join(setDir, `sjcos-config-${stamp}.json`), JSON.stringify(manifest, null, 2));
    }

    // ── Upload + retention ────────────────────────────────────────────────
    try {
      target.upload(setDir, stamp);
      log(`uploaded to ${target.label}`);
    } catch (e) {
      const msg = `upload to ${target.label} failed: ${stderrOf(e)}`;
      await run(`UPDATE backup_runs SET state = 'failed', error = $2, finished_at = now() WHERE backup_set = $1 AND state = 'ok'`, [stamp, msg]);
      throw new Error(msg);
    }
    const local = applyRetention(staging, retention, (name) => rmSync(path.join(staging, name), { recursive: true, force: true }));
    const remoteNames = target.list();
    let remote = { kept: 0, removed: 0, supported: remoteNames !== null };
    if (remoteNames) {
      const sets = remoteNames.map((name) => ({ name, at: parseSetStamp(name) })).filter((s) => s.at);
      const plan = planRetention(sets, retention);
      for (const s of plan.remove) target.remove(s.name);
      remote = { kept: plan.keep.length, removed: plan.remove.length, supported: true };
    }
    log(`retention: local kept ${local.kept} removed ${local.removed}; remote ${remote.supported ? `kept ${remote.kept} removed ${remote.removed}` : "listing unsupported"}`);
  }

  // ── Alert on failure / staleness (deduped) ────────────────────────────────
  const health = backupHealth(await latestBackupRuns(run), { now });
  if (health.problems.length) console.error(`[backup ${stamp}] health problems:\n  - ${health.problems.join("\n  - ")}`);
  if (!args["no-alert"]) await alert(health, staging, now, url);
  console.log(JSON.stringify({ ok: exitCode === 0, backup_set: stamp, mode, problems: health.problems }));
} catch (e) {
  console.error(`[backup ${stamp}] FAILED: ${e.message}`);
  exitCode = exitCode || 1;
  if (!args["no-alert"]) {
    try {
      await alert(backupHealth(await latestBackupRuns(run), { now }), staging, now, url);
    } catch {
      /* alerting is best effort; the monitor script is the independent path */
    }
  }
} finally {
  await client.end();
}
process.exit(exitCode);

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

function fail(msg) {
  console.error(`[backup] ${msg}`);
  process.exit(2);
}

function stderrOf(e) {
  return (e?.stderr?.toString?.() || e?.message || String(e)).trim().slice(0, 500);
}

function gitSha() {
  const r = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim();
  try {
    return `pkg:${JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version}`;
  } catch {
    return "unknown";
  }
}

function parseRetention(s) {
  const m = /^(\d+)\/(\d+)\/(\d+)$/.exec((s ?? "").trim());
  return m ? { daily: +m[1], weekly: +m[2], monthly: +m[3] } : null;
}

function indexFiles(root, roots) {
  const out = { count: 0, bytes: 0, roots, entries: [] };
  const walk = (p, rel) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const n of readdirSync(p)) walk(path.join(p, n), path.posix.join(rel, n));
    } else {
      out.count++;
      out.bytes += st.size;
      out.entries.push({ path: rel, bytes: st.size });
    }
  };
  for (const r of roots) walk(path.join(root, r), r);
  return out;
}

function applyRetention(dir, policy, remove) {
  if (!existsSync(dir)) return { kept: 0, removed: 0 };
  const sets = readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isDirectory())
    .map((name) => ({ name, at: parseSetStamp(name) }))
    .filter((s) => s.at);
  const plan = planRetention(sets, policy);
  for (const s of plan.remove) remove(s.name);
  return { kept: plan.keep.length, removed: plan.remove.length };
}

async function buildManifest({ run, stamp, now, host, codeVersion, cipher, target, artifacts, fileIndex }) {
  const [ledger] = await run(`SELECT max(id)::int AS head FROM schema_migrations`);
  const policies = await run(`SELECT key, version FROM policies WHERE state = 'active' ORDER BY key`);
  const tables = ["projects", "leads", "clients", "invoices", "files", "work_items", "action_intents", "decisions", "source_events", "sms_messages", "calls"];
  const rowCounts = {};
  for (const t of tables) {
    const [r] = await run(`SELECT CASE WHEN to_regclass($1) IS NULL THEN NULL ELSE (SELECT count(*) FROM ${t}) END::int AS n`, [t]).catch(() => [{ n: null }]);
    if (r?.n != null) rowCounts[t] = r.n;
  }
  const envFile = process.env.SJCOS_ENV;
  const envNames = new Set(REQUIRED_ENV_KEYS);
  if (envFile && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m) envNames.add(m[1]);
    }
  }
  const deployDir = path.join(REPO_ROOT, "deploy");
  const units = existsSync(deployDir) ? readdirSync(deployDir).filter((f) => /\.(service|timer|conf|sh)$/.test(f)) : [];
  return {
    format: 1,
    backup_set: stamp,
    created_at: now.toISOString(),
    host,
    code_version: codeVersion,
    node: process.version,
    schema_head: ledger?.head ?? null,
    active_policies: Object.fromEntries(policies.map((p) => [p.key, p.version])),
    cipher: cipher.kind,
    destination: target.label,
    artifacts,
    row_counts: rowCounts,
    files: fileIndex ? { count: fileIndex.count, bytes: fileIndex.bytes, roots: fileIndex.roots, entries: fileIndex.entries.slice(0, 20000) } : null,
    // Names only. The VALUES live in ~/sjcos-app/.env.local on the host and in
    // Joe's password manager; a restore without them is a restore of data
    // only — see docs/automation-reliability/recovery.md.
    required_env_keys: [...envNames].sort(),
    deploy_units: units,
    restore: "node scripts/restore.mjs --set <stamp> --from <dir> --admin-url <postgres url> --database <fresh db> --files-dir <dir>",
  };
}

async function alert(health, stagingDir, at, dbUrl) {
  const stateFile = path.join(stagingDir, "alert-state.json");
  let seen = null;
  try {
    seen = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* first alert */
  }
  const next = await alertOnBackupHealth(
    health,
    async (input) => {
      process.env.DATABASE_URL ??= dbUrl;
      const { importApp } = await import("../lib/worker/load-app.mjs");
      const mod = await importApp("lib/notify-owner.ts");
      await mod.notifyOwner(input);
    },
    seen,
    { now: at },
  );
  mkdirSync(stagingDir, { recursive: true });
  if (next) writeFileSync(stateFile, JSON.stringify(next));
  else if (existsSync(stateFile)) rmSync(stateFile);
}

