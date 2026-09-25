// Plan → DrawOp[]: the 2D drafting layer of the floor-plan designer
// (docs/floor-plan-designer-plan.md §3, §5, §6, §8). Pure and client-safe:
// this module knows nothing about React or SVG; components/floor/DrawOps.tsx
// renders the ops on screen and the print path renders the same ops to PDF.
//
// Conventions: inches, y down. PlacedItem (x, y) is the footprint centre, w
// runs along the item's local x, d along local y, rotDeg is clockwise on
// screen, and at rotDeg 0 the FRONT faces +y. A wall's "left" face is
// wallFrame(w).left. Rect ops with `rotDeg` rotate about the rect's centre.
// Arc ops sweep from startDeg to endDeg in the increasing-angle direction,
// which is clockwise on screen (0° = +x, 90° = +y).

import {
  dist,
  fmtIn,
  levelSlice,
  pointInPolygon,
  type Device,
  type ElecType,
  type PlacedItem,
  type PlanDoc,
  type Pt,
  type Room,
  type Wall,
} from "./plan-doc.ts";
import {
  add,
  alongWall,
  centroid,
  cross,
  dot,
  itemCorners,
  midPt,
  mul,
  norm,
  openingWorld,
  perp,
  projectOnWall,
  radToDeg,
  rotatePt,
  sub,
  wallFrame,
  wallPolygon,
} from "./plan-geometry.ts";
import { DRAW_COLORS, DRAW_LAYERS, type DrawBounds, type DrawLayer, type DrawOp, type DrawStyle } from "./plan-draw-types.ts";
import { stairLayout, stairToPlan } from "./plan-stairs.ts";
import { cabinetLayout, cabinetStyle, profileFrame } from "./plan-cabinet.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export type PhaseView = "all" | "existing" | "demo" | "new";

export interface PlanDrawOptions {
  levelId: string;
  /** all: everything; existing: existing walls + items; demo: existing + remove
   *  (remove drawn hatched/red, relocate ghosted); new: everything except
   *  remove (relocate drawn solid at its position). */
  phase: PhaseView;
  /** Which layers to emit. */
  layers: ReadonlySet<DrawLayer>;
  /** Accent dashed outline + 4 handle dots around these ids. */
  selectedIds?: ReadonlySet<string>;
  /** Light highlight. */
  hoverId?: string | null;
  /** Cabinet/appliance/opening callouts. */
  showTags: boolean;
  /** User dims + auto wall dims when a wall is selected. */
  showDims: boolean;
  /** Room name + area centred in the room. */
  showRoomLabels: boolean;
  /** The canvas draws the grid itself; ignored here. */
  showGrid?: boolean;
  /** Hint so text can be scaled for readability at the current zoom. */
  scalePxPerIn?: number;
  /** Print: black ink, no hover/selection, tags always. */
  forPrint?: boolean;
}

export interface ElevationOptions {
  wallId: string;
  side: "left" | "right";
  showTags: boolean;
  showDims: boolean;
  forPrint?: boolean;
}

export interface ViewOps {
  ops: DrawOp[];
  widthIn: number;
  heightIn: number;
  title: string;
}

export const ELEC_SYMBOL_SIZE_IN = 6;

const TEXT = { base: 6, tag: 5, room: 8, small: 4 } as const;
type TextSizes = { base: number; tag: number; room: number; small: number };
/** On-screen label heights (CSS px) the canvas aims for at any zoom. */
const SCREEN_TEXT_PX: TextSizes = { base: 11, tag: 10, room: 14, small: 9 };

/** Label sizes (plan inches) for a drawing. Print keeps paper-scale sizes;
 *  the canvas (scalePxPerIn given) holds labels at a steady screen size so
 *  zooming in doesn't blow them up and zooming out doesn't lose them — capped
 *  at 2× the paper size so a zoomed-out house doesn't drown in text. */
export function planTextSizes(scalePxPerIn: number | undefined, forPrint = false): TextSizes {
  if (forPrint || !scalePxPerIn || !(scalePxPerIn > 0)) return { ...TEXT };
  const at = (k: keyof TextSizes) => Math.min(TEXT[k] * 2, SCREEN_TEXT_PX[k] / scalePxPerIn);
  return { base: at("base"), tag: at("tag"), room: at("room"), small: at("small") };
}
const CAB_KINDS = new Set<PlacedItem["kind"]>(["base", "wall", "tall", "vanity", "island"]);
const ITEM_LAYER: Record<PlacedItem["kind"], DrawLayer> = {
  base: "cabinets",
  wall: "cabinets",
  tall: "cabinets",
  vanity: "cabinets",
  island: "cabinets",
  counter: "counters",
  appliance: "appliances",
  plumbing: "plumbing",
  electrical: "electrical",
  lighting: "lighting",
  hvac: "hvac",
  furniture: "furniture",
  structure: "structure",
  generic: "furniture",
};
const LIGHT_TYPES = new Set<ElecType>(["recessed", "pendant", "sconce", "underCab", "surface", "fan"]);
const HVAC_TYPES = new Set<ElecType>(["register", "return", "exhaust", "miniSplit"]);

// ─── Small helpers ───────────────────────────────────────────────────────────

const HAIR: DrawStyle = { strokeWidth: "hairline" };

function phaseVisible(phase: string, view: PhaseView): boolean {
  switch (view) {
    case "all":
      return true;
    case "existing":
      // As the site stands today: what's staying plus what's coming out
      // (drawn plain, not as demo). Same rule as the 3D view.
      return phase !== "new";
    case "demo":
      return phase === "existing" || phase === "remove" || phase === "relocate";
    case "new":
      return phase !== "remove";
  }
}

/** Keep text readable: rotate so it never reads upside down. */
function readable(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 90 && d <= 270) d -= 180;
  return d;
}

/** Arc op from a centre through two rim points, taking the short way round. */
function arcBetween(c: Pt, r: number, pA: Pt, pB: Pt, s: DrawStyle, layer: DrawLayer, id?: string): DrawOp {
  let a0 = radToDeg(Math.atan2(pA.y - c.y, pA.x - c.x));
  let a1 = radToDeg(Math.atan2(pB.y - c.y, pB.x - c.x));
  let d = a1 - a0;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  if (d < 0) {
    const t = a0;
    a0 = a1;
    a1 = t;
    d = -d;
  }
  return { t: "arc", c, r, startDeg: a0, endDeg: a0 + d, s, layer, id };
}

/** Points of a rounded rectangle (centre, size, corner radius, rotation). */
function roundedRectPts(c: Pt, w: number, h: number, r: number, rotDeg: number, segs = 4): Pt[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const hw = w / 2;
  const hh = h / 2;
  const corners: [Pt, number][] = [
    [{ x: hw - rr, y: hh - rr }, 0],
    [{ x: -hw + rr, y: hh - rr }, 90],
    [{ x: -hw + rr, y: -hh + rr }, 180],
    [{ x: hw - rr, y: -hh + rr }, 270],
  ];
  const out: Pt[] = [];
  for (const [cc, start] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = ((start + (90 * i) / segs) * Math.PI) / 180;
      out.push({ x: c.x + cc.x + rr * Math.cos(a), y: c.y + cc.y + rr * Math.sin(a) });
    }
  }
  return rotDeg ? out.map((p) => rotatePt(p, c, rotDeg)) : out;
}

function ellipsePts(c: Pt, rx: number, ry: number, rotDeg: number, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
  }
  return rotDeg ? out.map((p) => rotatePt(p, c, rotDeg)) : out;
}

/** Quadratic bezier sampled into a polyline. */
function bezierPts(a: Pt, ctrl: Pt, b: Pt, n = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
    });
  }
  return out;
}

/** Local item coordinates (x along w, y along d, +y = front) → plan space. */
function itemLocal(i: Pick<PlacedItem, "x" | "y" | "rotDeg">, lx: number, ly: number): Pt {
  return rotatePt({ x: i.x + lx, y: i.y + ly }, { x: i.x, y: i.y }, i.rotDeg);
}

function boundsOfPts(pts: Pt[]): DrawBounds | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Corner points of a rect op (honouring rotation about its centre). */
function rectPts(x: number, y: number, w: number, h: number, rotDeg?: number): Pt[] {
  const c = { x: x + w / 2, y: y + h / 2 };
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return rotDeg ? pts.map((p) => rotatePt(p, c, rotDeg)) : pts;
}

/** Rough symbol classification from the library key / label. */
function symbolOf(i: PlacedItem): string {
  const s = `${i.libraryKey ?? ""} ${i.label} ${String(i.props?.type ?? "")}`.toLowerCase();
  if (i.kind === "plumbing") {
    if (/toilet|wc|water closet/.test(s)) return "toilet";
    if (/tub|bath(?!room)/.test(s)) return "tub";
    if (/shower/.test(s)) return "shower";
    if (/sink|lav|basin/.test(s)) return "sink";
    return "sink";
  }
  if (i.kind === "appliance") {
    // Hood / over-range microwave first: their names say "range" too.
    if (/hood/.test(s)) return "hood";
    if (/micro/.test(s)) return "oven";
    if (/range|cooktop|stove/.test(s)) return "range";
    if (/fridge|refrig|freezer/.test(s)) return "fridge";
    if (/dishwasher|\bdw\b/.test(s)) return "dishwasher";
    if (/oven/.test(s)) return "oven";
    if (/washer|dryer|laundry/.test(s)) return "laundry";
    return "appliance";
  }
  return i.kind;
}

// ─── Public: bounds ──────────────────────────────────────────────────────────

export function opsBounds(ops: DrawOp[]): DrawBounds | null {
  const pts: Pt[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "line":
        pts.push(op.a, op.b);
        break;
      case "polyline":
      case "polygon":
        pts.push(...op.pts);
        break;
      case "rect":
        pts.push(...rectPts(op.x, op.y, op.w, op.h, op.rotDeg));
        break;
      case "circle":
      case "arc":
        pts.push({ x: op.c.x - op.r, y: op.c.y - op.r }, { x: op.c.x + op.r, y: op.c.y + op.r });
        break;
      case "text": {
        const half = (op.text.length * op.size * 0.55) / 2;
        pts.push({ x: op.p.x - half, y: op.p.y - op.size }, { x: op.p.x + half, y: op.p.y + op.size });
        break;
      }
      case "image":
        pts.push(...rectPts(op.x, op.y, op.w, op.h, op.rotDeg));
        break;
    }
  }
  return boundsOfPts(pts);
}

// ─── Public: dimension strings ───────────────────────────────────────────────

/** A dimension between a and b offset by offsetIn (perpendicular, to the LEFT
 *  of a→b when positive): extension lines, dimension line, 45° tick marks and
 *  the fmtIn text centred beside the line, rotated to read along it. */
export function dimensionOps(
  a: Pt,
  b: Pt,
  offsetIn: number,
  layer: DrawLayer,
  opts: { textSize?: number; forPrint?: boolean; text?: string } = {},
): DrawOp[] {
  const L = dist(a, b);
  if (L < 1e-6) return [];
  const d = norm(sub(b, a));
  const n = perp(d);
  const sign = offsetIn < 0 ? -1 : 1;
  const size = opts.textSize ?? (opts.forPrint ? 5 : TEXT.base);
  const ink = opts.forPrint ? DRAW_COLORS.ink : DRAW_COLORS.ink2;
  const s: DrawStyle = { stroke: ink, strokeWidth: "hairline" };
  const a1 = add(a, mul(n, offsetIn));
  const b1 = add(b, mul(n, offsetIn));
  const gap = mul(n, sign * 1);
  const ext = mul(n, sign * 2);
  const tick = 1.5;
  const tickVec = mul(add(d, mul(n, 1)), tick / Math.SQRT2);
  const ops: DrawOp[] = [
    { t: "line", a: add(a, gap), b: add(a1, ext), s, layer },
    { t: "line", a: add(b, gap), b: add(b1, ext), s, layer },
    { t: "line", a: a1, b: b1, s, layer },
    { t: "line", a: sub(a1, tickVec), b: add(a1, tickVec), s, layer },
    { t: "line", a: sub(b1, tickVec), b: add(b1, tickVec), s, layer },
  ];
  const text = opts.text ?? fmtIn(L);
  const textP = add(midPt(a1, b1), mul(n, sign * size * 0.9));
  ops.push({
    t: "text",
    p: textP,
    text,
    size,
    rotDeg: readable(radToDeg(Math.atan2(d.y, d.x))),
    anchor: "middle",
    baseline: "middle",
    font: "sans",
    s: { fill: ink },
    layer,
  });
  return ops;
}

// ─── Public: electrical symbols ──────────────────────────────────────────────

/** Standard electrical / lighting / HVAC symbol centred at p. */
export function elecSymbolOps(type: ElecType, p: Pt, layer: DrawLayer, style: Partial<DrawStyle> = {}): DrawOp[] {
  const size = ELEC_SYMBOL_SIZE_IN;
  const r = size / 2;
  const stroke = style.stroke ?? DRAW_COLORS.elec;
  const s: DrawStyle = { ...HAIR, ...style, stroke, fill: style.fill ?? "none" };
  const fillS: DrawStyle = { ...s, fill: stroke };
  const tx = (text: string, sz = size * 0.8, at: Pt = p, weight: "normal" | "bold" = "bold"): DrawOp => ({
    t: "text",
    p: at,
    text,
    size: sz,
    anchor: "middle",
    baseline: "middle",
    font: "sans",
    weight,
    s: { fill: stroke, opacity: style.opacity },
    layer,
  });
  const circle = (rr = r): DrawOp => ({ t: "circle", c: p, r: rr, s, layer });
  const line = (ax: number, ay: number, bx: number, by: number, extra: Partial<DrawStyle> = {}): DrawOp => ({
    t: "line",
    a: { x: p.x + ax, y: p.y + ay },
    b: { x: p.x + bx, y: p.y + by },
    s: { ...s, ...extra },
    layer,
  });
  const rect = (w: number, h: number): DrawOp => ({ t: "rect", x: p.x - w / 2, y: p.y - h / 2, w, h, s, layer });
  switch (type) {
    case "outlet":
      return [circle(), line(-r * 1.2, -r * 0.45, r * 1.2, -r * 0.45), line(-r * 1.2, r * 0.45, r * 1.2, r * 0.45)];
    case "gfci":
      return [
        circle(),
        line(-r * 1.2, -r * 0.45, r * 1.2, -r * 0.45),
        line(-r * 1.2, r * 0.45, r * 1.2, r * 0.45),
        tx("GFCI", size * 0.4, { x: p.x, y: p.y + r + size * 0.35 }, "normal"),
      ];
    case "outlet240":
      return [
        circle(),
        line(-r * 1.2, -r * 0.55, r * 1.2, -r * 0.55),
        line(-r * 1.2, 0, r * 1.2, 0),
        line(-r * 1.2, r * 0.55, r * 1.2, r * 0.55),
      ];
    case "switch":
      return [tx("S")];
    case "switch3":
      return [tx("S3")];
    case "dimmer":
      return [tx("SD")];
    case "recessed":
      return [circle(), line(-r, 0, r, 0), line(0, -r, 0, r)];
    case "pendant":
      return [circle(), { t: "circle", c: p, r: r / 2, s: fillS, layer }];
    case "sconce":
      return [
        { t: "arc", c: p, r, startDeg: 180, endDeg: 360, s, layer },
        line(-r, 0, r, 0),
      ];
    case "underCab":
      return [line(-size, 0, size, 0, { dash: [2, 1.5] })];
    case "surface":
      return [circle()];
    case "fan":
      return [
        circle(r * 0.45),
        line(r * 0.45, 0, r * 1.4, 0, { strokeWidth: 1 }),
        line(-r * 0.45, 0, -r * 1.4, 0, { strokeWidth: 1 }),
        line(0, r * 0.45, 0, r * 1.4, { strokeWidth: 1 }),
        line(0, -r * 0.45, 0, -r * 1.4, { strokeWidth: 1 }),
      ];
    case "panel":
      return [rect(size, size * 1.5), tx("P", size * 0.7)];
    case "smoke":
      return [circle(), tx("SD", size * 0.45)];
    case "data":
      return [
        {
          t: "polygon",
          pts: [
            { x: p.x, y: p.y - r },
            { x: p.x + r, y: p.y + r * 0.8 },
            { x: p.x - r, y: p.y + r * 0.8 },
          ],
          s,
          layer,
        },
      ];
    case "register":
      return [rect(size * 1.6, size), line(-size * 0.8, -r, size * 0.8, r)];
    case "return":
      return [rect(size * 1.6, size), line(-size * 0.8, -r, size * 0.8, r), line(-size * 0.8, r, size * 0.8, -r)];
    case "exhaust":
      return [circle(), tx("EF", size * 0.45)];
    case "miniSplit":
      return [rect(size * 2, size), tx("MS", size * 0.5)];
  }
}

// ─── Plan ops ────────────────────────────────────────────────────────────────

interface Ctx {
  doc: PlanDoc;
  opts: PlanDrawOptions;
  print: boolean;
  ink: string;
  /** Ops bucketed by layer (flattened in DRAW_LAYERS order at the end). */
  buckets: Map<DrawLayer, DrawOp[]>;
  /** Selection / hover outline points captured while drawing, by element id. */
  outlines: Map<string, { pts: Pt[]; layer: DrawLayer }>;
  slice: ReturnType<typeof levelSlice>;
  walls: Wall[];
  wallById: Map<string, Wall>;
  rooms: Room[];
  /** Label sizes for this drawing (see planTextSizes). */
  T: TextSizes;
}

function push(ctx: Ctx, op: DrawOp): void {
  let b = ctx.buckets.get(op.layer);
  if (!b) {
    b = [];
    ctx.buckets.set(op.layer, b);
  }
  b.push(op);
}

function pushAll(ctx: Ctx, ops: DrawOp[]): void {
  for (const op of ops) push(ctx, op);
}

function on(ctx: Ctx, layer: DrawLayer): boolean {
  return ctx.opts.layers.has(layer);
}

function textOp(
  ctx: Ctx,
  layer: DrawLayer,
  p: Pt,
  text: string,
  size: number,
  extra: Partial<Extract<DrawOp, { t: "text" }>> = {},
  color = ctx.ink,
): DrawOp {
  return {
    t: "text",
    p,
    text,
    size: ctx.print ? size * 0.9 : size,
    anchor: "middle",
    baseline: "middle",
    font: "sans",
    s: { fill: color },
    layer,
    ...extra,
  };
}

/** Wall tone for the current phase view. */
function wallStyle(ctx: Ctx, w: Wall): DrawStyle {
  const view = ctx.opts.phase;
  if (w.kind === "remove" && view !== "existing") {
    return { stroke: DRAW_COLORS.demo, strokeWidth: "hairline", dash: [3, 2], fill: "none", hatch: "diag" };
  }
  if (w.kind === "new") {
    return ctx.print
      ? { stroke: DRAW_COLORS.ink, strokeWidth: 1, fill: DRAW_COLORS.ink }
      : { stroke: DRAW_COLORS.new, strokeWidth: "hairline", fill: DRAW_COLORS.new, fillOpacity: 0.85 };
  }
  if (view === "demo" && !ctx.print) {
    return { stroke: DRAW_COLORS.ink3, strokeWidth: "hairline", fill: DRAW_COLORS.ink3 };
  }
  return { stroke: DRAW_COLORS.ink, strokeWidth: "hairline", fill: DRAW_COLORS.existing };
}

/** +1 when the wall's left face is the outside (no room on that side), else −1. */
function outsideSign(ctx: Ctx, w: Wall): 1 | -1 {
  const fr = wallFrame(w);
  const probe = add(alongWall(w, fr.length / 2), mul(fr.left, w.thickIn / 2 + 1));
  return ctx.rooms.some((r) => pointInPolygon(probe, r.polygon)) ? -1 : 1;
}

function drawRooms(ctx: Ctx): void {
  if (!on(ctx, "rooms")) return;
  for (const r of ctx.rooms) {
    if (r.polygon.length < 3) continue;
    push(ctx, {
      t: "polygon",
      pts: r.polygon,
      s: { fill: ctx.print ? DRAW_COLORS.paper : DRAW_COLORS.paper2, stroke: "none" },
      layer: "rooms",
      id: r.id,
    });
    ctx.outlines.set(r.id, { pts: r.polygon, layer: "rooms" });
    if (ctx.opts.showRoomLabels) {
      const c = centroid(r.polygon);
      push(ctx, textOp(ctx, "rooms", { x: c.x, y: c.y - ctx.T.room * 0.55 }, r.name, ctx.T.room, { weight: "bold" }, ctx.ink));
      push(ctx, textOp(ctx, "rooms", { x: c.x, y: c.y + ctx.T.base * 0.7 }, `${Math.round(r.areaSf)} sf`, ctx.T.base, {}, DRAW_COLORS.ink2));
    }
  }
}

function drawFinishes(ctx: Ctx): void {
  if (!on(ctx, "finishes")) return;
  for (const f of ctx.slice.finishes) {
    if (f.target === "floor") {
      const poly = f.polygon?.length ? f.polygon : ctx.rooms.find((r) => r.id === f.roomId)?.polygon;
      if (!poly || poly.length < 3) continue;
      const tile = !!f.material.pattern;
      push(ctx, {
        t: "polygon",
        pts: poly,
        s: {
          fill: ctx.print ? "none" : f.material.color,
          fillOpacity: 0.18,
          stroke: ctx.print ? DRAW_COLORS.ink3 : f.material.color,
          strokeWidth: "hairline",
          dash: [4, 2],
          hatch: tile ? "diag" : undefined,
        },
        layer: "finishes",
        id: f.id,
      });
      ctx.outlines.set(f.id, { pts: poly, layer: "finishes" });
      const c = centroid(poly);
      push(ctx, textOp(ctx, "finishes", { x: c.x, y: c.y + ctx.T.room * 1.6 }, f.material.label, ctx.T.tag, {}, DRAW_COLORS.ink3));
    } else if (f.target === "wall" && f.wallId) {
      const w = ctx.wallById.get(f.wallId);
      if (!w) continue;
      const fr = wallFrame(w);
      const sideSign = f.side === "right" ? -1 : 1;
      const off = mul(fr.left, sideSign * (w.thickIn / 2 + 0.75));
      push(ctx, {
        t: "line",
        a: add(w.a, off),
        b: add(w.b, off),
        s: { stroke: ctx.print ? DRAW_COLORS.ink3 : f.material.color, strokeWidth: 1.5, lineCap: "butt" },
        layer: "finishes",
        id: f.id,
      });
    }
  }
}

function drawWalls(ctx: Ctx): void {
  if (!on(ctx, "walls")) return;
  for (const w of ctx.walls) {
    const pts = wallPolygon(w, ctx.slice.walls);
    push(ctx, { t: "polygon", pts, s: wallStyle(ctx, w), layer: "walls", id: w.id });
    ctx.outlines.set(w.id, { pts, layer: "walls" });
  }
}

function drawOpenings(ctx: Ctx): void {
  if (!on(ctx, "openings")) return;
  const view = ctx.opts.phase;
  for (const o of ctx.slice.openings) {
    const w = ctx.wallById.get(o.wallId);
    if (!w) continue;
    if (!phaseVisible(o.phase, view)) continue;
    const ow = openingWorld(o, w);
    const th = w.thickIn;
    const half = th / 2;
    const dir = ow.dir;
    const left = ow.left;
    const isRemove = o.phase === "remove" && ctx.opts.phase !== "existing";
    const ink = isRemove ? DRAW_COLORS.demo : ctx.print ? DRAW_COLORS.ink : DRAW_COLORS.ink3;
    const line: DrawStyle = { stroke: ink, strokeWidth: "hairline", dash: isRemove ? [2, 1.5] : undefined };
    const angle = radToDeg(Math.atan2(dir.y, dir.x));
    // The cut: paper over the wall fill across the opening span.
    const cutPts = [
      add(ow.start, mul(left, half)),
      add(ow.end, mul(left, half)),
      add(ow.end, mul(left, -half)),
      add(ow.start, mul(left, -half)),
    ];
    push(ctx, {
      t: "rect",
      x: ow.centre.x - o.widthIn / 2,
      y: ow.centre.y - half,
      w: o.widthIn,
      h: th,
      rotDeg: angle,
      s: { fill: DRAW_COLORS.paper, stroke: "none" },
      layer: "openings",
      id: o.id,
    });
    ctx.outlines.set(o.id, { pts: cutPts, layer: "openings" });
    // Jamb caps.
    const cap = (p: Pt): DrawOp => ({ t: "line", a: add(p, mul(left, half)), b: add(p, mul(left, -half)), s: line, layer: "openings", id: o.id });
    push(ctx, cap(ow.start));
    push(ctx, cap(ow.end));

    const swingSign = o.swing === "left" ? 1 : -1;
    const sw = mul(left, swingSign);
    const sub_ = o.subtype.toLowerCase();
    if (o.kind === "door") {
      const hinge = o.hand === "L" ? ow.start : ow.end;
      const other = o.hand === "L" ? ow.end : ow.start;
      const wd = o.widthIn;
      const leaf = (h: Pt, len: number): DrawOp[] => {
        const tip = add(h, mul(sw, len));
        const across = add(h, mul(norm(sub(h === hinge ? other : hinge, h)), len));
        return [
          { t: "line", a: h, b: tip, s: line, layer: "openings", id: o.id },
          arcBetween(h, len, tip, across, line, "openings", o.id),
        ];
      };
      if (sub_ === "pocket") {
        // Leaf slid into the wall beyond the hinge jamb.
        const back = norm(sub(hinge, other));
        push(ctx, {
          t: "line",
          a: hinge,
          b: add(hinge, mul(back, wd)),
          s: { ...line, dash: [2, 1.5] },
          layer: "openings",
          id: o.id,
        });
        push(ctx, { t: "line", a: ow.start, b: ow.end, s: { ...line, dash: [1, 1] }, layer: "openings", id: o.id });
      } else if (sub_ === "bifold") {
        const half2 = wd / 2;
        const fold = (from: Pt, to: Pt): DrawOp => {
          const d = norm(sub(to, from));
          const mid = add(add(from, mul(d, half2 / 2)), mul(sw, half2 / 2));
          const end = add(from, mul(d, half2));
          return { t: "polyline", pts: [from, mid, end], s: line, layer: "openings", id: o.id };
        };
        push(ctx, fold(ow.start, ow.end));
        push(ctx, fold(ow.end, ow.start));
      } else if (sub_ === "sliding" || sub_ === "slider" || sub_ === "bypass" || sub_ === "barn") {
        const seg = wd * 0.55;
        push(ctx, { t: "line", a: add(ow.start, mul(left, th / 4)), b: add(add(ow.start, mul(dir, seg)), mul(left, th / 4)), s: { ...line, strokeWidth: 0.75 }, layer: "openings", id: o.id });
        push(ctx, { t: "line", a: add(ow.end, mul(left, -th / 4)), b: add(add(ow.end, mul(dir, -seg)), mul(left, -th / 4)), s: { ...line, strokeWidth: 0.75 }, layer: "openings", id: o.id });
      } else if (sub_ === "french" || sub_ === "double") {
        const halfW = wd / 2;
        for (const h of [ow.start, ow.end]) {
          const tip = add(h, mul(sw, halfW));
          const across = add(h, mul(norm(sub(h === ow.start ? ow.end : ow.start, h)), halfW));
          push(ctx, { t: "line", a: h, b: tip, s: line, layer: "openings", id: o.id });
          push(ctx, arcBetween(h, halfW, tip, across, line, "openings", o.id));
        }
      } else if (sub_ === "cased" || sub_ === "opening" || sub_ === "arched") {
        // Just the cut with caps (already drawn).
      } else {
        pushAll(ctx, leaf(hinge, wd));
      }
    } else if (o.kind === "window") {
      const glass: DrawStyle = { stroke: ctx.print ? DRAW_COLORS.ink : DRAW_COLORS.glass, strokeWidth: "hairline" };
      if (sub_ === "bay") {
        const depth = Math.min(o.widthIn / 4, 24);
        const outSign = outsideSign(ctx, w);
        const out = mul(left, outSign * depth); // project out of the room
        const p1 = add(add(ow.start, mul(dir, o.widthIn / 4)), out);
        const p2 = add(add(ow.end, mul(dir, -o.widthIn / 4)), out);
        push(ctx, { t: "polyline", pts: [ow.start, p1, p2, ow.end], s: line, layer: "openings", id: o.id });
        push(ctx, { t: "polyline", pts: [ow.start, p1, p2, ow.end].map((p) => add(p, mul(left, outSign * 1))), s: glass, layer: "openings", id: o.id });
      } else {
        push(ctx, { t: "line", a: add(ow.start, mul(left, half)), b: add(ow.end, mul(left, half)), s: line, layer: "openings", id: o.id });
        push(ctx, { t: "line", a: add(ow.start, mul(left, -half)), b: add(ow.end, mul(left, -half)), s: line, layer: "openings", id: o.id });
        push(ctx, { t: "line", a: ow.start, b: ow.end, s: glass, layer: "openings", id: o.id });
        if (sub_ === "casement") {
          // A short tick at the hinge side marks the operable sash.
          const h = o.hand === "L" ? ow.start : ow.end;
          const away = norm(sub(o.hand === "L" ? ow.end : ow.start, h));
          push(ctx, { t: "line", a: h, b: add(add(h, mul(away, 4)), mul(sw, 3)), s: line, layer: "openings", id: o.id });
        } else if (sub_ === "slider" || sub_ === "double") {
          const c = ow.centre;
          push(ctx, { t: "line", a: add(c, mul(left, half * 0.6)), b: add(c, mul(left, -half * 0.6)), s: line, layer: "openings", id: o.id });
        }
      }
    }
    if (o.tag && (ctx.opts.showTags || ctx.print)) {
      const side = o.kind === "door" ? swingSign : 1;
      const tp = add(ow.centre, mul(left, side * (half + ctx.T.tag * 1.2)));
      push(ctx, { t: "circle", c: tp, r: ctx.T.tag * 0.9, s: { stroke: ctx.ink, strokeWidth: "hairline", fill: DRAW_COLORS.paper }, layer: "openings", id: o.id });
      push(ctx, textOp(ctx, "openings", tp, o.tag, ctx.T.small, { rotDeg: readable(angle) }));
    }
  }
}

function drawStructure(ctx: Ctx): void {
  const view = ctx.opts.phase;
  if (on(ctx, "structure")) {
    for (const s of ctx.slice.structure) {
      if (!phaseVisible(s.phase, view)) continue;
      const isRemove = s.phase === "remove" && ctx.opts.phase !== "existing";
      const ink = isRemove ? DRAW_COLORS.demo : ctx.ink;
      const st: DrawStyle = { stroke: ink, strokeWidth: "hairline", dash: isRemove ? [2, 1.5] : undefined };
      if (s.kind === "column") {
        const pts = rectPts(s.a.x - s.wIn / 2, s.a.y - s.wIn / 2, s.wIn, s.wIn);
        push(ctx, { t: "rect", x: s.a.x - s.wIn / 2, y: s.a.y - s.wIn / 2, w: s.wIn, h: s.wIn, s: { ...st, fill: isRemove ? "none" : ink, hatch: isRemove ? "diag" : undefined }, layer: "structure", id: s.id });
        ctx.outlines.set(s.id, { pts, layer: "structure" });
      } else {
        const d = norm(sub(s.b, s.a));
        const n = perp(d);
        const o1 = mul(n, s.wIn / 2);
        const pts = [add(s.a, o1), add(s.b, o1), sub(s.b, o1), sub(s.a, o1)];
        if (s.kind === "beam") {
          push(ctx, { t: "line", a: pts[0], b: pts[1], s: { ...st, dash: [6, 3] }, layer: "structure", id: s.id });
          push(ctx, { t: "line", a: pts[3], b: pts[2], s: { ...st, dash: [6, 3] }, layer: "structure", id: s.id });
        } else {
          push(ctx, { t: "polygon", pts, s: { ...st, dash: [3, 2], fill: "none" }, layer: "structure", id: s.id });
        }
        ctx.outlines.set(s.id, { pts, layer: "structure" });
      }
      if (s.label && (ctx.opts.showTags || ctx.print)) {
        const c = s.kind === "column" ? { x: s.a.x, y: s.a.y - s.wIn / 2 - ctx.T.small } : midPt(s.a, s.b);
        const ang = s.kind === "column" ? 0 : readable(radToDeg(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x)));
        push(ctx, textOp(ctx, "structure", c, s.label, ctx.T.tag, { rotDeg: ang }, ink));
      }
    }
  }
  if (on(ctx, "stairs")) {
    for (const st of ctx.slice.stairs) {
      if (!phaseVisible(st.phase, view)) continue;
      // Shared with the 3D model and hit-testing (lib/plan-stairs).
      const lay = stairLayout(st);
      const P = (p: Pt) => stairToPlan(st, p);
      const ink = st.phase === "remove" && ctx.opts.phase !== "existing" ? DRAW_COLORS.demo : ctx.ink;
      const sty: DrawStyle = { stroke: ink, strokeWidth: "hairline", fill: "none" };
      const corners = lay.footprint.map(P);
      push(ctx, { t: "polygon", pts: corners, s: sty, layer: "stairs", id: st.id });
      for (const pc of lay.pieces) {
        const r = [
          { x: pc.x0, y: pc.y0 },
          { x: pc.x1, y: pc.y0 },
          { x: pc.x1, y: pc.y1 },
          { x: pc.x0, y: pc.y1 },
        ].map(P);
        push(ctx, { t: "polygon", pts: r, s: sty, layer: "stairs", id: st.id });
      }
      // Walking line with an arrowhead at the top; UP by the first step.
      const path = lay.path.map(P);
      if (path.length >= 2) {
        const tip = path[path.length - 1];
        const prev = path[path.length - 2];
        const dir = norm(sub(tip, prev));
        const end = add(tip, mul(dir, -2));
        push(ctx, { t: "polyline", pts: [add(path[0], mul(norm(sub(path[1], path[0])), 2)), ...path.slice(1, -1), end], s: sty, layer: "stairs", id: st.id });
        const side = perp(dir);
        push(ctx, { t: "polygon", pts: [add(end, mul(dir, 1)), add(add(end, mul(dir, -4)), mul(side, 2.5)), add(add(end, mul(dir, -4)), mul(side, -2.5))], s: { ...sty, fill: ink }, layer: "stairs", id: st.id });
        const up = add(path[0], mul(norm(sub(path[1], path[0])), 8));
        push(ctx, textOp(ctx, "stairs", up, "UP", ctx.T.tag, { rotDeg: readable(st.rotDeg) }, ink));
      }
      ctx.outlines.set(st.id, { pts: corners, layer: "stairs" });
    }
  }
}

function drawItems(ctx: Ctx): void {
  const view = ctx.opts.phase;
  for (const i of ctx.slice.items) {
    const layer = ITEM_LAYER[i.kind];
    if (!on(ctx, layer)) continue;
    if (!phaseVisible(i.phase, view)) continue;
    const corners = itemCorners(i);
    ctx.outlines.set(i.id, { pts: corners, layer });
    const isRemove = i.phase === "remove" && ctx.opts.phase !== "existing";
    const ghost = i.phase === "relocate" && view === "demo";
    const ink = isRemove ? DRAW_COLORS.demo : ghost ? DRAW_COLORS.ghost : ctx.ink;
    const base: DrawStyle = {
      stroke: ink,
      strokeWidth: "hairline",
      fill: isRemove ? "none" : DRAW_COLORS.paper,
      fillOpacity: ctx.print ? 1 : 0.85,
      dash: isRemove || ghost ? [2, 1.5] : undefined,
      hatch: isRemove ? "diag" : undefined,
    };
    const thin: DrawStyle = { stroke: ink, strokeWidth: "hairline", dash: base.dash };
    const hw = i.w / 2;
    const hd = i.d / 2;
    const L = (lx: number, ly: number) => itemLocal(i, lx, ly);
    const seg = (ax: number, ay: number, bx: number, by: number, s: DrawStyle = thin): DrawOp => ({ t: "line", a: L(ax, ay), b: L(bx, by), s, layer, id: i.id });
    // Footprint.
    push(ctx, { t: "rect", x: i.x - hw, y: i.y - hd, w: i.w, h: i.d, rotDeg: i.rotDeg, s: i.kind === "wall" ? { ...base, dash: [3, 2] } : base, layer, id: i.id });
    const sym = symbolOf(i);
    switch (sym) {
      case "base":
      case "island":
      case "vanity":
        push(ctx, seg(-hw, hd - 1, hw, hd - 1));
        if (sym === "vanity") push(ctx, { t: "polygon", pts: roundedRectPts({ x: i.x, y: i.y }, Math.min(i.w - 6, 20), Math.min(i.d - 6, 16), 3, i.rotDeg), s: thin, layer, id: i.id });
        break;
      case "wall":
        push(ctx, seg(-hw, hd - 1, hw, hd - 1, { ...thin, dash: [3, 2] }));
        break;
      case "tall":
        push(ctx, seg(-hw, -hd, hw, hd));
        push(ctx, seg(-hw, hd - 1, hw, hd - 1));
        break;
      case "counter":
        break;
      case "range": {
        const r = Math.min(i.w, i.d) / 8;
        for (const [lx, ly] of [[-i.w / 4, -i.d / 4], [i.w / 4, -i.d / 4], [-i.w / 4, i.d / 4], [i.w / 4, i.d / 4]] as [number, number][]) {
          push(ctx, { t: "circle", c: L(lx, ly), r, s: thin, layer, id: i.id });
        }
        break;
      }
      case "fridge": {
        // Door swing hinged at the front-left corner, opening out from the front.
        const hinge = L(-hw, hd);
        const tip = L(-hw, hd + i.w);
        const across = L(hw, hd);
        push(ctx, { t: "line", a: hinge, b: tip, s: thin, layer, id: i.id });
        push(ctx, arcBetween(hinge, i.w, tip, across, thin, layer, i.id));
        push(ctx, seg(-hw, hd - 1.5, hw, hd - 1.5));
        break;
      }
      case "dishwasher":
        push(ctx, seg(-hw, hd - 1, hw, hd - 1));
        push(ctx, textOp(ctx, layer, { x: i.x, y: i.y }, "DW", ctx.T.tag, { rotDeg: readable(i.rotDeg) }, ink));
        break;
      case "hood":
        push(ctx, seg(-hw, -hd, hw, hd));
        push(ctx, seg(-hw, hd, hw, -hd));
        break;
      case "sink":
        push(ctx, { t: "polygon", pts: roundedRectPts({ x: i.x, y: i.y }, Math.max(4, i.w - 6), Math.max(4, i.d - 6), 3, i.rotDeg), s: thin, layer, id: i.id });
        push(ctx, { t: "circle", c: L(0, -hd + 2), r: 1, s: thin, layer, id: i.id });
        break;
      case "toilet": {
        const tankD = Math.min(8, i.d * 0.3);
        push(ctx, { t: "polygon", pts: [L(-hw + 2, -hd), L(hw - 2, -hd), L(hw - 2, -hd + tankD), L(-hw + 2, -hd + tankD)], s: thin, layer, id: i.id });
        push(ctx, { t: "polygon", pts: ellipsePts(L(0, tankD / 2), Math.min(hw - 2, 8), Math.max(2, (i.d - tankD) / 2 - 1), i.rotDeg), s: thin, layer, id: i.id });
        break;
      }
      case "tub":
        push(ctx, { t: "polygon", pts: roundedRectPts({ x: i.x, y: i.y }, i.w - 5, i.d - 5, 6, i.rotDeg), s: thin, layer, id: i.id });
        break;
      case "shower":
        push(ctx, seg(-hw, -hd, hw, hd));
        push(ctx, { t: "circle", c: { x: i.x, y: i.y }, r: 1.5, s: thin, layer, id: i.id });
        break;
      case "hvac":
      case "electrical":
      case "lighting":
      case "furniture":
      case "structure":
      case "generic":
      case "appliance":
      case "oven":
      case "laundry":
      default:
        push(ctx, seg(-hw, hd - 1, hw, hd - 1));
        break;
    }
    // Tag.
    if (i.tag && (ctx.opts.showTags || ctx.print)) {
      // The tag reads along the item's width; shrink it to the footprint so a
      // B9 tag stays in its box, and hang it off the front when even that
      // would be unreadable.
      const fit = Math.min(i.w / (i.tag.length * 0.62 + 0.4), i.d * 0.45);
      const size = Math.min(ctx.T.tag, Math.max(fit, ctx.T.tag * 0.6));
      const inside = fit >= size * 0.98;
      // Wall cabinets sit over base runs: keep their tag near the wall and the
      // base tag toward the front so both read.
      const ly = i.kind === "wall" ? -hd + size * 0.8 : i.kind === "base" || i.kind === "vanity" ? hd / 3 : 0;
      const p = inside ? L(0, ly) : L(0, hd + size);
      push(ctx, textOp(ctx, layer, p, i.tag, size, { rotDeg: readable(i.rotDeg) }, ink));
    }
    // Selection badge.
    if (i.selectionOptionId && i.phase === "new" && on(ctx, "selections") && !ctx.print) {
      const bp = L(-hw + 3.5, -hd + 3.5);
      push(ctx, { t: "circle", c: bp, r: 3, s: { stroke: DRAW_COLORS.accent, strokeWidth: "hairline", fill: DRAW_COLORS.paper }, layer: "selections", id: i.id });
      push(ctx, textOp(ctx, "selections", bp, "S", ctx.T.small, { weight: "bold" }, DRAW_COLORS.accent));
    }
  }
}

function drawCounters(ctx: Ctx): void {
  if (!on(ctx, "counters")) return;
  const view = ctx.opts.phase;
  for (const c of ctx.slice.counters) {
    if (c.polygon.length < 3) continue;
    // Counters carry no phase: they follow their run's cabinets, and a counter
    // with no run is treated as new work.
    const visible =
      view === "all" || view === "new" || (!!c.runId && ctx.slice.items.some((i) => i.runId === c.runId && phaseVisible(i.phase, view)));
    if (!visible) continue;
    push(ctx, {
      t: "polygon",
      pts: c.polygon,
      s: { stroke: ctx.print ? DRAW_COLORS.ink : DRAW_COLORS.ink3, strokeWidth: "hairline", fill: ctx.print ? "none" : DRAW_COLORS.counter, fillOpacity: 0.15 },
      layer: "counters",
      id: c.id,
    });
    ctx.outlines.set(c.id, { pts: c.polygon, layer: "counters" });
    for (const seam of c.seams) {
      if (seam.length >= 2) push(ctx, { t: "polyline", pts: seam, s: { stroke: ctx.ink, strokeWidth: "hairline" }, layer: "counters", id: c.id });
    }
    if ((ctx.opts.showTags || ctx.print) && c.material.label) {
      // Along the run, toward the wall, so it clears the cabinet tags (which
      // sit toward the front); dropped when it can't fit the counter.
      const ce = centroid(c.polygon);
      const runItem = c.runId ? ctx.slice.items.find((i) => i.runId === c.runId) : undefined;
      const rot = runItem ? runItem.rotDeg : 0;
      const along = runItem ? Math.max(...c.polygon.map((q) => rotatePt(q, ce, -rot).x)) - Math.min(...c.polygon.map((q) => rotatePt(q, ce, -rot).x)) : Infinity;
      const size = Math.min(ctx.T.small, along / (c.material.label.length * 0.58 + 0.4));
      const p = runItem ? rotatePt({ x: ce.x, y: ce.y - runItem.d / 4 }, ce, rot) : ce;
      if (size >= ctx.T.small * 0.55) push(ctx, textOp(ctx, "counters", p, c.material.label, size, { rotDeg: readable(rot) }, DRAW_COLORS.ink3));
    }
  }
}

function deviceLayer(d: Device): DrawLayer {
  if (LIGHT_TYPES.has(d.type)) return "lighting";
  if (HVAC_TYPES.has(d.type)) return "hvac";
  return "electrical";
}

function drawElectrical(ctx: Ctx): void {
  const view = ctx.opts.phase;
  const byId = new Map(ctx.slice.electrical.map((d) => [d.id, d]));
  for (const d of ctx.slice.electrical) {
    const layer = deviceLayer(d);
    if (!on(ctx, layer)) continue;
    if (!phaseVisible(d.phase, view)) continue;
    const isRemove = d.phase === "remove" && ctx.opts.phase !== "existing";
    const stroke = isRemove ? DRAW_COLORS.demo : ctx.print ? DRAW_COLORS.ink : DRAW_COLORS.elec;
    const ops = elecSymbolOps(d.type, { x: d.x, y: d.y }, layer, { stroke, dash: isRemove ? [1.5, 1] : undefined });
    for (const op of ops) push(ctx, { ...op, id: d.id });
    const r = ELEC_SYMBOL_SIZE_IN / 2 + 1;
    ctx.outlines.set(d.id, { pts: rectPts(d.x - r, d.y - r, r * 2, r * 2), layer });
    if (d.circuit && (ctx.opts.showTags || ctx.print)) {
      push(ctx, textOp(ctx, layer, { x: d.x + r + 1, y: d.y - r }, d.circuit, ctx.T.small, { anchor: "start" }, stroke));
    }
    for (const toId of d.switchLegTo) {
      const to = byId.get(toId);
      if (!to || !on(ctx, "lighting")) continue;
      const a = { x: d.x, y: d.y };
      const b = { x: to.x, y: to.y };
      const m = midPt(a, b);
      const n = perp(norm(sub(b, a)));
      const bulge = Math.min(24, dist(a, b) * 0.2);
      push(ctx, {
        t: "polyline",
        pts: bezierPts(a, add(m, mul(n, bulge)), b, 12),
        s: { stroke, strokeWidth: "hairline", dash: [2, 1.5] },
        layer: "lighting",
        id: d.id,
      });
    }
  }
}

function drawDims(ctx: Ctx): void {
  if (!on(ctx, "dims") || !ctx.opts.showDims) return;
  const dimOpts = { forPrint: ctx.print, textSize: ctx.print ? undefined : ctx.T.base };
  for (const d of ctx.slice.dims) {
    let ops: DrawOp[] = [];
    if (d.kind === "chain" && d.chain && d.chain.length >= 2) {
      for (let k = 0; k + 1 < d.chain.length; k++) ops.push(...dimensionOps(d.chain[k], d.chain[k + 1], d.offsetIn, "dims", dimOpts));
    } else if (d.kind === "linear") {
      // Linear: measure the axis-aligned component (x if the pair is wider than tall).
      const horiz = Math.abs(d.b.x - d.a.x) >= Math.abs(d.b.y - d.a.y);
      const b = horiz ? { x: d.b.x, y: d.a.y } : { x: d.a.x, y: d.b.y };
      ops = dimensionOps(d.a, b, d.offsetIn, "dims", dimOpts);
    } else {
      ops = dimensionOps(d.a, d.b, d.offsetIn, "dims", dimOpts);
    }
    for (const op of ops) push(ctx, { ...op, id: d.id });
    if (ops.length) ctx.outlines.set(d.id, { pts: [d.a, d.b, ...(d.chain ?? [])], layer: "dims" });
  }
  // Auto dimension along the outside face of a selected wall.
  const sel = ctx.opts.selectedIds;
  if (!sel || ctx.print) return;
  for (const w of ctx.walls) {
    if (!sel.has(w.id)) continue;
    const fr = wallFrame(w);
    // Outside = the side no room claims.
    const leftInside = outsideSign(ctx, w) < 0;
    const [p, q] = leftInside ? [w.b, w.a] : [w.a, w.b];
    const openings = ctx.slice.openings.filter((o) => o.wallId === w.id).sort((x, y) => x.atIn - y.atIn);
    const faceOff = w.thickIn / 2;
    const overall = openings.length ? 20 : 12;
    pushAll(ctx, dimensionOps(p, q, faceOff + overall, "dims", dimOpts));
    if (openings.length) {
      const stops = [0];
      for (const o of openings) stops.push(Math.max(0, o.atIn), Math.min(fr.length, o.atIn + o.widthIn));
      stops.push(fr.length);
      const uniq = [...new Set(stops.map((t) => Math.round(t * 100) / 100))].sort((x, y) => x - y);
      const pts = uniq.map((t) => alongWall(w, t));
      if (leftInside) pts.reverse();
      for (let k = 0; k + 1 < pts.length; k++) pushAll(ctx, dimensionOps(pts[k], pts[k + 1], faceOff + 12, "dims", dimOpts));
    }
  }
}

function drawNotes(ctx: Ctx): void {
  if (!on(ctx, "notes")) return;
  for (const n of ctx.slice.notes) {
    const p = { x: n.x, y: n.y };
    if (n.kind === "north") {
      push(ctx, { t: "line", a: { x: n.x, y: n.y + 14 }, b: { x: n.x, y: n.y - 10 }, s: { stroke: ctx.ink, strokeWidth: "hairline" }, layer: "notes", id: n.id });
      push(ctx, { t: "polygon", pts: [{ x: n.x, y: n.y - 16 }, { x: n.x - 4, y: n.y - 6 }, { x: n.x + 4, y: n.y - 6 }], s: { stroke: ctx.ink, strokeWidth: "hairline", fill: ctx.ink }, layer: "notes", id: n.id });
      push(ctx, { t: "circle", c: p, r: 16, s: { stroke: ctx.ink, strokeWidth: "hairline", fill: "none" }, layer: "notes", id: n.id });
      push(ctx, textOp(ctx, "notes", { x: n.x, y: n.y - 22 }, "N", ctx.T.room, { weight: "bold" }));
      ctx.outlines.set(n.id, { pts: rectPts(n.x - 16, n.y - 26, 32, 42), layer: "notes" });
      continue;
    }
    if (n.kind === "cloud") {
      const rx = 24;
      const ry = 12;
      const scallops = 14;
      const pts: Pt[] = [];
      for (let k = 0; k < scallops; k++) {
        for (let j = 0; j < 5; j++) {
          const a = ((k + j / 5) / scallops) * Math.PI * 2;
          const bump = 1 + 0.18 * Math.sin((j / 5) * Math.PI);
          pts.push({ x: n.x + rx * bump * Math.cos(a), y: n.y + ry * bump * Math.sin(a) });
        }
      }
      push(ctx, { t: "polyline", pts, closed: true, s: { stroke: DRAW_COLORS.accent, strokeWidth: "hairline", fill: "none" }, layer: "notes", id: n.id });
      ctx.outlines.set(n.id, { pts: rectPts(n.x - rx * 1.2, n.y - ry * 1.2, rx * 2.4, ry * 2.4), layer: "notes" });
      if (n.text) push(ctx, textOp(ctx, "notes", p, n.text.split("\n")[0], ctx.T.tag, {}, DRAW_COLORS.accent));
      continue;
    }
    const label = n.kind === "label";
    const size = label ? ctx.T.room : ctx.T.base;
    const lines = n.text.split("\n");
    const lh = size * 1.3;
    lines.forEach((ln, k) => {
      push(ctx, textOp(ctx, "notes", { x: n.x, y: n.y + k * lh }, ln, size, { anchor: "start", weight: label ? "bold" : "normal" }));
    });
    const maxLen = Math.max(1, ...lines.map((l) => l.length));
    const box = rectPts(n.x - 1, n.y - size * 0.7, maxLen * size * 0.55 + 2, lh * lines.length);
    ctx.outlines.set(n.id, { pts: box, layer: "notes" });
    if (n.leaderTo) {
      push(ctx, { t: "line", a: { x: n.x - 1.5, y: n.y }, b: n.leaderTo, s: { stroke: ctx.ink, strokeWidth: "hairline" }, layer: "notes", id: n.id });
      push(ctx, { t: "circle", c: n.leaderTo, r: 1, s: { stroke: ctx.ink, strokeWidth: "hairline", fill: ctx.ink }, layer: "notes", id: n.id });
    }
  }
}

function drawPhotos(ctx: Ctx): void {
  if (on(ctx, "photos")) {
    ctx.slice.photos.forEach((ph, k) => {
      const s: DrawStyle = { stroke: ctx.ink, strokeWidth: "hairline", fill: DRAW_COLORS.paper };
      push(ctx, { t: "rect", x: ph.x - 5, y: ph.y - 3.5, w: 10, h: 7, s, layer: "photos", id: ph.id });
      push(ctx, { t: "rect", x: ph.x - 2, y: ph.y - 5, w: 4, h: 1.5, s, layer: "photos", id: ph.id });
      push(ctx, { t: "circle", c: { x: ph.x, y: ph.y }, r: 2, s: { ...s, fill: "none" }, layer: "photos", id: ph.id });
      push(ctx, textOp(ctx, "photos", { x: ph.x, y: ph.y + 7 }, `P${k + 1}`, ctx.T.small));
      ctx.outlines.set(ph.id, { pts: rectPts(ph.x - 6, ph.y - 6, 12, 16), layer: "photos" });
    });
  }
  if (on(ctx, "cameras") && !ctx.print) {
    for (const cam of ctx.slice.cameras) {
      // World (x, y-up, z) → plan (x, -z); see lib/plan-doc.ts header.
      const p = { x: cam.pos[0], y: cam.pos[2] };
      const tgt = { x: cam.target[0], y: -cam.target[2] };
      const dir = norm(sub(tgt, p));
      const s: DrawStyle = { stroke: DRAW_COLORS.accent, strokeWidth: "hairline", fill: DRAW_COLORS.paper };
      const body = rectPts(p.x - 4, p.y - 3, 8, 6, radToDeg(Math.atan2(dir.y, dir.x)));
      push(ctx, { t: "polygon", pts: body, s, layer: "cameras", id: cam.id });
      push(ctx, { t: "circle", c: p, r: 1.5, s: { ...s, fill: DRAW_COLORS.accent }, layer: "cameras", id: cam.id });
      const half = (cam.fov / 2) * (Math.PI / 180);
      const coneLen = 18;
      for (const sgn of [1, -1]) {
        const a = Math.atan2(dir.y, dir.x) + sgn * half;
        push(ctx, { t: "line", a: p, b: { x: p.x + coneLen * Math.cos(a), y: p.y + coneLen * Math.sin(a) }, s: { ...s, dash: [2, 1.5] }, layer: "cameras", id: cam.id });
      }
      push(ctx, textOp(ctx, "cameras", { x: p.x, y: p.y + 8 }, cam.name, ctx.T.small, {}, DRAW_COLORS.accent));
      ctx.outlines.set(cam.id, { pts: rectPts(p.x - 6, p.y - 6, 12, 12), layer: "cameras" });
    }
  }
}

function drawHighlights(ctx: Ctx, out: DrawOp[]): void {
  if (ctx.print) return;
  const sel = ctx.opts.selectedIds;
  const hover = ctx.opts.hoverId;
  const emit = (id: string, isSel: boolean) => {
    const o = ctx.outlines.get(id);
    if (!o) return;
    const b = boundsOfPts(o.pts);
    if (!b) return;
    const pad = 1;
    const pts = rectPts(b.min.x - pad, b.min.y - pad, b.max.x - b.min.x + pad * 2, b.max.y - b.min.y + pad * 2);
    // Use the element's own shape when it is a rotated footprint (4 corners).
    const shape = o.pts.length === 4 ? o.pts : pts;
    out.push({
      t: "polygon",
      pts: shape,
      s: { stroke: DRAW_COLORS.selection, strokeWidth: "hairline", dash: [2, 1.5], fill: "none", opacity: isSel ? 1 : 0.5 },
      layer: o.layer,
      id,
    });
    if (isSel) {
      for (const c of shape) out.push({ t: "circle", c, r: 2, s: { stroke: DRAW_COLORS.selection, strokeWidth: "hairline", fill: DRAW_COLORS.paper }, layer: o.layer, id });
    }
  };
  if (hover && !(sel && sel.has(hover))) emit(hover, false);
  if (sel) for (const id of sel) emit(id, true);
}

/** Every DrawOp for one level of a plan, emitted in DRAW_LAYERS order. */
export function planOps(doc: PlanDoc, opts: PlanDrawOptions): DrawOp[] {
  const slice = levelSlice(doc, opts.levelId);
  const print = !!opts.forPrint;
  const wallVisible = (w: Wall) => phaseVisible(w.kind, opts.phase);
  const walls = slice.walls.filter(wallVisible);
  const ctx: Ctx = {
    doc,
    opts,
    print,
    ink: DRAW_COLORS.ink,
    buckets: new Map(),
    outlines: new Map(),
    slice,
    walls,
    wallById: new Map(walls.map((w) => [w.id, w])),
    rooms: slice.rooms,
    T: planTextSizes(opts.scalePxPerIn, print),
  };
  drawRooms(ctx);
  drawFinishes(ctx);
  drawWalls(ctx);
  drawOpenings(ctx);
  drawStructure(ctx);
  drawItems(ctx);
  drawCounters(ctx);
  drawElectrical(ctx);
  drawDims(ctx);
  drawNotes(ctx);
  drawPhotos(ctx);
  const out: DrawOp[] = [];
  for (const layer of DRAW_LAYERS) {
    const b = ctx.buckets.get(layer);
    if (b) out.push(...b);
  }
  drawHighlights(ctx, out);
  return out;
}

// ─── Cabinet faces (elevations) ──────────────────────────────────────────────

/** A cabinet's front in elevation, from the shared layout (lib/plan-cabinet —
 *  the 3D model builds the same fronts): toe / legs, door and drawer fronts
 *  with their panel profile, dashed swing marks pointing at the hinge, glass
 *  hatching, hardware, crown and light rail. */
function drawCabinetFace(
  ops: DrawOp[],
  i: PlacedItem,
  doc: PlanDoc,
  g: { x0: number; wd: number; z0: number; toeIn: number; Y: (z: number) => number; st: DrawStyle; thin: DrawStyle; layer: DrawLayer; print: boolean },
): void {
  const style = cabinetStyle(i, doc);
  const lay = cabinetLayout(i, style, g.toeIn);
  const sx = g.wd / Math.max(0.01, i.w);
  const X = (lx: number) => g.x0 + (lx + i.w / 2) * sx;
  const Z = (lz: number) => g.Y(g.z0 + lz);
  const id = i.id;
  const layer = g.layer;
  const line = (ax: number, az: number, bx: number, bz: number, s: DrawStyle = g.thin) => ops.push({ t: "line", a: { x: X(ax), y: Z(az) }, b: { x: X(bx), y: Z(bz) }, s, layer, id });
  const rect = (x0: number, z0: number, x1: number, z1: number, s: DrawStyle = { ...g.thin, fill: "none" }) =>
    ops.push({ t: "rect", x: X(Math.min(x0, x1)), y: Z(Math.max(z0, z1)), w: Math.abs(x1 - x0) * sx, h: Math.abs(z1 - z0), s, layer, id });
  const hw = -i.w / 2;
  // Toe / legs.
  if (lay.toe > 0) {
    line(hw, lay.toe, -hw, lay.toe, g.st);
    if (lay.toeStyle === "legs") {
      rect(hw, 0, hw + 1.75, lay.toe, { ...g.thin, fill: g.print ? "none" : DRAW_COLORS.paper });
      rect(-hw - 1.75, 0, -hw, lay.toe, { ...g.thin, fill: g.print ? "none" : DRAW_COLORS.paper });
    }
  }
  const swing: DrawStyle = { ...g.thin, dash: [2, 1.5], opacity: 0.8 };
  for (const f of lay.fronts) {
    rect(f.x0, f.z0, f.x1, f.z1);
    const fw = f.x1 - f.x0;
    const fh = f.z1 - f.z0;
    if (f.kind === "appliance") {
      rect(f.x0 + 1.5, f.z0 + 1.5, f.x1 - 1.5, f.z1 - 1.5);
      continue;
    }
    const fr = profileFrame(f.profile, fw, fh);
    if (fr >= 0.4) {
      rect(f.x0 + fr, f.z0 + fr, f.x1 - fr, f.z1 - fr);
      if (f.profile === "raised" && fw - 2 * fr > 4 && fh - 2 * fr > 4) rect(f.x0 + fr + 1.5, f.z0 + fr + 1.5, f.x1 - fr - 1.5, f.z1 - fr - 1.5);
      if (f.profile === "beaded" && !f.glass) for (let x = f.x0 + fr + 2; x < f.x1 - fr - 1; x += 2) line(x, f.z0 + fr, x, f.z1 - fr);
      if (f.glass) {
        // Glass: a pair of short diagonal strokes.
        const gx = f.x0 + fr + (fw - 2 * fr) * 0.3;
        const gz = f.z0 + fr + (fh - 2 * fr) * 0.55;
        line(gx, gz, gx + 3, gz + 3);
        line(gx + 2, gz - 1, gx + 5, gz + 2);
      }
    }
    if (f.kind === "door" && f.hinge) {
      // Swing marks: from the latch-side corners to the hinge side's middle.
      const hx = f.hinge === "L" ? f.x0 : f.x1;
      const lx = f.hinge === "L" ? f.x1 : f.x0;
      const mz = (f.z0 + f.z1) / 2;
      line(lx, f.z1, hx, mz, swing);
      line(lx, f.z0, hx, mz, swing);
    }
    for (const p of f.pulls) {
      if (p.kind === "knob") {
        ops.push({ t: "circle", c: { x: X(p.x), y: Z(p.z) }, r: 0.6, s: { ...g.thin, fill: g.st.stroke }, layer, id });
      } else if (p.kind === "cup") {
        rect(p.x - p.len / 2, p.z - 0.5, p.x + p.len / 2, p.z + 0.5, { ...g.thin, fill: g.st.stroke });
      } else if (p.orient === "h") {
        line(p.x - p.len / 2, p.z, p.x + p.len / 2, p.z, { ...g.thin, strokeWidth: 0.6 });
      } else {
        line(p.x, p.z - p.len / 2, p.x, p.z + p.len / 2, { ...g.thin, strokeWidth: 0.6 });
      }
    }
  }
  if (lay.crown) {
    rect(hw - 0.75, i.h, -hw + 0.75, i.h + 1.75);
    rect(hw - 1.5, i.h + 1.75, -hw + 1.5, i.h + 3);
  }
  if (lay.lightRail) rect(hw, -1.5, -hw, 0);
}

// ─── Elevations ──────────────────────────────────────────────────────────────

interface FaceItem {
  item: PlacedItem;
  x0: number;
  x1: number;
}

/** Items whose back sits against the given face of a wall (wallId match on
 *  that side, or back-centre within 2" of the face), with their extents along
 *  the face in elevation x. */
function itemsOnFace(doc: PlanDoc, w: Wall, side: "left" | "right", kinds?: Set<PlacedItem["kind"]>): FaceItem[] {
  const fr = wallFrame(w);
  const sign = side === "left" ? 1 : -1;
  const faceOff = w.thickIn / 2;
  const out: FaceItem[] = [];
  for (const i of doc.items) {
    if (i.levelId !== w.levelId) continue;
    if (kinds && !kinds.has(i.kind)) continue;
    const back = itemLocal(i, 0, -i.d / 2);
    const pr = projectOnWall(w, back);
    const centreSide = projectOnWall(w, { x: i.x, y: i.y }).side * sign;
    if (centreSide <= 0) continue;
    // Back within 2" of the face, or buried in the wall up to the centreline.
    const near = pr.side * sign > -0.01 && pr.side * sign <= faceOff + 2;
    const byWall = i.wallId === w.id;
    if (!near && !byWall) continue;
    if (pr.t < -i.w / 2 - 0.5 || pr.t > fr.length + i.w / 2 + 0.5) continue;
    const ts = itemCorners(i).map((c) => projectOnWall(w, c).t);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const [x0, x1] = side === "left" ? [fr.length - t1, fr.length - t0] : [t0, t1];
    out.push({ item: i, x0, x1 });
  }
  return out.sort((p, q) => p.x0 - q.x0);
}

function compassOf(normalTowardViewer: Pt): string {
  // The viewer looks along −normal; the wall lies in the opposite direction.
  if (Math.abs(normalTowardViewer.x) >= Math.abs(normalTowardViewer.y)) return normalTowardViewer.x > 0 ? "West" : "East";
  return normalTowardViewer.y > 0 ? "North" : "South";
}

function roomOfFace(doc: PlanDoc, w: Wall, side: "left" | "right"): Room | undefined {
  const fr = wallFrame(w);
  const probe = add(alongWall(w, fr.length / 2), mul(fr.left, (side === "left" ? 1 : -1) * (w.thickIn / 2 + 2)));
  return doc.rooms.find((r) => r.levelId === w.levelId && pointInPolygon(probe, r.polygon));
}

/** Orthographic elevation of one wall face. x runs along the face as the
 *  viewer sees it standing in the room (a→b for the right face, b→a for the
 *  left face, since "left" is the left-hand side walking a→b in y-down space);
 *  y is drawn DOWN with y = heightIn − z. */
export function elevationOps(doc: PlanDoc, opts: ElevationOptions): ViewOps {
  const w = doc.walls.find((x) => x.id === opts.wallId);
  if (!w) return { ops: [], widthIn: 0, heightIn: 0, title: "Elevation" };
  const fr = wallFrame(w);
  const L = fr.length;
  const level = doc.levels.find((l) => l.id === w.levelId);
  const H = Math.max(w.heightIn, level?.ceilingIn ?? 0) || w.heightIn;
  const print = !!opts.forPrint;
  const ink = DRAW_COLORS.ink;
  const ops: DrawOp[] = [];
  const hair: DrawStyle = { stroke: ink, strokeWidth: "hairline" };
  const Y = (z: number) => H - z;
  const tx = (p: Pt, text: string, size: number, extra: Partial<Extract<DrawOp, { t: "text" }>> = {}, color: string = ink): DrawOp => ({
    t: "text",
    p,
    text,
    size: print ? size * 0.9 : size,
    anchor: "middle",
    baseline: "middle",
    font: "sans",
    s: { fill: color },
    layer: "notes",
    ...extra,
  });
  // Along-face coordinate for a distance t from a.
  const X = (t: number) => (opts.side === "left" ? L - t : t);

  // Wall face.
  ops.push({ t: "rect", x: 0, y: 0, w: L, h: H, s: { ...hair, fill: print ? "none" : DRAW_COLORS.paper2 }, layer: "walls", id: w.id });
  ops.push({ t: "line", a: { x: 0, y: H }, b: { x: L, y: H }, s: { stroke: ink, strokeWidth: 0.75 }, layer: "walls" });

  // Wall finish (tile field / wainscot) on this face.
  for (const f of doc.finishes) {
    if (f.target !== "wall" || f.wallId !== w.id || (f.side ?? "left") !== opts.side) continue;
    const h = f.heightIn ?? H;
    ops.push({ t: "rect", x: 0, y: Y(h), w: L, h, s: { stroke: "none", fill: print ? "none" : f.material.color, fillOpacity: 0.2, hatch: f.material.pattern ? "diag" : undefined }, layer: "finishes", id: f.id });
    ops.push(tx({ x: L - 2, y: Y(h) + 5 }, f.material.label, TEXT.small, { anchor: "end", layer: "finishes" }, DRAW_COLORS.ink3));
  }

  // Openings.
  for (const o of doc.openings) {
    if (o.wallId !== w.id) continue;
    const xa = X(o.atIn);
    const xb = X(o.atIn + o.widthIn);
    const x0 = Math.min(xa, xb);
    const wd = Math.abs(xb - xa);
    const z0 = o.sillIn;
    const z1 = o.sillIn + o.heightIn;
    const isRemove = o.phase === "remove";
    const st: DrawStyle = { stroke: isRemove ? DRAW_COLORS.demo : ink, strokeWidth: "hairline", dash: isRemove ? [2, 1.5] : undefined, fill: DRAW_COLORS.paper };
    ops.push({ t: "rect", x: x0, y: Y(z1), w: wd, h: z1 - z0, s: st, layer: "openings", id: o.id });
    if (o.kind === "door") {
      const sub_ = o.subtype.toLowerCase();
      const leaves = sub_ === "french" || sub_ === "double" || sub_ === "bifold" || sub_ === "sliding" ? 2 : 1;
      const lw = wd / leaves;
      for (let k = 0; k < leaves; k++) {
        const lx = x0 + k * lw;
        ops.push({ t: "rect", x: lx + 1.5, y: Y(z1) + 1.5, w: lw - 3, h: z1 - z0 - 1.5, s: { ...st, fill: "none" }, layer: "openings", id: o.id });
        // Knob at 36".
        const hingeLeft = leaves === 2 ? k === 0 : (o.hand === "L") === (opts.side === "right");
        const kx = hingeLeft ? lx + lw - 4 : lx + 4;
        ops.push({ t: "circle", c: { x: kx, y: Y(36) }, r: 1, s: { ...st, fill: ink }, layer: "openings", id: o.id });
      }
    } else if (o.kind === "window") {
      const glass: DrawStyle = { stroke: print ? ink : DRAW_COLORS.glass, strokeWidth: "hairline", fill: print ? "none" : DRAW_COLORS.glass, fillOpacity: 0.25, hatch: "diag" };
      ops.push({ t: "rect", x: x0 + 1.5, y: Y(z1) + 1.5, w: wd - 3, h: z1 - z0 - 3, s: glass, layer: "openings", id: o.id });
      // Sill and head lines.
      ops.push({ t: "line", a: { x: x0 - 1, y: Y(z0) }, b: { x: x0 + wd + 1, y: Y(z0) }, s: { stroke: ink, strokeWidth: 0.5 }, layer: "openings", id: o.id });
      ops.push({ t: "line", a: { x: x0 - 1, y: Y(z1) }, b: { x: x0 + wd + 1, y: Y(z1) }, s: hair, layer: "openings", id: o.id });
      const sub_ = o.subtype.toLowerCase();
      if (sub_ === "double" || sub_ === "slider" || sub_ === "casement") {
        ops.push({ t: "line", a: { x: x0 + wd / 2, y: Y(z1) }, b: { x: x0 + wd / 2, y: Y(z0) }, s: hair, layer: "openings", id: o.id });
      }
      if (sub_ === "hung" || sub_ === "single" || sub_ === "doublehung" || sub_ === "double-hung") {
        ops.push({ t: "line", a: { x: x0, y: Y((z0 + z1) / 2) }, b: { x: x0 + wd, y: Y((z0 + z1) / 2) }, s: hair, layer: "openings", id: o.id });
      }
    }
    if (o.tag && (opts.showTags || print)) {
      ops.push({ t: "circle", c: { x: x0 + wd / 2, y: Y(z1) - 5 }, r: 4, s: { ...hair, fill: DRAW_COLORS.paper }, layer: "openings", id: o.id });
      ops.push(tx({ x: x0 + wd / 2, y: Y(z1) - 5 }, o.tag, TEXT.small, { layer: "openings" }));
    }
  }

  // Items against the face.
  const items = itemsOnFace(doc, w, opts.side);
  const counterTop = doc.settings.defaults.counterIn;
  const counterThick = 1.5;
  // Under-counter appliances (dishwasher) extend the counter; a range does not.
  const baseItems = items.filter((f) => f.item.kind === "base" || f.item.kind === "vanity" || f.item.kind === "island" || (f.item.kind === "appliance" && f.item.z === 0 && f.item.h < counterTop - 0.5));
  for (const f of items) {
    const i = f.item;
    const x0 = f.x0;
    const wd = f.x1 - f.x0;
    const z0 = i.z;
    const z1 = i.z + i.h;
    const layer = ITEM_LAYER[i.kind];
    const isRemove = i.phase === "remove";
    const st: DrawStyle = {
      stroke: isRemove ? DRAW_COLORS.demo : ink,
      strokeWidth: "hairline",
      dash: isRemove ? [2, 1.5] : undefined,
      fill: isRemove ? "none" : DRAW_COLORS.paper,
      hatch: isRemove ? "diag" : undefined,
    };
    const thin: DrawStyle = { stroke: st.stroke, strokeWidth: "hairline", dash: st.dash };
    const sym = symbolOf(i);
    if (sym === "sink") {
      // Sinks sit in the counter: show the faucet only.
      ops.push({ t: "line", a: { x: x0 + wd / 2, y: Y(counterTop) }, b: { x: x0 + wd / 2, y: Y(counterTop + 8) }, s: thin, layer, id: i.id });
      ops.push({ t: "line", a: { x: x0 + wd / 2, y: Y(counterTop + 8) }, b: { x: x0 + wd / 2 + 4, y: Y(counterTop + 8) }, s: thin, layer, id: i.id });
      ops.push({ t: "line", a: { x: x0 + wd / 2 + 4, y: Y(counterTop + 8) }, b: { x: x0 + wd / 2 + 4, y: Y(counterTop + 6) }, s: thin, layer, id: i.id });
      continue;
    }
    ops.push({ t: "rect", x: x0, y: Y(z1), w: wd, h: z1 - z0, s: st, layer, id: i.id });
    const hline = (z: number, inset = 0) => ops.push({ t: "line", a: { x: x0 + inset, y: Y(z) }, b: { x: x0 + wd - inset, y: Y(z) }, s: thin, layer, id: i.id });
    const vline = (x: number, za: number, zb: number) => ops.push({ t: "line", a: { x, y: Y(za) }, b: { x, y: Y(zb) }, s: thin, layer, id: i.id });
    const toe = doc.settings.defaults.toeIn;
    if (CAB_KINDS.has(i.kind)) {
      drawCabinetFace(ops, i, doc, { x0, wd, z0, toeIn: toe, Y, st, thin, layer, print });
    } else if (sym === "range") {
      // Backguard.
      ops.push({ t: "rect", x: x0, y: Y(z1 + 6), w: wd, h: 6, s: st, layer, id: i.id });
      hline(z1 - 8);
      for (let k = 0; k < 4; k++) ops.push({ t: "circle", c: { x: x0 + (wd * (k + 0.5)) / 4, y: Y(z1 + 3) }, r: 1, s: thin, layer, id: i.id });
    } else if (sym === "fridge") {
      hline(z1 * 0.66);
      vline(x0 + 2, z1 * 0.66 + 2, z1 - 4);
      vline(x0 + 2, 4, z1 * 0.66 - 2);
    } else if (sym === "dishwasher") {
      hline(z1 - 4);
      ops.push(tx({ x: x0 + wd / 2, y: Y((z0 + z1) / 2) }, "DW", TEXT.tag, { layer }));
    } else if (sym === "hood") {
      ops.push({ t: "polygon", pts: [{ x: x0, y: Y(z0) }, { x: x0 + wd, y: Y(z0) }, { x: x0 + wd - 3, y: Y(z0 + 6) }, { x: x0 + 3, y: Y(z0 + 6) }], s: st, layer, id: i.id });
    }
    // Tag: under wall-hung boxes, inside boxes that sit on the floor.
    if (i.tag && (opts.showTags || print)) {
      const p = z0 > 0.5 ? { x: x0 + wd / 2, y: Y(z0) + TEXT.tag * 0.9 } : { x: x0 + wd / 2, y: Y((z0 + z1) / 2) };
      ops.push(tx(p, i.tag, TEXT.tag, { layer, weight: "bold" }));
    }
  }

  // Counter band + backsplash across the base run extents.
  if (baseItems.length) {
    const runs = doc.runs.filter((r) => r.wallId === w.id);
    const runIds = new Set(runs.map((r) => r.id));
    const counters = doc.counters.filter((c) => c.levelId === w.levelId && ((c.runId && runIds.has(c.runId)) || baseItems.some((b) => b.item.runId && c.runId === b.item.runId)));
    const overhang = counters[0]?.overhang.front ?? doc.settings.defaults.overhangIn;
    const bx0 = Math.max(0, Math.min(...baseItems.map((b) => b.x0)) - overhang);
    const bx1 = Math.min(L, Math.max(...baseItems.map((b) => b.x1)) + overhang);
    const cs: DrawStyle = { stroke: ink, strokeWidth: "hairline", fill: print ? "none" : DRAW_COLORS.counter };
    ops.push({ t: "rect", x: bx0, y: Y(counterTop), w: bx1 - bx0, h: counterThick, s: cs, layer: "counters" });
    const bs = counters.length ? Math.max(...counters.map((c) => c.backsplashIn)) : doc.settings.defaults.backsplashIn;
    if (bs > 0) {
      ops.push({ t: "rect", x: bx0, y: Y(counterTop + bs), w: bx1 - bx0, h: bs, s: { stroke: ink, strokeWidth: "hairline", fill: print ? "none" : DRAW_COLORS.counter, fillOpacity: 0.35 }, layer: "counters" });
    }
    if ((opts.showTags || print) && counters[0]?.material.label) {
      ops.push(tx({ x: bx0 + 2, y: Y(counterTop) - 3 }, counters[0].material.label, TEXT.small, { anchor: "start", layer: "counters" }, DRAW_COLORS.ink3));
    }
  }

  // Trim: base, crown, chair.
  const room = roomOfFace(doc, w, opts.side);
  for (const t of doc.trims) {
    if (t.levelId !== w.levelId) continue;
    const mine = t.wallId === w.id || (!t.wallId && t.roomId && room && t.roomId === room.id);
    if (!mine) continue;
    const s: DrawStyle = { stroke: ink, strokeWidth: "hairline" };
    if (t.profile === "base") ops.push({ t: "line", a: { x: 0, y: Y(t.heightIn) }, b: { x: L, y: Y(t.heightIn) }, s, layer: "trim", id: t.id });
    else if (t.profile === "crown") ops.push({ t: "line", a: { x: 0, y: t.heightIn }, b: { x: L, y: t.heightIn }, s, layer: "trim", id: t.id });
    else if (t.profile === "chair") ops.push({ t: "line", a: { x: 0, y: Y(t.heightIn) }, b: { x: L, y: Y(t.heightIn) }, s: { ...s, dash: [4, 2] }, layer: "trim", id: t.id });
  }

  // Devices on this wall + lights near the ceiling.
  const sign = opts.side === "left" ? 1 : -1;
  for (const d of doc.electrical) {
    if (d.levelId !== w.levelId) continue;
    const pr = projectOnWall(w, { x: d.x, y: d.y });
    if (pr.t < -1 || pr.t > L + 1) continue;
    const layer = deviceLayer(d);
    const stroke = print ? ink : DRAW_COLORS.elec;
    if (layer === "lighting" && d.type !== "sconce" && d.type !== "underCab") {
      if (pr.side * sign < -0.5 || pr.side * sign > 36) continue;
      const p = { x: X(pr.t), y: 3 };
      for (const op of elecSymbolOps(d.type, p, layer, { stroke })) ops.push({ ...op, id: d.id });
      continue;
    }
    const onWall = d.wallId === w.id || (pr.side * sign > -0.5 && pr.side * sign <= w.thickIn / 2 + 2);
    if (!onWall) continue;
    const p = { x: X(pr.t), y: Y(d.heightAff) };
    for (const op of elecSymbolOps(d.type, p, layer, { stroke })) ops.push({ ...op, id: d.id });
  }

  // Dimension strings.
  if (opts.showDims || print) {
    const dimOpts = { forPrint: print };
    const stops = new Set<number>([0, L]);
    for (const b of items.filter((f) => CAB_KINDS.has(f.item.kind) || f.item.kind === "appliance")) {
      if (isFloorTier(b)) {
        stops.add(Math.round(b.x0 * 100) / 100);
        stops.add(Math.round(b.x1 * 100) / 100);
      }
    }
    const xs = [...stops].sort((p, q) => p - q);
    if (xs.length > 2) {
      for (let k = 0; k + 1 < xs.length; k++) {
        if (xs[k + 1] - xs[k] < 0.5) continue;
        ops.push(...dimensionOps({ x: xs[k], y: H }, { x: xs[k + 1], y: H }, -8, "dims", dimOpts));
      }
    }
    ops.push(...dimensionOps({ x: 0, y: H }, { x: L, y: H }, xs.length > 2 ? -18 : -8, "dims", dimOpts));
    // Heights on the left: counter, wall cabinet bottom, ceiling.
    const heights = new Set<number>([H]);
    if (baseItems.length) heights.add(counterTop);
    const wallCabs = items.filter((f) => f.item.kind === "wall");
    if (wallCabs.length) heights.add(Math.min(...wallCabs.map((f) => f.item.z)));
    const hs = [0, ...[...heights].sort((p, q) => p - q)];
    for (let k = 0; k + 1 < hs.length; k++) {
      if (hs[k + 1] - hs[k] < 0.5) continue;
      ops.push(...dimensionOps({ x: 0, y: Y(hs[k]) }, { x: 0, y: Y(hs[k + 1]) }, 8, "dims", dimOpts));
    }
  }

  const compass = compassOf(mul(fr.left, sign));
  const title = `${room ? `${room.name} – ` : ""}${compass} wall elevation`;
  return { ops, widthIn: L, heightIn: H, title };
}

function isFloorTier(f: FaceItem): boolean {
  const k = f.item.kind;
  return k === "base" || k === "vanity" || k === "island" || k === "tall" || (k === "appliance" && f.item.z === 0);
}

/** Walls on a level that deserve an elevation: any wall with ≥1 cabinet,
 *  appliance, or plumbing item against it, ordered clockwise from the first
 *  door. `side` is the face the items are on. */
export function autoElevations(doc: PlanDoc, levelId: string): { wallId: string; side: "left" | "right"; label: string }[] {
  const walls = doc.walls.filter((w) => w.levelId === levelId && w.kind !== "remove");
  if (!walls.length) return [];
  const kinds = new Set<PlacedItem["kind"]>([...CAB_KINDS, "appliance", "plumbing"]);
  const found: { wall: Wall; side: "left" | "right"; count: number }[] = [];
  for (const w of walls) {
    const l = itemsOnFace(doc, w, "left", kinds).length;
    const r = itemsOnFace(doc, w, "right", kinds).length;
    if (l === 0 && r === 0) continue;
    found.push({ wall: w, side: r >= l ? "right" : "left", count: Math.max(l, r) });
  }
  if (!found.length) return [];
  // Clockwise order around the level centre, starting at the first door's wall.
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const c = mul(pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 }), 1 / pts.length);
  const ang = (w: Wall) => {
    const m = midPt(w.a, w.b);
    return Math.atan2(m.y - c.y, m.x - c.x);
  };
  const doorWallId = doc.openings.find((o) => o.kind === "door" && walls.some((w) => w.id === o.wallId))?.wallId;
  const startAng = doorWallId ? ang(walls.find((w) => w.id === doorWallId)!) : -Math.PI;
  const key = (w: Wall) => {
    let a = ang(w) - startAng;
    while (a < 0) a += Math.PI * 2;
    return a;
  };
  found.sort((p, q) => key(p.wall) - key(q.wall));
  return found.map((f, k) => {
    const room = roomOfFace(doc, f.wall, f.side);
    const sign = f.side === "left" ? 1 : -1;
    const compass = compassOf(mul(wallFrame(f.wall).left, sign));
    const letter = String.fromCharCode(65 + (k % 26));
    return { wallId: f.wall.id, side: f.side, label: `${letter} – ${room ? `${room.name} ` : ""}${compass} wall` };
  });
}

/** Section along a SectionLine. v1 renders the wall face nearest the line
 *  (most parallel, on the viewing side, within depthIn) as an elevation. */
export function sectionOps(doc: PlanDoc, sectionId: string): ViewOps | null {
  const s = doc.sections.find((x) => x.id === sectionId);
  if (!s) return null;
  const d = norm(sub(s.b, s.a));
  const look = mul(perp(d), s.flip ? -1 : 1);
  const mid = midPt(s.a, s.b);
  let best: { wall: Wall; dist: number } | null = null;
  for (const w of doc.walls) {
    if (w.levelId !== s.levelId || w.kind === "remove") continue;
    const fr = wallFrame(w);
    if (Math.abs(dot(fr.dir, d)) < 0.85) continue;
    const wm = midPt(w.a, w.b);
    const v = sub(wm, mid);
    const ahead = dot(v, look);
    if (ahead < -0.5 || ahead > s.depthIn) continue;
    // Require some overlap along the line.
    const t0 = dot(sub(w.a, s.a), d);
    const t1 = dot(sub(w.b, s.a), d);
    const sLen = dist(s.a, s.b);
    if (Math.max(t0, t1) < 0 || Math.min(t0, t1) > sLen) continue;
    if (!best || ahead < best.dist) best = { wall: w, dist: ahead };
  }
  if (!best) return null;
  // The face that looks back at the section line.
  const side: "left" | "right" = cross(wallFrame(best.wall).dir, sub(mid, best.wall.a)) < 0 ? "left" : "right";
  const el = elevationOps(doc, { wallId: best.wall.id, side, showTags: true, showDims: true, forPrint: false });
  return { ...el, title: `Section ${s.label}`.trim() };
}
