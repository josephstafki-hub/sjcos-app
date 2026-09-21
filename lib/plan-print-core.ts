// Drawing-set renderer for the floor-plan designer (docs/floor-plan-designer-
// plan.md §8). Pure pdfkit over a PlanDoc: no db, no "server-only" marker so
// tests can drive it under plain Node. lib/plan-print.ts re-exports this
// behind `import "server-only"` for app code.
//
// Coordinates: DrawOps are plan inches (y down); each sheet picks a scale
// (points per plan inch) via fitScale and drawOpsToPdf maps ops into a page
// rectangle. Everything else (title block, tables, legends) is laid out in
// PDF points directly. Fonts are the built-in Helvetica family only.

import PDFDocument from "pdfkit";
import { fmtIn, levelSlice, type ElecType, type PlacedItem, type PlanDoc, type Room } from "./plan-doc.ts";
import { DRAW_COLORS, type DrawBounds, type DrawLayer, type DrawOp, type DrawStyle } from "./plan-draw-types.ts";
import { autoElevations, elecSymbolOps, elevationOps, opsBounds, planOps, sectionOps, type PhaseView, type ViewOps } from "./plan-draw.ts";
import { levelBounds, wallFrame } from "./plan-geometry.ts";
import { PAPER_PT, SHEET_LABELS, type Orientation, type PaperSize, type SheetKey } from "./plan-print-types.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export interface PrintCapture {
  fileId: string;
  label: string;
  png: Buffer;
}

export interface PrintInput {
  doc: PlanDoc;
  designName: string;
  /** e.g. "v3" or "v3 · Client review". */
  versionLabel: string;
  dateLabel: string;
  project: { name: string; clientName: string; address: string } | null;
  company: { name: string; license: string; address: string; phone: string; email: string };
  sheets: SheetKey[];
  paper: PaperSize;
  orientation: Orientation;
  captures: PrintCapture[];
  notes: string;
  /** "NOT FOR CONSTRUCTION" watermark until signed. */
  watermark?: string | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Page geometry + palette ─────────────────────────────────────────────────

const MARGIN = 36;
const TITLE_H = 54;
const HEAD_H = 20;
const GAP = 8;
const INK = "#1f2418";
const GRAY = "#6b6b63";
const LIGHT = "#d8d6cd";
const ZEBRA = "#f3f1ea";
const ACCENT = "#4c5a40";
const HAIRLINE = 0.4;
const HATCH_CELL_IN = 4;

const PLAN_TEXT = { title: 11, body: 8, small: 7, tiny: 6 } as const;

/** Standard architectural scales, points per plan inch. */
const SCALES: { ptPerIn: number; label: string }[] = [
  { ptPerIn: 72 / 24, label: '1/2" = 1\'-0"' },
  { ptPerIn: 72 / 32, label: '3/8" = 1\'-0"' },
  { ptPerIn: 72 / 48, label: '1/4" = 1\'-0"' },
  { ptPerIn: 72 / 64, label: '3/16" = 1\'-0"' },
  { ptPerIn: 72 / 96, label: '1/8" = 1\'-0"' },
];

/** Choose a scale (plan inches → points) that fits `boundsIn` inside
 *  `areaPt`, preferring 1/2" = 1' then 1/4" = 1', else 3/8", 3/16", 1/8" (largest
 *  first). If nothing standard fits, a custom "1 : N" scale that fills the area. */
export function fitScale(boundsIn: { w: number; h: number }, areaPt: { w: number; h: number }): { ptPerIn: number; label: string } {
  const w = Math.max(boundsIn.w, 1);
  const h = Math.max(boundsIn.h, 1);
  const fits = (s: number) => w * s <= areaPt.w && h * s <= areaPt.h;
  const order = [SCALES[0], SCALES[2], SCALES[1], SCALES[3], SCALES[4]];
  for (const s of order) if (fits(s.ptPerIn)) return s;
  const s = Math.max(Math.min(areaPt.w / w, areaPt.h / h), 1e-4);
  const ratio = Math.max(1, Math.round(72 / s));
  return { ptPerIn: s, label: `1 : ${ratio}` };
}

// ─── Text safety (built-in fonts are WinAnsi) ────────────────────────────────

const GLYPH_FIX: [RegExp, string][] = [
  [/⅛/g, " 1/8"],
  [/⅜/g, " 3/8"],
  [/⅝/g, " 5/8"],
  [/⅞/g, " 7/8"],
  [/→/g, "->"],
  [/←/g, "<-"],
  [/↑/g, "^"],
  [/↓/g, "v"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/–/g, "-"],
  [/—/g, "—"],
];

function safeText(s: string): string {
  let out = s;
  for (const [re, rep] of GLYPH_FIX) out = out.replace(re, rep);
  return out;
}

function fontFor(font: "sans" | "mono" | "serif" | undefined, bold: boolean): string {
  switch (font) {
    case "mono":
      return bold ? "Courier-Bold" : "Courier";
    case "serif":
      return bold ? "Times-Bold" : "Times-Roman";
    default:
      return bold ? "Helvetica-Bold" : "Helvetica";
  }
}

// ─── DrawOps → pdfkit ────────────────────────────────────────────────────────

type Pdf = PDFKit.PDFDocument;

function isColor(c: string | undefined): c is string {
  return !!c && c !== "none";
}

function lineWidthPt(w: DrawStyle["strokeWidth"], s: number): number {
  if (w === undefined || w === "hairline") return HAIRLINE;
  return Math.max(HAIRLINE, w * s);
}

function applyDash(pdf: Pdf, dash: number[] | undefined, s: number) {
  if (!dash || !dash.length) {
    pdf.undash();
    return;
  }
  const pts = dash.map((d) => d * s);
  const minSeg = Math.min(...pts.filter((d) => d > 0));
  const k = Number.isFinite(minSeg) && minSeg < 1.5 ? 1.5 / minSeg : 1;
  const arr = pts.map((d) => d * k);
  if (arr.every((d) => Number.isFinite(d) && d > 0)) pdf.dash(arr as unknown as number, {});
  else pdf.undash();
}

/** Stroke / fill / hatch a path that `build` traces. */
function paint(pdf: Pdf, st: DrawStyle, s: number, build: () => void, strokeOnly: boolean, bbox: Rect | null) {
  const stroke = st.stroke ?? (strokeOnly ? DRAW_COLORS.ink : "none");
  const fill = strokeOnly ? "none" : (st.fill ?? "none");
  const doStroke = isColor(stroke);
  const doFill = isColor(fill);
  pdf.save();
  if (st.opacity !== undefined && st.opacity < 1) pdf.opacity(st.opacity);
  if (doFill && st.fillOpacity !== undefined && st.fillOpacity < 1) pdf.fillOpacity(st.fillOpacity);
  if (doStroke) {
    pdf.lineWidth(lineWidthPt(st.strokeWidth, s));
    pdf.strokeColor(stroke);
    pdf.lineCap(st.lineCap ?? "butt");
    pdf.lineJoin("miter");
    applyDash(pdf, st.dash, s);
  }
  if (doFill || doStroke) {
    build();
    if (doFill && doStroke) pdf.fillAndStroke(fill, stroke);
    else if (doFill) pdf.fill(fill);
    else pdf.stroke();
  }
  pdf.restore();
  if (st.hatch && bbox && bbox.w > 0 && bbox.h > 0) {
    const color = isColor(st.stroke) ? st.stroke : DRAW_COLORS.ink;
    pdf.save();
    if (st.opacity !== undefined && st.opacity < 1) pdf.opacity(st.opacity);
    build();
    pdf.clip();
    pdf.lineWidth(HAIRLINE).strokeColor(color).undash();
    const cell = Math.max(HATCH_CELL_IN * s, 3);
    const x0 = bbox.x - bbox.h;
    const x1 = bbox.x + bbox.w + bbox.h;
    if (st.hatch === "diag" || st.hatch === "cross") {
      for (let x = x0; x <= x1; x += cell) {
        pdf.moveTo(x, bbox.y + bbox.h).lineTo(x + bbox.h, bbox.y);
      }
      pdf.stroke();
    }
    if (st.hatch === "cross") {
      for (let x = x0; x <= x1; x += cell) {
        pdf.moveTo(x, bbox.y).lineTo(x + bbox.h, bbox.y + bbox.h);
      }
      pdf.stroke();
    }
    if (st.hatch === "dots") {
      pdf.fillColor(color);
      const r = Math.max(0.4 * s, 0.5);
      for (let y = bbox.y + cell / 2; y < bbox.y + bbox.h; y += cell) {
        for (let x = bbox.x + cell / 2; x < bbox.x + bbox.w; x += cell) pdf.circle(x, y, r);
      }
      pdf.fill();
    }
    pdf.restore();
  }
}

function bboxOf(pts: { x: number; y: number }[]): Rect | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Render DrawOps into `area`, plan inches → points at `ptPerIn`, with the
 *  bounds centred in the area. Content is clipped to the area. */
export function drawOpsToPdf(pdf: Pdf, ops: DrawOp[], bounds: DrawBounds, area: Rect, ptPerIn: number): void {
  const s = ptPerIn;
  const bw = (bounds.max.x - bounds.min.x) * s;
  const bh = (bounds.max.y - bounds.min.y) * s;
  const ox = area.x + (area.w - bw) / 2 - bounds.min.x * s;
  const oy = area.y + (area.h - bh) / 2 - bounds.min.y * s;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;
  const P = (p: { x: number; y: number }) => ({ x: X(p.x), y: Y(p.y) });

  pdf.save();
  pdf.rect(area.x, area.y, area.w, area.h).clip();

  for (const op of ops) {
    switch (op.t) {
      case "line": {
        const a = P(op.a), b = P(op.b);
        paint(pdf, op.s, s, () => pdf.moveTo(a.x, a.y).lineTo(b.x, b.y), true, null);
        break;
      }
      case "polyline": {
        if (op.pts.length < 2) break;
        const pts = op.pts.map(P);
        const closedFill = !!op.closed && isColor(op.s.fill);
        paint(
          pdf,
          op.s,
          s,
          () => {
            pdf.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) pdf.lineTo(pts[i].x, pts[i].y);
            if (op.closed) pdf.closePath();
          },
          !closedFill,
          op.closed ? bboxOf(pts) : null,
        );
        break;
      }
      case "polygon": {
        if (op.pts.length < 3) break;
        const pts = op.pts.map(P);
        paint(
          pdf,
          op.s,
          s,
          () => {
            pdf.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) pdf.lineTo(pts[i].x, pts[i].y);
            pdf.closePath();
          },
          false,
          bboxOf(pts),
        );
        break;
      }
      case "rect": {
        const w = op.w * s, h = op.h * s;
        const x = X(op.x), y = Y(op.y);
        if (op.rotDeg) {
          const cx = x + w / 2, cy = y + h / 2;
          pdf.save();
          pdf.translate(cx, cy).rotate(op.rotDeg);
          paint(pdf, op.s, s, () => pdf.rect(-w / 2, -h / 2, w, h), false, { x: -w / 2, y: -h / 2, w, h });
          pdf.restore();
        } else {
          paint(pdf, op.s, s, () => pdf.rect(x, y, w, h), false, { x, y, w, h });
        }
        break;
      }
      case "circle": {
        const c = P(op.c), r = op.r * s;
        paint(pdf, op.s, s, () => pdf.circle(c.x, c.y, r), false, { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r });
        break;
      }
      case "arc": {
        const c = P(op.c), r = op.r * s;
        let sweep = op.endDeg - op.startDeg;
        if (sweep >= 360) sweep = 359.999;
        if (sweep <= -360) sweep = -359.999;
        const n = Math.max(4, Math.ceil(Math.abs(sweep) / 6));
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= n; i++) {
          const a = ((op.startDeg + (sweep * i) / n) * Math.PI) / 180;
          pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
        }
        paint(
          pdf,
          op.s,
          s,
          () => {
            pdf.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) pdf.lineTo(pts[i].x, pts[i].y);
          },
          true,
          null,
        );
        break;
      }
      case "text": {
        const text = safeText(op.text);
        if (!text) break;
        const size = Math.max(op.size * s, 1.5);
        const p = P(op.p);
        const color = op.s.fill ?? op.s.stroke ?? DRAW_COLORS.ink;
        pdf.save();
        if (op.s.opacity !== undefined && op.s.opacity < 1) pdf.opacity(op.s.opacity);
        pdf.font(fontFor(op.font, op.weight === "bold")).fontSize(size).fillColor(isColor(color) ? color : DRAW_COLORS.ink);
        const w = pdf.widthOfString(text);
        const dx = op.anchor === "middle" ? -w / 2 : op.anchor === "end" ? -w : 0;
        const baseline = op.baseline === "top" ? "top" : op.baseline === "bottom" ? "alphabetic" : "middle";
        pdf.translate(p.x, p.y);
        if (op.rotDeg) pdf.rotate(op.rotDeg);
        pdf.text(text, dx, 0, { lineBreak: false, baseline });
        pdf.restore();
        break;
      }
      case "image":
        // Underlays reference a file id; print never embeds them.
        break;
    }
  }
  pdf.restore();
}

// ─── Sheet context ───────────────────────────────────────────────────────────

interface PageMeta {
  sheet: SheetKey;
  title: string;
  sub: string;
  scale: string;
}

interface Ctx {
  pdf: Pdf;
  input: PrintInput;
  doc: PlanDoc;
  W: number;
  H: number;
  /** Full content area above the title block (below the sheet heading). */
  area: Rect;
  pages: PageMeta[];
  /** Cover index box to fill in once page numbers are known. */
  coverIndex: Rect | null;
}

function newPage(ctx: Ctx, meta: PageMeta): Rect {
  ctx.pdf.addPage({ size: [ctx.W, ctx.H], margin: 0 });
  ctx.pages.push(meta);
  const { pdf } = ctx;
  pdf.font("Helvetica-Bold").fontSize(PLAN_TEXT.title).fillColor(INK);
  pdf.text(safeText(meta.title.toUpperCase()), MARGIN, MARGIN, { lineBreak: false, characterSpacing: 0.4 });
  if (meta.sub) {
    const tw = pdf.widthOfString(meta.title.toUpperCase());
    pdf.font("Helvetica").fontSize(PLAN_TEXT.body).fillColor(GRAY);
    pdf.text(safeText(meta.sub), MARGIN + tw + 10, MARGIN + 2.5, { lineBreak: false });
  }
  pdf.strokeColor(LIGHT).lineWidth(0.5).undash();
  pdf.moveTo(MARGIN, MARGIN + HEAD_H - 4).lineTo(ctx.W - MARGIN, MARGIN + HEAD_H - 4).stroke();
  return { ...ctx.area };
}

function setScale(ctx: Ctx, label: string) {
  const meta = ctx.pages[ctx.pages.length - 1];
  if (!meta) return;
  if (!meta.scale) meta.scale = label;
  else if (meta.scale !== label) meta.scale = "As noted";
}

function levelName(ctx: Ctx, levelId: string): string {
  const l = ctx.doc.levels.find((x) => x.id === levelId);
  return l?.name || levelId;
}

function levelsOf(ctx: Ctx) {
  return ctx.doc.levels.length ? ctx.doc.levels : [{ id: "L1", name: "Main", elevationIn: 0, ceilingIn: 96 }];
}

// ─── Small drawing helpers (points) ──────────────────────────────────────────

/** Truncate `text` (already safe) with an ellipsis so it fits `width` at the
 *  current font. pdfkit's own ellipsis option wraps first, which breaks
 *  single-line cells. */
function fitText(pdf: Pdf, text: string, width: number): string {
  if (pdf.widthOfString(text) <= width) return text;
  let t = text;
  while (t.length > 1 && pdf.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
  return t.length > 1 ? `${t}…` : t;
}

function label(pdf: Pdf, text: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: string; width?: number; align?: "left" | "center" | "right" } = {}) {
  pdf.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? PLAN_TEXT.body).fillColor(o.color ?? INK);
  if (o.width) pdf.text(fitText(pdf, safeText(text), o.width), x, y, { width: o.width, align: o.align ?? "left", lineBreak: false });
  else pdf.text(safeText(text), x, y, { lineBreak: false });
}

function boxTitle(pdf: Pdf, text: string, x: number, y: number, w: number): number {
  label(pdf, text.toUpperCase(), x, y, { size: PLAN_TEXT.small, bold: true, color: ACCENT, width: w });
  pdf.strokeColor(LIGHT).lineWidth(0.5).undash().moveTo(x, y + 11).lineTo(x + w, y + 11).stroke();
  return y + 15;
}

function paragraph(pdf: Pdf, text: string, x: number, y: number, w: number, size = PLAN_TEXT.body): number {
  pdf.font("Helvetica").fontSize(size).fillColor(INK);
  const t = safeText(text);
  const h = pdf.heightOfString(t, { width: w });
  pdf.text(t, x, y, { width: w });
  return y + h;
}

interface Col {
  label: string;
  /** Relative width. */
  w: number;
  align?: "left" | "right";
}

interface TableOpts {
  fontSize?: number;
  /** Bottom limit; rows beyond it either continue on a new page or truncate. */
  maxY: number;
  /** Return the y to continue at on a fresh page, or null to truncate. */
  next?: (() => number) | null;
}

/** Zebra table with a header row; returns the y after the last row. */
function table(pdf: Pdf, x: number, y: number, w: number, cols: Col[], rows: string[][], o: TableOpts): number {
  const fs = o.fontSize ?? PLAN_TEXT.small;
  const rowH = fs + 5;
  const total = cols.reduce((s, c) => s + c.w, 0) || 1;
  const widths = cols.map((c) => (c.w / total) * w);
  const pad = 3;
  const header = (yy: number) => {
    pdf.rect(x, yy, w, rowH).fill(ACCENT);
    pdf.font("Helvetica-Bold").fontSize(fs).fillColor("#ffffff");
    let cx = x;
    cols.forEach((c, i) => {
      pdf.text(fitText(pdf, safeText(c.label), widths[i] - 2 * pad), cx + pad, yy + 2.5, { width: widths[i] - 2 * pad, align: c.align ?? "left", lineBreak: false });
      cx += widths[i];
    });
    return yy + rowH;
  };
  let yy = header(y);
  for (let r = 0; r < rows.length; r++) {
    if (yy + rowH > o.maxY) {
      if (o.next) {
        yy = header(o.next());
      } else {
        const left = rows.length - r;
        pdf.font("Helvetica-Oblique").fontSize(fs).fillColor(GRAY);
        pdf.text(`… ${left} more (see Schedules)`, x + pad, yy + 1, { lineBreak: false });
        return yy + rowH;
      }
    }
    if (r % 2 === 1) pdf.rect(x, yy, w, rowH).fill(ZEBRA);
    pdf.font("Helvetica").fontSize(fs).fillColor(INK);
    let cx = x;
    cols.forEach((c, i) => {
      pdf.text(fitText(pdf, safeText(rows[r][i] ?? ""), widths[i] - 2 * pad), cx + pad, yy + 2.5, { width: widths[i] - 2 * pad, align: c.align ?? "left", lineBreak: false });
      cx += widths[i];
    });
    yy += rowH;
  }
  pdf.strokeColor(LIGHT).lineWidth(0.5).undash().rect(x, y, w, yy - y).stroke();
  return yy + 4;
}

// ─── Doc queries shared by sheets ────────────────────────────────────────────

const CAB_KINDS = new Set<PlacedItem["kind"]>(["base", "wall", "tall", "vanity", "island"]);
const ELEC_LABELS: Record<ElecType, string> = {
  outlet: "Duplex outlet",
  gfci: "GFCI outlet",
  outlet240: "240V outlet",
  switch: "Switch",
  switch3: "3-way switch",
  dimmer: "Dimmer",
  recessed: "Recessed light",
  pendant: "Pendant",
  sconce: "Sconce",
  underCab: "Under-cabinet light",
  surface: "Surface light",
  fan: "Fan",
  panel: "Panel",
  smoke: "Smoke / CO detector",
  data: "Data / low-voltage",
  register: "Supply register",
  return: "Return air",
  exhaust: "Exhaust fan",
  miniSplit: "Mini-split head",
};
const ELEC_ORDER: ElecType[] = [
  "outlet", "gfci", "outlet240", "switch", "switch3", "dimmer", "recessed", "pendant", "sconce", "underCab",
  "surface", "fan", "panel", "smoke", "data", "register", "return", "exhaust", "miniSplit",
];

function phaseLabel(p: string): string {
  return p === "remove" ? "Remove" : p === "new" ? "New" : p === "relocate" ? "Relocate" : "Existing";
}

function nominal(i: PlacedItem): string {
  const n = (v: number) => fmtIn(v, { inchesOnly: true, frac: 4 });
  return `${n(i.w)} × ${n(i.h)} × ${n(i.d)}`;
}

function propStr(i: PlacedItem, key: string): string {
  const v = i.props?.[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function wallLabel(ctx: Ctx, wallId: string | null | undefined): string {
  if (!wallId) return "—";
  const w = ctx.doc.walls.find((x) => x.id === wallId);
  if (!w) return "—";
  const idx = ctx.doc.walls.filter((x) => x.levelId === w.levelId).findIndex((x) => x.id === w.id);
  const fr = wallFrame(w);
  const horiz = Math.abs(fr.dir.x) >= Math.abs(fr.dir.y);
  return `Wall ${idx + 1} (${horiz ? "E–W" : "N–S"})`;
}

function roomWallFinishes(doc: PlanDoc, room: Room): string {
  const set = new Set<string>();
  for (const f of doc.finishes) {
    if (f.target !== "wall") continue;
    if (f.roomId === room.id || (f.wallId && room.wallIds.includes(f.wallId))) set.add(f.material.label);
  }
  if (!set.size) {
    for (const wid of room.wallIds) {
      const w = doc.walls.find((x) => x.id === wid);
      const l = w?.faces?.left?.label, r = w?.faces?.right?.label;
      if (l) set.add(l);
      if (r) set.add(r);
    }
  }
  return [...set].join(", ") || "—";
}

// ─── Plan sheets ─────────────────────────────────────────────────────────────

const PLAN_LAYERS: Record<"full" | "cabinet" | "electrical" | "finish", DrawLayer[]> = {
  full: [
    "underlay", "rooms", "finishes", "walls", "openings", "structure", "stairs", "cabinets", "counters",
    "appliances", "plumbing", "hvac", "furniture", "trim", "electrical", "lighting", "dims", "notes",
  ],
  cabinet: ["walls", "openings", "cabinets", "counters", "appliances", "plumbing", "dims", "notes"],
  electrical: ["walls", "openings", "cabinets", "electrical", "lighting", "hvac"],
  finish: ["walls", "openings", "finishes", "rooms", "notes"],
};

function planFor(ctx: Ctx, levelId: string, phase: PhaseView, layers: DrawLayer[], showTags: boolean, showRoomLabels = true): { ops: DrawOp[]; bounds: DrawBounds | null } {
  const ops = planOps(ctx.doc, {
    levelId,
    phase,
    layers: new Set(layers),
    showTags,
    showDims: true,
    showRoomLabels,
    forPrint: true,
  });
  const b = opsBounds(ops) ?? levelBounds(ctx.doc, levelId);
  return { ops, bounds: b };
}

/** Draw a plan in `rect` (with breathing room), choosing the scale. */
function placePlan(ctx: Ctx, ops: DrawOp[], bounds: DrawBounds | null, rect: Rect): string {
  const { pdf } = ctx;
  if (!bounds || !ops.length) {
    label(pdf, "Nothing drawn on this level.", rect.x, rect.y, { color: GRAY });
    return "";
  }
  const pad = 12;
  const inner = { x: rect.x + pad, y: rect.y + pad, w: Math.max(rect.w - 2 * pad, 10), h: Math.max(rect.h - 2 * pad, 10) };
  const bw = bounds.max.x - bounds.min.x;
  const bh = bounds.max.y - bounds.min.y;
  const sc = fitScale({ w: bw, h: bh }, { w: inner.w, h: inner.h });
  drawOpsToPdf(pdf, ops, bounds, inner, sc.ptPerIn);
  setScale(ctx, sc.label);
  return sc.label;
}

function legendSample(pdf: Pdf, kind: "existing" | "demo" | "new" | "door" | "window", x: number, y: number) {
  const w = 26, h = 6;
  pdf.save();
  pdf.undash().lineCap("butt");
  switch (kind) {
    case "existing":
      pdf.rect(x, y, w, h).fillAndStroke("#9a9a92", INK);
      break;
    case "demo":
      pdf.lineWidth(0.5).strokeColor(DRAW_COLORS.demo);
      pdf.dash(2, { space: 1.5 });
      pdf.rect(x, y, w, h).stroke();
      pdf.undash();
      pdf.save();
      pdf.rect(x, y, w, h).clip();
      for (let xx = x - h; xx < x + w + h; xx += 3) pdf.moveTo(xx, y + h).lineTo(xx + h, y);
      pdf.stroke();
      pdf.restore();
      break;
    case "new":
      pdf.lineWidth(1.2).strokeColor(INK).rect(x, y, w, h).fillAndStroke(INK, INK);
      break;
    case "door":
      pdf.lineWidth(0.6).strokeColor(INK);
      pdf.moveTo(x, y + h).lineTo(x, y - 12).stroke();
      pdf.moveTo(x, y - 12);
      for (let i = 0; i <= 12; i++) {
        const a = (-90 + (90 * i) / 12) * (Math.PI / 180);
        const px = x + 18 * Math.cos(a + Math.PI / 2), py = y + h + 18 * Math.sin(a + Math.PI / 2) - 18;
        if (i === 0) pdf.moveTo(px, py);
        else pdf.lineTo(px, py);
      }
      pdf.stroke();
      break;
    case "window":
      pdf.lineWidth(0.5).strokeColor(INK);
      pdf.rect(x, y, w, h).stroke();
      pdf.moveTo(x, y + h / 2).lineTo(x + w, y + h / 2).stroke();
      break;
  }
  pdf.restore();
}

function planLegend(ctx: Ctx, x: number, y: number, w: number): number {
  const { pdf } = ctx;
  let yy = boxTitle(pdf, "Legend", x, y, w);
  const rows: [Parameters<typeof legendSample>[1], string][] = [
    ["existing", "Existing wall to remain"],
    ["demo", "Wall / item to be removed (demo)"],
    ["new", "New construction"],
    ["door", "Door with swing"],
    ["window", "Window"],
  ];
  for (const [k, t] of rows) {
    legendSample(pdf, k, x + 2, yy + 2);
    label(pdf, t, x + 36, yy + 1, { size: PLAN_TEXT.small, width: w - 38 });
    yy += 14;
  }
  return yy + 4;
}

function runTable(ctx: Ctx, levelId: string, x: number, y: number, w: number, maxY: number): number {
  const { pdf, doc } = ctx;
  const slice = levelSlice(doc, levelId);
  const rows = slice.runs.map((r) => {
    const items = r.itemIds.map((id) => doc.items.find((i) => i.id === id)).filter((i): i is PlacedItem => !!i);
    const lf = items.reduce((s, i) => s + i.w, 0) / 12;
    return [wallLabel(ctx, r.wallId), r.tier, lf.toFixed(1), items.map((i) => i.tag || i.label).join(", ")];
  });
  let yy = boxTitle(pdf, "Cabinet runs", x, y, w);
  if (!rows.length) {
    label(pdf, "No runs on this level.", x, yy, { size: PLAN_TEXT.small, color: GRAY });
    return yy + 12;
  }
  yy = table(pdf, x, yy, w, [{ label: "Wall", w: 3 }, { label: "Tier", w: 1.4 }, { label: "LF", w: 1, align: "right" }, { label: "Items", w: 5 }], rows, { maxY });
  return yy;
}

function elecPanel(ctx: Ctx, levelId: string, x: number, y: number, w: number, maxY: number): number {
  const { pdf, doc } = ctx;
  const devices = levelSlice(doc, levelId).electrical;
  const counts = new Map<ElecType, number>();
  for (const d of devices) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  const types = ELEC_ORDER.filter((t) => counts.has(t));
  let yy = boxTitle(pdf, "Symbol legend", x, y, w);
  if (!types.length) {
    label(pdf, "No devices on this level.", x, yy, { size: PLAN_TEXT.small, color: GRAY });
    return yy + 12;
  }
  const symScale = 2; // 6" symbol → 12pt
  for (const t of types) {
    if (yy + 14 > maxY) break;
    const ops = elecSymbolOps(t, { x: 0, y: 0 }, "electrical", { stroke: INK });
    const b = opsBounds(ops) ?? { min: { x: -3, y: -3 }, max: { x: 3, y: 3 } };
    drawOpsToPdf(pdf, ops, b, { x: x + 1, y: yy, w: 16, h: 13 }, symScale);
    label(pdf, `${ELEC_LABELS[t]}`, x + 22, yy + 2, { size: PLAN_TEXT.small, width: w - 24 });
    yy += 14;
  }
  yy += 4;
  yy = boxTitle(pdf, "Device count", x, yy, w);
  const rows = types.map((t) => [ELEC_LABELS[t], String(counts.get(t) ?? 0)]);
  return table(pdf, x, yy, w, [{ label: "Device", w: 4 }, { label: "Qty", w: 1, align: "right" }], rows, { maxY });
}

function finishSchedule(ctx: Ctx, levelId: string | null, x: number, y: number, w: number, o: TableOpts): number {
  const { pdf, doc } = ctx;
  const rooms = doc.rooms.filter((r) => !levelId || r.levelId === levelId);
  const yy = boxTitle(pdf, "Finish schedule", x, y, w);
  if (!rooms.length) {
    label(pdf, "No rooms detected.", x, yy, { size: PLAN_TEXT.small, color: GRAY });
    return yy + 12;
  }
  const rows = rooms.map((r) => [
    r.name,
    r.floor?.label || "—",
    r.ceiling?.label || "—",
    roomWallFinishes(doc, r),
    String(Math.round(r.areaSf)),
  ]);
  return table(
    pdf,
    x,
    yy,
    w,
    [
      { label: "Room", w: 2 },
      { label: "Floor", w: 2 },
      { label: "Ceiling", w: 2 },
      { label: "Walls", w: 2.6 },
      { label: "SF", w: 1.1, align: "right" },
    ],
    rows,
    o,
  );
}

type PlanSheet = Exclude<SheetKey, "cover" | "elevations" | "sections" | "views" | "schedules" | "notes">;

function renderPlanSheet(ctx: Ctx, sheet: PlanSheet) {
  for (const level of levelsOf(ctx)) {
    const sub = ctx.doc.levels.length > 1 ? level.name : "";
    const rect = newPage(ctx, { sheet, title: SHEET_LABELS[sheet], sub, scale: "" });
    const panelW = Math.min(Math.max(rect.w * 0.28, 150), 260);
    const withPanel = sheet !== "existing";
    const drawRect: Rect = withPanel ? { x: rect.x, y: rect.y, w: rect.w - panelW - GAP, h: rect.h } : rect;
    const px = rect.x + rect.w - panelW;
    const maxY = rect.y + rect.h;

    switch (sheet) {
      case "existing": {
        const { ops, bounds } = planFor(ctx, level.id, "existing", PLAN_LAYERS.full, false);
        placePlan(ctx, ops, bounds, drawRect);
        break;
      }
      case "demo": {
        const { ops, bounds } = planFor(ctx, level.id, "demo", PLAN_LAYERS.full, false);
        placePlan(ctx, ops, bounds, drawRect);
        let yy = planLegend(ctx, px, rect.y, panelW);
        yy = boxTitle(ctx.pdf, "Demo notes", px, yy + 4, panelW);
        const notes = demoNotes(ctx.doc, level.id);
        if (!notes.length) label(ctx.pdf, "Nothing marked for removal.", px, yy, { size: PLAN_TEXT.small, color: GRAY });
        for (const n of notes) {
          if (yy + 11 > maxY) break;
          label(ctx.pdf, `• ${n}`, px, yy, { size: PLAN_TEXT.small, width: panelW });
          yy += 11;
        }
        break;
      }
      case "new": {
        const { ops, bounds } = planFor(ctx, level.id, "new", PLAN_LAYERS.full, true);
        placePlan(ctx, ops, bounds, drawRect);
        planLegend(ctx, px, rect.y, panelW);
        break;
      }
      case "cabinet": {
        const { ops, bounds } = planFor(ctx, level.id, "new", PLAN_LAYERS.cabinet, true, false);
        placePlan(ctx, ops, bounds, drawRect);
        runTable(ctx, level.id, px, rect.y, panelW, maxY);
        break;
      }
      case "electrical": {
        const { ops, bounds } = planFor(ctx, level.id, "new", PLAN_LAYERS.electrical, false, false);
        placePlan(ctx, ops, bounds, drawRect);
        elecPanel(ctx, level.id, px, rect.y, panelW, maxY);
        break;
      }
      case "finish": {
        const { ops, bounds } = planFor(ctx, level.id, "new", PLAN_LAYERS.finish, false, true);
        placePlan(ctx, ops, bounds, drawRect);
        finishSchedule(ctx, level.id, px, rect.y, panelW, { maxY });
        break;
      }
    }
  }
}

function demoNotes(doc: PlanDoc, levelId: string): string[] {
  const out: string[] = [];
  const walls = doc.walls.filter((w) => w.levelId === levelId && w.kind === "remove");
  walls.forEach((w, i) => out.push(`Remove wall ${i + 1}: ${fmtIn(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))} long, ${fmtIn(w.heightIn)} high`));
  const wallIds = new Set(doc.walls.filter((w) => w.levelId === levelId).map((w) => w.id));
  for (const o of doc.openings) {
    if (!wallIds.has(o.wallId) || o.phase !== "remove") continue;
    out.push(`Remove ${o.kind} ${o.tag || ""} (${fmtIn(o.widthIn, { inchesOnly: true })} × ${fmtIn(o.heightIn, { inchesOnly: true })})`.replace("  ", " "));
  }
  for (const i of doc.items) {
    if (i.levelId !== levelId || i.phase !== "remove") continue;
    out.push(`Remove ${i.label}${i.tag ? ` (${i.tag})` : ""}`);
  }
  for (const i of doc.items) {
    if (i.levelId !== levelId || i.phase !== "relocate") continue;
    out.push(`Relocate ${i.label}${i.tag ? ` (${i.tag})` : ""}`);
  }
  for (const d of doc.electrical) {
    if (d.levelId !== levelId || d.phase !== "remove") continue;
    out.push(`Remove ${ELEC_LABELS[d.type].toLowerCase()}`);
  }
  return out;
}

// ─── Elevations / sections ───────────────────────────────────────────────────

function viewsPerPage(paper: PaperSize): { per: number; cols: number } {
  if (paper === "letter") return { per: 2, cols: 1 };
  if (paper === "tabloid") return { per: 4, cols: 2 };
  return { per: 6, cols: 2 };
}

function renderViewGrid(ctx: Ctx, sheet: SheetKey, views: { view: ViewOps; sub: string }[]) {
  if (!views.length) return;
  const { per, cols } = viewsPerPage(ctx.input.paper);
  const rows = Math.ceil(per / cols);
  for (let start = 0; start < views.length; start += per) {
    const page = views.slice(start, start + per);
    const rect = newPage(ctx, { sheet, title: SHEET_LABELS[sheet], sub: page[0].sub, scale: "" });
    const cellW = (rect.w - GAP * (cols - 1)) / cols;
    const cellH = (rect.h - GAP * (rows - 1)) / rows;
    page.forEach((v, k) => {
      const c = k % cols, r = Math.floor(k / cols);
      const cx = rect.x + c * (cellW + GAP), cy = rect.y + r * (cellH + GAP);
      ctx.pdf.strokeColor(LIGHT).lineWidth(0.5).undash().rect(cx, cy, cellW, cellH).stroke();
      label(ctx.pdf, v.view.title, cx + 6, cy + 5, { bold: true, size: PLAN_TEXT.body, width: cellW - 12 });
      const inner: Rect = { x: cx + 4, y: cy + 18, w: cellW - 8, h: cellH - 32 };
      const b = opsBounds(v.view.ops) ?? { min: { x: 0, y: 0 }, max: { x: v.view.widthIn || 1, y: v.view.heightIn || 1 } };
      const sc = placePlan(ctx, v.view.ops, b, inner);
      if (sc) label(ctx.pdf, `Scale ${sc}`, cx + 6, cy + cellH - 11, { size: PLAN_TEXT.tiny, color: GRAY });
    });
  }
}

function renderElevations(ctx: Ctx) {
  const views: { view: ViewOps; sub: string }[] = [];
  for (const level of levelsOf(ctx)) {
    for (const e of autoElevations(ctx.doc, level.id)) {
      const view = elevationOps(ctx.doc, { wallId: e.wallId, side: e.side, showTags: true, showDims: true, forPrint: true });
      if (!view.ops.length) continue;
      views.push({ view: { ...view, title: e.label || view.title }, sub: ctx.doc.levels.length > 1 ? level.name : "" });
    }
  }
  if (!views.length) {
    const rect = newPage(ctx, { sheet: "elevations", title: SHEET_LABELS.elevations, sub: "", scale: "" });
    label(ctx.pdf, "No walls carry cabinets, appliances, or fixtures yet — elevations appear once items are placed against a wall.", rect.x, rect.y, { color: GRAY });
    return;
  }
  renderViewGrid(ctx, "elevations", views);
}

function renderSections(ctx: Ctx) {
  const views: { view: ViewOps; sub: string }[] = [];
  for (const s of ctx.doc.sections) {
    const v = sectionOps(ctx.doc, s.id);
    if (!v || !v.ops.length) continue;
    views.push({ view: { ...v, title: s.label ? `Section ${s.label}` : v.title }, sub: ctx.doc.levels.length > 1 ? levelName(ctx, s.levelId) : "" });
  }
  renderViewGrid(ctx, "sections", views);
}

// ─── 3D views ────────────────────────────────────────────────────────────────

function drawCapture(ctx: Ctx, cap: PrintCapture, rect: Rect) {
  const { pdf } = ctx;
  const inner: Rect = { x: rect.x + 4, y: rect.y + 4, w: rect.w - 8, h: rect.h - 24 };
  try {
    pdf.image(cap.png, inner.x, inner.y, { fit: [inner.w, inner.h], align: "center", valign: "center" });
  } catch {
    label(pdf, `Capture ${cap.label || cap.fileId} could not be embedded.`, inner.x, inner.y, { color: GRAY });
  }
  pdf.strokeColor(LIGHT).lineWidth(0.5).undash().rect(rect.x, rect.y, rect.w, rect.h).stroke();
  label(pdf, cap.label || "3D view", rect.x + 6, rect.y + rect.h - 14, { bold: true, width: rect.w - 12 });
}

function renderViews(ctx: Ctx) {
  const caps = ctx.input.captures;
  if (!caps.length) return;
  const per = ctx.input.paper === "letter" ? 1 : 2;
  for (let start = 0; start < caps.length; start += per) {
    const page = caps.slice(start, start + per);
    const rect = newPage(ctx, { sheet: "views", title: SHEET_LABELS.views, sub: "", scale: "NTS" });
    if (page.length === 1) {
      drawCapture(ctx, page[0], rect);
      continue;
    }
    // Split along the longer side.
    if (rect.w >= rect.h) {
      const w = (rect.w - GAP) / 2;
      drawCapture(ctx, page[0], { x: rect.x, y: rect.y, w, h: rect.h });
      drawCapture(ctx, page[1], { x: rect.x + w + GAP, y: rect.y, w, h: rect.h });
    } else {
      const h = (rect.h - GAP) / 2;
      drawCapture(ctx, page[0], { x: rect.x, y: rect.y, w: rect.w, h });
      drawCapture(ctx, page[1], { x: rect.x, y: rect.y + h + GAP, w: rect.w, h });
    }
  }
}

// ─── Schedules ───────────────────────────────────────────────────────────────

function renderSchedules(ctx: Ctx) {
  const { pdf, doc } = ctx;
  let rect = newPage(ctx, { sheet: "schedules", title: SHEET_LABELS.schedules, sub: "", scale: "—" });
  let y = rect.y;
  const maxY = () => rect.y + rect.h;
  const next = () => {
    rect = newPage(ctx, { sheet: "schedules", title: SHEET_LABELS.schedules, sub: "continued", scale: "—" });
    y = rect.y;
    return y;
  };
  const section = (title: string, cols: Col[], rows: string[][]) => {
    if (!rows.length) return;
    if (y + 44 > maxY()) next();
    y = boxTitle(pdf, title, rect.x, y, rect.w);
    y = table(pdf, rect.x, y, rect.w, cols, rows, { maxY: maxY(), next }) + 8;
  };
  const size = (o: { widthIn: number; heightIn: number }) => `${fmtIn(o.widthIn, { inchesOnly: true })} × ${fmtIn(o.heightIn, { inchesOnly: true })}`;
  const multi = doc.levels.length > 1;
  const lvl = (id: string) => (multi ? levelName(ctx, id) : "");
  const wallLevel = (wallId: string) => doc.walls.find((w) => w.id === wallId)?.levelId ?? "";

  const doors = doc.openings.filter((o) => o.kind === "door" || o.kind === "opening");
  section(
    "Door schedule",
    [{ label: "Tag", w: 1 }, { label: "Size (W × H)", w: 2 }, { label: "Type", w: 2 }, { label: "Hand / swing", w: 1.6 }, { label: "Phase", w: 1.2 }, ...(multi ? [{ label: "Level", w: 1.2 }] : [])],
    doors.map((o) => [o.tag || "—", size(o), o.kind === "opening" ? `Cased opening · ${o.subtype}` : o.subtype, o.kind === "door" ? `${o.hand} / ${o.swing}` : "—", phaseLabel(o.phase), ...(multi ? [lvl(wallLevel(o.wallId))] : [])]),
  );
  const windows = doc.openings.filter((o) => o.kind === "window");
  section(
    "Window schedule",
    [{ label: "Tag", w: 1 }, { label: "Size (W × H)", w: 2 }, { label: "Sill", w: 1 }, { label: "Type", w: 2 }, { label: "Phase", w: 1.2 }, ...(multi ? [{ label: "Level", w: 1.2 }] : [])],
    windows.map((o) => [o.tag || "—", size(o), fmtIn(o.sillIn, { inchesOnly: true }), o.subtype, phaseLabel(o.phase), ...(multi ? [lvl(wallLevel(o.wallId))] : [])]),
  );

  const cabs = doc.items.filter((i) => CAB_KINDS.has(i.kind) && i.phase !== "remove");
  const grouped = new Map<string, { item: PlacedItem; qty: number }>();
  for (const c of cabs) {
    const key = `${c.tag}|${c.label}|${c.w}|${c.h}|${c.d}`;
    const cur = grouped.get(key);
    if (cur) cur.qty += 1;
    else grouped.set(key, { item: c, qty: 1 });
  }
  section(
    "Cabinet schedule",
    [{ label: "Tag", w: 1 }, { label: "Kind", w: 1 }, { label: "Nominal (W × H × D)", w: 2.2 }, { label: "Product", w: 3 }, { label: "Finish", w: 1.8 }, { label: "Qty", w: 0.7, align: "right" }],
    [...grouped.values()].map(({ item: c, qty }) => [
      c.tag || "—",
      c.kind,
      nominal(c),
      c.catalogId != null ? c.label : `${c.label} (allowance)`,
      propStr(c, "finish") || propStr(c, "doorStyle") || "—",
      String(qty),
    ]),
  );

  const simpleItems = (kind: PlacedItem["kind"], title: string) => {
    const items = doc.items.filter((i) => i.kind === kind && i.phase !== "remove");
    section(
      title,
      [{ label: "Tag", w: 1 }, { label: "Item", w: 3 }, { label: "Size (W × D × H)", w: 2.2 }, { label: "Notes", w: 2.5 }, { label: "Phase", w: 1.2 }],
      items.map((i) => [
        i.tag || "—",
        i.label,
        `${fmtIn(i.w, { inchesOnly: true })} × ${fmtIn(i.d, { inchesOnly: true })} × ${fmtIn(i.h, { inchesOnly: true })}`,
        [propStr(i, "power"), propStr(i, "venting"), propStr(i, "fuel")].filter(Boolean).join(", ") || (i.catalogId == null ? "allowance" : ""),
        phaseLabel(i.phase),
      ]),
    );
  };
  simpleItems("appliance", "Appliance schedule");
  simpleItems("plumbing", "Plumbing fixture schedule");

  const counts = new Map<ElecType, number>();
  for (const d of doc.electrical) if (d.phase !== "remove") counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  section(
    "Electrical device counts",
    [{ label: "Device", w: 3 }, { label: "Qty", w: 1, align: "right" }],
    ELEC_ORDER.filter((t) => counts.has(t)).map((t) => [ELEC_LABELS[t], String(counts.get(t))]),
  );

  if (doc.rooms.length) {
    if (y + 44 > maxY()) next();
    y = finishSchedule(ctx, null, rect.x, y, rect.w, { maxY: maxY(), next }) + 8;
  }
  section(
    "Room schedule",
    [{ label: "Room", w: 2.5 }, { label: "Area (sf)", w: 1, align: "right" }, { label: "Perimeter (lf)", w: 1.2, align: "right" }, { label: "Ceiling", w: 1.2 }, ...(multi ? [{ label: "Level", w: 1.2 }] : [])],
    doc.rooms.map((r) => [r.name, String(Math.round(r.areaSf)), r.perimLf.toFixed(1), r.ceilingIn != null ? fmtIn(r.ceilingIn) : "—", ...(multi ? [lvl(r.levelId)] : [])]),
  );
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function renderNotes(ctx: Ctx) {
  const { pdf, doc, input } = ctx;
  let rect = newPage(ctx, { sheet: "notes", title: SHEET_LABELS.notes, sub: "", scale: "—" });
  let y = rect.y;
  const colW = Math.min(rect.w, 460);
  const ensure = (h: number) => {
    if (y + h > rect.y + rect.h) {
      rect = newPage(ctx, { sheet: "notes", title: SHEET_LABELS.notes, sub: "continued", scale: "—" });
      y = rect.y;
    }
  };
  const bullets = (title: string, lines: string[], empty: string) => {
    ensure(40);
    y = boxTitle(pdf, title, rect.x, y, colW);
    if (!lines.length) {
      label(pdf, empty, rect.x, y, { color: GRAY });
      y += 14;
    }
    for (const l of lines) {
      pdf.font("Helvetica").fontSize(PLAN_TEXT.body);
      const h = pdf.heightOfString(safeText(`• ${l}`), { width: colW });
      ensure(h + 2);
      y = paragraph(pdf, `• ${l}`, rect.x, y, colW) + 2;
    }
    y += 10;
  };

  y = boxTitle(pdf, "General notes", rect.x, y, colW);
  const general = input.notes.trim();
  if (general) {
    for (const para of general.split(/\n{2,}/)) {
      pdf.font("Helvetica").fontSize(PLAN_TEXT.body);
      const h = pdf.heightOfString(safeText(para), { width: colW });
      ensure(h + 4);
      y = paragraph(pdf, para, rect.x, y, colW) + 6;
    }
  } else {
    label(pdf, "No general notes.", rect.x, y, { color: GRAY });
    y += 14;
  }
  const docNotes = doc.notes.filter((n) => n.kind === "note" || n.kind === "cloud").map((n) => n.text.trim()).filter(Boolean);
  for (const n of docNotes) {
    pdf.font("Helvetica").fontSize(PLAN_TEXT.body);
    const h = pdf.heightOfString(safeText(`• ${n}`), { width: colW });
    ensure(h + 2);
    y = paragraph(pdf, `• ${n}`, rect.x, y, colW) + 2;
  }
  y += 10;

  const demo = levelsOf(ctx).flatMap((l) => {
    const lines = demoNotes(doc, l.id);
    return doc.levels.length > 1 ? lines.map((x) => `${l.name}: ${x}`) : lines;
  });
  bullets("Demo notes", demo, "Nothing marked for removal.");

  const allowances = new Map<string, { item: PlacedItem; qty: number }>();
  for (const i of doc.items) {
    if (i.catalogId != null || !CAB_KINDS.has(i.kind) || i.phase === "remove") continue;
    const key = `${i.tag}|${i.label}|${i.w}|${i.h}|${i.d}`;
    const cur = allowances.get(key);
    if (cur) cur.qty += 1;
    else allowances.set(key, { item: i, qty: 1 });
  }
  bullets(
    "Allowances",
    [...allowances.values()].map(({ item, qty }) => `${qty} × ${item.tag ? `${item.tag} ` : ""}${item.label} ${nominal(item)} — product to be selected`),
    "Every cabinet has a catalog product selected.",
  );
}

// ─── Cover ───────────────────────────────────────────────────────────────────

function renderCover(ctx: Ctx) {
  const { pdf, input } = ctx;
  const rect = newPage(ctx, { sheet: "cover", title: "Cover", sub: "", scale: "—" });
  let y = rect.y + 6;
  label(pdf, input.company.name.toUpperCase(), rect.x, y, { size: 9, bold: true, color: ACCENT, width: rect.w });
  y += 16;
  const title = input.project?.name || input.designName;
  pdf.font("Helvetica-Bold").fontSize(Math.min(26, rect.w / 18)).fillColor(INK);
  pdf.text(fitText(pdf, safeText(title), rect.w), rect.x, y, { width: rect.w, lineBreak: false });
  y += Math.min(26, rect.w / 18) + 6;
  const lines = [
    input.project ? [input.project.clientName, input.project.address].filter(Boolean).join(" · ") : "",
    `${input.designName} · ${input.versionLabel} · ${input.dateLabel}`,
  ].filter(Boolean);
  for (const l of lines) {
    label(pdf, l, rect.x, y, { size: 10, color: GRAY, width: rect.w });
    y += 14;
  }
  y += 8;
  pdf.strokeColor(ACCENT).lineWidth(1.2).undash().moveTo(rect.x, y).lineTo(rect.x + rect.w, y).stroke();
  y += 10;

  const indexW = Math.min(Math.max(rect.w * 0.3, 160), 240);
  const hero: Rect = { x: rect.x + indexW + GAP * 2, y, w: rect.w - indexW - GAP * 2, h: rect.y + rect.h - y };
  ctx.coverIndex = { x: rect.x, y, w: indexW, h: hero.h };

  const cap = input.captures[0];
  if (cap) {
    try {
      pdf.image(cap.png, hero.x, hero.y, { fit: [hero.w, hero.h - 14], align: "center", valign: "center" });
      label(pdf, cap.label || "3D view", hero.x, hero.y + hero.h - 12, { size: PLAN_TEXT.small, color: GRAY, width: hero.w, align: "center" });
    } catch {
      label(pdf, "Cover image could not be embedded.", hero.x, hero.y, { color: GRAY });
    }
  } else {
    const level = levelsOf(ctx)[0];
    const { ops, bounds } = planFor(ctx, level.id, "new", PLAN_LAYERS.full, false, true);
    if (bounds && ops.length) {
      const pad = 10;
      const inner = { x: hero.x + pad, y: hero.y + pad, w: hero.w - 2 * pad, h: hero.h - 2 * pad };
      const bw = bounds.max.x - bounds.min.x, bh = bounds.max.y - bounds.min.y;
      const sc = fitScale({ w: bw, h: bh }, { w: inner.w * 0.8, h: inner.h * 0.8 });
      drawOpsToPdf(pdf, ops, bounds, inner, sc.ptPerIn);
    }
  }
}

function fillCoverIndex(ctx: Ctx) {
  if (!ctx.coverIndex) return;
  const { pdf, pages } = ctx;
  pdf.switchToPage(0);
  const r = ctx.coverIndex;
  let y = boxTitle(pdf, "Sheet index", r.x, r.y, r.w);
  const seen = new Map<SheetKey, { first: number; last: number }>();
  pages.forEach((p, i) => {
    const cur = seen.get(p.sheet);
    if (cur) cur.last = i + 1;
    else seen.set(p.sheet, { first: i + 1, last: i + 1 });
  });
  for (const [sheet, range] of seen) {
    if (y + 12 > r.y + r.h) break;
    const pg = range.first === range.last ? String(range.first) : `${range.first}–${range.last}`;
    label(pdf, SHEET_LABELS[sheet], r.x, y, { size: PLAN_TEXT.body, width: r.w - 36 });
    label(pdf, pg, r.x + r.w - 34, y, { size: PLAN_TEXT.body, width: 34, align: "right", color: GRAY });
    y += 13;
  }
  y += 6;
  if (y + 30 < r.y + r.h) {
    y = boxTitle(pdf, "Prepared by", r.x, y, r.w);
    const c = ctx.input.company;
    for (const l of [c.name, c.license ? `License ${c.license}` : "", c.address, [c.phone, c.email].filter(Boolean).join(" · ")].filter(Boolean)) {
      if (y + 11 > r.y + r.h) break;
      label(pdf, l, r.x, y, { size: PLAN_TEXT.small, width: r.w, color: GRAY });
      y += 11;
    }
  }
}

// ─── Title block + watermark (every page, after the count is known) ──────────

function northArrow(pdf: Pdf, cx: number, cy: number, drawn: boolean) {
  pdf.save();
  pdf.strokeColor(INK).fillColor(INK).lineWidth(0.6).undash();
  if (drawn) {
    pdf.moveTo(cx, cy - 9).lineTo(cx + 4, cy + 5).lineTo(cx, cy + 2).lineTo(cx - 4, cy + 5).closePath().fill();
    pdf.circle(cx, cy - 1, 9).stroke();
  } else {
    pdf.moveTo(cx, cy + 6).lineTo(cx, cy - 6).stroke();
    pdf.moveTo(cx, cy - 8).lineTo(cx + 3, cy - 3).lineTo(cx - 3, cy - 3).closePath().fill();
  }
  pdf.font("Helvetica-Bold").fontSize(6).fillColor(INK);
  pdf.text("N", cx - 2.2, cy + 8, { lineBreak: false });
  pdf.restore();
}

function titleBlock(ctx: Ctx, index: number, meta: PageMeta) {
  const { pdf, input, W, H, pages } = ctx;
  const x = MARGIN, w = W - 2 * MARGIN;
  const y = H - MARGIN - TITLE_H;
  pdf.save();
  pdf.undash().lineWidth(0.8).strokeColor(INK).rect(x, y, w, TITLE_H).stroke();
  const cols = [0.24, 0.24, 0.2, 0.17, 0.09, 0.06];
  const xs: number[] = [x];
  for (const c of cols) xs.push(xs[xs.length - 1] + c * w);
  pdf.lineWidth(0.5);
  for (let i = 1; i < cols.length; i++) pdf.moveTo(xs[i], y).lineTo(xs[i], y + TITLE_H).stroke();

  const cell = (i: number, lines: { t: string; bold?: boolean; size?: number; color?: string }[]) => {
    const cx = xs[i] + 5, cw = xs[i + 1] - xs[i] - 10;
    let cy = y + 6;
    for (const l of lines) {
      const size = l.size ?? PLAN_TEXT.small;
      label(pdf, l.t, cx, cy, { size, bold: l.bold, color: l.color, width: cw });
      cy += size + 3;
    }
  };
  const c = input.company;
  cell(0, [
    { t: c.name, bold: true, size: 8.5 },
    { t: [c.license ? `Lic. ${c.license}` : "", c.address].filter(Boolean).join(" · ") || " ", size: 6.5, color: GRAY },
    { t: [c.phone, c.email].filter(Boolean).join(" · ") || " ", size: 6.5, color: GRAY },
  ]);
  cell(1, [
    { t: input.project?.name || input.designName, bold: true, size: 8.5 },
    { t: input.project?.clientName || " ", size: 6.5, color: GRAY },
    { t: input.project?.address || " ", size: 6.5, color: GRAY },
  ]);
  cell(2, [
    { t: input.designName, bold: true, size: 8.5 },
    { t: input.versionLabel, size: 6.5, color: GRAY },
    { t: input.dateLabel, size: 6.5, color: GRAY },
  ]);
  cell(3, [
    { t: meta.title, bold: true, size: 8.5 },
    { t: meta.sub || " ", size: 6.5, color: GRAY },
    { t: input.watermark ? input.watermark : " ", size: 6.5, color: DRAW_COLORS.demo },
  ]);
  cell(4, [
    { t: "Scale", size: 6, color: GRAY },
    { t: meta.scale || "NTS", bold: true, size: 8 },
    { t: `Sheet ${index + 1} / ${pages.length}`, size: 6.5, color: GRAY },
  ]);
  const hasNorth = input.doc.notes.some((n) => n.kind === "north");
  northArrow(pdf, (xs[5] + xs[6]) / 2, y + TITLE_H / 2 - 4, hasNorth);
  pdf.restore();
}

function watermark(ctx: Ctx) {
  const text = (ctx.input.watermark ?? "").trim();
  if (!text) return;
  const { pdf, W, H } = ctx;
  pdf.save();
  pdf.font("Helvetica-Bold").fontSize(Math.min(W, H) / 9).fillColor("#9a9a92").fillOpacity(0.13);
  const tw = pdf.widthOfString(text);
  pdf.translate(W / 2, H / 2).rotate(-30);
  pdf.text(text, -tw / 2, 0, { lineBreak: false, baseline: "middle" });
  pdf.restore();
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const SHEET_ORDER: SheetKey[] = ["cover", "existing", "demo", "new", "cabinet", "electrical", "finish", "elevations", "sections", "views", "schedules", "notes"];

/** Render the chosen sheets into one PDF. Pure: no db, no filesystem. */
export function renderPlanSheetsCore(input: PrintInput): Promise<Buffer> {
  const sheets = input.sheets.filter((s, i, arr) => SHEET_ORDER.includes(s) && arr.indexOf(s) === i);
  if (!sheets.length) return Promise.reject(new Error("No sheets selected."));
  const paper = PAPER_PT[input.paper] ?? PAPER_PT.letter;
  const landscape = input.orientation === "landscape";
  const W = landscape ? paper.h : paper.w;
  const H = landscape ? paper.w : paper.h;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: [W, H],
      margin: 0,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: `${input.designName} — plan set ${input.versionLabel}`, Author: input.company.name || "SJ Carpentry LLC" },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const ctx: Ctx = {
      pdf,
      input,
      doc: input.doc,
      W,
      H,
      area: { x: MARGIN, y: MARGIN + HEAD_H, w: W - 2 * MARGIN, h: H - 2 * MARGIN - HEAD_H - TITLE_H - GAP },
      pages: [],
      coverIndex: null,
    };

    try {
      for (const sheet of sheets) {
        switch (sheet) {
          case "cover":
            renderCover(ctx);
            break;
          case "existing":
          case "demo":
          case "new":
          case "cabinet":
          case "electrical":
          case "finish":
            renderPlanSheet(ctx, sheet);
            break;
          case "elevations":
            renderElevations(ctx);
            break;
          case "sections":
            renderSections(ctx);
            break;
          case "views":
            renderViews(ctx);
            break;
          case "schedules":
            renderSchedules(ctx);
            break;
          case "notes":
            renderNotes(ctx);
            break;
        }
      }
      if (!ctx.pages.length) {
        newPage(ctx, { sheet: sheets[0], title: SHEET_LABELS[sheets[0]], sub: "", scale: "" });
        label(pdf, "Nothing to print for the selected sheets.", MARGIN, MARGIN + HEAD_H, { color: GRAY });
      }
      if (sheets[0] === "cover") fillCoverIndex(ctx);
      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        titleBlock(ctx, i, ctx.pages[i] ?? { sheet: "notes", title: "", sub: "", scale: "" });
        watermark(ctx);
      }
      pdf.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

