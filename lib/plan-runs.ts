// Cabinet run logic for the floor-plan designer
// (docs/floor-plan-designer-plan.md §3 "Cabinet run logic", §7).
//
// Bases snap back-to-wall-face and end-to-end, tile into runs along a wall,
// gaps under 6" get a filler suggestion, corners offer blind / lazy susan /
// diagonal, islands are runs with no wall, counters are generated per base
// run, and wall cabinets sit at counter + gap.
//
// Conventions (see lib/plan-doc.ts): inches, y DOWN on screen. A PlacedItem's
// (x, y) is its footprint centre; `w` runs along its local x, `d` along local
// y; `rotDeg` rotates clockwise on screen. At rotDeg 0 the FRONT faces +y
// (down) and the BACK faces -y (up), so an item with its back on a wall has
// rotDeg such that its local -y points into the wall.
//
// Pure and client-safe: no React, no db. Every function returns new objects
// and never mutates its inputs.

import {
  newId,
  polygonArea,
  dist,
  type CabinetRun,
  type Counter,
  type DesignerDefaults,
  type FinishRef,
  type Phase,
  type PlacedItem,
  type PlanDoc,
  type Pt,
  type Wall,
} from "./plan-doc.ts";
import {
  EPS,
  add,
  sub,
  mul,
  dot,
  cross,
  degToRad,
  radToDeg,
  samePt,
  wallFrame,
  projectOnWall,
  nearestWall,
  alongWall,
  itemCorners,
  rectsOverlap,
} from "./plan-geometry.ts";

// ─── Tiers ───────────────────────────────────────────────────────────────────

/** Bottom of each cabinet kind above the floor. `wall` here is the plain
 *  default (36" counter + 18" gap); prefer wallCabZ(defaults) when a doc's
 *  defaults are at hand. */
export const TIER_Z: Record<"base" | "wall" | "tall" | "vanity" | "island", number> = {
  base: 0,
  wall: 54,
  tall: 0,
  vanity: 0,
  island: 0,
};

/** Typical box heights. Base/vanity boxes are 34½" (36" with the counter);
 *  wall and tall boxes vary per item, these are just sensible defaults. */
export const TIER_H: Record<"base" | "wall" | "tall" | "vanity", number> = {
  base: 34.5,
  wall: 30,
  tall: 84,
  vanity: 34.5,
};

/** Bottom of wall cabinets above the floor for a doc's defaults. */
export function wallCabZ(defaults: Pick<DesignerDefaults, "counterIn" | "wallCabGapIn">): number {
  return defaults.counterIn + defaults.wallCabGapIn;
}

/** Run tier of an item: base/vanity/island → "base"; wall → "wall";
 *  tall → "tall"; anything else → null (not a cabinet). */
export function tierOf(item: Pick<PlacedItem, "kind">): "base" | "wall" | "tall" | null {
  switch (item.kind) {
    case "base":
    case "vanity":
    case "island":
      return "base";
    case "wall":
      return "wall";
    case "tall":
      return "tall";
    default:
      return null;
  }
}

/** Gap at or above which two cabinets on the same wall are separate runs and
 *  a gap is flagged "open" rather than filler-able. */
export const RUN_BREAK_IN = 6;
/** Islands touching within this distance form one run. */
export const ISLAND_TOUCH_IN = 1;
/** Ignore gaps smaller than this (float noise / nominal-width slop). */
export const GAP_MIN_IN = 0.25;

// ─── Small frame helpers ─────────────────────────────────────────────────────

const norm360 = (deg: number): number => {
  const d = ((deg % 360) + 360) % 360;
  const r = Math.round(d * 1e6) / 1e6;
  return r === 360 ? 0 : r;
};

/** Rotation (degrees, clockwise on screen) that makes an item's FRONT face
 *  along `outwardNormal` — i.e. its back (local −y) points the opposite way,
 *  into the wall. Normalised to [0, 360).
 *
 *  rotatePt maps local (0, −1) to (sin θ, −cos θ); we need that to equal −n,
 *  so sin θ = −n.x and cos θ = n.y → θ = atan2(−n.x, n.y). */
export function rotationFacing(outwardNormal: Pt): number {
  return norm360(radToDeg(Math.atan2(-outwardNormal.x, outwardNormal.y)));
}

/** Unit vector of an item's local +x (its width axis) in plan space. */
export function itemAxis(rotDeg: number): Pt {
  const r = degToRad(rotDeg);
  return { x: Math.cos(r), y: Math.sin(r) };
}

/** Unit vector of an item's local +y (the direction its FRONT faces). */
export function itemFront(rotDeg: number): Pt {
  const r = degToRad(rotDeg);
  return { x: -Math.sin(r), y: Math.cos(r) };
}

/** [min, max] of the points projected onto `axis` measured from `origin`. */
function extentOn(pts: Pt[], origin: Pt, axis: Pt): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const v = dot(sub(p, origin), axis);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** +1 when the item centre is on the wall's left face side, else −1. */
function sideSign(wall: Pick<Wall, "a" | "b">, p: Pt): 1 | -1 {
  return projectOnWall(wall, p).side >= 0 ? 1 : -1;
}

/** Outward unit normal of a wall face (pointing away from the wall). */
function faceNormal(wall: Pick<Wall, "a" | "b">, sign: 1 | -1): Pt {
  return mul(wallFrame(wall).left, sign);
}

const isCabinet = (i: Pick<PlacedItem, "kind">): boolean => tierOf(i) !== null;

const wallsOnLevel = (doc: PlanDoc, levelId: string, includeRemoved = false): Wall[] =>
  doc.walls.filter((w) => w.levelId === levelId && (includeRemoved || w.kind !== "remove"));

// ─── Placement ───────────────────────────────────────────────────────────────

/** Snap an item so its back sits flush against the nearest wall FACE within
 *  `maxIn` (default 24") of the cursor, rotated to face into the room and
 *  sliding along the wall (clamped so it stays within the wall's length).
 *  Uses the face on the cursor's side of the wall. Walls marked "remove" are
 *  ignored. If no wall is near, the item is centred on the cursor with its
 *  rotation unchanged and wallId null. */
export function placeAgainstWall(
  doc: PlanDoc,
  levelId: string,
  item: PlacedItem,
  cursor: Pt,
  opts: { maxIn?: number; keepRotation?: boolean } = {},
): { item: PlacedItem; wallId: string | null } {
  const maxIn = opts.maxIn ?? 24;
  const near = nearestWall(cursor, wallsOnLevel(doc, levelId), maxIn);
  if (!near) {
    return { item: { ...item, levelId, x: cursor.x, y: cursor.y, wallId: null }, wallId: null };
  }
  const wall = near.wall;
  const f = wallFrame(wall);
  const sign = sideSign(wall, cursor);
  const n = faceNormal(wall, sign);
  const rotDeg = opts.keepRotation ? item.rotDeg : rotationFacing(n);

  // Half-extents of the (possibly rotated) footprint along and across the wall.
  const probe = itemCorners({ x: 0, y: 0, w: item.w, d: item.d, rotDeg });
  const [a0, a1] = extentOn(probe, { x: 0, y: 0 }, f.dir);
  const [p0] = extentOn(probe, { x: 0, y: 0 }, n);
  const halfAlong = (a1 - a0) / 2;
  const alongOffset = -(a0 + a1) / 2; // centre shift so the extent is symmetric
  const backOffset = -p0; // distance from centre to the item's wall-side edge

  let t = near.t;
  if (f.length <= 2 * halfAlong) t = f.length / 2;
  else t = Math.max(halfAlong, Math.min(f.length - halfAlong, t));

  const face = add(alongWall(wall, t), mul(n, wall.thickIn / 2));
  const centre = add(add(face, mul(n, backOffset)), mul(f.dir, alongOffset));
  return {
    item: { ...item, levelId, x: centre.x, y: centre.y, rotDeg, wallId: wall.id },
    wallId: wall.id,
  };
}

/** Snap an item end-to-end against neighbouring cabinets of the same tier on
 *  the same wall (or, for wall-less items, parallel neighbours in the same
 *  row) when its end is within `gapIn` (default 3") of theirs, so runs tile
 *  without gaps or slight overlaps. Returns the adjusted item (or the same
 *  item when nothing is near). */
export function snapToNeighbors(doc: PlanDoc, item: PlacedItem, gapIn = 3): PlacedItem {
  const tier = tierOf(item);
  if (!tier) return item;
  const wall = item.wallId ? doc.walls.find((w) => w.id === item.wallId) : undefined;
  let origin: Pt;
  let axis: Pt;
  let normal: Pt;
  if (wall) {
    const f = wallFrame(wall);
    origin = wall.a;
    axis = f.dir;
    normal = f.left;
  } else {
    origin = { x: 0, y: 0 };
    axis = itemAxis(item.rotDeg);
    normal = itemFront(item.rotDeg);
  }
  const mine = itemCorners(item);
  const [a0, a1] = extentOn(mine, origin, axis);
  const [p0, p1] = extentOn(mine, origin, normal);

  let best: number | null = null;
  for (const o of doc.items) {
    if (o.id === item.id || o.levelId !== item.levelId || tierOf(o) !== tier) continue;
    if (wall) {
      if (o.wallId !== wall.id) continue;
    } else {
      if (o.wallId) continue;
      const dAng = Math.abs(((o.rotDeg - item.rotDeg) % 180) + 180) % 180;
      if (dAng > 1 && dAng < 179) continue;
    }
    const theirs = itemCorners(o);
    const [q0, q1] = extentOn(theirs, origin, normal);
    if (q1 <= p0 + EPS || q0 >= p1 - EPS) continue; // different row / other face
    const [b0, b1] = extentOn(theirs, origin, axis);
    for (const shift of [b1 - a0, b0 - a1]) {
      if (Math.abs(shift) <= gapIn && (best === null || Math.abs(shift) < Math.abs(best))) best = shift;
    }
  }
  if (best === null || Math.abs(best) < 1e-9) return item;
  return { ...item, x: item.x + axis.x * best, y: item.y + axis.y * best };
}

// ─── Runs ────────────────────────────────────────────────────────────────────

interface Group {
  wallId: string | null;
  tier: CabinetRun["tier"];
  items: PlacedItem[];
}

/** Rebuild doc.runs for a level. Cabinet items (base/vanity/island/wall/tall)
 *  that share a wall, a face side, and a tier are ordered along the wall and
 *  split into runs wherever the gap between neighbours is ≥ 6". Items with no
 *  (or a missing) wall — islands and free-standing boxes — form runs by
 *  contact: footprints touching within 1" cluster together (wallId null).
 *  Existing run ids and their accessories are kept where membership overlaps.
 *  Items get their runId back-reference set (null when in no run). Runs on
 *  other levels are untouched. */
export function rebuildRuns(doc: PlanDoc, levelId: string): PlanDoc {
  const walls = doc.walls.filter((w) => w.levelId === levelId);
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const cabinets = doc.items.filter((i) => i.levelId === levelId && isCabinet(i));

  const groups: Group[] = [];

  // 1. Wall-attached: key by wall + tier + side, order along the wall.
  const byKey = new Map<string, { wall: Wall; tier: CabinetRun["tier"]; items: PlacedItem[] }>();
  const loose: PlacedItem[] = [];
  for (const it of cabinets) {
    const wall = it.wallId ? wallById.get(it.wallId) : undefined;
    if (!wall) {
      loose.push(it);
      continue;
    }
    const tier = tierOf(it)!;
    const key = `${wall.id}|${tier}|${sideSign(wall, it)}`;
    let g = byKey.get(key);
    if (!g) {
      g = { wall, tier, items: [] };
      byKey.set(key, g);
    }
    g.items.push(it);
  }
  // Deterministic order: by wall order in the doc, then tier, then side.
  const wallOrder = new Map(walls.map((w, i) => [w.id, i]));
  const keyed = [...byKey.entries()].sort((p, q) => {
    const wp = wallOrder.get(p[1].wall.id) ?? 0;
    const wq = wallOrder.get(q[1].wall.id) ?? 0;
    return wp - wq || p[0].localeCompare(q[0]);
  });
  for (const [, g] of keyed) {
    const f = wallFrame(g.wall);
    const ext = g.items.map((it) => {
      const [t0, t1] = extentOn(itemCorners(it), g.wall.a, f.dir);
      return { it, t0, t1 };
    });
    ext.sort((p, q) => p.t0 - q.t0 || p.t1 - q.t1);
    let cur: Group | null = null;
    let curEnd = -Infinity;
    for (const e of ext) {
      if (!cur || e.t0 - curEnd >= RUN_BREAK_IN) {
        cur = { wallId: g.wall.id, tier: g.tier, items: [] };
        groups.push(cur);
      }
      cur.items.push(e.it);
      curEnd = Math.max(curEnd, e.t1);
    }
  }

  // 2. Wall-less: cluster touching footprints per tier (union-find).
  const looseByTier = new Map<CabinetRun["tier"], PlacedItem[]>();
  for (const it of loose) {
    const tier = tierOf(it)!;
    const arr = looseByTier.get(tier) ?? [];
    arr.push(it);
    looseByTier.set(tier, arr);
  }
  for (const tier of ["base", "tall", "wall"] as const) {
    const arr = looseByTier.get(tier);
    if (!arr?.length) continue;
    const parent = arr.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const grown = arr.map((it) => itemCorners({ ...it, w: it.w + ISLAND_TOUCH_IN, d: it.d + ISLAND_TOUCH_IN }));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (rectsOverlap(grown[i], grown[j])) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, PlacedItem[]>();
    arr.forEach((it, i) => {
      const r = find(i);
      const c = clusters.get(r) ?? [];
      c.push(it);
      clusters.set(r, c);
    });
    for (const items of clusters.values()) {
      const axis = itemAxis(items[0].rotDeg);
      const sorted = [...items].sort((p, q) => dot({ x: p.x, y: p.y }, axis) - dot({ x: q.x, y: q.y }, axis));
      groups.push({ wallId: null, tier, items: sorted });
    }
  }

  // 3. Keep ids/accessories of existing runs whose membership overlaps.
  const prev = doc.runs.filter((r) => r.levelId === levelId);
  const claimed = new Set<string>();
  const runs: CabinetRun[] = groups.map((g) => {
    const ids = g.items.map((i) => i.id);
    const idSet = new Set(ids);
    let match: CabinetRun | null = null;
    let matchScore = 0;
    for (const r of prev) {
      if (claimed.has(r.id) || r.tier !== g.tier) continue;
      const score = r.itemIds.filter((id) => idSet.has(id)).length;
      if (score > matchScore) {
        match = r;
        matchScore = score;
      }
    }
    if (match) claimed.add(match.id);
    return {
      id: match?.id ?? newId("run"),
      levelId,
      wallId: g.wallId,
      tier: g.tier,
      itemIds: ids,
      accessories: match ? match.accessories.map((a) => ({ ...a })) : [],
    };
  });

  const runOf = new Map<string, string>();
  for (const r of runs) for (const id of r.itemIds) runOf.set(id, r.id);
  const items = doc.items.map((it) => {
    if (it.levelId !== levelId || !isCabinet(it)) return it;
    const rid = runOf.get(it.id) ?? null;
    return (it.runId ?? null) === rid ? it : { ...it, runId: rid };
  });
  return { ...doc, items, runs: [...doc.runs.filter((r) => r.levelId !== levelId), ...runs] };
}

export interface RunExtent {
  run: CabinetRun;
  wall: Wall | null;
  /** Along-run start/end. For wall runs these are inches from wall.a along the
   *  wall; for island runs they are projections onto `axis` from `origin`
   *  (plan origin). A point at distance t is origin + axis × t. */
  startIn: number;
  endIn: number;
  lengthIn: number;
  lengthLf: number;
  gaps: { afterItemId: string; gapIn: number; atIn: number }[];
  /** Run members in along-run order (missing ids dropped). */
  items: PlacedItem[];
  /** Deepest item in the run measured across the run axis. */
  depthIn: number;
  /** Frame the along-run numbers are measured in. */
  origin: Pt;
  axis: Pt;
}

/** Measure a run: along-wall extent, LF, member order, and the gaps between
 *  neighbours. Robust to empty runs and missing items/walls. */
export function runExtent(doc: PlanDoc, run: CabinetRun): RunExtent {
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  const members = run.itemIds.map((id) => byId.get(id)).filter((i): i is PlacedItem => !!i);
  const wall = (run.wallId ? doc.walls.find((w) => w.id === run.wallId) : undefined) ?? null;
  const empty: RunExtent = {
    run, wall, startIn: 0, endIn: 0, lengthIn: 0, lengthLf: 0, gaps: [], items: [], depthIn: 0,
    origin: wall ? wall.a : { x: 0, y: 0 }, axis: wall ? wallFrame(wall).dir : { x: 1, y: 0 },
  };
  if (!members.length) return empty;

  let origin: Pt;
  let axis: Pt;
  let normal: Pt;
  if (wall) {
    const f = wallFrame(wall);
    origin = wall.a;
    axis = f.dir;
    normal = f.left;
  } else {
    origin = { x: 0, y: 0 };
    axis = itemAxis(members[0].rotDeg);
    normal = itemFront(members[0].rotDeg);
  }
  const ext = members.map((it) => {
    const c = itemCorners(it);
    const [t0, t1] = extentOn(c, origin, axis);
    const [s0, s1] = extentOn(c, origin, normal);
    return { it, t0, t1, depth: s1 - s0 };
  });
  ext.sort((p, q) => p.t0 - q.t0 || p.t1 - q.t1);
  const startIn = ext[0].t0;
  const endIn = Math.max(...ext.map((e) => e.t1));
  const gaps: RunExtent["gaps"] = [];
  let reach = ext[0].t1;
  let reachId = ext[0].it.id;
  for (let i = 1; i < ext.length; i++) {
    const g = ext[i].t0 - reach;
    if (g >= GAP_MIN_IN) gaps.push({ afterItemId: reachId, gapIn: g, atIn: reach });
    if (ext[i].t1 > reach) {
      reach = ext[i].t1;
      reachId = ext[i].it.id;
    }
  }
  const lengthIn = Math.max(0, endIn - startIn);
  return {
    run,
    wall,
    startIn,
    endIn,
    lengthIn,
    lengthLf: lengthIn / 12,
    gaps,
    items: ext.map((e) => e.it),
    depthIn: Math.max(...ext.map((e) => e.depth)),
    origin,
    axis,
  };
}

/** Suggest fillers for gaps < 6" between neighbours in a run; gaps ≥ 6" are
 *  flagged "open" (room for another box). `atIn` is along-run distance
 *  (see RunExtent.startIn). */
export function suggestFillers(
  doc: PlanDoc,
  run: CabinetRun,
): { atIn: number; gapIn: number; suggestion: "filler" | "open" }[] {
  return runExtent(doc, run).gaps.map((g) => ({
    atIn: g.atIn,
    gapIn: g.gapIn,
    suggestion: g.gapIn < RUN_BREAK_IN ? "filler" : "open",
  }));
}

/** How close a base run's end must be to a wall corner to count as meeting
 *  there (a corner cabinet takes 33–36" along each wall). */
export const CORNER_REACH_IN = 36;

/** Corner conditions where two base runs on adjoining walls meet at a wall
 *  corner (both on the inside faces of the corner and reaching within
 *  CORNER_REACH_IN of it). Options offered: blind corner, lazy susan, diagonal. */
export function cornerSuggestions(
  doc: PlanDoc,
  levelId: string,
): { corner: Pt; runIds: string[]; options: ("blind" | "lazy" | "diagonal")[] }[] {
  const walls = doc.walls.filter((w) => w.levelId === levelId);
  const baseRuns = doc.runs.filter((r) => r.levelId === levelId && r.tier === "base" && r.wallId);
  if (baseRuns.length < 2) return [];
  const extents = baseRuns.map((r) => runExtent(doc, r)).filter((e) => e.wall && e.items.length);

  /** Runs on `wall` that touch the corner at `t` from the inside face
   *  (the face on which `other`'s far end lies). */
  const runsAtCorner = (wall: Wall, cornerT: number, other: Wall, corner: Pt) => {
    const far = samePt(other.a, corner, 0.5) ? other.b : other.a;
    const inner = sideSign(wall, far);
    return extents.filter((e) => {
      if (e.wall!.id !== wall.id) return false;
      const c = e.items[0];
      if (sideSign(wall, { x: c.x, y: c.y }) !== inner) return false;
      const nearEnd = Math.min(Math.abs(e.startIn - cornerT), Math.abs(e.endIn - cornerT));
      return nearEnd <= CORNER_REACH_IN;
    });
  };

  const out: { corner: Pt; runIds: string[]; options: ("blind" | "lazy" | "diagonal")[] }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const w1 = walls[i];
      const w2 = walls[j];
      for (const e1 of ["a", "b"] as const) {
        for (const e2 of ["a", "b"] as const) {
          if (!samePt(w1[e1], w2[e2], 0.5)) continue;
          const f1 = wallFrame(w1);
          const f2 = wallFrame(w2);
          if (Math.abs(cross(f1.dir, f2.dir)) < 0.05) continue; // collinear, not a corner
          const corner = w1[e1];
          const t1 = e1 === "a" ? 0 : f1.length;
          const t2 = e2 === "a" ? 0 : f2.length;
          const r1 = runsAtCorner(w1, t1, w2, corner);
          const r2 = runsAtCorner(w2, t2, w1, corner);
          if (!r1.length || !r2.length) continue;
          const runIds = [...new Set([...r1, ...r2].map((e) => e.run.id))];
          const key = `${Math.round(corner.x * 4)},${Math.round(corner.y * 4)}|${runIds.slice().sort().join(",")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ corner: { ...corner }, runIds, options: ["blind", "lazy", "diagonal"] });
        }
      }
    }
  }
  return out;
}

// ─── Counters ────────────────────────────────────────────────────────────────

export interface CounterOptions {
  overhangIn: number;
  seatingOverhangIn: number;
  thickIn: number;
  backsplashIn: number;
  material: FinishRef;
  edge: string;
}

type Side = "front" | "back" | "left" | "right";

/** Sides flagged for seating via item.props.seating ("front"|"back"|"left"|
 *  "right", or an array of those) on any item in the run. */
function seatingSides(items: PlacedItem[]): Set<Side> {
  const out = new Set<Side>();
  const ok = (v: unknown): v is Side => v === "front" || v === "back" || v === "left" || v === "right";
  for (const it of items) {
    const s = it.props?.seating;
    if (ok(s)) out.add(s);
    else if (Array.isArray(s)) for (const v of s) if (ok(v)) out.add(v);
  }
  return out;
}

/** Auto-generate counters for every base-tier run on a level (bases,
 *  vanities, islands).
 *
 *  Wall runs: a rectangle in wall coordinates from the run start − overhang to
 *  the run end + overhang, and from the wall FACE (flush) out to the deepest
 *  item front + overhang. Island / free-standing runs: the bounding box of the
 *  members in the first item's frame expanded by the overhang on all four
 *  sides. Any member with props.seating = "front"|"back"|"left"|"right" adds
 *  the seating overhang on that side ("left"/"right" are the item's local −x /
 *  +x; "back" on a wall run is ignored — it is flush to the wall).
 *
 *  Polygon order is [back-start, back-end, front-end, front-start] so the
 *  first edge is always the wall/back edge (used for backsplash LF).
 *
 *  Existing counters whose run still exists keep their id, material, edge,
 *  thickness, backsplash, seams and waterfall but get a fresh polygon and
 *  overhang; counters whose run vanished (or is no longer a base run) are
 *  dropped; hand-drawn counters (runId null) and other levels are untouched.
 *  Sink/cooktop cutouts are not subtracted. */
export function generateCounters(doc: PlanDoc, levelId: string, opts: CounterOptions): PlanDoc {
  const runs = doc.runs.filter((r) => r.levelId === levelId && r.tier === "base");
  const existing = new Map(doc.counters.filter((c) => c.levelId === levelId && c.runId).map((c) => [c.runId!, c]));
  const generated: Counter[] = [];

  for (const run of runs) {
    const ext = runExtent(doc, run);
    if (!ext.items.length) continue;
    const seats = seatingSides(ext.items);
    const oh = opts.overhangIn;
    const seat = opts.seatingOverhangIn;
    let polygon: Pt[];
    let overhang: Counter["overhang"];
    let backsplashIn: number;

    if (ext.wall) {
      const wall = ext.wall;
      const f = wallFrame(wall);
      const sign = sideSign(wall, { x: ext.items[0].x, y: ext.items[0].y });
      const n = faceNormal(wall, sign);
      const faceAt = (t: number, s: number): Pt => add(alongWall(wall, t), mul(n, wall.thickIn / 2 + s));
      // Front of the deepest member measured from the face.
      let sMax = 0;
      for (const it of ext.items) {
        const [, s1] = extentOn(itemCorners(it), faceAt(0, 0), n);
        if (s1 > sMax) sMax = s1;
      }
      // Along-wall start/end are wall-direction based; map "left"/"right"
      // seating (item local −x/+x) onto the wall direction using the first
      // member's axis.
      const alongSign = dot(itemAxis(ext.items[0].rotDeg), f.dir) >= 0 ? 1 : -1;
      const startSide: Side = alongSign > 0 ? "left" : "right";
      const endSide: Side = alongSign > 0 ? "right" : "left";
      overhang = {
        front: oh + (seats.has("front") ? seat : 0),
        back: 0,
        left: oh + (seats.has("left") ? seat : 0),
        right: oh + (seats.has("right") ? seat : 0),
      };
      const t0 = ext.startIn - overhang[startSide];
      const t1 = ext.endIn + overhang[endSide];
      const sF = sMax + overhang.front;
      polygon = [faceAt(t0, 0), faceAt(t1, 0), faceAt(t1, sF), faceAt(t0, sF)];
      backsplashIn = opts.backsplashIn;
    } else {
      const u = ext.axis; // local +x of the first member
      const v = itemFront(ext.items[0].rotDeg); // local +y (front)
      const corners = ext.items.flatMap((it) => itemCorners(it));
      const [u0, u1] = extentOn(corners, { x: 0, y: 0 }, u);
      const [v0, v1] = extentOn(corners, { x: 0, y: 0 }, v);
      overhang = {
        front: oh + (seats.has("front") ? seat : 0),
        back: oh + (seats.has("back") ? seat : 0),
        left: oh + (seats.has("left") ? seat : 0),
        right: oh + (seats.has("right") ? seat : 0),
      };
      const uA = u0 - overhang.left;
      const uB = u1 + overhang.right;
      const vA = v0 - overhang.back;
      const vB = v1 + overhang.front;
      const at = (a: number, b: number): Pt => add(mul(u, a), mul(v, b));
      polygon = [at(uA, vA), at(uB, vA), at(uB, vB), at(uA, vB)];
      backsplashIn = 0;
    }

    const prev = existing.get(run.id);
    generated.push(
      prev
        ? { ...prev, polygon, overhang }
        : {
            id: newId("c"),
            levelId,
            runId: run.id,
            polygon,
            thickIn: opts.thickIn,
            overhang,
            edge: opts.edge,
            material: { ...opts.material },
            backsplashIn,
            seams: [],
            waterfall: [],
          },
    );
  }

  const genById = new Map(generated.map((c) => [c.id, c]));
  const counters: Counter[] = [];
  for (const c of doc.counters) {
    if (c.levelId !== levelId || !c.runId) {
      counters.push(c);
      continue;
    }
    const g = genById.get(c.id);
    if (g) {
      counters.push(g);
      genById.delete(c.id);
    }
    // else: run vanished → dropped
  }
  for (const g of genById.values()) counters.push(g);
  return { ...doc, counters };
}

/** Set every wall-tier item on the level to z = counter height + wall-cab gap. */
export function alignWallCabinets(doc: PlanDoc, levelId: string, defaults: DesignerDefaults): PlanDoc {
  const z = wallCabZ(defaults);
  let changed = false;
  const items = doc.items.map((it) => {
    if (it.levelId !== levelId || tierOf(it) !== "wall" || it.z === z) return it;
    changed = true;
    return { ...it, z };
  });
  return changed ? { ...doc, items } : doc;
}

/** Total base/wall/tall run LF on a level plus counter and backsplash SF.
 *  Backsplash SF = each counter's back edge (first polygon edge) × its
 *  backsplashIn. */
export function runTotals(
  doc: PlanDoc,
  levelId: string,
): { baseLf: number; wallLf: number; tallLf: number; counterSf: number; backsplashSf: number } {
  let baseLf = 0;
  let wallLf = 0;
  let tallLf = 0;
  for (const run of doc.runs) {
    if (run.levelId !== levelId) continue;
    const lf = runExtent(doc, run).lengthLf;
    if (run.tier === "base") baseLf += lf;
    else if (run.tier === "wall") wallLf += lf;
    else tallLf += lf;
  }
  let counterSf = 0;
  let backsplashSf = 0;
  for (const c of doc.counters) {
    if (c.levelId !== levelId || c.polygon.length < 3) continue;
    counterSf += Math.abs(polygonArea(c.polygon)) / 144;
    if (c.backsplashIn > 0) backsplashSf += (dist(c.polygon[0], c.polygon[1]) * c.backsplashIn) / 144;
  }
  return { baseLf, wallLf, tallLf, counterSf, backsplashSf };
}

// ─── Bulk placement ──────────────────────────────────────────────────────────

export type RunSpec = Pick<
  PlacedItem,
  "w" | "d" | "h" | "z" | "kind" | "label" | "tag" | "libraryKey" | "catalogId" | "props"
>;

/** Place a whole run of boxes along a wall, backs flush on the given face
 *  ("left"|"right" of the wall walking a → b), tiling end-to-end from
 *  `startIn` (inches from wall.a). Returns the new doc with the items
 *  appended and the level's runs rebuilt. Unknown wall → doc unchanged. */
export function placeRunAlongWall(
  doc: PlanDoc,
  wallId: string,
  side: "left" | "right",
  startIn: number,
  specs: RunSpec[],
  phase: Phase = "new",
): PlanDoc {
  const wall = doc.walls.find((w) => w.id === wallId);
  if (!wall || !specs.length) return doc;

  const n = faceNormal(wall, side === "left" ? 1 : -1);
  const rotDeg = rotationFacing(n);
  const items: PlacedItem[] = [];
  let t = startIn;
  for (const s of specs) {
    const centre = add(alongWall(wall, t + s.w / 2), mul(n, wall.thickIn / 2 + s.d / 2));
    items.push({
      id: newId("i"),
      levelId: wall.levelId,
      kind: s.kind,
      catalogId: s.catalogId ?? null,
      libraryKey: s.libraryKey ?? null,
      label: s.label,
      tag: s.tag,
      x: centre.x,
      y: centre.y,
      z: s.z,
      rotDeg,
      w: s.w,
      d: s.d,
      h: s.h,
      phase,
      wallId: wall.id,
      runId: null,
      props: { ...(s.props ?? {}) },
    });
    t += s.w;
  }
  return rebuildRuns({ ...doc, items: [...doc.items, ...items] }, wall.levelId);
}

// ─── Collisions ──────────────────────────────────────────────────────────────

/** Every other item on the item's level whose footprint overlaps it and whose
 *  vertical range (z..z+h) overlaps too. Edge-touching does not count. Pairs
 *  where exactly one side is phase "remove" are skipped (a new box over a
 *  demo'd one is the normal remodel case, not a clash). */
export function itemCollisions(doc: PlanDoc, item: PlacedItem): PlacedItem[] {
  const mine = itemCorners(item);
  const z0 = item.z;
  const z1 = item.z + item.h;
  const out: PlacedItem[] = [];
  for (const o of doc.items) {
    if (o.id === item.id || o.levelId !== item.levelId) continue;
    if ((o.phase === "remove") !== (item.phase === "remove")) continue;
    if (o.z >= z1 - EPS || o.z + o.h <= z0 + EPS) continue;
    if (rectsOverlap(mine, itemCorners(o))) out.push(o);
  }
  return out;
}
