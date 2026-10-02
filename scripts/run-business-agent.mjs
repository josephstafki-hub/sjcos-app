#!/usr/bin/env node
// Background operating-agent worker (A24). Run by the sjcos-agent-worker
// systemd user timer every 3 minutes with --once, or by hand.
//
//   node scripts/run-business-agent.mjs --once            # sweep + claim up to --limit triggers and run them
//   node scripts/run-business-agent.mjs --sweep-only      # only re-queue stranded leases
//   node scripts/run-business-agent.mjs --dry-run <id>    # print the assembled prompt for one trigger, run nothing
//   node scripts/run-business-agent.mjs --status          # pending/leased triggers + last executions
//
// Options: --limit N (default 2) --runtime claude|hermes (default claude, or
// SJC_AGENT_RUNTIME) --model <alias> (default SJC_AGENT_MODEL or the CLI's
// default) --max-turns N --timeout-ms N.
//
// Database: DATABASE_URL from the environment first, else .env.local next to
// the repo (the production path when the timer runs it). Evaluations always
// pass DATABASE_URL (the harness) explicitly.
//
// Claude runs go through lib/agent-runtime/claude-runner.mjs: the logged-in
// `claude` CLI, business profile (no shell / edits / web), --strict-mcp-config
// with only the sjcos server, whose DATABASE_URL is the one this process uses.
// SJC_PRINCIPAL_USER_ID is never set: unattended runs spend no owner grant.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkerOnce, processTrigger, WORKER_NAME } from "../lib/agent-runtime/worker.ts";
import { getAgentTrigger, listPendingTriggers, sweepStrandedTriggers } from "../lib/agent-runtime/triggers.ts";
import { buildBusinessInstructions } from "../lib/agent-runtime/instructions.ts";
import { runClaudeBusiness } from "../lib/agent-runtime/claude-runner.mjs";
import { runHermesBusiness } from "../lib/agent-runtime/hermes-runner.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(name);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(REPO, ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

export function makeRunners({ url, model, maxTurns, timeoutMs, appInternalUrl, cronSecret, askTimeoutS, onActivity }) {
  return {
    claude: {
      name: "claude",
      run: ({ prompt }) =>
        runClaudeBusiness({ prompt, model: model ?? "", maxTurns, timeoutMs, repo: REPO, databaseUrl: url, appInternalUrl, cronSecret, askTimeoutS, onActivity }),
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
    const report = await runWorkerOnce(tx, direct, { runner, model, limit: Number(arg("--limit", 2)), onLog: log });
    log(`pass complete: ${JSON.stringify({ claimed: report.claimed, done: report.done, blocked: report.blocked, failed: report.failed, swept: report.swept, lane: report.lane })}`);
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
