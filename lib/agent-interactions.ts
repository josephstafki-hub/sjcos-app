import "server-only";
import {validateQuestionResponse} from "@/lib/ask-context-inputs.mjs";
import {pool} from "@/lib/db";
import {withAskJournal} from "@/lib/ask-thread-journal.mjs";
import {threadPrincipal} from "@/lib/thread-access";

import { threadQuery as query, threadQueryOne as queryOne, requireRunThreadAccess, requireThreadAccess, requireInteractionThreadAccess } from "@/lib/thread-access";

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
  await requireRunThreadAccess(runId);
  if (conversationId) await requireThreadAccess(conversationId);
  // Orphan sweep first: an asker that died mid-poll leaves 'pending' forever —
  // expire anything older than 15 min so it can't haunt every future run.
  await query(
    `UPDATE agent_interactions SET status = 'expired'
      WHERE EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=agent_interactions.conversation_id AND c.owner_user_id=nullif(current_setting('sjcos.ask_actor',true),'')::uuid AND c.deleted_at IS NULL) AND status = 'pending' AND created_at < now() - interval '15 minutes'`,
  );
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM agent_interactions
      WHERE status = 'pending'
        AND (run_id = $1
             OR ($2::uuid IS NOT NULL AND conversation_id = $2))
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
  await requireInteractionThreadAccess(id);
  const person=await threadPrincipal();
  return withAskJournal(pool,async()=>{
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      await db.query("SELECT set_config('sjcos.ask_actor',$1,true)",[person.id]);
      // Same thread row/order as Canvas and completion, before interaction row.
      const owned=await db.query(`SELECT c.id FROM ai_conversations c JOIN agent_interactions i ON i.conversation_id=c.id WHERE i.id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL FOR UPDATE OF c`,[id,person.id]);
      if(!owned.rows.length)throw Error('ASK_THREAD_UNAVAILABLE');
      const old=(await db.query<Row>(`SELECT ${COLS} FROM agent_interactions WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(old.kind==='question')response=validateQuestionResponse(old.payload,response).response as InteractionResponse;
      else if(response.kind!=='permission'||!['allow','deny'].includes(response.decision)||Object.keys(response).some(k=>!['kind','decision','note'].includes(k))||('note'in response&&(typeof response.note!=='string'||response.note.length>8000)))throw Error('INVALID_INPUT');
      const row=(await db.query<Row>(`UPDATE agent_interactions SET status='answered',response=$2::jsonb,answered_at=now() WHERE id=$1 AND status='pending' RETURNING ${COLS}`,[id,JSON.stringify(response)])).rows[0];
      // 0107 trigger records response hash + sticky classification before commit.
      await db.query('COMMIT');return row?fromRow(row):null;
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
}

/** Dismiss without answering — the asker's poll treats it like a timeout. */
export async function dismissInteraction(id: string): Promise<void> {
  await requireInteractionThreadAccess(id);
  await query(
    `UPDATE agent_interactions SET status = 'dismissed', answered_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id],
  );
}
