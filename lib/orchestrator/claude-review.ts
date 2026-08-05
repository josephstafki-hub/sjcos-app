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

export interface HermesVerdict {
  verdict: "approve" | "retry" | "takeover";
  feedback: string;
  userNote: string;
}

/** Review one Hermes round of an orchestration task. Effort rises on later
 *  rounds. Unparseable/failed review is NEVER a silent approve: the caller
 *  treats null as retry-once-then-takeover. */
export async function reviewHermesRound(
  taskPrompt: string,
  hermesReply: string,
  effectsDigest: string,
  round: number,
): Promise<HermesVerdict | null> {
  const prompt =
    `You review work the Hermes agent just did for SJ Carpentry's business OS. Hermes executed ` +
    `real MCP tools; the changes listed below already happened — your job is corrective: approve ` +
    `if the task is genuinely complete and correct, or send it back with concrete, actionable ` +
    `feedback (Hermes learns from it), or take over yourself only when Hermes clearly cannot ` +
    `finish. Client-facing sends / money documents must never have been sent — drafts for ` +
    `approval are correct behavior.\n\n` +
    `The task:\n${taskPrompt.slice(0, 1500)}\n\n` +
    `Hermes' reply (round ${round}):\n${hermesReply.slice(0, 2000)}\n\n` +
    `Recorded changes this run:\n${effectsDigest || "(none recorded)"}\n\n` +
    `Reply with ONE JSON object and nothing else:\n` +
    `{"verdict":"approve"|"retry"|"takeover","feedback":"concrete points for Hermes","user_note":"one sentence for the owner"}`;
  try {
    const reply = await chatReplyClaude(prompt, {
      model: REVIEW_MODEL,
      effort: round >= 2 ? "medium" : "low",
      timeoutMs: 120_000,
    });
    const parsed = extractJson<{ verdict?: string; feedback?: string; user_note?: string }>(reply);
    if (!parsed || !["approve", "retry", "takeover"].includes(parsed.verdict ?? "")) return null;
    return {
      verdict: parsed.verdict as HermesVerdict["verdict"],
      feedback: (parsed.feedback ?? "").slice(0, 1500),
      userNote: (parsed.user_note ?? "").slice(0, 300),
    };
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
