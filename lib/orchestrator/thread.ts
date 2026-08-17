import "server-only";

import { queryOne } from "@/lib/db";
import { getThreadMessages, type ThreadMessage } from "@/lib/ai-chat";
import {
  renderAttachmentsForPrompt,
  type AttachmentImage,
  type ChatAttachment,
} from "@/lib/attachments";
import type { DevAgent } from "@/lib/dev-agents-meta";

// Thread continuity across agents. An 'auto' conversation is ONE thread that
// three different agents may answer in turn, but each agent's own memory of
// it is partial:
//
//   hermes → its gateway session (X-Hermes-Session-Id) holds only the turns
//            Hermes itself processed — the request body's history is ignored
//            once a session id is pinned.
//   claude → its CLI session (--resume) holds only Claude's own turns.
//   qwen   → stateless; gets the whole thread from the DB every time.
//
// So before an agent answers, work out which turns it hasn't seen (everything
// after the last assistant message it authored) and hand them over as a
// bracketed transcript — including any files uploaded on those turns — so
// "yes, do that" after Qwen's answer means something to Hermes, and Hermes'
// own last answer is what it recognises when Joe replies to it.

const AGENTS: DevAgent[] = ["claude", "qwen", "hermes"];
const isDevAgent = (a: string | null | undefined): a is DevAgent => !!a && (AGENTS as string[]).includes(a);

export const AGENT_LABEL: Record<string, string> = {
  claude: "Claude",
  qwen: "Qwen",
  hermes: "Hermes",
  concierge: "Claude (voice)",
};

/** Speaker label for a transcript line. */
export function speakerOf(m: Pick<ThreadMessage, "role" | "agent">): string {
  if (m.role === "user") return "Joe";
  return AGENT_LABEL[m.agent ?? ""] ?? "Assistant";
}

/** Who answered last in the thread — the agent a follow-up should stick to.
 *  Falls back to the run log for rows persisted before agent tagging. */
export async function lastAnsweringAgent(conversationId: string): Promise<DevAgent | null> {
  const msgs = await getThreadMessages(conversationId);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && isDevAgent(m.agent)) return m.agent;
  }
  const run = await queryOne<{ agent: string }>(
    `SELECT agent FROM dev_agent_runs
      WHERE conversation_id = $1 AND status = 'done'
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  ).catch(() => null);
  return isDevAgent(run?.agent) ? run!.agent : null;
}

export interface ThreadContext {
  messages: ThreadMessage[];
  /** The user message being answered now (the last user turn). */
  current: ThreadMessage | null;
  /** Turns before `current` that `agent` has not seen. */
  unseen: ThreadMessage[];
}

/** Split the thread into what `agent` already holds in its own session and
 *  what it still needs to be told. Everything after the last assistant message
 *  `agent` authored (up to, not including, the current user turn) is unseen. */
export async function threadContextFor(conversationId: string, agent: DevAgent): Promise<ThreadContext> {
  const messages = await getThreadMessages(conversationId);
  let cur = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      cur = i;
      break;
    }
  }
  if (cur < 0) return { messages, current: null, unseen: [] };
  let seenUpTo = -1;
  for (let i = cur - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].agent === agent) {
      seenUpTo = i;
      break;
    }
  }
  return { messages, current: messages[cur], unseen: messages.slice(seenUpTo + 1, cur) };
}

export interface TranscriptOptions {
  /** Total budget; oldest turns are dropped first. */
  maxChars?: number;
  /** Per-turn body cap. */
  perTurn?: number;
  /** Inline extracted text of files uploaded on those turns (per-file cap). */
  attachmentChars?: number;
  /** Also collect the images from those turns (for a vision-capable reader). */
  withImages?: boolean;
  /** Mention the on-disk path (for readers with a file/shell tool). */
  withPaths?: boolean;
  /** Bracket label for the block. */
  heading?: string;
}

/** Render turns as a labelled transcript block for a prompt. */
export async function renderTranscript(
  turns: ThreadMessage[],
  opts: TranscriptOptions = {},
): Promise<{ text: string; images: AttachmentImage[] }> {
  if (!turns.length) return { text: "", images: [] };
  const maxChars = opts.maxChars ?? 12_000;
  const perTurn = opts.perTurn ?? 2_000;
  const lines: string[] = [];
  const images: AttachmentImage[] = [];
  for (const m of turns) {
    let body = m.body.length > perTurn ? `${m.body.slice(0, perTurn)}…` : m.body;
    if (m.role === "user" && m.attachments.length && (opts.attachmentChars || opts.withPaths || opts.withImages)) {
      const r = await renderAttachmentsForPrompt(m.attachments, {
        maxChars: opts.attachmentChars ?? 0,
        withImages: !!opts.withImages,
        withPaths: !!opts.withPaths,
        heading: "Files attached to this message",
      });
      if (opts.attachmentChars || opts.withPaths) body += r.text;
      images.push(...r.images);
    }
    lines.push(`${speakerOf(m)}: ${body}`);
  }
  // Keep the most recent turns inside the budget.
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (total + lines[i].length > maxChars && kept.length) break;
    kept.unshift(lines[i]);
    total += lines[i].length;
  }
  const dropped = lines.length - kept.length;
  const heading = opts.heading ?? "Earlier in this thread";
  return {
    text:
      `[${heading}${dropped ? ` — ${dropped} older turn(s) omitted` : ""}]\n` +
      `${kept.join("\n\n")}\n[End of earlier context]`,
    images,
  };
}

/** Full cap for files attached to the turn being answered now. */
export const CURRENT_ATTACHMENT_CHARS = 40_000;
/** Smaller cap for files from earlier turns quoted as context. */
export const EARLIER_ATTACHMENT_CHARS = 8_000;

/**
 * The one user message Hermes' gateway actually reads this turn (its session
 * supplies the rest): the turns it hasn't seen, then Joe's message with its
 * files. `note` is appended for orchestrator asides (a Qwen escalation's
 * critique). Images (from this turn and unseen turns) ride along as
 * multimodal parts.
 */
export async function composeHermesTurn(
  conversationId: string,
  input: {
    text: string;
    /** Defaults to the files persisted on the current user message. */
    attachments?: ChatAttachment[];
    note?: string;
  },
): Promise<{ content: string; images: AttachmentImage[] }> {
  const ctx = await threadContextFor(conversationId, "hermes");
  const attachments = input.attachments ?? ctx.current?.attachments ?? [];
  const parts: string[] = [];
  const images: AttachmentImage[] = [];
  if (ctx.unseen.length) {
    const t = await renderTranscript(ctx.unseen, {
      attachmentChars: EARLIER_ATTACHMENT_CHARS,
      withImages: true,
      withPaths: true,
      heading: "Earlier in this thread — turns you have not seen (other assistants answered some of them)",
    });
    parts.push(t.text);
    images.push(...t.images);
  }
  let body = input.text;
  if (attachments.length) {
    const r = await renderAttachmentsForPrompt(attachments, {
      maxChars: CURRENT_ATTACHMENT_CHARS,
      withImages: true,
      withPaths: true,
    });
    body += r.text;
    images.push(...r.images);
  }
  parts.push(body);
  if (input.note) parts.push(input.note);
  return { content: parts.join("\n\n"), images: images.slice(0, 8) };
}

/**
 * Qwen is stateless, so it gets the whole thread every turn — with each
 * turn's files inlined (full cap on the current turn, smaller on earlier
 * ones) and other agents' answers labelled so Qwen doesn't mistake Hermes'
 * work for its own. `vision` adds image payloads (only for a vision model).
 */
export async function composeQwenTurns(
  conversationId: string,
  opts: { vision: boolean },
): Promise<{ role: "user" | "assistant"; content: string; images?: AttachmentImage[] }[]> {
  const messages = await getThreadMessages(conversationId);
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  const out: { role: "user" | "assistant"; content: string; images?: AttachmentImage[] }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant") {
      const by = m.agent && m.agent !== "qwen" ? `[${AGENT_LABEL[m.agent] ?? m.agent} answered] ` : "";
      out.push({ role: "assistant", content: by + m.body });
      continue;
    }
    let content = m.body;
    let images: AttachmentImage[] | undefined;
    if (m.attachments.length) {
      const r = await renderAttachmentsForPrompt(m.attachments, {
        maxChars: i === lastUser ? CURRENT_ATTACHMENT_CHARS : EARLIER_ATTACHMENT_CHARS,
        withImages: opts.vision,
        withPaths: false,
      });
      content += r.text;
      if (r.images.length) images = r.images;
    }
    out.push(images ? { role: "user", content, images } : { role: "user", content });
  }
  return out;
}
