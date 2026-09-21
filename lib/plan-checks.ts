// Validation checks over a PlanDoc (docs/floor-plan-designer-plan.md §9).
//
// Pure, client-safe. Every rule is a small function returning Check[]; runChecks
// concatenates them and drops ids listed in doc.ignoredChecks. Ids are built
// from the check code plus the sorted element ids (or the level id) so the
// same condition yields the same id run after run — that is what makes
// "ignore on this design" stick.
//
// Nothing here blocks a save. Wording for the code group starts with
// "Check code:" because these are advisory, not legal.

import {
  dist,
  levelSlice,
  pointInPolygon,
  type Device,
  type Opening,
  type PlacedItem,
  type PlaceKind,
  type PlanDoc,
  type Pt,
  type Room,
  type Wall,
} from "./plan-doc.ts";
import {
  add,
  itemCorners,
  midPt,
  mul,
  openingWorld,
  pointInItem,
  projectOnWall,
  rectsOverlap,
  rotatePt,
  segIntersect,
  sub,
  wallFrame,
  wallPolygon,
} from "./plan-geometry.ts";
import { computeMeasures } from "./plan-measures.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CheckSeverity = "warn" | "info";
export type CheckGroup = "geometry" | "clearance" | "code" | "estimate";

export interface Check {
  id: string;
  code: string;
  group: CheckGroup;
  severity: CheckSeverity;
  message: string;
  levelId: string | null;
  anchor: Pt | null;
  elementIds: string[];
}

export interface CheckContext {
  /** catalogId → price_cents (null when the product has no price yet). */
  catalogPrices?: Record<number, number | null>;
  /** Measure keys that have a plan_cost_rules row. */
  costRuleKeys?: Set<string>;
}

export const CHECK_CODES: readonly { code: string; group: CheckGroup; label: string }[] = [
  { code: "room_unclosed", group: "geometry", label: "Unclosed room" },
  { code: "walls_overlap", group: "geometry", label: "Overlapping walls" },
  { code: "opening_too_wide", group: "geometry", label: "Opening past wall end" },
  { code: "item_in_wall", group: "geometry", label: "Item inside wall" },
  { code: "items_overlap", group: "geometry", label: "Items overlap" },
  { code: "run_gap", group: "geometry", label: "Gap in cabinet run" },
  { code: "seam_over_sink", group: "geometry", label: "Counter seam over sink / cooktop" },
  { code: "hood_clearance", group: "geometry", label: "Hood clearance over range" },
  { code: "aisle_narrow", group: "clearance", label: "Work aisle too narrow" },
  { code: "walkway_narrow", group: "clearance", label: "Walkway too narrow" },
  { code: "door_swing_conflict", group: "clearance", label: "Door swing conflict" },
  { code: "dw_far_from_sink", group: "clearance", label: "Dishwasher far from sink" },
  { code: "landing_space", group: "clearance", label: "Landing space" },
  { code: "seating_overhang", group: "clearance", label: "Seating overhang" },
  { code: "toilet_clearance", group: "clearance", label: "Toilet clearance" },
  { code: "shower_small", group: "clearance", label: "Shower too small" },
  { code: "egress_window", group: "code", label: "Bedroom egress window" },
  { code: "stair_rise_run", group: "code", label: "Stair rise / run" },
  { code: "headroom", group: "code", label: "Stair rise vs level height" },
  { code: "gfci_missing", group: "code", label: "GFCI at wet location" },
  { code: "outlet_spacing", group: "code", label: "Counter outlet spacing" },
  { code: "stair_light", group: "code", label: "Light at stair" },
  { code: "range_240", group: "code", label: "240V outlet at range" },
  { code: "smoke_missing", group: "code", label: "Smoke detector" },
  { code: "measure_unmapped", group: "estimate", label: "Measure has no cost rule" },
  { code: "item_no_price", group: "estimate", label: "Catalog item has no price" },
  { code: "generic_cabinet", group: "estimate", label: "Generic cabinet (allowance)" },
];

const GROUP_OF: ReadonlyMap<string, CheckGroup> = new Map(CHECK_CODES.map((c) => [c.code, c.group]));

// ─── Small helpers ───────────────────────────────────────────────────────────

const CABINET_KINDS: ReadonlySet<PlaceKind> = new Set(["base", "wall", "tall", "vanity", "island"]);
const COUNTER_HEIGHT_KINDS: ReadonlySet<PlaceKind> = new Set(["base", "vanity", "island"]);
const LIGHT_TYPES: ReadonlySet<Device["type"]> = new Set(["recessed", "pendant", "sconce", "underCab", "surface", "fan"]);
const NO_SWING_SUBTYPES = /pocket|slid|barn|bifold|cased|opening/i;

type Sev = CheckSeverity;

function mk(code: string, ids: string[], levelId: string | null, anchor: Pt | null, message: string, severity: Sev = "warn", idSuffix?: string): Check {
  const sorted = [...new Set(ids)].sort();
  return {
    id: `${code}:${idSuffix ?? sorted.join("+")}`,
    code,
    group: GROUP_OF.get(code) ?? "geometry",
    severity,
    message,
    levelId,
    anchor,
    elementIds: sorted,
  };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());
const itemName = (i: PlacedItem) => i.tag || i.label || i.libraryKey || i.kind;
const centre = (i: PlacedItem): Pt => ({ x: i.x, y: i.y });

function matches(i: PlacedItem, re: RegExp): boolean {
  const fixture = typeof i.props?.fixture === "string" ? (i.props.fixture as string) : "";
  const type = typeof i.props?.type === "string" ? (i.props.type as string) : "";
  return re.test(`${i.label} ${i.libraryKey ?? ""} ${i.tag} ${fixture} ${type}`);
}

const isSink = (i: PlacedItem) => i.kind === "plumbing" && matches(i, /sink|lav/i);
const isRange = (i: PlacedItem) => i.kind === "appliance" && matches(i, /range|cooktop|stove/i);
const isFridge = (i: PlacedItem) => i.kind === "appliance" && matches(i, /fridge|refrig/i);
const isDishwasher = (i: PlacedItem) => i.kind === "appliance" && matches(i, /dish|\bdw\b/i);
const isHood = (i: PlacedItem) => matches(i, /hood|vent/i) && (i.kind === "appliance" || i.kind === "hvac" || i.kind === "generic");
const isToilet = (i: PlacedItem) => i.kind === "plumbing" && matches(i, /toilet|\bwc\b/i);
const isShower = (i: PlacedItem) => i.kind === "plumbing" && matches(i, /shower/i);
const isWet = (i: PlacedItem) => i.kind === "plumbing" && matches(i, /sink|lav|tub|shower/i);
const isActive = (i: { phase: string }) => i.phase !== "remove";

/** Kinds that stand on the floor at counter height or taller and block an aisle. */
function isBaseTier(i: PlacedItem): boolean {
  if (i.kind === "base" || i.kind === "vanity" || i.kind === "island" || i.kind === "tall") return true;
  if (i.kind === "appliance" || i.kind === "plumbing") return i.z < 30 && i.h >= 20;
  return false;
}

/** Unit vector the item's front faces (at rotDeg 0 the front faces +y). */
function frontDir(i: PlacedItem): Pt {
  const c = centre(i);
  return sub(rotatePt({ x: i.x, y: i.y + 1 }, c, i.rotDeg), c);
}

/** World point from the item's local frame (x along w, y along d). */
function localToWorld(i: PlacedItem, lx: number, ly: number): Pt {
  return rotatePt({ x: i.x + lx, y: i.y + ly }, centre(i), i.rotDeg);
}

function worldToLocal(i: PlacedItem, p: Pt): Pt {
  const r = rotatePt(p, centre(i), -i.rotDeg);
  return { x: r.x - i.x, y: r.y - i.y };
}

/** Footprint shrunk by `by` inches on every side (never below 0.5"). */
function shrunkCorners(i: PlacedItem, by: number): Pt[] {
  return itemCorners({ x: i.x, y: i.y, w: Math.max(0.5, i.w - 2 * by), d: Math.max(0.5, i.d - 2 * by), rotDeg: i.rotDeg });
}

function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  if (L2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2));
  return dist(p, add(a, mul(ab, t)));
}

function ptPolyDist(p: Pt, poly: Pt[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) best = Math.min(best, ptSegDist(p, poly[k], poly[(k + 1) % poly.length]));
  return best;
}

function segPolyDist(a: Pt, b: Pt, poly: Pt[]): number {
  let best = Math.min(ptPolyDist(a, poly), ptPolyDist(b, poly));
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    if (segIntersect(a, b, p, q)) return 0;
    best = Math.min(best, ptSegDist(p, a, b), ptSegDist(q, a, b));
  }
  return best;
}

function polyPolyDist(a: Pt[], b: Pt[]): number {
  if (rectsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const p of a) best = Math.min(best, ptPolyDist(p, b));
  for (const p of b) best = Math.min(best, ptPolyDist(p, a));
  return best;
}

interface Obstacle {
  id: string;
  poly: Pt[];
}

/** Nearest obstacle hit by a ray from `origin` along unit `dir`, within maxIn. */
function rayHit(origin: Pt, dir: Pt, obstacles: Obstacle[], maxIn: number): { id: string; dist: number } | null {
  const far = add(origin, mul(dir, maxIn));
  let best: { id: string; dist: number } | null = null;
  for (const o of obstacles) {
    for (let k = 0; k < o.poly.length; k++) {
      const hit = segIntersect(origin, far, o.poly[k], o.poly[(k + 1) % o.poly.length]);
      if (!hit) continue;
      const d = dist(origin, hit);
      if (!best || d < best.dist) best = { id: o.id, dist: d };
    }
  }
  return best;
}

function wallObstacles(walls: Wall[]): Obstacle[] {
  const live = walls.filter((w) => w.kind !== "remove");
  return live.map((w) => ({ id: w.id, poly: wallPolygon(w, live) }));
}

type Slice = ReturnType<typeof levelSlice>;

interface Ctx {
  doc: PlanDoc;
  levelId: string;
  s: Slice;
  wallById: Map<string, Wall>;
}

function vertOverlap(a: PlacedItem, b: PlacedItem): boolean {
  return Math.max(a.z, b.z) < Math.min(a.z + a.h, b.z + b.h) - 0.5;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

function checkRoomUnclosed(c: Ctx): Check[] {
  const walls = c.s.walls.filter((w) => w.kind !== "remove");
  if (walls.length < 3 || c.s.rooms.length > 0) return [];
  const w0 = walls[0];
  return [mk("room_unclosed", walls.map((w) => w.id), c.levelId, midPt(w0.a, w0.b), `${walls.length} walls on this level but no closed room — check for a gap at a corner.`, "warn", c.levelId)];
}

function checkWallsOverlap(c: Ctx): Check[] {
  const out: Check[] = [];
  const walls = c.s.walls;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      const fa = wallFrame(a);
      const fb = wallFrame(b);
      if (Math.abs(fa.dir.x * fb.dir.y - fa.dir.y * fb.dir.x) > 0.02) continue; // not parallel
      const pa = projectOnWall(a, b.a);
      const pb = projectOnWall(a, b.b);
      if (Math.abs(pa.side) > 0.5 || Math.abs(pb.side) > 0.5) continue; // parallel but offset
      const lo = Math.max(0, Math.min(pa.t, pb.t));
      const hi = Math.min(fa.length, Math.max(pa.t, pb.t));
      const overlap = hi - lo;
      if (overlap <= 1) continue;
      const anchor = add(a.a, mul(fa.dir, (lo + hi) / 2));
      out.push(mk("walls_overlap", [a.id, b.id], c.levelId, anchor, `Two walls overlap along ${fmt(overlap)}" — join or trim them.`));
    }
  }
  return out;
}

function checkOpeningTooWide(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const o of c.s.openings) {
    const w = c.wallById.get(o.wallId);
    if (!w) continue;
    const L = dist(w.a, w.b);
    if (o.atIn >= -0.01 && o.atIn + o.widthIn <= L + 0.01) continue;
    const ow = openingWorld(o, w);
    out.push(mk("opening_too_wide", [o.id, w.id], c.levelId, ow.centre, `${o.kind === "door" ? "Door" : o.kind === "window" ? "Window" : "Opening"} ${fmt(o.widthIn)}" wide runs past the end of a ${fmt(L)}" wall.`));
  }
  return out;
}

function checkItemInWall(c: Ctx): Check[] {
  const out: Check[] = [];
  const live = c.s.walls.filter((w) => w.kind !== "remove");
  const polys = live.map((w) => ({ w, poly: wallPolygon(w, live) }));
  for (const i of c.s.items) {
    if (i.kind === "counter" || i.kind === "generic" || i.kind === "structure" || !isActive(i)) continue;
    const foot = shrunkCorners(i, 1);
    for (const { w, poly } of polys) {
      if (!rectsOverlap(foot, poly)) continue;
      out.push(mk("item_in_wall", [i.id, w.id], c.levelId, centre(i), `${itemName(i)} sits more than 1" into a wall.`));
    }
  }
  return out;
}

function checkItemsOverlap(c: Ctx): Check[] {
  const out: Check[] = [];
  const items = c.s.items.filter((i) => i.kind !== "counter" && i.kind !== "generic");
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const p = items[a];
      const q = items[b];
      if ((p.phase === "remove") !== (q.phase === "remove")) continue; // old vs new never clash
      if (!vertOverlap(p, q)) continue;
      if (!rectsOverlap(shrunkCorners(p, 0.25), shrunkCorners(q, 0.25))) continue;
      out.push(mk("items_overlap", [p.id, q.id], c.levelId, midPt(centre(p), centre(q)), `${itemName(p)} and ${itemName(q)} overlap.`));
    }
  }
  return out;
}

type Tier = "base" | "wall" | "tall";
function tierOf(i: PlacedItem): Tier | null {
  if (i.kind === "base" || i.kind === "vanity" || i.kind === "island") return "base";
  if (i.kind === "wall") return "wall";
  if (i.kind === "tall") return "tall";
  if (i.kind === "appliance" && i.z < 30) return "base";
  return null;
}

interface RunSlot {
  item: PlacedItem;
  start: number;
  end: number;
}

/** Same-tier items grouped by the wall they are attached to, sorted along it. */
function runsByWall(c: Ctx, tiers: ReadonlySet<Tier>): { wall: Wall; tier: Tier; slots: RunSlot[] }[] {
  const groups = new Map<string, { wall: Wall; tier: Tier; slots: RunSlot[] }>();
  for (const i of c.s.items) {
    if (!isActive(i) || !i.wallId) continue;
    const tier = tierOf(i);
    if (!tier || !tiers.has(tier)) continue;
    const wall = c.wallById.get(i.wallId);
    if (!wall) continue;
    const key = `${wall.id}|${tier}`;
    const g = groups.get(key) ?? { wall, tier, slots: [] };
    const t = projectOnWall(wall, centre(i)).t;
    g.slots.push({ item: i, start: t - i.w / 2, end: t + i.w / 2 });
    groups.set(key, g);
  }
  for (const g of groups.values()) g.slots.sort((p, q) => p.start - q.start);
  return [...groups.values()];
}

function checkRunGap(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const g of runsByWall(c, new Set<Tier>(["base", "wall", "tall"]))) {
    for (let k = 0; k + 1 < g.slots.length; k++) {
      const a = g.slots[k];
      const b = g.slots[k + 1];
      const gap = b.start - a.end;
      if (gap < 1) continue;
      const f = wallFrame(g.wall);
      const anchor = add(g.wall.a, mul(f.dir, (a.end + b.start) / 2));
      if (gap < 6) out.push(mk("run_gap", [a.item.id, b.item.id], c.levelId, anchor, `${fmt(gap)}" gap between ${itemName(a.item)} and ${itemName(b.item)} — filler needed.`));
      else out.push(mk("run_gap", [a.item.id, b.item.id], c.levelId, anchor, `${fmt(gap)}" open gap between ${itemName(a.item)} and ${itemName(b.item)}.`, "info"));
    }
  }
  return out;
}

function checkSeamOverSink(c: Ctx): Check[] {
  const out: Check[] = [];
  const targets = c.s.items.filter((i) => isActive(i) && (isSink(i) || isRange(i)));
  if (!targets.length) return out;
  for (const ct of c.s.counters) {
    for (const seam of ct.seams) {
      for (let k = 0; k + 1 < seam.length; k++) {
        for (const t of targets) {
          const d = segPolyDist(seam[k], seam[k + 1], itemCorners(t));
          if (d >= 6) continue;
          out.push(mk("seam_over_sink", [ct.id, t.id], c.levelId, midPt(seam[k], seam[k + 1]), `Counter seam runs within ${fmt(d)}" of ${itemName(t)} — move the seam away from the cutout.`));
        }
      }
    }
  }
  return out;
}

function checkHoodClearance(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const r of c.s.items) {
    if (!isActive(r) || !isRange(r)) continue;
    const top = r.z + r.h;
    const foot = itemCorners(r);
    const above = c.s.items.filter((i) => i.id !== r.id && isActive(i) && i.z >= top - 1 && (i.kind === "wall" || isHood(i)) && rectsOverlap(foot, itemCorners(i)));
    if (!above.length) continue;
    const hood = above.find(isHood);
    const gas = r.props?.power === "gas";
    const need = gas ? 30 : 24;
    if (hood) {
      const clr = hood.z - top;
      if (clr < need) out.push(mk("hood_clearance", [r.id, hood.id], c.levelId, centre(r), `${itemName(hood)} is ${fmt(clr)}" above ${itemName(r)}; ${gas ? "gas" : "electric"} needs ${need}".`));
    } else {
      const cab = above[0];
      out.push(mk("hood_clearance", [r.id, cab.id], c.levelId, centre(r), `Wall cabinet ${itemName(cab)} sits over ${itemName(r)} with no hood — add a hood or ${need}" of clearance.`));
    }
  }
  return out;
}

// ─── Clearance ───────────────────────────────────────────────────────────────

function checkAisleNarrow(c: Ctx): Check[] {
  const out = new Map<string, { d: number; check: Check }>();
  const baseItems = c.s.items.filter((i) => isActive(i) && isBaseTier(i));
  const obstacles: Obstacle[] = [
    ...baseItems.map((i) => ({ id: i.id, poly: itemCorners(i) })),
    ...wallObstacles(c.s.walls),
  ];
  for (const i of baseItems) {
    const dir = frontDir(i);
    // Start just in front of the face so the caster's own footprint is skipped.
    const origin = add(localToWorld(i, 0, i.d / 2), mul(dir, 0.05));
    const others = obstacles.filter((o) => o.id !== i.id);
    const hit = rayHit(origin, dir, others, 42);
    if (!hit || hit.dist >= 42) continue;
    const d = Math.round(hit.dist * 10) / 10;
    const ids = [i.id, hit.id].sort();
    const key = ids.join("+");
    const sev: Sev = "warn";
    const msg = d < 36
      ? `Only ${fmt(d)}" in front of ${itemName(i)} — under 36" is too tight to work or pass.`
      : `${fmt(d)}" work aisle in front of ${itemName(i)} — 42" recommended (48" for two cooks).`;
    const existing = out.get(key);
    if (!existing || d < existing.d) {
      out.set(key, { d, check: mk("aisle_narrow", ids, c.levelId, add(origin, mul(dir, hit.dist / 2)), msg, sev) });
    }
  }
  return [...out.values()].map((v) => v.check);
}

function checkWalkwayNarrow(c: Ctx): Check[] {
  const out: Check[] = [];
  const obstacles: Obstacle[] = [
    ...c.s.items.filter((i) => isActive(i) && isBaseTier(i)).map((i) => ({ id: i.id, poly: itemCorners(i) })),
    ...wallObstacles(c.s.walls),
  ];
  for (const o of c.s.openings) {
    if (o.kind === "window" || !isActive(o)) continue;
    const w = c.wallById.get(o.wallId);
    if (!w) continue;
    const ow = openingWorld(o, w);
    for (const sgn of [1, -1]) {
      const dir = mul(ow.left, sgn);
      const origin = add(ow.centre, mul(dir, w.thickIn / 2 + 0.05));
      const hit = rayHit(origin, dir, obstacles.filter((x) => x.id !== w.id), 36);
      if (!hit || hit.dist >= 36) continue;
      out.push(mk("walkway_narrow", [o.id, hit.id], c.levelId, add(origin, mul(dir, hit.dist / 2)), `Only ${fmt(hit.dist)}" from the ${o.kind === "door" ? "door" : "opening"} to the facing obstruction — 36" walkway recommended.`));
    }
  }
  return out;
}

interface Swing {
  opening: Opening;
  hinge: Pt;
  /** Unit vector along the wall from hinge toward the other jamb (closed leaf). */
  closed: Pt;
  /** Unit vector into the room the door swings into (open leaf). */
  open: Pt;
  r: number;
}

function swingOf(o: Opening, w: Wall): Swing | null {
  if (o.kind !== "door" || NO_SWING_SUBTYPES.test(o.subtype)) return null;
  const ow = openingWorld(o, w);
  const hinge = o.hand === "L" ? ow.start : ow.end;
  const closed = o.hand === "L" ? ow.dir : mul(ow.dir, -1);
  const open = o.swing === "left" ? ow.left : mul(ow.left, -1);
  return { opening: o, hinge, closed, open, r: o.widthIn };
}

/** Point lies inside the quarter-circle swept by the leaf. */
function inSwing(s: Swing, p: Pt): boolean {
  const v = sub(p, s.hinge);
  const along = v.x * s.closed.x + v.y * s.closed.y;
  const into = v.x * s.open.x + v.y * s.open.y;
  return along >= -0.01 && into >= -0.01 && Math.hypot(along, into) <= s.r + 0.01;
}

function swingSamples(s: Swing): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = (Math.PI / 2) * (k / 8);
    const d = add(mul(s.closed, Math.cos(a)), mul(s.open, Math.sin(a)));
    pts.push(add(s.hinge, mul(d, s.r)));
    pts.push(add(s.hinge, mul(d, s.r / 2)));
  }
  return pts;
}

function checkDoorSwing(c: Ctx): Check[] {
  const out: Check[] = [];
  const swings = c.s.openings
    .filter(isActive)
    .map((o) => {
      const w = c.wallById.get(o.wallId);
      return w ? swingOf(o, w) : null;
    })
    .filter((s): s is Swing => !!s);
  // door into door
  for (let a = 0; a < swings.length; a++) {
    for (let b = a + 1; b < swings.length; b++) {
      const p = swings[a];
      const q = swings[b];
      if (dist(p.hinge, q.hinge) > p.r + q.r) continue;
      const clash = swingSamples(p).some((pt) => inSwing(q, pt)) || swingSamples(q).some((pt) => inSwing(p, pt));
      if (!clash) continue;
      out.push(mk("door_swing_conflict", [p.opening.id, q.opening.id], c.levelId, midPt(p.hinge, q.hinge), `Two door swings cross — rehand or reverse one door.`));
    }
  }
  // door into an appliance / base item
  const targets = c.s.items.filter((i) => isActive(i) && (i.kind === "appliance" || COUNTER_HEIGHT_KINDS.has(i.kind) || i.kind === "tall"));
  for (const s of swings) {
    for (const i of targets) {
      const corners = itemCorners(i);
      const hit =
        corners.some((pt) => inSwing(s, pt)) ||
        swingSamples(s).some((pt) => pointInItem(pt, i)) ||
        segPolyDist(s.hinge, add(s.hinge, mul(s.open, s.r)), corners) < 0.01;
      if (!hit) continue;
      out.push(mk("door_swing_conflict", [s.opening.id, i.id], c.levelId, centre(i), `Door swing hits ${itemName(i)}.`));
    }
  }
  return out;
}

function checkDwFarFromSink(c: Ctx): Check[] {
  const out: Check[] = [];
  const sinks = c.s.items.filter((i) => isActive(i) && isSink(i));
  if (!sinks.length) return out;
  for (const dw of c.s.items) {
    if (!isActive(dw) || !isDishwasher(dw)) continue;
    const foot = itemCorners(dw);
    let best: { sink: PlacedItem; d: number } | null = null;
    for (const s of sinks) {
      const d = polyPolyDist(foot, itemCorners(s));
      if (!best || d < best.d) best = { sink: s, d };
    }
    if (!best || best.d <= 36) continue;
    out.push(mk("dw_far_from_sink", [dw.id, best.sink.id], c.levelId, centre(dw), `Dishwasher is ${fmt(best.d)}" from the nearest sink — keep it within 36".`));
  }
  return out;
}

function checkLandingSpace(c: Ctx): Check[] {
  const out: Check[] = [];
  const bases = c.s.items.filter((i) => isActive(i) && COUNTER_HEIGHT_KINDS.has(i.kind));
  for (const i of c.s.items) {
    if (!isActive(i) || !(isRange(i) || isFridge(i) || isSink(i))) continue;
    const hasSide = (sgn: number) => {
      const near = localToWorld(i, sgn * (i.w / 2 + 1), 0);
      const far = localToWorld(i, sgn * (i.w / 2 + 14.5), 0);
      const others = bases.filter((b) => b.id !== i.id);
      return others.some((b) => pointInItem(near, b)) && others.some((b) => pointInItem(far, b));
    };
    if (hasSide(-1) || hasSide(1)) continue;
    out.push(mk("landing_space", [i.id], c.levelId, centre(i), `Less than 15" of counter beside ${itemName(i)} on both sides — allow landing space on at least one side.`));
  }
  return out;
}

function checkSeatingOverhang(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const i of c.s.items) {
    if (!isActive(i) || i.kind !== "island" || !i.props?.seating) continue;
    const counter = c.s.counters.find((ct) => (i.runId && ct.runId === i.runId) || pointInPolygon(centre(i), ct.polygon));
    if (!counter || counter.polygon.length < 3) continue;
    const overhangOn = (side: "front" | "back" | "left" | "right"): number => {
      const dir = side === "front" ? { x: 0, y: 1 } : side === "back" ? { x: 0, y: -1 } : side === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
      const half = side === "front" || side === "back" ? i.d / 2 : i.w / 2;
      let max = -Infinity;
      for (const p of counter.polygon) {
        const l = worldToLocal(i, p);
        max = Math.max(max, l.x * dir.x + l.y * dir.y);
      }
      return max - half;
    };
    const seat = i.props.seating;
    const sides: ("front" | "back" | "left" | "right")[] =
      seat === "front" || seat === "back" || seat === "left" || seat === "right" ? [seat] : ["front", "back", "left", "right"];
    const best = Math.max(...sides.map(overhangOn));
    if (best >= 12) continue;
    out.push(mk("seating_overhang", [i.id, counter.id], c.levelId, centre(i), `Seating side of ${itemName(i)} overhangs ${fmt(Math.max(0, best))}" — 12" needed for knee space.`));
  }
  return out;
}

function checkToiletClearance(c: Ctx): Check[] {
  const out: Check[] = [];
  const live = c.s.walls.filter((w) => w.kind !== "remove");
  for (const t of c.s.items) {
    if (!isActive(t) || !isToilet(t)) continue;
    const ctr = centre(t);
    // Walls: measure to the face, only when the face lies beside (not behind/in front of) the fixture.
    for (const w of live) {
      const pr = projectOnWall(w, ctr);
      const f = wallFrame(w);
      if (pr.t < -w.thickIn || pr.t > f.length + w.thickIn) continue;
      const faceDist = Math.abs(pr.side) - w.thickIn / 2;
      if (faceDist >= 15) continue;
      const foot = add(pr.foot, mul(f.left, Math.sign(pr.side || 1) * (w.thickIn / 2)));
      const l = worldToLocal(t, foot);
      if (Math.abs(l.x) <= Math.abs(l.y)) continue; // wall is behind or in front
      out.push(mk("toilet_clearance", [t.id, w.id], c.levelId, ctr, `Toilet centreline is ${fmt(Math.max(0, faceDist))}" from a wall — 15" minimum.`));
    }
    for (const o of c.s.items) {
      if (o.id === t.id || !isActive(o) || !(o.kind === "plumbing" || COUNTER_HEIGHT_KINDS.has(o.kind) || o.kind === "tall")) continue;
      const d = ptPolyDist(ctr, itemCorners(o));
      if (d >= 15) continue;
      const l = worldToLocal(t, centre(o));
      if (Math.abs(l.x) <= Math.abs(l.y)) continue;
      out.push(mk("toilet_clearance", [t.id, o.id], c.levelId, ctr, `Toilet centreline is ${fmt(d)}" from ${itemName(o)} — 15" minimum.`));
    }
  }
  return out;
}

function checkShowerSmall(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const i of c.s.items) {
    if (!isActive(i) || !isShower(i)) continue;
    if (i.w >= 30 && i.d >= 30) continue;
    out.push(mk("shower_small", [i.id], c.levelId, centre(i), `Shower is ${fmt(i.w)}×${fmt(i.d)} — 30×30 minimum.`));
  }
  return out;
}

// ─── Code ────────────────────────────────────────────────────────────────────

function roomWalls(c: Ctx, r: Room): Wall[] {
  if (r.wallIds.length) return r.wallIds.map((id) => c.wallById.get(id)).filter((w): w is Wall => !!w);
  if (r.polygon.length < 3) return [];
  return c.s.walls.filter((w) => ptPolyDist(midPt(w.a, w.b), r.polygon) <= w.thickIn);
}

function checkEgressWindow(c: Ctx): Check[] {
  const out: Check[] = [];
  for (const r of c.s.rooms) {
    if (!/bed/i.test(r.name)) continue;
    const wallIds = new Set(roomWalls(c, r).map((w) => w.id));
    const ok = c.s.openings.some((o) => o.kind === "window" && isActive(o) && wallIds.has(o.wallId) && (o.widthIn * o.heightIn) / 144 >= 5.7 && o.sillIn <= 44);
    if (ok) continue;
    const anchor = r.polygon.length ? polyCentre(r.polygon) : null;
    out.push(mk("egress_window", [r.id], c.levelId, anchor, `Check code: ${r.name} has no egress window (5.7 sf clear, sill ≤ 44").`));
  }
  return out;
}

function polyCentre(poly: Pt[]): Pt {
  const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return mul(s, 1 / poly.length);
}

function checkStairRiseRun(doc: PlanDoc): Check[] {
  const out: Check[] = [];
  for (const s of doc.stairs) {
    if (!isActive(s)) continue;
    const bad: string[] = [];
    if (s.riserIn > 7.75) bad.push(`rise ${fmt(s.riserIn)}" > 7¾"`);
    if (s.treadIn < 10) bad.push(`run ${fmt(s.treadIn)}" < 10"`);
    if (!bad.length) continue;
    out.push(mk("stair_rise_run", [s.id], s.fromLevelId, { x: s.x, y: s.y }, `Check code: stair ${bad.join(", ")}.`));
  }
  return out;
}

function checkHeadroom(doc: PlanDoc): Check[] {
  const out: Check[] = [];
  for (const s of doc.stairs) {
    if (!isActive(s)) continue;
    const from = doc.levels.find((l) => l.id === s.fromLevelId);
    const to = doc.levels.find((l) => l.id === s.toLevelId);
    if (!from || !to) continue;
    const rise = s.riserCount * s.riserIn;
    const levelDiff = Math.abs(to.elevationIn - from.elevationIn);
    if (levelDiff <= 0 || Math.abs(rise - levelDiff) <= 1) continue;
    out.push(mk("headroom", [s.id], s.fromLevelId, { x: s.x, y: s.y }, `Check code: stair rises ${fmt(rise)}" (${s.riserCount} × ${fmt(s.riserIn)}") but the levels are ${fmt(levelDiff)}" apart.`, "info"));
  }
  return out;
}

function checkGfciMissing(c: Ctx): Check[] {
  const out: Check[] = [];
  const gfci = c.s.electrical.filter((d) => d.type === "gfci" && isActive(d));
  for (const i of c.s.items) {
    if (!isActive(i) || !isWet(i)) continue;
    const ctr = centre(i);
    if (gfci.some((d) => dist(ctr, { x: d.x, y: d.y }) <= 72)) continue;
    out.push(mk("gfci_missing", [i.id], c.levelId, ctr, `Check code: no GFCI within 72" of ${itemName(i)}.`));
  }
  return out;
}

function checkOutletSpacing(c: Ctx): Check[] {
  const out: Check[] = [];
  const outlets = c.s.electrical.filter((d) => (d.type === "outlet" || d.type === "gfci") && isActive(d));
  for (const g of runsByWall(c, new Set<Tier>(["base"]))) {
    const cabs = g.slots.filter((s) => COUNTER_HEIGHT_KINDS.has(s.item.kind));
    if (!cabs.length) continue;
    const start = Math.min(...g.slots.map((s) => s.start));
    const end = Math.max(...g.slots.map((s) => s.end));
    if (end - start <= 48) continue;
    const ts = outlets
      .filter((d) => d.wallId === g.wall.id || Math.abs(projectOnWall(g.wall, { x: d.x, y: d.y }).side) <= 30)
      .map((d) => projectOnWall(g.wall, { x: d.x, y: d.y }).t)
      .filter((t) => t >= start - 6 && t <= end + 6)
      .sort((p, q) => p - q);
    const pts = [start, ...ts, end];
    let worst = 0;
    for (let k = 0; k + 1 < pts.length; k++) worst = Math.max(worst, pts[k + 1] - pts[k]);
    if (worst <= 48) continue;
    const f = wallFrame(g.wall);
    const anchor = add(g.wall.a, mul(f.dir, (start + end) / 2));
    const ids = g.slots.map((s) => s.item.id);
    out.push(mk("outlet_spacing", ids, c.levelId, anchor, ts.length ? `Check code: ${fmt(worst)}" stretch of counter with no outlet — one every 48".` : `Check code: ${fmt(end - start)}" counter run with no outlet — one every 48".`, "warn", g.wall.id));
  }
  return out;
}

function checkStairLight(doc: PlanDoc): Check[] {
  const out: Check[] = [];
  for (const s of doc.stairs) {
    if (!isActive(s)) continue;
    const p = { x: s.x, y: s.y };
    const lit = doc.electrical.some((d) => isActive(d) && LIGHT_TYPES.has(d.type) && (d.levelId === s.fromLevelId || d.levelId === s.toLevelId) && dist(p, { x: d.x, y: d.y }) <= 60);
    if (lit) continue;
    out.push(mk("stair_light", [s.id], s.fromLevelId, p, `Check code: no light within 60" of the stair.`));
  }
  return out;
}

function checkRange240(c: Ctx): Check[] {
  const out: Check[] = [];
  const o240 = c.s.electrical.filter((d) => d.type === "outlet240" && isActive(d));
  for (const r of c.s.items) {
    if (!isActive(r) || !isRange(r) || r.props?.power === "gas") continue;
    const ctr = centre(r);
    if (o240.some((d) => dist(ctr, { x: d.x, y: d.y }) <= 36)) continue;
    out.push(mk("range_240", [r.id], c.levelId, ctr, `Check code: electric ${itemName(r)} has no 240V outlet within 36".`));
  }
  return out;
}

function checkSmokeMissing(c: Ctx): Check[] {
  const bed = c.s.rooms.find((r) => /bed/i.test(r.name));
  if (!bed) return [];
  if (c.s.electrical.some((d) => d.type === "smoke" && isActive(d))) return [];
  const anchor = bed.polygon.length ? polyCentre(bed.polygon) : null;
  return [mk("smoke_missing", [bed.id], c.levelId, anchor, `Check code: bedroom on this level but no smoke detector.`, "warn", c.levelId)];
}

// ─── Estimate readiness ──────────────────────────────────────────────────────

function checkMeasureUnmapped(doc: PlanDoc, ctx: CheckContext): Check[] {
  if (!ctx.costRuleKeys) return [];
  const out: Check[] = [];
  const seen = new Set<string>();
  for (const m of computeMeasures(doc)) {
    if (seen.has(m.key) || ctx.costRuleKeys.has(m.key)) continue;
    seen.add(m.key);
    out.push(mk("measure_unmapped", [], null, null, `${m.label} (${m.key}) has no cost rule — it will come back as a checklist item, not a line.`, "info", m.key));
  }
  return out;
}

function checkItemNoPrice(doc: PlanDoc, ctx: CheckContext): Check[] {
  if (!ctx.catalogPrices) return [];
  const out: Check[] = [];
  for (const i of doc.items) {
    if (i.catalogId == null || (i.phase !== "new" && i.phase !== "relocate")) continue;
    const price = ctx.catalogPrices[i.catalogId];
    if (price != null) continue;
    out.push(mk("item_no_price", [i.id], i.levelId, centre(i), `${itemName(i)} is a catalog product with no price.`));
  }
  return out;
}

function checkGenericCabinet(doc: PlanDoc): Check[] {
  const out: Check[] = [];
  for (const i of doc.items) {
    if (!CABINET_KINDS.has(i.kind) || i.catalogId != null || (i.phase !== "new" && i.phase !== "relocate")) continue;
    out.push(mk("generic_cabinet", [i.id], i.levelId, centre(i), `${itemName(i)} has no product picked — estimate will carry an allowance.`, "info"));
  }
  return out;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export function runChecks(doc: PlanDoc, ctx?: CheckContext): Check[] {
  const out: Check[] = [];
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  for (const level of doc.levels) {
    const c: Ctx = { doc, levelId: level.id, s: levelSlice(doc, level.id), wallById };
    out.push(
      ...checkRoomUnclosed(c),
      ...checkWallsOverlap(c),
      ...checkOpeningTooWide(c),
      ...checkItemInWall(c),
      ...checkItemsOverlap(c),
      ...checkRunGap(c),
      ...checkSeamOverSink(c),
      ...checkHoodClearance(c),
      ...checkAisleNarrow(c),
      ...checkWalkwayNarrow(c),
      ...checkDoorSwing(c),
      ...checkDwFarFromSink(c),
      ...checkLandingSpace(c),
      ...checkSeatingOverhang(c),
      ...checkToiletClearance(c),
      ...checkShowerSmall(c),
      ...checkEgressWindow(c),
      ...checkGfciMissing(c),
      ...checkOutletSpacing(c),
      ...checkRange240(c),
      ...checkSmokeMissing(c),
    );
  }
  out.push(...checkStairRiseRun(doc), ...checkHeadroom(doc), ...checkStairLight(doc));
  if (ctx) out.push(...checkMeasureUnmapped(doc, ctx), ...checkItemNoPrice(doc, ctx), ...checkGenericCabinet(doc));
  const ignored = new Set(doc.ignoredChecks ?? []);
  const seen = new Set<string>();
  return out.filter((c) => {
    if (ignored.has(c.id) || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
