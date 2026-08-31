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
import { ACTIONS_HINT, PROPOSAL_HINT } from "./today-directives";
import { standingInstructionsBlock } from "./agent-memory";

// ─── Method I/O types ─────────────────────────────────────────────────────

export interface BriefInput {
  /** ISO date the brief is for. */
  date: string;
  ownerName?: string;
  /** Lightweight context the caller already has in hand. */
  leads?: { name: string; scope: string; stage: string }[];
  projects?: { name: string; status: string; progress: number }[];
  threadsNeedingReply?: number;
  /** Today v2: the displayed Priorities rail, so the brief can narrate lanes —
   *  which items an agent can handle in chat, which are one-click, which need
   *  Joe on their page. See lib/today-triage.ts for the lanes. */
  queue?: { rank: string; title: string; lane: string; tag: string }[];
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
  /** The full inbound detail the lead provided (project, budget, timeline,
   *  message, and any extra form fields). The scorer weighs ALL of these — it
   *  is not tied to a fixed question set, which is expected to change. */
  details?: { label: string; value: string }[];
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
  /** Open Brain / Open Engine facts pulled for this draft (knowledge items,
   *  open work items), so an email reply can be grounded in the linked project
   *  or lead. Mirrors EstimateInput.knowledge. Omit when nothing was found. */
  knowledge?: { kind: string; content: string }[];
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

export interface EstimateLine {
  label: string;
  /** A display range or amount, e.g. "$3,200" or "$8,200 – $11,000". */
  value: string;
}

export interface EstimateInput {
  name: string;
  scope: string;
  /** The lead's answered intake questions, used to ground the line items. */
  intake: { question: string; answer: string }[];
  /** Optional owner notes steering the estimate. */
  notes?: string;
  /** Open Brain knowledge_items captured on this lead (site-visit notes,
   *  measurements, material picks, prior estimate assumptions, etc.), newest
   *  first — grounds the line items in facts beyond the intake form. */
  knowledge?: { kind: string; content: string }[];
}

export interface EstimateResult {
  lines: EstimateLine[];
  /** A rounded display range for the whole job, e.g. "$49,300 – $60,700". */
  total: string;
}

export interface AskInput {
  /** The user's free-form question. */
  prompt: string;
  /** Optional structured text brief of the page the user asked from. */
  context?: string;
}

export interface AskResult {
  answer: string;
}

// ─── Provider contract ────────────────────────────────────────────────────

export interface AiProvider {
  readonly name: string;
  brief(input: BriefInput): Promise<DailyBrief>;
  triage(input: TriageInput): Promise<TriageResult>;
  draft(input: DraftInput): Promise<DraftResult>;
  summarize(input: SummarizeInput): Promise<SummaryResult>;
  suggest(input: SuggestInput): Promise<SuggestResult>;
  estimate(input: EstimateInput): Promise<EstimateResult>;
  /** Free-form Q&A — the Ask-Qwen command bar + /ai chat. */
  ask(input: AskInput): Promise<AskResult>;
}

// ─── Mock provider ──────────────────────────────────────────────────────────
// Deterministic, instant, no network. Returns plausibly-shaped content so
// screens can be built and demoed before a real model is wired in.

// summarize() focuses whose text is already a finished blurb — the mock relays
// it whole instead of truncating. The real provider composes these for real.
const PASSTHROUGH_FOCUS = new Set([
  "sub-reliability",
  "compliance",
  "warranty",
  "search-answer",
]);

const mockProvider: AiProvider = {
  name: "mock",

  async brief(input) {
    const replies = input.threadsNeedingReply ?? 0;
    const q = input.queue ?? [];
    const chat = q.find((i) => i.lane === "chat");
    const deep = q.find((i) => i.lane === "deep");
    // Narrate lanes so dev-without-Ollama still demos the Today v2 UX.
    const laneLine = q.length
      ? `${chat ? `Say go on ${chat.rank} and I'll handle it in chat. ` : ""}` +
        `${deep ? `${deep.rank} needs you on its page. ` : ""}` +
        `The rest are quick check-offs.`
      : `${replies} ${replies === 1 ? "thread" : "threads"} waiting on a reply.`;
    return {
      summary:
        `Here's your day. ${input.projects?.[0]?.name ?? "Your lead job"} needs eyes this morning. ` +
        laneLine,
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
    // Weigh the value plus how much detail the inbound actually provided — a
    // richer submission is a stronger signal than a bare one.
    const detailCount = (input.details ?? []).filter((d) => d.value.trim()).length;
    const big = (input.estimateValue ?? 0) >= 15000;
    const detailed = detailCount >= 3;
    const go = big && detailed;
    return {
      verdict: go ? "go" : big || detailed ? "hold" : "pass",
      confidence: go ? 0.8 : big || detailed ? 0.55 : 0.4,
      rationale: go
        ? `${input.name}'s ${input.scope} is in the firm's wheelhouse, above the minimum job size, and the inbound is well-specified. Worth a Phase 1 estimate.`
        : big || detailed
          ? `${input.name}'s ${input.scope} shows promise but is thin on ${big ? "detail" : "budget"}. Hold for a clarifying reply before committing time.`
          : `${input.name}'s ${input.scope} looks small or underspecified. Likely a pass unless more comes in.`,
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
    // Passthrough for already-composed blurbs (sub reliability, compliance &
    // warranty outlooks) — the real provider will compose these from source
    // records; the mock just relays the text whole rather than truncating.
    if (input.focus && PASSTHROUGH_FOCUS.has(input.focus)) {
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
    if (input.kind === "project-stage") {
      return {
        suggestions: [
          "Deliverables for the current stage look complete — confirm the " +
            "client sign-off is on file, then advance to the next stage.",
        ],
      };
    }
    if (input.kind === "ai-thread") {
      // Analysis points for the Ask-Claude thread. Markdown bold is rendered
      // by the screen. The real provider streams these from loaded context.
      return {
        suggestions: [
          "**Sub-floor flatness** — last QC photo from Friday flagged a soft spot near the pantry threshold. Worth a level check before Marco lays cement board.",
          "**Marble selection** confirmed Apr 21. Delivery receipt signed Fri — 4 boxes Calacatta on site, +1 extra was approved.",
          "**No CO outstanding**. Scope sealed Apr 30.",
          "**Marco is COI-current** through Aug 14. W-9 + agreement signed.",
          "**Client expectation**: Henderson is at the lake until Wed. Photos at end-of-day are enough.",
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

  async estimate(input) {
    // Deterministic, plausibly-shaped phased estimate. The real provider grounds
    // the line items in the lead's scope + intake answers.
    return {
      lines: [
        { label: "Demo + prep", value: "$3,000 – $4,000" },
        { label: "Materials", value: "$14,000 – $18,000" },
        { label: "Labor + subs", value: "$12,000 – $15,000" },
        { label: "Finishes", value: "$6,000 – $8,000" },
        { label: "GC + contingency", value: "$5,000 – $7,000" },
      ],
      total: "$40,000 – $52,000",
    };
  },

  async ask(input) {
    // Deterministic stand-in so the assistant is usable without a model. Echoes
    // the question and notes whether page context was supplied.
    const q = input.prompt.trim();
    const grounded = input.context
      ? " Based on what's on this page, here's the gist — open the related " +
        "record for the full detail."
      : " Connect a local model (Ollama) for a grounded answer.";
    return {
      answer:
        `You asked: "${q}".` +
        grounded +
        " (Assistant is running in mock mode right now.)",
    };
  },
};

// ─── Ollama provider (local LLM) ─────────────────────────────────────────────
// Talks to a local Ollama daemon over its HTTP API — no SDK, no network egress,
// no per-call cost. Structured methods request JSON via Ollama's `format` (a
// JSON schema) so the model returns parseable output. Every call is bounded by
// a timeout and falls back to the deterministic mock on any failure, so a slow
// or down daemon degrades gracefully instead of 500-ing a page.
//
// Env: OLLAMA_HOST (default 127.0.0.1:11434), OLLAMA_MODEL (default
// qwen2.5:7b-instruct), OLLAMA_TIMEOUT_MS (default 45000).

const OLLAMA_HOST = (
  process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"
).replace(/^(?!https?:\/\/)/, "http://");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 45000);

const SYSTEM_PROMPT =
  "You are the AI assistant built into SJC OS, the business operating system " +
  "for SJ Carpentry LLC — a residential carpentry and remodeling firm. The " +
  "owner is Joe Stafki. Write in a concise, concrete, practical voice for a " +
  "busy contractor. Never invent clients, dollar amounts, dates, or facts that " +
  "are not present in the context you are given. When asked to return JSON, " +
  "return only valid JSON matching the requested shape — no prose, no code " +
  "fences.";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Raw base64 images for a vision-capable Ollama model (see isVisionModel). */
  images?: { mime: string; base64: string }[];
}

/** Whether OLLAMA_MODEL can take images. qwen2.5:7b-instruct (the default)
 *  cannot; set OLLAMA_VISION=1 to force it on for a model this pattern misses. */
export function isVisionModel(): boolean {
  if (process.env.OLLAMA_VISION === "1") return true;
  if (process.env.OLLAMA_VISION === "0") return false;
  return /(-|:|^)(vl|vision|llava|bakllava|moondream|minicpm-v|gemma3|llama3\.2-vision|pixtral)/i.test(OLLAMA_MODEL);
}

/** Multi-turn Qwen chat for the persisted Ask window. Prepends the SJC OS
 *  system prompt and an optional page-context system note, then sends the full
 *  conversation so Qwen remembers earlier turns. Throws on failure (the caller
 *  decides how to surface it — unlike ai.ask which silently mocks). */
export async function qwenChat(
  turns: ChatTurn[],
  context?: string,
  /** Live progress: the answer so far, as Ollama streams tokens. */
  onPartial?: (text: string) => void,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  // W5: Joe-approved standing instructions ride along on every turn so the
  // in-app agents get them without an MCP round-trip. "" when none exist.
  const standing = await standingInstructionsBlock();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        // Streamed (NDJSON over one response) so the panel can show the answer
        // taking shape instead of a spinner; assembled here into one string.
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: ACTIONS_HINT },
          // Pending-write channel: Qwen proposes, Claude reviews, the app
          // executes (lib/orchestrator/proposals.ts). Self-gating.
          { role: "system", content: PROPOSAL_HINT },
          ...(standing ? [{ role: "system", content: standing }] : []),
          ...(context ? [{ role: "system", content: `Page the user is viewing:\n${context}` }] : []),
          ...turns.map((t) =>
            t.images?.length && isVisionModel()
              ? { role: t.role, content: t.content, images: t.images.map((i) => i.base64) }
              : { role: t.role, content: t.content },
          ),
        ],
        options: { temperature: 0.4 },
      }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    if (!res.body) throw new Error("ollama returned no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let answer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as { message?: { content?: string }; error?: string };
          if (evt.error) throw new Error(evt.error);
          const piece = evt.message?.content;
          if (piece) {
            answer += piece;
            onPartial?.(answer);
          }
        } catch (e) {
          if ((e as Error).message && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
    const out = answer.trim();
    if (!out) throw new Error("Qwen returned an empty response.");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Orchestrator helper: one structured Ollama call, null on ANY failure — no
 *  mock fallback, because the router treats null as "escalate", and a mocked
 *  answer would silently swallow that signal. */
export async function askOllamaJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T | null> {
  try {
    return JSON.parse(await ollamaChat(prompt, schema)) as T;
  } catch {
    return null;
  }
}

/** Low-level chat call. Returns the assistant message content as a string. */
async function ollamaChat(
  userPrompt: string,
  schema?: Record<string, unknown>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      // Server-side fetch; never cache model output.
      cache: "no-store",
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        ...(schema ? { format: schema } : {}),
        options: { temperature: 0.4 },
      }),
    });
    if (!res.ok) {
      throw new Error(`ollama HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Run a JSON method; on any failure relay the mock's answer so screens render. */
async function ollamaJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    const content = await ollamaChat(prompt, schema);
    return JSON.parse(content) as T;
  } catch (err) {
    console.error(
      `[ai:ollama] ${OLLAMA_MODEL} failed, falling back to mock — ${(err as Error).message}`,
    );
    return fallback();
  }
}

const ollamaProvider: AiProvider = {
  name: `ollama:${OLLAMA_MODEL}`,

  brief(input) {
    const projects = (input.projects ?? [])
      .map((p) => `- ${p.name}: ${p.status}, ${p.progress}% complete`)
      .join("\n");
    const leads = (input.leads ?? [])
      .map((l) => `- ${l.name}: ${l.scope} (${l.stage})`)
      .join("\n");
    const queue = (input.queue ?? [])
      .map((q) => `- ${q.rank} [${q.lane}] ${q.title} (${q.tag})`)
      .join("\n");
    const prompt =
      `Write Joe's morning triage brief for ${input.date} in ≤3 sentences. ` +
      `Open by naming what moves the week, then for each queued item say in ` +
      `one clause how it gets handled based on its lane: "chat" = you (the AI) ` +
      `can handle it in chat, so tell Joe to "say go" on that item by rank ` +
      `(e.g. "say go on #1"); "quick" = a one-click check-off for Joe; ` +
      `"deep" = Joe has to work it on its page (name the page). Reference ` +
      `items by their rank.\n\n` +
      `Today's queue (rank, lane, title):\n${queue || "(empty)"}\n\n` +
      `Active projects:\n${projects || "(none)"}\n\n` +
      `Open leads:\n${leads || "(none)"}\n\n` +
      `Threads waiting on a reply: ${input.threadsNeedingReply ?? 0}\n\n` +
      `Only reference the items above — do not invent others.`;
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        priorities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["lead", "job", "money", "marketing", "compliance"],
              },
              title: { type: "string" },
              reason: { type: "string" },
            },
            required: ["kind", "title", "reason"],
          },
        },
      },
      required: ["summary", "priorities"],
    };
    return ollamaJson<DailyBrief>(prompt, schema, () => mockProvider.brief(input));
  },

  triage(input) {
    const details = (input.details ?? [])
      .filter((d) => d.value.trim())
      .map((d) => `- ${d.label}: ${d.value}`)
      .join("\n");
    const prompt =
      `Triage this inbound lead for a residential carpentry/remodel firm. ` +
      `Weigh ALL the information the lead provided below — project fit, budget ` +
      `realism, timeline, decision-readiness, and how complete the inbound is. ` +
      `Decide a verdict: "go" (worth a Phase 1 estimate), "hold" (need a few ` +
      `clarifying answers first), or "pass" (out of scope or too small). Give a ` +
      `confidence 0–1, a one-sentence rationale grounded in what they provided, ` +
      `and exactly 5 clarifying questions to ask next.\n\n` +
      `Lead: ${input.name}\nScope: ${input.scope}\n` +
      `Estimated value: ${input.estimateValue ?? "unknown"}\n` +
      `Source: ${input.source ?? "unknown"}\n` +
      `Provided details:\n${details || "(none beyond the above)"}\n` +
      `Notes: ${input.notes ?? "(none)"}`;
    const schema = {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["go", "hold", "pass"] },
        confidence: { type: "number" },
        rationale: { type: "string" },
        questions: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "confidence", "rationale", "questions"],
    };
    return ollamaJson<TriageResult>(prompt, schema, () =>
      mockProvider.triage(input),
    ).then((r) => ({
      ...r,
      // Models sometimes emit confidence as a percentage; normalize to 0–1.
      confidence: r.confidence > 1 ? r.confidence / 100 : r.confidence,
    }));
  },

  draft(input) {
    const what: Record<DraftKind, string> = {
      email_reply: "a warm, professional reply to a client email",
      weekly_status: "a brief weekly project status update for a client",
      sow: "a numbered scope of work",
      demand_letter: "a firm but professional past-due payment demand letter",
      social_post: "a short marketing social post about a completed job",
    };
    const facts = (input.knowledge ?? [])
      .map((k) => `- (${k.kind}) ${k.content}`)
      .join("\n");
    const prompt =
      `Write ${what[input.kind]}.\n` +
      `Tone: ${input.tone ?? "professional"}.\n` +
      `Sign emails as Joe, SJ Carpentry.\n\n` +
      `Context:\n${input.context}\n\n` +
      (facts
        ? `Facts from the business system (use only if relevant; do not ` +
          `invent anything beyond these):\n${facts}\n\n`
        : "") +
      `Return a subject (omit for scope-of-work and social posts) and the body.`;
    const schema = {
      type: "object",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["body"],
    };
    return ollamaJson<DraftResult>(prompt, schema, () =>
      mockProvider.draft(input),
    );
  },

  summarize(input) {
    const prompt =
      (input.focus ? `Focus: ${input.focus}.\n` : "") +
      `Summarize the following in one tight paragraph, then give up to 3 ` +
      `bullet points covering the key decisions, deadlines, or next actions. ` +
      `Stick to what's in the text.\n\n${input.text}`;
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "bullets"],
    };
    return ollamaJson<SummaryResult>(prompt, schema, () =>
      mockProvider.summarize(input),
    );
  },

  suggest(input) {
    const prompt =
      (input.kind ? `Suggestion type: ${input.kind}.\n` : "") +
      `Given the context below, return a list of short, actionable ` +
      `suggestions (each one a single sentence). Only use facts from the ` +
      `context.\n\nContext:\n${input.context}`;
    const schema = {
      type: "object",
      properties: {
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["suggestions"],
    };
    return ollamaJson<SuggestResult>(prompt, schema, () =>
      mockProvider.suggest(input),
    );
  },

  estimate(input) {
    const intake = input.intake
      .filter((i) => i.answer.trim())
      .map((i) => `- ${i.question}: ${i.answer}`)
      .join("\n");
    const knowledge = (input.knowledge ?? [])
      .map((k) => `- (${k.kind}) ${k.content}`)
      .join("\n");
    const prompt =
      `Draft a Phase 1 rough estimate for a residential carpentry/remodel job. ` +
      `Break it into 5–8 line items (demo, materials, labor/subs, finishes, ` +
      `GC/contingency, etc.), each with a dollar amount or a tight range. Then ` +
      `give a rounded total range for the whole job. These are ballpark Phase 1 ` +
      `numbers — keep ranges realistic for the scope below; do not invent scope ` +
      `not implied by the inputs.\n\n` +
      `Lead: ${input.name}\nScope: ${input.scope}\n` +
      `Intake answers:\n${intake || "(none provided)"}\n` +
      (knowledge ? `Known facts about this job (site visits, measurements, ` +
        `material picks, prior assumptions):\n${knowledge}\n` : "") +
      (input.notes ? `Owner notes: ${input.notes}\n` : "");
    const schema = {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["label", "value"],
          },
        },
        total: { type: "string" },
      },
      required: ["lines", "total"],
    };
    return ollamaJson<EstimateResult>(prompt, schema, () =>
      mockProvider.estimate(input),
    );
  },

  async ask(input) {
    // Free-form Q&A — plain text, no JSON schema. Grounds on page context when
    // supplied; falls back to the mock answer on any failure/empty response.
    const prompt = input.context
      ? `Context for the page the user is viewing:\n${input.context}\n\n` +
        `Answer the user's question using that context where relevant. Be ` +
        `concise and concrete. If the answer isn't in the context, say what ` +
        `you'd need.\n\nQuestion: ${input.prompt}`
      : input.prompt;
    try {
      const answer = (await ollamaChat(prompt)).trim();
      if (!answer) return mockProvider.ask(input);
      return { answer };
    } catch (err) {
      console.error(
        `[ai:ollama] ${OLLAMA_MODEL} ask failed, falling back to mock — ${(err as Error).message}`,
      );
      return mockProvider.ask(input);
    }
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
    estimate: fail,
    ask: fail,
  };
}

function selectProvider(): AiProvider {
  switch (process.env.AI_PROVIDER ?? "mock") {
    case "mock":
      return mockProvider;
    case "ollama":
      return ollamaProvider;
    // Anthropic stays stubbed — wire when/if a hosted provider is wanted.
    case "anthropic":
      return notImplemented("anthropic");
    default:
      return mockProvider;
  }
}

/** The app-wide AI service. Import this — never a provider SDK directly. */
export const ai: AiProvider = selectProvider();
