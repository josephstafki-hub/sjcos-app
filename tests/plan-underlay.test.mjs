import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, levelSlice, migrateDoc, parseDoc } from "../lib/plan-doc.ts";
import { applyOp, applyOps, PlanOpError } from "../lib/plan-ops.ts";
import {
  calibrateUnderlay,
  detectRooms,
  rotateUnderlayAbout,
  uncoveredSpans,
  underlayCorners,
  underlayScaleForDrawing,
} from "../lib/plan-geometry.ts";
import { planTextSizes } from "../lib/plan-draw.ts";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ─── Underlay geometry ───────────────────────────────────────────────────────

test("underlayScaleForDrawing: a 1/4\" sheet at 200 dpi is 0.24 in/px", () => {
  near(underlayScaleForDrawing(200, 0.25), 0.24);
  // 1 real foot = 1/4 paper inch = 50 px → 12/50.
  near(underlayScaleForDrawing(200, 0.25) * 50, 12);
});

test("calibrateUnderlay rescales about the first point", () => {
  const u = { x: 10, y: 20, scale: 0.5, rotDeg: 0 };
  // Two points 100" apart on the plan that are really 200" apart.
  const next = calibrateUnderlay(u, { x: 50, y: 50 }, { x: 150, y: 50 }, 200);
  near(next.scale, 1);
  // p1 stays put: the pixel under it is (50-10)/0.5 = 80, (50-20)/0.5 = 60.
  near(next.x + 80 * next.scale, 50);
  near(next.y + 60 * next.scale, 50);
  assert.equal(next.rotDeg, 0);
  assert.equal(calibrateUnderlay(u, { x: 1, y: 1 }, { x: 1, y: 1 }, 100), null);
  assert.equal(calibrateUnderlay(u, { x: 1, y: 1 }, { x: 9, y: 1 }, 0), null);
});

test("calibrateUnderlay straightens a skewed line to level about p1", () => {
  const u = { x: 0, y: 0, scale: 1, rotDeg: 3 };
  const p1 = { x: 0, y: 0 };
  const ang = (3 * Math.PI) / 180;
  const p2 = { x: 100 * Math.cos(ang), y: 100 * Math.sin(ang) };
  const next = calibrateUnderlay(u, p1, p2, 100, true);
  near(next.rotDeg, 0, 1e-3);
  near(next.scale, 1);
  // The image pixel that was under p2 (100, 0) now lands level with p1.
  const c = underlayCorners(next, 100, 10);
  near(c[1].y, 0, 1e-6);
  near(c[1].x, 100, 1e-6);
});

test("rotateUnderlayAbout keeps the image centre fixed", () => {
  const u = { x: 0, y: 0, scale: 2, rotDeg: 0 };
  const centre = (v) => {
    const c = underlayCorners(v, 100, 50);
    return { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
  };
  const before = centre(u);
  const r = rotateUnderlayAbout(u, 100, 50, 90);
  const after = centre({ ...u, ...r });
  near(after.x, before.x);
  near(after.y, before.y);
  assert.equal(r.rotDeg, 90);
  assert.equal(rotateUnderlayAbout(u, 100, 50, 270).rotDeg, -90);
});

// ─── Underlay ops + migration ────────────────────────────────────────────────

const plan = (over = {}) => ({ fileId: "und-1", x: 0, y: 0, scale: 0.25, rotDeg: 0, opacity: 0.5, locked: false, widthPx: 400, heightPx: 300, ...over });

test("setUnderlay is per level; updateUnderlay patches; removeLevel drops it", () => {
  let d = applyOp(emptyDoc(), { op: "addLevel", name: "Upper", id: "L2" });
  d = applyOp(d, { op: "setUnderlay", levelId: "L1", underlay: plan() });
  d = applyOp(d, { op: "setUnderlay", levelId: "L2", underlay: plan({ fileId: "und-2" }) });
  assert.equal(d.underlays.length, 2);
  assert.equal(levelSlice(d, "L2").underlay.fileId, "und-2");
  // Replacing L1's keeps one per level.
  d = applyOp(d, { op: "setUnderlay", levelId: "L1", underlay: plan({ fileId: "und-3" }) });
  assert.equal(d.underlays.length, 2);
  const id = levelSlice(d, "L1").underlay.id;
  d = applyOp(d, { op: "updateUnderlay", id, patch: { scale: 0.5, opacity: 3, calibrated: true } });
  const u = levelSlice(d, "L1").underlay;
  assert.equal(u.scale, 0.5);
  assert.equal(u.opacity, 1);
  assert.equal(u.levelId, "L1");
  assert.ok(parseDoc(d).ok);
  assert.throws(() => applyOp(d, { op: "updateUnderlay", id, patch: { scale: 0 } }), PlanOpError);
  d = applyOp(d, { op: "removeLevel", id: "L2" });
  assert.equal(d.underlays.length, 1);
  d = applyOp(d, { op: "setUnderlay", levelId: "L1", underlay: null });
  assert.equal(d.underlays.length, 0);
});

test("migrateDoc folds the old single underlay into the per-level list", () => {
  const old = { ...emptyDoc(), underlay: plan(), underlays: undefined };
  const d = migrateDoc(old);
  assert.equal(d.underlay, null);
  assert.equal(d.underlays.length, 1);
  assert.equal(d.underlays[0].levelId, "L1");
  assert.ok(d.underlays[0].id);
  assert.ok(parseDoc(old).ok);
});

// ─── Walls / rooms ───────────────────────────────────────────────────────────

test("uncoveredSpans subtracts collinear walls", () => {
  const walls = [{ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, { a: { x: 80, y: 0.4 }, b: { x: 90, y: 0.4 } }];
  const spans = uncoveredSpans({ x: 0, y: 0 }, { x: 120, y: 0 }, walls);
  assert.deepEqual(
    spans.map(([a, b]) => [Math.round(a.x), Math.round(b.x)]),
    [
      [50, 80],
      [90, 120],
    ],
  );
  assert.equal(uncoveredSpans({ x: 10, y: 0 }, { x: 40, y: 0 }, walls).length, 0);
  // A parallel wall a foot away doesn't count.
  assert.equal(uncoveredSpans({ x: 0, y: 12 }, { x: 50, y: 12 }, walls).length, 1);
});

test("a second room against the first shares the wall instead of stacking a copy", () => {
  let d = applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 120, y: 120 } });
  d = applyOp(d, { op: "addRoomRect", p: { x: 120, y: 0 }, q: { x: 240, y: 120 } });
  assert.equal(d.walls.length, 7);
  assert.equal(d.rooms.length, 2);
  // Drawing a wall right on top of an existing one is a no-op.
  const same = applyOp(d, { op: "addWall", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } });
  assert.equal(same.walls.length, 7);
});

test("splitting a room keeps its id on the bigger piece; new pieces get unique ids and names", () => {
  let d = applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 240, y: 120 }, name: "Kitchen" });
  const kid = d.rooms[0].id;
  d = applyOp(d, { op: "addWall", a: { x: 160, y: 0 }, b: { x: 160, y: 120 } });
  assert.equal(d.rooms.length, 2);
  const ids = new Set(d.rooms.map((r) => r.id));
  assert.equal(ids.size, 2);
  const kitchen = d.rooms.find((r) => r.id === kid);
  assert.equal(kitchen.name, "Kitchen");
  assert.ok(kitchen.areaSf > 100);
  const other = d.rooms.find((r) => r.id !== kid);
  assert.notEqual(other.name, "Kitchen");
  assert.equal(new Set(detectRooms(d, "L1").map((r) => r.name)).size, 2);
});

test("moving a wall takes the cabinets hung on it along", () => {
  let d = applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 144, y: 120 } });
  d = applyOp(d, { op: "placeItem", libraryKey: "base-B36", at: { x: 60, y: 10 } });
  const cab = d.items[0];
  assert.ok(cab.wallId);
  d = applyOp(d, { op: "move", ids: [cab.wallId], dx: 0, dy: 24 });
  near(d.items[0].y, cab.y + 24);
});

test("moveCorner refuses to collapse a wall", () => {
  const d = applyOp(emptyDoc(), { op: "addWall", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
  assert.throws(() => applyOp(d, { op: "moveCorner", from: { x: 100, y: 0 }, to: { x: 0.2, y: 0 } }), PlanOpError);
});

test("duplicateItems uses supplied ids and lets copies off the wall", () => {
  let d = applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 144, y: 120 } });
  d = applyOp(d, { op: "placeItem", libraryKey: "base-B36", at: { x: 60, y: 10 } });
  d = applyOps(d, [{ op: "duplicateItems", ids: [d.items[0].id], dx: 12, dy: 12, newIds: ["copy1"] }]);
  const copy = d.items.find((i) => i.id === "copy1");
  assert.ok(copy);
  assert.equal(copy.wallId, null);
});

test("addOpening without a subtype uses the designer's default sizes", () => {
  let d = applyOp(emptyDoc({ doorWidthIn: 36 }), { op: "addWall", a: { x: 0, y: 0 }, b: { x: 200, y: 0 } });
  d = applyOp(d, { op: "addOpening", wallId: d.walls[0].id, atIn: 20, kind: "door" });
  assert.equal(d.openings[0].widthIn, 36);
});

// ─── Labels ──────────────────────────────────────────────────────────────────

test("planTextSizes: print keeps paper sizes, canvas holds screen size with a cap", () => {
  assert.equal(planTextSizes(undefined).tag, 5);
  assert.equal(planTextSizes(4, true).room, 8);
  // Zoomed in: 10px tags at 20 px/in → 0.5".
  near(planTextSizes(20).tag, 0.5);
  // Zoomed way out: capped at twice the paper size.
  assert.equal(planTextSizes(0.2).tag, 10);
});

test("sheetScaleFromText reads the printed drawing scale", async () => {
  const { sheetScaleFromText } = await import("../lib/plan-geometry.ts");
  assert.equal(sheetScaleFromText(`A 1/4" = 1'-0"  B 1/4" = 1'-0"  DETAIL 1" = 1'-0"`), 0.25);
  assert.equal(sheetScaleFromText(`SCALE: 1/8" = 1'-0"`), 0.125);
  assert.equal(sheetScaleFromText(`3/16"=1'`), 0.1875);
  assert.equal(sheetScaleFromText(`1 1/2" = 1'-0"`), 1.5);
  assert.equal(sheetScaleFromText("SCALE: AS NOTED  4'-8 1/4\""), null);
});

// ─── Stairs ──────────────────────────────────────────────────────────────────

test("stairLayout: straight, L and U share treads, landing and a centred footprint", async () => {
  const { stairLayout, stairFootprint, pointInStair, stairRunIn } = await import("../lib/plan-stairs.ts");
  const base = { id: "s", fromLevelId: "L1", toLevelId: "L2", x: 100, y: 100, rotDeg: 0, widthIn: 36, riserCount: 14, riserIn: 7.5, treadIn: 10, phase: "new" };
  const straight = stairLayout({ ...base, shape: "straight" });
  assert.equal(straight.pieces.length, 13);
  assert.equal(Math.max(...straight.pieces.map((p) => p.level)), 13);
  near(stairRunIn({ ...base, shape: "straight" }), 130);

  const L = stairLayout({ ...base, shape: "L" });
  assert.equal(L.shape, "L");
  assert.equal(L.pieces.filter((p) => p.kind === "landing").length, 1);
  assert.equal(L.pieces.length, 13);
  assert.deepEqual(L.flights, [6, 6]);
  // Levels climb 1..13 with no gaps.
  assert.deepEqual([...L.pieces.map((p) => p.level)].sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 1));
  // Turn right sends the second flight to +x; left mirrors it.
  const second = (l) => l.pieces.filter((p) => p.level > 7);
  assert.ok(second(L).every((p) => p.x0 >= L.pieces[0].x1 - 1e-9));
  const Lleft = stairLayout({ ...base, shape: "L", turn: "left" });
  assert.ok(second(Lleft).every((p) => p.x1 <= Lleft.pieces[0].x0 + 1e-9));
  // Footprint bbox is centred on the stair's (x, y).
  const xs = L.footprint.map((p) => p.x), ys = L.footprint.map((p) => p.y);
  near(Math.min(...xs) + Math.max(...xs), 0);
  near(Math.min(...ys) + Math.max(...ys), 0);

  const U = stairLayout({ ...base, shape: "U", landingAt: 6, wellIn: 4 });
  const landing = U.pieces.find((p) => p.kind === "landing");
  near(landing.x1 - landing.x0, 36 * 2 + 4);
  // The second flight comes back beside the first.
  const u2 = second(U);
  assert.ok(u2.every((p) => p.x0 >= U.pieces[0].x1 + 4 - 1e-9));

  // Too few treads for a landing → drawn straight.
  assert.equal(stairLayout({ ...base, shape: "U", riserCount: 3 }).shape, "straight");

  // Hit-testing uses the real outline: the empty corner of an L is not stair.
  const st = { ...base, shape: "L" };
  const fp = stairFootprint(st);
  const minX = Math.min(...fp.map((p) => p.x)), maxX = Math.max(...fp.map((p) => p.x));
  const maxY = Math.max(...fp.map((p) => p.y));
  assert.ok(pointInStair(st, { x: minX + 5, y: maxY - 5 }));
  assert.ok(!pointInStair(st, { x: maxX - 5, y: maxY - 5 }));
});
