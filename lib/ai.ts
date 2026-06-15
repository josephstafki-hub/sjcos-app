// SJC OS — provider-agnostic AI service.
//
// This is the ONLY module in the app that an AI provider may be imported into.
// Screens and API routes import `ai` and call typed methods; they never touch
// Ollama / Anthropic / any SDK directly. Swapping the implementation (mock →
// local LLM → Anthropic) is a change confined to this file.
//
// Selected by the AI_PROVIDER env var ("mock" by default). The interface is
// shaped to be streaming-ready: today every method resolves a full result, but
// a real provider can add `*Stream` variants returning an async iterator
// without changing these signatures.

import type { TriageVerdict } from "./types";

// ─── Method I/O types ─────────────────────────────────────────────────────

export interface BriefInput {
  /** ISO date the brief is for. */
  date: string;
  ownerName?: string;
  /** Lightweight context the caller already has in hand. */
  leads?: { name: string; scope: string; stage: string }[];
  projects?: { name: string; status: string; progress: number }[];
  threadsNeedingReply?: number;
}

export interface PriorityItem {
  kind: "lead" | "job" | "money" | "marketing" | "compliance";
  title: string;
  reason: string;
  href?: string;
}

export interface DailyBrief {
  summary: string;
  priorities: PriorityItem[];
}

export interface TriageInput {
  name: string;
  scope: string;
  estimateValue?: number | null;
  source?: string | null;
  notes?: string;
}

export interface TriageResult {
  verdict: TriageVerdict;
  /** 0–1. */
  confidence: number;
  rationale: string;
  /** The 5-question intake Claude wants answered next. */
  questions: string[];
}

export type DraftKind =
  | "email_reply"
  | "weekly_status"
  | "sow"
  | "demand_letter"
  | "social_post";

export interface DraftInput {
  kind: DraftKind;
  /** Free-form context: thread excerpt, project facts, prompt, etc. */
  context: string;
  tone?: "professional" | "warm" | "firm";
}

export interface DraftResult {
  subject?: string;
  body: string;
}

export interface SummarizeInput {
  text: string;
  focus?: string;
}

export interface SummaryResult {
  summary: string;
  bullets: string[];
}

export interface SuggestInput {
  context: string;
  /** What kind of suggestions are wanted, e.g. "next-actions", "selections". */
  kind?: string;
}

export interface SuggestResult {
  suggestions: string[];
}

// ─── Provider contract ────────────────────────────────────────────────────

export interface AiProvider {
  readonly name: string;
  brief(input: BriefInput): Promise<DailyBrief>;
  triage(input: TriageInput): Promise<TriageResult>;
  draft(input: DraftInput): Promise<DraftResult>;
  summarize(input: SummarizeInput): Promise<SummaryResult>;
  suggest(input: SuggestInput): Promise<SuggestResult>;
}

// ─── Mock provider ──────────────────────────────────────────────────────────
// Deterministic, instant, no network. Returns plausibly-shaped content so
// screens can be built and demoed before a real model is wired in.

const mockProvider: AiProvider = {
  name: "mock",

  async brief(input) {
    const replies = input.threadsNeedingReply ?? 0;
    return {
      summary:
        `Here's your day. ${input.projects?.[0]?.name ?? "Your lead job"} needs eyes this morning, ` +
        `${replies} ${replies === 1 ? "thread" : "threads"} are waiting on a reply, and a couple of ` +
        `marketing items are queued for review.`,
      priorities: [
        {
          kind: "lead",
          title: "Reply to the oldest waiting lead",
          reason: "Rough estimate sent — SLA window closing soon.",
          href: "/leads",
        },
        {
          kind: "job",
          title: "Confirm today's material delivery",
          reason: "Crew starts on site; verify materials staged.",
          href: "/schedule",
        },
        {
          kind: "marketing",
          title: "Review queued social posts",
          reason: "AI-drafted posts from a completed job are ready to publish.",
          href: "/site",
        },
      ],
    };
  },

  async triage(input) {
    const big = (input.estimateValue ?? 0) >= 15000;
    return {
      verdict: big ? "go" : "hold",
      confidence: big ? 0.78 : 0.55,
      rationale: big
        ? `${input.name}'s ${input.scope} is in the firm's wheelhouse and above the minimum job size. Worth a Phase 1 estimate.`
        : `${input.name}'s ${input.scope} looks small or underspecified. Hold for two clarifying answers before committing time.`,
      questions: [
        "What's the target start window?",
        "Is there a budget range in mind?",
        "Who are the decision-makers?",
        "Are drawings or measurements available?",
        "How did they hear about SJ Carpentry?",
      ],
    };
  },

  async draft(input) {
    const drafts: Record<DraftKind, DraftResult> = {
      email_reply: {
        subject: "Re: your project",
        body:
          "Hi there,\n\nThanks for the note — happy to help. Based on what you've shared, " +
          "here's where things stand and the next step I'd suggest. Let me know a good time to talk this week.\n\nBest,\nJoe",
      },
      weekly_status: {
        subject: "Weekly status — your project",
        body:
          "Hi,\n\nQuick update on the week: framing and rough-ins progressed on schedule, " +
          "selections are confirmed, and we're tracking to the target date. Photos attached. " +
          "Nothing needed from you right now.\n\nBest,\nJoe",
      },
      sow: {
        body:
          "SCOPE OF WORK\n\n1. Demolition and protection of adjacent areas.\n" +
          "2. Rough framing per approved plan.\n3. Mechanical, electrical, plumbing rough-in.\n" +
          "4. Finishes per selections schedule.\n5. Final punch and closeout walkthrough.",
      },
      demand_letter: {
        subject: "Past-due balance — action required",
        body:
          "Per our signed agreement, the balance below is now past due. Please remit within 10 days " +
          "to avoid further action. We value the relationship and would prefer to resolve this promptly.",
      },
      social_post: {
        body:
          "Another one in the books 🔨 Swipe to see this transformation. Craftsmanship you can stand on — " +
          "DM us to start your project. #carpentry #remodel #craftsmanship",
      },
    };
    return drafts[input.kind];
  },

  async summarize(input) {
    // Passthrough for already-composed reliability blurbs — the real provider
    // will compose this from a sub's job history; the mock just relays it whole
    // rather than truncating.
    if (input.focus === "sub-reliability") {
      return { summary: input.text.trim(), bullets: [] };
    }
    const first = input.text.trim().slice(0, 120).replace(/\s+\S*$/, "");
    return {
      summary: `${first}${first.length < input.text.trim().length ? "…" : ""}`,
      bullets: [
        "Key point one extracted from the content.",
        "Key point two — a decision or deadline to note.",
        "Suggested next action.",
      ],
    };
  },

  async suggest(input) {
    // Kind-aware plausible content so each surface gets usable copy from the
    // mock (mirrors how brief() returns a real-looking summary).
    if (input.kind === "schedule-conflicts") {
      return {
        suggestions: [
          "Reyes paint collides with Henderson punch on May 30 — Brad is " +
            "double-booked. Want me to slide Reyes paint to Jun 2?",
        ],
      };
    }
    return {
      suggestions: [
        `Follow up on: ${input.context.slice(0, 48)}`,
        "Draft a reply",
        "Schedule a site visit",
        "Add to this week's plan",
      ],
    };
  },
};

// ─── Provider selection ─────────────────────────────────────────────────────

function notImplemented(provider: string): AiProvider {
  const fail = () => {
    throw new Error(
      `AI provider "${provider}" is not implemented yet. Implement it in lib/ai.ts ` +
        `or set AI_PROVIDER=mock.`,
    );
  };
  return {
    name: provider,
    brief: fail,
    triage: fail,
    draft: fail,
    summarize: fail,
    suggest: fail,
  };
}

function selectProvider(): AiProvider {
  switch (process.env.AI_PROVIDER ?? "mock") {
    case "mock":
      return mockProvider;
    // Wire these up in Phase 7.3 — zero screen-code changes required.
    case "ollama":
      return notImplemented("ollama");
    case "anthropic":
      return notImplemented("anthropic");
    default:
      return mockProvider;
  }
}

/** The app-wide AI service. Import this — never a provider SDK directly. */
export const ai: AiProvider = selectProvider();
