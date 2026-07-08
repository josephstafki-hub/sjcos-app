"use server";

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { qwenChat } from "@/lib/ai";
import { hermesChat, startClaudeRun } from "@/lib/dev-agents";
import type { ClaudeOptions, DevAgent } from "@/lib/dev-agents-meta";
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
  agent: DevAgent,
  includeArchived = false,
): Promise<ConversationSummary[]> {
  await requireRole("owner");
  return listConversations(agent, includeArchived);
}

export async function loadConversationAction(id: string): Promise<ConversationDetail | null> {
  await requireRole("owner");
  return getConversation(id);
}

export async function newConversationAction(agent: DevAgent): Promise<string> {
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
): Promise<SendResult> {
  await requireRole("owner");
  const text = prompt.trim();
  const files = sanitizeAttachments(attachments);
  if (!text && !files.length) return { ok: false, error: "Ask something first." };

  const conv = await queryOne<{ agent: DevAgent }>(
    `SELECT agent FROM ai_conversations WHERE id = $1`,
    [conversationId],
  );
  if (!conv) return { ok: false, error: "That conversation no longer exists." };
  const agent = conv.agent;

  // Persist the user turn (with a paperclip note naming attachments) + title.
  const attachNote = files.length ? `\n\n📎 ${files.map((f) => f.name).join(", ")}` : "";
  const userMsg = await insertMessage(conversationId, "user", text + attachNote, { pageContext });
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
    const answer =
      agent === "hermes"
        ? await hermesChat(turns, pageContext, conversationId)
        : await qwenChat(turns, pageContext);

    const message = await insertMessage(conversationId, "assistant", answer);
    return { ok: true, kind: "answer", message };
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
