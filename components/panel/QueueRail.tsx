"use client";

import { Search } from "lucide-react";
import { useTodayQueue } from "@/components/today/TodayQueueContext";
import { PriorityCard } from "@/components/today/PriorityCard";
import { WaitingList } from "@/components/today/WaitingList";
import type { TodayPriority } from "@/lib/today";

/** Operator console · left panel (spec §1.2). Reuses PriorityCard + WaitingList
 *  unchanged; adds a tiny app-rendered "Inspect" chip under each card (§1.4)
 *  that points the Workbench at that item's record — without touching
 *  PriorityCard itself. */
export function QueueRail({
  onHandOff,
  onInspect,
  focusedSubjectId,
  className = "",
}: {
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
  onInspect?: (id: string) => void;
  focusedSubjectId?: string | null;
  className?: string;
}) {
  const { priorities } = useTodayQueue();

  return (
    <aside
      className={`flex-col overflow-hidden rounded-lg border border-rule bg-paper shadow-card ${className}`}
    >
      <div className="border-b border-rule px-3 py-2 text-label font-semibold text-ink-2">
        Queue · Priorities
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="flex flex-col divide-y divide-rule-soft">
          {priorities.map((p) => (
            <div key={p.id} className="py-2">
              <details>
                <summary className="cursor-pointer rounded-md px-1 text-body font-semibold text-ink hover:bg-hover">
                  {p.title}
                  <span className="mt-0.5 line-clamp-2 text-meta font-normal text-ink-3">{p.due ? `Due ${p.due} · ` : ""}{p.sub}</span>
                </summary>
                <div className="mt-2"><PriorityCard p={p} onHandOff={onHandOff} /></div>
              </details>
              {onInspect && p.id !== "all-clear" && (
                <div className="mt-1 flex justify-end">
                  <button
                    onClick={() => onInspect(p.id)}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium transition-colors ${
                      focusedSubjectId === p.id
                        ? "bg-ai-soft text-ai-2"
                        : "text-ink-3 hover:bg-paper-2 hover:text-ink-2"
                    }`}
                    title="Show this record in the Workbench"
                  >
                    <Search className="size-3" strokeWidth={1.75} /> View
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      <div className="mt-2 border-t border-rule px-3 py-2 text-label font-semibold text-ink-2">
        Waiting on me
      </div>
      <div className="px-1 pb-2 pt-1">
        <WaitingList />
      </div>
      </div>
    </aside>
  );
}
