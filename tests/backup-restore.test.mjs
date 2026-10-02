import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withTestDb, harnessAvailable, cleanFoundation, REPO } from "./_harness/testdb.mjs";
import { enqueueIntent } from "../lib/commands/intents.ts";
import { backupHealth, alertOnBackupHealth } from "../lib/backup/status.ts";
import { planRetention, parseSetStamp, setStamp } from "../lib/backup/retention.ts";

// A09a — V13: backup of the harness DB + a temp uploads dir → restore into a
// SECOND harness database + dir → consistency verified, lane 'all' paused,
// reconciliation report lists the seeded accepted intent; a missing
// destination records a FAILED backup_runs row; staleness computed.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const PASS = "test-passphrase-not-secret-0123456789";

function node(script, args, env) {
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: REPO,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: lastJson(r.stdout) };
}
function lastJson(out) {
  const lines = out.trim().split("\n").filter((l) => l.startsWith("{"));
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}
function adminUrl(url) {
  return url.replace(/\/[^/?]+\?/, "/postgres?");
}

test("V13: backup → isolated restore round trip (consistency, lane pause, reconciliation, timings, restore proof)", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await client.query(`DELETE FROM backup_runs`);
    await client.query(`DELETE FROM files WHERE id LIKE 'zz-%'`);
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    const tmp = mkdtempSync(path.join(tmpdir(), "sjc-backup-"));
    const filesRoot = path.join(tmp, "app");
    const staging = path.join(tmp, "staging");
    const dest = path.join(tmp, "offhost");
    const restoreDir = path.join(tmp, "restored-files");
    mkdirSync(path.join(filesRoot, "uploads"), { recursive: true });
    mkdirSync(path.join(filesRoot, "drafts"), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(filesRoot, "uploads", "zz-photo.jpg"), "not really a jpeg");
    writeFileSync(path.join(filesRoot, "uploads", "zz-plan.pdf"), "%PDF-1.4 zz");
    writeFileSync(path.join(filesRoot, "drafts", "zz-draft.md"), "draft");
    await run(`INSERT INTO files (id, name, type, storage_path, mime_type) VALUES ('zz-photo', 'zz photo', 'img', 'zz-photo.jpg', 'image/jpeg'), ('zz-plan', 'zz plan', 'doc', 'zz-plan.pdf', 'application/pdf')`);
    const { intent } = await enqueueIntent(run, { operationKey: "zz:invoice:1:send", kind: "send_invoice", recipient: "client@example.test", payload: { n: 1 }, principal: owner });
    await run(`UPDATE action_intents SET state = 'accepted', provider_ref = 'msg-123' WHERE id = $1`, [intent.id]);
    const [{ n: projectsBefore }] = await run(`SELECT count(*)::int AS n FROM projects`);

    try {
      // ── backup ────────────────────────────────────────────────────────
      const b = node("backup.mjs", ["--url", url, "--staging", staging, "--files-root", filesRoot, "--no-alert", "--host", "zz-test-host"], { BACKUP_PASSPHRASE: PASS, BACKUP_DIR: dest });
      assert.equal(b.status, 0, `backup failed:\n${b.stderr}\n${b.stdout}`);
      assert.equal(b.json.ok, true);
      const stamp = b.json.backup_set;
      const runs = await run(`SELECT kind, state, bytes, checksum, destination, artifact, restore_tested_at FROM backup_runs WHERE backup_set = $1 ORDER BY kind`, [stamp]);
      assert.deepEqual(runs.map((r) => [r.kind, r.state]), [["config", "ok"], ["db", "ok"], ["files", "ok"]]);
      for (const r of runs) {
        assert.ok(r.bytes > 0 && /^[0-9a-f]{64}$/.test(r.checksum), `${r.kind} has bytes + checksum`);
        assert.equal(r.destination, `dir:${dest}`);
        assert.equal(r.restore_tested_at, null);
      }
      const remote = readdirSync(path.join(dest, stamp));
      assert.ok(remote.some((f) => f.startsWith("sjcos-db-") && f.endsWith(".enc")), "encrypted db artifact off-host");
      assert.ok(remote.some((f) => f.startsWith("sjcos-files-") && f.endsWith(".enc")), "encrypted files artifact off-host");
      assert.ok(remote.some((f) => f.startsWith("sjcos-config-") && f.endsWith(".json")), "recovery manifest off-host");
      assert.ok(!remote.some((f) => f.endsWith(".dump") || f.endsWith(".tar.gz")), "no plaintext artifacts left in the set");
      const manifest = JSON.parse((await import("node:fs")).readFileSync(path.join(dest, stamp, remote.find((f) => f.endsWith(".json"))), "utf8"));
      assert.ok(manifest.required_env_keys.includes("DATABASE_URL") && manifest.required_env_keys.includes("BACKUP_PASSPHRASE"));
      assert.ok(!JSON.stringify(manifest).includes(PASS), "manifest never carries a secret value");
      assert.equal(manifest.files.count, 3);
      assert.equal(manifest.row_counts.projects, projectsBefore);

      // ── restore into isolation ───────────────────────────────────────
      const dbName = "zz_restore_test";
      const r = node(
        "restore.mjs",
        ["--set", stamp, "--from", dest, "--admin-url", adminUrl(url), "--database", dbName, "--files-dir", restoreDir, "--mark-tested-url", url, "--replace", "--json"],
        { BACKUP_PASSPHRASE: PASS },
      );
      assert.equal(r.status, 0, `restore failed:\n${r.stderr}\n${r.stdout}`);
      const rep = r.json;
      assert.equal(rep.ok, true, JSON.stringify(rep.checks));
      for (const c of rep.checks) assert.equal(c.ok, true, `${c.name}: ${c.detail}`);
      assert.ok(rep.checks.some((c) => /storage_path/.test(c.name)));
      assert.ok(existsSync(path.join(restoreDir, "uploads", "zz-photo.jpg")) && existsSync(path.join(restoreDir, "drafts", "zz-draft.md")));
      assert.ok(rep.reconcile.intents_in_flight_at_backup.some((i) => i.operation_key === "zz:invoice:1:send" && i.state === "accepted"), "seeded accepted intent is listed for reconciliation");
      assert.ok(typeof rep.elapsed_s === "number" && rep.elapsed_s > 0);
      assert.ok(typeof rep.data_loss_window_s === "number" && rep.data_loss_window_s >= 0);
      console.log(`  measured: restore ${rep.elapsed_s}s, data-loss window ${rep.data_loss_window_s}s, checks ${rep.checks.length}`);

      // Restored DB: lane 'all' paused; source untouched; restore proof stamped on the source ledger.
      const pg = (await import("pg")).default;
      const restored = new pg.Client({ connectionString: url.replace(/\/[^/?]+\?/, `/${dbName}?`) });
      await restored.connect();
      const lanes = (await restored.query(`SELECT lane, reason FROM lane_pauses`)).rows;
      assert.ok(lanes.some((l) => l.lane === "all" && /reconcile external actions/.test(l.reason)));
      const rf = (await restored.query(`SELECT count(*)::int AS n FROM files WHERE id LIKE 'zz-%'`)).rows[0].n;
      assert.equal(rf, 2);
      await restored.end();
      const [{ n: srcLanes }] = await run(`SELECT count(*)::int AS n FROM lane_pauses`);
      assert.equal(srcLanes, 0, "the SOURCE database was not paused or touched");
      const tested = await run(`SELECT restore_tested_at, restore_note FROM backup_runs WHERE backup_set = $1 AND kind = 'db'`, [stamp]);
      assert.ok(tested[0].restore_tested_at, "restore_tested_at stamped");
      assert.match(tested[0].restore_note, /restored into zz_restore_test/);
      // Cleanup the restored database.
      const admin = new pg.Client({ connectionString: adminUrl(url) });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();

      // ── db-only mode + staleness on the ledger ───────────────────────
      const b2 = node("backup.mjs", ["--url", url, "--staging", staging, "--files-root", filesRoot, "--no-alert", "--db-only"], { BACKUP_PASSPHRASE: PASS, BACKUP_DIR: dest });
      assert.equal(b2.status, 0, b2.stderr);
      assert.match(b2.json.backup_set, /-db$/);
      const health = backupHealth(await run(`SELECT *, started_at::text AS started_at, finished_at::text AS finished_at, restore_tested_at::text AS restore_tested_at FROM backup_runs ORDER BY backup_runs.started_at DESC`));
      assert.equal(health.configured, true);
      assert.equal(health.kinds.find((k) => k.kind === "db").stale, false);
      assert.equal(health.problems.length, 0, health.problems.join("; "));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await run(`DELETE FROM files WHERE id LIKE 'zz-%'`);
    }
  });
});

test("V13: no off-host destination → non-zero exit AND a failed backup_runs row; missing passphrase likewise", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await client.query(`DELETE FROM backup_runs`);
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    const tmp = mkdtempSync(path.join(tmpdir(), "sjc-backup-"));
    try {
      const env = { BACKUP_PASSPHRASE: PASS, BACKUP_DIR: "", BACKUP_RCLONE_REMOTE: "", BACKUP_SSH_TARGET: "" };
      const b = node("backup.mjs", ["--url", url, "--staging", path.join(tmp, "s"), "--files-root", tmp, "--no-alert"], env);
      assert.equal(b.status, 2);
      assert.match(b.stderr, /no off-host destination configured/);
      const rows = await run(`SELECT kind, state, error, destination FROM backup_runs ORDER BY kind`);
      assert.deepEqual(rows.map((r) => [r.kind, r.state, r.destination]), [["config", "failed", "none"], ["db", "failed", "none"], ["files", "failed", "none"]]);
      assert.match(rows[0].error, /no off-host destination configured/);
      const health = backupHealth(await run(`SELECT *, started_at::text AS started_at, finished_at::text AS finished_at FROM backup_runs`));
      assert.equal(health.configured, false);
      assert.ok(health.problems.some((p) => /NOT CONFIGURED/.test(p)));
      assert.ok(health.problems.some((p) => /backup db: last run FAILED/.test(p)));

      const b2 = node("backup.mjs", ["--url", url, "--staging", path.join(tmp, "s"), "--files-root", tmp, "--no-alert"], { BACKUP_PASSPHRASE: "", BACKUP_AGE_RECIPIENT: "", BACKUP_DIR: tmp });
      assert.equal(b2.status, 2);
      assert.match(b2.stderr, /no backup encryption configured/);
      const [{ n }] = await run(`SELECT count(*)::int AS n FROM backup_runs WHERE state = 'failed' AND error LIKE 'no backup encryption%'`);
      assert.equal(n, 3);

      // Refuses to run against anything without an explicit target.
      const b3 = node("backup.mjs", ["--no-alert"], { SJCOS_ENV: "", DATABASE_URL: "" });
      assert.equal(b3.status, 2);
      assert.match(b3.stderr, /no database/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("backup status: staleness against cadence, never-run, and deduped alerting", async () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const mk = (kind, hoursAgo, state = "ok", extra = {}) => ({
    id: 1, kind, mode: "full", state, bytes: 10, checksum: "x", artifact: "a", backup_set: "s", destination: "dir:/mnt/x", error: null, host: "h", code_version: "v",
    started_at: new Date(now.getTime() - hoursAgo * 3600e3).toISOString(), finished_at: new Date(now.getTime() - hoursAgo * 3600e3 + 60e3).toISOString(),
    restore_tested_at: null, restore_note: null, ...extra,
  });
  const fresh = backupHealth([mk("db", 5), mk("files", 5), mk("config", 5)], { now });
  assert.equal(fresh.problems.length, 0);
  const stale = backupHealth([mk("db", 40), mk("files", 5), mk("config", 5)], { now });
  assert.ok(stale.kinds.find((k) => k.kind === "db").stale);
  assert.match(stale.problems.join(";"), /backup db: last good backup is 40h old/);
  const tight = backupHealth([mk("db", 7), mk("files", 5), mk("config", 5)], { now, cadence: { db: 6 * 3600 } });
  assert.ok(tight.kinds.find((k) => k.kind === "db").stale, "4-hourly cadence flags a 7h-old db backup");
  const failedAfterOk = backupHealth([mk("db", 1, "failed", { error: "disk full" }), mk("db", 30), mk("files", 5), mk("config", 5)], { now });
  const db = failedAfterOk.kinds.find((k) => k.kind === "db");
  assert.equal(db.consecutive_failures, 1);
  assert.ok(db.stale);
  assert.match(failedAfterOk.problems.join(";"), /last run FAILED — disk full/);
  const never = backupHealth([], { now });
  assert.ok(never.problems.some((p) => /never run/.test(p)) && !never.configured);

  const sent = [];
  const sink = async (i) => sent.push(i);
  let seen = await alertOnBackupHealth(stale, sink, null, { now });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "comms");
  seen = await alertOnBackupHealth(stale, sink, seen, { now: new Date(now.getTime() + 3600e3) });
  assert.equal(sent.length, 1, "same condition within the window is not re-sent");
  seen = await alertOnBackupHealth(stale, sink, seen, { now: new Date(now.getTime() + 7 * 3600e3) });
  assert.equal(sent.length, 2, "repeats after the window");
  seen = await alertOnBackupHealth(fresh, sink, seen, { now });
  assert.equal(seen, null, "clean health clears the memory");
});

test("backup retention: daily 14 / weekly 8 / monthly 6 keeps the right sets", () => {
  const sets = [];
  const start = new Date("2026-09-23T02:30:00Z");
  for (let d = 0; d < 200; d++) {
    const at = new Date(start.getTime() - d * 86400e3);
    sets.push({ name: setStamp(at), at });
  }
  const plan = planRetention(sets);
  assert.ok(plan.keep.length >= 14 + 6 && plan.keep.length <= 14 + 8 + 6, `kept ${plan.keep.length}`);
  assert.equal(plan.keep[0].name, sets[0].name, "newest always kept");
  assert.ok(plan.keep.some((s) => s.at.getTime() < start.getTime() - 150 * 86400e3), "a monthly from ~5 months back survives");
  for (let d = 0; d < 14; d++) assert.ok(plan.keep.some((s) => s.name === sets[d].name), `day ${d} kept`);
  assert.ok(plan.remove.length > 100);
  assert.deepEqual(parseSetStamp("20260923T023000Z-db")?.toISOString(), "2026-09-23T02:30:00.000Z");
  assert.equal(parseSetStamp("junk"), null);
});
