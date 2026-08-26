import "server-only";

import { spawn, execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, queryOne } from "@/lib/db";
import { CLAUDE_DEFAULTS, type ClaudeOptions } from "@/lib/dev-agents-meta";
import { insertConversation, insertMessage } from "@/lib/ai-chat";
import { ACTIONS_HINT, EFFECTS_HINT } from "@/lib/today-directives";
import { standingInstructionsBlock } from "@/lib/agent-memory";
import { finalizeHermesAnswer } from "@/lib/orchestrator/effects";
import { hermesProgress, runLog } from "@/lib/orchestrator/activity";
import { composeHermesTurn } from "@/lib/orchestrator/thread";
import { imageDataUrl, type AttachmentImage } from "@/lib/attachments";
import { mintRunGrant } from "@/lib/owner-grants";

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

// Agent turns can run tools (memory lookups, inbox scans, work-item updates,
// etc.), each its own model round-trip, so a real turn can run several
// minutes. Turns run in the background and are polled (lib/actions/ai-chat.ts)
// rather than held open as one HTTP request, so there's no UI reason to cut
// this short — bounded mainly so a truly stuck run doesn't hang forever.
// Keep in lockstep with the panel's poll ceiling (useAgentChat's 1440 × 2s) and
// the failStaleRuns() cutoff below (all sized to the same ~15 min budget).
const HERMES_TIMEOUT_MS = Number(process.env.HERMES_AGENT_TIMEOUT_MS ?? 480_000);
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
  /** Images to show a vision-capable agent with this turn (Hermes' gateway
   *  takes OpenAI-style data:image/… parts). */
  images?: AttachmentImage[];
}

/** One OpenAI-style message for the Hermes gateway: plain string content, or
 *  text + image_url parts when the turn carries images. */
function hermesMessage(t: ChatTurn): { role: string; content: unknown } {
  if (!t.images?.length) return { role: t.role, content: t.content };
  return {
    role: t.role,
    content: [
      { type: "text", text: t.content },
      ...t.images.map((img) => ({ type: "image_url", image_url: { url: imageDataUrl(img) } })),
    ],
  };
}

/** POST JSON over plain node:http with a real full-request timeout. NOT using
 *  global fetch() here on purpose: Node's fetch is backed by undici, which
 *  applies its own hidden headersTimeout/bodyTimeout (5 min by default) that
 *  our own AbortController can't see or override — a slow-but-alive Hermes
 *  tool-call turn got killed by that hidden ceiling ("fetch failed", no
 *  useful cause) well before our intended HERMES_TIMEOUT_MS. Overriding it
 *  properly needs the standalone `undici` package (not a dependency here);
 *  node:http has no such hidden timeout, so it's the simpler fix. */
function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  /** Streaming hook: called with each decoded chunk as it arrives (only for
   *  2xx responses); the full text is still returned at the end. */
  onData?: (chunk: string) => void,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          chunks.push(Buffer.from(c, "utf8"));
          if (ok && onData) onData(c);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    // node:http's `timeout` fires on socket inactivity but doesn't itself
    // abort the request — do that ourselves so a stuck call actually ends.
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Multi-turn Hermes chat against the real agent gateway. Pins the session to
 *  `sessionId` so the agent reuses the same session/sandbox across turns.
 *  NOTE: with a session id the gateway loads history from ITS OWN store and
 *  reads only the LAST user message from `turns` — anything Hermes hasn't
 *  seen (other agents' answers in an 'auto' thread, files from earlier turns)
 *  must be folded into that message: see composeHermesTurn() in
 *  lib/orchestrator/thread.ts. `context` (the page the user is viewing) rides
 *  along as a system message; the agent's own persona/memory come from the
 *  gateway, not from us. */
/** Live progress from a Hermes turn (the gateway streams these). */
export interface HermesProgress {
  /** A tool call started/finished — what Hermes is doing right now. */
  onTool?: (evt: { tool: string; label?: string; emoji?: string; status: string }) => void;
  /** The answer so far (grows as tokens stream). */
  onPartial?: (text: string) => void;
}

export async function hermesChat(
  turns: ChatTurn[],
  context?: string,
  sessionId?: string,
  progress?: HermesProgress,
): Promise<string> {
  // W5: Joe-approved standing instructions ride along on every turn so the
  // in-app agents get them without an MCP round-trip. "" when none exist.
  const standing = await standingInstructionsBlock();
  const messages = [
    ...(context ? [{ role: "system", content: `SJC OS — page the user is viewing:\n${context}` }] : []),
    // Today v2 · Phase 7: let Hermes (the feed's default agent) offer one-click
    // chips too. Self-gating — only fires when work_item_ids are in context.
    { role: "system", content: ACTIONS_HINT },
    // Orchestration: ask for a sjcos-effects fence on writes (stripped +
    // recorded by lib/orchestrator/effects.ts at run completion).
    { role: "system", content: EFFECTS_HINT },
    ...(standing ? [{ role: "system", content: standing }] : []),
    ...turns.map(hermesMessage),
  ];
  const { url, key } = await hermesConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    // Long-term memory scope (shared with the Telegram/CLI Hermes brain).
    "X-Hermes-Session-Key": HERMES_SESSION_KEY,
  };
  // Pin session continuity + sandbox reuse to this conversation.
  if (sessionId) headers["X-Hermes-Session-Id"] = `sjcos-${sessionId}`;

  // Streamed (SSE-shaped chunks over one HTTP response — the gateway→app leg,
  // not the browser; the house rule about SSE is for the browser). Streaming
  // is what exposes the `hermes.tool.progress` events during the tool loop —
  // the only window into what Hermes is doing for the minutes a turn can take
  // — and it keeps the socket alive so the inactivity timeout stays honest.
  let answer = "";
  let sseBuf = "";
  let sseEvent = "";
  const onData = (chunk: string) => {
    sseBuf += chunk;
    let nl: number;
    while ((nl = sseBuf.indexOf("\n")) >= 0) {
      const line = sseBuf.slice(0, nl).replace(/\r$/, "");
      sseBuf = sseBuf.slice(nl + 1);
      if (line.startsWith("event:")) {
        sseEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) {
        if (line === "") sseEvent = "";
        continue;
      }
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }
      if (sseEvent === "hermes.tool.progress") {
        progress?.onTool?.({
          tool: String(obj.tool ?? ""),
          label: typeof obj.label === "string" ? obj.label : undefined,
          emoji: typeof obj.emoji === "string" ? obj.emoji : undefined,
          status: String(obj.status ?? ""),
        });
        sseEvent = "";
        continue;
      }
      const choices = obj.choices as { delta?: { content?: string } }[] | undefined;
      const delta = choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        answer += delta;
        progress?.onPartial?.(answer);
      }
    }
  };

  let res: { status: number; text: string };
  try {
    res = await postJson(
      `${url}/v1/chat/completions`,
      headers,
      JSON.stringify({ model: HERMES_MODEL, messages, stream: true }),
      HERMES_TIMEOUT_MS,
      onData,
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.message === "TIMEOUT") {
      throw new Error("Hermes took too long to respond (agent may be running a long tool call).");
    }
    if (e.code === "ECONNREFUSED") {
      throw new Error("Hermes agent gateway isn't running (no api_server on :8642).");
    }
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 401) throw new Error("Hermes rejected the API key (401).");
    throw new Error(`Hermes agent HTTP ${res.status}${res.text ? `: ${res.text.slice(0, 200)}` : ""}`);
  }
  // Streamed content assembled above; a non-streaming JSON body (older
  // gateway) is still understood as a fallback.
  if (!answer.trim()) {
    try {
      const data = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
      answer = data.choices?.[0]?.message?.content ?? "";
    } catch {
      /* streamed and empty */
    }
  }
  const out = answer.trim();
  if (!out) throw new Error("Hermes returned an empty response.");
  return out;
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

export async function chatReplyClaude(
  prompt: string,
  opts?: { model?: string; effort?: string; timeoutMs?: number },
): Promise<string> {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    ...(opts?.effort ? ["--effort", opts.effort] : []),
    "--model",
    opts?.model ?? CLAUDE_CHAT_MODEL,
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
      timeout: opts?.timeoutMs ?? 60_000,
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
  conversationId: string | null;
  /** Live context size (tokens in the window) streamed by the Claude runner. */
  contextTokens: number | null;
  /** The final result envelope's usage/modelUsage/num_turns (done runs). */
  tokenUsage: Record<string, unknown> | null;
  /** CLI session id — the thread's resumable session. */
  sessionId: string | null;
  /** Set on a done run when a newer run is already in flight in the same
   *  conversation — an orchestrator hand-off (e.g. Qwen's held proposal
   *  escalated to Hermes) — so the panel keeps following the thread instead
   *  of stopping at the first answer. */
  nextRunId?: string;
}

/** Create a pending Claude run and kick off the detached runner. Returns the id
 *  the chat polls with getDevAgentRun(). `conversationId` links it to a
 *  persisted thread so the runner can save the reply and resume the session.
 *  `options` are the per-run model/mode/effort chosen in the Ask window.
 *
 *  Claude in the app is a full operator: every run gets the sjcos business
 *  tools (with_mcp defaults true; pass withMcp:false for a code-only run).
 *  `allowSends` is the Ask window's Express-permission checkbox — it mints a
 *  run-scoped owner grant (lib/owner-grants.ts) the runner hands to Claude so
 *  it can perform the client-facing sends this message asks for. */
export async function startClaudeRun(
  prompt: string,
  pageContext?: string,
  conversationId?: string,
  options?: Partial<ClaudeOptions>,
  subjectWorkItemId?: string,
  extras?: { withMcp?: boolean; allowSends?: boolean; orchestrationTaskId?: string },
): Promise<string> {
  const { model, mode, effort, withMcp } = { ...CLAUDE_DEFAULTS, ...options };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO dev_agent_runs
       (agent, prompt, page_context, status, conversation_id, model, mode, effort, subject_work_item_id, with_mcp, orchestration_task_id)
     VALUES ('claude', $1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      prompt,
      pageContext ?? null,
      conversationId ?? null,
      model === "default" ? null : model,
      mode,
      effort,
      subjectWorkItemId ?? null,
      // extras wins (orchestrator callers), else the Ask window's Tools toggle.
      extras?.withMcp ?? withMcp,
      extras?.orchestrationTaskId ?? null,
    ],
  );
  const id = row!.id;

  // Express permission for this one turn: the grant row is the owner's
  // approval on record; the runner tells Claude its id and every gated send
  // spends it (and is audited on it). Minted BEFORE the runner starts so the
  // prompt can carry it.
  if (extras?.allowSends) {
    const grant = await mintRunGrant(id, conversationId ?? null, prompt);
    await query(`UPDATE dev_agent_runs SET grant_id = $2 WHERE id = $1`, [id, grant.id]);
  }

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
    conversation_id: string | null;
    context_tokens: number | null;
    token_usage: Record<string, unknown> | null;
    session_id: string | null;
  }>(
    `SELECT id, agent, status, answer, activity, cost_usd, created_at::text AS created_at, conversation_id,
            context_tokens, token_usage, session_id
       FROM dev_agent_runs WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  let nextRunId: string | undefined;
  if (row.status === "done" && row.conversation_id) {
    const next = await queryOne<{ id: string }>(
      `SELECT id FROM dev_agent_runs
        WHERE conversation_id = $1 AND id <> $2 AND status IN ('pending','running')
          AND created_at >= (SELECT created_at FROM dev_agent_runs WHERE id = $2)
        ORDER BY created_at ASC LIMIT 1`,
      [row.conversation_id, id],
    );
    nextRunId = next?.id;
  }
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    answer: row.answer,
    activity: row.activity,
    // pg returns `numeric` as a string — coerce so the UI can .toFixed() it.
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    createdAt: row.created_at,
    conversationId: row.conversation_id,
    contextTokens: row.context_tokens == null ? null : Number(row.context_tokens),
    tokenUsage: row.token_usage,
    sessionId: row.session_id,
    nextRunId,
  };
}

/**
 * Stop a live run (the panel's ⏹ button). Claude runs are a detached runner
 * process whose pid is on the row: verify the pid still belongs to OUR runner
 * for THIS run (cmdline check — pids get recycled) and SIGTERM it; the runner
 * kills the CLI and persists "⏹ Stopped by Joe." itself. In-process turns
 * (Hermes/Qwen) and dead runners are settled directly on the row — their
 * background pipeline's final write is guarded on status, so a stopped run
 * stays stopped.
 */
export async function stopDevAgentRun(runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await queryOne<{
    agent: string;
    status: string;
    pid: number | null;
    conversation_id: string | null;
  }>(`SELECT agent, status, pid, conversation_id FROM dev_agent_runs WHERE id = $1`, [runId]);
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status !== "pending" && run.status !== "running") return { ok: true };

  if (run.agent === "claude" && run.pid) {
    try {
      const cmdline = await readFile(`/proc/${run.pid}/cmdline`, "utf8").catch(() => "");
      if (cmdline.includes("run-claude-agent.mjs") && cmdline.includes(runId)) {
        process.kill(run.pid, "SIGTERM");
        return { ok: true };
      }
    } catch {
      /* fall through to settling the row directly */
    }
  }

  const msg = "⏹ Stopped by Joe.";
  const updated = await queryOne<{ conversation_id: string | null }>(
    `UPDATE dev_agent_runs SET status = 'error', answer = $2, updated_at = now()
      WHERE id = $1 AND status IN ('pending','running')
      RETURNING conversation_id`,
    [runId, msg],
  );
  if (updated?.conversation_id) {
    await insertMessage(updated.conversation_id, "assistant", msg, { agent: run.agent }).catch(() => {});
  }
  return { ok: true };
}

// ─── Approval → agent dispatch ───────────────────────────────────────────────
// When Joe approves a work item owned by an agent (not himself), that agent
// gets pinged the same way Joe would ping it from the Ask window: a real,
// persisted ai_conversations/ai_messages thread + a tracked dev_agent_runs row
// (Hermes turn run in-process, Claude run detached via the CLI runner). That
// means a failure lands as a normal "⚠️ ..." reply in the thread instead of
// vanishing into a console.error, and the retry sweep below can find and
// re-nudge anything that errored out. No-op for human-owned items.

type ApprovalAgent = "hermes" | "claude";

function approvalAgentFor(assigneeKey: string | null): ApprovalAgent | null {
  if (assigneeKey === "hermes-telegram") return "hermes";
  if (assigneeKey === "claude-code-server") return "claude";
  return null;
}

/** One thread per work item, reused across the initial ping and every retry,
 *  so the whole back-and-forth (and the agent's eventual reply) lives in one
 *  place Joe can open from the Ask window. */
async function conversationForWorkItem(agent: ApprovalAgent, workItemId: string, title: string): Promise<string> {
  const existing = await queryOne<{ conversation_id: string }>(
    `SELECT conversation_id FROM ai_messages WHERE subject_work_item_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [workItemId],
  );
  if (existing) return existing.conversation_id;
  return insertConversation(agent, `Approved: ${title}`);
}

/** Mirrors the Ask window's backgrounded Hermes turn (lib/actions/ai-chat.ts
 *  sendMessageAction): the row is created synchronously so callers/retries can
 *  see it immediately, then updated with the reply or a "⚠️ ..." error once
 *  the turn resolves. Runs in-process (long-lived server, not serverless). */
async function runHermesTurnTracked(
  conversationId: string,
  prompt: string,
  pageContext: string | undefined,
  subjectWorkItemId: string,
): Promise<void> {
  // Called fire-and-forget (`void runHermesTurnTracked(...)`) — this must
  // never reject, or a DB hiccup here becomes an unhandled rejection.
  let runId: string | undefined;
  try {
    const run = await queryOne<{ id: string }>(
      `INSERT INTO dev_agent_runs (agent, prompt, page_context, status, conversation_id, activity, subject_work_item_id)
       VALUES ('hermes', $1, $2, 'running', $3, 'Hermes is thinking…', $4)
       RETURNING id`,
      [prompt, pageContext ?? null, conversationId, subjectWorkItemId],
    );
    runId = run!.id;
    const log = runLog(runId, ["Hermes is thinking…"]);
    // The thread turns Hermes hasn't seen (its gateway session only holds its
    // own) ride along with the ping — see lib/orchestrator/thread.ts.
    const turn = await composeHermesTurn(conversationId, { text: prompt });
    const raw = await hermesChat(
      [{ role: "user", content: turn.content, images: turn.images }],
      pageContext,
      conversationId,
      hermesProgress(log),
    );
    log.push("Done.");
    await log.flush();
    const answer = await finalizeHermesAnswer(runId, raw);
    // Guarded on status: a run Joe ⏹-stopped is already 'error' — don't
    // overwrite it or double-post the late reply.
    const settled = await queryOne<{ id: string }>(
      `UPDATE dev_agent_runs SET status = 'done', answer = $2, updated_at = now()
        WHERE id = $1 AND status IN ('pending','running') RETURNING id`,
      [runId, answer],
    );
    if (settled) await insertMessage(conversationId, "assistant", answer, { agent: "hermes" });
  } catch (err) {
    const msg = `⚠️ ${(err as Error).message}`;
    if (runId) {
      const settled = await queryOne<{ id: string }>(
        `UPDATE dev_agent_runs SET status = 'error', answer = $2, updated_at = now()
          WHERE id = $1 AND status IN ('pending','running') RETURNING id`,
        [runId, msg],
      ).catch(() => null);
      if (!settled) return;
    }
    await insertMessage(conversationId, "assistant", msg, { agent: "hermes" }).catch(() => {});
  }
}

/** Shared agent dispatch for a work item: persist `prompt` as a user turn in
 *  the item's thread and hand it to the owning agent (Hermes turn in-process,
 *  Claude run detached via the CLI runner). Best-effort: the state change that
 *  prompted the ping already committed, so a dispatch failure logs and returns
 *  rather than failing the caller (the retry sweep / the agent's scheduled
 *  pass picks the item up later). No-op for human-owned items. */
export async function pingAgentWorkItem(
  workItemId: string,
  assigneeKey: string | null,
  title: string,
  prompt: string,
  pageContext?: string,
): Promise<void> {
  const agent = approvalAgentFor(assigneeKey);
  if (!agent) return;

  try {
    const conversationId = await conversationForWorkItem(agent, workItemId, title);
    await insertMessage(conversationId, "user", prompt, { pageContext, subjectWorkItemId: workItemId });

    if (agent === "hermes") {
      // Not awaited past the DB insert: a live Hermes turn can run minutes of
      // tool calls, and the caller can't sit there waiting on that.
      void runHermesTurnTracked(conversationId, prompt, pageContext, workItemId);
      return;
    }
    try {
      await startClaudeRun(prompt, pageContext, conversationId, undefined, workItemId);
    } catch (err) {
      await insertMessage(conversationId, "assistant", `⚠️ ${(err as Error).message}`, { agent: "claude" }).catch(() => {});
    }
  } catch (err) {
    console.error("[dev-agents] pingAgentWorkItem failed", err);
  }
}

/** Ping a work item's owner agent that it just cleared approval, prompting it
 *  to go complete the action. Best-effort — see pingAgentWorkItem. */
export async function notifyAgentOwner(
  workItemId: string,
  assigneeKey: string | null,
  title: string,
  body: string,
  pageContext?: string,
): Promise<void> {
  const prompt =
    `Work item approved: "${title}"${body ? `\n\n${body}` : ""}\n\n` +
    `Joe just approved this — go ahead and complete it now.`;
  await pingAgentWorkItem(workItemId, assigneeKey, title, prompt, pageContext);
}

// Retries stop after this many attempts on one work item — the thread's last
// "⚠️ ..." reply is left as the record of why, same as reading any other
// failed chat.
const MAX_APPROVAL_ATTEMPTS = 5;
const APPROVAL_RETRY_AFTER = "15 minutes";

/** Cron sweep (app/api/cron/agent-retries): find still-open agent work items
 *  whose owner-agent ping errored out (every attempt so far, at least 15 min
 *  ago) and nudge the same conversation again. Covers approved items and (W6)
 *  runbook step items — except steps parked at approval_needed, where the ball
 *  is in Joe's court, not the agent's. Skips anything with a ping currently in
 *  flight (status 'pending'/'running') or already at the attempt cap. */
export async function retryFailedApprovalPings(): Promise<{ retried: number }> {
  const { rows } = await query<{
    work_item_id: string;
    title: string;
    assignee_key: string;
    conversation_id: string;
    attempts: string;
  }>(
    `SELECT w.id AS work_item_id, w.title, w.assignee_key, r.conversation_id, COUNT(r.id) AS attempts
       FROM work_items w
       JOIN dev_agent_runs r ON r.subject_work_item_id = w.id
      WHERE (w.approval_status = 'approved'
             OR (w.runbook_instance_id IS NOT NULL AND w.status <> 'approval_needed'))
        AND w.status NOT IN ('done', 'cancelled')
        AND w.assignee_key IN ('hermes-telegram', 'claude-code-server')
      GROUP BY w.id, w.title, w.assignee_key, r.conversation_id
     HAVING bool_and(r.status = 'error')
        AND count(r.id) < $1
        AND max(r.created_at) < now() - $2::interval`,
    [MAX_APPROVAL_ATTEMPTS, APPROVAL_RETRY_AFTER],
  );

  for (const r of rows) {
    const agent = approvalAgentFor(r.assignee_key);
    if (!agent) continue;
    const attempt = Number(r.attempts) + 1;
    const nudge =
      `Still waiting on work item "${r.title}" (retry ${attempt}/${MAX_APPROVAL_ATTEMPTS}). ` +
      `Please go complete it now.`;
    await insertMessage(r.conversation_id, "user", nudge, { subjectWorkItemId: r.work_item_id });
    if (agent === "hermes") {
      // Fire-and-forget, same reason as the initial ping: the cron script has
      // its own short timeout and shouldn't sit through a live Hermes turn.
      void runHermesTurnTracked(r.conversation_id, nudge, undefined, r.work_item_id);
    } else {
      try {
        await startClaudeRun(nudge, undefined, r.conversation_id, undefined, r.work_item_id);
      } catch (err) {
        await insertMessage(r.conversation_id, "assistant", `⚠️ ${(err as Error).message}`, { agent: "claude" });
      }
    }
  }
  return { retried: rows.length };
}

/** Reap runs that never reported back (crashed runner, or a Hermes/Qwen turn
 *  whose own in-process handler somehow never wrote its result). Called on
 *  poll so a dead run resolves to an error instead of spinning forever. Kept
 *  above HERMES_TIMEOUT_MS so a live Hermes turn always gets to report its
 *  own timeout error first — this is just the backstop.
 *
 *  Keyed on updated_at (progress), not created_at: an orchestration-ladder
 *  run legitimately outlives 15 minutes across its Hermes rounds + Claude
 *  reviews, but it touches activity/updated_at at every stage — only a run
 *  that has gone QUIET for 15 minutes is dead. failStaleTasks() (45 min) is
 *  the task-level backstop above this. */
export async function failStaleRuns(): Promise<void> {
  await query(
    `UPDATE dev_agent_runs
        SET status = 'error',
            answer = COALESCE(answer, 'The runner did not report back (timed out).'),
            updated_at = now()
      WHERE status IN ('pending','running')
        AND updated_at < now() - interval '15 minutes'`,
  );
}
