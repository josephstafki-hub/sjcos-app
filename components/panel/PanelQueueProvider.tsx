"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { refreshTodayQueue } from "@/lib/actions/today";
import { TodayQueueProvider } from "@/components/today/TodayQueueContext";
import type { TodayPriority, WaitingItem } from "@/lib/today";

/** Stable empties — TodayQueueProvider adopts changed initial props via a
 *  render-phase comparison, so fresh array literals every render would loop. */
const EMPTY_PRIORITIES: TodayPriority[] = [];
const EMPTY_WAITING = { items: [] as WaitingItem[], total: 0 };

/**
 * The dock's queue data source. The dock lives in the (os) layout, which never
 * re-renders on navigation — so unlike the /today page it can't take the queue
 * as server props. It self-hydrates client-side via the same refreshTodayQueue
 * action the queue context already uses for its own refreshes, then delegates
 * everything (card clicks, complete/snooze, focus refresh) to TodayQueueProvider.
 * Owner-only by construction: the (os) layout only mounts the panel for owners.
 */
export function PanelQueueProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<{
    priorities: TodayPriority[];
    waiting: { items: WaitingItem[]; total: number };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void refreshTodayQueue()
      .then((s) => {
        if (!cancelled) setSnap(s);
      })
      .catch(() => {
        // Fetch failure leaves the queue empty; the provider's focus refresh
        // and the chat's onSettled refresh both retry naturally.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const waiting = useMemo(() => (snap ? snap.waiting : EMPTY_WAITING), [snap]);

  return (
    <TodayQueueProvider
      initialPriorities={snap ? snap.priorities : EMPTY_PRIORITIES}
      initialWaiting={waiting}
    >
      {children}
    </TodayQueueProvider>
  );
}
