import type { TodayPriority, WaitingItem } from "@/lib/today";

/**
 * The queue digest every panel turn carries as grounding, whatever page the
 * app view is on. The old operator console sent this (operatorContext); the
 * panel briefly sent only the current page's context, so a model asked to
 * "mark X done" while the app view was on /notifications had no ids to name
 * — and Qwen invented one. Format mirrors lib/page-context.ts todayContext:
 * work_item_id is stated so proposals/chips can reference real rows; the
 * always-on signal cards (lead:/warranty:/…) are labelled as not checkable.
 */
export function queueContext(priorities: TodayPriority[], waiting: WaitingItem[]): string {
  const rows = priorities.map(
    (p) =>
      `  - ${p.rank} [${p.tag}] ${p.title}${p.sub ? ` — ${p.sub}` : ""} (${
        p.checkable ? `work_item_id: ${p.id}` : `signal card, not a work item`
      })`,
  );
  const wait = waiting
    .filter((w) => w.checkable)
    .slice(0, 12)
    .map((w) => `  - ${w.label} (work_item_id: ${w.id})`);
  return [
    "Joe's Today queue right now (Priorities in rank order):",
    rows.length ? rows.join("\n") : "  (empty)",
    wait.length ? `Waiting on me (backlog):\n${wait.join("\n")}` : null,
    "Only reference work_item_ids listed above — never invent one.",
  ]
    .filter(Boolean)
    .join("\n");
}
