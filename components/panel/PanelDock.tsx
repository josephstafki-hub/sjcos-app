"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TodayPriority } from "@/lib/today";
import { Segmented } from "@/components/ui/Segmented";
import { QueueRail } from "./QueueRail";
import { PanelChat } from "./PanelChat";
import type { ActiveRun } from "./useAgentChat";

/** Dock width at which the queue gets its own column beside the chat; below
 *  it an explicit Queue / Chat switch shows one view at a time. Decided by the
 *  dock's own width, not a viewport breakpoint. */
const TWO_COLUMN_MIN = 560;

/** Dock width at which the thread list becomes its own always-visible column
 *  beside the chat (T3-style: threads · queue · chat all at once — the popout
 *  window opens this wide). Below it, threads live behind the chat header's
 *  History toggle. */
const THREADS_RAIL_MIN = 880;

/**
 * The operator panel: the old operator console's left + center columns as one
 * dock. Two columns (queue · chat) when the dock is wide enough, a Queue / Chat
 * switch when not. The old far-right workbench column is gone — a
 * card's Inspect chip opens /workbench in the app view beside the dock, which
 * now plays the live-action role.
 */
export function PanelDock({
  width,
  navigate,
  compact = false,
  inWindow = false,
}: {
  width: number;
  /** How this dock reaches the app view. Docked: local router.push (default).
   *  In the popout window: requestAppNav over the bus. */
  navigate?: (href: string) => void;
  /** Mobile drawer: one queue or chat view at a time. */
  compact?: boolean;
  /** The popped-out /panel window: no to-do list at the top of its chats
   *  (no queue opener, no inline priority cards). */
  inWindow?: boolean;
}) {
  const [, setActiveRun] = useState<ActiveRun | null>(null);
  const [narrowView, setNarrowView] = useState("chat");
  const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);
  const handOffRef = useRef<((p: TodayPriority, kind: "do" | "prep") => void) | null>(null);
  const router = useRouter();
  const twoCol = !compact && width >= TWO_COLUMN_MIN;

  const inspect = (id: string) => {
    setFocusedSubjectId(id);
    const href = `/workbench?s=${encodeURIComponent(id)}`;
    if (navigate) navigate(href);
    else router.push(href);
  };

  const chatPanel = (
    <PanelChat
      registerHandOff={(fn) => {
        handOffRef.current = fn;
      }}
      onRunStart={setActiveRun}
      onRunEnd={() => setActiveRun(null)}
      showQueueCards={false}
      showNarration={!inWindow}
      compact={compact}
      threadView={inWindow && !twoCol ? narrowView === "threads" : undefined}
      onThreadViewChange={(open) => setNarrowView(open ? "threads" : "chat")}
      threadsRail={!compact && width >= THREADS_RAIL_MIN}
    />
  );

  if (!twoCol) return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Segmented aria-label="Operator view" value={narrowView} onChange={setNarrowView}
        className="h-12 [&_button]:h-11"
        options={[{ value: "queue", label: "Queue" }, ...(inWindow ? [{ value: "threads", label: "Threads" }] : []), { value: "chat", label: "Chat" }]} />
      <div className={`min-h-0 flex-1 ${narrowView !== "queue" ? "flex" : "hidden"}`}>{chatPanel}</div>
      {narrowView === "queue" && <QueueRail className="flex min-h-0 flex-1"
        onHandOff={(p, k) => { handOffRef.current?.(p, k); setNarrowView("chat"); }}
        onInspect={inspect} focusedSubjectId={focusedSubjectId} />}
    </div>
  );

  return (
    <div
      className={`grid h-full min-h-0 gap-2 p-2 ${
        // With the thread rail inside the chat cell, the chat side needs the
        // bigger share so the transcript keeps a usable width.
        width >= THREADS_RAIL_MIN
          ? "grid-cols-[minmax(200px,2fr)_minmax(480px,4fr)]"
          : "grid-cols-[minmax(200px,2fr)_minmax(300px,3fr)]"
      }`}
    >
      <QueueRail
        className="flex min-h-0"
        onHandOff={(p, k) => handOffRef.current?.(p, k)}
        onInspect={inspect}
        focusedSubjectId={focusedSubjectId}
      />
      {chatPanel}
    </div>
  );
}
