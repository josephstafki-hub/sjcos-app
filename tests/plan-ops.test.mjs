import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, MAIN_LEVEL_ID, parseDoc } from "../lib/plan-doc.ts";
import { applyOp, applyOps, PlanOpError, opLabel } from "../lib/plan-ops.ts";

const room = () =>
  applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 144, y: 120 }, name: "Kitchen" });

test("addRoomRect makes four walls and a named, pinned room", () => {
  const d = room();
  assert.equal(d.walls.length, 4);
  assert.equal(d.rooms.length, 1);
  assert.equal(d.rooms[0].name, "Kitchen");
  assert.ok(Math.abs(d.rooms[0].areaSf - 120) < 0.01);
  assert.ok(parseDoc(d).ok);
});

test("openings clamp inside their wall and follow updates", () => {
  let d = room();
  const top = d.walls[0];
  d = applyOp(d, { op: "addOpening", wallId: top.id, atIn: 140, kind: "door", id: "door1" });
  assert.equal(d.openings[0].atIn, 144 - d.openings[0].widthIn);
  d = applyOp(d, { op: "updateOpening", id: "door1", patch: { atIn: -5 } });
  assert.equal(d.openings[0].atIn, 0);
});

test("placeItem snaps a base cabinet to the nearest wall face and builds a run + counter", () => {
  let d = room();
  d = applyOps(d, [
    { op: "placeItem", libraryKey: "base-B36", at: { x: 30, y: 10 } },
    { op: "placeItem", libraryKey: "base-B36", at: { x: 66, y: 10 } },
    { op: "placeItem", libraryKey: "base-SB36", at: { x: 102, y: 10 } },
  ]);
  assert.equal(d.items.length, 3);
  for (const i of d.items) {
    assert.equal(i.rotDeg, 0);
    assert.ok(Math.abs(i.y - (2.25 + 12)) < 0.01, `y ${i.y}`);
    assert.ok(i.wallId);
  }
  assert.equal(d.runs.length, 1);
  assert.equal(d.runs[0].itemIds.length, 3);
  assert.equal(d.counters.length, 1);
  assert.ok(parseDoc(d).ok);
});

test("moving a wall cabinet keeps z aligned; deleting a wall removes its openings", () => {
  let d = room();
  const top = d.walls[0];
  d = applyOp(d, { op: "addOpening", wallId: top.id, atIn: 60, kind: "window" });
  d = applyOp(d, { op: "placeItem", libraryKey: "wall-W3030", at: { x: 30, y: 10 } });
  assert.equal(d.items[0].z, 54);
  d = applyOp(d, { op: "delete", ids: [top.id] });
  assert.equal(d.walls.length, 3);
  assert.equal(d.openings.length, 0);
  assert.equal(d.rooms.length, 0);
});

test("bad ops throw PlanOpError and leave the doc untouched", () => {
  const d = room();
  assert.throws(() => applyOp(d, { op: "addWall", a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }), PlanOpError);
  assert.throws(() => applyOp(d, { op: "placeItem", libraryKey: "nope", at: { x: 0, y: 0 } }), PlanOpError);
  assert.throws(() => applyOp(d, { op: "addDevice", type: "outlet", at: { x: 0, y: 0 }, levelId: "L9" }), PlanOpError);
  assert.equal(opLabel({ op: "delete", ids: ["a", "b"] }), "Delete 2 elements");
});

test("levels: add copies walls, remove clears its elements", () => {
  let d = room();
  d = applyOp(d, { op: "addLevel", name: "Upper", copyWallsFrom: MAIN_LEVEL_ID, id: "L2" });
  assert.equal(d.levels.length, 2);
  assert.equal(d.walls.filter((w) => w.levelId === "L2").length, 4);
  assert.equal(d.rooms.filter((r) => r.levelId === "L2").length, 1);
  d = applyOp(d, { op: "addDevice", type: "outlet", at: { x: 10, y: 10 }, levelId: "L2" });
  d = applyOp(d, { op: "removeLevel", id: "L2" });
  assert.equal(d.levels.length, 1);
  assert.equal(d.electrical.length, 0);
  assert.equal(d.walls.length, 4);
});

test("finishes and switch legs", () => {
  let d = room();
  d = applyOp(d, { op: "setFloorFinish", roomId: d.rooms[0].id, material: "floor-white-oak" });
  assert.ok(d.rooms[0].floor?.key);
  d = applyOp(d, { op: "setWallFinish", wallId: d.walls[0].id, side: "right", material: "tile-subway-white", heightIn: 18 });
  assert.equal(d.finishes.length, 1);
  d = applyOps(d, [
    { op: "addDevice", type: "switch", at: { x: 5, y: 5 }, id: "sw" },
    { op: "addDevice", type: "recessed", at: { x: 60, y: 60 }, id: "lt" },
    { op: "linkSwitch", switchId: "sw", lightId: "lt", on: true },
  ]);
  assert.deepEqual(d.electrical.find((e) => e.id === "sw").switchLegTo, ["lt"]);
  assert.ok(parseDoc(d).ok);
});
