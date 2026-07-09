"use client";

import Link from "next/link";
import { useTodayQueue } from "./TodayQueueContext";

/** "Waiting on me" list: the full backlog minus whatever's currently shown in
 *  Priorities (see TodayQueueContext). When a Priorities card's item turns
 *  out to be done, the item promoted to fill its slot disappears from here
 *  automatically — no separate fetch. */
export function WaitingList() {
  const { waiting: items } = useTodayQueue();
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {items.map((item) => {
        const row = (
          <>
            <span className="size-3.5 flex-none rounded-[3px] border border-ink-4" />
            <span className="text-[12px] text-ink-2">{item.label}</span>
          </>
        );
        return item.href ? (
          <Link
            key={item.id}
            href={item.href}
            className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-paper-3"
          >
            {row}
          </Link>
        ) : (
          <div key={item.id} className="flex items-center gap-2">
            {row}
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
