"use server";

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireAccess, requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { isVisionModel, qwenChat } from "@/lib/ai";
import { hermesChat, startClaudeRun } from "@/lib/dev-agents";
import { finalizeHermesAnswer } from "@/lib/orchestrator/effects";
import { escalateToHermesLadder, runHermesLadder } from "@/lib/orchestrator/ladder";
import { processQwenProposals, setEscalateHook } from "@/lib/orchestrator/proposals";
import { routeMessage } from "@/lib/orchestrator/router";
import { conciergeTurn } from "@/lib/orchestrator/voice";
import { hermesProgress, qwenProgress, runLog } from "@/lib/orchestrator/activity";
import { composeHermesTurn, composeQwenTurns, lastAnsweringAgent } from "@/lib/orchestrator/thread";
import { UPLOAD_DIR, sanitizeAttachments } from "@/lib/attachments";
import {
  bindFolder,
  createFolder,
  deleteFolder,
  ensureFolderForEntity,
  fileThreadUnderEntity,
  folderContextLine,
  listArchivedThreads,
  listThreadRail,
  moveThread,
  renameFolder,
  reorderFolders,
  searchFolderEntities,
  setFolderArchived,
  setFolderCollapsed,
  setThreadArchived,
  setThreadPinned,
  settleThread,
  touchThreadActivity,
  unsettleThread,
  type ThreadRail,
} from "@/lib/thread-folders";
import type { FolderEntityRef, RailThread } from "@/lib/thread-rail";
import type { JobPick } from "@/lib/thread-folders";

// A Qwen proposal Claude holds re-routes to the Hermes ladder (registered here
// because proposals.ts can't import ladder.ts without a cycle).
setEscalateHook(escalateToHermesLadder);
import type { ChatAttachment, ClaudeOptions, DevAgent, PanelAgent } from "@/lib/dev-agents-meta";
import {
  listConversations,
  listAllConversations,
  getConversation,
  getTurns,
  insertConversation,
  insertMessage,
  autoTitleIfNeeded,
  type ConversationSummary,
  type ConversationDetail,
  type ChatMessage,
  type ThreadListItem,
} from "@/lib/ai-chat";

// Persisted Ask-window actions. Owner-only. Qwen/Hermes answer inline (with
// full conversation history); Claude returns a run id the client polls — its
// detached runner persists the reply and resumes the CLI session.

export async function listConversationsAction(
  agent: PanelAgent,
  includeArchived = false,
): Promise<ConversationSummary[]> {
  await requireAccess("ai");
  return listConversations(agent, includeArchived);
}

/** All threads across agents for the panel's thread rail/drawer. */
export async function listAllConversationsAction(
  includeArchived = false,
): Promise<ThreadListItem[]> {
  await requireAccess("ai");
  return listAllConversations(includeArchived);
}

export async function loadConversationAction(id: string): Promise<ConversationDetail | null> {
  await requireAccess("ai");
  return getConversation(id);
}

/** Start a thread. It files only where the client explicitly says
 *  (docs/thread-folders-plan.md §3.6): a folder id, or a job whose folder is
 *  created on first use — otherwise Unfiled. The app view's route never files
 *  a thread on its own. */
export async function newConversationAction(
  agent: PanelAgent,
  where?: { folderId?: string | null; entity?: FolderEntityRef | null },
): Promise<string> {
  await requireAccess("ai");
  let folderId: string | null = where?.folderId ?? null;
  if (!folderId && where?.entity) folderId = await ensureFolderForEntity(where.entity).catch(() => null);
  return insertConversation(agent, "New chat", folderId);
}

// ─── File attachments (uploaded from the Ask composer) ───────────────────────
// Saved under uploads/ai-chat/ and recorded on the user message row, so a file
// from turn 1 is still there for whoever answers turn 3. How each model reads
// them lives in lib/attachments.ts: Claude gets the absolute paths (its Read
// tool handles text/PDF/images); Hermes gets extracted text + images as
// multimodal parts + the path (its terminal runs on this box); Qwen gets
// extracted text (and images only if OLLAMA_MODEL is a vision model).

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file

export type UploadResult =
  | { ok: true; files: ChatAttachment[] }
  | { ok: false; error: string };

/** Persist uploaded files and return their on-disk absolute paths. */
export async function uploadChatFilesAction(formData: FormData): Promise<UploadResult> {
  await requireAccess("ai");
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

export type SendResult =
  | { ok: true; kind: "answer"; message: ChatMessage }
  | { ok: true; kind: "pending"; runId: string; userMessageId: string }
  | { ok: false; error: string };

/** Send a message in a conversation. `conversationId` may be a fresh one just
 *  created for the selected agent. `allowSends` is the Ask window's per-message
 *  "Express permission" checkbox for a Claude turn: it mints a run-scoped owner
 *  grant (lib/owner-grants.ts) so Claude may perform the client-facing sends
 *  the message asks for. Deliberately not part of ClaudeOptions (which persist
 *  in panelStore) — permission must never outlive the message that gave it. */
export async function sendMessageAction(
  conversationId: string,
  prompt: string,
  pageContext?: string,
  claudeOptions?: Partial<ClaudeOptions>,
  attachments?: ChatAttachment[],
  subjectWorkItemId?: string,
  allowSends?: boolean,
): Promise<SendResult> {
  await requireAccess("ai");
  const text = prompt.trim();
  const files = sanitizeAttachments(attachments);
  if (!text && !files.length) return { ok: false, error: "Ask something first." };
  // What the model is asked (an attachment-only send still needs a sentence).
  const taskText = text || `(no message — see the attached file${files.length > 1 ? "s" : ""}: ${files.map((f) => f.name).join(", ")})`;

  const conv = await queryOne<{ agent: PanelAgent }>(
    `SELECT agent FROM ai_conversations WHERE id = $1`,
    [conversationId],
  );
  if (!conv) return { ok: false, error: "That conversation no longer exists." };

  // "Auto" conversations have no pinned model — route this message. A pinned
  // conversation IS the bypass: the router never sees it. The router is told
  // who answered last so a follow-up ("yes, do that", "the second one") stays
  // with that agent instead of being re-routed cold; the dev_agent_runs row
  // and the message's `agent` tag record who actually ran.
  let agent: DevAgent;
  let routedVia: string | undefined;
  if (conv.agent === "auto") {
    const lastAgent = await lastAnsweringAgent(conversationId);
    const lastAnswer = lastAgent
      ? (await queryOne<{ body: string }>(
          `SELECT body FROM ai_messages WHERE conversation_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
          [conversationId],
        ))?.body
      : undefined;
    const decision = await routeMessage(taskText, pageContext, { lastAgent, lastAnswer });
    agent = decision.agent;
    routedVia = decision.via;
  } else {
    agent = conv.agent;
  }

  // Persist the user turn (with a paperclip note naming attachments, and the
  // attachments themselves so later turns can still read them) + title.
  // subjectWorkItemId marks a Today-feed hand-off (a card given to an agent).
  // Blank line only when there's text to separate from — an attachment-only
  // send would otherwise persist with leading newlines the composer didn't show.
  const attachNote = files.length
    ? `${text ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}`
    : "";
  // A real message is activity: it clears a settled/keep-active override and
  // re-anchors the thread in the rail only if it was parked (lib/thread-folders).
  await touchThreadActivity(conversationId);
  // The job this thread is filed under rides along with the page grounding so
  // the agent knows what "the kitchen" refers to even off the project's page.
  const folderLine = await folderContextLine(conversationId).catch(() => null);
  if (folderLine) pageContext = pageContext ? `${folderLine}\n\n${pageContext}` : folderLine;
  const userMsg = await insertMessage(conversationId, "user", text + attachNote, {
    pageContext,
    subjectWorkItemId,
    attachments: files,
  });
  await autoTitleIfNeeded(conversationId, text || files[0]?.name || "New chat");

  try {
    if (agent === "claude") {
      // Claude reads files itself — hand it the absolute paths in the prompt.
      // (The runner adds the thread turns Claude hasn't seen, if any.)
      const claudePrompt = files.length
        ? `${taskText}\n\nThe user attached these files (absolute paths — read them with your Read tool; it handles PDFs and images):\n${files
            .map((f) => `- ${f.path}`)
            .join("\n")}`
        : text;
      // Async: the detached runner persists the assistant reply + session id.
      const runId = await startClaudeRun(
        claudePrompt,
        pageContext,
        conversationId,
        claudeOptions,
        undefined,
        allowSends ? { allowSends: true } : undefined,
      );
      return { ok: true, kind: "pending", runId, userMessageId: userMsg.id };
    }

    // Run the turn in the background (see startBackgroundTurn) and hand the
    // client a run id to poll.
    const runId = await startBackgroundTurn({
      conversationId,
      agent,
      reviewed: conv.agent === "auto",
      text: taskText,
      attachments: files,
      pageContext,
      subjectWorkItemId,
      activity: routedVia
        ? `${routedVia === "thread" ? "Staying with" : "Routed to"} ${agent === "hermes" ? "Hermes" : "Qwen"} (${routedVia}) — thinking…`
        : undefined,
    });

    return { ok: true, kind: "pending", runId, userMessageId: userMsg.id };
  } catch (err) {
    // Save the failure as an assistant message so the thread reflects it.
    const message = await insertMessage(
      conversationId,
      "assistant",
      `⚠️ ${(err as Error).message}`,
      { agent },
    );
    return { ok: true, kind: "answer", message };
  }
}

/** "Fresh session": drop the thread's CLI session so the next Claude turn
 *  starts clean (full prompt, empty context) instead of resuming. The
 *  transcript stays — only Claude's own memory of it resets. */
export async function resetClaudeSessionAction(conversationId: string): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await query(`UPDATE ai_conversations SET claude_session_id = NULL WHERE id = $1`, [conversationId]);
  return { ok: true };
}

export async function renameConversationAction(id: string, title: string): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (t) await query(`UPDATE ai_conversations SET title = $2 WHERE id = $1`, [id, t]);
  return { ok: true };
}

/** Archive hides the thread (kept under "Show archived"); refused while a run
 *  is live. Restore un-hides it. */
export async function archiveConversationAction(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("ai");
  const r = await setThreadArchived(id, archived);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ─── Thread rail: lifecycle + folders (docs/thread-folders-plan.md) ──────────
// Thin owner-gated wrappers over lib/thread-folders.ts. The rail re-partitions
// client-side (lib/thread-rail.ts) and reloads after each mutation.

export async function listThreadRailAction(): Promise<ThreadRail> {
  await requireAccess("ai");
  return listThreadRail();
}

export async function listArchivedThreadsAction(): Promise<RailThread[]> {
  await requireAccess("ai");
  return listArchivedThreads();
}

/** ✓ "I'm done with this" → Settled shelf. Refused while working/blocked. */
export async function settleConversationAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("ai");
  const r = await settleThread(id);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** ↶ back to the active list, and auto-settle leaves it alone from now on. */
export async function unsettleConversationAction(id: string): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await unsettleThread(id);
  return { ok: true };
}

export async function pinConversationAction(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await setThreadPinned(id, pinned);
  return { ok: true };
}

/** Move a thread into a folder (null = Unfiled). */
export async function moveConversationAction(id: string, folderId: string | null): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await moveThread(id, folderId);
  return { ok: true };
}

/** The "File under Larson kitchen?" chip: into that job's folder (created on
 *  first use). */
export async function fileConversationUnderAction(
  id: string,
  entity: FolderEntityRef,
): Promise<{ ok: boolean; folderId: string | null }> {
  await requireAccess("ai");
  const folderId = await fileThreadUnderEntity(id, entity);
  return { ok: folderId != null, folderId };
}

export async function createFolderAction(name: string): Promise<{ ok: boolean; id: string }> {
  await requireAccess("ai");
  return { ok: true, id: await createFolder(name) };
}

/** A folder for a job (project/lead page), created on first use. */
export async function ensureEntityFolderAction(entity: FolderEntityRef): Promise<{ ok: boolean; id: string | null }> {
  await requireAccess("ai");
  const id = await ensureFolderForEntity(entity);
  return { ok: id != null, id };
}

export async function renameFolderAction(id: string, name: string): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await renameFolder(id, name);
  return { ok: true };
}

/** Jobs for the rail's picker (link a folder / new folder for a job). */
export async function searchJobsAction(q: string): Promise<JobPick[]> {
  await requireRole("owner");
  return searchFolderEntities(q);
}

/** Link a folder to a job (null unlinks). A slug or uuid of a project / lead /
 *  vendor / sub. */
export async function bindFolderAction(
  id: string,
  entity: FolderEntityRef | null,
): Promise<{ ok: boolean; error?: string; existingFolderId?: string }> {
  await requireAccess("ai");
  const r = await bindFolder(id, entity);
  return r.ok ? { ok: true } : { ok: false, error: r.error, existingFolderId: r.existingFolderId };
}

/** Manual folder order from a drag reorder in the rail. */
export async function reorderFoldersAction(ids: string[]): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await reorderFolders(ids.filter((id) => typeof id === "string").slice(0, 500));
  return { ok: true };
}

export async function setFolderCollapsedAction(id: string, collapsed: boolean): Promise<{ ok: boolean }> {
  await requireAccess("ai");
  await setFolderCollapsed(id, collapsed);
  return { ok: true };
}

export async function archiveFolderAction(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("ai");
  const r = await setFolderArchived(id, archived);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Delete the folder; its threads become Unfiled. */
export async function deleteFolderAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("ai");
  const r = await deleteFolder(id);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function deleteConversationAction(id: string): Promise<{ ok: boolean }> {
  await requireAccess("ai");
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
  /** Files uploaded with this turn (already persisted on the user message). */
  attachments: ChatAttachment[];
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
  const { conversationId, agent, reviewed, text, attachments, pageContext, subjectWorkItemId } = t;
  const label = agent === "hermes" ? "Hermes" : "Qwen";
  const run = await queryOne<{ id: string }>(
    `INSERT INTO dev_agent_runs (agent, prompt, page_context, status, conversation_id, activity, subject_work_item_id)
     VALUES ($1, $2, $3, 'running', $4, $5, $6)
     RETURNING id`,
    [agent, text, pageContext ?? null, conversationId, t.activity ?? `${label} is thinking…`, subjectWorkItemId ?? null],
  );
  const runId = run!.id;

  void (async () => {
    // Live "what it's doing" log — every stage appends; the panel shows it all.
    const log = runLog(runId, [t.activity ?? `${label} is thinking…`]);
    try {
      // Three completion pipelines:
      //  - Hermes in an 'auto' thread → the full ladder (Claude reviews,
      //    feedback rounds, possible takeover). Pinning Hermes in the rail
      //    bypasses review — same escape hatch as routing.
      //  - Hermes pinned → plain turn + effects bookkeeping.
      //  - Qwen → pending-write pipeline (propose → Claude review → execute).
      // Each pipeline builds the model's input from the thread itself
      // (lib/orchestrator/thread.ts): Hermes gets the turns its gateway
      // session hasn't seen + this turn's files as text/images; Qwen gets the
      // whole thread with every turn's files inlined.
      let answer: string;
      if (agent === "hermes" && reviewed) {
        answer = await runHermesLadder({ runId, conversationId, taskPrompt: text, attachments, pageContext, log });
      } else if (agent === "hermes") {
        const turn = await composeHermesTurn(conversationId, { text, attachments });
        const raw = await hermesChat(
          [{ role: "user", content: turn.content, images: turn.images }],
          pageContext,
          conversationId,
          hermesProgress(log),
        );
        answer = await finalizeHermesAnswer(runId, raw);
      } else {
        const turns = await composeQwenTurns(conversationId, { vision: isVisionModel() });
        const raw = await qwenChat(turns, pageContext, qwenProgress(log));
        log.push("Checking for proposed changes…");
        answer = await processQwenProposals(runId, conversationId, text, raw, pageContext);
      }
      log.push("Done.");
      await log.flush();
      // Guarded on status: if Joe hit ⏹ Stop, the row is already 'error' and
      // this late result must not overwrite it (or double-post a reply).
      const settled = await queryOne<{ id: string }>(
        `UPDATE dev_agent_runs SET status = 'done', answer = $2, updated_at = now()
          WHERE id = $1 AND status IN ('pending','running') RETURNING id`,
        [runId, answer],
      );
      if (settled) await insertMessage(conversationId, "assistant", answer, { agent });
    } catch (err) {
      const msg = `⚠️ ${(err as Error).message}`;
      log.push(msg);
      await log.flush();
      const settled = await queryOne<{ id: string }>(
        `UPDATE dev_agent_runs SET status = 'error', answer = $2, updated_at = now()
          WHERE id = $1 AND status IN ('pending','running') RETURNING id`,
        [runId, msg],
      );
      if (settled) await insertMessage(conversationId, "assistant", msg, { agent });
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
  await requireAccess("ai");
  const text = transcript.trim();
  if (!text) return { ok: false, error: "I didn't catch that." };

  const conv = await queryOne<{ agent: PanelAgent }>(
    `SELECT agent FROM ai_conversations WHERE id = $1`,
    [conversationId],
  );
  if (!conv) return { ok: false, error: "That conversation no longer exists." };

  await touchThreadActivity(conversationId);
  const folderLine = await folderContextLine(conversationId).catch(() => null);
  if (folderLine) pageContext = pageContext ? `${folderLine}\n\n${pageContext}` : folderLine;
  const before = await getTurns(conversationId);
  await insertMessage(conversationId, "user", text, { pageContext });
  await autoTitleIfNeeded(conversationId, text);

  const reply = await conciergeTurn(text, before, pageContext);
  const ack = await insertMessage(conversationId, "assistant", `🗣 ${reply.speak}`, { agent: "concierge" });

  if (!reply.delegate) return { ok: true, speak: reply.speak, ackMessageId: ack.id };

  // Honor a pinned thread's agent; 'auto'/'claude' threads take Claude's pick.
  const agent: "hermes" | "qwen" =
    conv.agent === "hermes" || conv.agent === "qwen" ? conv.agent : reply.delegate.agent;
  const runId = await startBackgroundTurn({
    conversationId,
    agent,
    reviewed: conv.agent === "auto" || conv.agent === "claude",
    text: reply.delegate.task,
    attachments: [],
    // The delegate sees Joe's words in the transcript; Claude's precise task
    // rides along as context so ids and intent survive the hand-off.
    pageContext: `${pageContext ?? ""}

Delegated by Claude (voice concierge) — do exactly this:
${reply.delegate.task}`.trim(),
    activity: `${agent === "hermes" ? "Hermes" : "Qwen"} is on it (delegated by Claude)…`,
  });
  return { ok: true, speak: reply.speak, ackMessageId: ack.id, runId, delegatedTo: agent };
}
