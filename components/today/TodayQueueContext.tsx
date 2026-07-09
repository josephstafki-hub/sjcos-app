"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { checkPriorityCompletion } from "@/lib/actions/today";
import type { TodayPriority } from "@/lib/today";

export interface WaitingItem {
  id: string;
  label: string;
  href?: string;
}

interface QueueState {
  priorities: TodayPriority[];
  setPriorities: React.Dispatch<React.SetStateAction<TodayPriority[]>>;
  waiting: WaitingItem[];
  /** Id of the card currently being checked, for a subtle pending style. */
  checkingId: string | null;
  /** Click handler for a Priorities card. Returns true once it's handled the
   *  click (the underlying item was already done, so the card was swapped or
   *  cleared in place) — the caller should skip navigation. Returns false
   *  when the item isn't checkable, or isn't actually done yet, so the
   *  caller should navigate to its href as normal. */
  handleCardClick: (item: TodayPriority) => Promise<boolean>;
}

const QueueContext = createContext<QueueState | null>(null);

/** Wraps the Priorities rail and the Waiting-on-me card so a click-time
 *  completion check (see lib/actions/today.ts) can swap both lists in place:
 *  a finished card is dropped from Priorities, and the next backlog item is
 *  promoted in to fill its slot and disappears from Waiting on me. */
export function TodayQueueProvider({
  initialPriorities,
  initialWaiting,
  children,
}: {
  initialPriorities: TodayPriority[];
  initialWaiting: { items: WaitingItem[]; total: number };
  children: ReactNode;
}) {
  const [priorities, setPriorities] = useState(initialPriorities);
  const [waiting, setWaiting] = useState(initialWaiting.items);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const handleCardClick = async (item: TodayPriority): Promise<boolean> => {
    if (!item.checkable) return false;

    setCheckingId(item.id);
    try {
      const result = await checkPriorityCompletion(item.id);
      if (!result.completed) return false;

      setPriorities((cur) => {
        const rest = cur.filter((p) => p.id !== item.id);
        const filled = result.next ? [...rest, { ...result.next, rank: "" }] : rest;
        return filled.map((p, i) => ({ ...p, rank: `#${i + 1}` }));
      });
      if (result.next) {
        const nextId = result.next.id;
        setWaiting((cur) => cur.filter((w) => w.id !== nextId));
      }
      return true;
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <QueueContext.Provider
      value={{ priorities, setPriorities, waiting, checkingId, handleCardClick }}
    >
      {children}
    </QueueContext.Provider>
  );
}

export function useTodayQueue(): QueueState {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useTodayQueue must be used within TodayQueueProvider");
  return ctx;
}
