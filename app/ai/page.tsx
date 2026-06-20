import { Shell } from "@/components/shell/Shell";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { AI_NAME } from "@/lib/ai-name";

/** Ask-{AI_NAME} — a real free-form chat surface. Each turn calls the askQwen
 *  server action (Qwen via Ollama, mock fallback). General assistant; the
 *  in-page command bar (⌘K) carries page context, this stays general. */
export default function AiPage() {
  return (
    <Shell breadcrumb={`ASK ${AI_NAME.toUpperCase()}`} hideCmd>
      <AssistantChat />
    </Shell>
  );
}
