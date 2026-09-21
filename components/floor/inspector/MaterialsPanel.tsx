"use client";

// Materials tab: finish swatches (presets + catalog products). Clicking a
// swatch arms "painting" mode (ctx.view.paint — the canvas applies it on
// click) and, when something paintable is already selected, applies it
// straight away.

import { useMemo, useState } from "react";
import { Paintbrush, X } from "lucide-react";
import type { DesignerContext } from "../view-state";
import type { FinishRef } from "@/lib/plan-doc";
import { FINISH_PRESETS, finishPreset, type FinishPreset } from "@/lib/plan-library";
import { BTN_GHOST, SectionHeader, Segmented, SwatchGrid, type Swatch } from "./fields";

const CATEGORY_ORDER: FinishPreset["category"][] = ["paint", "cabinet", "stone", "quartz", "wood", "tile", "flooring", "carpet", "concrete", "metal", "glass"];
const CATEGORY_LABEL: Record<FinishPreset["category"], string> = {
  paint: "Paint",
  cabinet: "Cabinet finishes",
  stone: "Stone & laminate",
  quartz: "Quartz",
  wood: "Wood tops",
  tile: "Tile",
  flooring: "Flooring",
  carpet: "Carpet",
  concrete: "Concrete",
  metal: "Metals",
  glass: "Glass",
};
const FLOOR_CATS = new Set<string>(["flooring", "tile", "carpet", "concrete"]);
const CATALOG_CATS = ["counters", "tile", "flooring", "paint"];

function catalogRef(c: { id: number; name: string; material: { color?: string } | null }): FinishRef {
  return { key: `catalog-${c.id}`, label: c.name, color: c.material?.color ?? "#cccccc", catalogId: c.id };
}

export function MaterialsPanel({ ctx }: { ctx: DesignerContext }) {
  const [side, setSide] = useState<"left" | "right">("left");
  const ro = ctx.readOnly;
  const doc = ctx.d.doc;
  const selId = ctx.d.selected[0] ?? null;

  const target = useMemo(() => {
    if (!selId) return null;
    const room = doc.rooms.find((r) => r.id === selId);
    if (room) return { type: "room" as const, room };
    const wall = doc.walls.find((w) => w.id === selId);
    if (wall) return { type: "wall" as const, wall };
    const counter = doc.counters.find((c) => c.id === selId);
    if (counter) return { type: "counter" as const, counter };
    const item = doc.items.find((i) => i.id === selId);
    if (item && ["base", "wall", "tall", "vanity", "island"].includes(item.kind)) return { type: "cabinet" as const, item };
    return null;
  }, [doc, selId]);

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        cat,
        swatches: FINISH_PRESETS.filter((p) => p.category === cat).map<Swatch>((p) => ({ key: p.key, label: p.label, color: p.color, tile: !!p.defaultPattern })),
      })).filter((g) => g.swatches.length),
    [],
  );

  const catalogSwatches = useMemo(() => {
    const groups = CATALOG_CATS.map((cat) => ({
      cat,
      items: ctx.catalog.filter((c) => c.category.trim().toLowerCase() === cat),
    })).filter((g) => g.items.length);
    return groups;
  }, [ctx.catalog]);

  const applyTo = (ref: FinishRef, category: string | null) => {
    if (!target || ro) return;
    switch (target.type) {
      case "room":
        if (category === "paint") ctx.d.apply({ op: "setCeilingFinish", roomId: target.room.id, material: ref });
        else if (category == null || FLOOR_CATS.has(category)) ctx.d.apply({ op: "setFloorFinish", roomId: target.room.id, material: ref });
        return;
      case "wall":
        ctx.d.apply({ op: "setWallFinish", wallId: target.wall.id, side, material: ref });
        return;
      case "counter":
        ctx.d.apply({ op: "updateCounter", id: target.counter.id, patch: { material: ref } });
        return;
      case "cabinet":
        ctx.d.apply({ op: "setItemProps", ids: [target.item.id], props: { finish: ref.key, finishColor: ref.color } });
        return;
    }
  };

  const pick = (ref: FinishRef, category: string | null) => {
    ctx.setView({ paint: { key: ref.key } });
    applyTo(ref, category);
  };

  const paintKey = ctx.view.paint?.key ?? null;
  const paintLabel = paintKey ? finishPreset(paintKey)?.label ?? ctx.catalog.find((c) => `catalog-${c.id}` === paintKey)?.name ?? paintKey : null;

  return (
    <div>
      {paintKey && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-[12px]">
          <Paintbrush className="size-3.5 flex-none text-accent-2" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">
            Painting: <b>{paintLabel}</b> — click a surface, Esc to stop
          </span>
          <button type="button" className={BTN_GHOST} onClick={() => ctx.setView({ paint: null })}>
            <X className="size-3" strokeWidth={1.75} /> Stop
          </button>
        </div>
      )}
      <div className="mb-1 text-[11.5px] text-ink-3">
        {target
          ? target.type === "room"
            ? `Applies to ${target.room.name || "room"}: floor swatches set the floor, paint sets the ceiling.`
            : target.type === "wall"
              ? "Applies to the selected wall face."
              : target.type === "counter"
                ? "Applies to the selected counter."
                : `Applies to ${target.item.tag || target.item.label}.`
          : "Pick a swatch, then click a surface on the plan."}
      </div>
      {target?.type === "wall" && (
        <Segmented
          value={side}
          options={[
            { key: "left", label: "Left face" },
            { key: "right", label: "Right face" },
          ]}
          onChange={setSide}
        />
      )}

      {groups.map((g) => (
        <div key={g.cat}>
          <SectionHeader>{CATEGORY_LABEL[g.cat]}</SectionHeader>
          <SwatchGrid
            swatches={g.swatches}
            value={paintKey}
            onPick={(s) => {
              const p = finishPreset(s.key);
              if (!p) return;
              const ref: FinishRef = { key: p.key, label: p.label, color: p.color };
              if (p.textureKey) ref.textureKey = p.textureKey;
              if (p.defaultPattern) ref.pattern = { ...p.defaultPattern };
              pick(ref, p.category);
            }}
          />
        </div>
      ))}

      <SectionHeader>Catalog materials</SectionHeader>
      {catalogSwatches.length === 0 ? (
        <div className="text-[12px] text-ink-3">No catalog items in Counters / Tile / Flooring / Paint yet.</div>
      ) : (
        catalogSwatches.map((g) => (
          <div key={g.cat} className="mb-2">
            <div className="mb-1 text-[11px] capitalize text-ink-3">{g.cat}</div>
            <SwatchGrid
              swatches={g.items.map<Swatch>((c) => ({ key: `catalog-${c.id}`, label: c.name, color: c.material?.color ?? "#cccccc", tile: g.cat === "tile" }))}
              value={paintKey}
              onPick={(s) => {
                const c = g.items.find((x) => `catalog-${x.id}` === s.key);
                if (c) pick(catalogRef(c), g.cat === "counters" ? "stone" : g.cat);
              }}
            />
          </div>
        ))
      )}
    </div>
  );
}
