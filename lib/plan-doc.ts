// Floor-plan designer document (docs/floor-plan-designer-plan.md §15).
//
// One PlanDoc per design, stored whole in plan_designs.doc (jsonb) and saved
// with a rev counter. The 2D document is the source of truth; the 3D scene,
// elevations, print sheets, measures, and checks are all derived from it.
//
// Units: inches, always. y grows DOWN in plan (screen) space so the SVG canvas
// needs no flip; the 3D scene maps plan (x, y) → world (x, 0, y): plan y is
// world z, and heights go on world y. Every coordinate is a plain number.
//
// This module must stay importable from client components: types, zod, and
// pure helpers only — no db, no server-only imports.

import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

export type WallKind = "existing" | "remove" | "new";
export type Phase = "existing" | "remove" | "new" | "relocate";

/** A surface material. `key` picks a preset from lib/plan-library (colour +
 *  optional texture); a catalog product may override label/colour. */
export interface FinishRef {
  key: string;
  label: string;
  color: string;
  textureKey?: string;
  catalogId?: number | null;
  pattern?: TilePattern;
}

export interface TilePattern {
  layout: "straight" | "offset" | "herringbone" | "diagonal";
  tileWIn: number;
  tileHIn: number;
  groutIn: number;
  groutColor: string;
}

export interface TrimSet {
  base?: string;
  crown?: string;
  casing?: string;
  chair?: string;
}

// ─── Elements ────────────────────────────────────────────────────────────────

export interface Level {
  id: string;
  name: string;
  elevationIn: number;
  ceilingIn: number;
}

export interface Wall {
  id: string;
  levelId: string;
  a: Pt;
  b: Pt;
  thickIn: number;
  heightIn: number;
  kind: WallKind;
  /** Finishes per face. "left" is the left side walking a → b. */
  faces?: { left?: FinishRef | null; right?: FinishRef | null };
}

export type OpeningKind = "door" | "window" | "opening";

export interface Opening {
  id: string;
  wallId: string;
  /** Distance from wall.a to the opening's START, along the wall. */
  atIn: number;
  widthIn: number;
  heightIn: number;
  /** Bottom of the opening above the floor (0 for doors). */
  sillIn: number;
  kind: OpeningKind;
  /** hinged | pocket | bifold | sliding | french | cased | single | double | picture | casement | slider | arched … */
  subtype: string;
  hand: "L" | "R";
  /** Swing toward the wall's left face or right face (doors only). */
  swing: "left" | "right";
  phase: Phase;
  tag: string;
}

export interface Room {
  id: string;
  levelId: string;
  name: string;
  polygon: Pt[];
  areaSf: number;
  perimLf: number;
  ceilingIn: number | null;
  floor: FinishRef | null;
  ceiling: FinishRef | null;
  trim: TrimSet | null;
  /** Walls bounding this room (derived; used by finish SF math). */
  wallIds: string[];
  /** Set when the user renamed/edited the room so re-detection keeps it. */
  pinned?: boolean;
}

export type PlaceKind =
  | "base"
  | "wall"
  | "tall"
  | "vanity"
  | "island"
  | "counter"
  | "appliance"
  | "plumbing"
  | "electrical"
  | "lighting"
  | "hvac"
  | "furniture"
  | "structure"
  | "generic";

export const PLACE_KINDS: readonly PlaceKind[] = [
  "base", "wall", "tall", "vanity", "island", "counter", "appliance", "plumbing",
  "electrical", "lighting", "hvac", "furniture", "structure", "generic",
];

export interface PlacedItem {
  id: string;
  levelId: string;
  kind: PlaceKind;
  catalogId: number | null;
  /** Key into the generic library (lib/plan-library) when no catalog product. */
  libraryKey: string | null;
  label: string;
  /** Drawing callout, e.g. "B36", "W3030". */
  tag: string;
  /** Centre of the footprint in plan space. */
  x: number;
  y: number;
  /** Bottom of the item above the floor (wall cabinets sit at 54"). */
  z: number;
  rotDeg: number;
  /** Footprint width (along the item's own x), depth, and height. */
  w: number;
  d: number;
  h: number;
  phase: Phase;
  wallId?: string | null;
  runId?: string | null;
  /** Kind-specific properties: doorStyle, finish, hardware, hinge, power, venting… */
  props: Record<string, unknown>;
  selectionOptionId?: number | null;
}

export type RunTier = "base" | "wall" | "tall";

export interface RunAccessory {
  kind: "filler" | "endPanel" | "toe" | "crown" | "lightRail" | "fridgePanel";
  lengthIn?: number;
  side?: "start" | "end";
}

export interface CabinetRun {
  id: string;
  levelId: string;
  wallId: string | null;
  tier: RunTier;
  itemIds: string[];
  accessories: RunAccessory[];
}

export interface Counter {
  id: string;
  levelId: string;
  runId: string | null;
  polygon: Pt[];
  thickIn: number;
  overhang: { front: number; back: number; left: number; right: number };
  edge: string;
  material: FinishRef;
  backsplashIn: number;
  seams: Pt[][];
  waterfall: ("left" | "right")[];
}

export interface FinishRegion {
  id: string;
  levelId: string;
  target: "floor" | "wall" | "ceiling";
  roomId?: string | null;
  wallId?: string | null;
  side?: "left" | "right";
  polygon?: Pt[];
  material: FinishRef;
  /** Wall finishes: height covered from the floor (tile field, wainscot). */
  heightIn?: number;
}

export interface TrimRun {
  id: string;
  levelId: string;
  wallId?: string | null;
  roomId?: string | null;
  profile: "base" | "crown" | "casing" | "chair";
  heightIn: number;
}

export type ElecType =
  | "outlet" | "gfci" | "outlet240" | "switch" | "switch3" | "dimmer"
  | "recessed" | "pendant" | "sconce" | "underCab" | "surface" | "fan"
  | "panel" | "smoke" | "data" | "register" | "return" | "exhaust" | "miniSplit";

export interface Device {
  id: string;
  levelId: string;
  type: ElecType;
  x: number;
  y: number;
  heightAff: number;
  wallId?: string | null;
  circuit: string;
  /** Ids of lights a switch controls (drawn as switch legs). */
  switchLegTo: string[];
  phase: Phase;
}

export interface Stair {
  id: string;
  fromLevelId: string;
  toLevelId: string;
  shape: "straight" | "L" | "U";
  x: number;
  y: number;
  rotDeg: number;
  widthIn: number;
  riserCount: number;
  riserIn: number;
  treadIn: number;
  phase: Phase;
}

export interface Structural {
  id: string;
  levelId: string;
  kind: "column" | "beam" | "soffit";
  a: Pt;
  b: Pt;
  wIn: number;
  hIn: number;
  /** Bottom above floor (beams/soffits). */
  zIn: number;
  phase: Phase;
  label: string;
}

export interface Dim {
  id: string;
  levelId: string;
  kind: "aligned" | "linear" | "chain";
  a: Pt;
  b: Pt;
  offsetIn: number;
  chain?: Pt[];
}

export interface Note {
  id: string;
  levelId: string;
  x: number;
  y: number;
  text: string;
  leaderTo?: Pt | null;
  kind: "note" | "label" | "cloud" | "north";
}

export interface PhotoPin {
  id: string;
  levelId: string;
  x: number;
  y: number;
  fileId: string;
  caption: string;
}

export interface Camera {
  id: string;
  name: string;
  levelId: string;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  mode: "orbit" | "walk" | "plan";
}

export interface SectionLine {
  id: string;
  levelId: string;
  a: Pt;
  b: Pt;
  depthIn: number;
  flip: boolean;
  label: string;
}

export interface Underlay {
  fileId: string;
  page?: number;
  x: number;
  y: number;
  /** Inches per image pixel. */
  scale: number;
  rotDeg: number;
  opacity: number;
  locked: boolean;
}

export interface DesignerDefaults {
  wallThickIn: number;
  ceilingIn: number;
  counterIn: number;
  backsplashIn: number;
  wallCabGapIn: number;
  toeIn: number;
  overhangIn: number;
  seatingOverhangIn: number;
  doorStyle: string;
  finish: string;
  doorWidthIn: number;
  doorHeightIn: number;
  windowWidthIn: number;
  windowHeightIn: number;
  windowSillIn: number;
}

export interface PlanDoc {
  v: 1;
  units: "in";
  settings: {
    snapIn: number;
    angleSnap: 0 | 15 | 45 | 90;
    defaults: DesignerDefaults;
  };
  levels: Level[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: PlacedItem[];
  runs: CabinetRun[];
  counters: Counter[];
  finishes: FinishRegion[];
  trims: TrimRun[];
  electrical: Device[];
  stairs: Stair[];
  structure: Structural[];
  dims: Dim[];
  notes: Note[];
  photos: PhotoPin[];
  cameras: Camera[];
  sections: SectionLine[];
  underlay?: Underlay | null;
  ignoredChecks: string[];
  meta: {
    templateOf?: string;
    createdFrom?: { designId: number; versionId: number | null } | null;
  };
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULTS: DesignerDefaults = {
  wallThickIn: 4.5,
  ceilingIn: 96,
  counterIn: 36,
  backsplashIn: 18,
  wallCabGapIn: 18,
  toeIn: 4.5,
  overhangIn: 1.5,
  seatingOverhangIn: 12,
  doorStyle: "shaker",
  finish: "paint-white",
  doorWidthIn: 32,
  doorHeightIn: 80,
  windowWidthIn: 36,
  windowHeightIn: 48,
  windowSillIn: 36,
};

export const MAIN_LEVEL_ID = "L1";

/** A short unique id. Not crypto — collisions only matter inside one doc. */
export function newId(prefix = "e"): string {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

export function emptyDoc(overrides: Partial<DesignerDefaults> = {}): PlanDoc {
  const defaults = { ...DEFAULTS, ...overrides };
  return {
    v: 1,
    units: "in",
    settings: { snapIn: 1, angleSnap: 15, defaults },
    levels: [{ id: MAIN_LEVEL_ID, name: "Main", elevationIn: 0, ceilingIn: defaults.ceilingIn }],
    walls: [],
    openings: [],
    rooms: [],
    items: [],
    runs: [],
    counters: [],
    finishes: [],
    trims: [],
    electrical: [],
    stairs: [],
    structure: [],
    dims: [],
    notes: [],
    photos: [],
    cameras: [],
    sections: [],
    underlay: null,
    ignoredChecks: [],
    meta: {},
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export const LIMITS = {
  walls: 500,
  openings: 500,
  items: 2000,
  rooms: 200,
  runs: 300,
  counters: 200,
  finishes: 500,
  trims: 500,
  electrical: 1000,
  stairs: 20,
  structure: 200,
  dims: 500,
  notes: 500,
  photos: 200,
  cameras: 50,
  sections: 50,
  levels: 8,
  coordIn: 20_000,
  label: 200,
  note: 2000,
} as const;

const coord = z.number().finite().min(-LIMITS.coordIn).max(LIMITS.coordIn);
const pt = z.object({ x: coord, y: coord });
const pos = z.number().finite().min(0).max(LIMITS.coordIn);
const label = z.string().max(LIMITS.label);
const id = z.string().min(1).max(64);
const phase = z.enum(["existing", "remove", "new", "relocate"]);

const tilePattern = z.object({
  layout: z.enum(["straight", "offset", "herringbone", "diagonal"]),
  tileWIn: pos,
  tileHIn: pos,
  groutIn: pos,
  groutColor: z.string().max(16),
});

const finishRef = z.object({
  key: z.string().max(64),
  label,
  color: z.string().max(16),
  textureKey: z.string().max(64).optional(),
  catalogId: z.number().int().nullable().optional(),
  pattern: tilePattern.optional(),
});

const trimSet = z.object({
  base: z.string().max(64).optional(),
  crown: z.string().max(64).optional(),
  casing: z.string().max(64).optional(),
  chair: z.string().max(64).optional(),
});

const wall = z.object({
  id,
  levelId: id,
  a: pt,
  b: pt,
  thickIn: z.number().finite().min(0.5).max(36),
  heightIn: z.number().finite().min(12).max(300),
  kind: z.enum(["existing", "remove", "new"]),
  faces: z
    .object({ left: finishRef.nullable().optional(), right: finishRef.nullable().optional() })
    .optional(),
});

const opening = z.object({
  id,
  wallId: id,
  atIn: coord,
  widthIn: z.number().finite().min(6).max(300),
  heightIn: z.number().finite().min(6).max(200),
  sillIn: z.number().finite().min(0).max(200),
  kind: z.enum(["door", "window", "opening"]),
  subtype: z.string().max(32),
  hand: z.enum(["L", "R"]),
  swing: z.enum(["left", "right"]),
  phase,
  tag: z.string().max(16),
});

const room = z.object({
  id,
  levelId: id,
  name: label,
  polygon: z.array(pt).max(200),
  areaSf: z.number().finite().min(0),
  perimLf: z.number().finite().min(0),
  ceilingIn: z.number().finite().min(12).max(300).nullable(),
  floor: finishRef.nullable(),
  ceiling: finishRef.nullable(),
  trim: trimSet.nullable(),
  wallIds: z.array(id).max(200),
  pinned: z.boolean().optional(),
});

const placedItem = z.object({
  id,
  levelId: id,
  kind: z.enum(PLACE_KINDS as [PlaceKind, ...PlaceKind[]]),
  catalogId: z.number().int().nullable(),
  libraryKey: z.string().max(64).nullable(),
  label,
  tag: z.string().max(16),
  x: coord,
  y: coord,
  z: z.number().finite().min(0).max(300),
  rotDeg: z.number().finite(),
  w: z.number().finite().min(0.5).max(600),
  d: z.number().finite().min(0.5).max(600),
  h: z.number().finite().min(0.5).max(300),
  phase,
  wallId: id.nullable().optional(),
  runId: id.nullable().optional(),
  props: z.record(z.string(), z.unknown()),
  selectionOptionId: z.number().int().nullable().optional(),
});

const runAccessory = z.object({
  kind: z.enum(["filler", "endPanel", "toe", "crown", "lightRail", "fridgePanel"]),
  lengthIn: pos.optional(),
  side: z.enum(["start", "end"]).optional(),
});

const cabinetRun = z.object({
  id,
  levelId: id,
  wallId: id.nullable(),
  tier: z.enum(["base", "wall", "tall"]),
  itemIds: z.array(id).max(100),
  accessories: z.array(runAccessory).max(50),
});

const counter = z.object({
  id,
  levelId: id,
  runId: id.nullable(),
  polygon: z.array(pt).max(100),
  thickIn: z.number().finite().min(0.25).max(6),
  overhang: z.object({ front: pos, back: pos, left: pos, right: pos }),
  edge: z.string().max(32),
  material: finishRef,
  backsplashIn: pos,
  seams: z.array(z.array(pt).max(10)).max(20),
  waterfall: z.array(z.enum(["left", "right"])).max(2),
});

const finishRegion = z.object({
  id,
  levelId: id,
  target: z.enum(["floor", "wall", "ceiling"]),
  roomId: id.nullable().optional(),
  wallId: id.nullable().optional(),
  side: z.enum(["left", "right"]).optional(),
  polygon: z.array(pt).max(200).optional(),
  material: finishRef,
  heightIn: pos.optional(),
});

const trimRun = z.object({
  id,
  levelId: id,
  wallId: id.nullable().optional(),
  roomId: id.nullable().optional(),
  profile: z.enum(["base", "crown", "casing", "chair"]),
  heightIn: pos,
});

const ELEC_TYPES = [
  "outlet", "gfci", "outlet240", "switch", "switch3", "dimmer", "recessed", "pendant",
  "sconce", "underCab", "surface", "fan", "panel", "smoke", "data", "register", "return",
  "exhaust", "miniSplit",
] as const;

const device = z.object({
  id,
  levelId: id,
  type: z.enum(ELEC_TYPES),
  x: coord,
  y: coord,
  heightAff: pos,
  wallId: id.nullable().optional(),
  circuit: z.string().max(16),
  switchLegTo: z.array(id).max(20),
  phase,
});

const stair = z.object({
  id,
  fromLevelId: id,
  toLevelId: id,
  shape: z.enum(["straight", "L", "U"]),
  x: coord,
  y: coord,
  rotDeg: z.number().finite(),
  widthIn: z.number().finite().min(24).max(120),
  riserCount: z.number().int().min(1).max(40),
  riserIn: z.number().finite().min(4).max(10),
  treadIn: z.number().finite().min(8).max(16),
  phase,
});

const structural = z.object({
  id,
  levelId: id,
  kind: z.enum(["column", "beam", "soffit"]),
  a: pt,
  b: pt,
  wIn: z.number().finite().min(1).max(120),
  hIn: z.number().finite().min(1).max(300),
  zIn: pos,
  phase,
  label,
});

const dim = z.object({
  id,
  levelId: id,
  kind: z.enum(["aligned", "linear", "chain"]),
  a: pt,
  b: pt,
  offsetIn: coord,
  chain: z.array(pt).max(50).optional(),
});

const note = z.object({
  id,
  levelId: id,
  x: coord,
  y: coord,
  text: z.string().max(LIMITS.note),
  leaderTo: pt.nullable().optional(),
  kind: z.enum(["note", "label", "cloud", "north"]),
});

const photoPin = z.object({ id, levelId: id, x: coord, y: coord, fileId: z.string().max(80), caption: label });

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const camera = z.object({
  id,
  name: label,
  levelId: id,
  pos: vec3,
  target: vec3,
  fov: z.number().finite().min(10).max(120),
  mode: z.enum(["orbit", "walk", "plan"]),
});

const sectionLine = z.object({ id, levelId: id, a: pt, b: pt, depthIn: pos, flip: z.boolean(), label });

const underlay = z.object({
  fileId: z.string().max(80),
  page: z.number().int().min(1).optional(),
  x: coord,
  y: coord,
  scale: z.number().finite().min(0.0001).max(1000),
  rotDeg: z.number().finite(),
  opacity: z.number().min(0).max(1),
  locked: z.boolean(),
});

const defaults = z.object({
  wallThickIn: z.number().finite().min(0.5).max(36),
  ceilingIn: z.number().finite().min(12).max(300),
  counterIn: pos,
  backsplashIn: pos,
  wallCabGapIn: pos,
  toeIn: pos,
  overhangIn: pos,
  seatingOverhangIn: pos,
  doorStyle: z.string().max(32),
  finish: z.string().max(64),
  doorWidthIn: pos,
  doorHeightIn: pos,
  windowWidthIn: pos,
  windowHeightIn: pos,
  windowSillIn: pos,
});

const level = z.object({ id, name: label, elevationIn: coord, ceilingIn: z.number().finite().min(12).max(300) });

export const PlanDocSchema = z.object({
  v: z.literal(1),
  units: z.literal("in"),
  settings: z.object({
    snapIn: z.number().finite().min(0).max(12),
    angleSnap: z.union([z.literal(0), z.literal(15), z.literal(45), z.literal(90)]),
    defaults,
  }),
  levels: z.array(level).min(1).max(LIMITS.levels),
  walls: z.array(wall).max(LIMITS.walls),
  openings: z.array(opening).max(LIMITS.openings),
  rooms: z.array(room).max(LIMITS.rooms),
  items: z.array(placedItem).max(LIMITS.items),
  runs: z.array(cabinetRun).max(LIMITS.runs),
  counters: z.array(counter).max(LIMITS.counters),
  finishes: z.array(finishRegion).max(LIMITS.finishes),
  trims: z.array(trimRun).max(LIMITS.trims),
  electrical: z.array(device).max(LIMITS.electrical),
  stairs: z.array(stair).max(LIMITS.stairs),
  structure: z.array(structural).max(LIMITS.structure),
  dims: z.array(dim).max(LIMITS.dims),
  notes: z.array(note).max(LIMITS.notes),
  photos: z.array(photoPin).max(LIMITS.photos),
  cameras: z.array(camera).max(LIMITS.cameras),
  sections: z.array(sectionLine).max(LIMITS.sections),
  underlay: underlay.nullable().optional(),
  ignoredChecks: z.array(z.string().max(80)).max(500),
  meta: z.object({
    templateOf: z.string().max(80).optional(),
    createdFrom: z
      .object({ designId: z.number().int(), versionId: z.number().int().nullable() })
      .nullable()
      .optional(),
  }),
});

/** Bring any stored/incoming doc up to the current shape. Unknown → empty doc.
 *  Older `v` values get upgraded here as the schema evolves (none yet). */
export function migrateDoc(raw: unknown): PlanDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length === 0) return emptyDoc();
  const base = emptyDoc();
  // Fill any missing collections so partially-written docs still parse.
  const filled: Record<string, unknown> = { ...base, ...r };
  const settings = (r.settings as Record<string, unknown> | undefined) ?? {};
  filled.settings = {
    ...base.settings,
    ...settings,
    defaults: { ...base.settings.defaults, ...((settings.defaults as object | undefined) ?? {}) },
  };
  filled.meta = { ...base.meta, ...((r.meta as object | undefined) ?? {}) };
  filled.v = 1;
  filled.units = "in";
  return filled as unknown as PlanDoc;
}

/** Validate a doc coming from the client or an agent. Returns the parsed doc or
 *  a short error string. */
export function parseDoc(raw: unknown): { ok: true; doc: PlanDoc } | { ok: false; error: string } {
  const res = PlanDocSchema.safeParse(migrateDoc(raw));
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path?.join(".") || "doc";
    return { ok: false, error: `Invalid plan at ${where}: ${first?.message ?? "unknown"}` };
  }
  return { ok: true, doc: res.data as PlanDoc };
}

// ─── Formatting + small math helpers (client-safe) ──────────────────────────

/** 100.5 → `8' 4½"`; 11.5 → `11½"`; 36 → `3' 0"` (or `36"` with inchesOnly,
 *  the cabinet-nominal style). */
export function fmtIn(inches: number, opts: { forceFeet?: boolean; inchesOnly?: boolean; frac?: 2 | 4 | 8 | 16 } = {}): string {
  const frac = opts.frac ?? 16;
  const sign = inches < 0 ? "-" : "";
  const abs = Math.abs(inches);
  const total = Math.round(abs * frac);
  const whole = Math.floor(total / frac);
  const rem = total - whole * frac;
  const fracStr = rem === 0 ? "" : fracLabel(rem, frac);
  const feet = Math.floor(whole / 12);
  const inch = whole - feet * 12;
  if (opts.inchesOnly || (feet === 0 && !opts.forceFeet)) return `${sign}${whole}${fracStr}"`;
  return `${sign}${feet}' ${inch}${fracStr}"`;
}

function fracLabel(n: number, d: number): string {
  let a = n;
  let b = d;
  while (a % 2 === 0 && b % 2 === 0) {
    a /= 2;
    b /= 2;
  }
  const map: Record<string, string> = { "1/2": "½", "1/4": "¼", "3/4": "¾", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞" };
  return map[`${a}/${b}`] ?? ` ${a}/${b}`;
}

/** Parse "8' 4 1/2"", "8'4.5", "100.5", "100.5in", "8ft" → inches (null if unparsable). */
export function parseIn(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/″|”/g, '"').replace(/′|’/g, "'");
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(-?)\s*(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet))?\s*(?:(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*(?:"|in|inch(?:es)?)?)?$/);
  if (!m) return null;
  const neg = m[1] === "-" ? -1 : 1;
  const ft = m[2] ? Number(m[2]) : 0;
  const inch = m[3] ? Number(m[3]) : 0;
  const fr = m[4] && m[5] && Number(m[5]) !== 0 ? Number(m[4]) / Number(m[5]) : 0;
  if (!m[2] && !m[3] && !m[4]) return null;
  return neg * (ft * 12 + inch + fr);
}

export function sqIn2Sf(sqIn: number): number {
  return sqIn / 144;
}

export function in2Lf(inches: number): number {
  return inches / 12;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function wallLength(w: Pick<Wall, "a" | "b">): number {
  return dist(w.a, w.b);
}

/** Signed polygon area in square inches (positive = clockwise in y-down space). */
export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonPerimeter(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const hit = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Counts used for version diffs and the design list. */
export interface DocCounts {
  walls: number;
  openings: number;
  rooms: number;
  items: number;
  cabinets: number;
  appliances: number;
  fixtures: number;
  devices: number;
  areaSf: number;
}

export function docCounts(doc: PlanDoc): DocCounts {
  const cab = new Set<PlaceKind>(["base", "wall", "tall", "vanity", "island"]);
  return {
    walls: doc.walls.length,
    openings: doc.openings.length,
    rooms: doc.rooms.length,
    items: doc.items.length,
    cabinets: doc.items.filter((i) => cab.has(i.kind)).length,
    appliances: doc.items.filter((i) => i.kind === "appliance").length,
    fixtures: doc.items.filter((i) => i.kind === "plumbing").length,
    devices: doc.electrical.length,
    areaSf: Math.round(doc.rooms.reduce((s, r) => s + r.areaSf, 0)),
  };
}

/** Everything on one level, for the canvas and the 3D scene. */
export function levelSlice(doc: PlanDoc, levelId: string) {
  const wallIds = new Set(doc.walls.filter((w) => w.levelId === levelId).map((w) => w.id));
  return {
    walls: doc.walls.filter((w) => w.levelId === levelId),
    openings: doc.openings.filter((o) => wallIds.has(o.wallId)),
    rooms: doc.rooms.filter((r) => r.levelId === levelId),
    items: doc.items.filter((i) => i.levelId === levelId),
    runs: doc.runs.filter((r) => r.levelId === levelId),
    counters: doc.counters.filter((c) => c.levelId === levelId),
    finishes: doc.finishes.filter((f) => f.levelId === levelId),
    trims: doc.trims.filter((t) => t.levelId === levelId),
    electrical: doc.electrical.filter((e) => e.levelId === levelId),
    stairs: doc.stairs.filter((s) => s.fromLevelId === levelId),
    structure: doc.structure.filter((s) => s.levelId === levelId),
    dims: doc.dims.filter((d) => d.levelId === levelId),
    notes: doc.notes.filter((n) => n.levelId === levelId),
    photos: doc.photos.filter((p) => p.levelId === levelId),
    cameras: doc.cameras.filter((c) => c.levelId === levelId),
    sections: doc.sections.filter((s) => s.levelId === levelId),
  };
}
