// Quantity take-off from a PlanDoc (docs/floor-plan-designer-plan.md §11).
//
// Pure and client-safe: doc in, measures out. Every measure carries a phase
// (existing / remove / new / relocate) and a material tag so plan_cost_rules
// can map (measure, material_tag) → cost item. Nothing here touches the db.
//
// Units: inches in, feet / square feet / each out.

import {
  dist,
  polygonArea,
  polygonPerimeter,
  type Device,
  type FinishRef,
  type Opening,
  type PlacedItem,
  type PlaceKind,
  type PlanDoc,
  type Phase,
  type Pt,
  type Room,
  type Wall,
} from "./plan-doc.ts";

// ─── Definitions ─────────────────────────────────────────────────────────────

export type MeasureUnit = "sf" | "lf" | "ea";

export interface MeasureDef {
  key: string;
  label: string;
  unit: MeasureUnit;
  group:
    | "demo"
    | "framing"
    | "finishes"
    | "cabinets"
    | "counters"
    | "openings"
    | "trim"
    | "plumbing"
    | "electrical"
    | "appliances"
    | "structure"
    | "stairs";
}

export const MEASURE_DEFS: readonly MeasureDef[] = [
  // demo
  { key: "wall_demo_lf", label: "Wall demo", unit: "lf", group: "demo" },
  { key: "wall_demo_sf", label: "Wall demo", unit: "sf", group: "demo" },
  { key: "door_demo_ea", label: "Door removal", unit: "ea", group: "demo" },
  { key: "window_demo_ea", label: "Window removal", unit: "ea", group: "demo" },
  { key: "cab_demo_ea", label: "Cabinet removal", unit: "ea", group: "demo" },
  { key: "appliance_demo_ea", label: "Appliance removal", unit: "ea", group: "demo" },
  { key: "plumb_demo_ea", label: "Plumbing fixture removal", unit: "ea", group: "demo" },
  // framing
  { key: "wall_new_lf", label: "New wall framing", unit: "lf", group: "framing" },
  { key: "wall_new_sf_framed", label: "New wall framing", unit: "sf", group: "framing" },
  // finishes
  { key: "drywall_sf", label: "Drywall (both faces)", unit: "sf", group: "finishes" },
  { key: "floor_sf", label: "Floor finish", unit: "sf", group: "finishes" },
  { key: "ceiling_sf", label: "Ceiling finish", unit: "sf", group: "finishes" },
  { key: "wall_finish_sf", label: "Wall finish", unit: "sf", group: "finishes" },
  { key: "tile_sf", label: "Tile", unit: "sf", group: "finishes" },
  { key: "room_sf", label: "Room area", unit: "sf", group: "finishes" },
  // cabinets
  { key: "cab_base_lf", label: "Base cabinets", unit: "lf", group: "cabinets" },
  { key: "cab_wall_lf", label: "Wall cabinets", unit: "lf", group: "cabinets" },
  { key: "cab_tall_lf", label: "Tall cabinets", unit: "lf", group: "cabinets" },
  { key: "cab_base_ea", label: "Base cabinets", unit: "ea", group: "cabinets" },
  { key: "cab_wall_ea", label: "Wall cabinets", unit: "ea", group: "cabinets" },
  { key: "cab_tall_ea", label: "Tall cabinets", unit: "ea", group: "cabinets" },
  { key: "cab_vanity_ea", label: "Vanity cabinets", unit: "ea", group: "cabinets" },
  { key: "cab_island_lf", label: "Island cabinets", unit: "lf", group: "cabinets" },
  // counters
  { key: "counter_sf", label: "Countertop", unit: "sf", group: "counters" },
  { key: "counter_edge_lf", label: "Countertop edge", unit: "lf", group: "counters" },
  { key: "backsplash_sf", label: "Backsplash", unit: "sf", group: "counters" },
  { key: "waterfall_ea", label: "Waterfall end", unit: "ea", group: "counters" },
  // openings
  { key: "door_ea", label: "Doors", unit: "ea", group: "openings" },
  { key: "window_ea", label: "Windows", unit: "ea", group: "openings" },
  { key: "opening_ea", label: "Cased openings", unit: "ea", group: "openings" },
  // trim
  { key: "trim_base_lf", label: "Base trim", unit: "lf", group: "trim" },
  { key: "trim_crown_lf", label: "Crown", unit: "lf", group: "trim" },
  { key: "trim_casing_lf", label: "Casing", unit: "lf", group: "trim" },
  { key: "trim_chair_lf", label: "Chair rail", unit: "lf", group: "trim" },
  // plumbing
  { key: "plumb_fixture_ea", label: "Plumbing fixtures", unit: "ea", group: "plumbing" },
  { key: "plumb_rough_ea", label: "Plumbing rough-in", unit: "ea", group: "plumbing" },
  // electrical
  { key: "elec_outlet_ea", label: "Outlets", unit: "ea", group: "electrical" },
  { key: "elec_gfci_ea", label: "GFCI outlets", unit: "ea", group: "electrical" },
  { key: "elec_240_ea", label: "240V outlets", unit: "ea", group: "electrical" },
  { key: "elec_switch_ea", label: "Switches", unit: "ea", group: "electrical" },
  { key: "elec_light_ea", label: "Lights", unit: "ea", group: "electrical" },
  { key: "elec_smoke_ea", label: "Smoke / CO detectors", unit: "ea", group: "electrical" },
  { key: "elec_data_ea", label: "Data / low-voltage", unit: "ea", group: "electrical" },
  { key: "elec_panel_ea", label: "Panels", unit: "ea", group: "electrical" },
  { key: "hvac_register_ea", label: "HVAC registers / vents", unit: "ea", group: "electrical" },
  // appliances
  { key: "appliance_ea", label: "Appliances", unit: "ea", group: "appliances" },
  // structure
  { key: "beam_lf", label: "Beams", unit: "lf", group: "structure" },
  { key: "column_ea", label: "Columns / posts", unit: "ea", group: "structure" },
  { key: "soffit_lf", label: "Soffits", unit: "lf", group: "structure" },
  // stairs
  { key: "stair_riser_ea", label: "Stair risers", unit: "ea", group: "stairs" },
  { key: "stair_lf", label: "Stair run", unit: "lf", group: "stairs" },
];

const DEF_BY_KEY: ReadonlyMap<string, MeasureDef> = new Map(MEASURE_DEFS.map((d) => [d.key, d]));
const DEF_INDEX: ReadonlyMap<string, number> = new Map(MEASURE_DEFS.map((d, i) => [d.key, i]));

export function measureDef(key: string): MeasureDef | null {
  return DEF_BY_KEY.get(key) ?? null;
}

// ─── Output types ────────────────────────────────────────────────────────────

export interface Measure {
  key: string;
  label: string;
  unit: MeasureUnit;
  qty: number;
  phase: "existing" | "remove" | "new" | "relocate" | "all";
  materialTag: string;
  detail: string;
  levelId: string | null;
  elementIds: string[];
}

export interface ProductLine {
  itemId: string;
  catalogId: number | null;
  libraryKey: string | null;
  label: string;
  tag: string;
  kind: PlaceKind;
  qty: number;
  phase: Phase;
}

// ─── Accumulator ─────────────────────────────────────────────────────────────

type MeasurePhase = Measure["phase"];

interface AddOpts {
  phase: MeasurePhase;
  materialTag?: string;
  detail?: string;
  levelId?: string | null;
  elementIds?: string[];
}

/** Sums quantities per (key, phase, material, level, detail); keeps the list
 *  of contributing elements so the checks panel can "locate" a measure. */
class Acc {
  private rows = new Map<string, Measure>();

  add(key: string, qty: number, o: AddOpts): void {
    if (!Number.isFinite(qty) || qty <= 0) return;
    const def = DEF_BY_KEY.get(key);
    if (!def) return;
    const materialTag = o.materialTag ?? "";
    const detail = o.detail ?? "";
    const levelId = o.levelId ?? null;
    const id = `${key}|${o.phase}|${materialTag}|${levelId ?? ""}|${detail}`;
    const cur = this.rows.get(id);
    if (cur) {
      cur.qty += qty;
      for (const e of o.elementIds ?? []) if (!cur.elementIds.includes(e)) cur.elementIds.push(e);
      return;
    }
    this.rows.set(id, {
      key,
      label: def.label,
      unit: def.unit,
      qty,
      phase: o.phase,
      materialTag,
      detail,
      levelId,
      elementIds: [...(o.elementIds ?? [])],
    });
  }

  list(): Measure[] {
    const out = [...this.rows.values()].map((m) => ({ ...m, qty: round3(m.qty), elementIds: [...m.elementIds] }));
    out.sort((a, b) => (DEF_INDEX.get(a.key) ?? 999) - (DEF_INDEX.get(b.key) ?? 999));
    return out;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const sf = (sqIn: number) => sqIn / 144;
const lf = (inches: number) => inches / 12;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CABINET_KINDS: ReadonlySet<PlaceKind> = new Set(["base", "wall", "tall", "vanity", "island"]);
const LIGHT_TYPES: ReadonlySet<Device["type"]> = new Set(["recessed", "pendant", "sconce", "underCab", "surface", "fan"]);
const SWITCH_TYPES: ReadonlySet<Device["type"]> = new Set(["switch", "switch3", "dimmer"]);
const HVAC_TYPES: ReadonlySet<Device["type"]> = new Set(["register", "return", "exhaust", "miniSplit"]);

function wallPhase(w: Wall): MeasurePhase {
  return w.kind === "remove" ? "remove" : w.kind === "new" ? "new" : "existing";
}

function isTile(m: FinishRef | null | undefined): boolean {
  return !!m && (!!m.pattern || m.key.startsWith("tile-"));
}

function roomArea(r: Room): number {
  return Math.abs(polygonArea(r.polygon));
}

function roomPerimIn(r: Room): number {
  return r.polygon.length >= 3 ? polygonPerimeter(r.polygon) : r.perimLf * 12;
}

/** Opening area (sq in) that falls within a face band from the floor up to
 *  `bandTop` inches, clipped to the wall's length. */
function openingAreaInBand(o: Opening, w: Wall, bandTop: number): number {
  const L = dist(w.a, w.b);
  const s = Math.max(0, o.atIn);
  const e = Math.min(L, o.atIn + o.widthIn);
  const width = Math.max(0, e - s);
  const top = Math.min(o.sillIn + o.heightIn, bandTop);
  const height = Math.max(0, top - o.sillIn);
  return width * height;
}

function itemProduct(i: PlacedItem): string {
  return i.libraryKey ?? i.label;
}

function propString(i: PlacedItem, key: string): string | null {
  const v = i.props?.[key];
  return typeof v === "string" && v ? v : null;
}

function longestEdge(poly: Pt[]): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) best = Math.max(best, dist(poly[i], poly[(i + 1) % poly.length]));
  return best;
}

// ─── Per-collection take-offs ────────────────────────────────────────────────

function measureWalls(doc: PlanDoc, acc: Acc): void {
  for (const w of doc.walls) {
    const L = dist(w.a, w.b);
    if (L <= 0) continue;
    const opens = doc.openings.filter((o) => o.wallId === w.id);
    const o = { phase: wallPhase(w), levelId: w.levelId, elementIds: [w.id] };
    if (w.kind === "remove") {
      acc.add("wall_demo_lf", lf(L), o);
      acc.add("wall_demo_sf", sf(L * w.heightIn), o);
    } else if (w.kind === "new") {
      acc.add("wall_new_lf", lf(L), o);
      acc.add("wall_new_sf_framed", sf(L * w.heightIn), o);
      const openSq = opens.reduce((s, op) => s + openingAreaInBand(op, w, w.heightIn), 0);
      acc.add("drywall_sf", sf(Math.max(0, 2 * (L * w.heightIn - openSq))), o);
    }
    // Face finishes on the wall itself (full height, net of openings).
    if (w.kind !== "remove") {
      for (const side of ["left", "right"] as const) {
        const fin = w.faces?.[side];
        if (!fin) continue;
        const openSq = opens.reduce((s, op) => s + openingAreaInBand(op, w, w.heightIn), 0);
        const area = sf(Math.max(0, L * w.heightIn - openSq));
        const fo = { phase: "new" as const, materialTag: fin.key, levelId: w.levelId, elementIds: [w.id] };
        acc.add("wall_finish_sf", area, fo);
        if (isTile(fin)) acc.add("tile_sf", area, fo);
      }
    }
  }
}

function measureRoomsAndFinishes(doc: PlanDoc, acc: Acc): void {
  const roomById = new Map(doc.rooms.map((r) => [r.id, r]));
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  const floorCovered = new Set<string>();
  const ceilingTag = new Map<string, string>();

  for (const f of doc.finishes) {
    const room = f.roomId ? roomById.get(f.roomId) : undefined;
    if (f.target === "floor") {
      let area = 0;
      if (f.polygon && f.polygon.length >= 3) area = sf(Math.abs(polygonArea(f.polygon)));
      else if (room) area = sf(roomArea(room));
      if (room) floorCovered.add(room.id);
      if (area <= 0) continue;
      const o = { phase: "new" as const, materialTag: f.material.key, levelId: f.levelId, elementIds: [f.id, ...(room ? [room.id] : [])] };
      acc.add("floor_sf", area, o);
      if (isTile(f.material)) acc.add("tile_sf", area, o);
    } else if (f.target === "wall") {
      const w = f.wallId ? wallById.get(f.wallId) : undefined;
      if (!w) continue;
      const L = dist(w.a, w.b);
      const H = f.heightIn ?? w.heightIn;
      const openSq = doc.openings.filter((op) => op.wallId === w.id).reduce((s, op) => s + openingAreaInBand(op, w, H), 0);
      const area = sf(Math.max(0, L * H - openSq));
      if (area <= 0) continue;
      const o = { phase: "new" as const, materialTag: f.material.key, levelId: f.levelId, elementIds: [f.id, w.id] };
      acc.add("wall_finish_sf", area, o);
      if (isTile(f.material)) acc.add("tile_sf", area, o);
    } else if (f.target === "ceiling" && room) {
      ceilingTag.set(room.id, f.material.key);
    }
  }

  for (const r of doc.rooms) {
    const area = sf(roomArea(r));
    if (area <= 0) continue;
    const base = { phase: "new" as const, levelId: r.levelId, elementIds: [r.id] };
    acc.add("room_sf", area, { ...base, detail: r.name });
    if (!floorCovered.has(r.id)) {
      const o = { ...base, materialTag: r.floor?.key ?? "" };
      acc.add("floor_sf", area, o);
      if (isTile(r.floor)) acc.add("tile_sf", area, o);
    }
    acc.add("ceiling_sf", area, { ...base, materialTag: ceilingTag.get(r.id) ?? r.ceiling?.key ?? "" });
    // Room-level trim set: base / crown / chair run the room perimeter.
    if (r.trim) {
      const perim = lf(roomPerimIn(r));
      if (r.trim.base) acc.add("trim_base_lf", perim, { ...base, materialTag: r.trim.base });
      if (r.trim.crown) acc.add("trim_crown_lf", perim, { ...base, materialTag: r.trim.crown });
      if (r.trim.chair) acc.add("trim_chair_lf", perim, { ...base, materialTag: r.trim.chair });
    }
  }
}

function measureItems(doc: PlanDoc, acc: Acc): void {
  for (const i of doc.items) {
    if (i.phase === "existing") continue;
    const o = { phase: i.phase, levelId: i.levelId, elementIds: [i.id] };
    const removing = i.phase === "remove";
    if (CABINET_KINDS.has(i.kind)) {
      if (removing) {
        acc.add("cab_demo_ea", 1, o);
        continue;
      }
      const w = lf(i.w);
      switch (i.kind) {
        case "base":
          acc.add("cab_base_lf", w, o);
          acc.add("cab_base_ea", 1, o);
          break;
        case "vanity":
          acc.add("cab_base_lf", w, o);
          acc.add("cab_vanity_ea", 1, o);
          break;
        case "island":
          acc.add("cab_base_lf", w, o);
          acc.add("cab_island_lf", w, o);
          break;
        case "wall":
          acc.add("cab_wall_lf", w, o);
          acc.add("cab_wall_ea", 1, o);
          break;
        case "tall":
          acc.add("cab_tall_lf", w, o);
          acc.add("cab_tall_ea", 1, o);
          break;
      }
    } else if (i.kind === "appliance") {
      if (removing) acc.add("appliance_demo_ea", 1, o);
      else acc.add("appliance_ea", 1, { ...o, materialTag: itemProduct(i) });
    } else if (i.kind === "plumbing") {
      if (removing) {
        acc.add("plumb_demo_ea", 1, o);
      } else {
        acc.add("plumb_fixture_ea", 1, { ...o, materialTag: propString(i, "fixture") ?? itemProduct(i) });
        acc.add("plumb_rough_ea", 1, o);
      }
    }
  }
}

function measureCounters(doc: PlanDoc, acc: Acc): void {
  const runById = new Map(doc.runs.map((r) => [r.id, r]));
  for (const c of doc.counters) {
    if (c.polygon.length < 3) continue;
    const o = { phase: "new" as const, materialTag: c.material.key, levelId: c.levelId, elementIds: [c.id] };
    acc.add("counter_sf", sf(Math.abs(polygonArea(c.polygon))), o);
    const perim = polygonPerimeter(c.polygon);
    const run = c.runId ? runById.get(c.runId) : undefined;
    const againstWall = !!run && !!run.wallId;
    acc.add("counter_edge_lf", lf(againstWall ? perim * 0.5 : perim), { ...o, materialTag: c.edge || c.material.key });
    if (c.backsplashIn > 0) acc.add("backsplash_sf", sf(c.backsplashIn * longestEdge(c.polygon)), o);
    if (c.waterfall.length) acc.add("waterfall_ea", c.waterfall.length, o);
  }
}

function measureOpenings(doc: PlanDoc, acc: Acc): void {
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  for (const op of doc.openings) {
    const w = wallById.get(op.wallId);
    const levelId = w?.levelId ?? null;
    const o = { phase: op.phase, levelId, elementIds: [op.id], materialTag: op.subtype, detail: `${fmtNum(op.widthIn)}×${fmtNum(op.heightIn)}` };
    if (op.phase === "remove") {
      if (op.kind === "door") acc.add("door_demo_ea", 1, o);
      else if (op.kind === "window") acc.add("window_demo_ea", 1, o);
      else acc.add("opening_ea", 1, o);
      continue;
    }
    if (op.kind === "door") acc.add("door_ea", 1, o);
    else if (op.kind === "window") acc.add("window_ea", 1, o);
    else acc.add("opening_ea", 1, o);
    if (op.kind === "door" || op.kind === "window") {
      acc.add("trim_casing_lf", lf(2 * op.heightIn + op.widthIn), { phase: op.phase, levelId, elementIds: [op.id] });
    }
  }
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function measureTrims(doc: PlanDoc, acc: Acc): void {
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  const roomById = new Map(doc.rooms.map((r) => [r.id, r]));
  const keyFor: Record<string, string> = { base: "trim_base_lf", crown: "trim_crown_lf", casing: "trim_casing_lf", chair: "trim_chair_lf" };
  for (const t of doc.trims) {
    const key = keyFor[t.profile];
    if (!key) continue;
    let inches = 0;
    const ids = [t.id];
    if (t.wallId && wallById.has(t.wallId)) {
      const w = wallById.get(t.wallId)!;
      inches = dist(w.a, w.b);
      ids.push(w.id);
    } else if (t.roomId && roomById.has(t.roomId)) {
      const r = roomById.get(t.roomId)!;
      inches = roomPerimIn(r);
      ids.push(r.id);
    }
    if (inches <= 0) continue;
    acc.add(key, lf(inches), { phase: "new", levelId: t.levelId, elementIds: ids });
  }
}

function measureElectrical(doc: PlanDoc, acc: Acc): void {
  for (const d of doc.electrical) {
    if (d.phase === "existing") continue;
    const o = { phase: d.phase, levelId: d.levelId, elementIds: [d.id] };
    if (d.type === "outlet") acc.add("elec_outlet_ea", 1, o);
    else if (d.type === "gfci") acc.add("elec_gfci_ea", 1, o);
    else if (d.type === "outlet240") acc.add("elec_240_ea", 1, o);
    else if (SWITCH_TYPES.has(d.type)) acc.add("elec_switch_ea", 1, { ...o, materialTag: d.type });
    else if (LIGHT_TYPES.has(d.type)) acc.add("elec_light_ea", 1, { ...o, materialTag: d.type });
    else if (d.type === "smoke") acc.add("elec_smoke_ea", 1, o);
    else if (d.type === "data") acc.add("elec_data_ea", 1, o);
    else if (d.type === "panel") acc.add("elec_panel_ea", 1, o);
    else if (HVAC_TYPES.has(d.type)) acc.add("hvac_register_ea", 1, { ...o, materialTag: d.type });
  }
}

function measureStairs(doc: PlanDoc, acc: Acc): void {
  for (const s of doc.stairs) {
    if (s.phase === "existing") continue;
    const o = { phase: s.phase, levelId: s.fromLevelId, elementIds: [s.id] };
    acc.add("stair_riser_ea", s.riserCount, o);
    acc.add("stair_lf", lf(s.riserCount * s.treadIn), o);
  }
}

function measureStructure(doc: PlanDoc, acc: Acc): void {
  for (const s of doc.structure) {
    if (s.phase === "existing") continue;
    const o = { phase: s.phase, levelId: s.levelId, elementIds: [s.id], detail: s.label };
    if (s.kind === "column") acc.add("column_ea", 1, o);
    else if (s.kind === "beam") acc.add("beam_lf", lf(dist(s.a, s.b)), o);
    else if (s.kind === "soffit") acc.add("soffit_lf", lf(dist(s.a, s.b)), o);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeMeasures(doc: PlanDoc): Measure[] {
  const acc = new Acc();
  measureWalls(doc, acc);
  measureRoomsAndFinishes(doc, acc);
  measureItems(doc, acc);
  measureCounters(doc, acc);
  measureOpenings(doc, acc);
  measureTrims(doc, acc);
  measureElectrical(doc, acc);
  measureStairs(doc, acc);
  measureStructure(doc, acc);
  return acc.list();
}

/** One line per distinct product (catalogId, else libraryKey+label), qty =
 *  count, phase new/relocate only. Existing and removed items are not products. */
export function productLines(doc: PlanDoc): ProductLine[] {
  const lines = new Map<string, ProductLine>();
  for (const i of doc.items) {
    if (i.phase !== "new" && i.phase !== "relocate") continue;
    const key = i.catalogId != null ? `c:${i.catalogId}` : `l:${i.libraryKey ?? ""}|${i.label}`;
    const cur = lines.get(key);
    if (cur) {
      cur.qty += 1;
      continue;
    }
    lines.set(key, {
      itemId: i.id,
      catalogId: i.catalogId,
      libraryKey: i.libraryKey,
      label: i.label,
      tag: i.tag,
      kind: i.kind,
      qty: 1,
      phase: i.phase,
    });
  }
  return [...lines.values()];
}

/** Sum across phases / materials / levels for display. Keeps MEASURE_DEFS order. */
export function summarizeMeasures(measures: Measure[]): { key: string; label: string; unit: MeasureUnit; qty: number }[] {
  const out = new Map<string, { key: string; label: string; unit: MeasureUnit; qty: number }>();
  for (const m of measures) {
    const cur = out.get(m.key);
    if (cur) cur.qty = round3(cur.qty + m.qty);
    else out.set(m.key, { key: m.key, label: m.label, unit: m.unit, qty: m.qty });
  }
  const list = [...out.values()];
  list.sort((a, b) => (DEF_INDEX.get(a.key) ?? 999) - (DEF_INDEX.get(b.key) ?? 999));
  return list;
}

