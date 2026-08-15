"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { refreshTodayQueue } from "@/lib/actions/today";
import { TodayQueueProvider, useTodayQueue } from "@/components/today/TodayQueueContext";
import type { TodayPriority, WaitingItem } from "@/lib/today";
import { subscribePanelBus } from "./panelBus";

/** Stable empties — TodayQueueProvider adopts changed initial props via a
 *  render-phase comparison, so fresh array literals every render would loop. */
const EMPTY_PRIORITIES: TodayPriority[] = [];
const EMPTY_WAITING = { items: [] as WaitingItem[], total: 0 };

/** Tables whose writes can move a queue card. Anything else (chat rows, audit
 *  logs, newsletter…) is ignored so a busy Hermes turn doesn't hammer the
 *  queue query for unrelated writes. */
const QUEUE_SCOPES = new Set([
  "work_items",
  "leads",
  "lead_activity",
  "projects",
  "warranty_claims",
  "compliance_items",
]);
/** Floor between two live refreshes — LiveUpdates ticks every 2.5s. */
const MIN_GAP_MS = 2_000;

/**
 * The dock's queue data source. The dock lives in the (os) layout, which never
 * re-renders on navigation — so unlike the /today page it can't take the queue
 * as server props. It self-hydrates client-side via the same refreshTodayQueue
 * action the queue context already uses, then delegates everything (card
 * clicks, complete/snooze, focus refresh) to TodayQueueProvider.
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
      <LiveQueueRefresh />
      {children}
    </TodayQueueProvider>
  );
}

/**
 * The "cards update in real time" half. Renders nothing. When any agent
 * writes a queue-relevant table — Hermes over MCP mid-run, an approved Qwen
 * proposal, Joe in another tab — LiveUpdates publishes the touched scopes on
 * the panel bus and this re-reads the queue, so a card checks off the moment
 * the row changes rather than when the chat turn eventually settles.
 */
function LiveQueueRefresh() {
  const { refresh } = useTodayQueue();
  const last = useRef(0);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(
    () =>
      subscribePanelBus((m) => {
        if (m.type !== "changes") return;
        if (!m.scopes.some((s) => QUEUE_SCOPES.has(s))) return;
        const now = Date.now();
        if (now - last.current < MIN_GAP_MS) return;
        last.current = now;
        void refreshRef.current().catch(() => {});
      }),
    [],
  );
  return null;
}
