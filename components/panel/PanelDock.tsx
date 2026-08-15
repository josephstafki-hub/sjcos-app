"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TodayPriority } from "@/lib/today";
import { QueueRail } from "./QueueRail";
import { PanelChat } from "./PanelChat";
import type { ActiveRun } from "./useAgentChat";

/** Dock width at which the queue gets its own column beside the chat; below
 *  it the priority cards render inline in the chat instead. Decided by the
 *  dock's own width, not a viewport breakpoint. */
const TWO_COLUMN_MIN = 560;

/**
 * The operator panel: the old operator console's left + center columns as one
 * dock. Two columns (queue · chat) when the dock is wide enough, chat with
 * inline cards when not. The old far-right workbench column is gone — a
 * card's Inspect chip opens /workbench in the app view beside the dock, which
 * now plays the live-action role.
 */
export function PanelDock({
  width,
  navigate,
  compact = false,
}: {
  width: number;
  /** How this dock reaches the app view. Docked: local router.push (default).
   *  In the popout window: requestAppNav over the bus. */
  navigate?: (href: string) => void;
  /** Mobile drawer over a page: chat only, no queue column or inline cards. */
  compact?: boolean;
}) {
  const [, setActiveRun] = useState<ActiveRun | null>(null);
  const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);
  const handOffRef = useRef<((p: TodayPriority, kind: "do" | "prep") => void) | null>(null);
  const router = useRouter();
  const twoCol = width >= TWO_COLUMN_MIN;

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
      showQueueCards={!twoCol && !compact}
      compact={compact}
    />
  );

  if (!twoCol || compact) return <div className="h-full min-h-0 p-2">{chatPanel}</div>;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(200px,2fr)_minmax(300px,3fr)] gap-2 p-2">
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
