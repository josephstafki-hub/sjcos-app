#!/usr/bin/env node
// Background operating-agent worker (A24). Run by the sjcos-agent-worker
// systemd user timer every 3 minutes with --once, or by hand.
//
//   node scripts/run-business-agent.mjs --once            # sweep + claim up to --limit triggers and run them
//   node scripts/run-business-agent.mjs --sweep-only      # only re-queue stranded leases
//   node scripts/run-business-agent.mjs --dry-run <id>    # print the assembled prompt for one trigger, run nothing
//   node scripts/run-business-agent.mjs --status          # pending/leased triggers + last executions
//   node scripts/run-business-agent.mjs --once --kinds filing --drain
//                                                         # only those kinds, passes until none are left
//                                                         # (the app starts this the moment Joe sorts a
//                                                         # document on /unsorted — lib/agent-kick.ts)
//
// Options: --limit N (default 2) --runtime claude|hermes (default claude, or
// SJC_AGENT_RUNTIME) --model <alias> (default SJC_AGENT_MODEL or the CLI's
// default) --max-turns N --timeout-ms N.
//
// Filing runs (kind 'filing': finish a document Joe just sorted) are small and
// run on a cheap model: SJC_FILING_AGENT_MODEL (default "haiku"), 15 turns.
//
// Database: the narrow sjcos_agent login (deploy/db-roles.md) — DATABASE_URL_AGENT
// from the environment or .env.local, falling back to DATABASE_URL until Joe
// adds that line. Evaluations pass DATABASE_URL (the harness) explicitly, which
// beats the file (lib/db-login.mjs).
//
// Claude runs go through lib/agent-runtime/claude-runner.mjs: the logged-in
// `claude` CLI, business profile (no shell / edits / web), --strict-mcp-config
// with only the sjcos server, whose DATABASE_URL is the one this process uses.
// SJC_PRINCIPAL_USER_ID is never set: unattended runs spend no owner grant.

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkerOnce, processTrigger, WORKER_NAME } from "../lib/agent-runtime/worker.ts";
import { getAgentTrigger, listPendingTriggers, sweepStrandedTriggers } from "../lib/agent-runtime/triggers.ts";
import { enqueueMissingFinancials } from "../lib/workflow/financials-fill.ts";
import { buildBusinessInstructions } from "../lib/agent-runtime/instructions.ts";
import { runClaudeBusiness } from "../lib/agent-runtime/claude-runner.mjs";
import { runHermesBusiness } from "../lib/agent-runtime/hermes-runner.mjs";
import { databaseUrlFor } from "../lib/db-login.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(name);

// The narrow agent login (deploy/db-roles.md): DATABASE_URL_AGENT, else an
// explicit DATABASE_URL (harness / evals), else .env.local — see lib/db-login.mjs.
// The same URL goes to the MCP server each run spawns.
function databaseUrl() {
  return databaseUrlFor("agent", { envFile: path.join(REPO, ".env.local") });
}

export const FILING_MODEL = process.env.SJC_FILING_AGENT_MODEL || "haiku";

/** Per-kind run shape: permit research gets the web and more turns; filling a
 *  job's financials is many tool calls (one per cost); filing a sorted
 *  document is a few tool calls on the cheap model. */
function runShape(kind, { model, maxTurns, timeoutMs }) {
  if (kind === "permit") return { model: model ?? "", maxTurns: Math.max(Number(maxTurns) || 0, 80), timeoutMs, webResearch: true };
  if (kind === "financials") return { model: model ?? "", maxTurns: Math.max(Number(maxTurns) || 0, 100), timeoutMs: Math.max(Number(timeoutMs) || 0, 20 * 60 * 1000), webResearch: false }; // under the service's 25-min cap
  if (kind === "filing") return { model: FILING_MODEL, maxTurns: 15, timeoutMs: Math.min(Number(timeoutMs) || 0, 5 * 60 * 1000) || 5 * 60 * 1000, webResearch: false };
  return { model: model ?? "", maxTurns, timeoutMs, webResearch: false };
}

export function makeRunners({ url, model, maxTurns, timeoutMs, appInternalUrl, cronSecret, askTimeoutS, onActivity }) {
  return {
    claude: {
      name: "claude",
      run: ({ prompt, trigger }) =>
        runClaudeBusiness({ prompt, ...runShape(trigger?.kind, { model, maxTurns, timeoutMs }), repo: REPO, databaseUrl: url, appInternalUrl, cronSecret, askTimeoutS, onActivity, agentName: trigger?.kind === "filing" ? "claude-filing" : undefined }),
    },
    hermes: {
      name: "hermes",
      run: ({ prompt, systemBlock }) => runHermesBusiness({ prompt, systemBlock, timeoutMs }),
    },
  };
}

async function main() {
  const url = databaseUrl();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const direct = async (sql, params) => (await pool.query(sql, params)).rows;
  const tx = async (fn) => {
    const c = await pool.connect();
    const run = async (sql, params) => (await c.query(sql, params)).rows;
    try {
      await c.query("BEGIN");
      const out = await fn(run);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };
  const log = (l) => console.log(`[${new Date().toISOString()}] ${l}`);
  try {
    if (has("--status")) {
      const pending = await listPendingTriggers(direct, 30);
      console.log(`pending/leased triggers: ${pending.length}`);
      for (const t of pending) console.log(`  ${t.id} ${t.state} ${t.kind}:${t.ref} attempts ${t.attempts}/${t.max_attempts} next ${t.next_attempt_at}`);
      const ex = await direct(`SELECT id, trigger_kind, trigger_ref, status, runtime, model, latency_ms, cost_usd, started_at::text AS started_at, blocked_reason FROM agent_executions ORDER BY started_at DESC LIMIT 10`);
      console.log(`last executions: ${ex.length}`);
      for (const e of ex) console.log(`  ${e.started_at} ${e.status} ${e.trigger_kind}:${e.trigger_ref} ${e.runtime}/${e.model ?? "-"} ${e.latency_ms ?? "?"}ms $${e.cost_usd ?? "?"}${e.blocked_reason ? ` blocked: ${e.blocked_reason}` : ""}`);
      return;
    }
    if (has("--sweep-only")) {
      const r = await tx((run) => sweepStrandedTriggers(run));
      log(`sweep: ${JSON.stringify(r)}`);
      return;
    }
    if (has("--dry-run")) {
      const id = arg("--dry-run");
      const t = await getAgentTrigger(direct, id);
      if (!t) throw new Error(`no trigger ${id}`);
      const built = await buildBusinessInstructions(direct, { projectId: t.project_id, leadId: t.lead_id, trigger: { kind: t.kind, ref: t.ref, payload: t.payload }, principal: { kind: "agent", label: "unattended business agent" } });
      console.log(built.prompt);
      console.error(`\n[versions] ${JSON.stringify(built.versions)}\n[context] ${built.context.chars} chars, ${built.context.refs.length} refs`);
      return;
    }
    const runtime = arg("--runtime", process.env.SJC_AGENT_RUNTIME ?? "claude");
    const model = arg("--model", process.env.SJC_AGENT_MODEL ?? "") || null;
    const runners = makeRunners({
      url,
      model,
      maxTurns: Number(arg("--max-turns", process.env.SJC_AGENT_MAX_TURNS ?? 40)),
      timeoutMs: Number(arg("--timeout-ms", process.env.SJC_AGENT_TIMEOUT_MS ?? 15 * 60 * 1000)),
      appInternalUrl: process.env.APP_INTERNAL_URL,
      cronSecret: process.env.CRON_SECRET,
      askTimeoutS: Number(process.env.SJC_ASK_DEFAULT_TIMEOUT_S ?? 60),
      onActivity: (l) => log(`  ${l}`),
    });
    const runner = runners[runtime];
    if (!runner) throw new Error(`unknown runtime ${runtime}`);
    const single = arg("--trigger");
    if (single) {
      const t = await getAgentTrigger(direct, single);
      if (!t) throw new Error(`no trigger ${single}`);
      const [leased] = await tx((run) => run(`UPDATE agent_triggers SET state='leased', lease_token=$2, lease_until=now()+interval '15 minutes', attempts=attempts+1 WHERE id=$1 RETURNING *`, [t.id, `${WORKER_NAME}:manual`]));
      const out = await processTrigger(tx, direct, leased, { runner, model, onLog: log });
      await tx((run) => run(`UPDATE agent_triggers SET state=$3, lease_token=NULL, lease_until=NULL, done_at=CASE WHEN $3='done' THEN now() END, last_execution_id=$2 WHERE id=$1`, [t.id, out.executionId, out.status === "done" || out.status === "blocked" ? "done" : "pending"]));
      log(`done: ${JSON.stringify({ executionId: out.executionId, status: out.status })}`);
      return;
    }
    // Construction jobs whose budget isn't finished and never had a financials
    // run get one (lib/workflow/financials-fill.ts) — a few at a time.
    const caught = await tx((run) => enqueueMissingFinancials(run, { limit: 2 }));
    if (caught.length) log(`financials catch-up queued ${caught.length} job(s)`);
    const kinds = arg("--kinds", "") ? arg("--kinds").split(",").map((k) => k.trim()).filter(Boolean) : null;
    // --drain: keep taking passes while there is work of these kinds (bounded).
    for (let pass = 0; pass < (has("--drain") ? 25 : 1); pass++) {
      const report = await runWorkerOnce(tx, direct, { runner, model, kinds, limit: Number(arg("--limit", 2)), onLog: log });
      log(`pass complete: ${JSON.stringify({ claimed: report.claimed, done: report.done, blocked: report.blocked, failed: report.failed, swept: report.swept, lane: report.lane })}`);
      if (!report.claimed || !report.lane.open) break;
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
