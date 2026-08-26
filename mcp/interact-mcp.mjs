#!/usr/bin/env node
// SJC OS — interact MCP server (the Claude runner's in-app prompt bridge).
//
// Spawned by the `claude` CLI alongside the sjcos server (the runner passes
// its config inline) when the Ask window's mode is "Ask me". Two tools:
//
//   approve_action — the CLI's permission prompt, pointed here via
//     `--permission-prompt-tool mcp__interact__approve_action`. Every tool call
//     the permission system would ask about arrives as a call to this tool; we
//     park it as an agent_interactions row (kind 'permission'), the panel chat
//     renders Allow/Deny inline, and the answer goes back as the JSON contract
//     the CLI expects ({"behavior":"allow","updatedInput":…} / {"behavior":
//     "deny","message":…}). Read-only tools are allowed immediately without
//     bothering Joe. No answer in time = DENY — fail closed.
//
//   ask_owner — the shared question-box tool (mcp/interact-tools.mjs), also
//     registered on the main sjcos server; here too so a code-only run
//     (with_mcp=false) can still ask Joe questions.
//
// The runner exports SJC_RUN_ID / SJC_CONVERSATION_ID so rows land on the
// right chat thread, and raises MCP_TOOL_TIMEOUT so a blocked prompt isn't
// killed by the CLI's default tool timeout.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAskOwner } from "./interact-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
/** The permission contract is raw JSON text (NOT pretty) — keep it separate. */
const contract = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── auto-allow: never interrupt Joe for read-only work ───────────────────────
const SAFE_BUILTINS = new Set([
  "Read",
  "Glob",
  "Grep",
  "TodoWrite",
  "Task",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
]);
const SAFE_MCP_RE =
  /^mcp__.+?__(list_|get_|search_|fetch$|fetch_|check_|suggest_|compare_|business_snapshot$|ask_owner$)/;

function autoAllowed(toolName) {
  return SAFE_BUILTINS.has(toolName) || SAFE_MCP_RE.test(toolName);
}

/** Human line for the approval card — mirrors the runner's describeTool. */
function describeAction(name, input) {
  const p = input || {};
  const base = (v) => (v ? String(v).split("/").pop() : "");
  switch (name) {
    case "Edit":
    case "MultiEdit":
      return `Edit ${base(p.file_path || p.path)}`;
    case "Write":
      return `Write ${base(p.file_path || p.path)}`;
    case "NotebookEdit":
      return `Edit ${base(p.notebook_path)}`;
    case "Bash":
      return `Run: ${String(p.command ?? "").replace(/\s+/g, " ").slice(0, 120)}`;
    default: {
      const m = /^mcp__.+?__(.+)$/.exec(name);
      return m ? `Use ${m[1]}` : `Use ${name}`;
    }
  }
}

const PROMPT_POLL_MS = 1500;
// Just under the runner's raised MCP_TOOL_TIMEOUT (24 h) — an approval waits
// on Joe with no practical limit; the run stays alive via the runner heartbeat.
const PROMPT_TIMEOUT_MS = Number(process.env.SJC_PROMPT_TIMEOUT_MS ?? 86_000_000);

const server = new McpServer({ name: "interact", version: "1.0.0" });

server.registerTool(
  "approve_action",
  {
    title: "In-app permission prompt (internal)",
    description:
      "Internal permission bridge for the Claude CLI — do not call this yourself; " +
      "the permission system calls it when a tool use needs Joe's approval.",
    inputSchema: {
      tool_name: z.string().describe("The tool awaiting permission."),
      input: z.record(z.unknown()).optional().describe("The tool's input."),
      tool_use_id: z.string().optional(),
    },
  },
  async ({ tool_name, input }) => {
    if (autoAllowed(tool_name)) {
      return contract({ behavior: "allow", updatedInput: input ?? {} });
    }
    const payload = {
      tool: tool_name,
      input: JSON.stringify(input ?? {}, null, 2).slice(0, 4000),
      description: describeAction(tool_name, input),
    };
    const { rows } = await pool.query(
      `INSERT INTO agent_interactions (run_id, conversation_id, agent, kind, payload)
       VALUES ($1, $2, $3, 'permission', $4::jsonb) RETURNING id`,
      [
        process.env.SJC_RUN_ID || null,
        process.env.SJC_CONVERSATION_ID || null,
        process.env.SJC_AGENT || "claude",
        JSON.stringify(payload),
      ],
    );
    const id = rows[0].id;

    const deadline = Date.now() + PROMPT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(PROMPT_POLL_MS);
      const r = await pool.query(`SELECT status, response FROM agent_interactions WHERE id = $1`, [id]);
      const row = r.rows[0];
      if (!row) break;
      if (row.status === "answered") {
        const resp = row.response ?? {};
        if (resp.decision === "allow") return contract({ behavior: "allow", updatedInput: input ?? {} });
        return contract({
          behavior: "deny",
          message: `Joe denied this action.${resp.note ? ` Joe says: ${resp.note}` : ""}`,
        });
      }
      if (row.status === "dismissed" || row.status === "expired") break;
    }
    await pool
      .query(`UPDATE agent_interactions SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [id])
      .catch(() => {});
    return contract({
      behavior: "deny",
      message:
        "Joe didn't respond to the permission prompt in time. Stop and summarize what you " +
        "were about to do so he can approve it next turn.",
    });
  },
);

registerAskOwner(server, { pool, json });

const transport = new StdioServerTransport();
await server.connect(transport);
