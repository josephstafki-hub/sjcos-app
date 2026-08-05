"use client";

import type { ReactNode } from "react";
import { raiseHandOff } from "@/components/panel/panelBus";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { PriorityCard } from "./PriorityCard";

/** The Today centerpiece since the universal panel took over chat: the pinned
 *  AI brief plus the priority cards. A card's "Have Hermes do it" / "Prep me"
 *  chips raise the hand-off to the operator panel (docked beside this page, or
 *  a popped-out panel window) instead of running a chat here. */
export function TodayCards({ brief }: { brief: ReactNode }) {
  const { priorities } = useTodayQueue();

  const handOff = (p: TodayPriority, kind: "do" | "prep") => raiseHandOff(p, kind);

  return (
    <section className="flex flex-col gap-3">
      {brief}
      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Priorities
        </div>
        <div className="flex flex-col gap-2.5">
          {priorities.map((p) => (
            <PriorityCard key={p.id} p={p} onHandOff={handOff} />
          ))}
        </div>
      </div>
    </section>
  );
}
