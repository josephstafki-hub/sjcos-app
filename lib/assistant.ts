// Ask-Claude (AI screen) data builder. The assistant analysis routes through
// lib/ai.ts so it swaps to a real, streaming model with no screen change. The
// rest (context picker, skills, recent threads) is mock today.

import { ai } from "./ai";

export interface ContextItem {
  label: string;
  icon: string;
  loaded: boolean;
  /** Sage emphasis — the primary in-scope record. */
  primary?: boolean;
}

export interface AssistantData {
  context: ContextItem[];
  skills: string[];
  recent: string[];
  thread: {
    startedLabel: string;
    title: string;
    userMessage: string;
    assistant: {
      intro: string;
      /** Analysis points (may contain **bold** markdown). */
      points: string[];
      actions: string[];
      sources: string;
    };
  };
  tryPrompts: string[];
}

export async function getAssistantData(): Promise<AssistantData> {
  const question = "What does Henderson tile install need from me today?";

  const { suggestions: points } = await ai.suggest({
    kind: "ai-thread",
    context: question,
  });

  return {
    context: [
      { label: "Henderson kitchen (active)", icon: "project", loaded: true, primary: true },
      { label: "Olson porch (closing)", icon: "project", loaded: true },
      { label: "Maria Chen — Phase 1", icon: "leads", loaded: true },
      { label: "A/R: Reyes day 15", icon: "money", loaded: true },
      { label: "SJC SOPs · v3.0", icon: "files", loaded: true },
      { label: "Last 90d P&L", icon: "book", loaded: true },
    ],
    skills: [
      "sow",
      "lead-triage",
      "co-draft",
      "weekly-status",
      "demand-letter",
      "estimate-research",
      "social-post",
    ],
    recent: ["Henderson tile prep", "Q1 cash forecast", "Pham bath rough est.", "Olson final invoice"],
    thread: {
      startedLabel: "Thread · started 9:42 am",
      title: question,
      userMessage: "Walk me through Henderson tile install today. Anything I'd miss?",
      assistant: {
        intro: "Here's the picture for Henderson tile install (Mon May 25, 1–6pm, Marco):",
        points,
        actions: ["Generate QC checklist", "Draft Henderson EOD update", "Show flatness photo"],
        sources: "Sources: Henderson project · selections · sub records · last 7 daily logs",
      },
    },
    tryPrompts: [
      "Draft CO for stove relocation",
      "Forecast cash next 30 days",
      "Summarize Friday daily log",
    ],
  };
}
