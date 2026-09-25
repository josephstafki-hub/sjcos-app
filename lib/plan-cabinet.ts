// Cabinet style + front layout, shared by the 3D model, the elevations and the
// properties panel so a door style / hardware choice reads the same
// everywhere. Pure (no React): the MCP server and node tests import it too.
//
// A cabinet's style lives in item.props (construction, doorStyle, finish,
// hardware…); anything unset falls back to the design's cabinet style
// (doc.settings.cabinetStyle), then the designer defaults, then built-ins.
//
// Layout frame: x runs across the cabinet front, −w/2 (the viewer's left,
// facing the doors) to +w/2; z runs up from the cabinet's own bottom (its
// item.z), 0 … h.

import type { PlacedItem, PlanDoc } from "./plan-doc.ts";
import { FINISH_PRESETS, finishPreset } from "./plan-library.ts";

export type CabConstruction = "framed" | "frameless" | "inset";
export type CabDoorStyle = "slab" | "shaker" | "slimShaker" | "raised" | "beaded" | "glass";
export type CabHardware = "bar" | "knob" | "cup" | "edge" | "none";
export type CabToe = "recessed" | "legs" | "flush";

export interface CabinetStyle {
  construction: CabConstruction;
  doorStyle: CabDoorStyle;
  /** Drawer fronts: same profile as the doors, or plain slabs. */
  drawerStyle: "match" | "slab";
  /** Finish preset key, or "custom" with `color`. */
  finish: string;
  color: string;
  textureKey?: string;
  hardware: CabHardware;
  hardwareFinish: string;
  hardwareColor: string;
  /** Bar pull length (centre to centre), inches. */
  pullIn: number;
  toe: CabToe;
  crown: boolean;
  lightRail: boolean;
  /** Glass door panels (any framed door style). */
  glass: boolean;
}

export const CAB_CONSTRUCTIONS: readonly { key: CabConstruction; label: string; hint: string }[] = [
  { key: "framed", label: "Face frame", hint: "Doors overlay a 1½\" frame — the frame shows around them" },
  { key: "frameless", label: "Frameless", hint: "Full overlay, European — doors cover the box, tight reveals" },
  { key: "inset", label: "Inset", hint: "Doors sit flush inside the face frame" },
];

export const CAB_DOOR_STYLES: readonly { key: CabDoorStyle; label: string }[] = [
  { key: "shaker", label: "Shaker" },
  { key: "slimShaker", label: "Slim shaker" },
  { key: "slab", label: "Slab (flat)" },
  { key: "raised", label: "Raised panel" },
  { key: "beaded", label: "Beadboard panel" },
  { key: "glass", label: "Glass front" },
];

export const CAB_HARDWARE: readonly { key: CabHardware; label: string }[] = [
  { key: "bar", label: "Bar pulls" },
  { key: "knob", label: "Knobs" },
  { key: "cup", label: "Cup pulls + knobs" },
  { key: "edge", label: "Edge / finger pulls" },
  { key: "none", label: "None (push to open)" },
];

export const HARDWARE_FINISHES: readonly { key: string; label: string; color: string; metalness: number; roughness: number }[] = [
  { key: "metal-black", label: "Matte black", color: "#1f1f1f", metalness: 0.6, roughness: 0.6 },
  { key: "metal-nickel", label: "Brushed nickel", color: "#b9bcbb", metalness: 0.9, roughness: 0.3 },
  { key: "hw-polished-nickel", label: "Polished nickel", color: "#dcdcd6", metalness: 1, roughness: 0.12 },
  { key: "metal-chrome", label: "Chrome", color: "#d9dcdf", metalness: 1, roughness: 0.1 },
  { key: "hw-stainless", label: "Stainless", color: "#c6c8c9", metalness: 0.9, roughness: 0.25 },
  { key: "metal-brass", label: "Brass", color: "#b8955a", metalness: 0.9, roughness: 0.35 },
  { key: "hw-champagne", label: "Champagne bronze", color: "#c9a86a", metalness: 0.85, roughness: 0.35 },
  { key: "hw-bronze", label: "Oil-rubbed bronze", color: "#4a3a2c", metalness: 0.6, roughness: 0.5 },
  { key: "hw-copper", label: "Copper", color: "#b06f45", metalness: 0.9, roughness: 0.35 },
];

export const PULL_SIZES: readonly number[] = [3, 3.75, 5, 6.25, 8, 10, 12];

export const CAB_TOES: readonly { key: CabToe; label: string }[] = [
  { key: "recessed", label: "Toe kick" },
  { key: "legs", label: "Furniture legs" },
  { key: "flush", label: "Flush to floor" },
];

/** Cabinet finish swatches (painted + wood species) from the finish presets. */
export const CAB_FINISH_PRESETS = FINISH_PRESETS.filter((p) => p.category === "cabinet");

/** The props keys that make up a cabinet's style (copied by "apply to run / all"). */
export const CAB_STYLE_KEYS = [
  "construction",
  "doorStyle",
  "drawerStyle",
  "finish",
  "finishColor",
  "hardware",
  "hardwareFinish",
  "pullIn",
  "toe",
  "crown",
  "lightRail",
  "glass",
] as const;

export const CABINET_STYLE_KINDS: ReadonlySet<PlacedItem["kind"]> = new Set(["base", "wall", "tall", "vanity", "island"]);

const BUILTIN: CabinetStyle = {
  construction: "framed",
  doorStyle: "shaker",
  drawerStyle: "match",
  finish: "cab-white",
  color: "#f2f1ec",
  hardware: "bar",
  hardwareFinish: "metal-black",
  hardwareColor: "#1f1f1f",
  pullIn: 5,
  toe: "recessed",
  crown: false,
  lightRail: false,
  glass: false,
};

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const oneOf = <T extends string>(v: unknown, keys: readonly { key: T }[]): T | undefined =>
  typeof v === "string" && keys.some((k) => k.key === v) ? (v as T) : undefined;

/** Just the style keys from a props bag (design default / copy between cabinets). */
export function pickCabinetStyle(props: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const k of CAB_STYLE_KEYS) if (props[k] !== undefined) out[k] = props[k];
  return out;
}

/** Resolve a cabinet's full style: its props → the design's cabinet style →
 *  the designer defaults (door style, finish) → built-ins. */
export function cabinetStyle(item: Pick<PlacedItem, "props">, doc?: Pick<PlanDoc, "settings"> | null): CabinetStyle {
  const design = (doc?.settings.cabinetStyle ?? {}) as Record<string, unknown>;
  const dflt = doc?.settings.defaults;
  const p = { ...design, ...item.props } as Record<string, unknown>;
  // Old designs: doorStyle "glass" was the only glass switch.
  const doorStyle = oneOf(p.doorStyle, CAB_DOOR_STYLES) ?? oneOf(dflt?.doorStyle, CAB_DOOR_STYLES) ?? BUILTIN.doorStyle;
  const finishKey =
    typeof p.finish === "string" && p.finish ? p.finish : dflt?.finish && finishPreset(dflt.finish)?.category === "cabinet" ? dflt.finish : BUILTIN.finish;
  const preset = finishPreset(finishKey);
  const color = isHex(p.finishColor) ? p.finishColor : isHex(p.color) ? p.color : preset?.color ?? BUILTIN.color;
  const hwKey = typeof p.hardwareFinish === "string" ? p.hardwareFinish : BUILTIN.hardwareFinish;
  const hw = HARDWARE_FINISHES.find((h) => h.key === hwKey) ?? HARDWARE_FINISHES[0];
  const pullIn = typeof p.pullIn === "number" && p.pullIn >= 1 && p.pullIn <= 36 ? p.pullIn : BUILTIN.pullIn;
  return {
    construction: oneOf(p.construction, CAB_CONSTRUCTIONS) ?? BUILTIN.construction,
    doorStyle,
    drawerStyle: p.drawerStyle === "slab" ? "slab" : "match",
    finish: preset || finishKey === "custom" ? finishKey : BUILTIN.finish,
    color,
    ...(preset?.textureKey && !isHex(p.color) && (p.finishColor == null || p.finishColor === preset.color) ? { textureKey: preset.textureKey } : {}),
    hardware: oneOf(p.hardware, CAB_HARDWARE) ?? BUILTIN.hardware,
    hardwareFinish: hw.key,
    hardwareColor: hw.color,
    pullIn,
    toe: oneOf(p.toe, CAB_TOES) ?? BUILTIN.toe,
    crown: p.crown === true,
    lightRail: p.lightRail === true,
    glass: p.glass === true || doorStyle === "glass",
  };
}

// ─── Front layout ────────────────────────────────────────────────────────────

export interface CabRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface CabPull {
  kind: Exclude<CabHardware, "none">;
  /** Centre of the pull. */
  x: number;
  z: number;
  /** Bar / edge / cup run horizontally (drawers) or vertically (doors). */
  orient: "h" | "v";
  /** Length along `orient` (knobs: diameter). */
  len: number;
}

export interface CabFront extends CabRect {
  kind: "door" | "drawer" | "false" | "appliance";
  /** Panel profile drawn on this front. */
  profile: CabDoorStyle;
  glass: boolean;
  /** Hinge side (doors). */
  hinge?: "L" | "R";
  pulls: CabPull[];
}

export interface CabLayout {
  /** Height of the toe space / legs under the box (0 for wall cabinets). */
  toe: number;
  toeStyle: CabToe;
  /** Face-frame members (framed / inset), front plane. */
  frame: CabRect[];
  fronts: CabFront[];
  /** Front sits proud of the box by this much (overlay on a face frame). */
  frontOffset: number;
  crown: boolean;
  lightRail: boolean;
}

const FRAME = 1.5;
const GAP = 0.125;
const DRAWER_H = 6;

/** Stile / rail width of a framed door profile for a front `h` tall. */
export function profileFrame(profile: CabDoorStyle, w: number, h: number): number {
  if (profile === "slab") return 0;
  const f = profile === "slimShaker" ? 1.25 : 2.25;
  return Math.min(f, w * 0.22, h * 0.22);
}

/** Heights (top → bottom) splitting `total` into n drawers: a 6" top drawer
 *  over equal ones when there are three or more. */
function drawerStack(total: number, n: number): number[] {
  if (n <= 1) return [total];
  if (n === 2) return [total / 2, total / 2];
  const top = Math.min(DRAWER_H, total / n);
  const rest = (total - top) / (n - 1);
  return [top, ...Array.from({ length: n - 1 }, () => rest)];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Where the doors, drawers, face frame and hardware go on one cabinet. */
export function cabinetLayout(item: Pick<PlacedItem, "kind" | "w" | "h" | "props" | "tag" | "label" | "libraryKey">, style: CabinetStyle, toeIn = 4.5): CabLayout {
  const { w, h, kind } = item;
  const p = item.props;
  const floorKind = kind !== "wall";
  const toe = !floorKind ? 0 : style.toe === "legs" ? 6 : style.toe === "flush" ? 0 : Math.min(toeIn, h * 0.2);
  const framed = style.construction !== "frameless";
  const inset = style.construction === "inset";
  const frame: CabRect[] = [];
  const fronts: CabFront[] = [];

  // Openings area (inside the face frame, or the whole box).
  const ox0 = -w / 2 + (framed ? FRAME : 0);
  const ox1 = w / 2 - (framed ? FRAME : 0);
  const oz0 = toe + (framed ? FRAME : 0);
  const oz1 = h - (framed ? FRAME : 0);
  if (framed) {
    frame.push({ x0: -w / 2, x1: ox0, z0: toe, z1: h }, { x0: ox1, x1: w / 2, z0: toe, z1: h });
    frame.push({ x0: ox0, x1: ox1, z0: toe, z1: oz0 }, { x0: ox0, x1: ox1, z0: oz1, z1: h });
  }

  // Sections from the top down: [kind, height, count].
  type Section = { kind: CabFront["kind"]; h: number; n: number };
  const doorsProp = num(p.doors);
  const drawersProp = num(p.drawers) ?? (p.drawers === true ? 3 : 0);
  const doorCount = Math.max(1, Math.min(4, Math.round(doorsProp ?? (w < 24 ? 1 : 2))));
  const tagText = `${item.tag} ${item.label} ${item.libraryKey ?? ""}`;
  const drawerBank = (doorsProp === 0 && drawersProp > 0) || (/\bdb\d|drawer base/i.test(tagText) && doorsProp == null);
  const avail = oz1 - oz0;
  const rail = framed ? FRAME : 0;
  const sections: Section[] = [];
  if (kind === "wall") {
    sections.push({ kind: "door", h: avail, n: doorCount });
  } else if (kind === "tall") {
    if (p.oven) {
      const drawerH = drawersProp > 0 ? Math.min(12, avail * 0.15) : 0;
      const ovenH = Math.min(30, avail * 0.4);
      const upper = avail - drawerH - ovenH - rail * ((drawerH ? 1 : 0) + 1);
      sections.push({ kind: "door", h: upper, n: doorCount });
      sections.push({ kind: "appliance", h: ovenH, n: 1 });
      if (drawerH) sections.push({ kind: "drawer", h: drawerH, n: 1 });
    } else {
      const lower = Math.min(avail * 0.62, 48);
      sections.push({ kind: "door", h: avail - lower - rail, n: doorCount });
      sections.push({ kind: "door", h: lower, n: doorCount });
    }
  } else if (drawerBank) {
    const n = Math.max(1, Math.min(6, Math.round(drawersProp || 3)));
    const hs = drawerStack(avail - rail * (n - 1), n);
    for (const dh of hs) sections.push({ kind: "drawer", h: dh, n: 1 });
  } else {
    const top = p.falseFront || p.sink ? 1 : Math.max(0, Math.min(3, Math.round(drawersProp)));
    const topKind: CabFront["kind"] = p.falseFront || p.sink ? "false" : "drawer";
    let used = 0;
    for (let k = 0; k < top; k++) {
      sections.push({ kind: topKind, h: DRAWER_H, n: w >= 36 && topKind === "drawer" && doorCount >= 2 && top === 1 ? 2 : 1 });
      used += DRAWER_H + rail;
    }
    sections.push({ kind: "door", h: Math.max(6, avail - used), n: doorCount });
  }

  // Lay the sections out top-down.
  let zTop = oz1;
  sections.forEach((sec, si) => {
    const z1 = zTop;
    const z0 = zTop - sec.h;
    zTop = z0 - rail;
    if (framed && si < sections.length - 1) frame.push({ x0: ox0, x1: ox1, z0: z0 - rail, z1: z0 });
    const cellW = (ox1 - ox0) / sec.n;
    for (let c = 0; c < sec.n; c++) {
      const cx0 = ox0 + c * cellW;
      const cx1 = cx0 + cellW;
      // Overlay on a face frame: ½" over the frame (not past the box), a
      // hairline gap where fronts meet. Inset: 3/32" reveal inside the frame.
      let r: CabRect;
      if (style.construction === "framed") {
        r = {
          x0: c === 0 ? Math.max(-w / 2, cx0 - 0.5) : cx0 + GAP / 2,
          x1: c === sec.n - 1 ? Math.min(w / 2, cx1 + 0.5) : cx1 - GAP / 2,
          z0: si === sections.length - 1 ? Math.max(toe, z0 - 0.5) : z0 - rail / 2 + GAP / 2,
          z1: si === 0 ? Math.min(h, z1 + 0.5) : z1 + rail / 2 - GAP / 2,
        };
      } else if (inset) {
        r = { x0: cx0 + 0.09375, x1: cx1 - 0.09375, z0: z0 + 0.09375, z1: z1 - 0.09375 };
      } else {
        r = {
          x0: cx0 + (c === 0 ? 0.0625 : GAP / 2),
          x1: cx1 - (c === sec.n - 1 ? 0.0625 : GAP / 2),
          z0: z0 + (si === sections.length - 1 ? 0.0625 : GAP / 2),
          z1: z1 - (si === 0 ? 0.0625 : GAP / 2),
        };
      }
      const isDoor = sec.kind === "door";
      // Drawers / false fronts take the door profile (a glass or beadboard
      // door gets a plain shaker drawer), or a slab if asked. A glass slab
      // door becomes a slim frame around the glass.
      const drawerProfile: CabDoorStyle =
        style.drawerStyle === "slab" ? "slab" : style.doorStyle === "glass" || style.doorStyle === "beaded" ? "shaker" : style.doorStyle;
      const glassDoor = isDoor && style.glass;
      const profile: CabDoorStyle =
        sec.kind === "appliance" ? "slab" : !isDoor ? drawerProfile : glassDoor && style.doorStyle === "slab" ? "slimShaker" : style.doorStyle;
      const hinge: "L" | "R" = sec.n === 1 ? (p.hinge === "R" ? "R" : "L") : c < sec.n / 2 ? "L" : "R";
      const front: CabFront = {
        kind: sec.kind,
        ...r,
        profile,
        glass: glassDoor,
        ...(isDoor ? { hinge } : {}),
        pulls: [],
      };
      front.pulls = pullsFor(front, style, kind, si === 0);
      fronts.push(front);
    }
  });

  return {
    toe,
    toeStyle: floorKind ? style.toe : "recessed",
    frame,
    fronts,
    frontOffset: style.construction === "framed" ? 0.75 : 0,
    crown: style.crown && (kind === "wall" || kind === "tall"),
    lightRail: style.lightRail && kind === "wall",
  };
}

/** Hardware on one front. Doors: at the latch edge, near the top on base /
 *  lower doors and near the bottom on wall / upper doors. Drawers: centred
 *  (two pulls on wide drawers with short bars). */
function pullsFor(f: CabFront, style: CabinetStyle, kind: PlacedItem["kind"], topSection: boolean): CabPull[] {
  if (style.hardware === "none" || f.kind === "false" || f.kind === "appliance") return [];
  const fw = f.x1 - f.x0;
  const fh = f.z1 - f.z0;
  const cx = (f.x0 + f.x1) / 2;
  if (f.kind === "drawer") {
    const z = fh > 10 ? f.z1 - Math.min(3.5, fh / 2) : (f.z0 + f.z1) / 2;
    if (style.hardware === "knob") {
      return fw >= 30 ? [{ kind: "knob", x: f.x0 + fw / 4, z, orient: "h", len: 1.25 }, { kind: "knob", x: f.x1 - fw / 4, z, orient: "h", len: 1.25 }] : [{ kind: "knob", x: cx, z, orient: "h", len: 1.25 }];
    }
    if (style.hardware === "cup") return [{ kind: "cup", x: cx, z, orient: "h", len: 3.5 }];
    if (style.hardware === "edge") return [{ kind: "edge", x: cx, z: f.z1 - 0.2, orient: "h", len: Math.min(8, fw * 0.5) }];
    const len = Math.min(style.pullIn, fw * 0.7);
    if (fw >= 30 && style.pullIn <= 6.25) {
      return [
        { kind: "bar", x: f.x0 + fw / 4, z, orient: "h", len },
        { kind: "bar", x: f.x1 - fw / 4, z, orient: "h", len },
      ];
    }
    return [{ kind: "bar", x: cx, z, orient: "h", len: fw >= 30 ? Math.min(12, fw * 0.4, Math.max(len, style.pullIn)) : len }];
  }
  // Doors.
  const latchX = f.hinge === "L" ? f.x1 - 2 : f.x0 + 2;
  // Upper doors (wall cabinets, and the upper section of a tall) pull near
  // the bottom; base / lower doors near the top.
  const high = !(kind === "wall" || (kind === "tall" && topSection));
  const doorKind = style.hardware === "cup" ? "knob" : style.hardware;
  if (doorKind === "knob") return [{ kind: "knob", x: latchX, z: high ? f.z1 - 2.5 : f.z0 + 2.5, orient: "v", len: 1.25 }];
  if (doorKind === "edge") return [{ kind: "edge", x: f.hinge === "L" ? f.x1 - 0.2 : f.x0 + 0.2, z: high ? f.z1 - 4 : f.z0 + 4, orient: "v", len: Math.min(6, fh * 0.4) }];
  const len = Math.min(style.pullIn, fh * 0.5);
  return [{ kind: "bar", x: latchX, z: high ? f.z1 - 2 - len / 2 : f.z0 + 2 + len / 2, orient: "v", len }];
}

/** Hardware pieces on a cabinet (takeoffs): knobs vs pulls. */
export function cabinetHardwareCount(layout: CabLayout): { pulls: number; knobs: number } {
  let pulls = 0;
  let knobs = 0;
  for (const f of layout.fronts)
    for (const p of f.pulls) {
      if (p.kind === "knob") knobs++;
      else pulls++;
    }
  return { pulls, knobs };
}
