"use server";

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { qwenChat } from "@/lib/ai";
import { hermesChat, startClaudeRun } from "@/lib/dev-agents";
import { finalizeHermesAnswer } from "@/lib/orchestrator/effects";
import { escalateToHermesLadder, runHermesLadder } from "@/lib/orchestrator/ladder";
import { processQwenProposals, setEscalateHook } from "@/lib/orchestrator/proposals";
import { routeMessage } from "@/lib/orchestrator/router";
import { conciergeTurn } from "@/lib/orchestrator/voice";

// A Qwen proposal Claude holds re-routes to the Hermes ladder (registered here
// because proposals.ts can't import ladder.ts without a cycle).
setEscalateHook(escalateToHermesLadder);
import type { ClaudeOptions, DevAgent, PanelAgent } from "@/lib/dev-agents-meta";
import {
  listConversations,
  getConversation,
  getTurns,
  insertConversation,
  insertMessage,
  autoTitleIfNeeded,
  type ConversationSummary,
  type ConversationDetail,
  type ChatMessage,
} from "@/lib/ai-chat";

// Persisted Ask-window actions. Owner-only. Qwen/Hermes answer inline (with
// full conversation history); Claude returns a run id the client polls — its
// detached runner persists the reply and resumes the CLI session.

export async function listConversationsAction(
  agent: PanelAgent,
  includeArchived = false,
): Promise<ConversationSummary[]> {
  await requireRole("owner");
  return listConversations(agent, includeArchived);
}

export async function loadConversationAction(id: string): Promise<ConversationDetail | null> {
  await requireRole("owner");
  return getConversation(id);
}

export async function newConversationAction(agent: PanelAgent): Promise<string> {
  await requireRole("owner");
  return insertConversation(agent, "New chat");
}

// ─── File attachments (uploaded from the Ask composer) ───────────────────────
// Saved under uploads/ai-chat/. Claude gets the absolute paths (it reads them
// with its file tools); Qwen/Hermes have no filesystem access, so we inline the
// text contents of readable files into the prompt.

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "ai-chat");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_INLINE_CHARS = 40_000; // per file, when inlining text for Qwen/Hermes

export interface ChatAttachment {
  name: string;
  path: string;
}

export type UploadResult =
  | { ok: true; files: ChatAttachment[] }
  | { ok: false; error: string };

/** Persist uploaded files and return their on-disk absolute paths. */
export async function uploadChatFilesAction(formData: FormData): Promise<UploadResult> {
  await requireRole("owner");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return { ok: false, error: "No files selected." };
  await mkdir(UPLOAD_DIR, { recursive: true });
  const out: ChatAttachment[] = [];
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${f.name} is over the 25 MB limit.` };
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
    const dest = path.join(UPLOAD_DIR, `${randomUUID()}-${safe}`);
    await writeFile(dest, Buffer.from(await f.arrayBuffer()));
    out.push({ name: f.name, path: dest });
  }
  return { ok: true, files: out };
}

/** Keep only attachments that live in our upload dir (guards path traversal). */
function sanitizeAttachments(atts?: ChatAttachment[]): ChatAttachment[] {
  return (atts ?? []).filter((a) => a?.path?.startsWith(UPLOAD_DIR + path.sep));
}

/** Inline readable text of attachments for the models without file access. */
async function inlineAttachmentText(atts: ChatAttachment[]): Promise<string> {
  const parts: string[] = [];
  for (const a of atts) {
    try {
      const buf = await readFile(a.path);
      const text = buf.toString("utf8");
      if (text.includes("\u0000")) {
        parts.push(`### ${a.name}\n(binary file — not shown)`);
      } else {
        const clipped = text.length > MAX_INLINE_CHARS ? text.slice(0, MAX_INLINE_CHARS) + "\n…(truncated)" : text;
        parts.push(`### ${a.name}\n${clipped}`);
      }
    } catch {
      parts.push(`### ${a.name}\n(could not read file)`);
    }
  }
  return parts.length ? `\n\n[Attached files]\n${parts.join("\n\n")}` : "";
}

export type SendResult =
  | { ok: true; kind: "answer"; message: ChatMessage }
  | { ok: true; kind: "pending"; runId: string; userMessageId: string }
  | { ok: false; error: string };

/** Send a message in a conversation. `conversationId` may be a fresh one just
 *  created for the selected agent. */
export async function sendMessageAction(
  conversationId: string,
  prompt: string,
  pageContext?: string,
  claudeOptions?: Partial<ClaudeOptions>,
  attachments?: ChatAttachment[],
  subjectWorkItemId?: string,
): Promise<SendResult> {
  await requireRole("owner");
  const text = prompt.trim();
  const files = sanitizeAttachments(attachments);
  if (!text && !files.length) return { ok: false, error: "Ask something first." };

  const conv = await queryOne<{ agent: PanelAgent }>(
    `SELECT agent FROM ai_conversations WHERE id = $1`,
    [conversationId],
  );
  if (!conv) return { ok: false, error: "That conversation no longer exists." };

  // "Auto" conversations have no pinned model — route this message. A pinned
  // conversation IS the bypass: the router never sees it. The dev_agent_runs
  // row records who actually ran, so the transcript stays honest.
  let agent: DevAgent;
  let routedVia: string | undefined;
  if (conv.agent === "auto") {
    const decision = await routeMessage(text, pageContext);
    agent = decision.agent;
    routedVia = decision.via;
  } else {
    agent = conv.agent;
  }

  // Persist the user turn (with a paperclip note naming attachments) + title.
  // subjectWorkItemId marks a Today-feed hand-off (a card given to an agent).
  // Blank line only when there's text to separate from — an attachment-only
  // send would otherwise persist with leading newlines the composer didn't show.
  const attachNote = files.length
    ? `${text ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}`
    : "";
  const userMsg = await insertMessage(conversationId, "user", text + attachNote, {
    pageContext,
    subjectWorkItemId,
  });
  await autoTitleIfNeeded(conversationId, text || files[0]?.name || "New chat");

  try {
    if (agent === "claude") {
      // Claude reads files itself — hand it the absolute paths in the prompt.
      const claudePrompt = files.length
        ? `${text}\n\nThe user attached these files (absolute paths — read them):\n${files
            .map((f) => `- ${f.path}`)
            .join("\n")}`
        : text;
      // Async: the detached runner persists the assistant reply + session id.
      const runId = await startClaudeRun(claudePrompt, pageContext, conversationId, claudeOptions);
      return { ok: true, kind: "pending", runId, userMessageId: userMsg.id };
    }

    // Qwen/Hermes can't open files — inline their text into the latest turn.
    const turns = await getTurns(conversationId); // includes the user turn just added
    if (files.length && turns.length) {
      turns[turns.length - 1].content += await inlineAttachmentText(files);
    }

    // Run the turn in the background (see startBackgroundTurn) and hand the
    // client a run id to poll.
    const runId = await startBackgroundTurn({
      conversationId,
      agent,
      reviewed: conv.agent === "auto",
      text,
      turns,
      pageContext,
      subjectWorkItemId,
      activity: routedVia ? `Routed to ${agent === "hermes" ? "Hermes" : "Qwen"} (${routedVia}) — thinking…` : undefined,
    });

    return { ok: true, kind: "pending", runId, userMessageId: userMsg.id };
  } catch (err) {
    // Save the failure as an assistant message so the thread reflects it.
    const message = await insertMessage(
      conversationId,
      "assistant",
      `⚠️ ${(err as Error).message}`,
    );
    return { ok: true, kind: "answer", message };
  }
}

export async function renameConversationAction(id: string, title: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (t) await query(`UPDATE ai_conversations SET title = $2 WHERE id = $1`, [id, t]);
  return { ok: true };
}

export async function archiveConversationAction(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(`UPDATE ai_conversations SET archived = $2, updated_at = now() WHERE id = $1`, [
    id,
    archived,
  ]);
  return { ok: true };
}

export async function deleteConversationAction(id: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(`DELETE FROM ai_conversations WHERE id = $1`, [id]);
  return { ok: true };
}

// ─── Background turns ────────────────────────────────────────────────────────

interface BackgroundTurn {
  conversationId: string;
  agent: "hermes" | "qwen";
  /** True when this thread is 'auto' — Hermes runs the full Claude-reviewed
   *  ladder. A pinned Hermes thread bypasses review (the escape hatch). */
  reviewed: boolean;
  /** The task as the run row records it (the transcript's user turn). */
  text: string;
  turns: { role: "user" | "assistant"; content: string }[];
  pageContext?: string;
  subjectWorkItemId?: string;
  activity?: string;
}

/**
 * Create the dev_agent_runs row and run a Qwen/Hermes turn in the background.
 * A Hermes turn that has to go look things up ("mark this todo done") can run
 * an agentic tool loop for minutes — holding that as one open HTTP request is
 * what used to crash the page (proxy/browser give up long before Hermes does).
 * Claude avoids this by running detached and being polled; Qwen/Hermes do the
 * same via the same dev_agent_runs row, just in-process, because this server
 * is a long-lived systemd process rather than a serverless function.
 *
 * Shared by the typed send path (sendMessageAction) and the voice concierge
 * (voiceTurnAction) so a delegated task gets exactly the same pipeline —
 * ladder, proposals review, effects — as a typed one.
 */
async function startBackgroundTurn(t: BackgroundTurn): Promise<string> {
  const { conversationId, agent, reviewed, text, turns, pageContext, subjectWorkItemId } = t;
  const label = agent === "hermes" ? "Hermes" : "Qwen";
  const run = await queryOne<{ id: string }>(
    `INSERT INTO dev_agent_runs (agent, prompt, page_context, status, conversation_id, activity, subject_work_item_id)
     VALUES ($1, $2, $3, 'running', $4, $5, $6)
     RETURNING id`,
    [agent, text, pageContext ?? null, conversationId, t.activity ?? `${label} is thinking…`, subjectWorkItemId ?? null],
  );
  const runId = run!.id;

  void (async () => {
    try {
      // Three completion pipelines:
      //  - Hermes in an 'auto' thread → the full ladder (Claude reviews,
      //    feedback rounds, possible takeover). Pinning Hermes in the rail
      //    bypasses review — same escape hatch as routing.
      //  - Hermes pinned → plain turn + effects bookkeeping.
      //  - Qwen → pending-write pipeline (propose → Claude review → execute).
      let answer: string;
      if (agent === "hermes" && reviewed) {
        answer = await runHermesLadder({ runId, conversationId, taskPrompt: text, pageContext });
      } else if (agent === "hermes") {
        const raw = await hermesChat(turns, pageContext, conversationId);
        answer = await finalizeHermesAnswer(runId, raw);
      } else {
        const raw = await qwenChat(turns, pageContext);
        answer = await processQwenProposals(runId, conversationId, text, raw, pageContext);
      }
      await insertMessage(conversationId, "assistant", answer);
      await query(
        `UPDATE dev_agent_runs SET status = 'done', answer = $2, updated_at = now() WHERE id = $1`,
        [runId, answer],
      );
    } catch (err) {
      const msg = `⚠️ ${(err as Error).message}`;
      await insertMessage(conversationId, "assistant", msg);
      await query(
        `UPDATE dev_agent_runs SET status = 'error', answer = $2, updated_at = now() WHERE id = $1`,
        [runId, msg],
      );
    }
  })();

  return runId;
}

// ─── Voice concierge ─────────────────────────────────────────────────────────

export type VoiceTurnResult =
  | { ok: true; speak: string; ackMessageId: string; runId?: string; delegatedTo?: "hermes" | "qwen" }
  | { ok: false; error: string };

/**
 * A voice-mode turn: Claude answers out loud right away and, when the ask
 * needs OS work, delegates it as a normal background run in this thread
 * (polled by the client like any other; its result is spoken via
 * POST /api/tts {runId}). Claude is the only voice Joe hears — Hermes/Qwen do
 * work, Claude reports. Works in any thread regardless of the rail pin: a
 * pinned Hermes/Qwen thread just fixes who the delegate is.
 */
export async function voiceTurnAction(
  conversationId: string,
  transcript: string,
  pageContext?: string,
): Promise<VoiceTurnResult> {
  await requireRole("owner");
  const text = transcript.trim();
  if (!text) return { ok: false, error: "I didn't catch that." };

  const conv = await queryOne<{ agent: PanelAgent }>(
    `SELECT agent FROM ai_conversations WHERE id = $1`,
    [conversationId],
  );
  if (!conv) return { ok: false, error: "That conversation no longer exists." };

  const before = await getTurns(conversationId);
  await insertMessage(conversationId, "user", text, { pageContext });
  await autoTitleIfNeeded(conversationId, text);

  const reply = await conciergeTurn(text, before, pageContext);
  const ack = await insertMessage(conversationId, "assistant", `🗣 ${reply.speak}`);

  if (!reply.delegate) return { ok: true, speak: reply.speak, ackMessageId: ack.id };

  // Honor a pinned thread's agent; 'auto'/'claude' threads take Claude's pick.
  const agent: "hermes" | "qwen" =
    conv.agent === "hermes" || conv.agent === "qwen" ? conv.agent : reply.delegate.agent;
  const turns = await getTurns(conversationId);
  const runId = await startBackgroundTurn({
    conversationId,
    agent,
    reviewed: conv.agent === "auto" || conv.agent === "claude",
    text: reply.delegate.task,
    turns,
    // The delegate sees Joe's words in the transcript; Claude's precise task
    // rides along as context so ids and intent survive the hand-off.
    pageContext: `${pageContext ?? ""}

Delegated by Claude (voice concierge) — do exactly this:
${reply.delegate.task}`.trim(),
    activity: `${agent === "hermes" ? "Hermes" : "Qwen"} is on it (delegated by Claude)…`,
  });
  return { ok: true, speak: reply.speak, ackMessageId: ack.id, runId, delegatedTo: agent };
}
