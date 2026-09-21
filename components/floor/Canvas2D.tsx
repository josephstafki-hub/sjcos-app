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
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  dist,
  fmtIn,
  levelSlice,
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
  wallFrame,
  type SnapResult,
} from "@/lib/plan-geometry";
import { planOps } from "@/lib/plan-draw";
import type { DrawOp } from "@/lib/plan-draw-types";
import { DrawOpsSvg } from "./DrawOps";
import { DEFAULT_FINISH_KEYS, ELEC_SYMBOLS, LIBRARY, finishPreset, finishRef, libraryItem, searchLibrary } from "@/lib/plan-library";
import { openingAtFromPoint, type PlanOp } from "@/lib/plan-ops";
import { runAction } from "@/lib/run-action";
import { addPlanComment } from "@/lib/actions/plan-comments";
import { uploadPlanCapture } from "@/lib/actions/plan-files";
import type { ToolId } from "./useDesigner";
import type { DesignerContext } from "./view-state";
import { cursorStore, type CursorInfo } from "./StatusBar";

export interface Canvas2DHandle {
  fit(): void;
  focus(target: { id?: string; x?: number; y?: number }): void;
  cancel(): void;
  finish(): void;
  zoom(factor: number): void;
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
  | { kind: "corner"; from: Pt; cur: Pt }
  | { kind: "opening"; id: string; wallId: string; widthIn: number }
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
  vpRef.current = vp;
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<Drag>({ kind: "none" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [dragView, setDragView] = useState(0); // bump to re-render overlays during drags
  const [poly, setPoly] = useState<Pt[]>([]); // wall / counter polyline in progress
  const [first, setFirst] = useState<Pt | null>(null); // two-click tools
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [hoverWall, setHoverWall] = useState<{ wall: Wall; t: number; side: number } | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt } | null>(null);
  const [underlaySize, setUnderlaySize] = useState<{ w: number; h: number } | null>(null);
  const spaceDown = useRef(false);
  const fittedFor = useRef<string | null>(null);

  const levelId = d.levelId;
  const slice = useMemo(() => levelSlice(d.doc, levelId), [d.doc, levelId]);
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
    const b = levelBounds(d.doc, levelId) ?? { min: { x: 0, y: 0 }, max: { x: 240, y: 180 } };
    const w = Math.max(24, b.max.x - b.min.x);
    const h = Math.max(24, b.max.y - b.min.y);
    const pad = 48;
    const k = Math.max(MIN_K, Math.min(MAX_K, Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h)));
    const tx = (size.w - w * k) / 2 - b.min.x * k;
    const ty = (size.h - h * k) / 2 - b.min.y * k;
    setVp({ k, tx, ty });
  }, [d.doc, levelId, size.h, size.w]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setVp((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
      const f = k / v.k;
      return { k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fit,
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
      },
      finish() {
        finishPoly();
      },
      zoom(factor) {
        zoomAt(factor, size.w / 2, size.h / 2);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, d, levelId, size, view.paint, zoomAt, poly],
  );

  // Size observer + first fit.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = `${ctx.design.id}:${levelId}`;
    if (fittedFor.current !== key && size.w > 50) {
      fittedFor.current = key;
      fit();
    }
  }, [ctx.design.id, levelId, size.w, fit]);

  // Reset transient tool state when the tool changes.
  useEffect(() => {
    setPoly([]);
    setFirst(null);
    setMeasure(null);
  }, [d.tool]);

  // Underlay natural size.
  useEffect(() => {
    const u = d.doc.underlay;
    if (!u) {
      setUnderlaySize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setUnderlaySize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `/api/files/${u.fileId}`;
  }, [d.doc.underlay]);

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
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
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
      for (const s of [...slice.stairs].reverse()) {
        const len = s.riserCount * s.treadIn;
        if (pointInItem(p, { x: s.x, y: s.y, w: s.widthIn, d: len, rotDeg: s.rotDeg })) return { id: s.id, kind: "stair" };
      }
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

  const finishPoly = useCallback(() => {
    if (d.tool === "wall" && poly.length >= 2) {
      const ops: PlanOp[] = [];
      for (let i = 0; i + 1 < poly.length; i++) ops.push({ op: "addWall", levelId, a: poly[i], b: poly[i + 1], kind: view.phase === "existing" ? "existing" : "new" });
      d.apply(ops, { label: ops.length > 1 ? `Draw ${ops.length} walls` : "Draw wall" });
    } else if (d.tool === "counter" && poly.length >= 3) {
      d.apply({ op: "addCounter", levelId, polygon: poly });
    }
    setPoly([]);
    setFirst(null);
  }, [d, levelId, poly, view.phase]);

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
  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;

      // Two fingers → pinch/pan.
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        drag.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), k0: vpRef.current.k, cx: mid.x, cy: mid.y, tx0: vpRef.current.tx, ty0: vpRef.current.ty, mid0: mid };
        d.cancelPreview();
        return;
      }

      const raw = toPlan(e.clientX, e.clientY);
      const isPan = d.tool === "pan" || spaceDown.current || e.button === 1;
      if (isPan) {
        drag.current = { kind: "pan", sx, sy, tx: vpRef.current.tx, ty: vpRef.current.ty };
        return;
      }
      if (e.button === 2) return;
      if (ctx.readOnly && d.tool !== "select" && d.tool !== "measure") return;

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
                  drag.current = { kind: "corner", from: end, cur: end };
                  return;
                }
              }
            }
          }
          if (hit?.kind === "opening") {
            const o = slice.openings.find((x) => x.id === hit.id)!;
            d.select([o.id]);
            drag.current = { kind: "opening", id: o.id, wallId: o.wallId, widthIn: o.widthIn };
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
          const s = snapped(raw, poly[poly.length - 1] ?? null);
          if (poly.length && samePt(s.pt, poly[poly.length - 1], 0.5)) {
            finishPoly();
            return;
          }
          // Clicking the starting point closes the loop.
          if (poly.length >= 2 && samePt(s.pt, poly[0], 2)) {
            setPoly((p) => [...p, poly[0]]);
            setTimeout(() => finishPolyRef.current(), 0);
            return;
          }
          setPoly((p) => [...p, s.pt]);
          return;
        }
        case "counter": {
          const s = snapped(raw, poly[poly.length - 1] ?? null);
          if (poly.length >= 3 && samePt(s.pt, poly[0], 2)) {
            finishPoly();
            return;
          }
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
          d.apply({ op: "addOpening", wallId: nw.wall.id, atIn, kind: tool, swing, phase: view.phase === "existing" ? "existing" : "new" });
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
    [d, ctx, hitTest, levelWalls, poly, first, view, snapped, placeArmed, finishPoly, applyPaint, roomAt, selectedSet, slice.openings, toPlan, vp.k, levelId, router, setView, resolvePaint],
  );
  const finishPolyRef = useRef(finishPoly);
  finishPolyRef.current = finishPoly;
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
        const s = snapped(raw);
        cur.cur = s.pt;
        d.preview({ op: "moveCorner", levelId, from: cur.from, to: s.pt });
        setSnap(s);
        return;
      }
      if (cur.kind === "opening") {
        const w = levelWalls.find((x) => x.id === cur.wallId);
        if (!w) return;
        const atIn = openingAtFromPoint(w, raw, cur.widthIn);
        d.preview({ op: "updateOpening", id: cur.id, patch: { atIn } });
        pushCursor(raw, { hint: `at ${fmtIn(atIn)} from wall start` });
        return;
      }
      if (cur.kind === "marquee" || cur.kind === "roomRect") {
        cur.cur = cur.kind === "roomRect" ? snapped(raw).pt : raw;
        setDragView((v) => v + 1);
        if (cur.kind === "roomRect") {
          pushCursor(raw, { hint: `${fmtIn(Math.abs(cur.cur.x - cur.start.x))} × ${fmtIn(Math.abs(cur.cur.y - cur.start.y))}` });
        }
        return;
      }

      // Hover feedback per tool.
      setCursor(raw);
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
    [d, hitTest, levelWalls, levelId, poly, first, pushCursor, snapped, toPlan, view.snapOn, vp.k],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId);
      const cur = drag.current;
      const raw = toPlan(e.clientX, e.clientY);
      drag.current = { kind: "none" };
      if (cur.kind === "pinch") return;
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
        d.apply({ op: "moveCorner", levelId, from: cur.from, to: cur.cur });
        setSnap(null);
        return;
      }
      if (cur.kind === "opening") {
        const w = levelWalls.find((x) => x.id === cur.wallId);
        if (w) d.apply({ op: "updateOpening", id: cur.id, patch: { atIn: openingAtFromPoint(w, raw, cur.widthIn) } });
        else d.cancelPreview();
        return;
      }
      if (cur.kind === "roomRect") {
        if (Math.abs(cur.cur.x - cur.start.x) >= 12 && Math.abs(cur.cur.y - cur.start.y) >= 12) {
          d.apply({ op: "addRoomRect", levelId, p: cur.start, q: cur.cur, kind: view.phase === "new" ? "new" : "existing" });
        }
        setDragView((v) => v + 1);
        return;
      }
      if (cur.kind === "marquee") {
        const x0 = Math.min(cur.start.x, cur.cur.x), x1 = Math.max(cur.start.x, cur.cur.x);
        const y0 = Math.min(cur.start.y, cur.cur.y), y1 = Math.max(cur.start.y, cur.cur.y);
        if (x1 - x0 > 2 && y1 - y0 > 2) {
          const box = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
          const ids: string[] = [];
          for (const it of slice.items) if (rectsOverlap(itemCorners(it), box)) ids.push(it.id);
          for (const w of levelWalls) if ((w.a.x >= x0 && w.a.x <= x1 && w.a.y >= y0 && w.a.y <= y1) || (w.b.x >= x0 && w.b.x <= x1 && w.b.y >= y0 && w.b.y <= y1)) ids.push(w.id);
          for (const el of slice.electrical) if (el.x >= x0 && el.x <= x1 && el.y >= y0 && el.y <= y1) ids.push(el.id);
          for (const n of slice.notes) if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) ids.push(n.id);
          d.select((prev) => (e.shiftKey ? [...new Set([...prev, ...ids])] : ids));
        }
        setDragView((v) => v + 1);
      }
    },
    [d, levelId, levelWalls, slice, toPlan, view.phase, view.snapOn],
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

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        setVp((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
      }
    },
    [zoomAt],
  );
  // Non-passive wheel listener so ctrl+wheel doesn't zoom the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

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
  const cur = drag.current;
  void dragView;
  const guides = cursor && (d.tool === "wall" || d.tool === "room") && view.snapOn ? alignmentGuides(snap?.pt ?? cursor, levelWalls, 2 / k) : [];
  const comments = ctx.comments.filter((c) => c.anchor.levelId === levelId && !c.resolvedAt);
  const selectedWall = d.selected.length === 1 ? levelWalls.find((w) => w.id === d.selected[0]) : null;
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
        onWheel={onWheel}
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
          {d.doc.underlay && underlaySize && view.layers.has("underlay") && (
            <image
              href={`/api/files/${d.doc.underlay.fileId}`}
              x={d.doc.underlay.x}
              y={d.doc.underlay.y}
              width={underlaySize.w * d.doc.underlay.scale}
              height={underlaySize.h * d.doc.underlay.scale}
              opacity={d.doc.underlay.opacity}
              transform={`rotate(${d.doc.underlay.rotDeg} ${d.doc.underlay.x} ${d.doc.underlay.y})`}
              preserveAspectRatio="none"
            />
          )}
          <DrawOpsSvg ops={ops} pxPerIn={k} />

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
          {(cur.kind === "marquee" || cur.kind === "roomRect") && (
            <rect
              x={Math.min(cur.start.x, cur.cur.x)}
              y={Math.min(cur.start.y, cur.cur.y)}
              width={Math.abs(cur.cur.x - cur.start.x)}
              height={Math.abs(cur.cur.y - cur.start.y)}
              fill={cur.kind === "roomRect" ? "rgba(47,107,58,0.08)" : "rgba(196,106,59,0.08)"}
              stroke={cur.kind === "roomRect" ? "var(--money)" : "var(--accent)"}
              strokeWidth={cur.kind === "roomRect" ? d.defaults.wallThickIn : hair}
              strokeDasharray={cur.kind === "roomRect" ? undefined : `${4 / k} ${3 / k}`}
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

      {/* zoom readout */}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-paper/80 px-1.5 py-0.5 font-mono text-[9px] text-ink-3">
        {Math.round((vp.k / 3) * 100)}% · {vp.k >= 6 ? '1/2"' : vp.k >= 3 ? '1/4"' : vp.k >= 1.5 ? '1/8"' : '1/16"'} scale
      </div>

      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />
    </div>
  );
});
