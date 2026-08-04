"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  checkPriorityCompletion,
  refreshTodayQueue,
  completeTodayItem,
  snoozeTodayItem,
} from "@/lib/actions/today";
import type { TodayPriority, WaitingItem } from "@/lib/today";

export type { WaitingItem };

interface QueueState {
  priorities: TodayPriority[];
  setPriorities: React.Dispatch<React.SetStateAction<TodayPriority[]>>;
  waiting: WaitingItem[];
  /** Id of the card currently being checked, for a subtle pending style. */
  checkingId: string | null;
  /** Id of the card with a chip action (mark done / snooze) in flight. */
  busyId: string | null;
  /** Click handler for a Priorities card. Returns true once it's handled the
   *  click (the underlying item was already done, so the card was swapped or
   *  cleared in place) — the caller should skip navigation. Returns false
   *  when the item isn't checkable, or isn't actually done yet, so the
   *  caller should navigate to its href as normal. */
  handleCardClick: (item: TodayPriority) => Promise<boolean>;
  /** Re-read the live queue and replace both lists (e.g. after a Hermes turn
   *  or a window refocus). */
  refresh: () => Promise<void>;
  /** "Mark done" chip → complete the work item, replace both lists. */
  complete: (id: string) => Promise<void>;
  /** "Snooze 3d" chip → push the item out + demote it, replace both lists. */
  snooze: (id: string, days?: number) => Promise<void>;
}

const QueueContext = createContext<QueueState | null>(null);

/** Wraps the Today feed and the Waiting-on-me card so queue changes swap both
 *  lists in place: a finished/snoozed card leaves Priorities, and the next
 *  backlog item promotes in (via getQueueSnapshot on the server). */
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const lastRefresh = useRef(0);

  const applySnapshot = (snap: { priorities: TodayPriority[]; waiting: { items: WaitingItem[] } }) => {
    setPriorities(snap.priorities);
    setWaiting(snap.waiting.items);
    lastRefresh.current = Date.now();
  };

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

  const refresh = async () => {
    const snap = await refreshTodayQueue();
    applySnapshot(snap);
  };

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      applySnapshot(await completeTodayItem(id));
    } finally {
      setBusyId(null);
    }
  };

  const snooze = async (id: string, days?: number) => {
    setBusyId(id);
    try {
      applySnapshot(await snoozeTodayItem(id, days));
    } finally {
      setBusyId(null);
    }
  };

  // The page's server component re-renders with fresh lists whenever the
  // LiveUpdates poller (or anything else) calls router.refresh() — adopt them,
  // otherwise the queue would stay frozen at whatever this provider first
  // mounted with. Render-phase adjustment, not an effect (react.dev/learn/
  // you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevInitial, setPrevInitial] = useState({ initialPriorities, initialWaiting });
  if (prevInitial.initialPriorities !== initialPriorities || prevInitial.initialWaiting !== initialWaiting) {
    setPrevInitial({ initialPriorities, initialWaiting });
    setPriorities(initialPriorities);
    setWaiting(initialWaiting.items);
  }

  // Refresh when the tab regains focus (Hermes may have worked items on the
  // Telegram/MCP side while Joe was away), throttled to ≥30s apart.
  useEffect(() => {
    function onFocus() {
      if (Date.now() - lastRefresh.current < 30_000) return;
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QueueContext.Provider
      value={{
        priorities,
        setPriorities,
        waiting,
        checkingId,
        busyId,
        handleCardClick,
        refresh,
        complete,
        snooze,
      }}
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
