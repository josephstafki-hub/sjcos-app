import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, MAIN_LEVEL_ID, PlanDocSchema } from "../lib/plan-doc.ts";
import { itemCorners } from "../lib/plan-geometry.ts";
import {
  LIBRARY,
  libraryItem,
  libraryByFamily,
  searchLibrary,
  itemFromLibrary,
  cabinetTag,
  FINISH_PRESETS,
  finishPreset,
  finishRef,
  DEFAULT_FINISH_KEYS,
  ELEC_SYMBOLS,
  elecSymbol,
  DOOR_SUBTYPES,
  WINDOW_SUBTYPES,
  OPENING_SUBTYPES,
  DOOR_STYLES,
  EDGE_PROFILES,
  TRIM_PROFILES,
  ROOM_TEMPLATES,
  roomTemplate,
} from "../lib/plan-library.ts";

const itemSchema = PlanDocSchema.shape.items.element;
const wallSchema = PlanDocSchema.shape.walls.element;
const openingSchema = PlanDocSchema.shape.openings.element;
const noteSchema = PlanDocSchema.shape.notes.element;

test("library is comprehensive with unique keys and valid dims", () => {
  assert.ok(LIBRARY.length > 150, `expected > 150 entries, got ${LIBRARY.length}`);
  const keys = new Set(LIBRARY.map((i) => i.key));
  assert.equal(keys.size, LIBRARY.length, "duplicate library keys");
  for (const it of LIBRARY) {
    assert.ok(it.w > 0 && it.d > 0 && it.h > 0, `${it.key} has a non-positive dimension`);
    assert.ok(it.z >= 0, `${it.key} z below floor`);
    assert.ok(it.tag.length > 0 && it.tag.length <= 16, `${it.key} tag`);
    assert.equal(it.search, it.search.toLowerCase(), `${it.key} search not lowercase`);
    assert.ok(it.search.includes(it.tag.toLowerCase()), `${it.key} search lacks tag`);
  }
  // Spec'd anchors.
  for (const k of ["base-B36", "base-SB36", "base-DB24", "base-BLC39", "base-LS36", "base-DCB36", "wall-W3030", "wall-WDC2430", "tall-T2484", "tall-TOC3084", "vanity-VB30", "vanity-VSB30", "vanity-VDB18", "acc-filler-3", "appl-range-30", "appl-fridge-36-cd", "appl-dw-24", "appl-hood-30", "plumb-toilet", "plumb-tub-60", "plumb-water-heater", "furn-bed-queen", "struct-post-4x4"]) {
    assert.ok(libraryItem(k), `missing ${k}`);
  }
  assert.equal(libraryItem("nope"), null);
  assert.equal(libraryItem("wall-W3030").z, 54);
  assert.equal(libraryItem("wall-W3030").h, 30);
  assert.equal(libraryItem("wall-W0930").w, 9);
  assert.equal(libraryItem("appl-hood-30").z, 66);
  assert.equal(libraryItem("base-B21").props.doors, 1);
  assert.equal(libraryItem("base-B24").props.doors, 2);
  assert.equal(libraryItem("base-DB24").props.drawers, 3);
  // Wall grid: 14 widths × 7 heights.
  const grid = LIBRARY.filter((i) => i.kind === "wall" && /^wall-W\d{4}$/.test(i.key));
  assert.equal(grid.length, 14 * 7);
});

test("libraryByFamily / searchLibrary", () => {
  assert.ok(libraryByFamily("cabinet").length > 100);
  assert.ok(libraryByFamily("appliance").every((i) => i.kind === "appliance"));
  const ranges = searchLibrary("range");
  assert.ok(ranges.length >= 3);
  assert.ok(ranges.some((i) => i.key === "appl-range-30"));
  assert.ok(ranges.slice(0, 5).every((i) => i.family === "appliance" || i.family === "cabinet"));
  assert.equal(searchLibrary("rng30")[0].key, "appl-range-30");
  assert.equal(searchLibrary("B36")[0].key, "base-B36");
  assert.equal(searchLibrary("w3030")[0].key, "wall-W3030");
  assert.ok(searchLibrary("sink", "base").every((i) => i.kind === "base"));
  assert.ok(searchLibrary("sink", "base").some((i) => i.key === "base-SB36"));
  assert.equal(searchLibrary("", "tall").length, LIBRARY.filter((i) => i.kind === "tall").length);
  assert.equal(searchLibrary("zzz-nothing").length, 0);
});

test("itemFromLibrary builds a valid PlacedItem", () => {
  const it = itemFromLibrary("base-B36", MAIN_LEVEL_ID, { x: 100, y: 50 }, 90);
  assert.ok(it);
  assert.equal(it.kind, "base");
  assert.equal(it.tag, "B36");
  assert.equal(it.libraryKey, "base-B36");
  assert.equal(it.catalogId, null);
  assert.equal(it.phase, "new");
  assert.equal(it.rotDeg, 90);
  assert.deepEqual([it.w, it.d, it.h, it.z], [36, 24, 34.5, 0]);
  assert.ok(itemSchema.safeParse(it).success);
  // Props are copied, not shared.
  it.props.doors = 99;
  assert.equal(libraryItem("base-B36").props.doors, 2);
  assert.equal(itemFromLibrary("nope", MAIN_LEVEL_ID, { x: 0, y: 0 }), null);
  // Every library entry produces a schema-valid item.
  for (const li of LIBRARY) {
    const p = itemFromLibrary(li.key, MAIN_LEVEL_ID, { x: 0, y: 0 });
    const r = itemSchema.safeParse(p);
    assert.ok(r.success, `${li.key}: ${r.success ? "" : r.error.issues[0].path.join(".") + " " + r.error.issues[0].message}`);
  }
});

test("cabinetTag", () => {
  assert.equal(cabinetTag("base", 36, 34.5), "B36");
  assert.equal(cabinetTag("base", 9, 34.5), "B9");
  assert.equal(cabinetTag("base", 36, 34.5, { sink: true }), "SB36");
  assert.equal(cabinetTag("base", 24, 34.5, { drawers: 3, doors: 0 }), "DB24");
  assert.equal(cabinetTag("base", 39, 34.5, { corner: "blind" }), "BLC39");
  assert.equal(cabinetTag("base", 36, 34.5, { corner: "lazy" }), "LS36");
  assert.equal(cabinetTag("base", 36, 34.5, { corner: "diag" }), "DCB36");
  assert.equal(cabinetTag("wall", 30, 30), "W3030");
  assert.equal(cabinetTag("wall", 9, 30), "W0930");
  assert.equal(cabinetTag("wall", 24, 30, { corner: "diag" }), "WDC2430");
  assert.equal(cabinetTag("wall", 36, 15, { over: "fridge" }), "W361524");
  assert.equal(cabinetTag("tall", 24, 84), "T2484");
  assert.equal(cabinetTag("tall", 30, 84, { oven: true }), "TOC3084");
  assert.equal(cabinetTag("vanity", 30, 34.5), "VB30");
  assert.equal(cabinetTag("vanity", 18, 34.5, { drawers: 3, doors: 0 }), "VDB18");
  assert.equal(cabinetTag("vanity", 30, 34.5, { falseFront: true }), "VSB30");
  assert.equal(cabinetTag("appliance", 30, 36), "");
  // Library tags agree with cabinetTag for every cabinet.
  for (const li of LIBRARY.filter((i) => i.family === "cabinet" && i.kind !== "generic")) {
    assert.equal(cabinetTag(li.kind, li.w, li.h, li.props), li.tag, li.key);
  }
});

test("finish presets and finishRef fallback", () => {
  assert.ok(FINISH_PRESETS.length >= 40);
  const keys = new Set(FINISH_PRESETS.map((p) => p.key));
  assert.equal(keys.size, FINISH_PRESETS.length);
  for (const p of FINISH_PRESETS) {
    assert.match(p.color, /^#[0-9a-f]{6}$/, p.key);
    assert.ok(p.roughness >= 0 && p.roughness <= 1 && p.metalness >= 0 && p.metalness <= 1, p.key);
  }
  assert.ok(FINISH_PRESETS.filter((p) => p.category === "tile").every((p) => p.defaultPattern));
  for (const k of Object.values(DEFAULT_FINISH_KEYS)) assert.ok(finishPreset(k), `default finish ${k} missing`);
  assert.ok(finishPreset(DEFAULTS.finish), "plan-doc DEFAULTS.finish resolves");
  assert.equal(finishPreset("nope"), null);

  const ref = finishRef("tile-subway-white");
  assert.equal(ref.key, "tile-subway-white");
  assert.equal(ref.pattern.layout, "offset");
  assert.equal(ref.textureKey, "tile-subway");
  const fb = finishRef("does-not-exist");
  assert.equal(fb.key, "paint-gray");
  assert.equal(fb.color, finishPreset("paint-gray").color);
  const ov = finishRef("cab-walnut", { label: "Custom walnut", catalogId: 7 });
  assert.equal(ov.key, "cab-walnut");
  assert.equal(ov.label, "Custom walnut");
  assert.equal(ov.catalogId, 7);
  // FinishRef shape validates against the doc schema (via a counter).
  const counterSchema = PlanDocSchema.shape.counters.element;
  const c = { id: "c1", levelId: "L1", runId: null, polygon: [], thickIn: 1.25, overhang: { front: 1.5, back: 0, left: 0, right: 0 }, edge: "eased", material: ref, backsplashIn: 4, seams: [], waterfall: [] };
  assert.ok(counterSchema.safeParse(c).success);
});

test("every ElecType has a symbol", () => {
  const types = PlanDocSchema.shape.electrical.element.shape.type.options;
  assert.equal(types.length, 19);
  const have = new Set(ELEC_SYMBOLS.map((s) => s.type));
  for (const t of types) assert.ok(have.has(t), `missing symbol for ${t}`);
  assert.equal(ELEC_SYMBOLS.length, types.length);
  assert.equal(elecSymbol("gfci").group, "power");
  assert.equal(elecSymbol("recessed").wallMounted, false);
  assert.equal(elecSymbol("switch").defaultHeightAff, 48);
  assert.equal(elecSymbol("miniSplit").group, "hvac");
});

test("vocabularies", () => {
  assert.deepEqual(DOOR_SUBTYPES.map((d) => d.key), ["hinged", "pocket", "bifold", "sliding", "french", "cased", "barn"]);
  assert.deepEqual(WINDOW_SUBTYPES.map((w) => w.key), ["single", "double", "picture", "casement", "slider", "bay", "transom"]);
  assert.deepEqual(OPENING_SUBTYPES.map((o) => o.key), ["cased", "arched", "passthrough"]);
  assert.deepEqual(DOOR_STYLES.map((d) => d.key), ["slab", "shaker", "raised", "beaded", "glass"]);
  assert.ok(DOOR_STYLES.some((d) => d.key === DEFAULTS.doorStyle));
  assert.deepEqual(EDGE_PROFILES.map((e) => e.key), ["eased", "bullnose", "bevel", "ogee", "mitred", "waterfall"]);
  for (const k of ["base", "crown", "casing", "chair"]) {
    assert.ok(TRIM_PROFILES[k].length >= 2, k);
    assert.ok(TRIM_PROFILES[k].every((p) => p.heightIn > 0));
  }
});

/** Axis-aligned bounds of a rotated footprint. */
function itemBounds(it) {
  const pts = itemCorners(it);
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

function overlaps(a, b) {
  const eps = 0.01;
  return a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minY < b.maxY - eps && b.minY < a.maxY - eps;
}

test("room templates build inside their rectangle", () => {
  assert.equal(ROOM_TEMPLATES.length, 10);
  assert.ok(roomTemplate("kitchen-galley"));
  assert.equal(roomTemplate("nope"), null);
  const origin = { x: 120, y: 240 };
  for (const t of ROOM_TEMPLATES) {
    const frag = t.build(MAIN_LEVEL_ID, origin, DEFAULTS);
    assert.ok(frag.walls.length >= 4, `${t.key} walls`);
    assert.ok(frag.walls.every((w) => w.kind === "existing" && w.levelId === MAIN_LEVEL_ID));
    for (const w of frag.walls) assert.ok(wallSchema.safeParse(w).success, `${t.key} wall schema`);
    for (const o of frag.openings) assert.ok(openingSchema.safeParse(o).success, `${t.key} opening schema`);
    for (const n of frag.notes ?? []) assert.ok(noteSchema.safeParse(n).success, `${t.key} note schema`);

    // Ids are fresh and unique across the fragment.
    const ids = [...frag.walls, ...frag.openings, ...frag.items, ...(frag.notes ?? [])].map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `${t.key} duplicate ids`);

    // Room rectangle from the walls; interior is the template's clear size.
    const xs = frag.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = frag.walls.flatMap((w) => [w.a.y, w.b.y]);
    const rect = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    assert.equal(rect.minX, origin.x);
    assert.equal(rect.minY, origin.y);
    assert.equal(rect.maxX - rect.minX, t.widthIn + DEFAULTS.wallThickIn);
    assert.equal(rect.maxY - rect.minY, t.depthIn + DEFAULTS.wallThickIn);
    const inner = {
      minX: rect.minX + DEFAULTS.wallThickIn / 2,
      maxX: rect.maxX - DEFAULTS.wallThickIn / 2,
      minY: rect.minY + DEFAULTS.wallThickIn / 2,
      maxY: rect.maxY - DEFAULTS.wallThickIn / 2,
    };

    // Openings sit on their wall within its length.
    const wallById = new Map(frag.walls.map((w) => [w.id, w]));
    for (const o of frag.openings) {
      const w = wallById.get(o.wallId);
      assert.ok(w, `${t.key} opening wall`);
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      assert.ok(o.atIn >= 0 && o.atIn + o.widthIn <= len + 0.01, `${t.key} opening ${o.tag} off its wall`);
    }

    if (t.key !== "empty-12x12") assert.ok(frag.items.length > 0, `${t.key} has items`);
    for (const it of frag.items) {
      const r = itemSchema.safeParse(it);
      assert.ok(r.success, `${t.key} item ${it.tag}: ${r.success ? "" : r.error.issues[0].path.join(".")}`);
      assert.equal(it.levelId, MAIN_LEVEL_ID);
      assert.equal(it.phase, "new");
      assert.equal(it.catalogId, null);
      assert.ok(it.libraryKey && libraryItem(it.libraryKey), `${t.key} item libraryKey`);
      const b = itemBounds(it);
      const eps = 0.01;
      assert.ok(
        b.minX >= inner.minX - eps && b.maxX <= inner.maxX + eps && b.minY >= inner.minY - eps && b.maxY <= inner.maxY + eps,
        `${t.key}: ${it.tag} at (${it.x},${it.y}) rot ${it.rotDeg} spills outside the room`,
      );
    }

    // Floor-standing items must not overlap each other.
    const floor = frag.items.filter((i) => i.z === 0);
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        assert.ok(!overlaps(itemBounds(floor[i]), itemBounds(floor[j])), `${t.key}: ${floor[i].tag} overlaps ${floor[j].tag}`);
      }
    }
  }
});

test("room template respects designer defaults", () => {
  const frag = roomTemplate("empty-12x12").build("L2", { x: 0, y: 0 }, { ...DEFAULTS, wallThickIn: 6.5, ceilingIn: 108, doorWidthIn: 36 });
  assert.ok(frag.walls.every((w) => w.thickIn === 6.5 && w.heightIn === 108 && w.levelId === "L2"));
  assert.equal(frag.openings[0].widthIn, 36);
  assert.equal(frag.openings[0].kind, "door");
});
