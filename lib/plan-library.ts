// Generic libraries for the floor-plan designer (docs/floor-plan-designer-plan.md §7):
// cabinets, appliances, fixtures, furniture, structure; finish presets; the
// electrical symbol set; opening/door/edge/trim vocabularies; cabinet callout
// tags; and room templates that stamp a small PlanDoc fragment at a click.
//
// Pure and client-safe: types + data + helpers only. No db, no React.
// Every dimension is inches. Plan space is y-down; an item at rotDeg 0 has
// its back against the top wall and its front facing +y.

import {
  newId,
  type DesignerDefaults,
  type ElecType,
  type FinishRef,
  type Note,
  type Opening,
  type PlaceKind,
  type PlacedItem,
  type Pt,
  type TilePattern,
  type Wall,
} from "./plan-doc.ts";
import { rectWalls } from "./plan-geometry.ts";

// ─── Library items ───────────────────────────────────────────────────────────

export interface LibraryItem {
  /** Stable key, e.g. "base-B36", "appl-range-30", "plumb-toilet". */
  key: string;
  kind: PlaceKind;
  family: "cabinet" | "appliance" | "plumbing" | "electrical" | "lighting" | "hvac" | "furniture" | "structure";
  label: string;
  /** Drawing callout, e.g. "B36", "W3030", "REF". */
  tag: string;
  /** Footprint width, depth, height. */
  w: number;
  d: number;
  h: number;
  /** Bottom above floor (0 for base, 54 for wall cabinets…). */
  z: number;
  /** Kind-specific: doors, drawers, corner, power, vent… */
  props: Record<string, unknown>;
  /** Lowercase keywords for the picker. */
  search: string;
}

type Family = LibraryItem["family"];

/** Standard cabinet dimensions. */
const BASE_D = 24;
const BASE_H = 34.5;
const WALL_D = 12;
const WALL_Z = 54; // 36 counter + 18 gap
const TALL_D = 24;
const VAN_D = 21;
const VAN_H = 34.5;

function item(
  key: string,
  kind: PlaceKind,
  family: Family,
  label: string,
  tag: string,
  w: number,
  d: number,
  h: number,
  z: number,
  props: Record<string, unknown> = {},
  extraSearch = "",
): LibraryItem {
  const search = [key, kind, family, label, tag, extraSearch]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9./x-]+/g, " ")
    .trim();
  return { key, kind, family, label, tag, w, d, h, z, props, search };
}

const cab = (key: string, kind: PlaceKind, label: string, tag: string, w: number, d: number, h: number, z: number, props: Record<string, unknown>, extra = "") =>
  item(key, kind, "cabinet", label, tag, w, d, h, z, props, extra);
const appl = (key: string, label: string, tag: string, w: number, d: number, h: number, z: number, props: Record<string, unknown>, extra = "") =>
  item(key, "appliance", "appliance", label, tag, w, d, h, z, props, extra);
const plumb = (key: string, label: string, tag: string, w: number, d: number, h: number, z: number, props: Record<string, unknown>, extra = "") =>
  item(key, "plumbing", "plumbing", label, tag, w, d, h, z, props, extra);
const furn = (key: string, label: string, tag: string, w: number, d: number, h: number, props: Record<string, unknown> = {}, extra = "") =>
  item(key, "furniture", "furniture", label, tag, w, d, h, 0, props, extra);
const struct = (key: string, label: string, tag: string, w: number, d: number, h: number, props: Record<string, unknown> = {}, extra = "") =>
  item(key, "structure", "structure", label, tag, w, d, h, 0, props, extra);

const BASE_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48];
const DRAWER_BASE_WIDTHS = [12, 15, 18, 21, 24, 27, 30, 33, 36];
const WALL_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48];
const WALL_HEIGHTS = [12, 15, 18, 24, 30, 36, 42];

const pad2 = (n: number) => (Number.isInteger(n) && n < 10 ? `0${n}` : String(n));

function baseCabinets(): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const w of BASE_WIDTHS) {
    const doors = w < 24 ? 1 : 2;
    out.push(cab(`base-B${w}`, "base", `Base cabinet ${w}in`, `B${w}`, w, BASE_D, BASE_H, 0, { doors, drawers: 1 }, "standard base door drawer"));
  }
  for (const w of [30, 33, 36]) {
    out.push(cab(`base-SB${w}`, "base", `Sink base ${w}in`, `SB${w}`, w, BASE_D, BASE_H, 0, { doors: 2, drawers: 0, sink: true, falseFront: true }, "sink base"));
  }
  for (const w of DRAWER_BASE_WIDTHS) {
    out.push(cab(`base-DB${w}`, "base", `Drawer base ${w}in (3 drawer)`, `DB${w}`, w, BASE_D, BASE_H, 0, { doors: 0, drawers: 3 }, "drawer base three drawer stack"));
  }
  for (const w of [36, 39, 42]) {
    out.push(cab(`base-BLC${w}`, "base", `Blind corner base ${w}in`, `BLC${w}`, w, BASE_D, BASE_H, 0, { doors: 1, drawers: 1, corner: "blind", pullIn: 3 }, "blind corner base"));
  }
  for (const w of [33, 36]) {
    out.push(cab(`base-LS${w}`, "base", `Lazy susan corner base ${w}in`, `LS${w}`, w, w, BASE_H, 0, { doors: 2, drawers: 0, corner: "lazy" }, "lazy susan corner base"));
  }
  out.push(cab("base-DCB36", "base", "Diagonal corner base 36in", "DCB36", 36, 36, BASE_H, 0, { doors: 1, drawers: 0, corner: "diag" }, "diagonal corner base"));
  return out;
}

function wallCabinets(): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const h of WALL_HEIGHTS) {
    for (const w of WALL_WIDTHS) {
      const doors = w < 24 ? 1 : 2;
      const tag = `W${pad2(w)}${h}`;
      out.push(cab(`wall-${tag}`, "wall", `Wall cabinet ${w}in x ${h}in`, tag, w, WALL_D, h, WALL_Z, { doors, drawers: 0 }, "upper wall cabinet"));
    }
  }
  out.push(cab("wall-WDC2430", "wall", "Wall diagonal corner 24in x 30in", "WDC2430", 24, 24, 30, WALL_Z, { doors: 1, drawers: 0, corner: "diag" }, "diagonal corner wall upper"));
  out.push(cab("wall-W3615-fridge", "wall", "Over-fridge wall cabinet 36in x 15in (24 deep)", "W361524", 36, 24, 15, 96 - 15, { doors: 2, drawers: 0, over: "fridge" }, "over fridge refrigerator wall upper deep"));
  out.push(cab("wall-W3618-fridge", "wall", "Over-fridge wall cabinet 36in x 18in (24 deep)", "W361824", 36, 24, 18, 96 - 18, { doors: 2, drawers: 0, over: "fridge" }, "over fridge refrigerator wall upper deep"));
  out.push(cab("wall-W3018-range", "wall", "Over-range wall cabinet 30in x 18in", "W3018", 30, WALL_D, 18, 66, { doors: 2, drawers: 0, over: "range" }, "over range hood wall upper"));
  return out;
}

function tallCabinets(): LibraryItem[] {
  return [
    cab("tall-T1884", "tall", "Tall pantry 18in x 84in", "T1884", 18, TALL_D, 84, 0, { doors: 2, drawers: 0, pantry: true }, "pantry tall"),
    cab("tall-T2484", "tall", "Tall pantry 24in x 84in", "T2484", 24, TALL_D, 84, 0, { doors: 2, drawers: 0, pantry: true }, "pantry tall"),
    cab("tall-T2496", "tall", "Tall pantry 24in x 96in", "T2496", 24, TALL_D, 96, 0, { doors: 2, drawers: 0, pantry: true }, "pantry tall"),
    cab("tall-TOC3084", "tall", "Oven cabinet 30in x 84in", "TOC3084", 30, TALL_D, 84, 0, { doors: 2, drawers: 1, oven: true }, "wall oven tall cabinet"),
    cab("tall-TOC3096", "tall", "Oven cabinet 30in x 96in", "TOC3096", 30, TALL_D, 96, 0, { doors: 2, drawers: 1, oven: true }, "wall oven tall cabinet"),
    cab("tall-TU2484", "tall", "Utility cabinet 24in x 84in", "TU2484", 24, TALL_D, 84, 0, { doors: 2, drawers: 0, utility: true }, "utility broom tall cabinet"),
  ];
}

function vanities(): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const w of [24, 30, 36, 48]) {
    out.push(cab(`vanity-VB${w}`, "vanity", `Vanity base ${w}in`, `VB${w}`, w, VAN_D, VAN_H, 0, { doors: w < 30 ? 1 : 2, drawers: w >= 36 ? 2 : 0, sink: true }, "bath vanity base"));
  }
  for (const w of [30, 36]) {
    out.push(cab(`vanity-VSB${w}`, "vanity", `Vanity sink base ${w}in`, `VSB${w}`, w, VAN_D, VAN_H, 0, { doors: 2, drawers: 0, sink: true, falseFront: true }, "bath vanity sink base"));
  }
  for (const w of [18, 24]) {
    out.push(cab(`vanity-VDB${w}`, "vanity", `Vanity drawer base ${w}in`, `VDB${w}`, w, VAN_D, VAN_H, 0, { doors: 0, drawers: 3 }, "bath vanity drawer base"));
  }
  return out;
}

function accessories(): LibraryItem[] {
  return [
    item("acc-filler-3", "generic", "cabinet", "Filler 3in", "F3", 3, BASE_D, BASE_H, 0, { accessory: "filler" }, "filler strip"),
    item("acc-end-panel", "generic", "cabinet", "End panel", "EP", 0.75, BASE_D, BASE_H, 0, { accessory: "endPanel" }, "finished end panel side"),
    item("acc-toe-kick", "generic", "cabinet", "Toe kick 96in", "TK96", 96, 0.75, 4.5, 0, { accessory: "toe" }, "toe kick board"),
    item("acc-crown", "generic", "cabinet", "Crown moulding 96in", "CM96", 96, 3, 3, 93, { accessory: "crown" }, "crown molding moulding"),
    item("acc-light-rail", "generic", "cabinet", "Light rail 96in", "LR96", 96, 1.5, 1.5, 52.5, { accessory: "lightRail" }, "light rail under cabinet"),
    item("acc-fridge-panel", "generic", "cabinet", "Refrigerator panel", "RP", 0.75, 24, 96, 0, { accessory: "fridgePanel" }, "refrigerator fridge end panel tall"),
  ];
}

function appliances(): LibraryItem[] {
  return [
    appl("appl-range-30", "Range 30in", "RNG30", 30, 26, 36, 0, { power: "240", gas: false, vent: true }, "stove oven range freestanding"),
    appl("appl-range-36", "Range 36in", "RNG36", 36, 27, 36, 0, { power: "240", gas: true, vent: true }, "stove oven range pro"),
    appl("appl-range-48", "Range 48in", "RNG48", 48, 28, 36, 0, { power: "240", gas: true, vent: true }, "stove oven range pro double"),
    appl("appl-cooktop-30", "Cooktop 30in", "CT30", 30, 21, 4, 36, { power: "240", vent: true }, "cooktop hob induction gas"),
    appl("appl-cooktop-36", "Cooktop 36in", "CT36", 36, 21, 4, 36, { power: "240", vent: true }, "cooktop hob induction gas"),
    appl("appl-oven-27", "Wall oven 27in single", "WO27", 27, 24, 29, 30, { power: "240", double: false }, "wall oven single built-in"),
    appl("appl-oven-27-double", "Wall oven 27in double", "WO27D", 27, 24, 51, 24, { power: "240", double: true }, "wall oven double built-in"),
    appl("appl-oven-30", "Wall oven 30in single", "WO30", 30, 24, 29, 30, { power: "240", double: false }, "wall oven single built-in"),
    appl("appl-oven-30-double", "Wall oven 30in double", "WO30D", 30, 24, 51, 24, { power: "240", double: true }, "wall oven double built-in"),
    appl("appl-fridge-30", "Refrigerator 30in", "REF30", 30, 30, 68, 0, { power: "120", water: true }, "refrigerator fridge freezer"),
    appl("appl-fridge-33", "Refrigerator 33in", "REF33", 33, 30, 70, 0, { power: "120", water: true }, "refrigerator fridge freezer"),
    appl("appl-fridge-36", "Refrigerator 36in", "REF36", 36, 30, 70, 0, { power: "120", water: true }, "refrigerator fridge freezer french door"),
    appl("appl-fridge-36-cd", "Refrigerator 36in counter-depth", "REF36CD", 36, 24, 72, 0, { power: "120", water: true, counterDepth: true }, "refrigerator fridge counter depth"),
    appl("appl-dw-24", "Dishwasher 24in", "DW", 24, 24, 34.5, 0, { power: "120", water: true, drain: true }, "dishwasher"),
    appl("appl-micro-24", "Microwave 24in (built-in)", "MW24", 24, 16, 14, 36, { power: "120" }, "microwave built-in counter"),
    appl("appl-micro-30", "Microwave 30in (over-range)", "MW30", 30, 16, 17, 66, { power: "120", vent: true, over: "range" }, "microwave over the range otr hood"),
    appl("appl-hood-30", "Range hood 30in", "HD30", 30, 20, 12, 66, { power: "120", vent: true, cfm: 400 }, "range hood vent exhaust"),
    appl("appl-hood-36", "Range hood 36in", "HD36", 36, 22, 12, 66, { power: "120", vent: true, cfm: 600 }, "range hood vent exhaust"),
    appl("appl-hood-48", "Range hood 48in", "HD48", 48, 24, 12, 66, { power: "120", vent: true, cfm: 900 }, "range hood vent exhaust pro"),
    appl("appl-washer-27", "Washer 27in", "WSH", 27, 30, 38, 0, { power: "120", water: true, drain: true }, "washing machine laundry"),
    appl("appl-dryer-27", "Dryer 27in", "DRY", 27, 30, 38, 0, { power: "240", vent: true }, "clothes dryer laundry"),
    appl("appl-wd-stacked", "Stacked washer/dryer 27in", "W/D", 27, 32, 76, 0, { power: "240", water: true, drain: true, vent: true, stacked: true }, "stacked washer dryer laundry"),
    appl("appl-wine-24", "Wine fridge 24in", "WINE", 24, 24, 34.5, 0, { power: "120" }, "wine cooler fridge undercounter"),
    appl("appl-bev-24", "Beverage center 24in", "BEV", 24, 24, 34.5, 0, { power: "120" }, "beverage fridge cooler undercounter"),
    appl("appl-compactor-15", "Trash compactor 15in", "TC15", 15, 24, 34.5, 0, { power: "120" }, "trash compactor"),
  ];
}

function plumbing(): LibraryItem[] {
  return [
    plumb("plumb-sink-30", "Kitchen sink 30in", "SINK30", 30, 20, 10, 36, { bowls: 1, mount: "undermount" }, "kitchen sink single bowl"),
    plumb("plumb-sink-33", "Kitchen sink 33in", "SINK33", 33, 22, 10, 36, { bowls: 2, mount: "undermount" }, "kitchen sink double bowl"),
    plumb("plumb-bar-sink-15", "Bar sink 15in", "BSINK", 15, 15, 8, 36, { bowls: 1, mount: "undermount" }, "bar prep sink small"),
    plumb("plumb-faucet", "Faucet", "FCT", 8, 3, 14, 36, { holes: 1 }, "faucet tap kitchen bath"),
    plumb("plumb-toilet", "Toilet", "WC", 20, 28, 30, 0, { clearanceIn: 30, roughIn: 12 }, "toilet water closet wc"),
    plumb("plumb-bidet", "Bidet", "BD", 15, 25, 16, 0, { roughIn: 12 }, "bidet"),
    plumb("plumb-tub-60", "Bathtub 60in", "TUB60", 60, 30, 20, 0, { alcove: true, drain: "left" }, "bathtub tub alcove soaking"),
    plumb("plumb-tub-66", "Bathtub 66in", "TUB66", 66, 30, 20, 0, { alcove: true, drain: "left" }, "bathtub tub alcove soaking"),
    plumb("plumb-tub-72", "Bathtub 72in", "TUB72", 72, 30, 20, 0, { alcove: true, drain: "left" }, "bathtub tub alcove soaking"),
    plumb("plumb-tub-shower-60", "Tub-shower 60in", "TS60", 60, 30, 20, 0, { alcove: true, shower: true, surroundH: 72 }, "tub shower combo alcove"),
    plumb("plumb-shower-32", "Shower base 32in", "SH32", 32, 32, 4, 0, { drain: "center" }, "shower pan base stall"),
    plumb("plumb-shower-36", "Shower base 36in", "SH36", 36, 36, 4, 0, { drain: "center" }, "shower pan base stall"),
    plumb("plumb-shower-48", "Shower base 48in", "SH48", 48, 36, 4, 0, { drain: "center" }, "shower pan base"),
    plumb("plumb-shower-60", "Shower base 60in", "SH60", 60, 36, 4, 0, { drain: "left" }, "shower pan base walk-in"),
    plumb("plumb-vanity-sink", "Vanity sink", "LAV", 19, 16, 8, 34.5, { mount: "undermount" }, "vanity sink lavatory lav bath"),
    plumb("plumb-pedestal-sink", "Pedestal sink", "PED", 24, 20, 34, 0, { mount: "pedestal" }, "pedestal sink lavatory bath"),
    plumb("plumb-laundry-sink", "Laundry sink", "LSINK", 24, 21, 8, 34.5, { mount: "drop-in" }, "laundry sink drop in"),
    plumb("plumb-water-heater", "Water heater (round 22in)", "WH", 22, 22, 60, 0, { shape: "round", gallons: 50, power: "gas" }, "water heater tank round"),
    plumb("plumb-utility-sink", "Utility sink", "USINK", 23, 25, 33, 0, { mount: "floor" }, "utility sink tub slop mud"),
  ];
}

function furniture(): LibraryItem[] {
  return [
    furn("furn-table-36x72", "Dining table 36in x 72in", "TBL", 72, 36, 30, { seats: 6 }, "dining table rectangular"),
    furn("furn-table-42x84", "Dining table 42in x 84in", "TBL", 84, 42, 30, { seats: 8 }, "dining table rectangular"),
    furn("furn-table-round-48", "Dining table round 48in", "TBL", 48, 48, 30, { seats: 4, shape: "round" }, "dining table round"),
    furn("furn-chair", "Chair", "CH", 18, 18, 34, {}, "dining chair seat"),
    furn("furn-sofa-84", "Sofa 84in", "SOFA", 84, 36, 34, { seats: 3 }, "sofa couch"),
    furn("furn-loveseat", "Loveseat", "LOVE", 60, 36, 34, { seats: 2 }, "loveseat couch sofa"),
    furn("furn-armchair", "Armchair", "ARM", 34, 36, 34, { seats: 1 }, "armchair accent chair"),
    furn("furn-bed-twin", "Bed twin", "BED-T", 39, 75, 24, { size: "twin" }, "bed twin mattress"),
    furn("furn-bed-full", "Bed full", "BED-F", 54, 75, 24, { size: "full" }, "bed full double mattress"),
    furn("furn-bed-queen", "Bed queen", "BED-Q", 60, 80, 24, { size: "queen" }, "bed queen mattress"),
    furn("furn-bed-king", "Bed king", "BED-K", 76, 80, 24, { size: "king" }, "bed king mattress"),
    furn("furn-nightstand", "Nightstand", "NS", 24, 20, 26, {}, "nightstand bedside table"),
    furn("furn-dresser", "Dresser", "DRS", 60, 18, 34, { drawers: 6 }, "dresser chest drawers"),
    furn("furn-desk", "Desk 30in x 60in", "DESK", 60, 30, 30, {}, "desk office"),
    furn("furn-bookcase", "Bookcase", "BK", 36, 12, 72, { shelves: 5 }, "bookcase bookshelf shelving"),
    furn("furn-tv-console", "TV console", "TV", 60, 18, 24, {}, "tv console media stand"),
  ];
}

function structure(): LibraryItem[] {
  return [
    struct("struct-post-4x4", "Post 4x4", "P4", 3.5, 3.5, 96, { nominal: "4x4" }, "post column 4x4"),
    struct("struct-post-6x6", "Post 6x6", "P6", 5.5, 5.5, 96, { nominal: "6x6" }, "post column 6x6"),
    struct("struct-post-round-8", "Post round 8in", "P8R", 8, 8, 96, { shape: "round" }, "post column round steel lally"),
  ];
}

export const LIBRARY: readonly LibraryItem[] = Object.freeze([
  ...baseCabinets(),
  ...wallCabinets(),
  ...tallCabinets(),
  ...vanities(),
  ...accessories(),
  ...appliances(),
  ...plumbing(),
  ...furniture(),
  ...structure(),
]);

const LIBRARY_BY_KEY: ReadonlyMap<string, LibraryItem> = new Map(LIBRARY.map((i) => [i.key, i]));

export function libraryItem(key: string): LibraryItem | null {
  return LIBRARY_BY_KEY.get(key) ?? null;
}

export function libraryByFamily(family: LibraryItem["family"]): LibraryItem[] {
  return LIBRARY.filter((i) => i.family === family);
}

/** Token search over key/label/tag/keywords. Every token must match; exact
 *  tag or key matches sort first, then label prefix matches, then the rest in
 *  library order. Empty query lists everything (optionally filtered by kind). */
export function searchLibrary(q: string, kind?: PlaceKind): LibraryItem[] {
  const pool = kind ? LIBRARY.filter((i) => i.kind === kind) : LIBRARY.slice();
  const tokens = q.toLowerCase().replace(/["”″]/g, "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return pool;
  const scored: { item: LibraryItem; score: number; i: number }[] = [];
  pool.forEach((it, i) => {
    if (!tokens.every((t) => it.search.includes(t))) return;
    const joined = tokens.join(" ");
    const tag = it.tag.toLowerCase();
    const label = it.label.toLowerCase();
    let score = 3;
    if (tag === joined || it.key.toLowerCase() === joined) score = 0;
    else if (tag.startsWith(joined)) score = 1;
    else if (label.startsWith(joined)) score = 2;
    scored.push({ item: it, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.item);
}

/** Build a PlacedItem from a library entry at a plan point (footprint centre). */
export function itemFromLibrary(key: string, levelId: string, at: Pt, rotDeg = 0): PlacedItem | null {
  const it = libraryItem(key);
  if (!it) return null;
  return {
    id: newId("i"),
    levelId,
    kind: it.kind,
    catalogId: null,
    libraryKey: it.key,
    label: it.label,
    tag: it.tag,
    x: at.x,
    y: at.y,
    z: it.z,
    rotDeg,
    w: it.w,
    d: it.d,
    h: it.h,
    phase: "new",
    wallId: null,
    runId: null,
    props: { ...it.props },
  };
}

// ─── Cabinet callout tags ────────────────────────────────────────────────────

const numTag = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);

/** Callout tag for a cabinet by kind + nominal size, e.g. ("base", 36, 34.5)
 *  → "B36", ("wall", 30, 30) → "W3030", ("tall", 24, 84) → "T2484",
 *  ("vanity", 30, 34.5) → "VB30". Props refine: corner blind/lazy/diag, sink,
 *  drawers-only, oven/utility talls, over-fridge depth. Non-cabinet kinds → "". */
export function cabinetTag(kind: PlaceKind, wIn: number, hIn: number, props: Record<string, unknown> = {}): string {
  const w = numTag(wIn);
  const h = numTag(hIn);
  const corner = typeof props.corner === "string" ? props.corner : "";
  const doors = typeof props.doors === "number" ? props.doors : null;
  const drawers = typeof props.drawers === "number" ? props.drawers : null;
  switch (kind) {
    case "base": {
      if (corner === "blind") return `BLC${w}`;
      if (corner === "lazy") return `LS${w}`;
      if (corner === "diag") return `DCB${w}`;
      if (props.sink) return `SB${w}`;
      if (drawers !== null && drawers >= 2 && (doors === null || doors === 0)) return `DB${w}`;
      return `B${w}`;
    }
    case "wall": {
      if (corner) return `WDC${pad2(wIn)}${h}`;
      const deep = props.over === "fridge" || (typeof props.depth === "number" && props.depth >= 24);
      return `W${pad2(wIn)}${h}${deep ? "24" : ""}`;
    }
    case "tall": {
      if (props.oven) return `TOC${pad2(wIn)}${h}`;
      if (props.utility) return `TU${pad2(wIn)}${h}`;
      return `T${pad2(wIn)}${h}`;
    }
    case "vanity": {
      if (drawers !== null && drawers >= 2 && (doors === null || doors === 0)) return `VDB${w}`;
      if (props.falseFront || props.sinkBase) return `VSB${w}`;
      return `VB${w}`;
    }
    case "island":
      return `ISL${w}`;
    default:
      return "";
  }
}

// ─── Finish presets ──────────────────────────────────────────────────────────

export interface FinishPreset {
  key: string;
  label: string;
  /** Hex colour. */
  color: string;
  category: "paint" | "wood" | "cabinet" | "stone" | "quartz" | "tile" | "flooring" | "carpet" | "metal" | "glass" | "concrete";
  /** Optional procedural texture the 3D scene may generate, e.g. "wood-oak". */
  textureKey?: string;
  roughness: number;
  metalness: number;
  /** For tile presets. */
  defaultPattern?: TilePattern;
}

const tile = (layout: TilePattern["layout"], tileWIn: number, tileHIn: number, groutIn: number, groutColor: string): TilePattern =>
  ({ layout, tileWIn, tileHIn, groutIn, groutColor });

function fp(key: string, label: string, color: string, category: FinishPreset["category"], roughness: number, metalness: number, textureKey?: string, defaultPattern?: TilePattern): FinishPreset {
  const p: FinishPreset = { key, label, color, category, roughness, metalness };
  if (textureKey) p.textureKey = textureKey;
  if (defaultPattern) p.defaultPattern = defaultPattern;
  return p;
}

export const FINISH_PRESETS: readonly FinishPreset[] = Object.freeze([
  // Paints
  fp("paint-white", "White paint", "#f4f4f0", "paint", 0.9, 0),
  fp("paint-warm-white", "Warm white paint", "#f6f1e6", "paint", 0.9, 0),
  fp("paint-off-white", "Off-white paint", "#efe9dc", "paint", 0.9, 0),
  fp("paint-greige", "Greige paint", "#cfc8bb", "paint", 0.9, 0),
  fp("paint-gray", "Gray paint", "#b8b8b5", "paint", 0.9, 0),
  fp("paint-navy", "Navy paint", "#2e3a4f", "paint", 0.85, 0),
  fp("paint-sage", "Sage paint", "#a9b39a", "paint", 0.9, 0),
  fp("paint-black", "Black paint", "#262626", "paint", 0.8, 0),
  // Cabinet finishes
  fp("cab-white", "Painted white cabinet", "#f2f1ec", "cabinet", 0.5, 0),
  fp("cab-gray", "Painted gray cabinet", "#9b9d9a", "cabinet", 0.5, 0),
  fp("cab-navy", "Painted navy cabinet", "#2b3a52", "cabinet", 0.5, 0),
  fp("cab-green", "Painted green cabinet", "#4c5e4b", "cabinet", 0.5, 0),
  fp("cab-oak-natural", "Stained oak (natural)", "#c9a36a", "cabinet", 0.6, 0, "wood-oak"),
  fp("cab-white-oak-rift", "White oak (rift sawn)", "#d8c3a0", "cabinet", 0.6, 0, "wood-oak-rift"),
  fp("cab-walnut", "Walnut", "#5c3f2c", "cabinet", 0.55, 0, "wood-walnut"),
  fp("cab-maple-natural", "Maple (natural)", "#e3c99e", "cabinet", 0.6, 0, "wood-maple"),
  fp("cab-cherry", "Cherry", "#8d4a2f", "cabinet", 0.55, 0, "wood-cherry"),
  fp("cab-alder", "Alder", "#b98860", "cabinet", 0.6, 0, "wood-alder"),
  // Counters: stone, quartz, wood, laminate
  fp("stone-calacatta", "Calacatta marble", "#f1eee8", "stone", 0.2, 0, "stone-calacatta"),
  fp("stone-carrara", "Carrara marble", "#e6e6e4", "stone", 0.2, 0, "stone-carrara"),
  fp("stone-black-granite", "Black granite", "#232323", "stone", 0.15, 0.05, "stone-granite"),
  fp("stone-soapstone", "Soapstone", "#3d4044", "stone", 0.5, 0, "stone-soapstone"),
  fp("quartz-white", "Quartz (white)", "#f5f5f2", "quartz", 0.2, 0),
  fp("quartz-gray", "Quartz (gray)", "#bdbdb9", "quartz", 0.2, 0),
  fp("wood-butcher-block", "Butcher block", "#d2a86a", "wood", 0.6, 0, "wood-butcher"),
  fp("laminate-gray", "Laminate counter", "#c9c7c1", "stone", 0.4, 0),
  // Tile
  fp("tile-subway-white", "Subway tile (white)", "#f3f3f0", "tile", 0.15, 0, "tile-subway", tile("offset", 6, 3, 0.125, "#d9d9d4")),
  fp("tile-subway-green", "Subway tile (green)", "#6f8f7a", "tile", 0.15, 0, "tile-subway", tile("offset", 6, 3, 0.125, "#d9d9d4")),
  fp("tile-zellige", "Zellige (glossy white)", "#dfe6df", "tile", 0.1, 0, "tile-zellige", tile("straight", 4, 4, 0.0625, "#cfd4cf")),
  fp("tile-hex-mosaic", "Hex mosaic (white)", "#eeeeea", "tile", 0.3, 0, "tile-hex", tile("straight", 2, 2, 0.125, "#c9c9c4")),
  fp("tile-porcelain-12x24-gray", "Porcelain 12x24 (gray)", "#9a9a97", "tile", 0.35, 0, "tile-porcelain", tile("offset", 24, 12, 0.1875, "#7a7a77")),
  fp("tile-marble-herringbone", "Marble herringbone", "#e8e6e1", "tile", 0.2, 0, "stone-carrara", tile("herringbone", 8, 2, 0.0625, "#d0cec9")),
  fp("tile-penny-round", "Penny round (white)", "#f0efeb", "tile", 0.3, 0, "tile-penny", tile("straight", 0.75, 0.75, 0.125, "#c9c9c4")),
  // Flooring
  fp("floor-red-oak", "Red oak hardwood", "#c68e5b", "flooring", 0.5, 0, "wood-red-oak"),
  fp("floor-white-oak", "White oak hardwood", "#d7bd96", "flooring", 0.5, 0, "wood-white-oak"),
  fp("floor-hickory", "Hickory hardwood", "#c39a63", "flooring", 0.5, 0, "wood-hickory"),
  fp("floor-lvp-oak", "LVP (oak look)", "#cfb28a", "flooring", 0.45, 0, "wood-lvp"),
  fp("floor-lvp-gray", "LVP (gray)", "#9c9891", "flooring", 0.45, 0, "wood-lvp"),
  fp("floor-tile-12x24", "Floor tile 12x24", "#b9b6ae", "flooring", 0.35, 0, "tile-porcelain", tile("offset", 24, 12, 0.1875, "#8f8c85")),
  fp("carpet-beige", "Carpet (beige)", "#d4c8b4", "carpet", 1, 0, "carpet"),
  fp("concrete-polished", "Polished concrete", "#a8a7a3", "concrete", 0.45, 0, "concrete"),
  // Metals
  fp("metal-brass", "Brass", "#b8955a", "metal", 0.35, 0.9),
  fp("metal-black", "Matte black", "#1f1f1f", "metal", 0.6, 0.6),
  fp("metal-chrome", "Chrome", "#d9dcdf", "metal", 0.1, 1),
  fp("metal-nickel", "Brushed nickel", "#b9bcbb", "metal", 0.3, 0.9),
  // Glass
  fp("glass-clear", "Clear glass", "#cfe3ee", "glass", 0.05, 0),
]);

const FINISH_BY_KEY: ReadonlyMap<string, FinishPreset> = new Map(FINISH_PRESETS.map((p) => [p.key, p]));

/** Neutral fallback used when a key is unknown. */
export const FALLBACK_FINISH_KEY = "paint-gray";

export function finishPreset(key: string): FinishPreset | null {
  return FINISH_BY_KEY.get(key) ?? null;
}

/** Build a FinishRef from a preset (falls back to "paint-gray" when unknown). */
export function finishRef(key: string, overrides: Partial<FinishRef> = {}): FinishRef {
  const p = finishPreset(key) ?? (FINISH_BY_KEY.get(FALLBACK_FINISH_KEY) as FinishPreset);
  const ref: FinishRef = { key: p.key, label: p.label, color: p.color };
  if (p.textureKey) ref.textureKey = p.textureKey;
  if (p.defaultPattern) ref.pattern = { ...p.defaultPattern };
  return { ...ref, ...overrides };
}

export const DEFAULT_FINISH_KEYS = {
  floor: "floor-white-oak",
  wall: "paint-warm-white",
  ceiling: "paint-white",
  counter: "quartz-white",
  cabinet: "cab-white",
  backsplash: "tile-subway-white",
} as const satisfies { floor: string; wall: string; ceiling: string; counter: string; cabinet: string; backsplash: string };

// ─── Electrical symbols ──────────────────────────────────────────────────────

export interface ElecSymbol {
  type: ElecType;
  label: string;
  group: "power" | "switch" | "light" | "safety" | "hvac" | "data";
  /** Default mounting height above finished floor (centre). */
  defaultHeightAff: number;
  wallMounted: boolean;
}

const es = (type: ElecType, label: string, group: ElecSymbol["group"], defaultHeightAff: number, wallMounted: boolean): ElecSymbol =>
  ({ type, label, group, defaultHeightAff, wallMounted });

export const ELEC_SYMBOLS: readonly ElecSymbol[] = Object.freeze([
  es("outlet", "Duplex outlet", "power", 15, true),
  es("gfci", "GFCI outlet", "power", 42, true),
  es("outlet240", "240V outlet", "power", 15, true),
  es("switch", "Switch", "switch", 48, true),
  es("switch3", "3-way switch", "switch", 48, true),
  es("dimmer", "Dimmer switch", "switch", 48, true),
  es("recessed", "Recessed light", "light", 96, false),
  es("pendant", "Pendant light", "light", 96, false),
  es("sconce", "Wall sconce", "light", 66, true),
  es("underCab", "Under-cabinet light", "light", 54, true),
  es("surface", "Surface-mount light", "light", 96, false),
  es("fan", "Ceiling fan", "light", 96, false),
  es("panel", "Electrical panel", "power", 60, true),
  es("smoke", "Smoke / CO detector", "safety", 96, false),
  es("data", "Data / cable jack", "data", 15, true),
  es("register", "Supply register", "hvac", 0, false),
  es("return", "Return air grille", "hvac", 12, true),
  es("exhaust", "Exhaust fan", "hvac", 96, false),
  es("miniSplit", "Mini-split head", "hvac", 84, true),
]);

const ELEC_BY_TYPE: ReadonlyMap<ElecType, ElecSymbol> = new Map(ELEC_SYMBOLS.map((s) => [s.type, s]));

export function elecSymbol(type: ElecType): ElecSymbol {
  return ELEC_BY_TYPE.get(type) ?? es(type, type, "power", 48, true);
}

// ─── Openings, styles, profiles ──────────────────────────────────────────────

export const DOOR_SUBTYPES: readonly { key: string; label: string; defaultWidthIn: number }[] = Object.freeze([
  { key: "hinged", label: "Hinged", defaultWidthIn: 32 },
  { key: "pocket", label: "Pocket", defaultWidthIn: 30 },
  { key: "bifold", label: "Bifold", defaultWidthIn: 48 },
  { key: "sliding", label: "Sliding", defaultWidthIn: 72 },
  { key: "french", label: "French", defaultWidthIn: 60 },
  { key: "cased", label: "Cased opening", defaultWidthIn: 36 },
  { key: "barn", label: "Barn", defaultWidthIn: 36 },
]);

export const WINDOW_SUBTYPES: readonly { key: string; label: string; defaultWidthIn: number; defaultHeightIn: number; defaultSillIn: number }[] = Object.freeze([
  { key: "single", label: "Single hung", defaultWidthIn: 36, defaultHeightIn: 48, defaultSillIn: 36 },
  { key: "double", label: "Double (mulled)", defaultWidthIn: 72, defaultHeightIn: 48, defaultSillIn: 36 },
  { key: "picture", label: "Picture", defaultWidthIn: 60, defaultHeightIn: 48, defaultSillIn: 36 },
  { key: "casement", label: "Casement", defaultWidthIn: 30, defaultHeightIn: 48, defaultSillIn: 36 },
  { key: "slider", label: "Slider", defaultWidthIn: 48, defaultHeightIn: 36, defaultSillIn: 42 },
  { key: "bay", label: "Bay", defaultWidthIn: 96, defaultHeightIn: 60, defaultSillIn: 24 },
  { key: "transom", label: "Transom", defaultWidthIn: 36, defaultHeightIn: 18, defaultSillIn: 80 },
]);

export const OPENING_SUBTYPES: readonly { key: string; label: string }[] = Object.freeze([
  { key: "cased", label: "Cased opening" },
  { key: "arched", label: "Arched opening" },
  { key: "passthrough", label: "Pass-through" },
]);

export const DOOR_STYLES: readonly { key: string; label: string }[] = Object.freeze([
  { key: "slab", label: "Slab" },
  { key: "shaker", label: "Shaker" },
  { key: "raised", label: "Raised panel" },
  { key: "beaded", label: "Beaded inset" },
  { key: "glass", label: "Glass front" },
]);

export const EDGE_PROFILES: readonly { key: string; label: string }[] = Object.freeze([
  { key: "eased", label: "Eased" },
  { key: "bullnose", label: "Bullnose" },
  { key: "bevel", label: "Bevel" },
  { key: "ogee", label: "Ogee" },
  { key: "mitred", label: "Mitred (built-up)" },
  { key: "waterfall", label: "Waterfall" },
]);

export const TRIM_PROFILES: Record<"base" | "crown" | "casing" | "chair", readonly { key: string; label: string; heightIn: number }[]> = {
  base: Object.freeze([
    { key: "base-colonial-3", label: "Colonial 3¼\"", heightIn: 3.25 },
    { key: "base-ranch-4", label: "Ranch 4¼\"", heightIn: 4.25 },
    { key: "base-craftsman-5", label: "Craftsman 5¼\"", heightIn: 5.25 },
    { key: "base-flat-7", label: "Flat stock 7¼\"", heightIn: 7.25 },
  ]),
  crown: Object.freeze([
    { key: "crown-3", label: "Crown 3¼\"", heightIn: 3.25 },
    { key: "crown-4", label: "Crown 4½\"", heightIn: 4.5 },
    { key: "crown-5", label: "Crown 5¼\"", heightIn: 5.25 },
  ]),
  casing: Object.freeze([
    { key: "casing-colonial-2", label: "Colonial 2¼\"", heightIn: 2.25 },
    { key: "casing-craftsman-3", label: "Craftsman 3½\"", heightIn: 3.5 },
    { key: "casing-flat-4", label: "Flat stock 4\"", heightIn: 4 },
  ]),
  chair: Object.freeze([
    { key: "chair-2", label: "Chair rail 2½\"", heightIn: 2.5 },
    { key: "chair-3", label: "Chair rail 3\"", heightIn: 3 },
  ]),
};

// ─── Room templates ──────────────────────────────────────────────────────────

export interface RoomTemplate {
  key: string;
  label: string;
  description: string;
  /** Clear interior width (x) and depth (y). Walls are added outside. */
  widthIn: number;
  depthIn: number;
  build(levelId: string, origin: Pt, defaults: DesignerDefaults): { walls: Wall[]; openings: Opening[]; items: PlacedItem[]; notes?: Note[] };
}

type Side = "top" | "right" | "bottom" | "left";
type Fragment = { walls: Wall[]; openings: Opening[]; items: PlacedItem[]; notes?: Note[] };

/** Stamps a rectangular room with `widthIn` × `depthIn` clear inside, wall
 *  centrelines at half a thickness outside that, top-left interior corner at
 *  origin + t/2. `start` distances run left→right on the top/bottom walls and
 *  top→bottom on the left/right walls, measured along the interior face. */
function roomBuilder(levelId: string, origin: Pt, defaults: DesignerDefaults, widthIn: number, depthIn: number) {
  const t = defaults.wallThickIn;
  const W = widthIn;
  const H = depthIn;
  const walls = rectWalls(levelId, origin, { x: origin.x + W + t, y: origin.y + H + t }, t, defaults.ceilingIn, "existing");
  const wallOf: Record<Side, Wall> = { top: walls[0], right: walls[1], bottom: walls[2], left: walls[3] };
  const ox = origin.x + t / 2;
  const oy = origin.y + t / 2;
  const items: PlacedItem[] = [];
  const openings: Opening[] = [];
  const notes: Note[] = [];
  let doorN = 0;
  let winN = 0;

  /** Place a library item with its back against `side`, `start` inches from
   *  the corner. Returns the item (or null for an unknown key). */
  function place(side: Side, start: number, key: string, props: Record<string, unknown> = {}): PlacedItem | null {
    const it = libraryItem(key);
    if (!it) return null;
    let at: Pt;
    let rot: number;
    switch (side) {
      case "top":
        at = { x: ox + start + it.w / 2, y: oy + it.d / 2 };
        rot = 0;
        break;
      case "bottom":
        at = { x: ox + start + it.w / 2, y: oy + H - it.d / 2 };
        rot = 180;
        break;
      case "left":
        at = { x: ox + it.d / 2, y: oy + start + it.w / 2 };
        rot = 270;
        break;
      case "right":
        at = { x: ox + W - it.d / 2, y: oy + start + it.w / 2 };
        rot = 90;
        break;
    }
    const placed = itemFromLibrary(key, levelId, at, rot) as PlacedItem;
    placed.wallId = wallOf[side].id;
    placed.props = { ...placed.props, ...props };
    items.push(placed);
    return placed;
  }

  /** Place an item free-standing (no wall) at a footprint centre. */
  function placeAt(key: string, at: Pt, rotDeg = 0, props: Record<string, unknown> = {}): PlacedItem | null {
    const placed = itemFromLibrary(key, levelId, at, rotDeg);
    if (!placed) return null;
    placed.props = { ...placed.props, ...props };
    items.push(placed);
    return placed;
  }

  /** Distance from the wall's `a` end to an opening starting `start` in from
   *  the corner (interior-face convention above). */
  function atIn(side: Side, start: number, width: number): number {
    switch (side) {
      case "top":
      case "right":
        return t / 2 + start;
      case "bottom":
        return t / 2 + W - start - width;
      case "left":
        return t / 2 + H - start - width;
    }
  }

  function door(side: Side, start: number, opts: { widthIn?: number; subtype?: string; hand?: "L" | "R" } = {}): Opening {
    const widthIn = opts.widthIn ?? defaults.doorWidthIn;
    const o: Opening = {
      id: newId("o"),
      wallId: wallOf[side].id,
      atIn: atIn(side, start, widthIn),
      widthIn,
      heightIn: defaults.doorHeightIn,
      sillIn: 0,
      kind: "door",
      subtype: opts.subtype ?? "hinged",
      hand: opts.hand ?? "R",
      // The rectangle runs clockwise, so each wall's right face is the inside.
      swing: "right",
      phase: "existing",
      tag: `D${++doorN}`,
    };
    openings.push(o);
    return o;
  }

  function window(side: Side, start: number, opts: { widthIn?: number; heightIn?: number; sillIn?: number; subtype?: string } = {}): Opening {
    const widthIn = opts.widthIn ?? defaults.windowWidthIn;
    const o: Opening = {
      id: newId("o"),
      wallId: wallOf[side].id,
      atIn: atIn(side, start, widthIn),
      widthIn,
      heightIn: opts.heightIn ?? defaults.windowHeightIn,
      sillIn: opts.sillIn ?? defaults.windowSillIn,
      kind: "window",
      subtype: opts.subtype ?? "single",
      hand: "R",
      swing: "right",
      phase: "existing",
      tag: `W${++winN}`,
    };
    openings.push(o);
    return o;
  }

  function label(text: string): void {
    notes.push({ id: newId("n"), levelId, x: ox + W / 2, y: oy + H / 2, text, leaderTo: null, kind: "label" });
  }

  function done(): Fragment {
    return { walls, openings, items, notes };
  }

  return { t, W, H, ox, oy, walls, place, placeAt, door, window, label, done };
}

type Builder = ReturnType<typeof roomBuilder>;

/** Base run + matching uppers along a wall: [start, baseKey, wallKey | null][]. */
function run(b: Builder, side: Side, rows: [number, string | null, string | null][]): void {
  for (const [start, baseKey, wallKey] of rows) {
    if (baseKey) b.place(side, start, baseKey);
    if (wallKey) b.place(side, start, wallKey);
  }
}

function kitchenGalley(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 120, 144);
  // Left run (top → bottom): fridge, base, sink, DW, base.
  run(b, "left", [
    [0, "appl-fridge-36", "wall-W3615-fridge"],
    [36, "base-B18", "wall-W1830"],
    [54, "base-SB36", "wall-W3630"],
    [90, "appl-dw-24", "wall-W2430"],
    [114, "base-B24", "wall-W2430"],
  ]);
  // Right run: base, range + hood, bases.
  run(b, "right", [
    [0, "base-B15", "wall-W1530"],
    [15, "appl-range-30", "wall-W3018-range"],
    [45, "base-B36", "wall-W3630"],
    [81, "base-B36", "wall-W3630"],
    [117, "base-B21", "wall-W2130"],
  ]);
  b.place("right", 15, "appl-hood-30");
  b.place("left", 54, "plumb-sink-33");
  b.window("top", 42, { widthIn: 36 });
  b.door("bottom", (120 - defaults.doorWidthIn) / 2);
  b.label("Kitchen");
  return b.done();
}

function kitchenL(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 144, 168);
  run(b, "top", [
    [0, "base-LS36", "wall-WDC2430"],
    [36, "base-SB36", "wall-W3630"],
    [72, "appl-dw-24", "wall-W2430"],
    [96, "base-B18", "wall-W1830"],
    [114, "base-B24", "wall-W2430"],
  ]);
  run(b, "left", [
    [36, "base-B18", "wall-W1830"],
    [54, "appl-range-30", "wall-W3018-range"],
    [84, "base-B36", "wall-W3630"],
    [120, "appl-fridge-36", "wall-W3615-fridge"],
  ]);
  b.place("left", 54, "appl-hood-30");
  b.place("top", 36, "plumb-sink-33");
  b.window("top", 39, { widthIn: 30 });
  b.window("right", 60, { widthIn: 36 });
  b.door("bottom", (144 - defaults.doorWidthIn) / 2);
  b.label("Kitchen");
  return b.done();
}

function kitchenU(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 144, 168);
  run(b, "top", [
    [0, "base-LS36", "wall-WDC2430"],
    [36, "base-B15", "wall-W1530"],
    [51, "base-SB36", "wall-W3630"],
    [87, "base-B21", "wall-W2130"],
    [108, "base-LS36", null],
  ]);
  b.place("top", 120, "wall-WDC2430");
  run(b, "left", [
    [36, "appl-dw-24", "wall-W2430"],
    [60, "base-B30", "wall-W3030"],
    [90, "appl-range-30", "wall-W3018-range"],
    [120, "base-B24", "wall-W2430"],
  ]);
  run(b, "right", [
    [36, "base-B24", "wall-W2430"],
    [60, "base-B36", "wall-W3630"],
    [96, "base-B24", "wall-W2430"],
    [120, "appl-fridge-36", "wall-W3615-fridge"],
  ]);
  b.place("left", 90, "appl-hood-30");
  b.place("top", 51, "plumb-sink-33");
  b.window("top", 54, { widthIn: 30 });
  b.door("bottom", (144 - defaults.doorWidthIn) / 2);
  b.label("Kitchen");
  return b.done();
}

function kitchenG(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 144, 168);
  run(b, "top", [
    [0, "base-LS36", "wall-WDC2430"],
    [36, "base-B15", "wall-W1530"],
    [51, "base-SB36", "wall-W3630"],
    [87, "base-B21", "wall-W2130"],
    [108, "base-LS36", null],
  ]);
  b.place("top", 120, "wall-WDC2430");
  run(b, "left", [
    [36, "base-B18", "wall-W1830"],
    [54, "appl-range-30", "wall-W3018-range"],
    [84, "base-B24", "wall-W2430"],
    [108, "appl-fridge-36", "wall-W3615-fridge"],
  ]);
  run(b, "right", [
    [36, "base-B24", "wall-W2430"],
    [60, "appl-dw-24", "wall-W2430"],
    [84, "base-LS36", null],
  ]);
  // Peninsula: returns off the right run toward the room, front facing the U.
  const it = libraryItem("base-B36") as LibraryItem;
  b.placeAt("base-B36", { x: b.ox + 108 - it.w / 2, y: b.oy + 84 + 36 - it.d / 2 }, 180);
  b.placeAt("acc-end-panel", { x: b.ox + 72 - 0.375, y: b.oy + 84 + 36 - it.d / 2 }, 180);
  b.place("left", 54, "appl-hood-30");
  b.place("top", 51, "plumb-sink-33");
  b.window("top", 54, { widthIn: 30 });
  b.door("bottom", 20);
  b.label("Kitchen");
  return b.done();
}

function kitchenIsland(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 168, 192);
  run(b, "top", [
    [0, "base-LS36", "wall-WDC2430"],
    [36, "base-B15", "wall-W1530"],
    [51, "base-SB36", "wall-W3630"],
    [87, "appl-dw-24", "wall-W2430"],
    [111, "base-B15", "wall-W1530"],
    [126, "appl-fridge-36", "wall-W3615-fridge"],
  ]);
  run(b, "left", [
    [36, "base-B24", "wall-W2430"],
    [60, "appl-range-30", "wall-W3018-range"],
    [90, "base-B36", "wall-W3630"],
    [126, "base-B24", "wall-W2430"],
  ]);
  b.place("left", 60, "appl-hood-30");
  b.place("top", 51, "plumb-sink-33");
  // Island: front faces the sink run, 42" aisle from the top run's face.
  const islandFront = b.oy + BASE_D + 42;
  b.placeAt("base-B36", { x: b.ox + 66 + 18, y: islandFront + BASE_D / 2 }, 180, { island: true });
  b.placeAt("base-DB24", { x: b.ox + 102 + 12, y: islandFront + BASE_D / 2 }, 180, { island: true });
  b.window("top", 54, { widthIn: 30 });
  b.window("right", 78, { widthIn: 36 });
  b.door("bottom", 24);
  b.label("Kitchen");
  return b.done();
}

function bath5x8(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 60, 96);
  b.place("top", 0, "plumb-tub-shower-60");
  b.place("left", 32, "plumb-toilet");
  b.place("left", 62, "vanity-VB30");
  b.place("left", 62, "plumb-vanity-sink");
  b.door("bottom", 30, { widthIn: 28 });
  b.label("Bath");
  return b.done();
}

function bath6x10(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 72, 120);
  b.place("top", 0, "plumb-shower-36");
  b.place("top", 40, "plumb-toilet");
  b.place("left", 40, "vanity-VB48");
  b.place("left", 40, "plumb-vanity-sink");
  b.window("right", 40, { widthIn: 24, heightIn: 24, sillIn: 60 });
  b.door("bottom", 32, { widthIn: 30 });
  b.label("Bath");
  return b.done();
}

function laundry6x8(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 72, 96);
  b.place("top", 0, "appl-washer-27");
  b.place("top", 27, "appl-dryer-27");
  b.place("top", 0, "wall-W2730");
  b.place("top", 27, "wall-W2730");
  b.place("left", 36, "plumb-utility-sink");
  b.door("bottom", (72 - defaults.doorWidthIn) / 2);
  b.label("Laundry");
  return b.done();
}

function bedroom12x12(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 144, 144);
  b.place("top", 42, "furn-bed-queen");
  b.place("top", 16, "furn-nightstand");
  b.place("top", 104, "furn-nightstand");
  b.place("bottom", 42, "furn-dresser");
  b.window("top", 54, { widthIn: 36 });
  b.door("right", 96);
  b.label("Bedroom");
  return b.done();
}

function emptyRoom(levelId: string, origin: Pt, defaults: DesignerDefaults): Fragment {
  const b = roomBuilder(levelId, origin, defaults, 144, 144);
  b.door("bottom", (144 - defaults.doorWidthIn) / 2);
  return b.done();
}

export const ROOM_TEMPLATES: readonly RoomTemplate[] = Object.freeze([
  { key: "kitchen-galley", label: "Galley kitchen 10x12", description: "Two parallel runs; fridge, sink and DW on one side, range on the other.", widthIn: 120, depthIn: 144, build: kitchenGalley },
  { key: "kitchen-l", label: "L kitchen 12x14", description: "Sink run along the top wall, range and fridge down the left.", widthIn: 144, depthIn: 168, build: kitchenL },
  { key: "kitchen-u", label: "U kitchen 12x14", description: "Three runs with lazy-susan corners; sink centred under the window.", widthIn: 144, depthIn: 168, build: kitchenU },
  { key: "kitchen-g", label: "G kitchen 12x14", description: "U kitchen plus a short peninsula off the right run.", widthIn: 144, depthIn: 168, build: kitchenG },
  { key: "kitchen-island", label: "Island kitchen 14x16", description: "L kitchen with a 60in island facing the sink run.", widthIn: 168, depthIn: 192, build: kitchenIsland },
  { key: "bath-5x8", label: "Bath 5x8", description: "Tub-shower across the end, toilet and 30in vanity on one wall.", widthIn: 60, depthIn: 96, build: bath5x8 },
  { key: "bath-6x10", label: "Bath 6x10", description: "36in shower, toilet, 48in vanity.", widthIn: 72, depthIn: 120, build: bath6x10 },
  { key: "laundry-6x8", label: "Laundry 6x8", description: "Side-by-side washer and dryer with uppers, utility sink.", widthIn: 72, depthIn: 96, build: laundry6x8 },
  { key: "bedroom-12x12", label: "Bedroom 12x12", description: "Queen bed with nightstands, dresser opposite.", widthIn: 144, depthIn: 144, build: bedroom12x12 },
  { key: "empty-12x12", label: "Empty room 12x12", description: "Four walls and a door.", widthIn: 144, depthIn: 144, build: emptyRoom },
]);

export function roomTemplate(key: string): RoomTemplate | null {
  return ROOM_TEMPLATES.find((t) => t.key === key) ?? null;
}
