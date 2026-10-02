// Headless Claude runner for BUSINESS-profile operating-agent runs (A24).
//
// Spawns the logged-in `claude` CLI exactly like scripts/run-claude-agent.mjs
// does for the Ask window, restricted to the business profile
// (lib/authority/run-profile.mjs): no Bash / Write / Edit / WebFetch /
// WebSearch / Task, cwd = a scratch dir, --restricted, --strict-mcp-config with
// ONE MCP server — sjcos — whose DATABASE_URL comes from the env we pass, so
// evaluations can point the very same runner at the disposable harness.
// SJC_PRINCIPAL_USER_ID is never set: an unattended run has no person behind
// it and can spend no owner grant.
//
// Returns the parsed stream-json: result text, tool trace (mcp__sjcos__* tool
// uses with their results), the tool list from the init event, usage/cost,
// duration, session id. Never throws for a model failure — the caller records
// the outcome; a spawn failure rejects.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUSINESS_DISALLOWED_TOOLS, BUSINESS_DEFAULT_MAX_TURNS, BUSINESS_DEFAULT_TIMEOUT_MS, assertBusinessArgs } from "../authority/run-profile.mjs";
import { toolListChecksum } from "./instructions-block.mjs";

const VALID_MODEL = /^[a-z][a-z0-9.-]*(\[1m\])?$/i;

/** The MCP config for one run: sjcos only, env-scoped database. */
export function businessMcpConfig({ repo, databaseUrl, outboundDisabled, appInternalUrl, cronSecret, agentName, extraEnv }) {
  const env = {
    DATABASE_URL: databaseUrl,
    SJCOS_AGENT_NAME: agentName ?? "business-agent",
    SJC_AGENT: agentName ?? "business-agent",
    ...(outboundDisabled ? { SJC_OUTBOUND_DISABLED: "1" } : {}),
    // The MCP server reads APP_INTERNAL_URL / CRON_SECRET from env FIRST, then
    // .env.local. Evaluations set both to dead values so a harness run can
    // never reach the live app's internal routes (grants, notify, drafts).
    ...(appInternalUrl ? { APP_INTERNAL_URL: appInternalUrl } : {}),
    ...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
    ...(extraEnv ?? {}),
  };
  return { mcpServers: { sjcos: { command: "node", args: [path.join(repo, "mcp/sjcos-mcp.mjs")], env } } };
}

/**
 * Run one business turn.
 *   prompt          full prompt (instruction block + context + task)
 *   model           CLI --model alias/id or "" for the CLI default
 *   maxTurns        --max-turns cap
 *   timeoutMs       hard kill
 *   repo            repo root (for mcp/sjcos-mcp.mjs)
 *   databaseUrl     what the sjcos MCP server connects to
 *   outboundDisabled  set SJC_OUTBOUND_DISABLED=1 for the MCP child
 *   appInternalUrl / cronSecret  override the MCP server's app route target
 *   askTimeoutS     how long ask_owner may block (short for unattended runs)
 *   maxBudgetUsd    optional --max-budget-usd
 *   onActivity(line) optional progress callback
 */
export async function runClaudeBusiness(opts) {
  const {
    prompt,
    model = "",
    maxTurns = BUSINESS_DEFAULT_MAX_TURNS,
    timeoutMs = BUSINESS_DEFAULT_TIMEOUT_MS,
    repo,
    databaseUrl,
    outboundDisabled = process.env.SJC_OUTBOUND_DISABLED === "1",
    appInternalUrl,
    cronSecret,
    askTimeoutS = 60,
    maxBudgetUsd = null,
    agentName = "business-agent",
    claudeBin = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
    onActivity,
    effort,
  } = opts;
  if (!repo) throw new Error("repo is required");
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (model && !VALID_MODEL.test(model)) throw new Error(`refusing --model value: ${model}`);

  const scratch = mkdtempSync(path.join(tmpdir(), "sjc-agent-"));
  const mcp = businessMcpConfig({ repo, databaseUrl, outboundDisabled, appInternalUrl, cronSecret, agentName });
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--restricted",
    "--disallowedTools",
    BUSINESS_DISALLOWED_TOOLS.join(" "),
    "--add-dir",
    path.join(repo, "docs/automation-reliability"),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify(mcp),
    "--allowedTools",
    "mcp__sjcos",
    "--max-turns",
    String(maxTurns),
  ];
  if (maxBudgetUsd != null && Number(maxBudgetUsd) > 0) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (model) args.push("--model", model);
  if (effort && ["low", "medium", "high", "xhigh", "max"].includes(effort)) args.push("--effort", effort);
  assertBusinessArgs(args, repo);

  // Minimal env: the CLI needs HOME/PATH for its login; nothing from .env.local.
  const childEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    USER: process.env.USER,
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: "dumb",
    SJC_AGENT: agentName,
    SJC_ASK_DEFAULT_TIMEOUT_S: String(askTimeoutS),
    SJC_ASK_MAX_TIMEOUT_S: String(Math.max(askTimeoutS, 30)),
    MCP_TOOL_TIMEOUT: String(Math.max(askTimeoutS * 1000 + 30_000, 120_000)),
    ...(process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {}),
    ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
  };

  const startedAt = Date.now();
  const trace = [];
  const pending = new Map();
  let toolNames = [];
  let resultEvent = null;
  let lastAssistantText = "";
  let sessionId = null;
  let assistantTurns = 0;
  let stderr = "";
  let killed = false;

  const handle = (evt) => {
    if (evt?.session_id) sessionId = evt.session_id;
    if (evt?.type === "system" && evt.subtype === "init") {
      toolNames = Array.isArray(evt.tools) ? evt.tools.map(String) : [];
      onActivity?.(`init: ${toolNames.filter((t) => t.startsWith("mcp__sjcos__")).length} sjcos tools`);
    }
    if (evt?.type === "assistant" && Array.isArray(evt.message?.content)) {
      assistantTurns++;
      for (const block of evt.message.content) {
        if (block.type === "text" && block.text) lastAssistantText = String(block.text);
        if (block.type === "tool_use") {
          const m = /^mcp__sjcos__(.+)$/.exec(block.name ?? "");
          const tool = m ? m[1] : String(block.name ?? "?");
          const entry = { seq: trace.length + 1, tool, input: block.input ?? null, result: null, is_error: false, at: new Date().toISOString() };
          trace.push(entry);
          if (block.id) pending.set(block.id, entry);
          onActivity?.(`tool ${tool}`);
        }
      }
    }
    if (evt?.type === "user" && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block?.type !== "tool_result") continue;
        const entry = block.tool_use_id ? pending.get(block.tool_use_id) : null;
        if (!entry) continue;
        pending.delete(block.tool_use_id);
        const text = Array.isArray(block.content) ? block.content.map((c) => (c && c.type === "text" ? c.text : "")).join("") : typeof block.content === "string" ? block.content : "";
        entry.result = text.slice(0, 4000);
        entry.is_error = !!block.is_error || /^Error:/.test(text);
      }
    }
    if (evt?.type === "result") resultEvent = evt;
  };

  await new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { cwd: scratch, env: childEnv });
    let buf = "";
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          /* partial line */
        }
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* scratch cleanup is best-effort */
  }

  const durationMs = Date.now() - startedAt;
  const ok = !!resultEvent && !resultEvent.is_error && (resultEvent.subtype ?? "success") === "success";
  const errorText = killed
    ? `timeout after ${Math.round(timeoutMs / 1000)}s`
    : !resultEvent
      ? `claude ended without a result${stderr ? `: ${stderr.trim().slice(-400)}` : ""}`
      : ok
        ? null
        : String(resultEvent.result || lastAssistantText || resultEvent.subtype || "error").slice(0, 600);
  return {
    ok,
    timedOut: killed,
    resultText: String(resultEvent?.result ?? lastAssistantText ?? ""),
    error: errorText,
    trace,
    toolNames,
    toolListChecksum: toolListChecksum(toolNames.filter((t) => t.startsWith("mcp__sjcos__"))),
    costUsd: typeof resultEvent?.total_cost_usd === "number" ? resultEvent.total_cost_usd : null,
    durationMs,
    numTurns: typeof resultEvent?.num_turns === "number" ? resultEvent.num_turns : assistantTurns,
    sessionId,
    model: modelFromUsage(resultEvent) ?? model ?? null,
    usage: resultEvent?.usage ?? null,
    stderr: stderr.trim().slice(-2000),
  };
}

function modelFromUsage(resultEvent) {
  const mu = resultEvent?.modelUsage;
  if (mu && typeof mu === "object") {
    const keys = Object.keys(mu);
    if (keys.length) return keys.join("+");
  }
  return null;
}
