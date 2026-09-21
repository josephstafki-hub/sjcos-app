"use client";

// Renders DrawOp[] (lib/plan-draw-types.ts) as SVG. DrawOpsSvg returns a <g>
// meant to sit inside the canvas's own pan/zoom group, which is already scaled
// to plan inches — so every coordinate below is emitted in inches directly and
// only line widths / dashes get clamped against pxPerIn so they never vanish.
// opsToSvgString builds the same markup as a standalone <svg> string (PNG
// export / print previews); it omits images.
//
// Conventions shared with lib/plan-draw.ts: rect `rotDeg` rotates about the
// rect centre; arcs sweep from startDeg to endDeg clockwise on screen.

import { createElement, memo, useMemo, type ReactNode } from "react";
import type { DrawBounds, DrawLayer, DrawOp, DrawStyle } from "@/lib/plan-draw-types";
import { DRAW_COLORS } from "@/lib/plan-draw-types";

// ─── Virtual elements (one code path for React and string output) ───────────

type Attrs = Record<string, string | number | undefined>;
interface VEl {
  tag: string;
  attrs: Attrs;
  text?: string;
  children?: VEl[];
}

const FONT: Record<NonNullable<Extract<DrawOp, { t: "text" }>["font"]>, string> = {
  sans: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "var(--font-serif, Georgia, serif)",
};

const BASELINE: Record<NonNullable<Extract<DrawOp, { t: "text" }>["baseline"]>, string> = {
  top: "hanging",
  middle: "central",
  bottom: "alphabetic",
};

const HATCH_CELL_IN = 4;

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function hatchId(kind: NonNullable<DrawStyle["hatch"]>, color: string): string {
  return `hatch-${kind}-${safeId(color)}`;
}

interface Resolved {
  stroke: string;
  strokeWidth: number;
  dash?: string;
  fill: string;
  fillOpacity?: number;
  opacity?: number;
  lineCap?: string;
  hatch?: { kind: NonNullable<DrawStyle["hatch"]>; color: string };
}

function resolveStyle(op: DrawOp, pxPerIn: number): Resolved {
  const s: DrawStyle = op.t === "image" ? {} : op.s;
  const px = 1 / Math.max(pxPerIn, 1e-6);
  const isStrokeOnly = op.t === "line" || op.t === "polyline" || op.t === "arc";
  const stroke = s.stroke ?? (isStrokeOnly ? DRAW_COLORS.ink : "none");
  const strokeWidth = s.strokeWidth === undefined || s.strokeWidth === "hairline" ? px : Math.max(s.strokeWidth, 0.75 * px);
  let dash: string | undefined;
  if (s.dash && s.dash.length) {
    const minSeg = Math.min(...s.dash.filter((d) => d > 0));
    const floor = 2 * px;
    const k = Number.isFinite(minSeg) && minSeg < floor ? floor / minSeg : 1;
    dash = s.dash.map((d) => num(d * k)).join(" ");
  }
  const fill = op.t === "text" ? (s.fill ?? s.stroke ?? DRAW_COLORS.ink) : (s.fill ?? "none");
  const hatch = s.hatch ? { kind: s.hatch, color: s.stroke && s.stroke !== "none" ? s.stroke : DRAW_COLORS.ink } : undefined;
  return { stroke, strokeWidth, dash, fill, fillOpacity: s.fillOpacity, opacity: s.opacity, lineCap: s.lineCap, hatch };
}

function strokeAttrs(r: Resolved): Attrs {
  return {
    stroke: r.stroke,
    strokeWidth: r.stroke === "none" ? undefined : num(r.strokeWidth),
    strokeDasharray: r.dash,
    strokeLinecap: r.lineCap,
    opacity: r.opacity,
  };
}

function ptsAttr(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${num(p.x)},${num(p.y)}`).join(" ");
}

function arcPath(op: Extract<DrawOp, { t: "arc" }>): string {
  const a0 = (op.startDeg * Math.PI) / 180;
  let sweep = op.endDeg - op.startDeg;
  if (sweep >= 360) sweep = 359.999;
  if (sweep <= -360) sweep = -359.999;
  const a1 = ((op.startDeg + sweep) * Math.PI) / 180;
  const sx = op.c.x + op.r * Math.cos(a0);
  const sy = op.c.y + op.r * Math.sin(a0);
  const ex = op.c.x + op.r * Math.cos(a1);
  const ey = op.c.y + op.r * Math.sin(a1);
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  const dir = sweep >= 0 ? 1 : 0;
  return `M ${num(sx)} ${num(sy)} A ${num(op.r)} ${num(op.r)} 0 ${large} ${dir} ${num(ex)} ${num(ey)}`;
}

/** One op → one or two virtual elements (the second is the hatch overlay). */
function opEls(op: DrawOp, pxPerIn: number, hatches: Map<string, VEl>, withImages: boolean): VEl[] {
  const r = resolveStyle(op, pxPerIn);
  const idAttr: Attrs = op.id ? { "data-id": op.id } : {};
  const shape = (tag: string, geo: Attrs): VEl[] => {
    const base: VEl = { tag, attrs: { ...geo, ...strokeAttrs(r), fill: r.fill, fillOpacity: r.fill === "none" ? undefined : r.fillOpacity, ...idAttr } };
    if (!r.hatch) return [base];
    const id = hatchId(r.hatch.kind, r.hatch.color);
    if (!hatches.has(id)) hatches.set(id, hatchPattern(id, r.hatch.kind, r.hatch.color, pxPerIn));
    const overlay: VEl = { tag, attrs: { ...geo, fill: `url(#${id})`, stroke: "none", opacity: r.opacity, ...idAttr } };
    return [base, overlay];
  };
  switch (op.t) {
    case "line":
      return [{ tag: "line", attrs: { x1: num(op.a.x), y1: num(op.a.y), x2: num(op.b.x), y2: num(op.b.y), ...strokeAttrs(r), fill: "none", ...idAttr } }];
    case "polyline":
      if (op.closed) return shape("polygon", { points: ptsAttr(op.pts) });
      return [{ tag: "polyline", attrs: { points: ptsAttr(op.pts), ...strokeAttrs(r), fill: r.fill, fillOpacity: r.fill === "none" ? undefined : r.fillOpacity, ...idAttr } }];
    case "polygon":
      return shape("polygon", { points: ptsAttr(op.pts) });
    case "rect": {
      const geo: Attrs = { x: num(op.x), y: num(op.y), width: num(op.w), height: num(op.h) };
      if (op.rotDeg) geo.transform = `rotate(${num(op.rotDeg)} ${num(op.x + op.w / 2)} ${num(op.y + op.h / 2)})`;
      return shape("rect", geo);
    }
    case "circle":
      return shape("circle", { cx: num(op.c.x), cy: num(op.c.y), r: num(op.r) });
    case "arc":
      return [{ tag: "path", attrs: { d: arcPath(op), ...strokeAttrs(r), fill: r.fill, fillOpacity: r.fill === "none" ? undefined : r.fillOpacity, ...idAttr } }];
    case "text": {
      const attrs: Attrs = {
        x: num(op.p.x),
        y: num(op.p.y),
        fontSize: num(op.size),
        fontFamily: FONT[op.font ?? "sans"],
        fontWeight: op.weight === "bold" ? 700 : undefined,
        textAnchor: op.anchor ?? "start",
        dominantBaseline: BASELINE[op.baseline ?? "middle"],
        fill: r.fill,
        opacity: r.opacity,
        ...idAttr,
      };
      if (op.rotDeg) attrs.transform = `rotate(${num(op.rotDeg)} ${num(op.p.x)} ${num(op.p.y)})`;
      return [{ tag: "text", attrs, text: op.text }];
    }
    case "image": {
      if (!withImages) return [];
      const attrs: Attrs = {
        href: `/api/files/${encodeURIComponent(op.fileId)}`,
        x: num(op.x),
        y: num(op.y),
        width: num(op.w),
        height: num(op.h),
        opacity: op.opacity,
        preserveAspectRatio: "none",
        ...idAttr,
      };
      if (op.rotDeg) attrs.transform = `rotate(${num(op.rotDeg)} ${num(op.x + op.w / 2)} ${num(op.y + op.h / 2)})`;
      return [{ tag: "image", attrs }];
    }
  }
}

function hatchPattern(id: string, kind: NonNullable<DrawStyle["hatch"]>, color: string, pxPerIn: number): VEl {
  const c = HATCH_CELL_IN;
  const sw = num(1 / Math.max(pxPerIn, 1e-6));
  const children: VEl[] = [];
  if (kind === "diag" || kind === "cross") {
    children.push({ tag: "line", attrs: { x1: 0, y1: c, x2: c, y2: 0, stroke: color, strokeWidth: sw } });
  }
  if (kind === "cross") {
    children.push({ tag: "line", attrs: { x1: 0, y1: 0, x2: c, y2: c, stroke: color, strokeWidth: sw } });
  }
  if (kind === "dots") {
    children.push({ tag: "circle", attrs: { cx: c / 2, cy: c / 2, r: num(0.4), fill: color } });
  }
  return { tag: "pattern", attrs: { id, patternUnits: "userSpaceOnUse", width: c, height: c }, children };
}

interface LayerGroup {
  layer: DrawLayer;
  els: VEl[];
}

/** Build the virtual tree: consecutive runs of the same layer become one
 *  group so op order is preserved exactly while layer opacity still applies. */
function buildTree(ops: DrawOp[], pxPerIn: number, withImages: boolean): { groups: LayerGroup[]; defs: VEl[] } {
  const hatches = new Map<string, VEl>();
  const groups: LayerGroup[] = [];
  let cur: LayerGroup | null = null;
  for (const op of ops) {
    if (!cur || cur.layer !== op.layer) {
      cur = { layer: op.layer, els: [] };
      groups.push(cur);
    }
    cur.els.push(...opEls(op, pxPerIn, hatches, withImages));
  }
  return { groups, defs: [...hatches.values()] };
}

// ─── React output ────────────────────────────────────────────────────────────

function toReact(el: VEl, key: string): ReactNode {
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(el.attrs)) if (v !== undefined) props[k] = v;
  const kids = el.text !== undefined ? el.text : el.children?.map((c, i) => toReact(c, `${key}.${i}`));
  return createElement(el.tag, props, kids);
}

export const DrawOpsSvg = memo(function DrawOpsSvg({
  ops,
  pxPerIn,
  layerOpacity,
  className,
}: {
  ops: DrawOp[];
  pxPerIn: number;
  layerOpacity?: Partial<Record<DrawLayer, number>>;
  className?: string;
}) {
  const tree = useMemo(() => buildTree(ops, pxPerIn, true), [ops, pxPerIn]);
  const children = useMemo(
    () =>
      tree.groups.map((g, gi) => {
        const op = layerOpacity?.[g.layer];
        return createElement(
          "g",
          { key: gi, "data-layer": g.layer, opacity: op === undefined || op >= 1 ? undefined : op },
          g.els.map((el, i) => toReact(el, `${gi}.${i}`)),
        );
      }),
    [tree, layerOpacity],
  );
  const defs = useMemo(
    () => (tree.defs.length ? createElement("defs", { key: "defs" }, tree.defs.map((d, i) => toReact(d, `d${i}`))) : null),
    [tree],
  );
  return (
    <g className={className}>
      {defs}
      {children}
    </g>
  );
});

// ─── String output ───────────────────────────────────────────────────────────

const KEBAB = new Set([
  "strokeWidth",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "fillOpacity",
  "fillRule",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "textAnchor",
  "dominantBaseline",
]);

function attrName(k: string): string {
  return KEBAB.has(k) ? k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`) : k;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toString(el: VEl): string {
  const attrs = Object.entries(el.attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${attrName(k)}="${esc(String(v))}"`)
    .join("");
  if (el.text !== undefined) return `<${el.tag}${attrs}>${esc(el.text)}</${el.tag}>`;
  if (el.children?.length) return `<${el.tag}${attrs}>${el.children.map(toString).join("")}</${el.tag}>`;
  return `<${el.tag}${attrs}/>`;
}

/** Standalone SVG document string for the ops (white background, no images). */
export function opsToSvgString(ops: DrawOp[], bounds: DrawBounds, pxPerIn: number, padIn = 6): string {
  const wIn = bounds.max.x - bounds.min.x + padIn * 2;
  const hIn = bounds.max.y - bounds.min.y + padIn * 2;
  const wPx = Math.max(1, Math.ceil(wIn * pxPerIn));
  const hPx = Math.max(1, Math.ceil(hIn * pxPerIn));
  const tree = buildTree(ops, pxPerIn, false);
  const defs = tree.defs.length ? `<defs>${tree.defs.map(toString).join("")}</defs>` : "";
  const groups = tree.groups.map((g) => `<g data-layer="${g.layer}">${g.els.map(toString).join("")}</g>`).join("");
  const tx = num(padIn - bounds.min.x);
  const ty = num(padIn - bounds.min.y);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">` +
    `<rect x="0" y="0" width="${wPx}" height="${hPx}" fill="#ffffff"/>` +
    `<g transform="scale(${num(pxPerIn)}) translate(${tx} ${ty})">${defs}${groups}</g>` +
    `</svg>`
  );
}
