import "server-only";

import { query, queryOne } from "@/lib/db";
import type { PanelAgent } from "@/lib/dev-agents-meta";

// Persisted AI chat: per-agent conversations + messages. Backs the /ai Ask
// window so threads survive navigation, and keeps history separated by model.
// Read/build layer only — mutations go through lib/actions/ai-chat.ts.

export interface ConversationSummary {
  id: string;
  agent: PanelAgent;
  title: string;
  updatedAt: string;
  archived: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  costUsd: number | null;
  createdAt: string;
  /** Today v2: set when this turn is ABOUT one work item (a card handed to an
   *  agent), so the feed can render that card's chips under the reply and know
   *  which item to re-check when the turn lands. */
  subjectWorkItemId: string | null;
}

export interface ConversationDetail {
  id: string;
  agent: PanelAgent;
  title: string;
  claudeSessionId: string | null;
  messages: ChatMessage[];
  /** A Claude run still in flight for this thread (so the UI resumes polling). */
  pendingRunId: string | null;
}

/** Conversations for one agent, most-recent first. Archived optional. */
export async function listConversations(
  agent: PanelAgent,
  includeArchived = false,
): Promise<ConversationSummary[]> {
  const { rows } = await query<{
    id: string;
    agent: PanelAgent;
    title: string;
    updated_at: string;
    archived: boolean;
  }>(
    `SELECT id, agent, title, updated_at::text AS updated_at, archived
       FROM ai_conversations
      WHERE agent = $1 ${includeArchived ? "" : "AND archived = false"}
      ORDER BY updated_at DESC
      LIMIT 100`,
    [agent],
  );
  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    title: r.title,
    updatedAt: r.updated_at,
    archived: r.archived,
  }));
}

/** Full thread with messages + any in-flight Claude run. */
export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const conv = await queryOne<{
    id: string;
    agent: PanelAgent;
    title: string;
    claude_session_id: string | null;
  }>(
    `SELECT id, agent, title, claude_session_id FROM ai_conversations WHERE id = $1`,
    [id],
  );
  if (!conv) return null;

  const { rows: messages } = await query<{
    id: string;
    role: "user" | "assistant";
    body: string;
    cost_usd: number | null;
    created_at: string;
    subject_work_item_id: string | null;
  }>(
    `SELECT id, role, body, cost_usd, created_at::text AS created_at, subject_work_item_id
       FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [id],
  );

  const pending = await queryOne<{ id: string }>(
    `SELECT id FROM dev_agent_runs
      WHERE conversation_id = $1 AND status IN ('pending','running')
      ORDER BY created_at DESC LIMIT 1`,
    [id],
  );

  return {
    id: conv.id,
    agent: conv.agent,
    title: conv.title,
    claudeSessionId: conv.claude_session_id,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      // pg returns `numeric` as a string — coerce for the UI's .toFixed().
      costUsd: m.cost_usd == null ? null : Number(m.cost_usd),
      createdAt: m.created_at,
      subjectWorkItemId: m.subject_work_item_id,
    })),
    pendingRunId: pending?.id ?? null,
  };
}

/** Prior turns as model input (excludes the just-inserted user message when
 *  `beforeMessageId` is given — pass the new user msg id so it isn't doubled). */
export async function getTurns(
  conversationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { rows } = await query<{ role: "user" | "assistant"; body: string }>(
    `SELECT role, body FROM ai_messages
      WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
  return rows.map((r) => ({ role: r.role, content: r.body }));
}

/** Insert a conversation. Title defaults to a trimmed first prompt. */
export async function insertConversation(agent: PanelAgent, title: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO ai_conversations (agent, title) VALUES ($1, $2) RETURNING id`,
    [agent, title.slice(0, 80) || "New chat"],
  );
  return row!.id;
}

export async function insertMessage(
  conversationId: string,
  role: "user" | "assistant",
  body: string,
  opts: { pageContext?: string; costUsd?: number; subjectWorkItemId?: string } = {},
): Promise<ChatMessage> {
  const row = await queryOne<{
    id: string;
    role: "user" | "assistant";
    body: string;
    cost_usd: number | null;
    created_at: string;
    subject_work_item_id: string | null;
  }>(
    `INSERT INTO ai_messages (conversation_id, role, body, page_context, cost_usd, subject_work_item_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, role, body, cost_usd, created_at::text AS created_at, subject_work_item_id`,
    [conversationId, role, body, opts.pageContext ?? null, opts.costUsd ?? null, opts.subjectWorkItemId ?? null],
  );
  await query(`UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  return {
    id: row!.id,
    role: row!.role,
    body: row!.body,
    costUsd: row!.cost_usd == null ? null : Number(row!.cost_usd),
    createdAt: row!.created_at,
    subjectWorkItemId: row!.subject_work_item_id,
  };
}

/** Retitle a still-default conversation from its first user message. */
export async function autoTitleIfNeeded(conversationId: string, firstPrompt: string): Promise<void> {
  const title = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
  await query(
    `UPDATE ai_conversations SET title = $2 WHERE id = $1 AND title = 'New chat'`,
    [conversationId, title],
  );
}
