import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc } from "../lib/plan-doc.ts";
import { applyOp, applyOps } from "../lib/plan-ops.ts";
import { libraryItem } from "../lib/plan-library.ts";
import { cabinetHardwareCount, cabinetLayout, cabinetStyle, pickCabinetStyle } from "../lib/plan-cabinet.ts";
import { computeMeasures } from "../lib/plan-measures.ts";

const lib = (key, props = {}) => {
  const li = libraryItem(key);
  return { kind: li.kind, w: li.w, h: li.h, tag: li.tag, label: li.label, libraryKey: li.key, props: { ...li.props, ...props } };
};

test("style resolves item → design → defaults → built-in", () => {
  const doc = emptyDoc();
  assert.equal(cabinetStyle({ props: {} }, doc).doorStyle, "shaker"); // designer default
  doc.settings.cabinetStyle = { doorStyle: "slab", hardware: "knob" };
  const s = cabinetStyle({ props: { doorStyle: "raised" } }, doc);
  assert.equal(s.doorStyle, "raised");
  assert.equal(s.hardware, "knob");
  assert.equal(s.construction, "framed");
  // Old designs: a "glass" door style means glass doors.
  assert.equal(cabinetStyle({ props: { doorStyle: "glass" } }, doc).glass, true);
  // Custom colour wins; a wood preset brings its texture unless recoloured.
  assert.equal(cabinetStyle({ props: { finish: "custom", finishColor: "#123456" } }, doc).color, "#123456");
  assert.equal(cabinetStyle({ props: { finish: "cab-walnut", finishColor: "#5c3f2c" } }, doc).textureKey, "wood-walnut");
  assert.deepEqual(pickCabinetStyle({ doorStyle: "slab", doors: 2, hardware: "bar" }), { doorStyle: "slab", hardware: "bar" });
});

test("B36: two drawers over two doors; bar pulls at the latch edge, near the top", () => {
  const it = lib("base-B36");
  const lay = cabinetLayout(it, cabinetStyle(it, emptyDoc()));
  const drawers = lay.fronts.filter((f) => f.kind === "drawer");
  const doors = lay.fronts.filter((f) => f.kind === "door");
  assert.equal(drawers.length, 2);
  assert.equal(doors.length, 2);
  assert.deepEqual(doors.map((d) => d.hinge), ["L", "R"]);
  const left = doors[0];
  assert.ok(left.pulls[0].x > (left.x0 + left.x1) / 2, "left door pulls on its right (latch) edge");
  assert.ok(left.pulls[0].z > (left.z0 + left.z1) / 2, "base door pulls near the top");
  assert.ok(lay.toe > 0 && lay.frame.length > 0 && lay.frontOffset > 0);
  // Fronts stay inside the box.
  for (const f of lay.fronts) assert.ok(f.x0 >= -18 - 1e-9 && f.x1 <= 18 + 1e-9 && f.z0 >= lay.toe - 1e-9 && f.z1 <= it.h + 1e-9);
});

test("drawer base, sink base, wall and tall layouts", () => {
  const db = lib("base-DB18");
  const dbl = cabinetLayout(db, cabinetStyle(db, emptyDoc()));
  assert.equal(dbl.fronts.filter((f) => f.kind === "drawer").length, 3);
  assert.equal(dbl.fronts.length, 3);
  const heights = dbl.fronts.map((f) => f.z1 - f.z0);
  assert.ok(heights[0] < heights[1], "graduated: shallow top drawer");

  const sb = lib("base-SB36");
  const sbl = cabinetLayout(sb, cabinetStyle(sb, emptyDoc()));
  const ff = sbl.fronts.find((f) => f.kind === "false");
  assert.ok(ff && ff.pulls.length === 0);

  const wc = lib("wall-W3030");
  const wl = cabinetLayout(wc, cabinetStyle(wc, emptyDoc()));
  assert.equal(wl.toe, 0);
  const d0 = wl.fronts[0];
  assert.ok(d0.pulls[0].z < (d0.z0 + d0.z1) / 2, "upper doors pull near the bottom");

  const oven = lib("tall-TOC3084");
  const ol = cabinetLayout(oven, cabinetStyle(oven, emptyDoc()));
  assert.equal(ol.fronts.filter((f) => f.kind === "appliance").length, 1);
});

test("construction, hardware and legs change the layout", () => {
  const it = lib("base-B24", { construction: "frameless", hardware: "knob", toe: "legs" });
  const lay = cabinetLayout(it, cabinetStyle(it, emptyDoc()));
  assert.equal(lay.frame.length, 0);
  assert.equal(lay.frontOffset, 0);
  assert.equal(lay.toeStyle, "legs");
  const hw = cabinetHardwareCount(lay);
  assert.ok(hw.knobs >= 2 && hw.pulls === 0);
  const none = lib("base-B24", { hardware: "none" });
  assert.deepEqual(cabinetHardwareCount(cabinetLayout(none, cabinetStyle(none, emptyDoc()))), { pulls: 0, knobs: 0 });
  const inset = lib("base-B24", { construction: "inset" });
  const il = cabinetLayout(inset, cabinetStyle(inset, emptyDoc()));
  assert.ok(il.frame.length > 0 && il.frontOffset === 0);
});

test("new cabinets pick up the design's style; takeoff counts hardware", () => {
  let d = applyOp(emptyDoc(), { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 144, y: 120 } });
  d = applyOp(d, { op: "setSettings", patch: { cabinetStyle: { doorStyle: "slab", hardware: "knob", hardwareFinish: "metal-brass" } } });
  d = applyOps(d, [{ op: "placeItem", libraryKey: "base-B18", at: { x: 40, y: 10 } }]);
  const cab = d.items[0];
  assert.equal(cab.props.doorStyle, "slab");
  assert.equal(cab.props.hardware, "knob");
  const ms = computeMeasures(d);
  const knobs = ms.find((m) => m.key === "cab_knob_ea");
  assert.ok(knobs && knobs.qty >= 2);
});
