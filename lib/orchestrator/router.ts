import "server-only";

import { askOllamaJson } from "@/lib/ai";
import { claudeTriage } from "./claude-review";

// The message router behind the panel's "Auto" agent. Rules first (free,
// instant), the local Qwen classifier for the gray zone (free, ~1s), Claude
// triage on haiku only for genuinely ambiguous or risky messages (~2s, real
// money). Manual model picks in the rail never reach this code — a pinned
// conversation is the bypass.

export type RoutedAgent = "qwen" | "hermes" | "claude";
export type RouteIntent = "read" | "write" | "code";

export interface RouteDecision {
  agent: RoutedAgent;
  intent: RouteIntent;
  via: "rules" | "classifier" | "triage" | "fallback";
  reason: string;
}

// Code/dev work → Claude (the repo agent). File paths, dev vocabulary, or a
// change-verb aimed at the app itself.
const FILE_RE = /\b[\w\-/]+\.(tsx?|mjs|cjs|css|sql|mdx?)\b/i;
const DEV_NOUN_RE = /\b(code|component|typescript|eslint|schema|migration|route handler|the app'?s? (code|page|build)|this (page|app) is (broken|wrong))\b/i;
const DEV_VERB_RE = /\b(fix|debug|refactor|rebuild|redeploy|deploy|restyle)\b/i;

// OS work → Hermes (the only agent with sjcos MCP tools). An action verb
// aimed at a business object, or its long-term memory.
const OS_VERB_RE = /\b(find|check|look\s?up|go through|send|queue|import|prepare|complete|mark|update|snooze|create|add|assign|schedule|follow\s?up|chase|order|log|capture|record)\b/i;
const OS_NOUN_RE = /\b(lead|client|project|job|estimate|invoice|receipt|purchase order|po\b|vendor|sub(contractor)?|work item|todo|task|queue|newsletter|issue|subscriber|selection|mood board|warranty|compliance|coi|schedule|knowledge|skill|runbook)\b/i;
const MEMORY_RE = /\b(remember|memory|memorize|don'?t forget)\b/i;

// Status reports — "the check was deposited", "they signed", "I finished X",
// "that's done" — are writes in disguise: the right response is to close the
// matching queue item. Joe talks to the panel this way constantly, so this
// must never be mistaken for small talk. Light in-context write → Qwen
// proposes (fast, free) with Claude's gate; a bad proposal escalates to Hermes.
const STATUS_RE =
  /\b(deposited|signed|paid|finished|completed|received|delivered|installed|arrived|closed( out)?|shipped|approved|confirmed|handled|resolved|took care of|taken care of|wrapped up|is done|are done|was done|got done|all set|is complete|are complete)\b/i;

// Clear reads → Qwen (free, grounded, no tools to misuse).
const READ_RE = /^(what|who|when|where|why|how|which|is|are|do|does|did|can|could|should|summar|explain|tell me|show me|give me|list)\b/i;
const DRAFT_RE = /\b(draft|write( me)?|compose|reword|rewrite|summarize|shorten)\b/i;

// Words that make a wrong route expensive — always worth Claude's opinion.
const RISK_RE = /\b(delete|remove|cancel|refund|pay|payment|invoice|money|price|contract|send (it|the|an?|to)|email (the|a|our)? ?client|text (the|a|our)? ?client)\b/i;

/** Pure rule pass. Null = no rule fired (fall through to the classifier). */
export function routeByRules(text: string): RouteDecision | null {
  const t = text.trim();
  if (FILE_RE.test(t) || DEV_NOUN_RE.test(t) || (DEV_VERB_RE.test(t) && /\b(page|screen|button|layout|panel|sidebar)\b/i.test(t))) {
    return { agent: "claude", intent: "code", via: "rules", reason: "dev/code signals" };
  }
  if (MEMORY_RE.test(t)) {
    return { agent: "hermes", intent: "write", via: "rules", reason: "Hermes long-term memory" };
  }
  if (OS_VERB_RE.test(t) && OS_NOUN_RE.test(t)) {
    // Write-shaped OS work. Risky phrasing still goes to Hermes — it's the
    // tool-holder — but via triage so Claude frames the caution.
    if (RISK_RE.test(t)) return null;
    return { agent: "hermes", intent: "write", via: "rules", reason: "OS action verb + object" };
  }
  // A status report that isn't a question → close-the-item write via Qwen.
  if (STATUS_RE.test(t) && !READ_RE.test(t) && !/\?\s*$/.test(t)) {
    return { agent: "qwen", intent: "write", via: "rules", reason: "status report → mark done" };
  }
  if (!RISK_RE.test(t) && (READ_RE.test(t) || DRAFT_RE.test(t))) {
    return { agent: "qwen", intent: DRAFT_RE.test(t) ? "read" : "read", via: "rules", reason: "read/draft" };
  }
  return null;
}

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    agent: { type: "string", enum: ["qwen", "hermes", "claude"] },
    intent: { type: "string", enum: ["read", "write", "code"] },
    confidence: { type: "number" },
  },
  required: ["agent", "intent", "confidence"],
} as const;

/** Full routing ladder for one message. Never throws; the terminal fallback is
 *  Hermes — the default MCP operator. */
export async function routeMessage(text: string, pageContext?: string): Promise<RouteDecision> {
  const ruled = routeByRules(text);
  if (ruled) return ruled;

  // Free local classifier for the gray zone.
  const prompt =
    `Route a message from the owner of a carpentry business to one of three assistants:\n` +
    `- "qwen": questions, summaries, drafts — read-only, no tools\n` +
    `- "hermes": does business/OS work with tools (leads, projects, work items, POs, newsletter)\n` +
    `- "claude": edits this web app's source code\n` +
    (pageContext ? `\nThe owner is viewing:\n${pageContext.slice(0, 500)}\n` : "") +
    `\nMessage:\n${text.slice(0, 1000)}\n\n` +
    `Reply with JSON {agent, intent ("read"|"write"|"code"), confidence 0-1}.`;
  const c = await askOllamaJson<{ agent: RoutedAgent; intent: RouteIntent; confidence: number }>(
    prompt,
    CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
  );
  if (
    c &&
    ["qwen", "hermes", "claude"].includes(c.agent) &&
    c.confidence >= 0.7 &&
    c.intent === "read" &&
    !RISK_RE.test(text) &&
    !STATUS_RE.test(text) // a status report is never a plain read
  ) {
    return { agent: c.agent, intent: c.intent, via: "classifier", reason: `local classifier (${c.confidence.toFixed(2)})` };
  }

  // Ambiguous, low-confidence, or risky — Claude (haiku) decides.
  const triaged = await claudeTriage(text, pageContext);
  if (triaged) return { ...triaged, via: "triage", reason: "Claude triage" };

  return { agent: "hermes", intent: "write", via: "fallback", reason: "triage unavailable — default operator" };
}
