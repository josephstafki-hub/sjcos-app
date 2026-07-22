#!/usr/bin/env node
// End-to-end test for the newsletter agent WRITE path (MCP tool -> app internal
// route -> DB), run against a THROWAWAY side dev server so the live service and
// its `.next` are never touched.
//
//   node scripts/newsletter-write-test.mjs            # port 3019, dist .next-writetest
//   PORT=3021 node scripts/newsletter-write-test.mjs
//
// What it does, and why it's safe to run against the live DB:
//   • Spins up `next dev` on its OWN port with its OWN SJC_DIST_DIR (documented
//     side-server pattern in next.config.ts) — production stays up, untouched.
//   • Drives the REAL MCP write tools with APP_INTERNAL_URL pointed at that dev
//     server, exercising add/update/remove recipient + create/update/queue issue.
//   • Uses one obvious fixture address (mcp-writetest@example.com) and a marked
//     test issue, then DELETES both in a finally block and asserts every
//     newsletter_* table is back to its exact pre-test count.
//   • NOTHING is ever sent: queue only PARKS outbox rows, there is no armed drip,
//     and the parked greeting is never Released. No client is emailed.
//   (agent_runs gains a few 'mcp:newsletter' audit rows by design — that trail is
//    meant to persist and is NOT part of the baseline assertion.)

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3019);
const DIST = process.env.SJC_DIST_DIR || ".next-writetest";
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE_EMAIL = "mcp-writetest@example.com";
const TEST_ISSUE_TITLE = "MCP write test issue — safe to delete";

function envVal(key) {
  if (process.env[key]) return process.env[key];
  const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

const DATABASE_URL = envVal("DATABASE_URL");
const CRON_SECRET = envVal("CRON_SECRET");
if (!DATABASE_URL) throw new Error("DATABASE_URL not found in .env.local");
if (!CRON_SECRET) throw new Error("CRON_SECRET not set — the write route fails closed without it");

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny assert harness ──
let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push(name);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`);
  }
}

async function counts() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM newsletter_recipients)   AS recipients,
            (SELECT count(*)::int FROM newsletters)             AS issues,
            (SELECT count(*)::int FROM newsletter_outbox)       AS outbox,
            (SELECT count(*)::int FROM newsletter_subscriptions) AS subs`,
  );
  return rows[0];
}

/** Poll the dev server until the internal route answers (401 for an unauthed POST
 *  means it compiled and is reachable). Dev compiles routes lazily, so the first
 *  hit can take a while. */
async function waitForRoute(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/internal/newsletter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.status === 401) return true; // route exists + fails closed w/o auth
      if (res.status === 200 || res.status === 400) return true; // reachable
    } catch {
      /* not up yet */
    }
    await sleep(1500);
  }
  return false;
}

async function main() {
  const baseline = await counts();
  console.log("Baseline newsletter counts:", baseline);

  // ── start the side dev server ──
  console.log(`\nStarting side dev server on ${BASE} (dist=${DIST})…`);
  const dev = spawn(
    path.join(ROOT, "node_modules", ".bin", "next"),
    ["dev", "--hostname", "127.0.0.1", "--port", String(PORT)],
    { cwd: ROOT, env: { ...process.env, SJC_DIST_DIR: DIST }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let devLog = "";
  dev.stdout.on("data", (d) => (devLog += d));
  dev.stderr.on("data", (d) => (devLog += d));

  let mcp;
  let testIssueId = null;
  try {
    const ready = await waitForRoute();
    if (!ready) {
      console.error("Dev server never became ready. Last output:\n" + devLog.slice(-1500));
      throw new Error("dev server not ready");
    }
    console.log("Route reachable (401 on unauthed POST). Connecting MCP client…\n");

    // ── connect the REAL MCP server, pointed at the side dev server ──
    mcp = new Client({ name: "newsletter-write-test", version: "1.0.0" });
    await mcp.connect(
      new StdioClientTransport({
        command: "node",
        args: [path.join(ROOT, "mcp", "sjcos-mcp.mjs")],
        env: { ...process.env, APP_INTERNAL_URL: BASE },
      }),
    );

    const call = async (name, args = {}) => {
      const r = await mcp.callTool({ name, arguments: args });
      return JSON.parse(r.content[0].text);
    };

    console.log("── add_newsletter_recipient ──");
    const add = await call("add_newsletter_recipient", { email: FIXTURE_EMAIL, name: "MCP Write Test" });
    check("add returns ok", add.ok === true, JSON.stringify(add));
    // Postgres bigint ids serialize to JSON as strings — agents get a numeric
    // string and the tool schemas z.coerce them back. Accept either here.
    check("add returns an id", add.data?.id != null && Number.isFinite(Number(add.data.id)));
    check("enrolledDrips=false (no armed sequence)", add.data?.enrolledDrips === false);

    console.log("── list_newsletter_recipients ──");
    const list = await call("list_newsletter_recipients");
    const mine = Array.isArray(list) ? list.find((r) => r.email === FIXTURE_EMAIL) : null;
    check("fixture is on the list", !!mine, JSON.stringify(list));
    check("fixture is active", mine?.active === true);

    console.log("── list_newsletter_outbox (greeting parked) ──");
    const ob1 = await call("list_newsletter_outbox");
    const greeting = Array.isArray(ob1) ? ob1.find((o) => o.email === FIXTURE_EMAIL && o.kind === "greeting") : null;
    check("welcome greeting was parked", !!greeting);
    check("greeting is queued, NOT sent", greeting?.status === "queued", JSON.stringify(greeting));

    console.log("── update_newsletter_recipient (rename + deactivate) ──");
    const upd = await call("update_newsletter_recipient", { email: FIXTURE_EMAIL, name: "MCP WT Renamed", active: false });
    check("update returns ok", upd.ok === true, JSON.stringify(upd));
    check("name changed", upd.data?.name === "MCP WT Renamed");
    check("active flipped to false", upd.data?.active === false);

    console.log("── create_newsletter_issue ──");
    const created = await call("create_newsletter_issue", {});
    check(
      "create returns ok + id",
      created.ok === true && created.data?.id != null && Number.isFinite(Number(created.data.id)),
      JSON.stringify(created),
    );
    testIssueId = Number(created.data?.id);

    console.log("── update_newsletter_issue (title/intro/blocks) ──");
    const edit = await call("update_newsletter_issue", {
      id: testIssueId,
      title: TEST_ISSUE_TITLE,
      intro: "This is an automated write-path test.",
      blocks: [{ kind: "text", heading: "Hello", body: "World from the write test." }],
    });
    check("update_issue returns ok", edit.ok === true, JSON.stringify(edit));

    console.log("── get_newsletter_issue (verify persisted) ──");
    const got = await call("get_newsletter_issue", { id: testIssueId });
    check("title persisted", got.title === TEST_ISSUE_TITLE, JSON.stringify(got));
    check("one block persisted", Array.isArray(got.blocks) && got.blocks.length === 1);
    check("status still draft", got.status === "draft");

    console.log("── reactivate fixture so there's an active recipient to queue for ──");
    const react = await call("update_newsletter_recipient", { email: FIXTURE_EMAIL, active: true });
    check("reactivate ok", react.ok === true && react.data?.active === true);

    console.log("── queue_newsletter_issue (parks, does NOT send) ──");
    const queued = await call("queue_newsletter_issue", { id: testIssueId });
    check("queue returns ok", queued.ok === true, JSON.stringify(queued));
    check("queued >= 1", (queued.data?.queued ?? 0) >= 1);

    console.log("── list_newsletter_outbox (issue row parked, queued) ──");
    const ob2 = await call("list_newsletter_outbox");
    const issueRow = Array.isArray(ob2)
      ? ob2.find((o) => o.email === FIXTURE_EMAIL && o.kind === "issue" && o.issue_title === TEST_ISSUE_TITLE)
      : null;
    check("issue send was parked for the fixture", !!issueRow, JSON.stringify(ob2));
    check("parked issue is queued, NOT released", issueRow?.status === "queued");

    console.log("── negative: queue a non-existent issue is rejected ──");
    const bad = await call("queue_newsletter_issue", { id: 999999999 });
    check("bad queue returns ok:false with an error", bad.ok === false && typeof bad.error === "string", JSON.stringify(bad));

    // ── confirm no real send happened at any point ──
    const { rows: rel } = await pool.query(
      `SELECT count(*)::int AS n FROM newsletter_outbox WHERE status = 'released'`,
    );
    check("ZERO outbox rows were released (nothing mailed)", rel[0].n === 0);
  } finally {
    // ── teardown: remove every fixture, restore baseline ──
    console.log("\nTearing down fixtures…");
    try {
      if (testIssueId != null) {
        // ON DELETE CASCADE drops this issue's parked outbox rows with it.
        await pool.query(`DELETE FROM newsletters WHERE id = $1`, [testIssueId]);
      }
      await pool.query(`DELETE FROM newsletter_outbox WHERE email = $1`, [FIXTURE_EMAIL]);
      await pool.query(`DELETE FROM newsletter_recipients WHERE email = $1`, [FIXTURE_EMAIL]);
    } catch (e) {
      console.error("Teardown error:", e.message);
    }
    if (mcp) await mcp.close().catch(() => {});
    dev.kill("SIGTERM");
    await sleep(800);
    if (!dev.killed) dev.kill("SIGKILL");
  }

  // ── baseline restored? ──
  const after = await counts();
  console.log("\nPost-test newsletter counts:", after);
  const restored =
    after.recipients === baseline.recipients &&
    after.issues === baseline.issues &&
    after.outbox === baseline.outbox &&
    after.subs === baseline.subs;
  check("newsletter tables restored to baseline", restored, `baseline=${JSON.stringify(baseline)} after=${JSON.stringify(after)}`);

  await pool.end();

  console.log(`\n${failures.length ? "\x1b[31m" : "\x1b[32m"}${passed} passed, ${failures.length} failed\x1b[0m`);
  if (failures.length) {
    console.log("Failed:", failures.join(" | "));
    process.exit(1);
  }
  console.log("Write path OK — nothing was emailed, DB is back to baseline.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
