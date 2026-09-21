// Pure plan geometry: wall vectors, faces, corner mitring, snapping, wall
// split/join, opening placement, and room detection from closed wall loops.
// Client-safe; no React, no db. Everything is in inches, plan space (y down).

import {
  dist,
  newId,
  polygonArea,
  polygonPerimeter,
  pointInPolygon,
  type Opening,
  type PlanDoc,
  type Pt,
  type Room,
  type Wall,
} from "./plan-doc.ts";

export const EPS = 0.01;

// ─── Vectors ─────────────────────────────────────────────────────────────────

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const norm = (a: Pt): Pt => {
  const l = len(a);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Perpendicular pointing to the LEFT of direction d (y-down space: left of
 *  +x is -y). */
export const perp = (d: Pt): Pt => ({ x: d.y, y: -d.x });
export const samePt = (a: Pt, b: Pt, eps = EPS): boolean => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
export const midPt = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const round = (n: number, step = 1): number => (step > 0 ? Math.round(n / step) * step : n);
export const roundPt = (p: Pt, step = 1): Pt => ({ x: round(p.x, step), y: round(p.y, step) });
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

/** Rotate a point about an origin (degrees, clockwise on screen). */
export function rotatePt(p: Pt, origin: Pt, deg: number): Pt {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

// ─── Wall frame ──────────────────────────────────────────────────────────────

export interface WallFrame {
  dir: Pt;
  /** Unit normal pointing to the wall's LEFT face (walking a → b). */
  left: Pt;
  length: number;
  angleDeg: number;
}

export function wallFrame(w: Pick<Wall, "a" | "b">): WallFrame {
  const d = norm(sub(w.b, w.a));
  const left = { x: d.y, y: -d.x };
  return { dir: d, left, length: dist(w.a, w.b), angleDeg: radToDeg(Math.atan2(d.y, d.x)) };
}

/** Point on the wall centreline at distance t (inches) from a. */
export function alongWall(w: Pick<Wall, "a" | "b">, t: number): Pt {
  const { dir } = wallFrame(w);
  return add(w.a, mul(dir, t));
}

/** Project p onto the wall's centreline. Returns distance from a (unclamped),
 *  signed side distance (positive = left face side), and the foot point. */
export function projectOnWall(w: Pick<Wall, "a" | "b">, p: Pt): { t: number; side: number; foot: Pt } {
  const f = wallFrame(w);
  const v = sub(p, w.a);
  const t = dot(v, f.dir);
  const side = dot(v, f.left);
  return { t, side, foot: add(w.a, mul(f.dir, t)) };
}

/** Distance from a point to the wall's centreline segment. */
export function distToWall(w: Pick<Wall, "a" | "b">, p: Pt): number {
  const f = wallFrame(w);
  const { t, foot } = projectOnWall(w, p);
  if (t <= 0) return dist(p, w.a);
  if (t >= f.length) return dist(p, w.b);
  return dist(p, foot);
}

/** The four face corners of a wall as a polygon (a-left, b-left, b-right,
 *  a-right), with corners mitred against connected walls so joints are clean.
 *  Only same-endpoint joints are mitred; T-junctions overlap, which is fine
 *  for fills. */
export function wallPolygon(w: Wall, all: Wall[]): Pt[] {
  const f = wallFrame(w);
  const h = w.thickIn / 2;
  const aL = add(w.a, mul(f.left, h));
  const aR = add(w.a, mul(f.left, -h));
  const bL = add(w.b, mul(f.left, h));
  const bR = add(w.b, mul(f.left, -h));

  const mitre = (end: "a" | "b", pt: Pt, offsetLeft: Pt, offsetRight: Pt): [Pt, Pt] => {
    // Find one other wall sharing this endpoint (the common case: a corner).
    const others = all.filter(
      (o) => o.id !== w.id && o.levelId === w.levelId && (samePt(o.a, pt, 0.5) || samePt(o.b, pt, 0.5)),
    );
    if (others.length !== 1) return [offsetLeft, offsetRight];
    const o = others[0];
    // Orient the other wall so it also starts at pt.
    const ow: Pick<Wall, "a" | "b"> = samePt(o.a, pt, 0.5) ? { a: o.a, b: o.b } : { a: o.b, b: o.a };
    const tw: Pick<Wall, "a" | "b"> = end === "a" ? { a: w.a, b: w.b } : { a: w.b, b: w.a };
    const fo = wallFrame(ow);
    const ft = wallFrame(tw);
    const c = cross(ft.dir, fo.dir);
    if (Math.abs(c) < 0.05) return [offsetLeft, offsetRight]; // collinear – no mitre
    const oh = o.thickIn / 2;
    // Each of our face lines meets the corresponding face line of the other wall.
    const hit = (ourOff: Pt, theirOff: Pt): Pt | null =>
      lineIntersect(add(pt, ourOff), ft.dir, add(pt, theirOff), fo.dir);
    // Our left/right relative to the oriented tw; map to the offsets given.
    const ourLeft = mul(ft.left, h);
    const ourRight = mul(ft.left, -h);
    const theirLeft = mul(fo.left, oh);
    const theirRight = mul(fo.left, -oh);
    // At a corner the interior wedge lies on tw's left and ow's right (or the
    // reverse), so this wall's LEFT face always meets the other's RIGHT face
    // and vice versa. Very acute joints (mitre far from the corner) fall back
    // to the plain square end.
    const limit = Math.max(w.thickIn, o.thickIn) * 4;
    const pickHit = (ours: Pt, theirs: Pt): Pt => {
      const p = hit(ours, theirs);
      return p && dist(p, pt) < limit ? p : add(pt, ours);
    };
    const L = pickHit(ourLeft, theirRight);
    const R = pickHit(ourRight, theirLeft);
    // For end "a" the tw frame equals w's frame; for "b" it is reversed, so
    // left/right swap.
    return end === "a" ? [L, R] : [R, L];
  };

  const [a1, a2] = mitre("a", w.a, aL, aR);
  const [b1, b2] = mitre("b", w.b, bL, bR);
  return [a1, b1, b2, a2];
}

/** Intersection of two infinite lines given point + direction. */
export function lineIntersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}

/** Segment intersection (inclusive). */
export function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return add(a, mul(r, t));
}

// ─── Openings ────────────────────────────────────────────────────────────────

export interface OpeningWorld {
  start: Pt;
  end: Pt;
  centre: Pt;
  dir: Pt;
  left: Pt;
}

export function openingWorld(o: Opening, w: Wall): OpeningWorld {
  const f = wallFrame(w);
  const start = alongWall(w, o.atIn);
  const end = alongWall(w, o.atIn + o.widthIn);
  return { start, end, centre: midPt(start, end), dir: f.dir, left: f.left };
}

/** Clamp an opening's start so it stays inside the wall. */
export function clampOpening(o: Opening, w: Wall): number {
  const L = dist(w.a, w.b);
  return Math.max(0, Math.min(L - o.widthIn, o.atIn));
}

/** Wall segments that remain solid once openings are cut (used by 3D and
 *  elevations). Returns [t0, t1] ranges along the wall. */
export function solidSegments(w: Wall, openings: Opening[]): [number, number][] {
  const L = dist(w.a, w.b);
  const cuts = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => [Math.max(0, o.atIn), Math.min(L, o.atIn + o.widthIn)] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let t = 0;
  for (const [s, e] of cuts) {
    if (s > t + EPS) out.push([t, s]);
    t = Math.max(t, e);
  }
  if (t < L - EPS) out.push([t, L]);
  return out;
}

// ─── Snapping ────────────────────────────────────────────────────────────────

export interface SnapOptions {
  gridIn: number;
  angleDeg: 0 | 15 | 45 | 90;
  endpoints: boolean;
  faces: boolean;
  midpoints: boolean;
  /** Snap radius in plan inches (scale with zoom on the caller side). */
  radiusIn: number;
}

export interface SnapResult {
  pt: Pt;
  kind: "endpoint" | "midpoint" | "face" | "grid" | "angle" | "free";
  wallId?: string;
  guide?: { a: Pt; b: Pt };
}

/** Snap a cursor point against walls, then grid. `anchor` (the previous
 *  polyline point) enables angle snapping. */
export function snapPoint(p: Pt, walls: Wall[], opts: SnapOptions, anchor?: Pt | null): SnapResult {
  let best: { cand: SnapResult; d: number; tier: number } | null = null;
  const consider = (cand: SnapResult, d: number, tier: number) => {
    if (d > opts.radiusIn) return;
    // Lower tier wins outright (endpoint > midpoint > face); distance breaks ties.
    if (!best || tier < best.tier || (tier === best.tier && d < best.d)) best = { cand, d, tier };
  };
  for (const w of walls) {
    if (opts.endpoints) {
      consider({ pt: w.a, kind: "endpoint", wallId: w.id }, dist(p, w.a), 0);
      consider({ pt: w.b, kind: "endpoint", wallId: w.id }, dist(p, w.b), 0);
    }
    if (opts.midpoints) {
      const m = midPt(w.a, w.b);
      consider({ pt: m, kind: "midpoint", wallId: w.id }, dist(p, m), 1);
    }
    if (opts.faces) {
      const pr = projectOnWall(w, p);
      if (pr.t >= 0 && pr.t <= wallFrame(w).length) {
        const f = wallFrame(w);
        for (const s of [1, -1]) {
          const face = add(pr.foot, mul(f.left, (s * w.thickIn) / 2));
          consider({ pt: face, kind: "face", wallId: w.id, guide: { a: w.a, b: w.b } }, dist(p, face), 2);
        }
        consider({ pt: pr.foot, kind: "face", wallId: w.id, guide: { a: w.a, b: w.b } }, dist(p, pr.foot), 3);
      }
    }
  }
  if (best) return (best as { cand: SnapResult }).cand;
  // Angle snap relative to anchor.
  if (anchor && opts.angleDeg) {
    const v = sub(p, anchor);
    const L = len(v);
    if (L > EPS) {
      const ang = radToDeg(Math.atan2(v.y, v.x));
      const snapped = Math.round(ang / opts.angleDeg) * opts.angleDeg;
      const d = { x: Math.cos(degToRad(snapped)), y: Math.sin(degToRad(snapped)) };
      const Ls = opts.gridIn > 0 ? round(L, opts.gridIn) : L;
      const pt = add(anchor, mul(d, Ls));
      return { pt, kind: "angle", guide: { a: anchor, b: pt } };
    }
  }
  if (opts.gridIn > 0) return { pt: roundPt(p, opts.gridIn), kind: "grid" };
  return { pt: p, kind: "free" };
}

/** Alignment guides: other wall endpoints sharing x or y with p (within tol). */
export function alignmentGuides(p: Pt, walls: Wall[], tolIn: number): { pt: Pt; axis: "x" | "y"; from: Pt }[] {
  const out: { pt: Pt; axis: "x" | "y"; from: Pt }[] = [];
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      if (Math.abs(e.x - p.x) < tolIn) out.push({ pt: { x: e.x, y: p.y }, axis: "x", from: e });
      if (Math.abs(e.y - p.y) < tolIn) out.push({ pt: { x: p.x, y: e.y }, axis: "y", from: e });
    }
  }
  return out;
}

/** Nearest wall to a point on a level, with the projection. */
export function nearestWall(p: Pt, walls: Wall[], maxIn = Infinity): { wall: Wall; d: number; t: number; side: number } | null {
  let best: { wall: Wall; d: number; t: number; side: number } | null = null;
  for (const w of walls) {
    const d = distToWall(w, p);
    if (d <= maxIn && (!best || d < best.d)) {
      const pr = projectOnWall(w, p);
      best = { wall: w, d, t: pr.t, side: pr.side };
    }
  }
  return best;
}

// ─── Wall edits ──────────────────────────────────────────────────────────────

/** Split a wall at distance t from a. Openings are re-homed to whichever half
 *  they fall in. Returns the new doc (or the same doc if t is at an end). */
export function splitWall(doc: PlanDoc, wallId: string, t: number): PlanDoc {
  const w = doc.walls.find((x) => x.id === wallId);
  if (!w) return doc;
  const L = dist(w.a, w.b);
  if (t <= EPS || t >= L - EPS) return doc;
  const p = alongWall(w, t);
  const first: Wall = { ...w, b: p };
  const second: Wall = { ...w, id: newId("w"), a: p };
  const openings = doc.openings.map((o) => {
    if (o.wallId !== w.id) return o;
    return o.atIn + o.widthIn / 2 < t ? o : { ...o, wallId: second.id, atIn: o.atIn - t };
  });
  const walls = doc.walls.flatMap((x) => (x.id === w.id ? [first, second] : [x]));
  return { ...doc, walls, openings };
}

/** Join two collinear walls sharing an endpoint into one. */
export function joinWalls(doc: PlanDoc, idA: string, idB: string): PlanDoc {
  const a = doc.walls.find((w) => w.id === idA);
  const b = doc.walls.find((w) => w.id === idB);
  if (!a || !b || a.levelId !== b.levelId) return doc;
  const fa = wallFrame(a);
  const fb = wallFrame(b);
  if (Math.abs(cross(fa.dir, fb.dir)) > 0.02) return doc;
  let start: Pt;
  let end: Pt;
  let bReversed = false;
  if (samePt(a.b, b.a, 0.5)) { start = a.a; end = b.b; }
  else if (samePt(a.b, b.b, 0.5)) { start = a.a; end = b.a; bReversed = true; }
  else if (samePt(a.a, b.b, 0.5)) { start = b.a; end = a.b; return joinWalls(doc, idB, idA); }
  else if (samePt(a.a, b.a, 0.5)) { start = b.b; end = a.b; return joinWalls(doc, idB, idA); }
  else return doc;
  const merged: Wall = { ...a, a: start, b: end };
  const La = fa.length;
  const Lb = fb.length;
  const openings = doc.openings.map((o) => {
    if (o.wallId !== b.id) return o;
    const at = bReversed ? Lb - o.atIn - o.widthIn : o.atIn;
    return { ...o, wallId: a.id, atIn: La + at };
  });
  return { ...doc, walls: doc.walls.filter((w) => w.id !== b.id).map((w) => (w.id === a.id ? merged : w)), openings };
}

/** Move a wall endpoint, dragging every other wall endpoint that shares it. */
export function moveCorner(doc: PlanDoc, levelId: string, from: Pt, to: Pt): PlanDoc {
  const walls = doc.walls.map((w) => {
    if (w.levelId !== levelId) return w;
    const na = samePt(w.a, from, 0.5) ? to : w.a;
    const nb = samePt(w.b, from, 0.5) ? to : w.b;
    return na === w.a && nb === w.b ? w : { ...w, a: na, b: nb };
  });
  return { ...doc, walls };
}

/** Four walls from a rectangle (clockwise), sharing corners. */
export function rectWalls(levelId: string, p: Pt, q: Pt, thickIn: number, heightIn: number, kind: Wall["kind"]): Wall[] {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  const c = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return c.map((a, i) => ({ id: newId("w"), levelId, a, b: c[(i + 1) % 4], thickIn, heightIn, kind }));
}

// ─── Room detection ──────────────────────────────────────────────────────────

interface Node { id: number; p: Pt; edges: number[] }
interface Edge { id: number; wallId: string; n0: number; n1: number }

/** Detect enclosed rooms from wall centrelines on a level. Splits walls at
 *  crossings, builds a planar graph, and walks faces; the outer (unbounded)
 *  face is dropped. Existing rooms with `pinned` keep their name/finishes when
 *  their centroid still falls inside a detected polygon. */
export function detectRooms(doc: PlanDoc, levelId: string): Room[] {
  const walls = doc.walls.filter((w) => w.levelId === levelId && w.kind !== "remove");
  if (walls.length < 3) return [];

  // 1. Split walls at mutual intersections into primitive segments.
  type Seg = { a: Pt; b: Pt; wallId: string };
  const segs: Seg[] = [];
  for (const w of walls) {
    const ts = new Set<number>([0, 1]);
    for (const o of walls) {
      if (o.id === w.id) continue;
      const hit = segIntersect(w.a, w.b, o.a, o.b);
      if (hit) {
        const L = dist(w.a, w.b);
        if (L > EPS) ts.add(Math.max(0, Math.min(1, dist(w.a, hit) / L)));
      }
    }
    const sorted = [...ts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = add(w.a, mul(sub(w.b, w.a), sorted[i]));
      const b = add(w.a, mul(sub(w.b, w.a), sorted[i + 1]));
      if (dist(a, b) > 0.5) segs.push({ a, b, wallId: w.id });
    }
  }

  // 2. Nodes (merged within 0.5") and half-edges.
  const nodes: Node[] = [];
  const nodeAt = (p: Pt): number => {
    const found = nodes.find((n) => samePt(n.p, p, 0.5));
    if (found) return found.id;
    const n = { id: nodes.length, p, edges: [] as number[] };
    nodes.push(n);
    return n.id;
  };
  const edges: Edge[] = [];
  for (const s of segs) {
    const n0 = nodeAt(s.a);
    const n1 = nodeAt(s.b);
    if (n0 === n1) continue;
    const e = { id: edges.length, wallId: s.wallId, n0, n1 };
    edges.push(e);
    nodes[n0].edges.push(e.id);
    nodes[n1].edges.push(e.id);
  }
  // Prune dangling edges (dead-end walls can't bound a room).
  let pruned = true;
  const alive = new Set(edges.map((e) => e.id));
  while (pruned) {
    pruned = false;
    for (const n of nodes) {
      const live = n.edges.filter((id) => alive.has(id));
      if (live.length === 1) {
        alive.delete(live[0]);
        pruned = true;
      }
    }
  }

  // 3. Face walk: for each directed half-edge not yet used, turn left-most.
  const used = new Set<string>();
  const angle = (from: number, to: number) => {
    const d = sub(nodes[to].p, nodes[from].p);
    return Math.atan2(d.y, d.x);
  };
  const faces: { poly: Pt[]; wallIds: string[] }[] = [];
  for (const e of edges) {
    if (!alive.has(e.id)) continue;
    for (const [s, t] of [[e.n0, e.n1], [e.n1, e.n0]] as [number, number][]) {
      const key = `${s}>${t}`;
      if (used.has(key)) continue;
      const poly: Pt[] = [];
      const wallIds: string[] = [];
      let cur = s;
      let nxt = t;
      let guard = 0;
      let ok = true;
      while (guard++ < 2000) {
        used.add(`${cur}>${nxt}`);
        poly.push(nodes[cur].p);
        const ed = edges.find((x) => alive.has(x.id) && ((x.n0 === cur && x.n1 === nxt) || (x.n1 === cur && x.n0 === nxt)));
        if (ed) wallIds.push(ed.wallId);
        // At nxt, pick the outgoing edge with the smallest clockwise turn
        // (i.e. the most counter-clockwise relative to the incoming direction).
        const inAng = angle(nxt, cur); // direction back to where we came from
        const cands = nodes[nxt].edges
          .filter((id) => alive.has(id))
          .map((id) => {
            const x = edges[id];
            return x.n0 === nxt ? x.n1 : x.n0;
          })
          .filter((n) => n !== cur || nodes[nxt].edges.filter((id) => alive.has(id)).length === 1);
        if (!cands.length) { ok = false; break; }
        let bestN = cands[0];
        let bestA = Infinity;
        for (const n of cands) {
          let a = angle(nxt, n) - inAng;
          while (a <= 0) a += Math.PI * 2;
          while (a > Math.PI * 2) a -= Math.PI * 2;
          if (a < bestA) { bestA = a; bestN = n; }
        }
        cur = nxt;
        nxt = bestN;
        if (cur === s && nxt === t) break;
      }
      if (!ok || poly.length < 3) continue;
      faces.push({ poly, wallIds: [...new Set(wallIds)] });
    }
  }

  // 4. Keep bounded faces. In y-down space with the left-most turn rule the
  //    inner faces come out with negative signed area; the outer face is the
  //    one with the largest |area| and opposite sign. Be robust: drop the
  //    single largest-|area| face when more than one face exists.
  const withArea = faces
    .map((f) => ({ ...f, area: polygonArea(f.poly) }))
    .filter((f) => Math.abs(f.area) > 144); // ≥ 1 sf
  if (!withArea.length) return [];
  let bounded = withArea;
  if (withArea.length > 1) {
    const maxAbs = Math.max(...withArea.map((f) => Math.abs(f.area)));
    // The outer face bounds all others; remove it only if some inner face is
    // contained by it.
    const outer = withArea.find((f) => Math.abs(f.area) === maxAbs)!;
    const containsOther = withArea.some((f) => f !== outer && pointInPolygon(centroid(f.poly), outer.poly));
    if (containsOther) bounded = withArea.filter((f) => f !== outer);
  } else {
    // A single closed loop yields two faces normally; one face means a lone
    // polygon — keep it.
    bounded = withArea;
  }
  // Dedupe faces that are the same polygon walked in both directions.
  const seen: Pt[][] = [];
  bounded = bounded.filter((f) => {
    const c = centroid(f.poly);
    const dup = seen.some((p) => Math.abs(Math.abs(polygonArea(p)) - Math.abs(f.area)) < 1 && pointInPolygon(c, p));
    if (dup) return false;
    seen.push(f.poly);
    return true;
  });

  // 5. Build rooms, carrying over pinned data by centroid containment.
  const prev = doc.rooms.filter((r) => r.levelId === levelId);
  const level = doc.levels.find((l) => l.id === levelId);
  return bounded.map((f, i) => {
    const c = centroid(f.poly);
    const old = prev.find((r) => pointInPolygon(c, r.polygon)) ?? prev.find((r) => pointInPolygon(centroid(r.polygon), f.poly));
    return {
      id: old?.id ?? newId("r"),
      levelId,
      name: old?.name ?? `Room ${i + 1}`,
      polygon: f.poly,
      areaSf: Math.abs(f.area) / 144,
      perimLf: polygonPerimeter(f.poly) / 12,
      ceilingIn: old?.ceilingIn ?? level?.ceilingIn ?? null,
      floor: old?.floor ?? null,
      ceiling: old?.ceiling ?? null,
      trim: old?.trim ?? null,
      wallIds: f.wallIds,
      pinned: old?.pinned,
    };
  });
}

export function centroid(poly: Pt[]): Pt {
  if (!poly.length) return { x: 0, y: 0 };
  const A = polygonArea(poly);
  if (Math.abs(A) < 1e-6) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / poly.length);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Recompute rooms for every level and return the updated doc. */
export function withRooms(doc: PlanDoc): PlanDoc {
  const rooms: Room[] = [];
  for (const l of doc.levels) rooms.push(...detectRooms(doc, l.id));
  return { ...doc, rooms };
}

/** Bounding box of a level's walls and items (for fit-to-view and printing). */
export function levelBounds(doc: PlanDoc, levelId: string): { min: Pt; max: Pt } | null {
  const pts: Pt[] = [];
  for (const w of doc.walls) if (w.levelId === levelId) pts.push(w.a, w.b);
  for (const i of doc.items) if (i.levelId === levelId) pts.push(...itemCorners(i));
  for (const n of doc.notes) if (n.levelId === levelId) pts.push({ x: n.x, y: n.y });
  if (!pts.length) return null;
  const min = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) };
  const max = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) };
  return { min, max };
}

/** Footprint corners of a placed item in plan space (rotated rectangle). */
export function itemCorners(i: { x: number; y: number; w: number; d: number; rotDeg: number }): Pt[] {
  const c = { x: i.x, y: i.y };
  const hw = i.w / 2;
  const hd = i.d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => rotatePt(add(c, p), c, i.rotDeg));
}

/** Convex rectangle overlap via separating axis (both are rotated rects). */
export function rectsOverlap(a: Pt[], b: Pt[]): boolean {
  const axes = (poly: Pt[]) =>
    poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const e = sub(q, p);
      return norm({ x: -e.y, y: e.x });
    });
  for (const ax of [...axes(a), ...axes(b)]) {
    const pa = a.map((p) => dot(p, ax));
    const pb = b.map((p) => dot(p, ax));
    if (Math.max(...pa) < Math.min(...pb) + EPS || Math.max(...pb) < Math.min(...pa) + EPS) return false;
  }
  return true;
}

/** Point hit-test for an item footprint. */
export function pointInItem(p: Pt, i: { x: number; y: number; w: number; d: number; rotDeg: number }): boolean {
  const local = rotatePt(p, { x: i.x, y: i.y }, -i.rotDeg);
  return Math.abs(local.x - i.x) <= i.w / 2 && Math.abs(local.y - i.y) <= i.d / 2;
}
