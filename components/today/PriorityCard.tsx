"use client";

import { Card } from "@/components/ui";
import { useTodayQueue } from "./TodayQueueContext";
import { AssignmentLine, QueueActions } from "./QueueActions";
import type { TodayPriority } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** One Up next card: dot, mono tag, due date (red once it has passed), rank,
 *  serif title, sub, who's on it, then the lane's buttons (QueueActions). */
export function PriorityCard({
  p,
  onHandOff,
}: {
  p: TodayPriority;
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
}) {
  const { busyId, checkingId } = useTodayQueue();

  const busy = busyId === p.id || checkingId === p.id;
  const isAllClear = p.id === "all-clear";

  return (
    <Card className={`p-3 transition-all ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`size-2 flex-none rounded-full ${DOT[p.dot]}`} />
        <span className="min-w-0 truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
          {p.tag}
        </span>
        {p.due && <DueLabel due={p.due} overdue={p.overdue} />}
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-ink-4">{p.rank}</span>
      </div>
      <div className="mt-1 font-serif text-[16px] font-semibold text-ink">{p.title}</div>
      <div className="mt-0.5 text-[12px] text-ink-3">{p.sub}</div>

      {p.assignment && (
        <div className="mt-1.5">
          <AssignmentLine assignment={p.assignment} />
        </div>
      )}

      {!isAllClear && (
        <div className="mt-2.5">
          <QueueActions p={p} place="card" onHandOff={onHandOff} />
        </div>
      )}
    </Card>
  );
}

/** "due Sep 24" — red once the day has passed. */
export function DueLabel({ due, overdue }: { due: string; overdue?: boolean }) {
  return (
    <span className={`flex-none font-mono text-[10px] ${overdue ? "text-flag" : "text-ink-4"}`}>
      due {due}
    </span>
  );
}
