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
      className={`flex-col overflow-hidden rounded-[10px] border border-rule bg-paper shadow-card ${className}`}
    >
      <div className="border-b border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        Queue · Priorities
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        <div className="flex flex-col gap-2.5">
          {priorities.map((p) => (
            <div key={p.id}>
              <PriorityCard p={p} onHandOff={onHandOff} />
              {onInspect && p.id !== "all-clear" && (
                <div className="mt-1 flex justify-end">
                  <button
                    onClick={() => onInspect(p.id)}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors ${
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
      </div>
      <div className="border-t border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        Waiting on me
      </div>
      <div className="max-h-[38%] overflow-y-auto px-3 pb-3 pt-1">
        <WaitingList />
      </div>
    </aside>
  );
}
