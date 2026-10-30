"use client";

import { useState, type ReactNode } from "react";
import { raiseHandOff } from "@/components/panel/panelBus";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { TodayPriorityRow } from "./TodayPriorityRow";
import { Segmented } from "@/components/ui";
import { TodayRecovery } from "./TodayRecovery";
import { QueueList } from "./QueueList";

/** The Today main column: the pinned AI brief, then ONE list — its top five as
 *  expandable rows under "Up next", the rest continuing below (QueueList).
 *  Cards and rows move between the two with "↓ Back to list" / "↑ Up next".
 *  "Have AI do it" / "Prep me" raise the hand-off to the operator panel
 *  (docked beside this page, or a popped-out panel window). */
export function TodayCards({ brief }: { brief: ReactNode }) {
  const [view, setView] = useState("active");
  const { priorities, waiting } = useTodayQueue();

  const handOff = (p: TodayPriority, kind: "do" | "prep") =>
    raiseHandOff(p, kind);
  const shown = priorities.filter((p) => p.id !== "all-clear").length;
  const onYou = shown + waiting.filter((w) => !w.waitingOnSub).length;

  return (
    <section className="flex min-w-0 flex-col gap-6">
      {brief}
      <Segmented
        aria-label="Today work views"
        value={view}
        onChange={setView}
        options={[
          { value: "active", label: "Work list", count: onYou },
          { value: "done", label: "Done" },
          { value: "snoozed", label: "Snoozed" },
        ]}
      />
      {view !== "active" ? (
        <TodayRecovery key={view} view={view as "done" | "snoozed"} />
      ) : (
        <>
          <div>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="font-serif text-heading text-ink">Up next</span>
              {shown > 0 && (
                <span className="text-meta text-ink-3">
                  {shown} of {onYou}
                </span>
              )}
            </div>
            <div className="divide-y divide-rule-soft rounded-lg border border-rule-soft bg-card shadow-card">
              {priorities.map((p) => (
                <TodayPriorityRow key={p.id} p={p} onHandOff={handOff} />
              ))}
            </div>
          </div>
          <QueueList onHandOff={handOff} />
        </>
      )}
    </section>
  );
}
