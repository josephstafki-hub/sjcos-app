import "server-only";

import { query, queryOne } from "@/lib/db";

// Interactive agent runs — the read/answer layer over agent_interactions.
//
// A row is one thing an agent is blocked on Joe for, rendered inline in the
// panel chat: a question box (the ask_owner MCP tool) or a tool-use approval
// (the Claude CLI's permission prompt, routed through mcp/interact-mcp.mjs).
// The asking process long-polls the row; answering here unblocks it within a
// poll tick. Writes are append/answer only — no deletes.

/** One option in a question (AskUserQuestion-shaped). */
export interface InteractionOption {
  label: string;
  description?: string;
}

export interface InteractionQuestion {
  question: string;
  /** Short chip shown over the question ("Approach", "Send?"). */
  header?: string;
  options: InteractionOption[];
  multiSelect?: boolean;
  /** Offer a free-text "Other…" input alongside the options (default true). */
  allowOther?: boolean;
}

/** payload for kind 'question'. */
export interface QuestionPayload {
  questions: InteractionQuestion[];
}

/** payload for kind 'permission' — one tool call awaiting approval. */
export interface PermissionPayload {
  tool: string;
  /** The tool's input, pretty-printed and truncated server-side. */
  input: string;
  /** Human line, e.g. "Run: rm -rf …" (mirrors the CLI's prompt). */
  description: string;
}

export interface AgentInteraction {
  id: string;
  runId: string | null;
  conversationId: string | null;
  agent: string;
  kind: "question" | "permission";
  payload: QuestionPayload | PermissionPayload;
  status: "pending" | "answered" | "dismissed" | "expired";
  response: InteractionResponse | null;
  createdAt: string;
}

/** What Joe answered. Questions: one entry per question (labels of the chosen
 *  options, plus optional free text). Permissions: allow/deny + note. */
export type InteractionResponse =
  | { kind: "question"; answers: { question: string; choices: string[]; other?: string }[] }
  | { kind: "permission"; decision: "allow" | "deny"; note?: string };

const COLS = `id, run_id, conversation_id, agent, kind, payload, status, response,
  created_at::text AS created_at`;

interface Row {
  id: string;
  run_id: string | null;
  conversation_id: string | null;
  agent: string;
  kind: "question" | "permission";
  payload: QuestionPayload | PermissionPayload;
  status: AgentInteraction["status"];
  response: InteractionResponse | null;
  created_at: string;
}

const fromRow = (r: Row): AgentInteraction => ({
  id: r.id,
  runId: r.run_id,
  conversationId: r.conversation_id,
  agent: r.agent,
  kind: r.kind,
  payload: r.payload,
  status: r.status,
  response: r.response,
  createdAt: r.created_at,
});

/**
 * Pending interactions the panel should show while following `runId`. Matches
 * rows tagged with the run or its conversation, PLUS recent untagged rows —
 * a Hermes gateway ask (its MCP process knows neither id) still surfaces.
 * Single-owner app: an untagged pending ask can only be for Joe.
 */
export async function listPendingInteractions(
  runId: string,
  conversationId: string | null,
): Promise<AgentInteraction[]> {
  // Orphan sweep first: an asker that died mid-poll leaves 'pending' forever —
  // expire anything older than 15 min so it can't haunt every future run.
  await query(
    `UPDATE agent_interactions SET status = 'expired'
      WHERE status = 'pending' AND created_at < now() - interval '15 minutes'`,
  );
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM agent_interactions
      WHERE status = 'pending'
        AND (run_id = $1
             OR ($2::uuid IS NOT NULL AND conversation_id = $2)
             OR (run_id IS NULL AND conversation_id IS NULL))
      ORDER BY created_at ASC
      LIMIT 5`,
    [runId, conversationId],
  );
  return rows.map(fromRow);
}

/** Answer a pending interaction (the asker's poll picks it up ≤2s later). */
export async function answerInteraction(
  id: string,
  response: InteractionResponse,
): Promise<AgentInteraction | null> {
  const row = await queryOne<Row>(
    `UPDATE agent_interactions
        SET status = 'answered', response = $2::jsonb, answered_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${COLS}`,
    [id, JSON.stringify(response)],
  );
  return row ? fromRow(row) : null;
}

/** Dismiss without answering — the asker's poll treats it like a timeout. */
export async function dismissInteraction(id: string): Promise<void> {
  await query(
    `UPDATE agent_interactions SET status = 'dismissed', answered_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id],
  );
}
