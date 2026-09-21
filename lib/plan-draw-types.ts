// Drawing primitives shared by the 2D canvas, elevations, and the pdfkit print
// path. lib/plan-draw.ts turns a PlanDoc into DrawOp[]; components/floor/
// DrawOps.tsx renders them to SVG and lib/plan-print.ts renders them to PDF.
// Coordinates are plan inches (y down). Stroke widths are in inches too and
// get scaled by the renderer; `hairline` means "thinnest visible line".

import type { Pt } from "./plan-doc.ts";

export type DrawLayer =
  | "underlay" | "walls" | "openings" | "cabinets" | "counters" | "appliances" | "plumbing"
  | "electrical" | "lighting" | "hvac" | "furniture" | "finishes" | "trim" | "dims"
  | "notes" | "comments" | "photos" | "selections" | "cameras" | "rooms" | "structure" | "stairs";

export const DRAW_LAYERS: readonly DrawLayer[] = [
  "underlay", "rooms", "finishes", "walls", "openings", "structure", "stairs", "cabinets", "counters",
  "appliances", "plumbing", "hvac", "furniture", "trim", "electrical", "lighting", "selections",
  "dims", "notes", "photos", "comments", "cameras",
];

export interface DrawStyle {
  stroke?: string;
  strokeWidth?: number | "hairline";
  dash?: number[];
  fill?: string;
  fillOpacity?: number;
  opacity?: number;
  hatch?: "diag" | "cross" | "dots";
  lineCap?: "butt" | "round" | "square";
}

export type DrawOp =
  | { t: "line"; a: Pt; b: Pt; s: DrawStyle; layer: DrawLayer; id?: string }
  | { t: "polyline"; pts: Pt[]; s: DrawStyle; layer: DrawLayer; id?: string; closed?: boolean }
  | { t: "polygon"; pts: Pt[]; s: DrawStyle; layer: DrawLayer; id?: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; rotDeg?: number; s: DrawStyle; layer: DrawLayer; id?: string }
  | { t: "circle"; c: Pt; r: number; s: DrawStyle; layer: DrawLayer; id?: string }
  | { t: "arc"; c: Pt; r: number; startDeg: number; endDeg: number; s: DrawStyle; layer: DrawLayer; id?: string }
  | {
      t: "text";
      p: Pt;
      text: string;
      /** Font size in plan inches (so it scales with the drawing). */
      size: number;
      rotDeg?: number;
      anchor?: "start" | "middle" | "end";
      baseline?: "top" | "middle" | "bottom";
      font?: "sans" | "mono" | "serif";
      weight?: "normal" | "bold";
      s: DrawStyle;
      layer: DrawLayer;
      id?: string;
    }
  | { t: "image"; fileId: string; x: number; y: number; w: number; h: number; rotDeg?: number; opacity?: number; layer: DrawLayer; id?: string };

export interface DrawBounds {
  min: Pt;
  max: Pt;
}

/** Palette used by both renderers so print matches screen. */
export const DRAW_COLORS = {
  ink: "#1f2418",
  ink2: "#4a5140",
  ink3: "#7b8270",
  ink4: "#b3b8aa",
  paper: "#fbfaf6",
  paper2: "#f3f1ea",
  accent: "#c46a3b",
  demo: "#a33a2a",
  new: "#2f6b3a",
  existing: "#1f2418",
  glass: "#8fb6d6",
  wood: "#c9a36a",
  counter: "#d9d4c7",
  fixture: "#6f8aa8",
  elec: "#8a5ab8",
  selection: "#c46a3b",
  ghost: "#b3b8aa",
} as const;
