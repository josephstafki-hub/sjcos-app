// The designer's edit language. Every change to a PlanDoc — from the canvas,
// the inspector, a room template, or an MCP agent — is a PlanOp applied by
// applyOp(). The UI reducer is `applyOp` + an undo stack of docs; the MCP
// `apply_plan_ops` tool validates and applies the same ops server-side, so
// agents and humans can never produce different geometry from the same intent.
//
// Pure and client-safe. Derived state (rooms, runs, counters, wall-cabinet
// heights) is refreshed after each op that can affect it.

import { z } from "zod";
import {
  dist,
  emptyDoc,
  MAIN_LEVEL_ID,
  newId,
  type Camera,
  type Counter,
  type Device,
  type Dim,
  type ElecType,
  type FinishRef,
  type FinishRegion,
  type Level,
  type Note,
  type Opening,
  type Phase,
  type PhotoPin,
  type PlaceKind,
  type PlacedItem,
  type PlanDoc,
  type Pt,
  type Room,
  type SectionLine,
  type Stair,
  type Structural,
  type TrimRun,
  type Underlay,
  type Wall,
  type DesignerDefaults,
} from "./plan-doc.ts";
import {
  alongWall,
  clampOpening,
  joinWalls as joinWallsGeom,
  moveCorner as moveCornerGeom,
  rectWalls,
  rotatePt,
  splitWall as splitWallGeom,
  uncoveredSpans,
  withRooms,
  wallFrame,
} from "./plan-geometry.ts";
import { pickCabinetStyle } from "./plan-cabinet.ts";
import {
  alignWallCabinets,
  generateCounters,
  placeAgainstWall,
  placeRunAlongWall,
  rebuildRuns,
  snapToNeighbors,
  tierOf,
} from "./plan-runs.ts";
import {
  DOOR_SUBTYPES,
  WINDOW_SUBTYPES,
  cabinetTag,
  elecSymbol,
  finishRef,
  itemFromLibrary,
  libraryItem,
} from "./plan-library.ts";

// ─── Op types ────────────────────────────────────────────────────────────────

export interface CatalogSpec {
  id: number;
  name: string;
  kind: PlaceKind;
  w: number;
  d: number;
  h: number;
  z?: number;
  tag?: string;
  props?: Record<string, unknown>;
  color?: string;
}

export type MaterialArg = FinishRef | string;

export type PlanOp =
  // structure
  | { op: "addWall"; levelId?: string; a: Pt; b: Pt; kind?: Wall["kind"]; thickIn?: number; heightIn?: number; id?: string }
  | { op: "addWalls"; walls: Wall[] }
  | { op: "addRoomRect"; levelId?: string; p: Pt; q: Pt; kind?: Wall["kind"]; thickIn?: number; heightIn?: number; name?: string }
  | { op: "updateWall"; id: string; patch: Partial<Omit<Wall, "id" | "levelId">> }
  | { op: "moveCorner"; levelId?: string; from: Pt; to: Pt }
  | { op: "splitWall"; id: string; atIn: number }
  | { op: "joinWalls"; idA: string; idB: string }
  | {
      op: "addOpening";
      wallId: string;
      atIn: number;
      kind: Opening["kind"];
      subtype?: string;
      widthIn?: number;
      heightIn?: number;
      sillIn?: number;
      hand?: Opening["hand"];
      swing?: Opening["swing"];
      phase?: Phase;
      tag?: string;
      id?: string;
    }
  | { op: "updateOpening"; id: string; patch: Partial<Omit<Opening, "id">> }
  | { op: "addStair"; levelId?: string; toLevelId?: string; at: Pt; rotDeg?: number; shape?: Stair["shape"]; turn?: Stair["turn"]; landingAt?: number; wellIn?: number; widthIn?: number; riserCount?: number; riserIn?: number; treadIn?: number; phase?: Phase; id?: string }
  | { op: "updateStair"; id: string; patch: Partial<Omit<Stair, "id">> }
  | { op: "addStructure"; levelId?: string; kind: Structural["kind"]; a: Pt; b?: Pt; wIn?: number; hIn?: number; zIn?: number; phase?: Phase; label?: string; id?: string }
  | { op: "updateStructure"; id: string; patch: Partial<Omit<Structural, "id">> }
  // items
  | {
      op: "placeItem";
      levelId?: string;
      libraryKey?: string;
      catalog?: CatalogSpec;
      at: Pt;
      rotDeg?: number;
      snapToWall?: boolean;
      snapToNeighbors?: boolean;
      phase?: Phase;
      overrides?: Partial<Omit<PlacedItem, "id" | "levelId">>;
      id?: string;
    }
  | { op: "placeRun"; wallId: string; side: "left" | "right"; startIn: number; keys: string[]; phase?: Phase }
  | { op: "updateItem"; id: string; patch: Partial<Omit<PlacedItem, "id" | "levelId">> }
  | { op: "moveItems"; ids: string[]; dx: number; dy: number; snapToWall?: boolean }
  | { op: "rotateItems"; ids: string[]; deltaDeg: number }
  | { op: "duplicateItems"; ids: string[]; dx?: number; dy?: number; newIds?: string[] }
  | { op: "setItemPhase"; ids: string[]; phase: Phase }
  | { op: "setItemProps"; ids: string[]; props: Record<string, unknown> }
  // counters + finishes
  | { op: "updateCounter"; id: string; patch: Partial<Omit<Counter, "id" | "levelId">> }
  | { op: "addCounter"; levelId?: string; polygon: Pt[]; material?: MaterialArg; thickIn?: number; backsplashIn?: number; id?: string }
  | { op: "regenerateCounters"; levelId?: string; material?: MaterialArg }
  | { op: "setRoom"; id: string; patch: Partial<Pick<Room, "name" | "ceilingIn" | "trim" | "pinned">> }
  | { op: "setFloorFinish"; roomId: string; material: MaterialArg | null }
  | { op: "setCeilingFinish"; roomId: string; material: MaterialArg | null }
  | { op: "setWallFinish"; wallId: string; side: "left" | "right"; material: MaterialArg | null; heightIn?: number }
  | { op: "addFinishRegion"; region: Omit<FinishRegion, "id"> & { id?: string } }
  | { op: "updateFinishRegion"; id: string; patch: Partial<Omit<FinishRegion, "id">> }
  | { op: "addTrim"; levelId?: string; wallId?: string | null; roomId?: string | null; profile: TrimRun["profile"]; heightIn?: number; id?: string }
  // electrical / hvac
  | { op: "addDevice"; levelId?: string; type: ElecType; at: Pt; heightAff?: number; wallId?: string | null; circuit?: string; phase?: Phase; id?: string }
  | { op: "updateDevice"; id: string; patch: Partial<Omit<Device, "id" | "levelId">> }
  | { op: "linkSwitch"; switchId: string; lightId: string; on: boolean }
  // annotation
  | { op: "addDim"; levelId?: string; a: Pt; b: Pt; offsetIn?: number; kind?: Dim["kind"]; chain?: Pt[]; id?: string }
  | { op: "updateDim"; id: string; patch: Partial<Omit<Dim, "id" | "levelId">> }
  | { op: "addNote"; levelId?: string; at: Pt; text: string; kind?: Note["kind"]; leaderTo?: Pt | null; id?: string }
  | { op: "updateNote"; id: string; patch: Partial<Omit<Note, "id" | "levelId">> }
  | { op: "addPhoto"; levelId?: string; at: Pt; fileId: string; caption?: string; id?: string }
  | { op: "addCamera"; levelId?: string; name: string; pos: [number, number, number]; target: [number, number, number]; fov?: number; mode?: Camera["mode"]; id?: string }
  | { op: "updateCamera"; id: string; patch: Partial<Omit<Camera, "id">> }
  | { op: "addSection"; levelId?: string; a: Pt; b: Pt; depthIn?: number; flip?: boolean; label?: string; id?: string }
  | { op: "updateSection"; id: string; patch: Partial<Omit<SectionLine, "id" | "levelId">> }
  /** Put a plan under a level to trace over (replaces that level's), or clear
   *  it with null. Level: underlay.levelId, else levelId, else the first level. */
  | { op: "setUnderlay"; underlay: Underlay | null; levelId?: string }
  | { op: "updateUnderlay"; id: string; patch: Partial<Omit<Underlay, "id" | "levelId" | "fileId">> }
  // generic
  | { op: "move"; ids: string[]; dx: number; dy: number }
  | { op: "delete"; ids: string[] }
  | { op: "addLevel"; name: string; elevationIn?: number; ceilingIn?: number; copyWallsFrom?: string; id?: string }
  | { op: "updateLevel"; id: string; patch: Partial<Omit<Level, "id">> }
  | { op: "removeLevel"; id: string }
  | { op: "setSettings"; patch: Partial<Omit<PlanDoc["settings"], "defaults">> & { defaults?: Partial<DesignerDefaults> } }
  | { op: "ignoreCheck"; id: string; on: boolean }
  | { op: "replace"; doc: PlanDoc };

export type PlanOpName = PlanOp["op"];

/** Loose schema for ops arriving over MCP; applyOp does the real validation. */
export const PlanOpSchema = z.object({ op: z.string().min(1).max(40) }).passthrough();

export class PlanOpError extends Error {}

export interface OpContext {
  defaults?: Partial<DesignerDefaults>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown, name: string, lo = -20000, hi = 20000): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new PlanOpError(`${name} must be a number between ${lo} and ${hi}.`);
  return n;
};
const pt = (v: unknown, name: string): Pt => {
  const p = v as Pt | undefined;
  if (!p || typeof p !== "object") throw new PlanOpError(`${name} must be a point {x, y}.`);
  return { x: num(p.x, `${name}.x`), y: num(p.y, `${name}.y`) };
};
const levelOf = (doc: PlanDoc, levelId?: string): string => {
  const id = levelId ?? doc.levels[0]?.id;
  if (!id || !doc.levels.some((l) => l.id === id)) throw new PlanOpError(`Unknown level "${levelId}".`);
  return id;
};
const wallOf = (doc: PlanDoc, id: string): Wall => {
  const w = doc.walls.find((x) => x.id === id);
  if (!w) throw new PlanOpError(`Unknown wall "${id}".`);
  return w;
};
const itemOf = (doc: PlanDoc, id: string): PlacedItem => {
  const i = doc.items.find((x) => x.id === id);
  if (!i) throw new PlanOpError(`Unknown item "${id}".`);
  return i;
};
const defaultsOf = (doc: PlanDoc, ctx?: OpContext): DesignerDefaults => ({ ...doc.settings.defaults, ...(ctx?.defaults ?? {}) });

function toFinish(m: MaterialArg | null | undefined): FinishRef | null {
  if (m == null) return null;
  if (typeof m === "string") return finishRef(m);
  return { ...m };
}

const CABINET_KINDS = new Set<PlaceKind>(["base", "wall", "tall", "vanity", "island"]);

/** Refresh runs, counters, and wall-cabinet heights after an item change. */
function refreshItems(doc: PlanDoc, levelIds: string[], ctx?: OpContext): PlanDoc {
  let d = doc;
  const defaults = defaultsOf(doc, ctx);
  for (const levelId of new Set(levelIds)) {
    d = rebuildRuns(d, levelId);
    d = alignWallCabinets(d, levelId, defaults);
    d = generateCounters(d, levelId, {
      overhangIn: defaults.overhangIn,
      seatingOverhangIn: defaults.seatingOverhangIn,
      thickIn: 1.5,
      backsplashIn: defaults.backsplashIn,
      material: finishRef("quartz-white"),
      edge: "eased",
    });
  }
  return d;
}

/** Re-home each opening's wall offset after walls move so doors stay inside. */
function clampOpenings(doc: PlanDoc): PlanDoc {
  const walls = new Map(doc.walls.map((w) => [w.id, w]));
  const openings = doc.openings
    .filter((o) => walls.has(o.wallId))
    .map((o) => {
      const w = walls.get(o.wallId)!;
      const atIn = clampOpening(o, w);
      return atIn === o.atIn ? o : { ...o, atIn };
    });
  return { ...doc, openings };
}

function refreshWalls(doc: PlanDoc): PlanDoc {
  return withRooms(clampOpenings(doc));
}

/** Delete any element by id across every collection, tidying references. */
function deleteIds(doc: PlanDoc, ids: string[]): PlanDoc {
  const gone = new Set(ids);
  const wallsGone = doc.walls.filter((w) => gone.has(w.id)).map((w) => w.id);
  const itemsGone = doc.items.filter((i) => gone.has(i.id)).map((i) => i.id);
  const runsGone = doc.runs.filter((r) => gone.has(r.id)).map((r) => r.id);
  // Deleting a run deletes its items; deleting a wall deletes its openings.
  for (const r of doc.runs) if (runsGone.includes(r.id)) for (const id of r.itemIds) gone.add(id);
  for (const o of doc.openings) if (wallsGone.includes(o.wallId)) gone.add(o.id);
  const keep = <T extends { id: string }>(arr: T[]) => arr.filter((x) => !gone.has(x.id));
  const affectedLevels = new Set<string>();
  for (const w of doc.walls) if (gone.has(w.id)) affectedLevels.add(w.levelId);
  for (const i of doc.items) if (gone.has(i.id) || itemsGone.includes(i.id)) affectedLevels.add(i.levelId);
  let d: PlanDoc = {
    ...doc,
    walls: keep(doc.walls),
    openings: keep(doc.openings),
    items: keep(doc.items),
    runs: keep(doc.runs),
    counters: keep(doc.counters).filter((c) => !c.runId || !runsGone.includes(c.runId)),
    finishes: keep(doc.finishes).filter((f) => !(f.wallId && gone.has(f.wallId)) && !(f.roomId && gone.has(f.roomId))),
    trims: keep(doc.trims).filter((t) => !(t.wallId && gone.has(t.wallId))),
    electrical: keep(doc.electrical).map((e) => ({ ...e, switchLegTo: e.switchLegTo.filter((id) => !gone.has(id)) })),
    stairs: keep(doc.stairs),
    structure: keep(doc.structure),
    dims: keep(doc.dims),
    notes: keep(doc.notes),
    photos: keep(doc.photos),
    cameras: keep(doc.cameras),
    sections: keep(doc.sections),
  };
  if (wallsGone.length) d = refreshWalls(d);
  if (affectedLevels.size) d = refreshItems(d, [...affectedLevels]);
  return d;
}

function findLevelForIds(doc: PlanDoc, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const i = doc.items.find((x) => x.id === id);
    if (i) out.push(i.levelId);
  }
  return out;
}

function buildItem(doc: PlanDoc, o: Extract<PlanOp, { op: "placeItem" }>, levelId: string): PlacedItem {
  let item: PlacedItem | null = null;
  const at = pt(o.at, "at");
  if (o.catalog) {
    const c = o.catalog;
    const kind = c.kind;
    const w = num(c.w, "catalog.w", 0.5, 600);
    const d = num(c.d, "catalog.d", 0.5, 600);
    const h = num(c.h, "catalog.h", 0.5, 300);
    item = {
      id: o.id ?? newId("i"),
      levelId,
      kind,
      catalogId: c.id,
      libraryKey: null,
      label: c.name,
      tag: c.tag ?? (CABINET_KINDS.has(kind) ? cabinetTag(kind, w, h, c.props) : ""),
      x: at.x,
      y: at.y,
      z: c.z ?? (kind === "wall" ? 54 : 0),
      rotDeg: o.rotDeg ?? 0,
      w,
      d,
      h,
      phase: o.phase ?? "new",
      wallId: null,
      runId: null,
      props: { ...(c.props ?? {}), ...(c.color ? { color: c.color } : {}) },
      selectionOptionId: null,
    };
  } else if (o.libraryKey) {
    item = itemFromLibrary(o.libraryKey, levelId, at, o.rotDeg ?? 0);
    if (!item) throw new PlanOpError(`Unknown library item "${o.libraryKey}".`);
    if (o.id) item = { ...item, id: o.id };
    if (o.phase) item = { ...item, phase: o.phase };
  } else {
    throw new PlanOpError("placeItem needs a libraryKey or a catalog spec.");
  }
  if (o.overrides) item = { ...item, ...o.overrides, id: item.id, levelId };
  return withDesignCabinetStyle(doc, item);
}

/** A new cabinet starts in the design's cabinet style (its own props win). */
function withDesignCabinetStyle<T extends { kind: PlacedItem["kind"]; props: Record<string, unknown> }>(doc: PlanDoc, item: T): T {
  const design = doc.settings.cabinetStyle;
  if (!design || !CABINET_KINDS.has(item.kind)) return item;
  return { ...item, props: { ...pickCabinetStyle(design), ...item.props } };
}

// ─── applyOp ─────────────────────────────────────────────────────────────────

export function applyOp(doc: PlanDoc, op: PlanOp, ctx?: OpContext): PlanDoc {
  const defaults = defaultsOf(doc, ctx);
  switch (op.op) {
    // ── walls ──
    case "addWall": {
      const levelId = levelOf(doc, op.levelId);
      const a = pt(op.a, "a");
      const b = pt(op.b, "b");
      if (dist(a, b) < 1) throw new PlanOpError("A wall needs two distinct points.");
      const wall: Wall = {
        id: op.id ?? newId("w"),
        levelId,
        a,
        b,
        thickIn: op.thickIn ?? defaults.wallThickIn,
        heightIn: op.heightIn ?? doc.levels.find((l) => l.id === levelId)?.ceilingIn ?? defaults.ceilingIn,
        kind: op.kind ?? "new",
      };
      // Drawn along an existing wall: only add the part that isn't there yet
      // (an agent passing its own id always gets exactly the wall it asked for).
      if (!op.id) {
        const spans = uncoveredSpans(a, b, doc.walls.filter((w) => w.levelId === levelId));
        if (!spans.length) return doc;
        if (spans.length > 1 || !samePt(spans[0][0], a) || !samePt(spans[0][1], b)) {
          const parts = spans.map(([p, q]) => ({ ...wall, id: newId("w"), a: p, b: q }));
          return refreshWalls({ ...doc, walls: [...doc.walls, ...parts] });
        }
      }
      return refreshWalls({ ...doc, walls: [...doc.walls, wall] });
    }
    case "addWalls": {
      if (!Array.isArray(op.walls) || !op.walls.length) return doc;
      for (const w of op.walls) levelOf(doc, w.levelId);
      return refreshWalls({ ...doc, walls: [...doc.walls, ...op.walls] });
    }
    case "addRoomRect": {
      const levelId = levelOf(doc, op.levelId);
      const p = pt(op.p, "p");
      const q = pt(op.q, "q");
      if (Math.abs(p.x - q.x) < 12 || Math.abs(p.y - q.y) < 12) throw new PlanOpError("A room needs to be at least 12in each way.");
      const level = doc.levels.find((l) => l.id === levelId)!;
      const levelWalls = doc.walls.filter((w) => w.levelId === levelId);
      // A side that runs along a neighbour's wall reuses it (no stacked copy).
      const walls = rectWalls(levelId, p, q, op.thickIn ?? defaults.wallThickIn, op.heightIn ?? level.ceilingIn, op.kind ?? "existing").flatMap((w) =>
        uncoveredSpans(w.a, w.b, levelWalls).map(([a, b], i) => ({ ...w, id: i === 0 ? w.id : newId("w"), a, b })),
      );
      let d = refreshWalls({ ...doc, walls: [...doc.walls, ...walls] });
      if (op.name) {
        const cx = (p.x + q.x) / 2;
        const cy = (p.y + q.y) / 2;
        d = {
          ...d,
          rooms: d.rooms.map((r) =>
            r.levelId === levelId && r.polygon.length && Math.abs(r.polygon.reduce((s, v) => s + v.x, 0) / r.polygon.length - cx) < 1 && Math.abs(r.polygon.reduce((s, v) => s + v.y, 0) / r.polygon.length - cy) < 1
              ? { ...r, name: op.name!, pinned: true }
              : r,
          ),
        };
      }
      return d;
    }
    case "updateWall": {
      const w = wallOf(doc, op.id);
      const patch = { ...op.patch };
      if (patch.a) patch.a = pt(patch.a, "a");
      if (patch.b) patch.b = pt(patch.b, "b");
      const next = { ...w, ...patch };
      if (dist(next.a, next.b) < 1) throw new PlanOpError("A wall needs two distinct points.");
      // Moving an endpoint moves shared corners too (keeps rooms closed).
      let d = doc;
      if (patch.a && !samePt(patch.a, w.a)) d = moveCornerGeom(d, w.levelId, w.a, patch.a);
      if (patch.b && !samePt(patch.b, w.b)) d = moveCornerGeom(d, w.levelId, w.b, patch.b);
      d = { ...d, walls: d.walls.map((x) => (x.id === w.id ? { ...x, ...patch, a: patch.a ?? x.a, b: patch.b ?? x.b } : x)) };
      return refreshWalls(d);
    }
    case "moveCorner": {
      const levelId = levelOf(doc, op.levelId);
      const d = moveCornerGeom(doc, levelId, pt(op.from, "from"), pt(op.to, "to"));
      if (d.walls.some((w) => w.levelId === levelId && dist(w.a, w.b) < 1)) throw new PlanOpError("That would make a wall shorter than 1in.");
      return refreshWalls(d);
    }
    case "splitWall":
      return refreshWalls(splitWallGeom(doc, op.id, num(op.atIn, "atIn", 0)));
    case "joinWalls":
      return refreshWalls(joinWallsGeom(doc, op.idA, op.idB));

    // ── openings ──
    case "addOpening": {
      const w = wallOf(doc, op.wallId);
      const kind = op.kind;
      const sub =
        op.subtype ??
        (kind === "door" ? DOOR_SUBTYPES[0].key : kind === "window" ? WINDOW_SUBTYPES[0].key : "cased");
      const preset =
        // No subtype asked for → the designer's default sizes (Settings), not
        // the first preset's, so the placed door matches the hover preview.
        kind === "door"
          ? { w: (op.subtype && DOOR_SUBTYPES.find((s) => s.key === sub)?.defaultWidthIn) || defaults.doorWidthIn, h: defaults.doorHeightIn, sill: 0 }
          : kind === "window"
            ? (() => {
                const s = op.subtype ? WINDOW_SUBTYPES.find((x) => x.key === sub) : undefined;
                return { w: s?.defaultWidthIn ?? defaults.windowWidthIn, h: s?.defaultHeightIn ?? defaults.windowHeightIn, sill: s?.defaultSillIn ?? defaults.windowSillIn };
              })()
            : { w: 48, h: defaults.doorHeightIn, sill: 0 };
      const opening: Opening = {
        id: op.id ?? newId("o"),
        wallId: w.id,
        atIn: num(op.atIn, "atIn", -1000, 20000),
        widthIn: op.widthIn ?? preset.w,
        heightIn: op.heightIn ?? preset.h,
        sillIn: op.sillIn ?? preset.sill,
        kind,
        subtype: sub,
        hand: op.hand ?? "L",
        swing: op.swing ?? "left",
        phase: op.phase ?? "new",
        tag: op.tag ?? "",
      };
      opening.atIn = clampOpening(opening, w);
      return { ...doc, openings: [...doc.openings, opening] };
    }
    case "updateOpening": {
      const o = doc.openings.find((x) => x.id === op.id);
      if (!o) throw new PlanOpError(`Unknown opening "${op.id}".`);
      const next = { ...o, ...op.patch };
      const w = wallOf(doc, next.wallId);
      next.atIn = clampOpening(next, w);
      return { ...doc, openings: doc.openings.map((x) => (x.id === o.id ? next : x)) };
    }

    // ── stairs / structure ──
    case "addStair": {
      const levelId = levelOf(doc, op.levelId);
      const at = pt(op.at, "at");
      const to = op.toLevelId ?? doc.levels.find((l) => l.id !== levelId)?.id ?? levelId;
      const from = doc.levels.find((l) => l.id === levelId)!;
      const toL = doc.levels.find((l) => l.id === to) ?? from;
      const rise = Math.abs(toL.elevationIn - from.elevationIn) || from.ceilingIn + 12;
      const riserIn = op.riserIn ?? 7.5;
      const riserCount = op.riserCount ?? Math.max(1, Math.round(rise / riserIn));
      const s: Stair = {
        id: op.id ?? newId("s"),
        fromLevelId: levelId,
        toLevelId: to,
        shape: op.shape ?? "straight",
        x: at.x,
        y: at.y,
        rotDeg: op.rotDeg ?? 0,
        widthIn: op.widthIn ?? 36,
        riserCount,
        riserIn: rise / riserCount,
        treadIn: op.treadIn ?? 10,
        phase: op.phase ?? "new",
        ...(op.turn ? { turn: op.turn } : {}),
        ...(op.landingAt != null ? { landingAt: op.landingAt } : {}),
        ...(op.wellIn != null ? { wellIn: op.wellIn } : {}),
      };
      return { ...doc, stairs: [...doc.stairs, s] };
    }
    case "updateStair":
      return { ...doc, stairs: doc.stairs.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)) };
    case "addStructure": {
      const levelId = levelOf(doc, op.levelId);
      const a = pt(op.a, "a");
      const b = op.b ? pt(op.b, "b") : a;
      const s: Structural = {
        id: op.id ?? newId("st"),
        levelId,
        kind: op.kind,
        a,
        b,
        wIn: op.wIn ?? (op.kind === "column" ? 5.5 : op.kind === "beam" ? 3.5 : 12),
        hIn: op.hIn ?? (op.kind === "column" ? defaults.ceilingIn : op.kind === "beam" ? 11.25 : 12),
        zIn: op.zIn ?? (op.kind === "column" ? 0 : defaults.ceilingIn - (op.hIn ?? (op.kind === "beam" ? 11.25 : 12))),
        phase: op.phase ?? "new",
        label: op.label ?? "",
      };
      return { ...doc, structure: [...doc.structure, s] };
    }
    case "updateStructure":
      return { ...doc, structure: doc.structure.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)) };

    // ── items ──
    case "placeItem": {
      const levelId = levelOf(doc, op.levelId);
      let item = buildItem(doc, op, levelId);
      let wallId: string | null = null;
      const snap = op.snapToWall ?? (item.kind !== "island" && item.kind !== "furniture");
      if (snap) {
        const placed = placeAgainstWall(doc, levelId, item, { x: item.x, y: item.y }, { keepRotation: op.rotDeg != null && !op.snapToWall });
        item = placed.item;
        wallId = placed.wallId;
      }
      item = { ...item, wallId };
      if (op.snapToNeighbors ?? true) item = snapToNeighbors({ ...doc, items: [...doc.items, item] }, item);
      const d = { ...doc, items: [...doc.items, item] };
      return CABINET_KINDS.has(item.kind) ? refreshItems(d, [levelId], ctx) : d;
    }
    case "placeRun": {
      const w = wallOf(doc, op.wallId);
      const specs = op.keys.map((k) => {
        const li = libraryItem(k);
        if (!li) throw new PlanOpError(`Unknown library item "${k}".`);
        return withDesignCabinetStyle(doc, { w: li.w, d: li.d, h: li.h, z: li.z, kind: li.kind, label: li.label, tag: li.tag, libraryKey: li.key, catalogId: null, props: { ...li.props } });
      });
      const d = placeRunAlongWall(doc, w.id, op.side, num(op.startIn, "startIn", 0), specs, op.phase ?? "new");
      return refreshItems(d, [w.levelId], ctx);
    }
    case "updateItem": {
      const it = itemOf(doc, op.id);
      const next = { ...it, ...op.patch, id: it.id, levelId: it.levelId };
      const d = { ...doc, items: doc.items.map((x) => (x.id === it.id ? next : x)) };
      return CABINET_KINDS.has(next.kind) || CABINET_KINDS.has(it.kind) ? refreshItems(d, [it.levelId], ctx) : d;
    }
    case "moveItems": {
      const dx = num(op.dx, "dx");
      const dy = num(op.dy, "dy");
      const ids = new Set(op.ids);
      let d = { ...doc, items: doc.items.map((i) => (ids.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)) };
      if (op.snapToWall) {
        d = {
          ...d,
          items: d.items.map((i) => {
            if (!ids.has(i.id) || i.kind === "island" || i.kind === "furniture") return i;
            const placed = placeAgainstWall(d, i.levelId, i, { x: i.x, y: i.y }, { maxIn: 12 });
            return { ...placed.item, wallId: placed.wallId };
          }),
        };
      }
      const levels = findLevelForIds(doc, op.ids);
      return doc.items.some((i) => ids.has(i.id) && CABINET_KINDS.has(i.kind)) ? refreshItems(d, levels, ctx) : d;
    }
    case "rotateItems": {
      const ids = new Set(op.ids);
      const delta = num(op.deltaDeg, "deltaDeg", -360, 360);
      const sel = doc.items.filter((i) => ids.has(i.id));
      if (!sel.length) return doc;
      const cx = sel.reduce((s, i) => s + i.x, 0) / sel.length;
      const cy = sel.reduce((s, i) => s + i.y, 0) / sel.length;
      const d = {
        ...doc,
        items: doc.items.map((i) => {
          if (!ids.has(i.id)) return i;
          const p = sel.length > 1 ? rotatePt({ x: i.x, y: i.y }, { x: cx, y: cy }, delta) : { x: i.x, y: i.y };
          return { ...i, x: p.x, y: p.y, rotDeg: ((i.rotDeg + delta) % 360 + 360) % 360, wallId: null };
        }),
      };
      return sel.some((i) => CABINET_KINDS.has(i.kind)) ? refreshItems(d, findLevelForIds(doc, op.ids), ctx) : d;
    }
    case "duplicateItems": {
      const ids = new Set(op.ids);
      const dx = op.dx ?? 0;
      const dy = op.dy ?? 0;
      // Copies sit off the original's wall, so they don't join its run; ids can
      // be supplied so the canvas can select what it just made.
      const copies = doc.items
        .filter((i) => ids.has(i.id))
        .map((i, k) => ({ ...i, id: op.newIds?.[k] ?? newId("i"), x: i.x + dx, y: i.y + dy, runId: null, wallId: dx || dy ? null : i.wallId, selectionOptionId: null }));
      const d = { ...doc, items: [...doc.items, ...copies] };
      return copies.some((i) => CABINET_KINDS.has(i.kind)) ? refreshItems(d, copies.map((c) => c.levelId), ctx) : d;
    }
    case "setItemPhase": {
      const ids = new Set(op.ids);
      return { ...doc, items: doc.items.map((i) => (ids.has(i.id) ? { ...i, phase: op.phase } : i)) };
    }
    case "setItemProps": {
      const ids = new Set(op.ids);
      return { ...doc, items: doc.items.map((i) => (ids.has(i.id) ? { ...i, props: { ...i.props, ...op.props } } : i)) };
    }

    // ── counters / finishes ──
    case "updateCounter":
      return { ...doc, counters: doc.counters.map((c) => (c.id === op.id ? { ...c, ...op.patch } : c)) };
    case "addCounter": {
      const levelId = levelOf(doc, op.levelId);
      const polygon = (op.polygon ?? []).map((p, i) => pt(p, `polygon[${i}]`));
      if (polygon.length < 3) throw new PlanOpError("A counter needs at least 3 points.");
      const c: Counter = {
        id: op.id ?? newId("c"),
        levelId,
        runId: null,
        polygon,
        thickIn: op.thickIn ?? 1.5,
        overhang: { front: 0, back: 0, left: 0, right: 0 },
        edge: "eased",
        material: toFinish(op.material) ?? finishRef("quartz-white"),
        backsplashIn: op.backsplashIn ?? 0,
        seams: [],
        waterfall: [],
      };
      return { ...doc, counters: [...doc.counters, c] };
    }
    case "regenerateCounters": {
      const levelId = levelOf(doc, op.levelId);
      const mat = toFinish(op.material);
      let d = generateCounters(doc, levelId, {
        overhangIn: defaults.overhangIn,
        seatingOverhangIn: defaults.seatingOverhangIn,
        thickIn: 1.5,
        backsplashIn: defaults.backsplashIn,
        material: mat ?? finishRef("quartz-white"),
        edge: "eased",
      });
      if (mat) d = { ...d, counters: d.counters.map((c) => (c.levelId === levelId && c.runId ? { ...c, material: mat } : c)) };
      return d;
    }
    case "setRoom":
      return { ...doc, rooms: doc.rooms.map((r) => (r.id === op.id ? { ...r, ...op.patch, pinned: true } : r)) };
    case "setFloorFinish":
      return { ...doc, rooms: doc.rooms.map((r) => (r.id === op.roomId ? { ...r, floor: toFinish(op.material), pinned: true } : r)) };
    case "setCeilingFinish":
      return { ...doc, rooms: doc.rooms.map((r) => (r.id === op.roomId ? { ...r, ceiling: toFinish(op.material), pinned: true } : r)) };
    case "setWallFinish": {
      const w = wallOf(doc, op.wallId);
      const mat = toFinish(op.material);
      const walls = doc.walls.map((x) => (x.id === w.id ? { ...x, faces: { ...(x.faces ?? {}), [op.side]: op.heightIn ? x.faces?.[op.side] ?? null : mat } } : x));
      // A partial-height finish (tile field, wainscot) is a FinishRegion on the face.
      let finishes = doc.finishes.filter((f) => !(f.target === "wall" && f.wallId === w.id && f.side === op.side));
      if (mat && op.heightIn) {
        finishes = [...finishes, { id: newId("f"), levelId: w.levelId, target: "wall", wallId: w.id, side: op.side, material: mat, heightIn: op.heightIn }];
      }
      return { ...doc, walls, finishes };
    }
    case "addFinishRegion": {
      const r = op.region;
      const levelId = levelOf(doc, r.levelId);
      const region: FinishRegion = { ...r, id: r.id ?? newId("f"), levelId, material: toFinish(r.material) ?? finishRef("paint-white") };
      return { ...doc, finishes: [...doc.finishes, region] };
    }
    case "updateFinishRegion":
      return { ...doc, finishes: doc.finishes.map((f) => (f.id === op.id ? { ...f, ...op.patch } : f)) };
    case "addTrim": {
      const levelId = levelOf(doc, op.levelId);
      const t: TrimRun = {
        id: op.id ?? newId("t"),
        levelId,
        wallId: op.wallId ?? null,
        roomId: op.roomId ?? null,
        profile: op.profile,
        heightIn: op.heightIn ?? (op.profile === "base" ? 5.25 : op.profile === "crown" ? 3.5 : op.profile === "casing" ? 2.5 : 32),
      };
      return { ...doc, trims: [...doc.trims, t] };
    }

    // ── electrical ──
    case "addDevice": {
      const levelId = levelOf(doc, op.levelId);
      const at = pt(op.at, "at");
      const sym = elecSymbol(op.type);
      const dvc: Device = {
        id: op.id ?? newId("e"),
        levelId,
        type: op.type,
        x: at.x,
        y: at.y,
        heightAff: op.heightAff ?? sym.defaultHeightAff,
        wallId: op.wallId ?? null,
        circuit: op.circuit ?? "",
        switchLegTo: [],
        phase: op.phase ?? "new",
      };
      return { ...doc, electrical: [...doc.electrical, dvc] };
    }
    case "updateDevice":
      return { ...doc, electrical: doc.electrical.map((e) => (e.id === op.id ? { ...e, ...op.patch } : e)) };
    case "linkSwitch":
      return {
        ...doc,
        electrical: doc.electrical.map((e) => {
          if (e.id !== op.switchId) return e;
          const set = new Set(e.switchLegTo);
          if (op.on) set.add(op.lightId);
          else set.delete(op.lightId);
          return { ...e, switchLegTo: [...set] };
        }),
      };

    // ── annotation ──
    case "addDim": {
      const levelId = levelOf(doc, op.levelId);
      const d: Dim = { id: op.id ?? newId("d"), levelId, kind: op.kind ?? "aligned", a: pt(op.a, "a"), b: pt(op.b, "b"), offsetIn: op.offsetIn ?? 12, chain: op.chain };
      return { ...doc, dims: [...doc.dims, d] };
    }
    case "updateDim":
      return { ...doc, dims: doc.dims.map((d) => (d.id === op.id ? { ...d, ...op.patch } : d)) };
    case "addNote": {
      const levelId = levelOf(doc, op.levelId);
      const at = pt(op.at, "at");
      const n: Note = { id: op.id ?? newId("n"), levelId, x: at.x, y: at.y, text: String(op.text ?? "").slice(0, 2000), kind: op.kind ?? "note", leaderTo: op.leaderTo ?? null };
      return { ...doc, notes: [...doc.notes, n] };
    }
    case "updateNote":
      return { ...doc, notes: doc.notes.map((n) => (n.id === op.id ? { ...n, ...op.patch } : n)) };
    case "addPhoto": {
      const levelId = levelOf(doc, op.levelId);
      const at = pt(op.at, "at");
      const p: PhotoPin = { id: op.id ?? newId("p"), levelId, x: at.x, y: at.y, fileId: op.fileId, caption: op.caption ?? "" };
      return { ...doc, photos: [...doc.photos, p] };
    }
    case "addCamera": {
      const levelId = levelOf(doc, op.levelId);
      const c: Camera = { id: op.id ?? newId("cam"), name: op.name || `View ${doc.cameras.length + 1}`, levelId, pos: op.pos, target: op.target, fov: op.fov ?? 60, mode: op.mode ?? "orbit" };
      return { ...doc, cameras: [...doc.cameras, c] };
    }
    case "updateCamera":
      return { ...doc, cameras: doc.cameras.map((c) => (c.id === op.id ? { ...c, ...op.patch } : c)) };
    case "addSection": {
      const levelId = levelOf(doc, op.levelId);
      const s: SectionLine = { id: op.id ?? newId("sec"), levelId, a: pt(op.a, "a"), b: pt(op.b, "b"), depthIn: op.depthIn ?? 120, flip: !!op.flip, label: op.label ?? String.fromCharCode(65 + doc.sections.length) };
      return { ...doc, sections: [...doc.sections, s] };
    }
    case "updateSection":
      return { ...doc, sections: doc.sections.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)) };
    case "setUnderlay": {
      const lvl = op.underlay?.levelId ?? op.levelId ?? doc.levels[0]?.id ?? MAIN_LEVEL_ID;
      if (!doc.levels.some((l) => l.id === lvl)) throw new PlanOpError(`No level ${lvl}.`);
      const rest = (doc.underlays ?? []).filter((u) => u.levelId !== lvl);
      if (!op.underlay) return { ...doc, underlay: null, underlays: rest };
      const u: Underlay = { ...op.underlay, id: op.underlay.id ?? newId("u"), levelId: lvl };
      num(u.scale, "scale", 0.0001, 1000);
      return { ...doc, underlay: null, underlays: [...rest, u] };
    }
    case "updateUnderlay": {
      const cur = (doc.underlays ?? []).find((u) => u.id === op.id);
      if (!cur) throw new PlanOpError(`No underlay ${op.id}.`);
      const next: Underlay = { ...cur, ...op.patch, id: cur.id, levelId: cur.levelId, fileId: cur.fileId };
      if (op.patch.scale != null) num(op.patch.scale, "scale", 0.0001, 1000);
      if (op.patch.opacity != null) next.opacity = Math.max(0, Math.min(1, op.patch.opacity));
      return { ...doc, underlays: (doc.underlays ?? []).map((u) => (u.id === op.id ? next : u)) };
    }

    // ── generic ──
    case "move": {
      const ids = new Set(op.ids);
      // Cabinets / devices hung on a wall that moves go with it.
      const wallsMoving = new Set(doc.walls.filter((w) => ids.has(w.id)).map((w) => w.id));
      if (wallsMoving.size) {
        for (const i of doc.items) if (i.wallId && wallsMoving.has(i.wallId)) ids.add(i.id);
        for (const e of doc.electrical) if (e.wallId && wallsMoving.has(e.wallId)) ids.add(e.id);
      }
      const dx = num(op.dx, "dx");
      const dy = num(op.dy, "dy");
      const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
      let d: PlanDoc = {
        ...doc,
        items: doc.items.map((i) => (ids.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
        electrical: doc.electrical.map((e) => (ids.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e)),
        notes: doc.notes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy, leaderTo: n.leaderTo ? mv(n.leaderTo) : n.leaderTo } : n)),
        photos: doc.photos.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
        dims: doc.dims.map((m) => (ids.has(m.id) ? { ...m, a: mv(m.a), b: mv(m.b), chain: m.chain?.map(mv) } : m)),
        stairs: doc.stairs.map((s) => (ids.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
        structure: doc.structure.map((s) => (ids.has(s.id) ? { ...s, a: mv(s.a), b: mv(s.b) } : s)),
        counters: doc.counters.map((c) => (ids.has(c.id) && !c.runId ? { ...c, polygon: c.polygon.map(mv) } : c)),
        sections: doc.sections.map((s) => (ids.has(s.id) ? { ...s, a: mv(s.a), b: mv(s.b) } : s)),
        cameras: doc.cameras.map((c) => (ids.has(c.id) ? { ...c, pos: [c.pos[0] + dx, c.pos[1], c.pos[2] + dy], target: [c.target[0] + dx, c.target[1], c.target[2] + dy] } : c)),
      };
      // Walls move as whole segments (shared corners come along).
      const movedWalls = doc.walls.filter((w) => ids.has(w.id));
      if (movedWalls.length) {
        // Same ½" tolerance room detection uses, so a room drawn with snap
        // off doesn't tear open at a corner that's a hair apart.
        const corners = movedWalls.flatMap((w) => [
          { levelId: w.levelId, p: w.a },
          { levelId: w.levelId, p: w.b },
        ]);
        const atCorner = (levelId: string, p: Pt) => corners.some((c) => c.levelId === levelId && Math.abs(c.p.x - p.x) <= 0.5 && Math.abs(c.p.y - p.y) <= 0.5);
        d = { ...d, walls: d.walls.map((w) => (ids.has(w.id) ? { ...w, a: mv(w.a), b: mv(w.b) } : w)) };
        // Walls that only touch a moved corner stretch to follow it.
        d = {
          ...d,
          walls: d.walls.map((w) => {
            if (ids.has(w.id)) return w;
            const na = atCorner(w.levelId, w.a) ? mv(w.a) : w.a;
            const nb = atCorner(w.levelId, w.b) ? mv(w.b) : w.b;
            return na === w.a && nb === w.b ? w : { ...w, a: na, b: nb };
          }),
        };
        d = refreshWalls(d);
      }
      const levels = findLevelForIds(doc, [...ids]);
      return doc.items.some((i) => ids.has(i.id) && CABINET_KINDS.has(i.kind)) ? refreshItems(d, levels, ctx) : d;
    }
    case "delete":
      return deleteIds(doc, op.ids);
    case "addLevel": {
      const id = op.id ?? newId("L");
      const last = doc.levels[doc.levels.length - 1];
      const level: Level = { id, name: op.name || `Level ${doc.levels.length + 1}`, elevationIn: op.elevationIn ?? last.elevationIn + last.ceilingIn + 12, ceilingIn: op.ceilingIn ?? defaults.ceilingIn };
      let d: PlanDoc = { ...doc, levels: [...doc.levels, level] };
      if (op.copyWallsFrom) {
        const src = doc.walls.filter((w) => w.levelId === op.copyWallsFrom && w.kind !== "remove");
        d = { ...d, walls: [...d.walls, ...src.map((w) => ({ ...w, id: newId("w"), levelId: id, kind: "existing" as const, faces: undefined }))] };
        d = refreshWalls(d);
      }
      return d;
    }
    case "updateLevel":
      return { ...doc, levels: doc.levels.map((l) => (l.id === op.id ? { ...l, ...op.patch } : l)) };
    case "removeLevel": {
      if (doc.levels.length <= 1) throw new PlanOpError("A design needs at least one level.");
      const ids = [
        ...doc.walls.filter((w) => w.levelId === op.id).map((w) => w.id),
        ...doc.items.filter((i) => i.levelId === op.id).map((i) => i.id),
        ...doc.electrical.filter((e) => e.levelId === op.id).map((e) => e.id),
        ...doc.notes.filter((n) => n.levelId === op.id).map((n) => n.id),
        ...doc.dims.filter((n) => n.levelId === op.id).map((n) => n.id),
        ...doc.stairs.filter((s) => s.fromLevelId === op.id).map((s) => s.id),
        ...doc.structure.filter((s) => s.levelId === op.id).map((s) => s.id),
        ...doc.counters.filter((c) => c.levelId === op.id).map((c) => c.id),
        ...doc.finishes.filter((f) => f.levelId === op.id).map((f) => f.id),
        ...doc.cameras.filter((c) => c.levelId === op.id).map((c) => c.id),
        ...doc.sections.filter((s) => s.levelId === op.id).map((s) => s.id),
        ...doc.photos.filter((p) => p.levelId === op.id).map((p) => p.id),
      ];
      const d = deleteIds(doc, ids);
      return {
        ...d,
        levels: d.levels.filter((l) => l.id !== op.id),
        rooms: d.rooms.filter((r) => r.levelId !== op.id),
        underlays: (d.underlays ?? []).filter((u) => u.levelId !== op.id),
      };
    }
    case "setSettings": {
      const { defaults: dPatch, ...rest } = op.patch;
      return { ...doc, settings: { ...doc.settings, ...rest, defaults: { ...doc.settings.defaults, ...(dPatch ?? {}) } } };
    }
    case "ignoreCheck": {
      const set = new Set(doc.ignoredChecks);
      if (op.on) set.add(op.id);
      else set.delete(op.id);
      return { ...doc, ignoredChecks: [...set] };
    }
    case "replace":
      return op.doc ?? emptyDoc();
    default: {
      const never: never = op;
      throw new PlanOpError(`Unknown op ${(never as { op: string }).op}.`);
    }
  }
}

function samePt(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Apply a batch. Throws PlanOpError on the first bad op (nothing partial is
 *  returned — callers keep the previous doc). */
export function applyOps(doc: PlanDoc, ops: PlanOp[], ctx?: OpContext): PlanDoc {
  let d = doc;
  for (const op of ops) d = applyOp(d, op, ctx);
  return d;
}

/** Short label for the undo history. */
export function opLabel(op: PlanOp): string {
  switch (op.op) {
    case "addWall":
    case "addWalls":
      return "Draw wall";
    case "addRoomRect":
      return "Draw room";
    case "updateWall":
      return "Edit wall";
    case "moveCorner":
      return "Move corner";
    case "splitWall":
      return "Split wall";
    case "joinWalls":
      return "Join walls";
    case "addOpening":
      return op.kind === "door" ? "Add door" : op.kind === "window" ? "Add window" : "Add opening";
    case "updateOpening":
      return "Edit opening";
    case "addStair":
      return "Add stairs";
    case "updateStair":
      return "Edit stairs";
    case "addStructure":
      return `Add ${op.kind}`;
    case "updateStructure":
      return "Edit structure";
    case "placeItem":
      return `Place ${op.catalog?.name ?? op.libraryKey ?? "item"}`;
    case "placeRun":
      return "Place run";
    case "updateItem":
      return "Edit item";
    case "moveItems":
    case "move":
      return "Move";
    case "rotateItems":
      return "Rotate";
    case "duplicateItems":
      return "Duplicate";
    case "setItemPhase":
      return `Mark ${op.phase}`;
    case "setItemProps":
      return "Edit properties";
    case "updateCounter":
      return "Edit counter";
    case "addCounter":
      return "Draw counter";
    case "regenerateCounters":
      return "Regenerate counters";
    case "setRoom":
      return "Edit room";
    case "setFloorFinish":
      return "Floor finish";
    case "setCeilingFinish":
      return "Ceiling finish";
    case "setWallFinish":
      return "Wall finish";
    case "addFinishRegion":
    case "updateFinishRegion":
      return "Finish region";
    case "addTrim":
      return "Add trim";
    case "addDevice":
      return `Add ${op.type}`;
    case "updateDevice":
      return "Edit device";
    case "linkSwitch":
      return "Switch leg";
    case "addDim":
    case "updateDim":
      return "Dimension";
    case "addNote":
    case "updateNote":
      return "Note";
    case "addPhoto":
      return "Photo pin";
    case "addCamera":
    case "updateCamera":
      return "Camera";
    case "addSection":
    case "updateSection":
      return "Section line";
    case "setUnderlay":
      return op.underlay ? "Set underlay" : "Remove underlay";
    case "updateUnderlay":
      return op.patch.scale != null ? "Scale underlay" : op.patch.x != null || op.patch.rotDeg != null ? "Move underlay" : "Edit underlay";
    case "delete":
      return `Delete ${op.ids.length === 1 ? "element" : `${op.ids.length} elements`}`;
    case "addLevel":
      return "Add level";
    case "updateLevel":
      return "Edit level";
    case "removeLevel":
      return "Remove level";
    case "setSettings":
      return "Settings";
    case "ignoreCheck":
      return op.on ? "Ignore check" : "Restore check";
    case "replace":
      return "Replace design";
    default:
      return "Edit";
  }
}

/** Helper for the canvas: the wall-local offset of a plan point, for placing
 *  openings by click. */
export function openingAtFromPoint(w: Wall, p: Pt, widthIn: number): number {
  const f = wallFrame(w);
  const t = (p.x - w.a.x) * f.dir.x + (p.y - w.a.y) * f.dir.y;
  return Math.max(0, Math.min(f.length - widthIn, t - widthIn / 2));
}

export { alongWall, tierOf };
