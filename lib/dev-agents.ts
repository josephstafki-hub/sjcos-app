import "server-only";

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, queryOne } from "@/lib/db";
import { CLAUDE_DEFAULTS, type ClaudeOptions } from "@/lib/dev-agents-meta";

const execFileAsync = promisify(execFile);

// Multi-agent chat backends for the Ask window.
//
//   qwen   → local Ollama (handled by lib/ai.ts `ask`, synchronous)
//   hermes → the REAL Hermes agent (persona + long-term memory + tools) via its
//            OpenAI-compatible gateway (`api_server`, http://127.0.0.1:8642) —
//            the same brain as the Hermes Telegram agent, synchronous.
//   claude → headless `claude -p` via the logged-in CLI (NOT the paid API),
//            full edit access, cwd = this repo. Agentic edit runs take minutes,
//            so a Claude turn is a dev_agent_runs row that a DETACHED runner
//            (scripts/run-claude-agent.mjs) fills in and the chat polls.
//
// server-only: pulls node:child_process; never import from a client component.

export type DevAgent = "claude" | "qwen" | "hermes";

export const DEV_AGENTS: DevAgent[] = ["claude", "qwen", "hermes"];

// ─── Hermes (the real agent, via its OpenAI-compatible gateway) ──────────────
//
// "Hermes" is the full agent — its persona (SOUL.md), long-term memory, skills,
// and tools — not the raw model. The Hermes gateway exposes an OpenAI-compatible
// `api_server` (POST /v1/chat/completions) on 127.0.0.1:8642, behind a Bearer
// key. We reuse the SAME brain that answers on Telegram, so anything Joe told
// Hermes there is available here (and vice-versa).
//
// Config resolution (all overridable):
//   HERMES_AGENT_URL  — base URL          (default from ~/.hermes/.env, else :8642)
//   HERMES_AGENT_KEY  — Bearer API key    (default: API_SERVER_KEY in ~/.hermes/.env)
// We read ~/.hermes/.env at runtime because the app runs as the same user that
// owns the gateway, so the key lives in exactly one place.

// Agent turns can run tools (memory lookups, web, etc.), so allow more than a
// bare model completion would need.
const HERMES_TIMEOUT_MS = Number(process.env.HERMES_AGENT_TIMEOUT_MS ?? 180_000);
const HERMES_MODEL = "hermes-agent";
// Stable scope for Hermes' long-term memory when chatting from SJC OS.
const HERMES_SESSION_KEY = process.env.HERMES_AGENT_SESSION_KEY ?? "agent:main:sjcos:ai";

let hermesConfigCache: { url: string; key: string } | null = null;

/** Parse a KEY=value out of ~/.hermes/.env (quotes stripped). */
function envVal(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "") || undefined;
}

/** Resolve the Hermes gateway base URL + Bearer key. Env wins; otherwise fall
 *  back to the gateway's own ~/.hermes/.env. Cached after first success. */
async function hermesConfig(): Promise<{ url: string; key: string }> {
  if (hermesConfigCache) return hermesConfigCache;

  let url = process.env.HERMES_AGENT_URL;
  let key = process.env.HERMES_AGENT_KEY;

  if (!url || !key) {
    let dotenv = "";
    try {
      dotenv = await readFile(`${process.env.HOME}/.hermes/.env`, "utf8");
    } catch {
      /* not readable — rely on env only */
    }
    if (!url) {
      const host = envVal(dotenv, "API_SERVER_HOST") ?? "127.0.0.1";
      const port = envVal(dotenv, "API_SERVER_PORT") ?? "8642";
      url = `http://${host}:${port}`;
    }
    if (!key) key = envVal(dotenv, "API_SERVER_KEY") ?? "";
  }

  if (!key) {
    throw new Error(
      "Hermes agent key not found — set HERMES_AGENT_KEY (or API_SERVER_KEY in ~/.hermes/.env).",
    );
  }
  hermesConfigCache = { url: url.replace(/\/+$/, ""), key };
  return hermesConfigCache;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Multi-turn Hermes chat against the real agent gateway. Sends the whole
 *  conversation (the gateway expects OpenAI-style full history) and pins the
 *  session to `sessionId` so the agent reuses the same session/sandbox across
 *  turns. `context` (the page the user is viewing) rides along as a system
 *  message; the agent's own persona/memory come from the gateway, not from us. */
export async function hermesChat(
  turns: ChatTurn[],
  context?: string,
  sessionId?: string,
): Promise<string> {
  const messages = [
    ...(context ? [{ role: "system", content: `SJC OS — page the user is viewing:\n${context}` }] : []),
    ...turns,
  ];
  const { url, key } = await hermesConfig();

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HERMES_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      // Long-term memory scope (shared with the Telegram/CLI Hermes brain).
      "X-Hermes-Session-Key": HERMES_SESSION_KEY,
    };
    // Pin session continuity + sandbox reuse to this conversation.
    if (sessionId) headers["X-Hermes-Session-Id"] = `sjcos-${sessionId}`;

    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: HERMES_MODEL, messages, stream: false }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("Hermes rejected the API key (401).");
      throw new Error(`Hermes agent HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) throw new Error("Hermes returned an empty response.");
    return answer;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Hermes took too long to respond (agent may be running a long tool call).");
    }
    if ((err as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") {
      throw new Error("Hermes agent gateway isn't running (no api_server on :8642).");
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Single-turn Hermes ask (team chat / one-offs). */
export async function askHermes(
  prompt: string,
  context?: string,
  sessionId?: string,
): Promise<string> {
  return hermesChat([{ role: "user", content: prompt }], context, sessionId);
}

// ─── Claude in team chat (fast, single-turn, NO tools) ───────────────────────
// Team-chat Claude is a conversational teammate, not the code-editing dev agent
// (that's the Ask window). So here we run a single-turn `claude -p` with every
// tool disabled — ~3s, synchronous, no filesystem access — and post the text.

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;
const CLAUDE_CHAT_MODEL = process.env.DEV_CLAUDE_CHAT_MODEL ?? "sonnet";

export async function chatReplyClaude(prompt: string): Promise<string> {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    CLAUDE_CHAT_MODEL,
    "--disallowedTools",
    "Read Glob Grep Write Edit Bash WebFetch WebSearch",
    // No MCP servers — disallowedTools hides built-ins but MCP tool schemas
    // still load into context otherwise. This chat reply needs none of them.
    "--strict-mcp-config",
  ];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(CLAUDE_BIN, args, {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    }));
  } catch (err) {
    const e = err as { killed?: boolean; stdout?: string; message?: string };
    if (e.killed) throw new Error("Claude timed out.");
    if (e.stdout) stdout = e.stdout;
    else throw new Error(`Claude CLI failed: ${e.message}`);
  }
  const env = JSON.parse(stdout) as { is_error: boolean; result: string; subtype?: string };
  if (env.is_error) throw new Error(`Claude error (${env.subtype ?? "unknown"}).`);
  return (env.result || "").trim();
}

// ─── Claude (headless CLI, async via detached runner) ────────────────────────

export interface DevAgentRun {
  id: string;
  agent: string;
  status: "pending" | "running" | "done" | "error";
  answer: string | null;
  activity: string | null;
  costUsd: number | null;
  createdAt: string;
}

/** Create a pending Claude run and kick off the detached runner. Returns the id
 *  the chat polls with getDevAgentRun(). `conversationId` links it to a
 *  persisted thread so the runner can save the reply and resume the session.
 *  `options` are the per-run model/mode/effort chosen in the Ask window. */
export async function startClaudeRun(
  prompt: string,
  pageContext?: string,
  conversationId?: string,
  options?: Partial<ClaudeOptions>,
): Promise<string> {
  const { model, mode, effort } = { ...CLAUDE_DEFAULTS, ...options };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO dev_agent_runs
       (agent, prompt, page_context, status, conversation_id, model, mode, effort)
     VALUES ('claude', $1, $2, 'pending', $3, $4, $5, $6)
     RETURNING id`,
    [
      prompt,
      pageContext ?? null,
      conversationId ?? null,
      model === "default" ? null : model,
      mode,
      effort,
    ],
  );
  const id = row!.id;

  // Detached: the agent run outlives this request. The runner reads the row,
  // executes `claude -p` with edit access, and writes the result back.
  const child = spawn(process.execPath, [path.join(process.cwd(), "scripts/run-claude-agent.mjs"), id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return id;
}

/** Poll a Claude run's state for the chat UI. */
export async function getDevAgentRun(id: string): Promise<DevAgentRun | null> {
  const row = await queryOne<{
    id: string;
    agent: string;
    status: DevAgentRun["status"];
    answer: string | null;
    activity: string | null;
    cost_usd: number | null;
    created_at: string;
  }>(
    `SELECT id, agent, status, answer, activity, cost_usd, created_at::text AS created_at
       FROM dev_agent_runs WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    answer: row.answer,
    activity: row.activity,
    // pg returns `numeric` as a string — coerce so the UI can .toFixed() it.
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    createdAt: row.created_at,
  };
}

/** Reap runs that never reported back (crashed runner). Called on poll so a
 *  dead run resolves to an error instead of spinning forever. */
export async function failStaleRuns(): Promise<void> {
  await query(
    `UPDATE dev_agent_runs
        SET status = 'error',
            answer = COALESCE(answer, 'The Claude runner did not report back (timed out).'),
            updated_at = now()
      WHERE status IN ('pending','running')
        AND created_at < now() - interval '10 minutes'`,
  );
}
