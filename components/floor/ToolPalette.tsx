"use client";

import { useState } from "react";
import {
  MousePointer2, Hand, Minus, Square, DoorOpen, RectangleHorizontal, Scan, Footprints, Columns3, Ruler,
  Type, MessageSquare, Camera, Scissors, Grid2x2, PanelTop, Box as BoxIcon, Table2, Droplet, Plug, Wind,
  Armchair, PaintBucket, Layers2, Image as ImageIcon, MoveHorizontal, SquareStack, Slash, type LucideIcon,
} from "lucide-react";
import type { ToolId } from "./useDesigner";

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: LucideIcon;
  hint: string;
}

export interface ToolGroup {
  label: string;
  tools: ToolDef[];
}

/** The rail: docs/floor-plan-designer-plan.md §2.2. Hotkeys are single keys
 *  (with Shift/Alt variants) handled by the Designer shell. */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Navigate",
    tools: [
      { id: "select", label: "Select / Move", key: "V", icon: MousePointer2, hint: "Click to select, drag to move · Shift adds · Esc clears" },
      { id: "pan", label: "Pan", key: "H", icon: Hand, hint: "Drag to pan · hold Space with any tool" },
    ],
  },
  {
    label: "Structure",
    tools: [
      { id: "wall", label: "Wall", key: "W", icon: Minus, hint: "Click to start, click to add corners · double-click or Enter to finish · click the first corner to close" },
      { id: "room", label: "Room", key: "R", icon: Square, hint: "Drag a rectangle to make four walls" },
      { id: "door", label: "Door", key: "D", icon: DoorOpen, hint: "Hover a wall and click · the side you hover is the swing side; flip hand in Properties" },
      { id: "window", label: "Window", key: "N", icon: RectangleHorizontal, hint: "Hover a wall and click" },
      { id: "opening", label: "Opening", key: "O", icon: Scan, hint: "Cased opening in a wall" },
      { id: "stairs", label: "Stairs", key: "K", icon: Footprints, hint: "Click to place · edit shape in the inspector" },
      { id: "column", label: "Column", key: "B", icon: Columns3, hint: "Click to place a post" },
      { id: "beam", label: "Beam", key: "⇧B", icon: MoveHorizontal, hint: "Click two points" },
      { id: "soffit", label: "Soffit", key: "⌥B", icon: SquareStack, hint: "Click two points" },
    ],
  },
  {
    label: "Cabinets",
    tools: [
      { id: "base", label: "Base cabinet", key: "C", icon: Grid2x2, hint: "Click near a wall to snap · pick a size in Catalog" },
      { id: "wallcab", label: "Wall cabinet", key: "⇧C", icon: PanelTop, hint: "Click near a wall · sits at counter + gap" },
      { id: "tall", label: "Tall / pantry", key: "⌥C", icon: BoxIcon, hint: "Click near a wall" },
      { id: "island", label: "Island", key: "I", icon: Table2, hint: "Click anywhere · free-standing run" },
      { id: "filler", label: "Filler / panel", key: "⇧F", icon: Slash, hint: "Click in a run gap" },
      { id: "counter", label: "Countertop", key: "T", icon: RectangleHorizontal, hint: "Click points, double-click to close · auto from runs otherwise" },
    ],
  },
  {
    label: "Fixtures",
    tools: [
      { id: "appliance", label: "Appliance", key: "A", icon: BoxIcon, hint: "Pick in Catalog, click to place" },
      { id: "plumbing", label: "Plumbing", key: "P", icon: Droplet, hint: "Sink, toilet, tub, shower…" },
      { id: "electrical", label: "Electrical", key: "E", icon: Plug, hint: "Pick a symbol, click on a wall or ceiling spot" },
      { id: "hvac", label: "HVAC", key: "⇧H", icon: Wind, hint: "Register, return, exhaust" },
      { id: "furniture", label: "Furniture", key: "U", icon: Armchair, hint: "Space planning boxes" },
    ],
  },
  {
    label: "Finishes",
    tools: [
      { id: "floorFinish", label: "Floor finish", key: "L", icon: Layers2, hint: "Pick a material, click a room" },
      { id: "wallFinish", label: "Wall finish", key: "⇧L", icon: PaintBucket, hint: "Pick a material, click a wall face" },
      { id: "trim", label: "Trim", key: "⌥M", icon: Ruler, hint: "Click a room to add base trim" },
    ],
  },
  {
    label: "Annotate",
    tools: [
      { id: "measure", label: "Measure", key: "M", icon: Ruler, hint: "Click two points for a readout" },
      { id: "dimension", label: "Dimension", key: "⇧M", icon: MoveHorizontal, hint: "Click two points to keep a dimension" },
      { id: "note", label: "Note", key: "X", icon: Type, hint: "Click to drop a note" },
      { id: "comment", label: "Comment", key: "⇧X", icon: MessageSquare, hint: "Click to pin a comment" },
      { id: "photo", label: "Photo pin", key: "⇧P", icon: ImageIcon, hint: "Click to attach a site photo" },
    ],
  },
  {
    label: "View",
    tools: [
      { id: "camera", label: "Camera", key: "⇧V", icon: Camera, hint: "Click to drop a named 3D camera" },
      { id: "section", label: "Section", key: "⇧S", icon: Scissors, hint: "Click two points for a section line" },
    ],
  },
];

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => [t.id, t])));

/** Left tool rail. Groups collapse on short screens; the active tool shows
 *  its hint in the status bar (the shell reads TOOL_BY_ID). */
export function ToolPalette({
  tool,
  onSelect,
  compact = false,
}: {
  tool: ToolId;
  onSelect: (t: ToolId) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (compact) {
    // Horizontal strip (tablet portrait / narrow): one button per group opens a popover.
    return (
      <div className="flex items-center gap-1 overflow-x-auto border-b border-rule bg-paper-2 px-2 py-1.5">
        {TOOL_GROUPS.map((g) => {
          const active = g.tools.find((t) => t.id === tool);
          const Icon = (active ?? g.tools[0]).icon;
          return (
            <div key={g.label} className="relative">
              <button
                onClick={() => setOpen(open === g.label ? null : g.label)}
                className={[
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]",
                  active ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink-2",
                ].join(" ")}
              >
                <Icon className="size-3.5" strokeWidth={1.5} />
                {active ? active.label : g.label}
              </button>
              {open === g.label && (
                <div className="absolute left-0 top-full z-30 mt-1 flex min-w-[180px] flex-col gap-0.5 rounded-md border border-rule bg-card p-1 shadow-xl">
                  {g.tools.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onSelect(t.id);
                        setOpen(null);
                      }}
                      className={[
                        "flex items-center gap-2 rounded px-2 py-1 text-left text-[12px]",
                        t.id === tool ? "bg-ink text-paper" : "text-ink hover:bg-paper-2",
                      ].join(" ")}
                    >
                      <t.icon className="size-3.5" strokeWidth={1.5} />
                      <span className="flex-1">{t.label}</span>
                      <span className="font-mono text-[9px] opacity-60">{t.key}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <aside className="flex w-[72px] flex-none flex-col gap-2 overflow-y-auto border-r border-rule bg-paper-2 px-1.5 py-2 [scrollbar-width:none]">
      {TOOL_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col items-center gap-1">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-4">{g.label}</div>
          {g.tools.map((t) => {
            const Icon = t.icon;
            const active = t.id === tool;
            return (
              <button
                key={t.id}
                title={`${t.label} (${t.key}) — ${t.hint}`}
                onClick={() => onSelect(t.id)}
                aria-pressed={active}
                className={[
                  "flex w-[56px] flex-col items-center gap-0.5 rounded-md border py-1 transition-colors",
                  active ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink-2 hover:bg-paper-3",
                ].join(" ")}
              >
                <Icon className="size-4" strokeWidth={1.5} />
                <span className="max-w-[52px] truncate text-[8.5px] leading-tight">{t.label.split(" ")[0]}</span>
                <span className="font-mono text-[8px] opacity-60">{t.key}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
