import "server-only";

import { chatReplyClaude } from "@/lib/dev-agents";
import { queryOne, query } from "@/lib/db";
import type { ChatTurn } from "@/lib/dev-agents";
import { extractJson } from "./claude-review";

// The voice concierge: in voice mode Claude is the ONE voice Joe hears. Every
// utterance goes to a fast, tool-less Claude call (haiku, ~2–3s) that either
// answers directly from what's on screen (queue + page context) or delegates
// the work to Hermes/Qwen and says so — the delegated run happens in the
// background and, when it lands, Claude turns its answer into a one-breath
// spoken update. Text chat is untouched; this is voice-mode routing only.
//
// Latency is the whole point of the design, so: haiku, short prompts, strict
// JSON contract, and every failure degrades to a spoken fallback rather than
// silence — a phone in a truck cab can't show an error toast usefully.

const VOICE_MODEL = process.env.ORCH_VOICE_MODEL ?? "haiku";

export interface ConciergeReply {
  /** What Claude says out loud (≤ 2 sentences, plain speech, no markdown). */
  speak: string;
  /** Work to hand off, if any. */
  delegate?: { agent: "hermes" | "qwen"; task: string };
}

/** Speak-first turn. `recent` = the last few conversation turns for context. */
export async function conciergeTurn(
  text: string,
  recent: ChatTurn[],
  context?: string,
): Promise<ConciergeReply> {
  const history = recent
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Joe" : "You"}: ${t.content.slice(0, 400)}`)
    .join("\n");
  const prompt =
    `You are Claude, the voice of SJ Carpentry's operator panel. Joe (the owner) is talking to you ` +
    `hands-free, often from a job site, so reply the way a sharp assistant would on a phone call: ` +
    `one or two short plain sentences, no lists, no markdown, no ids read aloud.\n\n` +
    `You have no tools. Decide per message:\n` +
    `- If you can answer from the context below (what's in the queue, what page is open, what was ` +
    `just said), answer directly.\n` +
    `- If it needs OS work — mark/snooze/complete a work item, look something up, update a lead or ` +
    `project, prep or queue anything — delegate it: hermes for anything needing tools or lookups ` +
    `(it has the sjcos MCP tools), qwen for pure drafting/summarizing text. Say you're on it and ` +
    `who's doing it; you'll report back when it lands. Client-facing sends and money documents ` +
    `are always drafted for Joe's approval, never sent — say so if relevant.\n` +
    `- If a status report ("the check was deposited", "they signed") clearly maps to a queue item, ` +
    `delegate to hermes: "mark <item> done" with the work_item_id from the queue in the task text.\n\n` +
    (context ? `Context:\n${context.slice(0, 3000)}\n\n` : "") +
    (history ? `Recent conversation:\n${history}\n\n` : "") +
    `Joe just said: "${text.slice(0, 1000)}"\n\n` +
    `Reply with ONE JSON object and nothing else — no code fences, no prose around it: ` +
    `{"speak":"…","delegate":{"agent":"hermes"|"qwen","task":"precise instruction incl. any work_item_id"}} ` +
    `— omit "delegate" when you answered directly.`;
  try {
    const raw = await chatReplyClaude(prompt, { model: VOICE_MODEL, timeoutMs: 45_000 });
    const parsed = extractJson<{ speak?: string; delegate?: { agent?: string; task?: string } }>(raw);
    // Never speak raw JSON. If the object didn't parse, still try to pull the
    // "speak" string out; if even that fails, use the text only when it
    // doesn't look like JSON at all.
    let speak = (parsed?.speak ?? "").trim();
    if (!speak) {
      const m = raw.match(/"speak"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) speak = m[1].replace(/\\"/g, '"').trim();
      else if (!/[{}[\]]/.test(raw)) speak = raw.trim().slice(0, 300);
    }
    if (!speak) speak = "Okay.";
    const d = parsed?.delegate;
    const delegate =
      d && (d.agent === "hermes" || d.agent === "qwen") && typeof d.task === "string" && d.task.trim()
        ? { agent: d.agent as "hermes" | "qwen", task: d.task.trim().slice(0, 1500) }
        : undefined;
    return { speak, delegate };
  } catch {
    // Voice must never go silent. Hand the raw ask to Hermes and say so.
    return {
      speak: "I'm having trouble thinking right now, so I'm handing that straight to Hermes.",
      delegate: { agent: "hermes", task: text.slice(0, 1500) },
    };
  }
}

/** The spoken form of a finished run's answer, cached in
 *  dev_agent_runs.spoken_answer so replays don't pay again. Claude condenses
 *  whatever Hermes/Qwen wrote into what a person would say out loud. */
export async function spokenUpdateForRun(runId: string): Promise<string | null> {
  const run = await queryOne<{ agent: string; prompt: string; answer: string | null; spoken: string | null }>(
    `SELECT agent, prompt, answer, spoken_answer AS spoken FROM dev_agent_runs WHERE id = $1`,
    [runId],
  );
  if (!run) return null;
  if (run.spoken) return run.spoken;
  if (!run.answer) return null;

  const who = run.agent === "hermes" ? "Hermes" : run.agent === "qwen" ? "Qwen" : "Claude";
  let spoken: string;
  try {
    const raw = await chatReplyClaude(
      `You are Claude, the voice of SJ Carpentry's operator panel. ${who} just finished a task Joe ` +
        `asked for by voice. Tell Joe the outcome in one or two short spoken sentences — plain speech, ` +
        `no markdown, no ids, lead with what changed or what needs him. If it failed or needs his ` +
        `approval, say that plainly.\n\nThe task:\n${run.prompt.slice(0, 800)}\n\n${who}'s report:\n` +
        `${run.answer.slice(0, 2500)}\n\nReply with ONE JSON object: {"speak":"…"}`,
      { model: VOICE_MODEL, timeoutMs: 45_000 },
    );
    spoken = extractJson<{ speak?: string }>(raw)?.speak?.trim() || "";
  } catch {
    spoken = "";
  }
  if (!spoken) spoken = fallbackSpoken(run.answer, who);
  await query(`UPDATE dev_agent_runs SET spoken_answer = $2 WHERE id = $1`, [runId, spoken]).catch(() => {});
  return spoken;
}

/** No-model fallback: strip markdown, first two sentences. */
function fallbackSpoken(answer: string, who: string): string {
  const flat = answer
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
  const two = sentences.slice(0, 2).join(" ").trim();
  return two ? `${who} says: ${two}` : `${who} finished, details are on your screen.`;
}
