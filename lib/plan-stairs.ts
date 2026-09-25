// Stair geometry shared by the plan drawing, the 3D model, hit-testing and
// the stairwell cut in the floor above. One source so the three can't drift.
//
// Local frame (before the stair's rotation): +y is the front, where you step
// on; the first flight climbs toward −y. Width runs along x. The stair's
// (x, y) is the centre of its footprint's bounding box, as for a straight
// run. An L turns a quarter at a square landing; a U turns back at a landing
// that spans both flights (with a small well between them). Treads count
// riserCount − 1 levels (the last riser lands on the floor above); on an L/U
// the landing takes one of those levels.

import { pointInPolygon, type Pt, type Stair } from "./plan-doc.ts";
import { rotatePt } from "./plan-geometry.ts";

/** A tread or landing: an axis-aligned rectangle in the local frame whose top
 *  is `level` risers above the stair's floor. */
export interface StairPiece {
  kind: "tread" | "landing";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  level: number;
}

export interface StairLayout {
  /** Shape actually drawn (an L/U with too few treads falls back to straight). */
  shape: Stair["shape"];
  pieces: StairPiece[];
  /** Outline of the stair (local frame). */
  footprint: Pt[];
  /** Walking line from the bottom step to the top (local frame). */
  path: Pt[];
  /** Treads in the first / second flight. */
  flights: [number, number];
}

const DEFAULT_WELL_IN = 2;

/** Treads (levels) the stair has: riserCount − 1, at least 1. */
export function stairTreads(s: Pick<Stair, "riserCount">): number {
  return Math.max(1, Math.round(s.riserCount) - 1);
}

export function stairLayout(s: Stair): StairLayout {
  const t = s.treadIn;
  const w = s.widthIn;
  const T = stairTreads(s);
  const turned = (s.shape === "L" || s.shape === "U") && T >= 3;
  const shape: Stair["shape"] = turned ? s.shape : "straight";
  const pieces: StairPiece[] = [];
  let footprint: Pt[];
  let path: Pt[];
  let flights: [number, number];

  if (!turned) {
    for (let i = 0; i < T; i++) pieces.push({ kind: "tread", x0: 0, x1: w, y0: -(i + 1) * t, y1: -i * t, level: i + 1 });
    footprint = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: -T * t },
      { x: 0, y: -T * t },
    ];
    path = [
      { x: w / 2, y: 0 },
      { x: w / 2, y: -T * t },
    ];
    flights = [T, 0];
  } else {
    // Treads before the landing (default: split as evenly as the count allows).
    const n1 = Math.max(1, Math.min(T - 2, Math.round(s.landingAt ?? Math.floor((T - 1) / 2))));
    const n2 = T - 1 - n1;
    const L1 = n1 * t;
    flights = [n1, n2];
    for (let i = 0; i < n1; i++) pieces.push({ kind: "tread", x0: 0, x1: w, y0: -(i + 1) * t, y1: -i * t, level: i + 1 });
    if (shape === "L") {
      pieces.push({ kind: "landing", x0: 0, x1: w, y0: -L1 - w, y1: -L1, level: n1 + 1 });
      for (let j = 0; j < n2; j++) pieces.push({ kind: "tread", x0: w + j * t, x1: w + (j + 1) * t, y0: -L1 - w, y1: -L1, level: n1 + 2 + j });
      footprint = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: -L1 },
        { x: w + n2 * t, y: -L1 },
        { x: w + n2 * t, y: -L1 - w },
        { x: 0, y: -L1 - w },
      ];
      path = [
        { x: w / 2, y: 0 },
        { x: w / 2, y: -L1 - w / 2 },
        { x: w + n2 * t, y: -L1 - w / 2 },
      ];
    } else {
      const g = Math.max(0, s.wellIn ?? DEFAULT_WELL_IN);
      const x2 = w + g;
      pieces.push({ kind: "landing", x0: 0, x1: x2 + w, y0: -L1 - w, y1: -L1, level: n1 + 1 });
      for (let j = 0; j < n2; j++) pieces.push({ kind: "tread", x0: x2, x1: x2 + w, y0: -L1 + j * t, y1: -L1 + (j + 1) * t, level: n1 + 2 + j });
      const bottom = Math.max(0, -L1 + n2 * t);
      footprint = [
        { x: 0, y: bottom },
        { x: x2 + w, y: bottom },
        { x: x2 + w, y: -L1 - w },
        { x: 0, y: -L1 - w },
      ];
      path = [
        { x: w / 2, y: 0 },
        { x: w / 2, y: -L1 - w / 2 },
        { x: x2 + w / 2, y: -L1 - w / 2 },
        { x: x2 + w / 2, y: -L1 + n2 * t },
      ];
    }
    // Turning left mirrors the second flight to the other side.
    if (s.turn === "left") {
      const mx = (x: number) => w - x;
      for (const p of pieces) [p.x0, p.x1] = [mx(p.x1), mx(p.x0)];
      footprint = footprint.map((p) => ({ x: mx(p.x), y: p.y })).reverse();
      path = path.map((p) => ({ x: mx(p.x), y: p.y }));
    }
  }

  // Centre the footprint's bounding box on the origin.
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const sh = (p: Pt): Pt => ({ x: p.x - cx, y: p.y - cy });
  return {
    shape,
    pieces: pieces.map((p) => ({ ...p, x0: p.x0 - cx, x1: p.x1 - cx, y0: p.y0 - cy, y1: p.y1 - cy })),
    footprint: footprint.map(sh),
    path: path.map(sh),
    flights,
  };
}

/** Local stair point → plan point. */
export function stairToPlan(s: Pick<Stair, "x" | "y" | "rotDeg">, p: Pt): Pt {
  return rotatePt({ x: s.x + p.x, y: s.y + p.y }, { x: s.x, y: s.y }, s.rotDeg);
}

/** The stair's outline in plan coordinates (hit-testing, the stairwell). */
export function stairFootprint(s: Stair): Pt[] {
  return stairLayout(s).footprint.map((p) => stairToPlan(s, p));
}

export function pointInStair(s: Stair, p: Pt): boolean {
  return pointInPolygon(p, stairFootprint(s));
}

/** Walking-line length of the treads + landing, for takeoffs. */
export function stairRunIn(s: Stair): number {
  const l = stairLayout(s);
  let len = 0;
  for (let i = 1; i < l.path.length; i++) len += Math.hypot(l.path[i].x - l.path[i - 1].x, l.path[i].y - l.path[i - 1].y);
  return len;
}
