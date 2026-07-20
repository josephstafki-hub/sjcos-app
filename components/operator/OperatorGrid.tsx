"use client";

import { useRef, useState } from "react";
import type { DevAgent } from "@/lib/dev-agents-meta";
import type { TodayPriority } from "@/lib/today";
import { QueueRail } from "./QueueRail";
import { OperatorChat } from "./OperatorChat";
import { WorkbenchPanel } from "./WorkbenchPanel";

/** What run is live and which entity it's about — shared between the chat and
 *  the workbench (spec §1.4). Component state, not a second context. */
export interface ActiveRun {
  runId: string;
  agent: DevAgent;
  subjectId: string | null; // TodayPriority.id — a work_items uuid OR "lead:slug" etc.
  startedAt: number;
}

/** Operator console layout (spec §1.3): three columns at ≥xl (queue · chat ·
 *  workbench), two at lg (chat · workbench, queue cards move inline into the
 *  chat), one at base (chat with inline cards, workbench in a <details>). */
export function OperatorGrid({ aiContext }: { aiContext: string }) {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  // What the workbench shows. Set when a run starts with a subject, or when Joe
  // clicks a card's "Inspect" chip. Kept after a run so he can review changes.
  const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);
  const handOffRef = useRef<((p: TodayPriority, kind: "do" | "prep") => void) | null>(null);

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.2fr] xl:grid-cols-[minmax(260px,0.9fr)_minmax(380px,1.4fr)_minmax(300px,1fr)]">
      <QueueRail
        className="hidden xl:flex"
        onHandOff={(p, k) => handOffRef.current?.(p, k)}
        onInspect={setFocusedSubjectId}
        focusedSubjectId={focusedSubjectId}
      />

      <OperatorChat
        aiContext={aiContext}
        registerHandOff={(fn) => {
          handOffRef.current = fn;
        }}
        onRunStart={(r) => {
          setActiveRun(r);
          if (r.subjectId) setFocusedSubjectId(r.subjectId);
        }}
        onRunEnd={() => setActiveRun(null)}
      />

      {/* Workbench: its own column at lg+ … */}
      <div className="hidden lg:block">
        <WorkbenchPanel subjectId={focusedSubjectId} runActive={activeRun !== null} />
      </div>
      {/* …and a collapsible section on phones so it doesn't dominate. */}
      <details className="rounded-[10px] border border-rule bg-paper px-3 py-2 lg:hidden">
        <summary className="cursor-pointer text-[12px] font-medium text-ink-2">Workbench</summary>
        <div className="mt-2">
          <WorkbenchPanel subjectId={focusedSubjectId} runActive={activeRun !== null} />
        </div>
      </details>
    </div>
  );
}
