import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, MAIN_LEVEL_ID, DEFAULTS, polygonArea } from "../lib/plan-doc.ts";
import { rectWalls, itemCorners } from "../lib/plan-geometry.ts";
import {
  TIER_Z,
  TIER_H,
  tierOf,
  rotationFacing,
  placeAgainstWall,
  snapToNeighbors,
  rebuildRuns,
  runExtent,
  suggestFillers,
  cornerSuggestions,
  generateCounters,
  alignWallCabinets,
  runTotals,
  placeRunAlongWall,
  itemCollisions,
  wallCabZ,
} from "../lib/plan-runs.ts";

const L = MAIN_LEVEL_ID;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);

/** 12' × 10' room, walls clockwise from (0,0): top, right, bottom, left. */
const room = () => {
  const doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  return doc;
};
const [TOP, RIGHT, BOTTOM, LEFT] = [0, 1, 2, 3];

let n = 0;
const box = (over = {}) => ({
  id: `it${++n}`,
  levelId: L,
  kind: "base",
  catalogId: null,
  libraryKey: "B36",
  label: "Base 36",
  tag: "B36",
  x: 0,
  y: 0,
  z: 0,
  rotDeg: 0,
  w: 36,
  d: 24,
  h: 34.5,
  phase: "new",
  wallId: null,
  runId: null,
  props: {},
  ...over,
});
const spec = (w, over = {}) => ({
  w, d: 24, h: 34.5, z: 0, kind: "base", label: `Base ${w}`, tag: `B${w}`, libraryKey: `B${w}`, catalogId: null, props: {}, ...over,
});

const opts = {
  overhangIn: 1.5,
  seatingOverhangIn: 12,
  thickIn: 1.25,
  backsplashIn: 18,
  material: { key: "quartz-white", label: "Quartz white", color: "#eee" },
  edge: "eased",
};

test("tier tables and tierOf", () => {
  assert.equal(TIER_Z.base, 0);
  assert.equal(TIER_Z.wall, 54);
  assert.equal(TIER_H.base, 34.5);
  assert.equal(TIER_H.vanity, 34.5);
  assert.equal(tierOf({ kind: "vanity" }), "base");
  assert.equal(tierOf({ kind: "island" }), "base");
  assert.equal(tierOf({ kind: "wall" }), "wall");
  assert.equal(tierOf({ kind: "tall" }), "tall");
  assert.equal(tierOf({ kind: "appliance" }), null);
  assert.equal(wallCabZ(DEFAULTS), 54);
});

test("rotationFacing: back points into the wall, front along the normal", () => {
  assert.equal(rotationFacing({ x: 0, y: 1 }), 0); // wall along +x, room below
  assert.equal(rotationFacing({ x: 0, y: -1 }), 180); // room above
  assert.equal(rotationFacing({ x: 1, y: 0 }), 270); // wall along +y, room to the right
  assert.equal(rotationFacing({ x: -1, y: 0 }), 90); // room to the left
  // Generic: the rotated back edge midpoint must lie opposite the normal.
  for (const deg of [0, 30, 45, 90, 135, 180, 225, 270, 315]) {
    const r = (deg * Math.PI) / 180;
    const nrm = { x: Math.cos(r), y: Math.sin(r) };
    const rot = rotationFacing(nrm);
    const c = itemCorners({ x: 0, y: 0, w: 10, d: 4, rotDeg: rot });
    const backMid = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
    near(backMid.x, -2 * nrm.x, 1e-9);
    near(backMid.y, -2 * nrm.y, 1e-9);
  }
});

test("placeAgainstWall: back flush on the top wall's inner face, rotDeg 0", () => {
  const doc = room();
  const top = doc.walls[TOP];
  const { item, wallId } = placeAgainstWall(doc, L, box(), { x: 60, y: 10 });
  assert.equal(wallId, top.id);
  assert.equal(item.wallId, top.id);
  assert.equal(item.rotDeg, 0);
  near(item.x, 60);
  near(item.y, 2.25 + 12); // face at 2.25, centre d/2 out
  const ys = itemCorners(item).map((p) => p.y);
  near(Math.min(...ys), 2.25);
  // Slides but clamps inside the wall length.
  const edge = placeAgainstWall(doc, L, box(), { x: 10, y: 4 }).item; // nearest the top wall, t=10 → clamped to w/2
  near(edge.x, 18);
  // Left wall: outward normal (1,0) → rotDeg 270 (front faces +x).
  const left = placeAgainstWall(doc, L, box(), { x: 10, y: 60 });
  assert.equal(left.wallId, doc.walls[LEFT].id);
  assert.equal(left.item.rotDeg, 270);
  near(left.item.x, 2.25 + 12);
  near(left.item.y, 60);
  // Nothing near → centred on the cursor, no wall.
  const free = placeAgainstWall(doc, L, box({ rotDeg: 45 }), { x: 72, y: 60 });
  assert.equal(free.wallId, null);
  assert.equal(free.item.wallId, null);
  assert.equal(free.item.rotDeg, 45);
  near(free.item.x, 72);
  near(free.item.y, 60);
  // Doesn't touch the input.
  const src = box();
  const copy = { ...src };
  placeAgainstWall(doc, L, src, { x: 60, y: 10 });
  assert.deepEqual(src, copy);
});

test("three B36 along a wall → one run, 108\" / 9 LF; totals and alignment", () => {
  const doc0 = room();
  const top = doc0.walls[TOP];
  const doc = placeRunAlongWall(doc0, top.id, "right", 12, [spec(36), spec(36), spec(36)]);
  assert.equal(doc0.items.length, 0, "input doc untouched");
  assert.equal(doc.items.length, 3);
  assert.ok(doc.items.every((i) => i.rotDeg === 0 && i.wallId === top.id));
  assert.equal(doc.runs.length, 1);
  const run = doc.runs[0];
  assert.equal(run.tier, "base");
  assert.equal(run.wallId, top.id);
  assert.equal(run.itemIds.length, 3);
  assert.ok(doc.items.every((i) => i.runId === run.id));
  const ext = runExtent(doc, run);
  near(ext.startIn, 12);
  near(ext.endIn, 120);
  near(ext.lengthIn, 108);
  near(ext.lengthLf, 9);
  near(ext.depthIn, 24);
  assert.equal(ext.gaps.length, 0);
  assert.deepEqual(suggestFillers(doc, run), []);

  const totals = runTotals(doc, L);
  near(totals.baseLf, 9);
  near(totals.wallLf, 0);
  near(totals.tallLf, 0);

  // Rebuilding again keeps the run id.
  const again = rebuildRuns(doc, L);
  assert.equal(again.runs[0].id, run.id);
});

test("a 4\" gap yields a filler suggestion; ≥ 6\" splits the run", () => {
  const doc0 = room();
  const top = doc0.walls[TOP];
  let doc = placeRunAlongWall(doc0, top.id, "right", 12, [spec(36)]);
  doc = placeRunAlongWall(doc, top.id, "right", 12 + 36 + 4, [spec(36)]);
  assert.equal(doc.runs.length, 1);
  const s = suggestFillers(doc, doc.runs[0]);
  assert.equal(s.length, 1);
  near(s[0].gapIn, 4);
  near(s[0].atIn, 48);
  assert.equal(s[0].suggestion, "filler");
  near(runExtent(doc, doc.runs[0]).lengthIn, 76);

  const split = placeRunAlongWall(doc, top.id, "right", 12 + 36 + 4 + 36 + 8, [spec(24)]);
  assert.equal(split.runs.length, 2);
  // Original run keeps its id.
  assert.ok(split.runs.some((r) => r.id === doc.runs[0].id));
});

test("snapToNeighbors closes a 2\" gap on the same wall, ignores the other face", () => {
  const doc0 = room();
  const top = doc0.walls[TOP];
  const doc = placeRunAlongWall(doc0, top.id, "right", 12, [spec(36)]);
  const first = doc.items[0];
  // Drop a box 2" past the first one's end (t = 48 → its start at 50).
  const dropped = placeAgainstWall(doc, L, box(), { x: 50 + 18, y: 10 }).item;
  const snapped = snapToNeighbors(doc, dropped);
  near(snapped.x, 48 + 18);
  near(snapped.y, dropped.y);
  // Overlapping by 1" gets pushed out.
  const over = placeAgainstWall(doc, L, box(), { x: 47 + 18, y: 10 }).item;
  near(snapToNeighbors(doc, over).x, 48 + 18);
  // Too far → untouched.
  const far = placeAgainstWall(doc, L, box(), { x: 60 + 18, y: 10 }).item;
  assert.equal(snapToNeighbors(doc, far), far);
  // Wall tier ignores base neighbours.
  const wallCab = { ...dropped, id: "wc", kind: "wall", z: 54, h: 30, d: 12, y: 2.25 + 6 };
  assert.equal(snapToNeighbors(doc, wallCab), wallCab);
  assert.equal(first.id, doc.items[0].id);
});

test("generateCounters: area ≈ (108+3)×(24+1.5), keeps user material on regeneration", () => {
  const doc0 = room();
  const top = doc0.walls[TOP];
  let doc = placeRunAlongWall(doc0, top.id, "right", 12, [spec(36), spec(36), spec(36)]);
  doc = generateCounters(doc, L, opts);
  assert.equal(doc.counters.length, 1);
  const c = doc.counters[0];
  assert.equal(c.runId, doc.runs[0].id);
  near(Math.abs(polygonArea(c.polygon)), (108 + 3) * (24 + 1.5), 1e-6);
  // Back edge sits on the wall face, front edge 25.5" out.
  near(c.polygon[0].y, 2.25);
  near(c.polygon[1].y, 2.25);
  near(c.polygon[2].y, 2.25 + 25.5);
  near(Math.min(c.polygon[0].x, c.polygon[1].x), 10.5);
  near(Math.max(c.polygon[0].x, c.polygon[1].x), 121.5);
  assert.deepEqual(c.overhang, { front: 1.5, back: 0, left: 1.5, right: 1.5 });
  assert.equal(c.backsplashIn, 18);
  assert.equal(c.material.key, "quartz-white");

  // User edits material + edge, then adds a box and regenerates.
  const granite = { key: "granite-black", label: "Granite", color: "#111" };
  doc = { ...doc, counters: doc.counters.map((x) => ({ ...x, material: granite, edge: "ogee", waterfall: ["left"] })) };
  doc = placeRunAlongWall(doc, top.id, "right", 120, [spec(24)]);
  const hand = {
    id: "hand", levelId: L, runId: null, polygon: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }],
    thickIn: 1, overhang: { front: 0, back: 0, left: 0, right: 0 }, edge: "", material: granite, backsplashIn: 0, seams: [], waterfall: [],
  };
  doc = { ...doc, counters: [...doc.counters, hand] };
  doc = generateCounters(doc, L, opts);
  assert.equal(doc.counters.length, 2);
  const kept = doc.counters.find((x) => x.id === c.id);
  assert.ok(kept, "counter id preserved");
  assert.equal(kept.material.key, "granite-black");
  assert.equal(kept.edge, "ogee");
  assert.deepEqual(kept.waterfall, ["left"]);
  near(Math.abs(polygonArea(kept.polygon)), (132 + 3) * 25.5, 1e-6);
  assert.ok(doc.counters.some((x) => x.id === "hand"), "hand-drawn counter kept");

  // Run vanishes → its counter is dropped.
  const gone = generateCounters({ ...doc, items: [], runs: [] }, L, opts);
  assert.deepEqual(gone.counters.map((x) => x.id), ["hand"]);

  const t = runTotals(doc, L);
  near(t.counterSf, ((135 * 25.5) + 144) / 144, 1e-6);
  near(t.backsplashSf, (135 * 18) / 144, 1e-6);
});

test("islands: touching boxes form a wall-less run; counter gets seating overhang", () => {
  const doc = room();
  doc.items = [
    box({ id: "i1", kind: "island", x: 54, y: 60, w: 36, d: 36 }),
    box({ id: "i2", kind: "island", x: 90, y: 60, w: 36, d: 36, props: { seating: "front" } }),
    box({ id: "i3", kind: "island", x: 130, y: 60, w: 24, d: 36 }), // 4" away → separate
  ];
  const r = rebuildRuns(doc, L);
  assert.equal(r.runs.length, 2);
  const big = r.runs.find((x) => x.itemIds.length === 2);
  assert.ok(big);
  assert.equal(big.wallId, null);
  assert.deepEqual(big.itemIds, ["i1", "i2"]);
  near(runExtent(r, big).lengthIn, 72);
  const c = generateCounters(r, L, opts);
  const counter = c.counters.find((x) => x.runId === big.id);
  assert.ok(counter);
  near(Math.abs(polygonArea(counter.polygon)), (72 + 3) * (36 + 3 + 12), 1e-6);
  assert.deepEqual(counter.overhang, { front: 13.5, back: 1.5, left: 1.5, right: 1.5 });
  assert.equal(counter.backsplashIn, 0);
  const ys = counter.polygon.map((p) => p.y);
  near(Math.min(...ys), 60 - 18 - 1.5);
  near(Math.max(...ys), 60 + 18 + 13.5);
});

test("alignWallCabinets sets wall-tier z = counter + gap (54)", () => {
  const doc = room();
  doc.items = [
    box({ id: "w1", kind: "wall", z: 0, h: 30, d: 12 }),
    box({ id: "b1", kind: "base" }),
    box({ id: "w2", kind: "wall", levelId: "L2", z: 0, h: 30, d: 12 }),
  ];
  const out = alignWallCabinets(doc, L, DEFAULTS);
  assert.equal(out.items.find((i) => i.id === "w1").z, 54);
  assert.equal(out.items.find((i) => i.id === "b1").z, 0);
  assert.equal(out.items.find((i) => i.id === "w2").z, 0, "other level untouched");
  assert.equal(doc.items[0].z, 0, "input untouched");
  const custom = alignWallCabinets(doc, L, { ...DEFAULTS, counterIn: 34, wallCabGapIn: 20 });
  assert.equal(custom.items[0].z, 54);
  assert.equal(alignWallCabinets(out, L, DEFAULTS), out, "no-op returns same doc");
});

test("runTotals sums base/wall/tall LF across runs", () => {
  const doc0 = room();
  const [top, , bottom] = doc0.walls;
  let doc = placeRunAlongWall(doc0, top.id, "right", 0, [spec(36), spec(36)]);
  doc = placeRunAlongWall(doc, top.id, "right", 0, [spec(30, { kind: "wall", z: 54, h: 30, d: 12 })]);
  doc = placeRunAlongWall(doc, top.id, "right", 100, [spec(24, { kind: "tall", h: 84 })]);
  doc = placeRunAlongWall(doc, bottom.id, "right", 0, [spec(24, { kind: "vanity" })]);
  const t = runTotals(doc, L);
  near(t.baseLf, 8);
  near(t.wallLf, 2.5);
  near(t.tallLf, 2);
  assert.equal(doc.runs.length, 4);
  assert.equal(doc.runs.filter((r) => r.tier === "base").length, 2);
});

test("cornerSuggestions finds two base runs meeting at a room corner", () => {
  const doc0 = room();
  const [top, right] = doc0.walls;
  let doc = placeRunAlongWall(doc0, top.id, "right", 60, [spec(36), spec(36)]); // ends at 132, corner at 144
  assert.deepEqual(cornerSuggestions(doc, L), []);
  doc = placeRunAlongWall(doc, right.id, "right", 12, [spec(36)]); // starts 12 from corner (144,0)
  const cs = cornerSuggestions(doc, L);
  assert.equal(cs.length, 1);
  near(cs[0].corner.x, 144);
  near(cs[0].corner.y, 0);
  assert.equal(cs[0].runIds.length, 2);
  assert.deepEqual(cs[0].options, ["blind", "lazy", "diagonal"]);
  // A run on the wrong (outside) face of the right wall does not count.
  const outside = placeRunAlongWall(placeRunAlongWall(doc0, top.id, "right", 60, [spec(36), spec(36)]), right.id, "left", 12, [spec(36)]);
  assert.deepEqual(cornerSuggestions(outside, L), []);
});

test("itemCollisions finds an overlapping box, ignores stacked tiers and touching", () => {
  const doc = room();
  const a = box({ id: "a", x: 50, y: 20 });
  const b = box({ id: "b", x: 70, y: 20 }); // overlaps a by 16"
  const c = box({ id: "c", x: 86, y: 20 }); // touches a's edge? a spans 32..68, c spans 68..104 → touching only
  const w = box({ id: "w", x: 50, y: 14, kind: "wall", z: 54, h: 30, d: 12 }); // above a
  const other = box({ id: "o", x: 50, y: 20, levelId: "L2" });
  const demo = box({ id: "demo", x: 50, y: 20, phase: "remove" });
  doc.items = [a, b, c, w, other, demo];
  assert.deepEqual(itemCollisions(doc, a).map((i) => i.id), ["b"]);
  assert.deepEqual(itemCollisions(doc, c).map((i) => i.id), ["b"]);
  assert.deepEqual(itemCollisions(doc, w), []);
  assert.deepEqual(itemCollisions(doc, demo), []);
});

test("degenerate input: empty runs, missing walls, zero-length walls", () => {
  const doc = room();
  const ext = runExtent(doc, { id: "r", levelId: L, wallId: "nope", tier: "base", itemIds: ["x"], accessories: [] });
  assert.equal(ext.lengthIn, 0);
  assert.deepEqual(ext.items, []);
  assert.deepEqual(suggestFillers(doc, ext.run), []);
  assert.equal(rebuildRuns(doc, L).runs.length, 0);
  assert.equal(placeRunAlongWall(doc, "nope", "left", 0, [spec(36)]), doc);
  doc.walls.push({ ...doc.walls[0], id: "zero", a: { x: 300, y: 300 }, b: { x: 300, y: 300 } });
  const p = placeAgainstWall(doc, L, box(), { x: 305, y: 300 });
  assert.equal(p.wallId, "zero");
  assert.ok(Number.isFinite(p.item.x) && Number.isFinite(p.item.y));
  // A cabinet pointing at a wall that no longer exists is treated as loose.
  doc.items = [box({ id: "orphan", wallId: "gone", x: 60, y: 60 })];
  const r = rebuildRuns(doc, L);
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].wallId, null);
  const t = runTotals(r, L);
  near(t.baseLf, 3);
});
