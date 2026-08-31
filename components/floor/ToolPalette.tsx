"use client";

import { useState } from "react";
import {
  MousePointer2,
  Minus,
  DoorOpen,
  RectangleHorizontal,
  Ruler,
  Grid2x2,
  Box as BoxIcon,
  Droplet,
  Plug,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import type { FloorTool } from "@/lib/floor";

const TOOL_ICON: Record<string, LucideIcon> = {
  select: MousePointer2,
  wall: Minus,
  door: DoorOpen,
  window: RectangleHorizontal,
  measure: Ruler,
  cabinet: Grid2x2,
  appliance: BoxIcon,
  plumb: Droplet,
  elec: Plug,
  note: StickyNote,
};

/** Left tool rail on the floor-plan canvas. Selection is real (client state);
 *  the canvas tools themselves are still the deferred editor internals. */
export function ToolPalette({ tools }: { tools: FloorTool[] }) {
  const [active, setActive] = useState(0);
  return (
    <aside className="flex w-[72px] flex-none flex-col items-center gap-1.5 border-r border-rule bg-paper-2 px-1.5 py-2.5">
      {tools.map((t, i) => {
        const Icon = TOOL_ICON[t.icon];
        return (
          <button
            key={t.label}
            title={`${t.label} (${t.key})`}
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={[
              "flex w-[52px] flex-col items-center gap-0.5 rounded-md border py-1.5 transition-colors",
              i === active
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-paper text-ink-2 hover:bg-paper-3",
            ].join(" ")}
          >
            <Icon className="size-4" strokeWidth={1.5} />
            <span className="font-mono text-[9px]">{t.key}</span>
          </button>
        );
      })}
    </aside>
  );
}
