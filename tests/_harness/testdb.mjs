import {bootstrapDeployment} from '../../lib/ask-deployment-state.mjs';
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

// A test process represents an explicitly new deployment. Never use the
// real protected state directory, and never bootstrap during request handling.
const askDeploymentDir=mkdtempSync(path.join(tmpdir(),'sjc-test-deployment-'));
process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=askDeploymentDir;
await bootstrapDeployment(askDeploymentDir);
process.once('exit',()=>rmSync(askDeploymentDir,{recursive:true,force:true}));

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

/** The narrow database logins (deploy/db-roles.md), created cluster-wide
 *  BEFORE a database loads its schema so the grant migrations (0060 onward)
 *  grant for real, as in production after Joe's bootstrap. LOGIN in the disposable socket-only trust cluster; withLogin proves both
 *  session_user/current_user. Older tests may still use urlAsRole. */
export const DB_ROLES = ["sjcos_agent", "sjcos_worker", "sjcos_readonly", "sjcos_backup", "sjcos_browser"];
export function ensureDbRoles(state) {
  const sql = `DO $$ DECLARE r text; BEGIN
    FOREACH r IN ARRAY ARRAY[${DB_ROLES.map((r) => `'${r}'`).join(", ")}] LOOP
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I LOGIN', r); END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; -- a parallel test file made it first
      END;
    END LOOP; END $$`;
  spawnSync(bin("psql"), [state.admin, "-Atqc", sql], { stdio: "ignore" });
}

/** A harness URL whose every connection runs as `role` (SET ROLE at connect). */
export function urlAsRole(url, role) {
  return `${url}&options=${encodeURIComponent(`-c role=${role}`)}`;
}

/** Drop and recreate sjcos_test, then load schema.sql + migrations. */
export async function resetDatabase(state) {
  assertNotProduction(state.url);
  spawnSync(bin("psql"), [state.admin, "-Atc", "DROP DATABASE IF EXISTS sjcos_test WITH (FORCE)"], { stdio: "ignore" });
  spawnSync(bin("psql"), [state.admin, "-Atc", "CREATE DATABASE sjcos_test"], { stdio: "ignore" });
  ensureDbRoles(state);
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
    ensureDbRoles(state);
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

/** Real login-identity fixture, ONLY in an assertNotProduction harness cluster.
 * SET ROLE alone cannot exercise SECURITY DEFINER/session_user guards. */
export async function withSessionIdentity(url, identity, callback) {
  assertNotProduction(url);
  const identities = {
    sjcos_agent: 'SET SESSION AUTHORIZATION sjcos_agent',
    sjcos_worker: 'SET SESSION AUTHORIZATION sjcos_worker',
    sjcos_readonly: 'SET SESSION AUTHORIZATION sjcos_readonly',
    sjcos_browser: 'SET SESSION AUTHORIZATION sjcos_browser',
    sjcos_test_website: 'SET SESSION AUTHORIZATION sjcos_test_website',
  };
  if (!Object.hasOwn(identities, identity)) throw new Error('unsupported test session identity');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // A distinct non-superuser table owner represents the website. Never
    // whitelist sjctest (the harness administrator) as production authority.
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_test_website') THEN CREATE ROLE sjcos_test_website LOGIN NOSUPERUSER; END IF;
    END $$`);
    await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO sjcos_test_website`);
    await client.query(`DO $$ DECLARE obj record; BEGIN
      FOR obj IN SELECT c.oid::regclass AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','S') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') ORDER BY c.relkind='S'
      LOOP
        IF obj.relkind='S' THEN EXECUTE format('ALTER SEQUENCE %s OWNER TO sjcos_test_website',obj.name);
        ELSIF obj.relkind='v' THEN EXECUTE format('ALTER VIEW %s OWNER TO sjcos_test_website',obj.name);
        ELSE EXECUTE format('ALTER TABLE %s OWNER TO sjcos_test_website',obj.name); END IF;
      END LOOP;
      FOR obj IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
      LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO sjcos_test_website',obj.name); END LOOP;
    END $$`);
    await client.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_policy WHERE polname='browser_phase1_bound_thread') THEN ALTER POLICY browser_phase1_bound_thread ON ai_conversations TO sjcos_test_website; END IF; END $$`);
    await client.query(identities[identity]);
    const proof = (await client.query('SELECT session_user, current_user')).rows[0];
    if (proof.session_user !== identity || proof.current_user !== identity) throw new Error('session identity fixture failed');
    return await callback(client, proof);
  } finally {
    await client.query('RESET SESSION AUTHORIZATION').catch(() => {});
    await client.end();
  }
}

/** Test-only subset ledger. Starts BEFORE feature snapshots; applies exact
 * production SQL/checksums, one transaction + real ledger insertion per file.
 * Never edits the shared migration directory or fabricates applied rows. */
export async function withMigrationSubset(name, featureIds, callback) {
 if(!/^[a-z0-9_]+$/.test(name)||!featureIds.every(n=>Number.isInteger(n)&&n>=100&&n<=115))throw Error('invalid subset fixture');
 const state=startCluster();ensureDbRoles(state);
 const db=`sjcos_subset_${name}`,url=dbUrl(state.url,db);assertNotProduction(url);
 const admin=new pg.Client({connectionString:state.admin});await admin.connect();
 await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);await admin.query(`CREATE DATABASE ${db}`);await admin.end();
 const c=new pg.Client({connectionString:url});await c.connect();
 try{
  const baseline=readFileSync(path.join(REPO,'db/schema.sql'),'utf8').split('-- 0100 additive snapshot')[0];
  await c.query(baseline);
  const {listMigrationFiles}=await import('../../db/migrate.mjs');
  await c.query(`CREATE TABLE schema_migrations(id integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
  const apply=async ids=>{
   const files=listMigrationFiles();
   const missing=ids.filter(id=>!files.some(f=>f.id===id));
   if(missing.length)throw Error(`Requested migrations do not exist: ${missing.join(', ')}`);
   for(const f of files.filter(f=>ids.includes(f.id))){
    const old=(await c.query('SELECT checksum FROM schema_migrations WHERE id=$1',[f.id])).rows[0];
    if(old){if(old.checksum!==f.checksum)throw Error('migration checksum mismatch');continue;}
    await c.query('BEGIN');try{await c.query(f.sql);await c.query('INSERT INTO schema_migrations(id,name,checksum) VALUES($1,$2,$3)',[f.id,f.name,f.checksum]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
   }
  };
  await apply(listMigrationFiles().filter(f=>f.id<100).map(f=>f.id));
  await callback({url,db:c,apply:ids=>apply(ids??featureIds),featureIds});
 }finally{await c.end();}
}

/** An actual LOGIN connection; no SET ROLE / session-authorization shortcut. */
export async function withLogin(url,role,fn){
 assertNotProduction(url);
 if(![...DB_ROLES,'sjcos_test_website','sjcos_test_public'].includes(role))throw Error('unsupported login');
 const u=new URL(url);u.username=role;u.password='';u.searchParams.delete('options');
 const c=new pg.Client({connectionString:u.href});await c.connect();
 try{const proof=(await c.query('SELECT session_user,current_user')).rows[0];if(proof.session_user!==role||proof.current_user!==role)throw Error('LOGIN identity mismatch');return await fn(c,proof);}finally{await c.end();}
}
