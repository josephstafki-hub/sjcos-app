#!/usr/bin/env node
// Detached runner for a single Claude turn (Ask window → "Claude").
//
// Invoked by lib/dev-agents.ts startClaudeRun() as:
//     node scripts/run-claude-agent.mjs <dev_agent_runs.id>
// cwd = the sjcos-app repo root. Runs headless `claude -p` via the logged-in
// CLI (not the API), then writes the result back onto the row so the chat can
// poll it. Claude here is Joe's full in-app operator: it has the sjcos
// business tools (every action any agent can take — leads, projects, bids,
// POs, selections, newsletter, knowledge, work queue…) AND edit access to this
// repo. Client-facing sends need Joe's express permission: a run-scoped owner
// grant (dev_agent_runs.grant_id, from the Ask window's checkbox) or one Joe
// approves on /engine/permissions — see lib/owner-grants.ts.
//
// We stream `--output-format stream-json` so the chat can show what Claude is
// doing live (reading/editing/thinking) via the row's `activity` column, and
// honour the per-run model / mode / effort chosen in the Ask window.

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";

const REPO = process.cwd();
const RUN_ID = process.argv[2];
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;
const ENV_MODEL = process.env.DEV_CLAUDE_MODEL ?? ""; // "" → the CLI's configured default
const TIMEOUT_MS = Number(process.env.DEV_CLAUDE_TIMEOUT_MS ?? 480_000); // 8 min

// ── env / db ────────────────────────────────────────────────────────────────
function envFromFile(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(path.join(REPO, ".env.local"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const client = new pg.Client({ connectionString: envFromFile("DATABASE_URL") });

async function finish(status, answer, costUsd) {
  await client.query(
    `UPDATE dev_agent_runs
        SET status = $2, answer = $3, cost_usd = $4, updated_at = now()
      WHERE id = $1`,
    [RUN_ID, status, answer, costUsd ?? null],
  );
}

// ── prompt assembly ───────────────────────────────────────────────────────
// Effort is a real CLI flag (`--effort <level>`); we only pass it when the
// stored value is one the CLI accepts, so "default"/legacy values are a no-op.
const VALID_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);
// mode values are the exact --permission-mode strings; pass through when valid,
// else fall back to acceptEdits (also maps the legacy "edit" value).
const VALID_MODE = new Set(["acceptEdits", "plan", "auto", "bypassPermissions", "manual", "dontAsk"]);
const permissionMode = (mode) => (VALID_MODE.has(mode) ? mode : "acceptEdits");

// On a RESUMED session the CLI already holds Claude's own turns, so we send
// only the new turn (plus the current page, which may have changed) — and, in
// an 'auto' thread, whatever other assistants said in between (`unseen`).
function resumePrompt(userPrompt, pageContext, unseen, grantId) {
  const where = pageContext ? `(I'm now looking at route ${pageContext}.)\n` : "";
  const between = unseen
    ? `${unseen}\n\n(Those turns happened in this same chat thread since your last reply — ` +
      `other assistants answered them. Joe's new message below may be replying to them.)\n\n`
    : "";
  // Permission is per message: restate it (or its absence) on every turn so a
  // grant from an earlier message is never assumed to still apply.
  return where + between + `[${grantText(grantId)}]\n\n` + userPrompt;
}

// The owner-grant paragraph: with a run grant, Claude may send what the
// message asks for; without one, it stages and asks (or requests a grant).
function grantText(grantId) {
  return grantId
    ? `EXPRESS PERMISSION: Joe ticked "Express permission (sends)" on this message. Owner grant id: ${grantId}. ` +
      `Pass it as owner_grant_id to the send tools (send_bid_package, send_purchase_order, send_invoice, ` +
      `release_newsletter_issue, send_document_for_signature, send_email…) for exactly the sends this message ` +
      `asks for — nothing else. The grant expires with this turn and every use is audited.`
    : `SENDS NEED PERMISSION: client-/vendor-facing sends (bid packages, POs, invoices, documents for signature, ` +
      `newsletter release, one-off email) require an owner grant. Joe did not give one on this message, so stage ` +
      `the work, then either tell Joe it's ready (he can re-send with "Express permission" ticked) or call ` +
      `request_owner_permission with a specific reason and say you're waiting on his approval. Never try to ` +
      `send around the grant.`;
}

function buildPrompt(userPrompt, pageContext, mode, unseen, grantId) {
  const where = pageContext
    ? `Joe is looking at this app route: ${pageContext}\n` +
      `If the request is about the code behind it, find the source that renders it (start from app${pageContext === "/" ? "/page.tsx" : pageContext + "/page.tsx"} and the components/lib it imports) before changing anything.\n\n`
    : "";
  const task =
    mode === "plan"
      ? `You are in PLAN mode: investigate and propose a concrete plan, but do NOT edit any files or change ` +
        `business records. Reply with a SHORT plain-text summary of what you'd do.`
      : `For business requests, act with the sjcos tools and report what you did (ids, names, amounts). For code ` +
        `requests, you have full edit access to this repo: make the change directly, but do NOT rebuild, deploy, ` +
        `or restart anything — Joe does that himself — and remind him to rebuild. Reply with a SHORT plain-text ` +
        `summary (no markdown headers). If the request is a question, just answer it concisely.`;
  return (
    `You are Claude, Joe's in-app operator for SJC OS (SJ Carpentry's operating system). Joe is talking to you ` +
    `from a chat window in the running app. You can do everything any agent here can do: the sjcos MCP tools ` +
    `are the source of truth for leads, projects, subs, vendors, bids, purchase orders, invoices, selections, ` +
    `mood boards, documents, newsletter, knowledge, skills and the work queue — use them for business work, ` +
    `and record agent runs / receipts where the tools expect it. You ALSO have the repo (cwd) and edit access, ` +
    `so code changes are fair game when that's what Joe wants.\n\n` +
    grantText(grantId) +
    `\n\n` +
    where +
    task +
    (unseen
      ? `\n\nThis chat thread already has history — other assistants (Hermes: business ops with tools; ` +
        `Qwen: read-only Q&A) answered earlier turns and Joe may be replying to them:\n${unseen}`
      : "") +
    `\n\nRequest: ${userPrompt}`
  );
}

// ── thread continuity ────────────────────────────────────────────────────
// Which turns of the persisted thread has Claude NOT seen? Everything after
// the last assistant message Claude wrote (all of it, if Claude has never
// answered here), up to but not including the user message being answered now
// (that one is `prompt`). Files uploaded on those turns are listed by path —
// Claude reads them itself. Mirrors lib/orchestrator/thread.ts for the other
// agents; kept in plain SQL here because the runner can't import the app.
const SPEAKER = { claude: "Claude", qwen: "Qwen", hermes: "Hermes", concierge: "Claude (voice)" };
const TRANSCRIPT_MAX = 12_000;
const TURN_MAX = 2_000;

async function unseenTranscript(conversationId) {
  if (!conversationId) return "";
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT role, body, agent, attachments FROM ai_messages
        WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    ));
  } catch {
    return ""; // pre-migration schema — no continuity columns yet
  }
  let cur = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === "user") { cur = i; break; }
  if (cur < 0) return "";
  let seen = -1;
  for (let i = cur - 1; i >= 0; i--) if (rows[i].role === "assistant" && rows[i].agent === "claude") { seen = i; break; }
  const turns = rows.slice(seen + 1, cur);
  if (!turns.length) return "";
  const lines = turns.map((m) => {
    const who = m.role === "user" ? "Joe" : SPEAKER[m.agent] ?? "Assistant";
    let body = m.body.length > TURN_MAX ? `${m.body.slice(0, TURN_MAX)}…` : m.body;
    const files = Array.isArray(m.attachments) ? m.attachments : [];
    if (files.length) body += `\n(files attached — read them: ${files.map((f) => f.path).join(", ")})`;
    return `${who}: ${body}`;
  });
  let total = 0;
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (total + lines[i].length > TRANSCRIPT_MAX && kept.length) break;
    kept.unshift(lines[i]);
    total += lines[i].length;
  }
  const dropped = lines.length - kept.length;
  return (
    `[Earlier in this thread${dropped ? ` — ${dropped} older turn(s) omitted` : ""}]\n` +
    `${kept.join("\n\n")}\n[End of earlier context]`
  );
}

// ── activity streaming ────────────────────────────────────────────────────
// Human-readable "what it's doing" lines, appended as tool_use / thinking
// events stream in. We keep the tail bounded and flush to the DB throttled.
const activity = [];
let activityDirty = false;
let lastSessionId = null;

function base(p) {
  if (!p) return "";
  const s = String(p);
  return s.split("/").pop() || s;
}

function describeTool(name, input) {
  const p = input || {};
  switch (name) {
    case "Read":
      return `Reading ${base(p.file_path || p.path || p.notebook_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${base(p.file_path || p.path)}`;
    case "Write":
      return `Writing ${base(p.file_path || p.path)}`;
    case "NotebookEdit":
      return `Editing ${base(p.notebook_path)}`;
    case "Glob":
      return `Searching ${p.pattern ?? ""}`.trim();
    case "Grep":
      return `Grepping "${p.pattern ?? ""}"`;
    case "Bash":
      return `Running: ${String(p.command ?? "").replace(/\s+/g, " ").slice(0, 64)}`;
    case "TodoWrite":
      return "Planning tasks";
    case "Task":
      return "Delegating a sub-task";
    case "WebFetch":
    case "WebSearch":
      return "Searching the web";
    default: {
      // sjcos business tools arrive as mcp__sjcos__<tool>; show the tool name
      // so the chat reads "Using list_projects", "Using send_bid_package".
      const m = /^mcp__.+?__(.+)$/.exec(name);
      return m ? `Using ${m[1]}` : name;
    }
  }
}

function pushActivity(line) {
  if (!line) return;
  if (activity[activity.length - 1] === line) return; // de-dupe consecutive
  activity.push(line);
  if (activity.length > 60) activity.splice(0, activity.length - 60);
  activityDirty = true;
}

async function flushActivity() {
  if (!activityDirty) return;
  activityDirty = false;
  try {
    await client.query(`UPDATE dev_agent_runs SET activity = $2, updated_at = now() WHERE id = $1`, [
      RUN_ID,
      activity.join("\n"),
    ]);
  } catch {
    /* best-effort live progress; the final result is what matters */
  }
}

function handleEvent(evt) {
  if (evt?.session_id) lastSessionId = evt.session_id;
  if (evt?.type === "assistant" && Array.isArray(evt.message?.content)) {
    for (const block of evt.message.content) {
      if (block.type === "thinking") {
        // Show as much of the reasoning as the stream gives us (a snippet),
        // not just the fact that it's happening — Joe asked to see what the
        // agents are thinking wherever they're allowed to show it.
        const t = String(block.thinking ?? "").replace(/\s+/g, " ").trim();
        pushActivity(t ? `Thinking: ${t.slice(0, 180)}${t.length > 180 ? "…" : ""}` : "Thinking…");
      } else if (block.type === "redacted_thinking") {
        pushActivity("Thinking…");
      } else if (block.type === "text") {
        // Interim narration between tool calls ("Now I'll update the…").
        const t = String(block.text ?? "").replace(/\s+/g, " ").trim();
        if (t) pushActivity(`Claude: ${t.slice(0, 200)}${t.length > 200 ? "…" : ""}`);
      } else if (block.type === "tool_use") {
        pushActivity(describeTool(block.name, block.input));
      }
    }
  }
  if (evt?.type === "result") resultEvent = evt;
}

let resultEvent = null;

// Spawn `claude` and parse newline-delimited stream-json, invoking handleEvent
// per event. Resolves once the process closes (or rejects on spawn error).
function runClaude(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: REPO, env: process.env });
    let buf = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    const flushTimer = setInterval(() => void flushActivity(), 1000);

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          /* partial / non-JSON line — ignore */
        }
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      clearInterval(flushTimer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      clearInterval(flushTimer);
      if (killed) reject(Object.assign(new Error("timeout"), { killed: true }));
      else resolve({ stderr });
    });
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!RUN_ID) throw new Error("missing run id argv");
  await client.connect();

  const { rows } = await client.query(
    `SELECT prompt, page_context, conversation_id, model, mode, effort, with_mcp, grant_id
       FROM dev_agent_runs WHERE id = $1`,
    [RUN_ID],
  );
  if (!rows.length) throw new Error(`run ${RUN_ID} not found`);
  const { prompt, page_context, conversation_id } = rows[0];
  const model = rows[0].model || ENV_MODEL;
  const mode = rows[0].mode || "acceptEdits";
  const effort = rows[0].effort || "default";

  // If this thread already has a CLI session, resume it so Claude keeps full
  // context (files it read/edited earlier in the conversation).
  let resumeSession = null;
  if (conversation_id) {
    const cr = await client.query(
      `SELECT claude_session_id FROM ai_conversations WHERE id = $1`,
      [conversation_id],
    );
    resumeSession = cr.rows[0]?.claude_session_id ?? null;
  }

  await client.query(
    `UPDATE dev_agent_runs SET status = 'running', updated_at = now() WHERE id = $1`,
    [RUN_ID],
  );

  const unseen = await unseenTranscript(conversation_id);
  const grantId = rows[0].grant_id || null;
  const promptText = resumeSession
    ? resumePrompt(prompt, page_context, unseen, grantId)
    : buildPrompt(prompt, page_context, mode, unseen, grantId);

  const args = [
    "-p",
    promptText,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    permissionMode(mode),
    "--add-dir",
    REPO,
    // Only the MCP servers we name below — never the user's global config.
    "--strict-mcp-config",
  ];
  // Claude in the app is a full operator: every run gets the sjcos business
  // tools (with_mcp defaults true in startClaudeRun). with_mcp=false is the
  // explicit code-only escape hatch, which skips the tool-schema token cost.
  if (rows[0].with_mcp !== false) args.push("--mcp-config", path.join(REPO, "mcp/sjcos-mcp.config.json"));
  if (resumeSession) args.push("--resume", resumeSession);
  if (model) args.push("--model", model);
  if (VALID_EFFORT.has(effort)) args.push("--effort", effort);

  try {
    await runClaude(args);
  } catch (err) {
    if (err.killed) {
      const m = `Claude timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`;
      await finish("error", m);
      await persistToConversation(conversation_id, `⚠️ ${m}`, null, lastSessionId);
      return;
    }
    const m = `Claude CLI failed: ${err.message}`;
    await finish("error", m);
    await persistToConversation(conversation_id, `⚠️ ${m}`, null, lastSessionId);
    return;
  }

  await flushActivity();

  if (!resultEvent) {
    await finish("error", "Claude ended without returning a result.");
    await persistToConversation(conversation_id, "⚠️ Claude ended without returning a result.", null, lastSessionId);
    return;
  }

  if (resultEvent.is_error) {
    const msg = `Claude returned an error (${resultEvent.subtype ?? "unknown"}).`;
    await finish("error", msg, resultEvent.total_cost_usd);
    await persistToConversation(conversation_id, `⚠️ ${msg}`, resultEvent.total_cost_usd, resultEvent.session_id);
    return;
  }
  const body = resultEvent.result || "(no output)";
  await finish("done", body, resultEvent.total_cost_usd);
  await persistToConversation(conversation_id, body, resultEvent.total_cost_usd, resultEvent.session_id);
}

/** Save the assistant reply into the persisted thread + chain the CLI session
 *  so the next turn resumes it. No-op when the run isn't tied to a conversation. */
async function persistToConversation(conversationId, body, costUsd, sessionId) {
  if (!conversationId) return;
  try {
    // Tagged 'claude' so the router keeps follow-ups here and the other
    // agents know which turns are Claude's (lib/orchestrator/thread.ts).
    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, body, cost_usd, agent)
       VALUES ($1, 'assistant', $2, $3, 'claude')`,
      [conversationId, body, costUsd ?? null],
    );
    await client.query(
      `UPDATE ai_conversations
          SET updated_at = now(),
              claude_session_id = COALESCE($2, claude_session_id)
        WHERE id = $1`,
      [conversationId, sessionId ?? null],
    );
  } catch {
    /* run row already reflects the result; conversation persist is best-effort */
  }
}

main()
  .catch(async (err) => {
    try {
      await finish("error", `Runner crashed: ${err.message}`);
    } catch {
      /* db already gone — nothing we can do */
    }
  })
  .finally(async () => {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  });
