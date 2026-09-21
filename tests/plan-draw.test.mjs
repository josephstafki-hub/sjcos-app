import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, fmtIn, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { DRAW_LAYERS } from "../lib/plan-draw-types.ts";
import { planOps, opsBounds, elevationOps, autoElevations, dimensionOps, elecSymbolOps, sectionOps } from "../lib/plan-draw.ts";

const L = MAIN_LEVEL_ID;
const ALL = new Set(DRAW_LAYERS);

/** 12' × 10' room: top wall is walls[0] (0,0 → 144,0); inside is +y (its right face). */
function kitchen() {
  let doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  const top = doc.walls[0];
  const right = doc.walls[1];
  doc.openings.push(
    { id: "door", wallId: right.id, atIn: 40, widthIn: 32, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "right", phase: "existing", tag: "D1" },
    { id: "win", wallId: top.id, atIn: 100, widthIn: 36, heightIn: 48, sillIn: 36, kind: "window", subtype: "double", hand: "L", swing: "right", phase: "existing", tag: "W1" },
  );
  const cab = (id, tag, x) => ({
    id, levelId: L, kind: "base", catalogId: null, libraryKey: "base", label: "Base cabinet", tag,
    x, y: 12, z: 0, rotDeg: 0, w: 36, d: 24, h: 34.5, phase: "new", wallId: top.id, runId: null, props: {},
  });
  doc.items.push(cab("b1", "B36", 18), cab("b2", "SB36", 54), cab("b3", "B36-2", 90));
  doc.items.push({
    id: "range", levelId: L, kind: "appliance", catalogId: null, libraryKey: "range-30", label: "Range", tag: "R1",
    x: 123, y: 12.5, z: 0, rotDeg: 0, w: 30, d: 25, h: 36, phase: "new", wallId: top.id, runId: null, props: {},
  });
  doc.items.push({
    id: "sink", levelId: L, kind: "plumbing", catalogId: null, libraryKey: "sink-double", label: "Kitchen sink", tag: "S1",
    x: 54, y: 11, z: 34.5, rotDeg: 0, w: 33, d: 22, h: 10, phase: "new", wallId: top.id, runId: null, props: {},
  });
  doc.electrical.push(
    { id: "sw", levelId: L, type: "switch", x: 141, y: 90, heightAff: 48, wallId: right.id, circuit: "", switchLegTo: ["rl"], phase: "new" },
    { id: "rl", levelId: L, type: "recessed", x: 72, y: 60, heightAff: 96, wallId: null, circuit: "", switchLegTo: [], phase: "new" },
    { id: "out", levelId: L, type: "outlet", x: 36, y: 3, heightAff: 42, wallId: top.id, circuit: "K1", switchLegTo: [], phase: "new" },
  );
  doc = withRooms(doc);
  doc.rooms[0].name = "Kitchen";
  return doc;
}

const baseOpts = { levelId: L, phase: "all", layers: ALL, showTags: true, showDims: true, showRoomLabels: true };

test("planOps emits walls, a door arc, cabinets and tags", () => {
  const doc = kitchen();
  const ops = planOps(doc, baseOpts);
  const wallPolys = ops.filter((o) => o.layer === "walls" && o.t === "polygon");
  assert.equal(wallPolys.length, 4);
  assert.ok(ops.some((o) => o.layer === "openings" && o.t === "arc"), "door swing arc");
  const cabShapes = ops.filter((o) => o.layer === "cabinets" && (o.t === "rect" || o.t === "polygon"));
  assert.ok(cabShapes.length >= 3, `cabinet shapes ${cabShapes.length}`);
  const tags = ops.filter((o) => o.t === "text").map((o) => o.text);
  for (const t of ["B36", "SB36", "B36-2", "R1", "S1"]) assert.ok(tags.includes(t), `tag ${t}`);
  assert.ok(tags.includes("Kitchen"), "room label");
  const b = opsBounds(ops);
  assert.ok(b.max.x - b.min.x >= 144 && b.max.y - b.min.y >= 120, `bounds ${JSON.stringify(b)}`);
  // Ops come out in DRAW_LAYERS order (no selection, so strictly monotonic).
  let last = -1;
  for (const o of ops) {
    const idx = DRAW_LAYERS.indexOf(o.layer);
    assert.ok(idx >= 0, `layer known: ${o.layer}`);
    assert.ok(idx >= last, `layer order: ${o.layer} after ${DRAW_LAYERS[last]}`);
    last = idx;
  }
  // Every wall / item op carries its element id.
  assert.ok(wallPolys.every((o) => o.id));
  assert.ok(cabShapes.every((o) => o.id));
});

test("showTags false drops item tags; hidden layers are omitted", () => {
  const doc = kitchen();
  const ops = planOps(doc, { ...baseOpts, showTags: false, showRoomLabels: false });
  const texts = ops.filter((o) => o.t === "text").map((o) => o.text);
  for (const t of ["B36", "SB36", "B36-2", "R1", "S1"]) assert.ok(!texts.includes(t), `no tag ${t}`);
  const noCabs = planOps(doc, { ...baseOpts, layers: new Set(["walls", "openings"]) });
  assert.ok(noCabs.every((o) => o.layer === "walls" || o.layer === "openings"));
});

test("phase views: existing omits new items; demo hatches removed walls", () => {
  const doc = kitchen();
  const existing = planOps(doc, { ...baseOpts, phase: "existing" });
  assert.ok(!existing.some((o) => o.id === "range"), "range (phase new) hidden in existing view");
  assert.equal(existing.filter((o) => o.layer === "walls" && o.t === "polygon").length, 4);

  doc.walls.push({ id: "gone", levelId: L, a: { x: 72, y: 0 }, b: { x: 72, y: 120 }, thickIn: 4.5, heightIn: 96, kind: "remove" });
  const demo = planOps(doc, { ...baseOpts, phase: "demo" });
  const gone = demo.find((o) => o.id === "gone" && o.t === "polygon");
  assert.ok(gone, "removed wall drawn in demo view");
  assert.equal(gone.s.hatch, "diag");
  assert.ok(gone.s.dash, "removed wall dashed");
  const newView = planOps(doc, { ...baseOpts, phase: "new" });
  assert.ok(!newView.some((o) => o.id === "gone"), "removed wall hidden in new view");
});

test("selection highlight and switch legs", () => {
  const doc = kitchen();
  const ops = planOps(doc, { ...baseOpts, selectedIds: new Set(["b1"]), hoverId: "b2" });
  const handles = ops.filter((o) => o.id === "b1" && o.t === "circle" && o.r === 2);
  assert.equal(handles.length, 4, "4 handle dots");
  assert.ok(ops.some((o) => o.id === "b2" && o.t === "polygon" && o.s.opacity === 0.5), "hover outline");
  assert.ok(ops.some((o) => o.id === "sw" && o.t === "polyline" && o.layer === "lighting"), "switch leg");
  // Selecting a wall adds an auto dimension.
  const withWall = planOps(doc, { ...baseOpts, selectedIds: new Set([doc.walls[0].id]) });
  assert.ok(withWall.some((o) => o.layer === "dims" && o.t === "text" && o.text === fmtIn(144)), "auto wall dimension");
  // Print: no highlights.
  const print = planOps(doc, { ...baseOpts, selectedIds: new Set(["b1"]), forPrint: true });
  assert.equal(print.filter((o) => o.id === "b1" && o.t === "circle").length, 0);
});

test("elevationOps for the top wall spans 144 and carries the cabinet tags", () => {
  const doc = kitchen();
  const top = doc.walls[0];
  const el = elevationOps(doc, { wallId: top.id, side: "right", showTags: true, showDims: true });
  assert.equal(el.widthIn, 144);
  assert.equal(el.heightIn, 96);
  const texts = el.ops.filter((o) => o.t === "text").map((o) => o.text);
  for (const t of ["B36", "SB36", "B36-2"]) assert.ok(texts.includes(t), `elevation tag ${t}`);
  assert.ok(el.ops.some((o) => o.layer === "counters" && o.t === "rect"), "counter band");
  assert.ok(el.ops.some((o) => o.id === "win"), "window on the wall");
  assert.ok(el.ops.some((o) => o.id === "out"), "outlet on the wall");
  assert.ok(el.ops.some((o) => o.layer === "dims"), "dimension strings");
  assert.ok(el.ops.every((o) => o.t !== "text" || Number.isFinite(o.p.x)), "finite coords");
  assert.match(el.title, /Kitchen/);
  // B36 sits at x 0..36 viewed from inside (a → b for the right face).
  const b1 = el.ops.find((o) => o.id === "b1" && o.t === "rect");
  assert.ok(b1 && Math.abs(b1.x) < 0.01 && Math.abs(b1.w - 36) < 0.01, `b1 rect ${JSON.stringify(b1)}`);
});

test("autoElevations returns the cabinet wall on its item side", () => {
  const doc = kitchen();
  const list = autoElevations(doc, L);
  assert.equal(list.length, 1);
  assert.equal(list[0].wallId, doc.walls[0].id);
  assert.equal(list[0].side, "right");
  assert.ok(list[0].label.length > 0);
});

test("sectionOps picks the wall the section line looks at", () => {
  const doc = kitchen();
  doc.sections.push({ id: "sec", levelId: L, a: { x: 0, y: 60 }, b: { x: 144, y: 60 }, depthIn: 72, flip: false, label: "A" });
  const s = sectionOps(doc, "sec");
  assert.ok(s, "section resolves");
  assert.equal(s.title, "Section A");
  assert.equal(s.widthIn, 144);
  assert.ok(s.ops.some((o) => o.id === "b1"), "section shows the cabinets on the top wall");
});

test("dimensionOps text is fmtIn of the distance and reads upright", () => {
  const ops = dimensionOps({ x: 0, y: 0 }, { x: 100.5, y: 0 }, 12, "dims");
  const text = ops.find((o) => o.t === "text");
  assert.equal(text.text, fmtIn(100.5));
  assert.equal(ops.filter((o) => o.t === "line").length, 5);
  const back = dimensionOps({ x: 100, y: 0 }, { x: 0, y: 0 }, 12, "dims").find((o) => o.t === "text");
  assert.equal(back.rotDeg, 0, "never upside down");
  const custom = dimensionOps({ x: 0, y: 0 }, { x: 0, y: 36 }, 8, "dims", { text: "CLR" }).find((o) => o.t === "text");
  assert.equal(custom.text, "CLR");
});

test("elecSymbolOps covers every device type", () => {
  const types = ["outlet", "gfci", "outlet240", "switch", "switch3", "dimmer", "recessed", "pendant", "sconce", "underCab", "surface", "fan", "panel", "smoke", "data", "register", "return", "exhaust", "miniSplit"];
  for (const t of types) {
    const ops = elecSymbolOps(t, { x: 10, y: 10 }, "electrical");
    assert.ok(ops.length >= 1, `symbol ${t}`);
    assert.ok(ops.every((o) => o.layer === "electrical"));
  }
  const gfci = elecSymbolOps("gfci", { x: 0, y: 0 }, "electrical");
  assert.ok(gfci.some((o) => o.t === "text" && o.text === "GFCI"));
});
