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
