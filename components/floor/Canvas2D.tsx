"use client";

// The 2D drafting canvas (docs/floor-plan-designer-plan.md §3). One SVG with a
// pan/zoom transform; the plan itself is DrawOps from lib/plan-draw rendered
// by DrawOpsSvg, and every interaction is geometric hit-testing on the doc
// (not DOM events per element) so touch, pencil, and mouse behave the same.
// Every edit is a PlanOp through ctx.d.apply / ctx.d.preview.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  dist,
  fmtIn,
  levelSlice,
  parseIn,
  pointInPolygon,
  type ElecType,
  type FinishRef,
  type PlacedItem,
  type Pt,
  type Wall,
} from "@/lib/plan-doc";
import {
  alignmentGuides,
  centroid,
  distToWall,
  itemCorners,
  levelBounds,
  nearestWall,
  openingWorld,
  pointInItem,
  projectOnWall,
  rectsOverlap,
  samePt,
  snapPoint,
  calibrateUnderlay,
  underlayCorners,
  wallFrame,
  type SnapResult,
} from "@/lib/plan-geometry";
import { planOps } from "@/lib/plan-draw";
import { pointInStair } from "@/lib/plan-stairs";
import type { DrawOp } from "@/lib/plan-draw-types";
import { DrawOpsSvg } from "./DrawOps";
import { DEFAULT_FINISH_KEYS, ELEC_SYMBOLS, LIBRARY, finishPreset, finishRef, libraryItem, searchLibrary } from "@/lib/plan-library";
import { openingAtFromPoint, type PlanOp } from "@/lib/plan-ops";
import { runAction } from "@/lib/run-action";
import { addPlanComment } from "@/lib/actions/plan-comments";
import { uploadPlanCapture } from "@/lib/actions/plan-files";
import type { ToolId } from "./useDesigner";
import { drawWallKind, type DesignerContext } from "./view-state";
import { cursorStore, type CursorInfo } from "./StatusBar";

export interface Canvas2DHandle {
  fit(): void;
  focus(target: { id?: string; x?: number; y?: number }): void;
  cancel(): void;
  finish(): void;
  zoom(factor: number): void;
}

/** What a press needs, so a touch tap can be replayed on lift-off. */
interface PressInfo {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  pointerId: number;
}

interface Viewport {
  k: number; // px per inch
  tx: number;
  ty: number;
}

type Hit =
  | { id: string; kind: "item" | "device" | "wall" | "opening" | "note" | "dim" | "counter" | "room" | "stair" | "structure" | "camera" | "section" | "photo" }
  | null;

type Drag =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; tx: number; ty: number }
  | { kind: "marquee"; start: Pt; cur: Pt }
  | { kind: "move"; ids: string[]; start: Pt; cur: Pt; moved: boolean; cabinets: boolean }
  | { kind: "corner"; from: Pt; cur: Pt; others: Wall[] }
  | { kind: "opening"; id: string; wallId: string; widthIn: number; grabIn: number; startPx: { x: number; y: number }; moved: boolean }
  | { kind: "underlay"; id: string; start: Pt; x: number; y: number; moved: boolean }
  | { kind: "roomRect"; start: Pt; cur: Pt }
  | { kind: "pinch"; d0: number; k0: number; cx: number; cy: number; tx0: number; ty0: number; mid0: { x: number; y: number } };

const MIN_K = 0.2;
const MAX_K = 40;

const PLACE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["base", "wallcab", "tall", "island", "filler", "appliance", "plumbing", "furniture"]);
const TWO_CLICK_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["beam", "soffit", "measure", "dimension", "section"]);

/** Library key to place for a tool when nothing is armed. */
function defaultKeyFor(tool: ToolId): string | null {
  const byTag = (kind: PlacedItem["kind"], tag: string) => LIBRARY.find((i) => i.kind === kind && i.tag === tag)?.key ?? null;
  switch (tool) {
    case "base":
      return byTag("base", "B36") ?? searchLibrary("base", "base")[0]?.key ?? null;
    case "wallcab":
      return byTag("wall", "W3030") ?? searchLibrary("wall", "wall")[0]?.key ?? null;
    case "tall":
      return byTag("tall", "T2484") ?? searchLibrary("pantry", "tall")[0]?.key ?? null;
    case "island":
      return byTag("base", "B36") ?? null;
    case "filler":
      return LIBRARY.find((i) => i.key.includes("filler"))?.key ?? null;
    case "appliance":
      return searchLibrary("range 30", "appliance")[0]?.key ?? searchLibrary("range", "appliance")[0]?.key ?? null;
    case "plumbing":
      return searchLibrary("kitchen sink", "plumbing")[0]?.key ?? searchLibrary("sink", "plumbing")[0]?.key ?? null;
    case "furniture":
      return searchLibrary("table", "furniture")[0]?.key ?? null;
    default:
      return null;
  }
}

export const Canvas2D = forwardRef<Canvas2DHandle, { ctx: DesignerContext; className?: string }>(function Canvas2D({ ctx, className = "" }, ref) {
  const { d, view, setView } = ctx;
  /** A paint key is a finish preset key or "catalog-<id>" (a catalog material). */
  const resolvePaint = useCallback(
    (key: string): FinishRef => {
      if (key.startsWith("catalog-")) {
        const c = ctx.catalog.find((x) => x.id === Number(key.slice(8)));
        if (c) return { key, label: c.name, color: c.material?.color ?? "#cccccc", catalogId: c.id, textureKey: c.material?.textureKey };
      }
      return finishRef(key);
    },
    [ctx.catalog],
  );
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [vp, setVp] = useState<Viewport>({ k: 3, tx: 80, ty: 60 });
  const vpRef = useRef(vp);
  useLayoutEffect(() => {
    vpRef.current = vp;
  }, [vp]);
  // 0×0 until the observer measures the pane, so the first fit uses the real size.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<Drag>({ kind: "none" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // Marquee / room rectangle being dragged (state, so the overlay re-renders).
  const [dragBox, setDragBox] = useState<{ kind: "marquee" | "roomRect"; start: Pt; cur: Pt } | null>(null);
  const [poly, setPoly] = useState<Pt[]>([]); // wall / counter polyline in progress
  const [first, setFirst] = useState<Pt | null>(null); // two-click tools
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [hoverWall, setHoverWall] = useState<{ wall: Wall; t: number; side: number } | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt } | null>(null);
  const [loadedSize, setLoadedSize] = useState<{ fileId: string; w: number; h: number } | null>(null);
  const spaceDown = useRef(false);
  const fittedFor = useRef<string | null>(null);
  /** Until the user pans / zooms, every resize re-fits (the pane settles over
   *  a few frames as the shell lays out); after that a resize keeps the
   *  middle of the view in place. */
  const autoFit = useRef(true);

  const levelId = d.levelId;
  const slice = useMemo(() => levelSlice(d.doc, levelId), [d.doc, levelId]);
  const ulSizeRef = useRef<{ w: number; h: number } | null>(null);
  const levelWalls = slice.walls;
  const selectedSet = useMemo(() => new Set(d.selected), [d.selected]);

  // ── viewport helpers ──
  const toPlan = useCallback((clientX: number, clientY: number): Pt => {
    const el = svgRef.current;
    const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const { k, tx, ty } = vpRef.current;
    return { x: (clientX - r.left - tx) / k, y: (clientY - r.top - ty) / k };
  }, []);

  const fit = useCallback(() => {
    if (size.w < 50) return;
    const lb = levelBounds(d.doc, levelId);
    const ul = levelSlice(d.doc, levelId).underlay;
    const ulPts = ul && ulSizeRef.current ? underlayCorners(ul, ulSizeRef.current.w, ulSizeRef.current.h) : [];
    const pts = [...(lb ? [lb.min, lb.max] : []), ...ulPts];
    const b = pts.length
      ? { min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) }, max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) } }
      : { min: { x: 0, y: 0 }, max: { x: 240, y: 180 } };
    const w = Math.max(24, b.max.x - b.min.x);
    const h = Math.max(24, b.max.y - b.min.y);
    const pad = 48;
    const k = Math.max(MIN_K, Math.min(MAX_K, Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h)));
    const tx = (size.w - w * k) / 2 - b.min.x * k;
    const ty = (size.h - h * k) / 2 - b.min.y * k;
    setVp({ k, tx, ty });
  }, [d.doc, levelId, size.h, size.w]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    autoFit.current = false;
    setVp((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
      const f = k / v.k;
      return { k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
    });
  }, []);


  // Size observer + first fit.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    let last: { w: number; h: number } | null = null;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return; // hidden pane
      const next = { w: Math.max(50, r.width), h: Math.max(50, r.height) };
      // Pane resized (Plan ↔ Split, inspector, window): keep the same spot
      // of the plan in the middle instead of letting it slide off one side.
      if (last && !autoFit.current) {
        const dx = (next.w - last.w) / 2;
        const dy = (next.h - last.h) / 2;
        if (dx || dy) setVp((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      }
      last = next;
      setSize(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = `${ctx.design.id}:${levelId}`;
    if (size.w <= 50) return;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      autoFit.current = true;
      fit();
    } else if (autoFit.current) fit();
    // Re-run on size changes too (autoFit); not on every doc edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.design.id, levelId, size.w, size.h]);

  // Reset transient tool state when the tool changes (derived during render).
  const [toolSeen, setToolSeen] = useState(d.tool);
  if (toolSeen !== d.tool) {
    setToolSeen(d.tool);
    setPoly([]);
    setFirst(null);
    setMeasure(null);
  }

  // Underlay on this level + its pixel size (stored on new underlays; older
  // ones are measured by loading the image).
  const underlay = slice.underlay;
  const underlayFileId = underlay?.fileId ?? null;
  const storedW = underlay?.widthPx ?? 0;
  const storedH = underlay?.heightPx ?? 0;
  const storedSize = storedW && storedH ? { w: storedW, h: storedH } : null;
  const needsMeasure = !!underlayFileId && !storedSize;
  useEffect(() => {
    if (!needsMeasure || !underlayFileId) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setLoadedSize({ fileId: underlayFileId, w: img.naturalWidth, h: img.naturalHeight });
    img.src = `/api/files/${underlayFileId}`;
    return () => {
      live = false;
    };
  }, [needsMeasure, underlayFileId]);
  const ulSize = useMemo(
    () => (storedW && storedH ? { w: storedW, h: storedH } : loadedSize && loadedSize.fileId === underlayFileId ? { w: loadedSize.w, h: loadedSize.h } : null),
    [storedW, storedH, loadedSize, underlayFileId],
  );
  useLayoutEffect(() => {
    ulSizeRef.current = ulSize;
  }, [ulSize]);
  // A newly placed / replaced underlay: frame it so the whole sheet shows.
  const fittedUnderlay = useRef<string | null | undefined>(undefined);
  const underlayKey = underlay && ulSize ? `${underlay.id}:${underlay.fileId}` : null;
  useEffect(() => {
    if (fittedUnderlay.current === undefined) {
      fittedUnderlay.current = underlayKey;
      return;
    }
    if (underlayKey !== fittedUnderlay.current) {
      fittedUnderlay.current = underlayKey;
      if (underlayKey) fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlayKey]);

  // Space = temporary pan.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    // Released while the window was in the background → no keyup; reset.
    const blur = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ── drawing ops ──
  const ops: DrawOp[] = useMemo(
    () =>
      planOps(d.doc, {
        levelId,
        phase: view.phase,
        layers: view.layers,
        selectedIds: selectedSet,
        hoverId: d.hover,
        showTags: view.showTags,
        showDims: view.showDims,
        showRoomLabels: view.showRoomLabels,
        scalePxPerIn: vp.k,
      }),
    [d.doc, levelId, view.phase, view.layers, selectedSet, d.hover, view.showTags, view.showDims, view.showRoomLabels, vp.k],
  );

  // Room fills / finish regions sit under the plan image; everything else over it.
  const [opsBelow, opsAbove] = useMemo(() => {
    const n = ops.findIndex((op) => op.layer !== "rooms" && op.layer !== "finishes" && op.layer !== "underlay");
    return n < 0 ? [ops, []] : [ops.slice(0, n), ops.slice(n)];
  }, [ops]);

  // ── hit testing ──
  const hitTest = useCallback(
    (p: Pt): Hit => {
      const tol = 6 / vp.k; // 6 px
      for (const e of [...slice.electrical].reverse()) if (Math.hypot(e.x - p.x, e.y - p.y) <= Math.max(4, tol)) return { id: e.id, kind: "device" };
      for (const c of [...slice.cameras].reverse()) if (Math.hypot(c.pos[0] - p.x, c.pos[2] - p.y) <= 6) return { id: c.id, kind: "camera" };
      for (const ph of [...slice.photos].reverse()) if (Math.hypot(ph.x - p.x, ph.y - p.y) <= 6) return { id: ph.id, kind: "photo" };
      for (const n of [...slice.notes].reverse()) if (Math.abs(n.x - p.x) <= 24 && Math.abs(n.y - p.y) <= 8) return { id: n.id, kind: "note" };
      for (const it of [...slice.items].reverse()) {
        if (!view.layers.has(it.kind === "appliance" ? "appliances" : it.kind === "plumbing" ? "plumbing" : it.kind === "furniture" ? "furniture" : it.kind === "hvac" ? "hvac" : "cabinets")) continue;
        if (pointInItem(p, it)) return { id: it.id, kind: "item" };
      }
      for (const s of [...slice.structure].reverse()) {
        const dd = distToWall({ a: s.a, b: s.b }, p);
        if (dd <= Math.max(s.wIn / 2, tol)) return { id: s.id, kind: "structure" };
      }
      for (const s of [...slice.stairs].reverse()) if (pointInStair(s, p)) return { id: s.id, kind: "stair" };
      for (const w of levelWalls) {
        const pr = projectOnWall(w, p);
        for (const o of slice.openings.filter((x) => x.wallId === w.id)) {
          if (pr.t >= o.atIn && pr.t <= o.atIn + o.widthIn && Math.abs(pr.side) <= w.thickIn / 2 + tol) return { id: o.id, kind: "opening" };
        }
      }
      for (const w of levelWalls) if (distToWall(w, p) <= w.thickIn / 2 + tol) return { id: w.id, kind: "wall" };
      for (const dm of slice.dims) if (distToWall({ a: dm.a, b: dm.b }, p) <= tol + Math.abs(dm.offsetIn)) {
        const f = wallFrame({ a: dm.a, b: dm.b });
        const pr = projectOnWall({ a: dm.a, b: dm.b }, p);
        if (pr.t >= 0 && pr.t <= f.length && Math.abs(pr.side - dm.offsetIn) <= tol) return { id: dm.id, kind: "dim" };
      }
      for (const s of slice.sections) if (distToWall({ a: s.a, b: s.b }, p) <= tol) return { id: s.id, kind: "section" };
      for (const c of [...slice.counters].reverse()) if (view.layers.has("counters") && pointInPolygon(p, c.polygon)) return { id: c.id, kind: "counter" };
      for (const r of slice.rooms) if (pointInPolygon(p, r.polygon)) return { id: r.id, kind: "room" };
      return null;
    },
    [slice, levelWalls, view.layers, vp.k],
  );

  const roomAt = useCallback((p: Pt) => slice.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null, [slice.rooms]);

  const snapOpts = useCallback(
    () => ({
      gridIn: view.snapOn ? d.doc.settings.snapIn : 0,
      angleDeg: view.snapOn ? d.doc.settings.angleSnap : (0 as const),
      endpoints: view.snapOn,
      faces: view.snapOn,
      midpoints: view.snapOn,
      radiusIn: 10 / vp.k,
    }),
    [view.snapOn, d.doc.settings.snapIn, d.doc.settings.angleSnap, vp.k],
  );

  const snapped = useCallback(
    (p: Pt, anchor?: Pt | null): SnapResult => snapPoint(p, levelWalls, snapOpts(), anchor),
    [levelWalls, snapOpts],
  );

  const pushCursor = useCallback(
    (p: Pt | null, extra: Partial<CursorInfo> = {}) => {
      const room = p ? roomAt(p) : null;
      cursorStore.set({ pt: p, roomName: room?.name ?? null, roomSf: room?.areaSf ?? null, roomLf: room?.perimLf ?? null, ...extra });
    },
    [roomAt],
  );

  // ── placing helpers ──
  const placeArmed = useCallback(
    (p: Pt) => {
      const tool = d.tool;
      const armed = view.armed;
      const isIsland = tool === "island";
      if (armed?.catalogId) {
        const c = ctx.catalog.find((x) => x.id === armed.catalogId);
        if (!c || !c.widthIn || !c.depthIn || !c.heightIn) return;
        const kind = (c.placeKind || (tool === "wallcab" ? "wall" : tool === "tall" ? "tall" : tool === "appliance" ? "appliance" : tool === "plumbing" ? "plumbing" : tool === "furniture" ? "furniture" : isIsland ? "island" : "base")) as PlacedItem["kind"];
        d.apply({
          op: "placeItem",
          levelId,
          catalog: { id: c.id, name: c.name, kind, w: c.widthIn, d: c.depthIn, h: c.heightIn, color: c.material?.color, props: { sku: c.sku } },
          at: p,
          snapToWall: !isIsland && kind !== "furniture",
        });
        return;
      }
      const key = armed?.libraryKey ?? defaultKeyFor(tool);
      if (!key) return;
      const li = libraryItem(key);
      if (!li) return;
      d.apply({
        op: "placeItem",
        levelId,
        libraryKey: key,
        at: p,
        snapToWall: !isIsland && li.kind !== "furniture" && li.kind !== "island",
        overrides: isIsland ? { kind: "island", tag: `ISL${Math.round(li.w)}` } : undefined,
      });
    },
    [ctx.catalog, d, levelId, view.armed],
  );

  const finishPoly = useCallback(
    (explicit?: Pt[]) => {
      const pts = explicit ?? poly;
      // Drop points under 1" from the previous one (a double-click's jitter).
      const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) >= 1);
      let ok = true;
      if (d.tool === "wall" && clean.length >= 2) {
        const kind = drawWallKind(view);
        const ops: PlanOp[] = [];
        for (let i = 0; i + 1 < clean.length; i++) ops.push({ op: "addWall", levelId, a: clean[i], b: clean[i + 1], kind, thickIn: d.defaults.wallThickIn });
        ok = d.apply(ops, { label: ops.length > 1 ? `Draw ${ops.length} walls` : "Draw wall" });
      } else if (d.tool === "counter" && clean.length >= 3) {
        ok = d.apply({ op: "addCounter", levelId, polygon: clean });
      }
      if (!ok) return; // keep the polyline so nothing drawn is lost
      setPoly([]);
      setFirst(null);
    },
    [d, levelId, poly, view],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        autoFit.current = true;
        fit();
      },
      focus(target) {
        let p: Pt | null = target.x != null && target.y != null ? { x: target.x, y: target.y } : null;
        if (!p && target.id) {
          const it = d.doc.items.find((i) => i.id === target.id);
          const w = d.doc.walls.find((x) => x.id === target.id);
          const r = d.doc.rooms.find((x) => x.id === target.id);
          const e = d.doc.electrical.find((x) => x.id === target.id);
          const o = d.doc.openings.find((x) => x.id === target.id);
          if (it) p = { x: it.x, y: it.y };
          else if (w) p = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
          else if (r) p = centroid(r.polygon);
          else if (e) p = { x: e.x, y: e.y };
          else if (o) {
            const ow = d.doc.walls.find((x) => x.id === o.wallId);
            if (ow) p = openingWorld(o, ow).centre;
          }
          const lvl =
            it?.levelId ?? w?.levelId ?? r?.levelId ?? e?.levelId ?? (o ? d.doc.walls.find((x) => x.id === o.wallId)?.levelId : undefined);
          if (lvl && lvl !== levelId) d.setLevelId(lvl);
        }
        if (!p) return;
        autoFit.current = false;
        setVp((v) => {
          const k = Math.max(v.k, 4);
          return { k, tx: size.w / 2 - p!.x * k, ty: size.h / 2 - p!.y * k };
        });
      },
      cancel() {
        setPoly([]);
        setFirst(null);
        setMeasure(null);
        d.cancelPreview();
        drag.current = { kind: "none" };
        if (view.paint) setView({ paint: null });
        if (view.underlayTool) setView({ underlayTool: null });
      },
      finish() {
        finishPoly();
      },
      zoom(factor) {
        zoomAt(factor, size.w / 2, size.h / 2);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, d, levelId, size, view.paint, view.underlayTool, zoomAt, poly],
  );

  const applyPaint = useCallback(
    (hit: Hit, p: Pt) => {
      const key = view.paint?.key;
      if (!key || !hit) return false;
      const mat = resolvePaint(key);
      if (hit.kind === "room") {
        d.apply({ op: "setFloorFinish", roomId: hit.id, material: mat });
        return true;
      }
      if (hit.kind === "wall") {
        const w = levelWalls.find((x) => x.id === hit.id)!;
        const side = projectOnWall(w, p).side >= 0 ? "left" : "right";
        d.apply({ op: "setWallFinish", wallId: w.id, side, material: mat });
        return true;
      }
      if (hit.kind === "counter") {
        d.apply({ op: "updateCounter", id: hit.id, patch: { material: mat } });
        return true;
      }
      if (hit.kind === "item") {
        const preset = finishPreset(key);
        d.apply({ op: "setItemProps", ids: [hit.id], props: { finish: key, finishColor: preset?.color ?? mat.color ?? "#e8e4dc" } });
        return true;
      }
      return false;
    },
    [d, levelWalls, view.paint, resolvePaint],
  );

  // ── pointer handlers ──
  /** The tool action for a press. Called straight from pointerdown, or on
   *  pointerup for a deferred touch tap (see onPointerDown). */
  const handleDown = useCallback(
    (e: PressInfo) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const raw = toPlan(e.clientX, e.clientY);
      const isPan = d.tool === "pan" || spaceDown.current || e.button === 1;
      if (isPan) {
        autoFit.current = false;
        drag.current = { kind: "pan", sx, sy, tx: vpRef.current.tx, ty: vpRef.current.ty };
        return;
      }
      if (e.button === 2) return;
      if (ctx.readOnly && d.tool !== "select" && d.tool !== "measure") return;

      // Underlay scale / move modes take over the pointer.
      const ut = view.underlayTool;
      if (ut && underlay?.id && !ctx.readOnly) {
        if (ut.mode === "calibrate") {
          setView({ underlayTool: { mode: "calibrate", pts: ut.pts.length >= 2 ? [raw] : [...ut.pts, raw] } });
        } else {
          drag.current = { kind: "underlay", id: underlay.id, start: raw, x: underlay.x, y: underlay.y, moved: false };
        }
        return;
      }

      const tool = d.tool;
      const hit = hitTest(raw);

      // Painting mode overrides the tool.
      if (view.paint && applyPaint(hit, raw)) return;

      switch (tool) {
        case "select": {
          // Wall endpoint handles when exactly one wall is selected.
          if (d.selected.length === 1) {
            const w = levelWalls.find((x) => x.id === d.selected[0]);
            if (w) {
              for (const end of [w.a, w.b]) {
                if (dist(end, raw) <= 8 / vp.k) {
                  // Snap against the walls that don't move with this corner.
                  const others = levelWalls.filter((x) => !samePt(x.a, end, 0.5) && !samePt(x.b, end, 0.5));
                  drag.current = { kind: "corner", from: end, cur: end, others };
                  return;
                }
              }
            }
          }
          if (hit?.kind === "opening") {
            const o = slice.openings.find((x) => x.id === hit.id)!;
            const w = levelWalls.find((x) => x.id === o.wallId);
            d.select([o.id]);
            // Keep the grab point under the pointer (no jump to centre on click).
            const grabIn = w ? projectOnWall(w, raw).t - o.atIn : o.widthIn / 2;
            drag.current = { kind: "opening", id: o.id, wallId: o.wallId, widthIn: o.widthIn, grabIn, startPx: { x: e.clientX, y: e.clientY }, moved: false };
            return;
          }
          if (hit && (hit.kind === "item" || hit.kind === "device" || hit.kind === "note" || hit.kind === "stair" || hit.kind === "structure" || hit.kind === "dim" || hit.kind === "camera" || hit.kind === "section" || hit.kind === "photo" || hit.kind === "counter" || hit.kind === "wall")) {
            const already = selectedSet.has(hit.id);
            let ids: string[];
            if (e.shiftKey) ids = already ? d.selected.filter((x) => x !== hit.id) : [...d.selected, hit.id];
            else ids = already ? d.selected : [hit.id];
            d.select(ids);
            const movable = ids.filter((id) => !d.doc.rooms.some((rm) => rm.id === id));
            const cabinets = d.doc.items.some((i) => movable.includes(i.id) && ["base", "wall", "tall", "vanity", "island"].includes(i.kind));
            drag.current = { kind: "move", ids: movable, start: raw, cur: raw, moved: false, cabinets };
            return;
          }
          if (hit?.kind === "room") {
            d.select(e.shiftKey ? [...d.selected, hit.id] : [hit.id]);
            drag.current = { kind: "marquee", start: raw, cur: raw };
            return;
          }
          if (!e.shiftKey) d.select([]);
          drag.current = { kind: "marquee", start: raw, cur: raw };
          return;
        }
        case "wall": {
          const tol = Math.max(0.5, 8 / vp.k); // 8 px
          // Clicking the starting point closes the loop (needs a real shape,
          // not A→B→A on top of itself).
          if (poly.length >= 3 && dist(raw, poly[0]) <= Math.max(2, 10 / vp.k)) {
            finishPoly([...poly, poly[0]]);
            return;
          }
          const s = snapped(raw, poly[poly.length - 1] ?? null);
          // A second click on the last point (or a double-click) finishes.
          if (poly.length && (dist(s.pt, poly[poly.length - 1]) <= tol || dist(raw, poly[poly.length - 1]) <= tol)) {
            finishPoly();
            return;
          }
          setPoly((p) => [...p, s.pt]);
          return;
        }
        case "counter": {
          if (poly.length >= 3 && dist(raw, poly[0]) <= Math.max(2, 10 / vp.k)) {
            finishPoly();
            return;
          }
          const s = snapped(raw, poly[poly.length - 1] ?? null);
          setPoly((p) => [...p, s.pt]);
          return;
        }
        case "room": {
          const s = snapped(raw);
          drag.current = { kind: "roomRect", start: s.pt, cur: s.pt };
          return;
        }
        case "door":
        case "window":
        case "opening": {
          const nw = nearestWall(raw, levelWalls, 14 / vp.k + 6);
          if (!nw) return;
          const width = tool === "door" ? d.defaults.doorWidthIn : tool === "window" ? d.defaults.windowWidthIn : 48;
          const atIn = openingAtFromPoint(nw.wall, raw, width);
          const swing = nw.side >= 0 ? "left" : "right";
          // A new wall only gets new openings; otherwise follow the draw kind.
          const phase = nw.wall.kind === "new" || drawWallKind(view) === "new" ? "new" : "existing";
          d.apply({ op: "addOpening", wallId: nw.wall.id, atIn, kind: tool, swing, phase });
          return;
        }
        case "stairs":
          d.apply({ op: "addStair", levelId, at: raw });
          return;
        case "column":
          d.apply({ op: "addStructure", levelId, kind: "column", a: snapped(raw).pt });
          return;
        case "beam":
        case "soffit":
        case "measure":
        case "dimension":
        case "section": {
          const s = snapped(raw, first);
          if (!first) {
            setFirst(s.pt);
            return;
          }
          const a = first;
          const b = s.pt;
          setFirst(null);
          if (tool === "measure") {
            setMeasure({ a, b });
          } else if (tool === "dimension") {
            d.apply({ op: "addDim", levelId, a, b, offsetIn: 12 });
          } else if (tool === "section") {
            d.apply({ op: "addSection", levelId, a, b });
          } else {
            d.apply({ op: "addStructure", levelId, kind: tool, a, b });
          }
          return;
        }
        case "base":
        case "wallcab":
        case "tall":
        case "island":
        case "filler":
        case "appliance":
        case "plumbing":
        case "furniture":
          placeArmed(raw);
          return;
        case "electrical":
        case "hvac": {
          const type: ElecType = view.armed?.elecType ?? (tool === "hvac" ? "register" : "outlet");
          const sym = ELEC_SYMBOLS.find((s) => s.type === type);
          let at = raw;
          let wallId: string | null = null;
          if (sym?.wallMounted) {
            const nw = nearestWall(raw, levelWalls, 18);
            if (nw) {
              const f = wallFrame(nw.wall);
              const foot = projectOnWall(nw.wall, raw).foot;
              const sideSign = nw.side >= 0 ? 1 : -1;
              at = { x: foot.x + f.left.x * sideSign * (nw.wall.thickIn / 2 + 1), y: foot.y + f.left.y * sideSign * (nw.wall.thickIn / 2 + 1) };
              wallId = nw.wall.id;
            }
          }
          d.apply({ op: "addDevice", levelId, type, at, wallId });
          return;
        }
        case "floorFinish": {
          const room = roomAt(raw);
          if (room) d.apply({ op: "setFloorFinish", roomId: room.id, material: resolvePaint(view.paint?.key ?? DEFAULT_FINISH_KEYS.floor) });
          return;
        }
        case "wallFinish": {
          const nw = nearestWall(raw, levelWalls, 14 / vp.k + 6);
          if (nw) d.apply({ op: "setWallFinish", wallId: nw.wall.id, side: nw.side >= 0 ? "left" : "right", material: resolvePaint(view.paint?.key ?? DEFAULT_FINISH_KEYS.wall) });
          return;
        }
        case "trim": {
          const room = roomAt(raw);
          if (room) d.apply({ op: "addTrim", levelId, roomId: room.id, profile: "base" });
          return;
        }
        case "note": {
          const text = window.prompt("Note");
          if (text) d.apply({ op: "addNote", levelId, at: raw, text });
          return;
        }
        case "comment": {
          const body = window.prompt("Comment");
          if (body) {
            void runAction(() => addPlanComment(ctx.design.id, { levelId, x: raw.x, y: raw.y, itemId: hit?.kind === "item" ? hit.id : null }, body)).then((r) => {
              if (r.ok) {
                router.refresh();
                setView({ panel: "comments" });
              }
            });
          }
          return;
        }
        case "photo": {
          pendingPhotoAt.current = raw;
          fileInput.current?.click();
          return;
        }
        case "camera": {
          const room = roomAt(raw);
          const target = room ? centroid(room.polygon) : { x: raw.x + 60, y: raw.y + 60 };
          d.apply({ op: "addCamera", levelId, name: `View ${d.doc.cameras.length + 1}`, pos: [raw.x, 66, raw.y], target: [target.x, 40, target.y] });
          return;
        }
        default:
          return;
      }
    },
    [d, ctx, hitTest, levelWalls, poly, first, view, snapped, placeArmed, finishPoly, applyPaint, roomAt, selectedSet, slice.openings, toPlan, vp.k, levelId, router, setView, resolvePaint, underlay],
  );
  /** A one-finger touch with a drawing tool waits for lift-off, so the first
   *  finger of a pinch never drops a cabinet or starts a wall. */
  const pendingTap = useRef<(PressInfo & { sx: number; sy: number }) | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = el.getBoundingClientRect();

      // Two fingers → pinch/pan.
      if (pointers.current.size === 2) {
        pendingTap.current = null;
        autoFit.current = false;
        const [a, b] = [...pointers.current.values()];
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        drag.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), k0: vpRef.current.k, cx: mid.x, cy: mid.y, tx0: vpRef.current.tx, ty0: vpRef.current.ty, mid0: mid };
        d.cancelPreview();
        return;
      }
      const info: PressInfo = { clientX: e.clientX, clientY: e.clientY, button: e.button, shiftKey: e.shiftKey, pointerId: e.pointerId };
      const tapTool = !(d.tool === "select" || d.tool === "pan" || d.tool === "room") || !!view.underlayTool;
      if (e.pointerType === "touch" && tapTool && !(view.underlayTool?.mode === "move")) {
        pendingTap.current = { ...info, sx: e.clientX, sy: e.clientY };
        return;
      }
      handleDown(info);
    },
    [d, handleDown, view.underlayTool],
  );
  const pendingPhotoAt = useRef<Pt | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const raw = toPlan(e.clientX, e.clientY);
      const cur = drag.current;
      const tap = pendingTap.current;
      if (tap && tap.pointerId === e.pointerId && Math.hypot(e.clientX - tap.sx, e.clientY - tap.sy) > 12) pendingTap.current = null;

      if (cur.kind === "pinch" && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        const k = Math.max(MIN_K, Math.min(MAX_K, (cur.k0 * dd) / Math.max(1, cur.d0)));
        const f = k / cur.k0;
        setVp({ k, tx: mid.x - (cur.mid0.x - cur.tx0) * f, ty: mid.y - (cur.mid0.y - cur.ty0) * f });
        return;
      }
      if (cur.kind === "pan") {
        setVp((v) => ({ ...v, tx: cur.tx + (sx - cur.sx), ty: cur.ty + (sy - cur.sy) }));
        return;
      }
      if (cur.kind === "move") {
        const dx = raw.x - cur.start.x;
        const dy = raw.y - cur.start.y;
        if (!cur.moved && Math.hypot(dx, dy) * vp.k < 3) return;
        cur.moved = true;
        cur.cur = raw;
        const step = view.snapOn ? d.doc.settings.snapIn : 0;
        const sdx = step ? Math.round(dx / step) * step : dx;
        const sdy = step ? Math.round(dy / step) * step : dy;
        d.preview({ op: "move", ids: cur.ids, dx: sdx, dy: sdy });
        pushCursor(raw, { hint: `Δ ${fmtIn(sdx)}, ${fmtIn(sdy)} · drop to snap` });
        return;
      }
      if (cur.kind === "corner") {
        const s = snapPoint(raw, cur.others, snapOpts(), null);
        cur.cur = s.pt;
        d.preview({ op: "moveCorner", levelId, from: cur.from, to: s.pt });
        setSnap(s);
        return;
      }
      if (cur.kind === "opening") {
        if (!cur.moved && Math.hypot(e.clientX - cur.startPx.x, e.clientY - cur.startPx.y) < 3) return;
        cur.moved = true;
        const w = levelWalls.find((x) => x.id === cur.wallId);
        if (!w) return;
        const atIn = slideOpening(w, raw, cur.widthIn, cur.grabIn, view.snapOn ? d.doc.settings.snapIn : 0);
        d.preview({ op: "updateOpening", id: cur.id, patch: { atIn } });
        pushCursor(raw, { hint: `at ${fmtIn(atIn)} from wall start` });
        return;
      }
      if (cur.kind === "underlay") {
        const s = snapped(raw);
        cur.moved = true;
        d.preview({ op: "updateUnderlay", id: cur.id, patch: { x: cur.x + s.pt.x - cur.start.x, y: cur.y + s.pt.y - cur.start.y } });
        setSnap(s);
        return;
      }
      if (cur.kind === "marquee" || cur.kind === "roomRect") {
        cur.cur = cur.kind === "roomRect" ? snapped(raw).pt : raw;
        setDragBox({ kind: cur.kind, start: cur.start, cur: cur.cur });
        if (cur.kind === "roomRect") {
          pushCursor(raw, { hint: `${fmtIn(Math.abs(cur.cur.x - cur.start.x))} × ${fmtIn(Math.abs(cur.cur.y - cur.start.y))}` });
        }
        return;
      }

      // Hover feedback per tool.
      setCursor(raw);
      if (view.underlayTool) {
        setSnap(null);
        setHoverWall(null);
        const ut = view.underlayTool;
        pushCursor(raw, {
          segment: ut.mode === "calibrate" && ut.pts.length === 1 ? { lengthIn: dist(ut.pts[0], raw), angleDeg: wallFrame({ a: ut.pts[0], b: raw }).angleDeg } : null,
          hint: ut.mode === "move" ? "Drag the plan · it snaps to wall ends · Esc when done" : ut.pts.length === 0 ? "Click one end of a length you know" : ut.pts.length === 1 ? "Click the other end" : "Type the real length",
        });
        return;
      }
      const tool = d.tool;
      if (tool === "wall" || tool === "counter" || TWO_CLICK_TOOLS.has(tool) || tool === "room" || tool === "column") {
        const anchor = tool === "wall" || tool === "counter" ? poly[poly.length - 1] ?? null : first;
        const s = snapped(raw, anchor);
        setSnap(s);
        const seg = anchor ? { lengthIn: dist(anchor, s.pt), angleDeg: wallFrame({ a: anchor, b: s.pt }).angleDeg } : null;
        pushCursor(s.pt, { segment: seg, snap: s.kind === "free" || s.kind === "grid" ? null : s.kind, hint: poly.length ? "Click to add · Enter or double-click to finish · Esc cancels" : null });
        setHoverWall(null);
        return;
      }
      if (tool === "door" || tool === "window" || tool === "opening" || tool === "wallFinish") {
        const nw = nearestWall(raw, levelWalls, 14 / vp.k + 6);
        setHoverWall(nw ? { wall: nw.wall, t: nw.t, side: nw.side } : null);
        setSnap(null);
        pushCursor(raw, { hint: nw ? `${fmtIn(nw.t)} along wall · click to place` : "Move over a wall" });
        return;
      }
      setSnap(null);
      setHoverWall(null);
      if (tool === "select") {
        const h = hitTest(raw);
        d.setHover(h ? h.id : null);
      }
      pushCursor(raw);
    },
    [d, hitTest, levelWalls, levelId, poly, first, pushCursor, snapped, snapOpts, toPlan, view.snapOn, view.underlayTool, vp.k],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId);
      const cur = drag.current;
      const raw = toPlan(e.clientX, e.clientY);
      drag.current = { kind: "none" };
      const tap = pendingTap.current;
      if (tap && tap.pointerId === e.pointerId) {
        pendingTap.current = null;
        if (e.type === "pointerup") handleDown(tap);
        return;
      }
      if (cur.kind === "pinch") return;
      if (cur.kind === "underlay") {
        if (cur.moved) {
          const s = snapped(raw);
          d.apply({ op: "updateUnderlay", id: cur.id, patch: { x: cur.x + s.pt.x - cur.start.x, y: cur.y + s.pt.y - cur.start.y } });
        } else d.cancelPreview();
        setSnap(null);
        return;
      }
      if (cur.kind === "move") {
        if (cur.moved) {
          const dx = raw.x - cur.start.x;
          const dy = raw.y - cur.start.y;
          const step = view.snapOn ? d.doc.settings.snapIn : 0;
          const sdx = step ? Math.round(dx / step) * step : dx;
          const sdy = step ? Math.round(dy / step) * step : dy;
          if (cur.cabinets && view.snapOn) {
            d.apply([{ op: "move", ids: cur.ids, dx: sdx, dy: sdy }, { op: "moveItems", ids: cur.ids, dx: 0, dy: 0, snapToWall: true }], { label: "Move" });
          } else d.apply({ op: "move", ids: cur.ids, dx: sdx, dy: sdy });
        } else d.cancelPreview();
        return;
      }
      if (cur.kind === "corner") {
        if (samePt(cur.cur, cur.from, 0.01)) d.cancelPreview();
        else d.apply({ op: "moveCorner", levelId, from: cur.from, to: cur.cur });
        setSnap(null);
        return;
      }
      if (cur.kind === "opening") {
        const w = levelWalls.find((x) => x.id === cur.wallId);
        if (w && cur.moved) d.apply({ op: "updateOpening", id: cur.id, patch: { atIn: slideOpening(w, raw, cur.widthIn, cur.grabIn, view.snapOn ? d.doc.settings.snapIn : 0) } });
        else d.cancelPreview();
        return;
      }
      if (cur.kind === "roomRect") {
        if (Math.abs(cur.cur.x - cur.start.x) >= 12 && Math.abs(cur.cur.y - cur.start.y) >= 12) {
          d.apply({ op: "addRoomRect", levelId, p: cur.start, q: cur.cur, kind: drawWallKind(view), thickIn: d.defaults.wallThickIn });
        }
        setDragBox(null);
        return;
      }
      if (cur.kind === "marquee") {
        const x0 = Math.min(cur.start.x, cur.cur.x), x1 = Math.max(cur.start.x, cur.cur.x);
        const y0 = Math.min(cur.start.y, cur.cur.y), y1 = Math.max(cur.start.y, cur.cur.y);
        if ((x1 - x0) * vp.k > 4 && (y1 - y0) * vp.k > 4) {
          const box = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
          const ids = marqueeIds(slice, levelWalls, box, { x0, y0, x1, y1 });
          d.select((prev) => (e.shiftKey ? [...new Set([...prev, ...ids])] : ids));
        }
        setDragBox(null);
      }
    },
    [d, handleDown, levelId, levelWalls, slice, snapped, toPlan, view, vp.k],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (d.tool === "wall" || d.tool === "counter") {
        finishPoly();
        return;
      }
      if (d.tool === "select") {
        const hit = hitTest(toPlan(e.clientX, e.clientY));
        if (hit) {
          d.select([hit.id]);
          setView({ panel: "properties" });
        }
      }
    },
    [d, finishPoly, hitTest, setView, toPlan],
  );

  // Wheel: pinch / ctrl+wheel and a mouse wheel zoom about the cursor; a
  // trackpad two-finger scroll pans. Native + non-passive so preventDefault
  // keeps the page from scrolling or zooming (React's onWheel is passive).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      // A wheel notch arrives as a large whole-number step with no x.
      const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const step = Math.max(-60, Math.min(60, dy));
        zoomAt(Math.exp(-step * (mouseWheel ? 0.004 : 0.01)), e.clientX - r.left, e.clientY - r.top);
      } else {
        autoFit.current = false;
        setVp((v) => ({ ...v, tx: v.tx - dx, ty: v.ty - dy }));
      }
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [zoomAt]);

  const onPhotoPicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const at = pendingPhotoAt.current;
      e.target.value = "";
      if (!file || !at) return;
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("kind", "photo");
      fd.append("label", file.name);
      const r = await runAction(() => uploadPlanCapture(ctx.design.id, fd));
      if (r.ok && "fileId" in r) {
        d.apply({ op: "addPhoto", levelId, at, fileId: r.fileId, caption: file.name });
        router.refresh();
      }
    },
    [ctx.design.id, d, levelId, router],
  );

  // ── overlays ──
  const { k, tx, ty } = vp;
  const visible = { x0: -tx / k, y0: -ty / k, x1: (size.w - tx) / k, y1: (size.h - ty) / k };
  const hair = 1 / k;
  const box = dragBox;
  const guides = cursor && (d.tool === "wall" || d.tool === "room") && view.snapOn ? alignmentGuides(snap?.pt ?? cursor, levelWalls, 2 / k) : [];
  const comments = ctx.comments.filter((c) => c.anchor.levelId === levelId && !c.resolvedAt);
  const selectedWall = d.selected.length === 1 ? levelWalls.find((w) => w.id === d.selected[0]) : null;
  const showUnderlay = view.layers.has("underlay");
  const gridMinor = k >= 2.5 ? 1 : k >= 1 ? 6 : 12;
  const gridMajor = 12 * (k >= 1 ? 1 : 4);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-paper-2 ${className}`}>
      <svg
        ref={svgRef}
        data-canvas="plan"
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ cursor: d.tool === "pan" ? "grab" : d.tool === "select" ? "default" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          cursorStore.clear();
          setCursor(null);
          setSnap(null);
          setHoverWall(null);
          d.setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="c2d-grid-minor" width={gridMinor} height={gridMinor} patternUnits="userSpaceOnUse">
            <path d={`M ${gridMinor} 0 L 0 0 0 ${gridMinor}`} fill="none" stroke="var(--rule)" strokeWidth={hair * 0.6} />
          </pattern>
          <pattern id="c2d-grid-major" width={gridMajor} height={gridMajor} patternUnits="userSpaceOnUse">
            <path d={`M ${gridMajor} 0 L 0 0 0 ${gridMajor}`} fill="none" stroke="var(--rule)" strokeWidth={hair * 1.2} />
          </pattern>
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          {view.showGrid && (
            <>
              <rect x={visible.x0} y={visible.y0} width={visible.x1 - visible.x0} height={visible.y1 - visible.y0} fill="url(#c2d-grid-minor)" opacity={0.5} />
              <rect x={visible.x0} y={visible.y0} width={visible.x1 - visible.x0} height={visible.y1 - visible.y0} fill="url(#c2d-grid-major)" opacity={0.7} />
            </>
          )}
          {showUnderlay && underlay && ulSize ? (
            <>
              {/* Room fills first, then the plan image, then walls and the rest
                  — so a traced room doesn't hide the plan under it. */}
              <DrawOpsSvg ops={opsBelow} pxPerIn={k} />
              <image
                href={`/api/files/${underlay.fileId}`}
                x={underlay.x}
                y={underlay.y}
                width={ulSize.w * underlay.scale}
                height={ulSize.h * underlay.scale}
                opacity={underlay.opacity}
                transform={`rotate(${underlay.rotDeg} ${underlay.x} ${underlay.y})`}
                preserveAspectRatio="none"
                style={{ pointerEvents: "none" }}
              />
              {view.underlayTool?.mode === "move" && (
                <polygon
                  points={underlayCorners(underlay, ulSize.w, ulSize.h).map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={hair * 2}
                  strokeDasharray={`${6 / k} ${4 / k}`}
                />
              )}
              <DrawOpsSvg ops={opsAbove} pxPerIn={k} />
            </>
          ) : (
            <DrawOpsSvg ops={ops} pxPerIn={k} />
          )}

          {/* underlay scale picks */}
          {view.underlayTool?.mode === "calibrate" && (() => {
            const pts = view.underlayTool.pts;
            const end = pts.length === 1 ? cursor : pts[1];
            return (
              <>
                {pts[0] && end && (
                  <line x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} stroke="var(--flag)" strokeWidth={hair * 2} />
                )}
                {pts.map((p, i) => (
                  <g key={i}>
                    <line x1={p.x - 8 / k} y1={p.y} x2={p.x + 8 / k} y2={p.y} stroke="var(--flag)" strokeWidth={hair * 1.5} />
                    <line x1={p.x} y1={p.y - 8 / k} x2={p.x} y2={p.y + 8 / k} stroke="var(--flag)" strokeWidth={hair * 1.5} />
                    <circle cx={p.x} cy={p.y} r={3 / k} fill="none" stroke="var(--flag)" strokeWidth={hair * 1.5} />
                  </g>
                ))}
              </>
            );
          })()}

          {/* wall endpoint handles */}
          {selectedWall && d.tool === "select" &&
            [selectedWall.a, selectedWall.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 / k} fill="var(--paper)" stroke="var(--accent)" strokeWidth={hair * 1.5} />
            ))}

          {/* polyline in progress */}
          {poly.length > 0 && (
            <>
              <polyline points={[...poly, snap?.pt ?? cursor ?? poly[poly.length - 1]].map((p) => `${p.x},${p.y}`).join(" ")} fill={d.tool === "counter" ? "rgba(196,106,59,0.12)" : "none"} stroke="var(--accent)" strokeWidth={d.tool === "wall" ? d.defaults.wallThickIn : hair * 1.5} strokeOpacity={0.6} strokeLinecap="round" strokeLinejoin="round" />
              {poly.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3 / k} fill="var(--accent)" />
              ))}
              {cursor && (
                <text x={(snap?.pt ?? cursor).x + 6 / k} y={(snap?.pt ?? cursor).y - 6 / k} fontSize={11 / k} fontFamily="ui-monospace, monospace" fill="var(--accent-2)">
                  {fmtIn(dist(poly[poly.length - 1], snap?.pt ?? cursor))}
                </text>
              )}
            </>
          )}
          {/* two-click preview */}
          {first && cursor && (
            <>
              <line x1={first.x} y1={first.y} x2={(snap?.pt ?? cursor).x} y2={(snap?.pt ?? cursor).y} stroke="var(--accent)" strokeWidth={hair * 1.5} strokeDasharray={`${4 / k} ${3 / k}`} />
              <text x={(first.x + (snap?.pt ?? cursor).x) / 2} y={(first.y + (snap?.pt ?? cursor).y) / 2 - 6 / k} fontSize={11 / k} textAnchor="middle" fontFamily="ui-monospace, monospace" fill="var(--accent-2)">
                {fmtIn(dist(first, snap?.pt ?? cursor))}
              </text>
            </>
          )}
          {measure && (
            <>
              <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="var(--info)" strokeWidth={hair * 1.5} />
              <rect x={(measure.a.x + measure.b.x) / 2 - 30 / k} y={(measure.a.y + measure.b.y) / 2 - 18 / k} width={60 / k} height={14 / k} fill="var(--paper)" stroke="var(--info)" strokeWidth={hair} rx={2 / k} />
              <text x={(measure.a.x + measure.b.x) / 2} y={(measure.a.y + measure.b.y) / 2 - 7 / k} fontSize={10 / k} textAnchor="middle" fontFamily="ui-monospace, monospace" fill="var(--ink)">
                {fmtIn(dist(measure.a, measure.b))}
              </text>
            </>
          )}
          {/* snap marker + guides */}
          {snap && snap.kind !== "free" && snap.kind !== "grid" && (
            <circle cx={snap.pt.x} cy={snap.pt.y} r={4 / k} fill="none" stroke="var(--money)" strokeWidth={hair * 1.5} />
          )}
          {snap?.guide && <line x1={snap.guide.a.x} y1={snap.guide.a.y} x2={snap.guide.b.x} y2={snap.guide.b.y} stroke="var(--money)" strokeWidth={hair} strokeDasharray={`${3 / k} ${3 / k}`} opacity={0.6} />}
          {guides.slice(0, 4).map((g, i) => (
            <line key={i} x1={g.from.x} y1={g.from.y} x2={g.pt.x} y2={g.pt.y} stroke="var(--info)" strokeWidth={hair} strokeDasharray={`${2 / k} ${2 / k}`} opacity={0.7} />
          ))}
          {/* hovered wall for opening tools */}
          {hoverWall && (
            <>
              <line x1={hoverWall.wall.a.x} y1={hoverWall.wall.a.y} x2={hoverWall.wall.b.x} y2={hoverWall.wall.b.y} stroke="var(--accent)" strokeWidth={hoverWall.wall.thickIn} strokeOpacity={0.25} />
              {(d.tool === "door" || d.tool === "window" || d.tool === "opening") && (() => {
                const width = d.tool === "door" ? d.defaults.doorWidthIn : d.tool === "window" ? d.defaults.windowWidthIn : 48;
                const f = wallFrame(hoverWall.wall);
                const at = Math.max(0, Math.min(f.length - width, hoverWall.t - width / 2));
                const a = { x: hoverWall.wall.a.x + f.dir.x * at, y: hoverWall.wall.a.y + f.dir.y * at };
                const b = { x: a.x + f.dir.x * width, y: a.y + f.dir.y * width };
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={hoverWall.wall.thickIn + 2 / k} strokeOpacity={0.8} />;
              })()}
            </>
          )}
          {/* marquee / room rect */}
          {box && (
            <rect
              x={Math.min(box.start.x, box.cur.x)}
              y={Math.min(box.start.y, box.cur.y)}
              width={Math.abs(box.cur.x - box.start.x)}
              height={Math.abs(box.cur.y - box.start.y)}
              fill={box.kind === "roomRect" ? "rgba(47,107,58,0.08)" : "rgba(196,106,59,0.08)"}
              stroke={box.kind === "roomRect" ? "var(--money)" : "var(--accent)"}
              strokeWidth={box.kind === "roomRect" ? d.defaults.wallThickIn : hair}
              strokeDasharray={box.kind === "roomRect" ? undefined : `${4 / k} ${3 / k}`}
            />
          )}
          {/* comment pins */}
          {view.layers.has("comments") &&
            comments.map((c, i) => (
              <g
                key={c.id}
                transform={`translate(${c.anchor.x} ${c.anchor.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setView({ panel: "comments" });
                }}
                style={{ cursor: "pointer" }}
              >
                <circle r={7 / k} fill={c.authorRole === "client" ? "var(--accent)" : "var(--ink)"} stroke="var(--paper)" strokeWidth={hair * 1.5} />
                <text y={3.5 / k} fontSize={9 / k} textAnchor="middle" fontFamily="ui-monospace, monospace" fill="var(--paper)">
                  {i + 1}
                </text>
              </g>
            ))}
        </g>
      </svg>

      {/* underlay scale / move */}
      {view.underlayTool && underlay && (
        <UnderlayToolCard
          tool={view.underlayTool}
          onCancel={() => setView({ underlayTool: null })}
          onRestart={() => setView({ underlayTool: { mode: "calibrate", pts: [] } })}
          onApply={(realIn, straighten) => {
            const t = view.underlayTool;
            if (!t || t.mode !== "calibrate" || t.pts.length < 2 || !underlay.id) return false;
            const next = calibrateUnderlay(underlay, t.pts[0], t.pts[1], realIn, straighten);
            if (!next) return false;
            const ok = d.apply({ op: "updateUnderlay", id: underlay.id, patch: { ...next, calibrated: true } }, { label: "Scale underlay" });
            if (ok) setView({ underlayTool: null });
            return ok;
          }}
        />
      )}

      {/* what the Wall / Room / Door tools draw */}
      {!view.underlayTool && !ctx.readOnly && (d.tool === "wall" || d.tool === "room" || d.tool === "door" || d.tool === "window" || d.tool === "opening") && (
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-full border border-rule bg-paper px-1.5 py-1 text-[11px] text-ink-2 shadow-sm">
          <span className="pl-1">Draw</span>
          <div className="flex overflow-hidden rounded-full border border-rule">
            {(["existing", "new"] as const).map((kd) => (
              <button
                key={kd}
                type="button"
                onClick={() => setView({ wallKind: kd })}
                className={`px-2 py-0.5 capitalize ${drawWallKind(view) === kd ? (kd === "new" ? "bg-[#2f6b3a] text-paper" : "bg-ink text-paper") : "bg-card text-ink-2 hover:bg-paper-2"}`}
              >
                {kd}
              </button>
            ))}
          </div>
          {(d.tool === "wall" || d.tool === "room") && (
            <label className="flex items-center gap-1 pr-1">
              walls
              <select
                value={String(d.defaults.wallThickIn)}
                onChange={(e) => d.apply({ op: "setSettings", patch: { defaults: { wallThickIn: Number(e.target.value) } } }, { transient: true })}
                className="rounded border border-rule bg-card px-1 py-0 font-mono text-[10.5px]"
                title="Wall thickness for new walls"
              >
                {[...new Set([3.5, 4.5, 5.5, 6.5, 8, 12, d.defaults.wallThickIn])].sort((a, b) => a - b).map((t) => (
                  <option key={t} value={String(t)}>
                    {fmtIn(t)}
                  </option>
                ))}
              </select>
              thick
            </label>
          )}
          {underlay && d.tool === "wall" && <span className="pr-1 text-ink-3">· click the plan&apos;s corners to trace</span>}
        </div>
      )}

      {/* armed / paint chips */}
      {(PLACE_TOOLS.has(d.tool) || d.tool === "electrical" || d.tool === "hvac" || view.paint) && (
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {view.paint && (
            <span className="pointer-events-auto rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[11px] text-accent-2">
              Painting <strong>{view.paint.key}</strong> · click a room, wall, counter or cabinet ·{" "}
              <button className="underline" onClick={() => setView({ paint: null })}>stop</button>
            </span>
          )}
          {PLACE_TOOLS.has(d.tool) && (
            <span className="pointer-events-auto rounded-full border border-rule bg-paper px-2.5 py-1 text-[11px] text-ink-2">
              Placing{" "}
              <strong>
                {view.armed?.catalogId
                  ? ctx.catalog.find((c) => c.id === view.armed?.catalogId)?.name ?? "catalog item"
                  : libraryItem(view.armed?.libraryKey ?? defaultKeyFor(d.tool) ?? "")?.label ?? "—"}
              </strong>{" "}
              ·{" "}
              <button className="underline" onClick={() => setView({ panel: "catalog" })}>
                change
              </button>
            </span>
          )}
          {(d.tool === "electrical" || d.tool === "hvac") && (
            <div className="pointer-events-auto flex max-w-[70vw] flex-wrap gap-1 rounded-md border border-rule bg-paper p-1">
              {ELEC_SYMBOLS.filter((s) => (d.tool === "hvac" ? s.group === "hvac" : s.group !== "hvac")).map((s) => {
                const active = (view.armed?.elecType ?? (d.tool === "hvac" ? "register" : "outlet")) === s.type;
                return (
                  <button
                    key={s.type}
                    onClick={() => setView({ armed: { elecType: s.type } })}
                    className={["rounded px-1.5 py-0.5 text-[10.5px]", active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"].join(" ")}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ScaleControl
        k={vp.k}
        onScale={(kk) => {
          autoFit.current = false;
          setVp((v) => {
            const f = kk / v.k;
            return { k: kk, tx: size.w / 2 - (size.w / 2 - v.tx) * f, ty: size.h / 2 - (size.h / 2 - v.ty) * f };
          });
        }}
        onFit={() => {
          autoFit.current = true;
          fit();
        }}
      />

      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />
    </div>
  );
});

// ─── scale bar + zoom-to-scale ───────────────────────────────────────────────

/** CSS px per inch on screen (the CSS inch; real monitors vary a little). */
const CSS_PX_PER_IN = 96;
const SCALES: { label: string; inPerFt: number }[] = [
  { label: '1/8" = 1\'-0"', inPerFt: 1 / 8 },
  { label: '1/4" = 1\'-0"', inPerFt: 1 / 4 },
  { label: '1/2" = 1\'-0"', inPerFt: 1 / 2 },
  { label: '1" = 1\'-0"', inPerFt: 1 },
];
const BAR_STEPS_IN = [1, 3, 6, 12, 24, 48, 60, 120, 240, 480, 600, 1200];

/** Canvas px per plan inch for a drawing scale (e.g. 1/4" = 1'-0" → 2). */
export function kForScale(inPerFt: number): number {
  return (inPerFt * CSS_PX_PER_IN) / 12;
}

/** Bottom-right scale bar (always true to the drawing, whatever the zoom)
 *  plus a menu to jump to a standard drawing scale or fit. */
function ScaleControl({ k, onScale, onFit }: { k: number; onScale: (k: number) => void; onFit: () => void }) {
  const [open, setOpen] = useState(false);
  const barIn = BAR_STEPS_IN.find((s) => s * k >= 70) ?? BAR_STEPS_IN[BAR_STEPS_IN.length - 1];
  const barPx = barIn * k;
  const current = SCALES.find((s) => Math.abs(kForScale(s.inPerFt) - k) / k < 0.02);
  return (
    <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
      {open && (
        <div className="flex flex-col rounded-md border border-rule bg-card p-1 text-[11px] shadow-lg">
          {SCALES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`rounded px-2 py-0.5 text-left ${current === s ? "bg-ink text-paper" : "text-ink hover:bg-paper-2"}`}
              onClick={() => {
                onScale(kForScale(s.inPerFt));
                setOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="rounded px-2 py-0.5 text-left text-ink hover:bg-paper-2" onClick={() => { onFit(); setOpen(false); }}>
            Fit to screen
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Drawing scale — click for 1/8", 1/4", 1/2" or 1" = 1'-0"`}
        className="flex items-end gap-2 rounded bg-paper/85 px-1.5 py-1 font-mono text-[9.5px] text-ink-3 hover:bg-paper"
      >
        <span className="flex flex-col items-start">
          <span className="leading-none text-ink-2">{fmtIn(barIn)}</span>
          <svg width={barPx + 2} height={7} className="mt-0.5 block">
            <path d={`M1 0 V6 H${barPx + 1} V0`} fill="none" stroke="currentColor" strokeWidth={1.25} />
          </svg>
        </span>
        <span>{current ? current.label : `≈ ${fmtScale((k * 12) / CSS_PX_PER_IN)}`}</span>
      </button>
    </div>
  );
}

/** 0.25 → 1/4" = 1'-0" (nearest 1/32"); ≥ 1 → 1.5" = 1'-0". */
function fmtScale(inPerFt: number): string {
  if (inPerFt >= 1) return `${Math.round(inPerFt * 10) / 10}" = 1'-0"`;
  let n = Math.max(1, Math.round(inPerFt * 32));
  let dd = 32;
  while (n % 2 === 0 && dd > 1) {
    n /= 2;
    dd /= 2;
  }
  return `${n}/${dd}" = 1'-0"`;
}

/** Where an opening lands when slid along its wall with the pointer, keeping
 *  the spot it was grabbed at under the pointer; snapped to the grid step. */
function slideOpening(w: Wall, p: Pt, widthIn: number, grabIn: number, stepIn: number): number {
  const len = wallFrame(w).length;
  let at = projectOnWall(w, p).t - grabIn;
  if (stepIn > 0) at = Math.round(at / stepIn) * stepIn;
  return Math.max(0, Math.min(Math.max(0, len - widthIn), at));
}

/** Everything on the level a marquee box touches. */
function marqueeIds(
  slice: ReturnType<typeof levelSlice>,
  walls: Wall[],
  box: Pt[],
  b: { x0: number; y0: number; x1: number; y1: number },
): string[] {
  const inBox = (p: Pt) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  const ids: string[] = [];
  for (const it of slice.items) if (rectsOverlap(itemCorners(it), box)) ids.push(it.id);
  for (const w of walls) if (inBox(w.a) || inBox(w.b)) ids.push(w.id);
  for (const o of slice.openings) {
    const w = walls.find((x) => x.id === o.wallId);
    if (w && inBox(openingWorld(o, w).centre)) ids.push(o.id);
  }
  for (const el of slice.electrical) if (inBox(el)) ids.push(el.id);
  for (const n of slice.notes) if (inBox(n)) ids.push(n.id);
  for (const ph of slice.photos) if (inBox(ph)) ids.push(ph.id);
  for (const dm of slice.dims) if (inBox(dm.a) && inBox(dm.b)) ids.push(dm.id);
  for (const st of slice.structure) if (inBox(st.a) && (!st.b || inBox(st.b))) ids.push(st.id);
  for (const st of slice.stairs) if (inBox(st)) ids.push(st.id);
  for (const c of slice.counters) if (!c.runId && c.polygon.every(inBox)) ids.push(c.id);
  for (const sc of slice.sections) if (inBox(sc.a) && inBox(sc.b)) ids.push(sc.id);
  for (const cam of slice.cameras) if (inBox({ x: cam.pos[0], y: cam.pos[2] })) ids.push(cam.id);
  return ids;
}

/** Floating card for the underlay modes: pick two points, type the real
 *  length (optionally straighten the sheet to that line); or drag to move. */
function UnderlayToolCard({
  tool,
  onApply,
  onCancel,
  onRestart,
}: {
  tool: { mode: "calibrate"; pts: Pt[] } | { mode: "move" };
  onApply: (realIn: number, straighten: boolean) => boolean;
  onCancel: () => void;
  onRestart: () => void;
}) {
  const [text, setText] = useState("");
  const [straighten, setStraighten] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = tool.mode === "calibrate" && tool.pts.length >= 2;
  const btn = "rounded-md border border-rule bg-card px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-paper-2";
  return (
    <div className="absolute left-1/2 top-3 z-20 w-[min(440px,calc(100%-24px))] -translate-x-1/2 rounded-lg border border-ink/20 bg-paper p-3 text-[12px] text-ink shadow-xl">
      {tool.mode === "move" ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="font-semibold">Move the plan</div>
            <div className="text-ink-3">Drag it into place. The spot you grab snaps to wall ends and corners.</div>
          </div>
          <button type="button" className={btn} onClick={onCancel}>
            Done
          </button>
        </div>
      ) : !ready ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="font-semibold">Set the plan&apos;s scale</div>
            <div className="text-ink-3">
              {tool.pts.length === 0
                ? "Click one end of a length you know — a dimension string or a wall marked on the plan. Zoom in for accuracy."
                : "Now click the other end."}
            </div>
          </div>
          <button type="button" className={btn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseIn(text);
            if (n == null || !(n > 0)) {
              setErr(`Type the real length, e.g. 12' 6" or 150.`);
              return;
            }
            if (!onApply(n, straighten)) setErr("Those two points are too close — pick them again.");
          }}
        >
          <div className="font-semibold">How long is that line in real life?</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setErr(null);
              }}
              placeholder={`e.g. 12' 6"`}
              className="w-32 rounded-md border border-rule bg-card px-2 py-1 font-mono text-[12px] focus:border-ink focus:outline-none"
            />
            <button type="submit" className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-paper">
              Set scale
            </button>
            <button type="button" className={btn} onClick={onRestart}>
              Pick again
            </button>
            <button type="button" className={btn} onClick={onCancel}>
              Cancel
            </button>
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-ink-2">
            <input type="checkbox" checked={straighten} onChange={(e) => setStraighten(e.target.checked)} />
            Also straighten the plan so this line is level / plumb
          </label>
          {err && <div className="mt-1 text-[11px] text-flag">{err}</div>}
        </form>
      )}
    </div>
  );
}
