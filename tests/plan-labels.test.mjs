import { test } from "node:test";
import assert from "node:assert/strict";
import { clearLabelPosition } from "../lib/plan-labels.ts";
test("room label clears every marker without moving the markers", () => {
  const markers = [{ x: 50, y: 50, radius: 10 }, { x: 50, y: 80, radius: 10 }];
  const p = clearLabelPosition({ x: 50, y: 50 }, 40, 12, markers);
  for (const m of markers) assert.ok(Math.abs(p.x-m.x)>40+m.radius || Math.abs(p.y-m.y)>12+m.radius);
  assert.deepEqual(markers[0], { x: 50, y: 50, radius: 10 });
});
test("unobstructed labels stay centered", () => {
  assert.deepEqual(clearLabelPosition({ x: 0, y: 0 }, 20, 10, []), { x: 0, y: 0 });
});

import { emptyDoc, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { planOps } from "../lib/plan-draw.ts";
import { DRAW_LAYERS } from "../lib/plan-draw-types.ts";
test("canvas room name and area both clear a comment pin at the room center", () => {
  let doc = emptyDoc();
  doc.walls = rectWalls(MAIN_LEVEL_ID, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  doc = withRooms(doc);
  doc.rooms[0].name = "Kitchen";
  for (const scale of [0.4, 1, 3]) {
    const ops = planOps(doc, { levelId: MAIN_LEVEL_ID, phase: "all", layers: new Set(DRAW_LAYERS), showTags: true, showDims: true, showRoomLabels: true, scalePxPerIn: scale, labelMarkers: [{ x: 72, y: 60, radius: 10 / scale }] });
    const labels = ops.filter(o => o.layer === "rooms" && o.t === "text");
    assert.equal(labels.length, 2);
    for (const label of labels) assert.ok(label.p.y - label.size > 60 + 10 / scale, `label clears pin at zoom ${scale}`);
  }
});
