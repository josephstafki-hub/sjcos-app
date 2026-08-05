"use client";

import { useRef, useState } from "react";
import { QueueRail } from "@/components/operator/QueueRail";
import type { TodayPriority } from "@/lib/today";
import { PanelChat } from "./PanelChat";
import type { ActiveRun } from "./useAgentChat";

/** Dock width at which the queue gets its own column beside the chat; below
 *  it the priority cards render inline in the chat instead. Decided by the
 *  dock's own width, not a viewport breakpoint. */
const TWO_COLUMN_MIN = 560;

/**
 * The operator panel: the old operator console's left + center columns as one
 * dock. Two columns (queue · chat) when the dock is wide enough, chat with
 * inline cards when not. The old far-right workbench column is gone — the app
 * view beside the dock now plays that role, live.
 */
export function PanelDock({
  width,
  getPageContext,
}: {
  width: number;
  getPageContext: () => string | undefined;
}) {
  const [, setActiveRun] = useState<ActiveRun | null>(null);
  const handOffRef = useRef<((p: TodayPriority, kind: "do" | "prep") => void) | null>(null);
  const twoCol = width >= TWO_COLUMN_MIN;

  const chatPanel = (
    <PanelChat
      getPageContext={getPageContext}
      registerHandOff={(fn) => {
        handOffRef.current = fn;
      }}
      onRunStart={setActiveRun}
      onRunEnd={() => setActiveRun(null)}
      showQueueCards={!twoCol}
    />
  );

  if (!twoCol) return <div className="h-full min-h-0 p-2">{chatPanel}</div>;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(200px,2fr)_minmax(300px,3fr)] gap-2 p-2">
      <QueueRail
        className="flex min-h-0"
        onHandOff={(p, k) => handOffRef.current?.(p, k)}
      />
      {chatPanel}
    </div>
  );
}
