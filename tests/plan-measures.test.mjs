import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { computeMeasures, productLines, summarizeMeasures, measureDef, MEASURE_DEFS } from "../lib/plan-measures.ts";

const L = MAIN_LEVEL_ID;

const item = (over) => ({
  id: over.id,
  levelId: L,
  kind: "base",
  catalogId: null,
  libraryKey: null,
  label: "",
  tag: "",
  x: 0,
  y: 0,
  z: 0,
  rotDeg: 0,
  w: 36,
  d: 24,
  h: 34.5,
  phase: "new",
  props: {},
  ...over,
});

/** 12'×10' existing box plus a 10' "new" partition down the middle. */
function partitionedRoom() {
  const doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  doc.walls.push({ id: "part", levelId: L, a: { x: 72, y: 0 }, b: { x: 72, y: 120 }, thickIn: 4.5, heightIn: 96, kind: "new" });
  return withRooms(doc);
}

const qty = (ms, key) => ms.filter((m) => m.key === key).reduce((s, m) => s + m.qty, 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg ?? ""} expected ${b}, got ${a}`);

test("every measure key has a definition with label/unit/group", () => {
  assert.ok(MEASURE_DEFS.length > 40);
  for (const d of MEASURE_DEFS) {
    assert.ok(d.key && d.label && ["sf", "lf", "ea"].includes(d.unit) && d.group, d.key);
    assert.equal(measureDef(d.key), d);
  }
  assert.equal(measureDef("nope"), null);
});

test("new partition wall: lf, framed sf, drywall both faces; room sf totals 120", () => {
  const doc = partitionedRoom();
  const ms = computeMeasures(doc);
  near(qty(ms, "wall_new_lf"), 10, "wall_new_lf");
  near(qty(ms, "wall_new_sf_framed"), 80, "wall_new_sf_framed");
  near(qty(ms, "drywall_sf"), 160, "drywall_sf");
  near(qty(ms, "room_sf"), 120, "room_sf");
  assert.equal(ms.filter((m) => m.key === "room_sf").length, 2, "one room_sf row per room");
  // Existing walls produce no framing or demo.
  assert.equal(qty(ms, "wall_demo_lf"), 0);
  const nw = ms.find((m) => m.key === "wall_new_lf");
  assert.equal(nw.phase, "new");
  assert.deepEqual(nw.elementIds, ["part"]);
  assert.equal(nw.levelId, L);
});

test("drywall nets out openings on a new wall; removed walls count as demo", () => {
  const doc = partitionedRoom();
  doc.openings.push({ id: "d1", wallId: "part", atIn: 40, widthIn: 32, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "left", phase: "new", tag: "" });
  doc.walls[0] = { ...doc.walls[0], kind: "remove" }; // 144" top wall
  const ms = computeMeasures(doc);
  near(qty(ms, "drywall_sf"), (2 * (120 * 96 - 32 * 80)) / 144, "drywall_sf");
  near(qty(ms, "wall_demo_lf"), 12, "wall_demo_lf");
  near(qty(ms, "wall_demo_sf"), 96, "wall_demo_sf");
  assert.equal(ms.find((m) => m.key === "wall_demo_lf").phase, "remove");
});

test("three 36\" base cabinets → cab_base_lf 9, cab_base_ea 3; existing ones don't count", () => {
  const doc = emptyDoc();
  doc.items = [
    item({ id: "b1", x: 18 }),
    item({ id: "b2", x: 54 }),
    item({ id: "b3", x: 90 }),
    item({ id: "b4", x: 126, phase: "existing" }),
    item({ id: "b5", x: 162, phase: "remove" }),
  ];
  const ms = computeMeasures(doc);
  near(qty(ms, "cab_base_lf"), 9);
  assert.equal(qty(ms, "cab_base_ea"), 3);
  assert.equal(qty(ms, "cab_demo_ea"), 1);
  const s = summarizeMeasures(ms);
  assert.equal(s.find((r) => r.key === "cab_base_ea").qty, 3);
});

test("a 32×80 door → door_ea 1 and casing (2×80+32)/12", () => {
  const doc = partitionedRoom();
  doc.openings.push({ id: "d1", wallId: "part", atIn: 40, widthIn: 32, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "left", phase: "new", tag: "" });
  const ms = computeMeasures(doc);
  const door = ms.find((m) => m.key === "door_ea");
  assert.equal(door.qty, 1);
  assert.equal(door.materialTag, "hinged");
  assert.equal(door.detail, "32×80");
  near(qty(ms, "trim_casing_lf"), (160 + 32) / 12);
});

test("floors, ceilings, counters, plumbing, electrical, stairs, structure", () => {
  const doc = partitionedRoom();
  const [r1, r2] = doc.rooms;
  doc.rooms[0] = { ...r1, floor: { key: "tile-porcelain", label: "Tile", color: "#ccc" }, ceiling: { key: "paint-white", label: "Paint", color: "#fff" } };
  doc.rooms[1] = { ...r2, floor: null, ceiling: null };
  doc.counters.push({
    id: "c1", levelId: L, runId: null, polygon: [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 25.5 }, { x: 0, y: 25.5 }],
    thickIn: 1.25, overhang: { front: 1.5, back: 0, left: 0, right: 0 }, edge: "eased",
    material: { key: "quartz-white", label: "Quartz", color: "#eee" }, backsplashIn: 4, seams: [], waterfall: ["left"],
  });
  doc.items.push(
    item({ id: "s1", kind: "plumbing", libraryKey: "sink-undermount", label: "Sink", w: 30, d: 22, h: 10, z: 26 }),
    item({ id: "a1", kind: "appliance", libraryKey: "range-30", label: "Range", w: 30, d: 26, h: 36 }),
    item({ id: "a2", kind: "appliance", libraryKey: "range-30", label: "Range", w: 30, d: 26, h: 36, phase: "remove" }),
  );
  doc.electrical.push(
    { id: "e1", levelId: L, type: "outlet", x: 10, y: 10, heightAff: 18, circuit: "", switchLegTo: [], phase: "new" },
    { id: "e2", levelId: L, type: "gfci", x: 20, y: 10, heightAff: 42, circuit: "", switchLegTo: [], phase: "new" },
    { id: "e3", levelId: L, type: "recessed", x: 30, y: 10, heightAff: 96, circuit: "", switchLegTo: [], phase: "new" },
    { id: "e4", levelId: L, type: "dimmer", x: 40, y: 10, heightAff: 48, circuit: "", switchLegTo: ["e3"], phase: "new" },
    { id: "e5", levelId: L, type: "outlet", x: 50, y: 10, heightAff: 18, circuit: "", switchLegTo: [], phase: "existing" },
  );
  doc.stairs.push({ id: "st", fromLevelId: L, toLevelId: "L2", shape: "straight", x: 0, y: 0, rotDeg: 0, widthIn: 36, riserCount: 14, riserIn: 7.5, treadIn: 10, phase: "new" });
  doc.structure.push({ id: "bm", levelId: L, kind: "beam", a: { x: 0, y: 60 }, b: { x: 144, y: 60 }, wIn: 5.5, hIn: 11.25, zIn: 84, phase: "new", label: "LVL" });
  const ms = computeMeasures(doc);

  const floors = ms.filter((m) => m.key === "floor_sf");
  assert.equal(floors.length, 2);
  near(floors.find((f) => f.materialTag === "tile-porcelain").qty, 60);
  near(floors.find((f) => f.materialTag === "").qty, 60);
  near(qty(ms, "tile_sf"), 60);
  near(qty(ms, "ceiling_sf"), 120);

  near(qty(ms, "counter_sf"), (96 * 25.5) / 144);
  near(qty(ms, "counter_edge_lf"), (2 * (96 + 25.5)) / 12, "hand-drawn counter: full perimeter");
  near(qty(ms, "backsplash_sf"), (4 * 96) / 144);
  assert.equal(qty(ms, "waterfall_ea"), 1);

  const fix = ms.find((m) => m.key === "plumb_fixture_ea");
  assert.equal(fix.qty, 1);
  assert.equal(fix.materialTag, "sink-undermount");
  assert.equal(qty(ms, "plumb_rough_ea"), 1);
  assert.equal(qty(ms, "appliance_ea"), 1);
  assert.equal(qty(ms, "appliance_demo_ea"), 1);

  assert.equal(qty(ms, "elec_outlet_ea"), 1, "existing outlet ignored");
  assert.equal(qty(ms, "elec_gfci_ea"), 1);
  assert.equal(ms.find((m) => m.key === "elec_light_ea").materialTag, "recessed");
  assert.equal(ms.find((m) => m.key === "elec_switch_ea").materialTag, "dimmer");

  assert.equal(qty(ms, "stair_riser_ea"), 14);
  // 14 risers → 13 treads (the last riser lands on the floor above).
  near(qty(ms, "stair_lf"), (13 * 10) / 12);
  near(qty(ms, "beam_lf"), 12);
});

test("productLines dedupes identical library items and skips existing/removed", () => {
  const doc = emptyDoc();
  doc.items = [
    item({ id: "b1", x: 18, libraryKey: "base-36", label: "B36", tag: "B36" }),
    item({ id: "b2", x: 54, libraryKey: "base-36", label: "B36", tag: "B36" }),
    item({ id: "b3", x: 90, libraryKey: "base-36", label: "B36", tag: "B36", phase: "existing" }),
    item({ id: "c1", x: 130, catalogId: 42, libraryKey: null, label: "Brand X 30", tag: "" }),
    item({ id: "c2", x: 160, catalogId: 42, libraryKey: null, label: "Brand X 30", tag: "", phase: "relocate" }),
  ];
  const lines = productLines(doc);
  assert.equal(lines.length, 2);
  const lib = lines.find((l) => l.libraryKey === "base-36");
  assert.equal(lib.qty, 2);
  assert.equal(lib.itemId, "b1");
  assert.equal(lines.find((l) => l.catalogId === 42).qty, 2);
});

test("computeMeasures does not mutate the doc", () => {
  const doc = partitionedRoom();
  doc.items = [item({ id: "b1" })];
  const before = JSON.stringify(doc);
  computeMeasures(doc);
  productLines(doc);
  assert.equal(JSON.stringify(doc), before);
});
