import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { runChecks, CHECK_CODES } from "../lib/plan-checks.ts";

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

const codes = (checks, code) => checks.filter((c) => c.code === code);

test("CHECK_CODES covers every group with unique codes", () => {
  const set = new Set(CHECK_CODES.map((c) => c.code));
  assert.equal(set.size, CHECK_CODES.length);
  for (const g of ["geometry", "clearance", "code", "estimate"]) assert.ok(CHECK_CODES.some((c) => c.group === g), g);
});

test("empty doc has no checks; no estimate group without ctx", () => {
  assert.deepEqual(runChecks(emptyDoc()), []);
  const doc = emptyDoc();
  doc.items = [item({ id: "b1" })];
  assert.equal(codes(runChecks(doc), "generic_cabinet").length, 0);
  assert.equal(codes(runChecks(doc, {}), "generic_cabinet").length, 1);
});

test("overlapping items → items_overlap; touching neighbours do not", () => {
  const doc = emptyDoc();
  doc.items = [item({ id: "b1", x: 18 }), item({ id: "b2", x: 30 }), item({ id: "b3", x: 84 })];
  const cs = codes(runChecks(doc), "items_overlap");
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].elementIds, ["b1", "b2"]);
  assert.equal(cs[0].id, "items_overlap:b1+b2");
  assert.equal(cs[0].group, "geometry");
  assert.equal(cs[0].levelId, L);
  // b2 (ends at 48) and b3 (starts at 66) are apart; b1/b3 apart.
});

test("wall cabinet over a range with no hood → hood_clearance; a hood at 30\" over electric is fine", () => {
  const doc = emptyDoc();
  doc.items = [
    item({ id: "r1", kind: "appliance", libraryKey: "range-30", label: "Range", w: 30, d: 26, h: 36 }),
    item({ id: "w1", kind: "wall", w: 30, d: 12, h: 30, z: 54, y: -6 }),
  ];
  let cs = codes(runChecks(doc), "hood_clearance");
  assert.equal(cs.length, 1);
  assert.match(cs[0].message, /no hood/);
  doc.items.push(item({ id: "h1", kind: "appliance", libraryKey: "hood-30", label: "Range hood", w: 30, d: 20, h: 12, z: 66, y: -4 }));
  cs = codes(runChecks(doc), "hood_clearance");
  assert.equal(cs.length, 0);
  doc.items[2] = { ...doc.items[2], z: 62 }; // 26" above the 36" range
  doc.items[0] = { ...doc.items[0], props: { power: "gas" } };
  cs = codes(runChecks(doc), "hood_clearance");
  assert.equal(cs.length, 1);
  assert.match(cs[0].message, /gas needs 30/);
});

test("two base cabinets facing each other 30\" apart → aisle_narrow (once per pair)", () => {
  const doc = emptyDoc();
  // A faces +y, front face at y=12; B rotated 180 faces -y, front face at y=42.
  doc.items = [item({ id: "a", x: 0, y: 0 }), item({ id: "b", x: 0, y: 54, rotDeg: 180 })];
  const cs = codes(runChecks(doc), "aisle_narrow");
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].elementIds, ["a", "b"]);
  assert.match(cs[0].message, /30"/);
  assert.match(cs[0].message, /under 36/);
  // Spread them to 48" and the warning goes away.
  doc.items[1] = { ...doc.items[1], y: 72 };
  assert.equal(codes(runChecks(doc), "aisle_narrow").length, 0);
});

test("dishwasher 60\" from the sink → dw_far_from_sink", () => {
  const doc = emptyDoc();
  doc.items = [
    item({ id: "s", kind: "plumbing", libraryKey: "sink-undermount", label: "Sink", w: 30, d: 22, h: 10, z: 26 }),
    item({ id: "dw", kind: "appliance", libraryKey: "dishwasher-24", label: "Dishwasher", w: 24, d: 24, h: 34, x: 15 + 60 + 12 }),
  ];
  const cs = codes(runChecks(doc), "dw_far_from_sink");
  assert.equal(cs.length, 1);
  assert.match(cs[0].message, /60"/);
  doc.items[1] = { ...doc.items[1], x: 15 + 12 }; // right beside the sink
  assert.equal(codes(runChecks(doc), "dw_far_from_sink").length, 0);
});

test("ignored ids are excluded and ids are stable across runs", () => {
  const doc = emptyDoc();
  doc.items = [item({ id: "b1", x: 18 }), item({ id: "b2", x: 30 })];
  const first = runChecks(doc);
  const second = runChecks(doc);
  assert.deepEqual(first.map((c) => c.id), second.map((c) => c.id));
  const target = first.find((c) => c.code === "items_overlap");
  assert.ok(target);
  const ignored = { ...doc, ignoredChecks: [target.id] };
  assert.equal(runChecks(ignored).some((c) => c.id === target.id), false);
  assert.equal(runChecks(ignored).length, first.length - 1);
});

test("geometry: unclosed loop, opening past the wall end, item in wall, run gap", () => {
  const doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  const open = { ...doc, walls: doc.walls.slice(0, 3) }; // three walls, no room
  assert.equal(codes(runChecks(open), "room_unclosed").length, 1);
  const closed = withRooms(doc);
  assert.equal(codes(runChecks(closed), "room_unclosed").length, 0);

  const top = closed.walls[0]; // (0,0)→(144,0)
  closed.openings.push({ id: "d1", wallId: top.id, atIn: 130, widthIn: 32, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "left", phase: "new", tag: "" });
  assert.equal(codes(runChecks(closed), "opening_too_wide").length, 1);
  closed.openings = [];

  // Base cabinet whose back is 6" into the top wall.
  closed.items = [item({ id: "in", x: 40, y: 6, rotDeg: 0 })];
  assert.equal(codes(runChecks(closed), "item_in_wall").length, 1);
  // Same cabinet flush to the inside face (wall face at y=2.25): centre y = 2.25 + 12.
  closed.items = [item({ id: "ok", x: 40, y: 14.25, rotDeg: 0 })];
  assert.equal(codes(runChecks(closed), "item_in_wall").length, 0);

  // Run along the top wall with a 3" gap and a 12" gap.
  closed.items = [
    item({ id: "r1", x: 18, y: 14.25, wallId: top.id }),
    item({ id: "r2", x: 18 + 36 + 3, y: 14.25, wallId: top.id }),
    item({ id: "r3", x: 18 + 36 + 3 + 36 + 12, y: 14.25, wallId: top.id }),
  ];
  const gaps = codes(runChecks(closed), "run_gap");
  assert.equal(gaps.length, 2);
  assert.equal(gaps.find((g) => g.elementIds.includes("r1")).severity, "warn");
  assert.equal(gaps.find((g) => g.elementIds.includes("r3")).severity, "info");
});

test("code group: egress, smoke, stair rise/run, gfci, range 240", () => {
  const doc = withRooms({ ...emptyDoc(), walls: rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing") });
  doc.rooms[0] = { ...doc.rooms[0], name: "Bedroom 2" };
  let cs = runChecks(doc);
  assert.equal(codes(cs, "egress_window").length, 1);
  assert.match(codes(cs, "egress_window")[0].message, /^Check code:/);
  assert.equal(codes(cs, "smoke_missing").length, 1);
  const top = doc.walls[0];
  doc.openings.push({ id: "win", wallId: top.id, atIn: 40, widthIn: 36, heightIn: 48, sillIn: 30, kind: "window", subtype: "casement", hand: "L", swing: "left", phase: "new", tag: "" });
  doc.electrical.push({ id: "sm", levelId: L, type: "smoke", x: 72, y: 60, heightAff: 96, circuit: "", switchLegTo: [], phase: "new" });
  cs = runChecks(doc);
  assert.equal(codes(cs, "egress_window").length, 0);
  assert.equal(codes(cs, "smoke_missing").length, 0);

  doc.stairs.push({ id: "st", fromLevelId: L, toLevelId: "L2", shape: "straight", x: 20, y: 20, rotDeg: 0, widthIn: 36, riserCount: 14, riserIn: 8, treadIn: 9, phase: "new" });
  cs = runChecks(doc);
  assert.equal(codes(cs, "stair_rise_run").length, 1);
  assert.equal(codes(cs, "stair_light").length, 1);
  assert.equal(codes(cs, "headroom").length, 0, "second level absent → skip");

  doc.items = [
    item({ id: "s", kind: "plumbing", libraryKey: "sink-undermount", label: "Sink", w: 30, d: 22, h: 10, z: 26, x: 72, y: 14 }),
    item({ id: "r", kind: "appliance", libraryKey: "range-30", label: "Range", w: 30, d: 26, h: 36, x: 120, y: 15 }),
  ];
  cs = runChecks(doc);
  assert.equal(codes(cs, "gfci_missing").length, 1);
  assert.equal(codes(cs, "range_240").length, 1);
  doc.electrical.push(
    { id: "g", levelId: L, type: "gfci", x: 90, y: 4, heightAff: 42, circuit: "", switchLegTo: [], phase: "new" },
    { id: "o240", levelId: L, type: "outlet240", x: 120, y: 4, heightAff: 12, circuit: "", switchLegTo: [], phase: "new" },
  );
  cs = runChecks(doc);
  assert.equal(codes(cs, "gfci_missing").length, 0);
  assert.equal(codes(cs, "range_240").length, 0);
});

test("estimate group: unmapped measures, unpriced catalog items, generic cabinets", () => {
  const doc = emptyDoc();
  doc.items = [
    item({ id: "g1", x: 18 }),
    item({ id: "c1", x: 60, catalogId: 7 }),
    item({ id: "c2", x: 100, catalogId: 8 }),
  ];
  const cs = runChecks(doc, { catalogPrices: { 7: 12000, 8: null }, costRuleKeys: new Set(["cab_base_lf"]) });
  assert.equal(codes(cs, "generic_cabinet").length, 1);
  assert.deepEqual(codes(cs, "item_no_price").map((c) => c.elementIds), [["c2"]]);
  const unmapped = codes(cs, "measure_unmapped");
  assert.ok(unmapped.every((c) => c.severity === "info"));
  assert.ok(unmapped.some((c) => c.id === "measure_unmapped:cab_base_ea"));
  assert.ok(!unmapped.some((c) => c.id === "measure_unmapped:cab_base_lf"));
});

test("runChecks does not mutate the doc", () => {
  const doc = withRooms({ ...emptyDoc(), walls: rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing") });
  doc.items = [item({ id: "b1", x: 18, y: 14.25 }), item({ id: "b2", x: 30, y: 14.25 })];
  const before = JSON.stringify(doc);
  runChecks(doc, { catalogPrices: {}, costRuleKeys: new Set() });
  assert.equal(JSON.stringify(doc), before);
});
