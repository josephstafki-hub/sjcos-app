"use client";

// Layers tab: per-layer visibility with element counts, phase filter,
// display toggles, and the level list.

import { useMemo, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { DrawLayer } from "@/lib/plan-draw-types";
import { ALL_LAYERS, type DesignerContext, type PhaseView } from "../view-state";
import { fmtIn, levelSlice, type PlanDoc } from "@/lib/plan-doc";
import { ELEC_SYMBOLS } from "@/lib/plan-library";
import { BTN_PRIMARY, INPUT_CLS, SectionHeader, Segmented, Toggle } from "./fields";

const LAYER_LABEL: Record<DrawLayer, string> = {
  underlay: "Underlay",
  rooms: "Rooms",
  finishes: "Finishes",
  walls: "Walls",
  openings: "Openings",
  structure: "Structure",
  stairs: "Stairs",
  cabinets: "Cabinets",
  counters: "Counters",
  appliances: "Appliances",
  plumbing: "Plumbing",
  hvac: "HVAC",
  furniture: "Furniture",
  trim: "Trim",
  electrical: "Electrical",
  lighting: "Lighting",
  selections: "Selection ghosts",
  dims: "Dimensions",
  notes: "Notes",
  photos: "Photos",
  comments: "Comments",
  cameras: "Cameras",
};

const ELEC_GROUP = new Map(ELEC_SYMBOLS.map((s) => [s.type, s.group]));
const CAB = new Set(["base", "wall", "tall", "vanity", "island"]);

function layerCounts(doc: PlanDoc, levelId: string, commentCount: number): Record<DrawLayer, number> {
  const s = levelSlice(doc, levelId);
  const items = (pred: (i: PlanDoc["items"][number]) => boolean) => s.items.filter(pred).length;
  const dev = (groups: string[]) => s.electrical.filter((e) => groups.includes(ELEC_GROUP.get(e.type) ?? "power")).length;
  return {
    underlay: s.underlay ? 1 : 0,
    rooms: s.rooms.length,
    finishes: s.finishes.length,
    walls: s.walls.length,
    openings: s.openings.length,
    structure: s.structure.length + items((i) => i.kind === "structure"),
    stairs: s.stairs.length,
    cabinets: items((i) => CAB.has(i.kind)),
    counters: s.counters.length,
    appliances: items((i) => i.kind === "appliance"),
    plumbing: items((i) => i.kind === "plumbing"),
    hvac: items((i) => i.kind === "hvac") + dev(["hvac"]),
    furniture: items((i) => i.kind === "furniture"),
    trim: s.trims.length,
    electrical: dev(["power", "switch", "safety", "data"]),
    lighting: dev(["light"]) + items((i) => i.kind === "lighting"),
    selections: items((i) => i.selectionOptionId != null),
    dims: s.dims.length,
    notes: s.notes.length,
    photos: s.photos.length,
    comments: commentCount,
    cameras: s.cameras.length,
  };
}

export function LayersPanel({ ctx }: { ctx: DesignerContext }) {
  const { doc, levelId } = ctx.d;
  const ro = ctx.readOnly;
  const commentCount = ctx.comments.filter((c) => c.anchor.levelId === levelId && !c.resolvedAt).length;
  const counts = useMemo(() => layerCounts(doc, levelId, commentCount), [doc, levelId, commentCount]);
  const layers = ctx.view.layers;

  const setLayers = (next: Set<DrawLayer>) => ctx.setView({ layers: next });
  const toggle = (l: DrawLayer) => {
    const next = new Set(layers);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    setLayers(next);
  };

  const [newName, setNewName] = useState("");
  const [copyWalls, setCopyWalls] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div>
      <SectionHeader
        right={
          <button type="button" className="text-[11px] text-accent-2 hover:underline" onClick={() => setLayers(new Set(ALL_LAYERS))}>
            All on
          </button>
        }
      >
        Layers
      </SectionHeader>
      <div className="flex flex-col">
        {ALL_LAYERS.map((l) => {
          const on = layers.has(l);
          return (
            <div key={l} className={`group flex items-center gap-2 rounded px-1 py-[3px] text-[12.5px] hover:bg-paper-2 ${on ? "text-ink" : "text-ink-4"}`}>
              <button type="button" onClick={() => toggle(l)} className="flex-none text-ink-3 hover:text-ink" aria-label={on ? "Hide" : "Show"}>
                {on ? <Eye className="size-3.5" strokeWidth={1.75} /> : <EyeOff className="size-3.5" strokeWidth={1.75} />}
              </button>
              <span className="flex-1">{LAYER_LABEL[l]}</span>
              <span className="font-mono text-[10.5px] text-ink-3">{counts[l] || ""}</span>
              <button type="button" onClick={() => setLayers(new Set([l]))} className="invisible font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink group-hover:visible">
                Solo
              </button>
            </div>
          );
        })}
      </div>

      <SectionHeader>Phase</SectionHeader>
      <Segmented<PhaseView>
        value={ctx.view.phase}
        options={[
          { key: "all", label: "All" },
          { key: "existing", label: "Existing" },
          { key: "demo", label: "Demo" },
          { key: "new", label: "New" },
        ]}
        onChange={(phase) => ctx.setView({ phase })}
      />

      <SectionHeader>Display</SectionHeader>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <Toggle label="Tags" on={ctx.view.showTags} onChange={(showTags) => ctx.setView({ showTags })} />
        <Toggle label="Dimensions" on={ctx.view.showDims} onChange={(showDims) => ctx.setView({ showDims })} />
        <Toggle label="Room labels" on={ctx.view.showRoomLabels} onChange={(showRoomLabels) => ctx.setView({ showRoomLabels })} />
        <Toggle label="Grid" on={ctx.view.showGrid} onChange={(showGrid) => ctx.setView({ showGrid })} />
        <Toggle label="Snap" on={ctx.view.snapOn} onChange={(snapOn) => ctx.setView({ snapOn })} />
      </div>

      <SectionHeader>Levels</SectionHeader>
      <div className="flex flex-col gap-1">
        {doc.levels.map((l) => {
          const active = l.id === levelId;
          return (
            <div key={l.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${active ? "border-ink bg-paper-2" : "border-rule"}`}>
              {renaming === l.id ? (
                <input
                  autoFocus
                  className={`${INPUT_CLS} px-1.5 py-0.5`}
                  defaultValue={l.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== l.name) ctx.d.apply({ op: "updateLevel", id: l.id, patch: { name } });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button type="button" className="min-w-0 flex-1 truncate text-left text-ink" onClick={() => ctx.d.setLevelId(l.id)} onDoubleClick={() => !ro && setRenaming(l.id)}>
                  {l.name}
                </button>
              )}
              <span className="font-mono text-[10px] text-ink-3">{fmtIn(l.elevationIn)}</span>
              {!ro && renaming !== l.id && (
                <>
                  <button type="button" className="text-[10.5px] text-ink-3 hover:text-ink" onClick={() => setRenaming(l.id)}>
                    Rename
                  </button>
                  {doc.levels.length > 1 && (
                    <button
                      type="button"
                      className="text-ink-3 hover:text-flag"
                      aria-label="Remove level"
                      onClick={() => {
                        if (window.confirm(`Remove level "${l.name}" and everything on it?`)) ctx.d.apply({ op: "removeLevel", id: l.id });
                      }}
                    >
                      <Trash2 className="size-3" strokeWidth={1.75} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {!ro && doc.levels.length < 8 && (
        <form
          className="mt-2 flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim() || `Level ${doc.levels.length + 1}`;
            const top = doc.levels.reduce((m, l) => Math.max(m, l.elevationIn + l.ceilingIn + 12), 0);
            const ok = ctx.d.apply({ op: "addLevel", name, elevationIn: top, copyWallsFrom: copyWalls ? levelId : undefined });
            if (ok) setNewName("");
          }}
        >
          <div className="flex gap-1.5">
            <input className={INPUT_CLS} placeholder="New level name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" className={`${BTN_PRIMARY} flex-none`}>
              <Plus className="size-3" strokeWidth={1.75} /> Add
            </button>
          </div>
          <Toggle label="Copy walls from current level" on={copyWalls} onChange={setCopyWalls} />
        </form>
      )}
      {!ro && <div className="mt-2 text-[11px] text-ink-4">Double-click a level to rename.</div>}
    </div>
  );
}
