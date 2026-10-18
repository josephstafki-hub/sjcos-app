"use client";

import type { ReactNode } from "react";
import { raiseHandOff } from "@/components/panel/panelBus";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { PriorityCard } from "./PriorityCard";
import { QueueList } from "./QueueList";

/** The Today main column: the pinned AI brief, then ONE list — its top five as
 *  full cards under "Up next", the rest continuing below as rows (QueueList).
 *  Cards and rows move between the two with "↓ Back to list" / "↑ Up next".
 *  "Have AI do it" / "Prep me" raise the hand-off to the operator panel
 *  (docked beside this page, or a popped-out panel window). */
export function TodayCards({ brief }: { brief: ReactNode }) {
  const { priorities, waiting } = useTodayQueue();

  const handOff = (p: TodayPriority, kind: "do" | "prep") => raiseHandOff(p, kind);
  const shown = priorities.filter((p) => p.id !== "all-clear").length;
  const onYou = shown + waiting.filter((w) => !w.waitingOnSub).length;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {brief}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Up next</span>
          {shown > 0 && (
            <span className="text-[11px] text-ink-4">
              {shown} of {onYou}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {priorities.map((p) => (
            <PriorityCard key={p.id} p={p} onHandOff={handOff} />
          ))}
        </div>
      </div>
      <QueueList onHandOff={handOff} />
    </section>
  );
}
