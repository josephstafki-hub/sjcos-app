import { Shell } from "@/components/shell/Shell";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { AI_NAME } from "@/lib/ai-name";
import { queryOne } from "@/lib/db";

/** Ask-{AI_NAME} — a real free-form chat surface. Each turn calls the askQwen
 *  server action (Qwen via Ollama, mock fallback). General assistant; the
 *  in-page command bar (⌘K) carries page context, this stays general. */
export default async function AiPage() {
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
    <Shell breadcrumb={`ASK ${AI_NAME.toUpperCase()}`} hideCmd>
      <AssistantChat starters={starters} />
    </Shell>
  );
}
