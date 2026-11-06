"use server";

import {withAskJournal} from "@/lib/ask-thread-journal.mjs";
import {pinAttachments} from "@/lib/ask-context-inputs.mjs";
import {pool} from "@/lib/db";
import { admitAskRun, currentAskLaunchSource, type AskLaunchSource } from "@/lib/ask-run-admission";

import type { AskFailure, AskResult, AskDeleteResult } from "@/lib/ask-result-codes";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadPanelContext, type PanelContextRef } from "@/lib/panel-context";
import { askBoundary, askFailure, askThreadCapabilities, deleteOwnedThread, threadPrincipal, withThreadAttachmentAccess, requireThreadAccess, threadQuery as query, threadQueryOne as queryOne } from "@/lib/thread-access";
import { hermesChat, startClaudeRun } from "@/lib/dev-agents";
import { finalizeHermesAnswer } from "@/lib/orchestrator/effects";
import { escalateToHermesLadder, runHermesLadder } from "@/lib/orchestrator/ladder";
import { processQwenProposals, setEscalateHook } from "@/lib/orchestrator/proposals";
import { routeMessage } from "@/lib/orchestrator/router";
import { conciergeTurn } from "@/lib/orchestrator/voice";
import { hermesProgress, runLog } from "@/lib/orchestrator/activity";
import { qwenSteerable } from "@/lib/orchestrator/qwen-turn";
import { settleSteeredRun } from "@/lib/run-steers";
import { composeHermesTurn, lastAnsweringAgent } from "@/lib/orchestrator/thread";
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

async function listConversationsActionImpl(
  agent: PanelAgent,
  includeArchived = false,
): Promise<ConversationSummary[]> {
  await threadPrincipal();
  return listConversations(agent, includeArchived);
}

/** All threads across agents for the panel's thread rail/drawer. */
async function listAllConversationsActionImpl(
  includeArchived = false,
): Promise<ThreadListItem[]> {
  await threadPrincipal();
  return listAllConversations(includeArchived);
}

async function loadConversationActionImpl(id: string): Promise<ConversationDetail | null> {
  await threadPrincipal();
  return getConversation(id);
}

/** Start a thread. It files only where the client explicitly says
 *  (docs/thread-folders-plan.md §3.6): a folder id, or a job whose folder is
 *  created on first use — otherwise Unfiled. The app view's route never files
 *  a thread on its own. */
async function newConversationActionImpl(
  agent: PanelAgent,
  where?: { folderId?: string | null; entity?: FolderEntityRef | null },
): Promise<string> {
  await threadPrincipal();
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
  | { ok: false; error: string }
  | AskFailure;

/** Persist uploaded files and return their on-disk absolute paths. */
async function uploadChatFilesActionImpl(formData: FormData): Promise<UploadResult> {
  await threadPrincipal();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return { ok: false, error: "No files selected." };
  const person=await threadPrincipal();
  await query("SELECT 1"); // startup/journal gate before accepting private bytes
  const personDir=path.join(UPLOAD_DIR,person.id);
  await mkdir(personDir, { recursive: true });
  const out: ChatAttachment[] = [];
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${f.name} is over the 25 MB limit.` };
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
    const dest = path.join(personDir, `${Date.now()}-${randomUUID()}-${safe}`);
    await writeFile(dest, Buffer.from(await f.arrayBuffer()));
    out.push({ name: f.name, path: dest });
  }
  return { ok: true, files: out };
}

export type SendResult =
  | { ok: true; kind: "answer"; message: ChatMessage }
  | { ok: true; kind: "pending"; runId: string; userMessageId: string }
  | { ok: false; error: string }
  | AskFailure;

/** Send a message in a conversation. `conversationId` may be a fresh one just
 *  created for the selected agent. `allowSends` is the Ask window's per-message
 *  "Express permission" checkbox for a Claude turn: it mints a run-scoped owner
 *  grant (lib/owner-grants.ts) so Claude may perform the client-facing sends
 *  the message asks for. Deliberately not part of ClaudeOptions (which persist
 *  in panelStore) — permission must never outlive the message that gave it. */
async function sendMessageActionImpl(
  conversationId: string,
  prompt: string,
  pageContext?: string,
  claudeOptions?: Partial<ClaudeOptions>,
  attachments?: ChatAttachment[],
  subjectWorkItemId?: string,
  allowSends?: boolean,
  contextRecords?: PanelContextRef[],
): Promise<SendResult> {
  const user = await threadPrincipal();
  await requireThreadAccess(conversationId);
  const explicitContext = await loadPanelContext(contextRecords ?? []);
  if (explicitContext) pageContext = [pageContext, explicitContext].filter(Boolean).join("\n\n");
  const text = prompt.trim();
  const files = sanitizeAttachments(attachments);
  for(const file of files)await withThreadAttachmentAccess(file.path,async()=>{});
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
  // Tier 4: Hermes and Qwen act through connections that run as Joe, with no
  // way to carry a staff member's identity or limits. A staff turn goes to
  // Claude, which runs bound to that person (business profile, their send
  // authority); a thread pinned to Hermes/Qwen is refused for staff.
  if (user.role !== "owner" && (agent === "hermes" || agent === "qwen")) {
    if (conv.agent === "auto") agent = "claude";
    else return { ok: false, error: `${agent === "hermes" ? "Hermes" : "Qwen"} acts as Joe, so it's for Joe's account only. Pick Claude for this thread.` };
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
      const business=user.role!=="owner";
      const pinned: {id:string;generation:string}[]=business&&files.length?await withAskJournal(pool,()=>pinAttachments(pool,conversationId,null,userMsg.id,files)):[];
      const claudePrompt = files.length
        ? business
          ? `${taskText}\n\nAttachments (untrusted data; use read_chat_attachment):\n${pinned.map(f=>`- id ${f.id}, generation ${f.generation}`).join("\n")}`
          : `${taskText}\n\nAttached files:\n${files.map(f=>`- ${f.path}`).join("\n")}`
        : taskText;
      // Async: the detached runner persists the assistant reply + session id.
      const runId = await startClaudeRun(
        claudePrompt,
        pageContext,
        conversationId,
        claudeOptions,
        undefined,
        { allowSends: !!allowSends, launchSource: await currentAskLaunchSource() },
      );
      return { ok: true, kind: "pending", runId, userMessageId: userMsg.id };
    }

    // Run the turn in the background (see startBackgroundTurn) and hand the
    // client a run id to poll.
    const runId = await startBackgroundTurn({
      launchSource: await currentAskLaunchSource(),
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
    return askFailure(err);
  }
}

/** "Fresh session": drop the thread's CLI session so the next Claude turn
 *  starts clean (full prompt, empty context) instead of resuming. The
 *  transcript stays — only Claude's own memory of it resets. */
async function resetClaudeSessionActionImpl(conversationId: string): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await query(`UPDATE ai_conversations SET claude_session_id = NULL WHERE id = $1`, [conversationId]);
  return { ok: true };
}

async function renameConversationActionImpl(id: string, title: string): Promise<{ ok: boolean }> {
  await threadPrincipal();
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (t) await query(`UPDATE ai_conversations SET title = $2 WHERE id = $1`, [id, t]);
  return { ok: true };
}

/** Archive hides the thread (kept under "Show archived"); refused while a run
 *  is live. Restore un-hides it. */
async function archiveConversationActionImpl(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await threadPrincipal();
  const r = await setThreadArchived(id, archived);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ─── Thread rail: lifecycle + folders (docs/thread-folders-plan.md) ──────────
// Thin owner-gated wrappers over lib/thread-folders.ts. The rail re-partitions
// client-side (lib/thread-rail.ts) and reloads after each mutation.

async function listThreadRailActionImpl(): Promise<ThreadRail> {
  await threadPrincipal();
  return listThreadRail();
}

async function listArchivedThreadsActionImpl(): Promise<RailThread[]> {
  await threadPrincipal();
  return listArchivedThreads();
}

/** ✓ "I'm done with this" → Settled shelf. Refused while working/blocked. */
async function settleConversationActionImpl(id: string): Promise<{ ok: boolean; error?: string }> {
  await threadPrincipal();
  const r = await settleThread(id);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** ↶ back to the active list, and auto-settle leaves it alone from now on. */
async function unsettleConversationActionImpl(id: string): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await unsettleThread(id);
  return { ok: true };
}

async function pinConversationActionImpl(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await setThreadPinned(id, pinned);
  return { ok: true };
}

/** Move a thread into a folder (null = Unfiled). */
async function moveConversationActionImpl(id: string, folderId: string | null): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await moveThread(id, folderId);
  return { ok: true };
}

/** The "File under Larson kitchen?" chip: into that job's folder (created on
 *  first use). */
async function fileConversationUnderActionImpl(
  id: string,
  entity: FolderEntityRef,
): Promise<{ ok: boolean; folderId: string | null }> {
  await threadPrincipal();
  const folderId = await fileThreadUnderEntity(id, entity);
  return { ok: folderId != null, folderId };
}

async function createFolderActionImpl(name: string): Promise<{ ok: boolean; id: string }> {
  await threadPrincipal();
  return { ok: true, id: await createFolder(name) };
}

/** A folder for a job (project/lead page), created on first use. */
async function ensureEntityFolderActionImpl(entity: FolderEntityRef): Promise<{ ok: boolean; id: string | null }> {
  await threadPrincipal();
  const id = await ensureFolderForEntity(entity);
  return { ok: id != null, id };
}

async function renameFolderActionImpl(id: string, name: string): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await renameFolder(id, name);
  return { ok: true };
}

/** Jobs for the rail's picker (link a folder / new folder for a job). */
async function searchJobsActionImpl(q: string): Promise<JobPick[]> {
  if((await threadPrincipal()).role!=="owner")throw Error("ASK_ACCESS_DENIED");
  return searchFolderEntities(q);
}

/** Link a folder to a job (null unlinks). A slug or uuid of a project / lead /
 *  vendor / sub. */
async function bindFolderActionImpl(
  id: string,
  entity: FolderEntityRef | null,
): Promise<{ ok: boolean; error?: string; existingFolderId?: string }> {
  await threadPrincipal();
  const r = await bindFolder(id, entity);
  return r.ok ? { ok: true } : { ok: false, error: r.error, existingFolderId: r.existingFolderId };
}

/** Manual folder order from a drag reorder in the rail. */
async function reorderFoldersActionImpl(ids: string[]): Promise<{ ok: boolean }> {
  if((await threadPrincipal()).role!=="owner")throw Error("ASK_ACCESS_DENIED");
  await reorderFolders(ids.filter((id) => typeof id === "string").slice(0, 500));
  return { ok: true };
}

async function setFolderCollapsedActionImpl(id: string, collapsed: boolean): Promise<{ ok: boolean }> {
  await threadPrincipal();
  await setFolderCollapsed(id, collapsed);
  return { ok: true };
}

async function archiveFolderActionImpl(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  await threadPrincipal();
  const r = await setFolderArchived(id, archived);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Delete the folder; its threads become Unfiled. */
async function deleteFolderActionImpl(id: string): Promise<{ ok: boolean; error?: string }> {
  await threadPrincipal();
  const r = await deleteFolder(id);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function deleteConversationAction(id: string, operationId: string): Promise<AskDeleteResult> {
  // Retry/status deliberately bypasses the ordinary read gate, using only the
  // authenticated actor + opaque operation UUID; never load a title here.
  try { return await deleteOwnedThread(id, operationId) as AskDeleteResult; }
  catch(error) { return askFailure(error); }
}

// ─── Background turns ────────────────────────────────────────────────────────

interface BackgroundTurn {
  launchSource?: AskLaunchSource;
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
  /** Page grounding for a steer follow-up when `pageContext` carries a
   *  one-off instruction (the voice concierge's delegated task) that must
   *  not be redone. Defaults to `pageContext`. */
  followUpContext?: string;
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
  const run = t.launchSource ? await admitAskRun({conversationId, prompt:text, pageContext, agent, requestedProfile:"business", withMcp:true, subjectWorkItemId, activity:t.activity}, t.launchSource) : await queryOne<{ id: string }>(
    `INSERT INTO dev_agent_runs (agent, prompt, page_context, status, conversation_id, activity, subject_work_item_id, launch_source)
     VALUES ($1, $2, $3, 'running', $4, $5, $6, 'background')
     RETURNING id`,
    [agent, text, pageContext ?? null, conversationId, t.activity ?? `${label} is thinking…`, subjectWorkItemId ?? null],
  );
  const runId = run!.id;

  // Steers that arrive after the answer is done get their own turn in this
  // thread (lib/run-steers.ts settleSteeredRun) — same agent, same pipeline.
  const followUp = (steerText: string) =>
    startBackgroundTurn({
      ...t,
      launchSource: undefined, // Autonomous follow-up must not inherit attendance.
      text: steerText,
      attachments: [],
      pageContext: t.followUpContext ?? pageContext,
      activity: `${label} is picking up your steer…`,
    });

  void (async () => {
    // Live "what it's doing" log — every stage appends; the panel shows it all.
    const log = runLog(runId, [t.activity ?? `${label} is thinking…`]);
    const onDelivered = (bodies: string[]) => bodies.forEach((b) => log.push(`↪ Steer delivered: ${b}`));
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
      // Steering: Hermes takes steers mid-turn through its gateway; Qwen has
      // no tool loop to inject into, so a steer restarts its stream with the
      // steer in the thread.
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
          { runId, onDelivered },
        );
        answer = await finalizeHermesAnswer(runId, raw);
      } else {
        const raw = await qwenSteerable(runId, conversationId, pageContext, log);
        log.push("Checking for proposed changes…");
        answer = await processQwenProposals(runId, conversationId, text, raw, pageContext);
      }
      log.push("Done.");
      await log.flush();
      // Guarded on status inside: if Joe hit ⏹ Stop, the row is already
      // 'error' and this late result must not overwrite it (or double-post).
      await settleSteeredRun({ runId, conversationId, agent, status: "done", answer, followUp });
    } catch (err) {
      const msg = `⚠️ ${(err as Error).message}`;
      log.push(msg);
      await log.flush();
      await settleSteeredRun({ runId, conversationId, agent, status: "error", answer: msg, followUp }).catch(() => {});
    }
  })();

  return runId;
}

// ─── Voice concierge ─────────────────────────────────────────────────────────

export type VoiceTurnResult =
  | { ok: true; speak: string; ackMessageId: string; runId?: string; delegatedTo?: "hermes" | "qwen" }
  | { ok: false; error: string }
  | AskFailure;

/**
 * A voice-mode turn: Claude answers out loud right away and, when the ask
 * needs OS work, delegates it as a normal background run in this thread
 * (polled by the client like any other; its result is spoken via
 * POST /api/tts {runId}). Claude is the only voice Joe hears — Hermes/Qwen do
 * work, Claude reports. Works in any thread regardless of the rail pin: a
 * pinned Hermes/Qwen thread just fixes who the delegate is.
 */
async function voiceTurnActionImpl(
  conversationId: string,
  transcript: string,
  pageContext?: string,
): Promise<VoiceTurnResult> {
  const user = await threadPrincipal();
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
  // Hermes/Qwen act as Joe (see sendMessageAction): no delegation for staff.
  if (user.role !== "owner") {
    const note = await insertMessage(conversationId, "assistant", "That needs Hermes or Qwen, which act as Joe, so they're for Joe's account only. Ask Claude in a typed message instead.", { agent: "concierge" });
    return { ok: true, speak: reply.speak, ackMessageId: note.id };
  }
  const runId = await startBackgroundTurn({
    launchSource: "panel_voice",
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
    followUpContext: pageContext,
    activity: `${agent === "hermes" ? "Hermes" : "Qwen"} is on it (delegated by Claude)…`,
  });
  return { ok: true, speak: reply.speak, ackMessageId: ack.id, runId, delegatedTo: agent };
}

export async function listConversationsAction(...args: Parameters<typeof listConversationsActionImpl>): Promise<AskResult<{conversations: Awaited<ReturnType<typeof listConversationsActionImpl>>; capabilities: import("@/lib/ask-result-codes").AskThreadCapabilities}>> {
 return askBoundary(async()=>{const value=await listConversationsActionImpl(...args);return {ok:true,conversations:value,capabilities:await askThreadCapabilities()};});
}
export async function listAllConversationsAction(...args: Parameters<typeof listAllConversationsActionImpl>): Promise<AskResult<{threads: Awaited<ReturnType<typeof listAllConversationsActionImpl>>; capabilities: import("@/lib/ask-result-codes").AskThreadCapabilities}>> {
 return askBoundary(async()=>{const value=await listAllConversationsActionImpl(...args);return {ok:true,threads:value,capabilities:await askThreadCapabilities()};});
}
export async function loadConversationAction(...args: Parameters<typeof loadConversationActionImpl>): Promise<AskResult<{conversation: NonNullable<Awaited<ReturnType<typeof loadConversationActionImpl>>>; capabilities: import("@/lib/ask-result-codes").AskThreadCapabilities}>> {
 return askBoundary(async()=>{const value=await loadConversationActionImpl(...args);if(!value)return {ok:false,code:"THREAD_UNAVAILABLE"} as AskFailure;return {ok:true,conversation:value,capabilities:await askThreadCapabilities()};});
}
export async function newConversationAction(...args: Parameters<typeof newConversationActionImpl>): Promise<AskResult<{id: Awaited<ReturnType<typeof newConversationActionImpl>>}>> {
 return askBoundary(async()=>{const value=await newConversationActionImpl(...args);return {ok:true,id:value};});
}
export async function uploadChatFilesAction(...args: Parameters<typeof uploadChatFilesActionImpl>): Promise<Awaited<ReturnType<typeof uploadChatFilesActionImpl>> | AskFailure> { return askBoundary(()=>uploadChatFilesActionImpl(...args)); }
export async function sendMessageAction(...args: Parameters<typeof sendMessageActionImpl>): Promise<Awaited<ReturnType<typeof sendMessageActionImpl>> | AskFailure> { return askBoundary(()=>sendMessageActionImpl(...args)); }
export async function resetClaudeSessionAction(...args: Parameters<typeof resetClaudeSessionActionImpl>): Promise<Awaited<ReturnType<typeof resetClaudeSessionActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return resetClaudeSessionActionImpl(...args);}); }
export async function renameConversationAction(...args: Parameters<typeof renameConversationActionImpl>): Promise<Awaited<ReturnType<typeof renameConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return renameConversationActionImpl(...args);}); }
export async function archiveConversationAction(...args: Parameters<typeof archiveConversationActionImpl>): Promise<Awaited<ReturnType<typeof archiveConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return archiveConversationActionImpl(...args);}); }
export async function listThreadRailAction(...args: Parameters<typeof listThreadRailActionImpl>): Promise<AskResult<{rail: Awaited<ReturnType<typeof listThreadRailActionImpl>>; capabilities: import("@/lib/ask-result-codes").AskThreadCapabilities}>> {
 return askBoundary(async()=>{const value=await listThreadRailActionImpl(...args);return {ok:true,rail:value,capabilities:await askThreadCapabilities()};});
}
export async function listArchivedThreadsAction(...args: Parameters<typeof listArchivedThreadsActionImpl>): Promise<AskResult<{threads: Awaited<ReturnType<typeof listArchivedThreadsActionImpl>>; capabilities: import("@/lib/ask-result-codes").AskThreadCapabilities}>> {
 return askBoundary(async()=>{const value=await listArchivedThreadsActionImpl(...args);return {ok:true,threads:value,capabilities:await askThreadCapabilities()};});
}
export async function settleConversationAction(...args: Parameters<typeof settleConversationActionImpl>): Promise<Awaited<ReturnType<typeof settleConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return settleConversationActionImpl(...args);}); }
export async function unsettleConversationAction(...args: Parameters<typeof unsettleConversationActionImpl>): Promise<Awaited<ReturnType<typeof unsettleConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return unsettleConversationActionImpl(...args);}); }
export async function pinConversationAction(...args: Parameters<typeof pinConversationActionImpl>): Promise<Awaited<ReturnType<typeof pinConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return pinConversationActionImpl(...args);}); }
export async function moveConversationAction(...args: Parameters<typeof moveConversationActionImpl>): Promise<Awaited<ReturnType<typeof moveConversationActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return moveConversationActionImpl(...args);}); }
export async function fileConversationUnderAction(...args: Parameters<typeof fileConversationUnderActionImpl>): Promise<Awaited<ReturnType<typeof fileConversationUnderActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return fileConversationUnderActionImpl(...args);}); }
export async function createFolderAction(...args: Parameters<typeof createFolderActionImpl>): Promise<Awaited<ReturnType<typeof createFolderActionImpl>> | AskFailure> { return askBoundary(()=>createFolderActionImpl(...args)); }
export async function ensureEntityFolderAction(...args: Parameters<typeof ensureEntityFolderActionImpl>): Promise<Awaited<ReturnType<typeof ensureEntityFolderActionImpl>> | AskFailure> { return askBoundary(()=>ensureEntityFolderActionImpl(...args)); }
export async function renameFolderAction(...args: Parameters<typeof renameFolderActionImpl>): Promise<Awaited<ReturnType<typeof renameFolderActionImpl>> | AskFailure> { return askBoundary(()=>renameFolderActionImpl(...args)); }
export async function searchJobsAction(...args: Parameters<typeof searchJobsActionImpl>): Promise<AskResult<{jobs: Awaited<ReturnType<typeof searchJobsActionImpl>>}>> {
 return askBoundary(async()=>{const value=await searchJobsActionImpl(...args);return {ok:true,jobs:value};});
}
export async function bindFolderAction(...args: Parameters<typeof bindFolderActionImpl>): Promise<Awaited<ReturnType<typeof bindFolderActionImpl>> | AskFailure> { return askBoundary(()=>bindFolderActionImpl(...args)); }
export async function reorderFoldersAction(...args: Parameters<typeof reorderFoldersActionImpl>): Promise<Awaited<ReturnType<typeof reorderFoldersActionImpl>> | AskFailure> { return askBoundary(()=>reorderFoldersActionImpl(...args)); }
export async function setFolderCollapsedAction(...args: Parameters<typeof setFolderCollapsedActionImpl>): Promise<Awaited<ReturnType<typeof setFolderCollapsedActionImpl>> | AskFailure> { return askBoundary(()=>setFolderCollapsedActionImpl(...args)); }
export async function archiveFolderAction(...args: Parameters<typeof archiveFolderActionImpl>): Promise<Awaited<ReturnType<typeof archiveFolderActionImpl>> | AskFailure> { return askBoundary(()=>archiveFolderActionImpl(...args)); }
export async function deleteFolderAction(...args: Parameters<typeof deleteFolderActionImpl>): Promise<Awaited<ReturnType<typeof deleteFolderActionImpl>> | AskFailure> { return askBoundary(()=>deleteFolderActionImpl(...args)); }
export async function voiceTurnAction(...args: Parameters<typeof voiceTurnActionImpl>): Promise<Awaited<ReturnType<typeof voiceTurnActionImpl>> | AskFailure> { return askBoundary(async()=>{await requireThreadAccess(args[0]);return voiceTurnActionImpl(...args);}); }
