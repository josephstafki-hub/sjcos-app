// Operator Console · deterministic opening narration (spec §2.1). Pure string
// builder, no db imports — mirrors lib/today-directives.ts. Instant, free, and
// can't hallucinate ids: the model never writes this. Re-rendered from the live
// queue so it always reflects the current priorities.

import type { TodayPriority, WaitingItem } from "@/lib/today";

/** Deterministic opening message for the Operator console. Numbered so Joe can
 *  say "do #2". Lane notes explain what a hand-off can do. */
export function queueNarration(
  priorities: TodayPriority[],
  waiting: { items: WaitingItem[]; total: number },
): string {
  const real = priorities.filter((p) => p.id !== "all-clear");
  if (real.length === 0) {
    return "You're all clear — nothing promoted right now. Ask me anything, or I'll surface the next thing when it lands.";
  }
  const lines = real.map((p) => {
    const laneNote =
      p.lane === "chat" ? "agent can complete" : p.lane === "quick" ? "one click" : "needs you";
    return `${p.rank} [${p.tag}] ${p.title} — ${p.sub} (${laneNote})`;
  });
  return [
    `Here's the queue right now:`,
    ...lines,
    waiting.total ? `…plus ${waiting.total} more waiting on you.` : `Nothing else is waiting.`,
    ``,
    `Tell me which one to take — "do #2", or use the chips on a card. I'll draft anything client-facing for your approval instead of sending it.`,
  ].join("\n");
}
