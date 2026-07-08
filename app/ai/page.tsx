import { Shell } from "@/components/shell/Shell";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { queryOne } from "@/lib/db";
import type { DevAgent } from "@/lib/dev-agents-meta";

/** Ask — the persisted multi-agent chat surface (Claude / Qwen / Hermes), with
 *  per-model conversation history in the rail. `?c=<id>` deep-links a thread
 *  (used by the ⌘K Claude launch); `?agent=` preselects a model. */
export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const initialConversationId = sp.c;
  const initialAgent = (["claude", "qwen", "hermes"] as const).includes(sp.agent as DevAgent)
    ? (sp.agent as DevAgent)
    : "qwen";
  // Starter chips name real records only — the project chip points at the most
  // active real job, or is dropped when there isn't one.
  const active = await queryOne<{ name: string }>(
    `SELECT name FROM projects
      WHERE status IN ('construction', 'closeout')
      ORDER BY progress DESC, name ASC
      LIMIT 1`,
  );
  const starters = [
    "What should I focus on today?",
    "Draft a follow-up to a stalled lead.",
    ...(active ? [`Summarize where ${active.name} stands.`] : []),
    "What COIs expire in the next 30 days?",
  ];

  return (
    <Shell breadcrumb="ASK" hideCmd>
      <AssistantChat
        starters={starters}
        initialConversationId={initialConversationId}
        initialAgent={initialAgent}
      />
    </Shell>
  );
}
