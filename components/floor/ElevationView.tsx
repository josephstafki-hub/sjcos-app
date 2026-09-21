"use client";

// Elevation / section view (docs/floor-plan-designer-plan.md §5): an
// orthographic SVG of one wall face from lib/plan-draw elevationOps, with a
// picker across the top for every auto-detected elevation and each section
// line. Clicking a cabinet in the elevation selects it (its tag text carries
// the item id via data-id).

import { useEffect, useMemo, useRef, useState } from "react";
import { autoElevations, elevationOps, sectionOps } from "@/lib/plan-draw";
import { DrawOpsSvg } from "./DrawOps";
import type { DesignerContext } from "./view-state";

export function ElevationView({ ctx, className = "" }: { ctx: DesignerContext; className?: string }) {
  const { d, view, setView } = ctx;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [zoom, setZoom] = useState(1);

  const options = useMemo(() => {
    const els = autoElevations(d.doc, d.levelId).map((e) => ({ key: `${e.wallId}:${e.side}`, label: e.label, wallId: e.wallId, side: e.side, sectionId: null as string | null }));
    // Any wall can be shown even without cabinets — add the rest as "Wall n".
    const seen = new Set(els.map((e) => e.wallId));
    let n = 1;
    for (const w of d.doc.walls.filter((w) => w.levelId === d.levelId && w.kind !== "remove")) {
      if (seen.has(w.id)) continue;
      els.push({ key: `${w.id}:right`, label: `Wall ${n++}`, wallId: w.id, side: "right", sectionId: null });
    }
    for (const s of d.doc.sections.filter((s) => s.levelId === d.levelId)) {
      els.push({ key: `sec:${s.id}`, label: `Section ${s.label}`, wallId: "", side: "right", sectionId: s.id });
    }
    return els;
  }, [d.doc, d.levelId]);

  const current = view.elevation
    ? options.find((o) => o.wallId === view.elevation!.wallId && o.side === view.elevation!.side) ?? options[0]
    : options[0];

  useEffect(() => {
    if (!view.elevation && options[0] && options[0].wallId) setView({ elevation: { wallId: options[0].wallId, side: options[0].side } });
  }, [options, view.elevation, setView]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rendered = useMemo(() => {
    if (!current) return null;
    if (current.sectionId) return sectionOps(d.doc, current.sectionId);
    return elevationOps(d.doc, { wallId: current.wallId, side: current.side, showTags: view.showTags, showDims: view.showDims });
  }, [current, d.doc, view.showTags, view.showDims]);

  if (!rendered) {
    return (
      <div className={`flex h-full items-center justify-center bg-paper-2 text-[13px] text-ink-3 ${className}`}>
        Draw a wall to see its elevation.
      </div>
    );
  }
  const pad = 24;
  const k = Math.max(0.2, Math.min((size.w - pad * 2) / Math.max(24, rendered.widthIn + 36), (size.h - pad * 2 - 36) / Math.max(24, rendered.heightIn + 30))) * zoom;
  const ox = (size.w - (rendered.widthIn + 36) * k) / 2 + 24 * k;
  const oy = 36 + (size.h - 36 - (rendered.heightIn + 30) * k) / 2;

  return (
    <div ref={host} className={`relative h-full w-full overflow-hidden bg-paper-2 ${className}`}>
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-rule bg-paper px-2 py-1 [scrollbar-width:none]">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => setView({ elevation: o.sectionId ? { wallId: `sec:${o.sectionId}`, side: "right" } : { wallId: o.wallId, side: o.side } })}
            className={[
              "whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]",
              current?.key === o.key ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-2 hover:bg-paper-2",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
        <div className="flex-1" />
        <button className="rounded border border-rule px-1.5 text-[11px]" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>−</button>
        <button className="rounded border border-rule px-1.5 text-[11px]" onClick={() => setZoom(1)}>fit</button>
        <button className="rounded border border-rule px-1.5 text-[11px]" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>+</button>
      </div>
      <svg
        className="absolute inset-0 h-full w-full select-none"
        onPointerDown={(e) => {
          const t = (e.target as Element).closest("[data-id]");
          const id = t?.getAttribute("data-id");
          if (id && d.doc.items.some((i) => i.id === id)) {
            d.select(e.shiftKey ? [...d.selected, id] : [id]);
            setView({ panel: "properties" });
          }
        }}
      >
        <g transform={`translate(${ox} ${oy}) scale(${k})`}>
          <rect x={-12} y={-12} width={rendered.widthIn + 24} height={rendered.heightIn + 24} fill="var(--paper)" stroke="var(--rule)" strokeWidth={1 / k} />
          <DrawOpsSvg ops={rendered.ops} pxPerIn={k} />
        </g>
        <text x={ox} y={oy - 8} fontSize={12} fontFamily="var(--font-serif, serif)" fill="var(--ink-2)">
          {rendered.title}
        </text>
      </svg>
    </div>
  );
}
