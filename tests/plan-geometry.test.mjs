import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, fmtIn, parseIn, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms, splitWall, joinWalls, snapPoint, wallPolygon, solidSegments } from "../lib/plan-geometry.ts";

const box = () => {
  const doc = emptyDoc();
  doc.walls = rectWalls(MAIN_LEVEL_ID, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  return doc;
};

test("fmtIn / parseIn round-trip", () => {
  assert.equal(fmtIn(100.5), `8' 4½"`);
  assert.equal(fmtIn(36), `3' 0"`);
  assert.equal(fmtIn(36, { inchesOnly: true }), `36"`);
  assert.equal(fmtIn(11.5), `11½"`);
  assert.equal(parseIn(`8' 4 1/2"`), 100.5);
  assert.equal(parseIn("8'4.5"), 100.5);
  assert.equal(parseIn("100.5"), 100.5);
  assert.equal(parseIn("nonsense"), null);
});

test("rectangle of walls yields one room with the right area", () => {
  const doc = withRooms(box());
  assert.equal(doc.rooms.length, 1);
  assert.ok(Math.abs(doc.rooms[0].areaSf - 120) < 0.01, `area ${doc.rooms[0].areaSf}`);
  assert.ok(Math.abs(doc.rooms[0].perimLf - 44) < 0.01);
  assert.equal(doc.rooms[0].wallIds.length, 4);
});

test("a dividing wall makes two rooms; a dangling wall makes none extra", () => {
  const doc = box();
  const [w0] = doc.walls;
  doc.walls.push({ ...w0, id: "div", a: { x: 72, y: 0 }, b: { x: 72, y: 120 } });
  const r = withRooms(doc);
  assert.equal(r.rooms.length, 2);
  assert.ok(r.rooms.every((x) => Math.abs(x.areaSf - 60) < 0.01));
  doc.walls.push({ ...w0, id: "stub", a: { x: 20, y: 20 }, b: { x: 40, y: 40 } });
  assert.equal(withRooms(doc).rooms.length, 2);
});

test("pinned room names survive re-detection", () => {
  let doc = withRooms(box());
  doc.rooms[0].name = "Kitchen";
  doc.rooms[0].pinned = true;
  doc.walls[0] = { ...doc.walls[0], a: { x: 0, y: 0 }, b: { x: 144, y: 0 } };
  doc = withRooms(doc);
  assert.equal(doc.rooms[0].name, "Kitchen");
});

test("split then join restores one wall and re-homes openings", () => {
  let doc = box();
  const w = doc.walls[0]; // 0,0 → 144,0
  doc.openings.push({ id: "o1", wallId: w.id, atIn: 100, widthIn: 36, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "left", phase: "existing", tag: "" });
  doc = splitWall(doc, w.id, 72);
  assert.equal(doc.walls.length, 5);
  const second = doc.walls.find((x) => x.a.x === 72 && x.a.y === 0 && x.b.x === 144);
  assert.ok(second);
  assert.equal(doc.openings[0].wallId, second.id);
  assert.equal(doc.openings[0].atIn, 28);
  doc = joinWalls(doc, w.id, second.id);
  assert.equal(doc.walls.length, 4);
  assert.equal(doc.openings[0].wallId, w.id);
  assert.equal(doc.openings[0].atIn, 100);
});

test("snap prefers endpoints, then grid", () => {
  const doc = box();
  const opts = { gridIn: 1, angleDeg: 15, endpoints: true, faces: true, midpoints: true, radiusIn: 6 };
  const s = snapPoint({ x: 2, y: 3 }, doc.walls, opts);
  assert.equal(s.kind, "endpoint");
  assert.deepEqual(s.pt, { x: 0, y: 0 });
  const g = snapPoint({ x: 50.4, y: 50.6 }, doc.walls, opts);
  assert.equal(g.kind, "grid");
  assert.deepEqual(g.pt, { x: 50, y: 51 });
});

test("wall polygon is mitred at corners and solid segments skip openings", () => {
  const doc = box();
  const poly = wallPolygon(doc.walls[0], doc.walls);
  assert.equal(poly.length, 4);
  // top wall 0,0→144,0 thickness 4.5: outer corners at (-2.25,-2.25) and (146.25,-2.25)
  const xs = poly.map((p) => Math.round(p.x * 100) / 100);
  assert.ok(xs.includes(-2.25) && xs.includes(146.25), JSON.stringify(poly));
  const segs = solidSegments(doc.walls[0], [{ id: "o", wallId: doc.walls[0].id, atIn: 30, widthIn: 36, heightIn: 80, sillIn: 0, kind: "door", subtype: "", hand: "L", swing: "left", phase: "new", tag: "" }]);
  assert.deepEqual(segs, [[0, 30], [66, 144]]);
});
