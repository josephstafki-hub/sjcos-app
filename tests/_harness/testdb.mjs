// Disposable PostgreSQL harness (A00).
//
// Boots a throwaway Postgres 16 cluster owned by the current user (initdb +
// pg_ctl from the system package, unix socket only, random port), loads
// db/schema.sql followed by the ordered ledger in db/migrations/, and hands
// back a connection URL. Nothing here can reach the production database:
//   • the cluster lives under a fresh mkdtemp directory and listens on no TCP
//     address at all (listen_addresses='' — socket only);
//   • assertNotProduction() refuses any URL that names the live sjcos database
//     (host localhost/127.0.0.1, port 5432, db "sjcos") or that lacks the
//     SJC_TEST marker the harness stamps into the URL's application_name.
//
// Usage from a test:
//   import { withTestDb } from "./_harness/testdb.mjs";
//   await withTestDb(async (url, client) => { ... });
//
// Usage from the shell (keeps a cluster running for repeated test runs):
//   node scripts/test-db.mjs start   → prints SJC_TEST_DATABASE_URL=…
//   node scripts/test-db.mjs stop
//
// Outbound network: the harness sets SJC_OUTBOUND_DISABLED=1 in process.env so
// every provider adapter's fake/blocked mode engages (lib/providers/*).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, "..", "..");
const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
// SJC_TEST_CLUSTER_TAG lets parallel workstreams keep separate clusters.
const STATE_FILE = path.join(tmpdir(), `sjc-testdb-${process.env.USER ?? "user"}${process.env.SJC_TEST_CLUSTER_TAG ? `-${process.env.SJC_TEST_CLUSTER_TAG}` : ""}.json`);

export class ProductionTargetError extends Error {}

/** Refuse the live database. Throws unless the URL is plainly a harness URL. */
export function assertNotProduction(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ProductionTargetError(`unparseable database url`);
  }
  const db = u.pathname.replace(/^\//, "");
  const host = u.hostname || u.searchParams.get("host") || "";
  const port = u.port || "5432";
  const isLiveShape = db === "sjcos" && port === "5432" && /^(localhost|127\.0\.0\.1|)$/.test(host);
  if (isLiveShape) throw new ProductionTargetError(`refusing to run tests against the live database (${db}@${host || "socket"}:${port})`);
  if (u.searchParams.get("application_name") !== "sjc_test_harness") {
    throw new ProductionTargetError(`refusing a database url that was not minted by the test harness (missing application_name=sjc_test_harness)`);
  }
  return true;
}

function bin(name) {
  const p = path.join(PG_BIN, name);
  if (!existsSync(p)) throw new Error(`${p} not found — install postgresql-16 or set PG_BIN`);
  return p;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function socketUrl(dir, port, db) {
  return `postgresql://sjctest@localhost/${db}?host=${encodeURIComponent(dir)}&port=${port}&application_name=sjc_test_harness`;
}

function pickPort() {
  return 54000 + Math.floor(Math.random() * 1000);
}

/** Start a cluster. Returns { dir, port, url } (url points at database `sjcos_test`). */
export function startCluster() {
  const existing = readState();
  if (existing && clusterAlive(existing)) return existing;
  const dir = mkdtempSync(path.join(tmpdir(), "sjc-pgtest-"));
  const data = path.join(dir, "data");
  execFileSync(bin("initdb"), ["-D", data, "-U", "sjctest", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
  const port = pickPort();
  execFileSync(
    bin("pg_ctl"),
    ["-D", data, "-o", `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, "-l", path.join(dir, "log"), "-w", "start"],
    { stdio: "ignore" },
  );
  const admin = socketUrl(dir, port, "postgres");
  spawnSync(bin("psql"), [admin, "-Atc", "CREATE DATABASE sjcos_test"], { stdio: "ignore" });
  const state = { dir, port, url: socketUrl(dir, port, "sjcos_test"), admin };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  return state;
}

export function clusterAlive(state) {
  if (!state?.dir || !existsSync(path.join(state.dir, "data"))) return false;
  const r = spawnSync(bin("pg_isready"), ["-h", state.dir, "-p", String(state.port)], { stdio: "ignore" });
  return r.status === 0;
}

export function stopCluster() {
  const state = readState();
  if (!state) return false;
  spawnSync(bin("pg_ctl"), ["-D", path.join(state.dir, "data"), "stop", "-m", "immediate"], { stdio: "ignore" });
  rmSync(state.dir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
  return true;
}

/** Drop and recreate sjcos_test, then load schema.sql + migrations. */
export async function resetDatabase(state) {
  assertNotProduction(state.url);
  spawnSync(bin("psql"), [state.admin, "-Atc", "DROP DATABASE IF EXISTS sjcos_test WITH (FORCE)"], { stdio: "ignore" });
  spawnSync(bin("psql"), [state.admin, "-Atc", "CREATE DATABASE sjcos_test"], { stdio: "ignore" });
  await loadSchema(state.url);
}

/** schema.sql (the historical baseline) then the ordered migration ledger. */
export async function loadSchema(url) {
  assertNotProduction(url);
  const r = spawnSync(bin("psql"), [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", path.join(REPO, "db", "schema.sql")], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`schema.sql failed to load on a fresh database:\n${(r.stderr || "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`);
  }
  const { migrate } = await import(path.join(REPO, "db", "migrate.mjs"));
  await migrate({ url, allowTestHarness: true, quiet: true });
}

/** Database name for the current test file: node --test runs each file in its
 *  own process, so process.argv[1] names the file. Every file gets its own
 *  database (created + loaded once per cluster), which is what lets files run
 *  concurrently without truncating each other's tables. */
export function dbNameForCurrentTest() {
  const f = process.argv[1] ? path.basename(process.argv[1]).replace(/\.test\.mjs$/, "") : "";
  const slug = f.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 40);
  return slug ? `sjcos_test_${slug}` : "sjcos_test";
}

/** The same cluster URL pointing at another database (admin = "postgres"). */
export function dbUrl(url, name) {
  return url.replace(/\/[^/?]+\?/, `/${name}?`);
}

function urlForDb(state, name) {
  return dbUrl(state.url, name);
}

/** Tests: one shared cluster per process tree, one database per test FILE
 *  (see dbNameForCurrentTest), migrations always brought up to date. The
 *  callback gets the url and an open pg.Client with SJC_OUTBOUND_DISABLED set. */
export async function withTestDb(fn, { fresh = false, name } = {}) {
  process.env.SJC_OUTBOUND_DISABLED = "1";
  const state = startCluster();
  const db = name ?? dbNameForCurrentTest();
  const url = urlForDb(state, db);
  assertNotProduction(url);
  const marker = path.join(state.dir, `schema-loaded-${db}`);
  if (fresh || !existsSync(marker)) {
    spawnSync(bin("psql"), [state.admin, "-Atc", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`], { stdio: "ignore" });
    spawnSync(bin("psql"), [state.admin, "-Atc", `CREATE DATABASE ${db}`], { stdio: "ignore" });
    await loadSchema(url);
    writeFileSync(marker, new Date().toISOString());
  } else {
    // A running cluster may predate a newly added migration file.
    const { migrate } = await import(path.join(REPO, "db", "migrate.mjs"));
    await migrate({ url, quiet: true });
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(url, client);
  } finally {
    await client.end();
  }
}

/** True when a harness cluster is reachable (tests skip otherwise, never
 *  silently pointing at production). */
export function harnessAvailable() {
  return existsSync(bin("initdb"));
}

/** Wipe the foundation tables (and any zz-* fixture rows) so each test starts
 *  from a known state without reloading the schema. */
export async function cleanFoundation(client) {
  await client.query(`TRUNCATE commands, action_intents, action_attempts, decisions, decision_deliveries, decision_events,
    source_events, policies, lane_pauses, authority_grants, owner_touches, workers RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM leads WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'zz-%'`);
}
