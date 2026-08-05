import "server-only";

import { chatReplyClaude } from "@/lib/dev-agents";
import type { RoutedAgent, RouteIntent } from "./router";

// Claude's synchronous judgment calls — triage now; proposal review and the
// Hermes-round verdicts build on the same JSON-reply contract. All run the
// no-tools `claude -p` path (chatReplyClaude): a few seconds, real dollars,
// so callers keep these OFF the hot path. Verdict parsing is defensive and
// every failure resolves to the SAFE outcome for that call site (never
// auto-approve, never invent a route).

/** Pull the first JSON object out of a possibly-chatty reply. */
export function extractJson<T>(reply: string): T | null {
  const m = reply.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

const TRIAGE_MODEL = process.env.ORCH_TRIAGE_MODEL ?? "haiku";
const REVIEW_MODEL = process.env.ORCH_REVIEW_MODEL ?? "sonnet";

/** Pull the first JSON array out of a possibly-chatty reply. */
export function extractJsonArray<T>(reply: string): T[] | null {
  const m = reply.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export interface ProposalVerdict {
  index: number;
  approve: boolean;
  note: string;
}

/** Batch-review Qwen's proposed writes — one call for the whole turn (sonnet,
 *  low effort; quality matters, it gates writes). Null = review unavailable —
 *  the caller holds everything. A malformed or missing per-item verdict is a
 *  rejection, never an approval. */
export async function reviewProposals(
  userMessage: string,
  qwenReply: string,
  proposals: { kind: string; payload: Record<string, unknown> }[],
): Promise<ProposalVerdict[] | null> {
  const listing = proposals
    .map((p, i) => `${i}. ${p.kind} ${JSON.stringify(p.payload)}`)
    .join("\n");
  const prompt =
    `You review changes a small local model (Qwen) proposed to SJ Carpentry's business OS ` +
    `before they execute. Approve a change only when it clearly matches what the owner asked ` +
    `for and is safe; when unsure, reject with a short reason. Client-facing sends and money ` +
    `documents are never approvable here.\n\n` +
    `Owner's message:\n${userMessage.slice(0, 1200)}\n\n` +
    `Qwen's reply (proposals removed):\n${qwenReply.slice(0, 1200)}\n\n` +
    `Proposed changes:\n${listing}\n\n` +
    `Reply with ONE JSON array and nothing else: ` +
    `[{"index":0,"approve":true|false,"note":"one short sentence"}] — one entry per proposal.`;
  try {
    const reply = await chatReplyClaude(prompt, {
      model: REVIEW_MODEL,
      effort: "low",
      timeoutMs: 90_000,
    });
    const arr = extractJsonArray<{ index?: number; approve?: boolean; note?: string }>(reply);
    if (!arr) return null;
    return arr
      .filter((v) => typeof v.index === "number")
      .map((v) => ({ index: v.index!, approve: v.approve === true, note: (v.note ?? "").slice(0, 300) }));
  } catch {
    return null;
  }
}

/** Route an ambiguous/risky message. Null = triage unavailable (CLI error,
 *  malformed reply) — the router falls back to the default operator. */
export async function claudeTriage(
  text: string,
  pageContext?: string,
): Promise<{ agent: RoutedAgent; intent: RouteIntent } | null> {
  const prompt =
    `You route messages from the owner of SJ Carpentry to one of three assistants. ` +
    `Reply with ONE JSON object and nothing else: {"agent":"qwen"|"hermes"|"claude","intent":"read"|"write"|"code"}.\n` +
    `- qwen: questions/summaries/drafts, read-only, no tools\n` +
    `- hermes: performs business operations with MCP tools (leads, projects, work items, POs, newsletter). ` +
    `Client-facing sends stay owner-approved — hermes drafts, never sends\n` +
    `- claude: edits the app's source code\n` +
    (pageContext ? `Owner is viewing:\n${pageContext.slice(0, 400)}\n` : "") +
    `Message:\n${text.slice(0, 1200)}`;
  try {
    const reply = await chatReplyClaude(prompt, { model: TRIAGE_MODEL, timeoutMs: 30_000 });
    const parsed = extractJson<{ agent?: string; intent?: string }>(reply);
    if (!parsed) return null;
    const agent = parsed.agent as RoutedAgent;
    const intent = (parsed.intent ?? "write") as RouteIntent;
    if (!["qwen", "hermes", "claude"].includes(agent)) return null;
    if (!["read", "write", "code"].includes(intent)) return null;
    return { agent, intent };
  } catch {
    return null;
  }
}
