"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useTodayQueue } from "./TodayQueueContext";

/** "Waiting on me" list: the full backlog minus whatever's currently shown in
 *  Priorities (see TodayQueueContext). When a Priorities card's item turns
 *  out to be done, the item promoted to fill its slot disappears from here
 *  automatically — no separate fetch. */
export function WaitingList() {
  const { waiting: items, complete, busyId } = useTodayQueue();
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {items.map((item) => {
        const busy = busyId === item.id;
        return (
          <div
            key={item.id}
            className={`-mx-1 flex items-center gap-2 rounded px-1 py-0.5 transition-colors ${
              item.href ? "hover:bg-paper-3" : ""
            } ${busy ? "opacity-60" : ""}`}
          >
            {item.checkable ? (
              <button
                type="button"
                onClick={() => complete(item.id)}
                disabled={busy}
                title="Mark done"
                aria-label={`Mark ${item.label} done`}
                className="grid size-3.5 flex-none place-items-center rounded-[3px] border border-ink-4 transition-colors hover:border-money hover:bg-money/10 disabled:opacity-50"
              >
                <Check className="size-2.5 text-money" strokeWidth={2.5} />
              </button>
            ) : (
              <span className="size-3.5 flex-none rounded-[3px] border border-ink-4" />
            )}
            {item.href ? (
              <Link href={item.href} className="min-w-0 flex-1 text-[12px] text-ink-2 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 text-[12px] text-ink-2">{item.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Live "Waiting on me" count, kept in sync with the shared queue state. */
export function WaitingCount() {
  const { waiting } = useTodayQueue();
  return <span className="text-[11px] text-ink-3">{waiting.length} items</span>;
}
