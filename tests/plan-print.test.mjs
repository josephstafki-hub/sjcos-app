import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { emptyDoc, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { fitScale, drawOpsToPdf, renderPlanSheetsCore } from "../lib/plan-print-core.ts";

const L = MAIN_LEVEL_ID;

/** 12' × 14' kitchen: top wall is walls[0]; a door, three base cabinets, a range, an outlet. */
function kitchen() {
  let doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 168 }, 4.5, 96, "existing");
  const top = doc.walls[0];
  const right = doc.walls[1];
  doc.openings.push(
    { id: "door", wallId: right.id, atIn: 40, widthIn: 32, heightIn: 80, sillIn: 0, kind: "door", subtype: "hinged", hand: "L", swing: "right", phase: "existing", tag: "D1" },
    { id: "win", wallId: top.id, atIn: 100, widthIn: 36, heightIn: 48, sillIn: 36, kind: "window", subtype: "double", hand: "L", swing: "right", phase: "existing", tag: "W1" },
  );
  const cab = (id, tag, x) => ({
    id, levelId: L, kind: "base", catalogId: null, libraryKey: "base", label: "Base cabinet", tag,
    x, y: 12, z: 0, rotDeg: 0, w: 36, d: 24, h: 34.5, phase: "new", wallId: top.id, runId: "run1", props: { finish: "Paint white" },
  });
  doc.items.push(cab("b1", "B36", 18), cab("b2", "SB36", 54), cab("b3", "B36-2", 90));
  doc.runs.push({ id: "run1", levelId: L, wallId: top.id, tier: "base", itemIds: ["b1", "b2", "b3"], accessories: [] });
  doc.items.push({
    id: "range", levelId: L, kind: "appliance", catalogId: null, libraryKey: "range-30", label: "Range", tag: "R1",
    x: 123, y: 12.5, z: 0, rotDeg: 0, w: 30, d: 25, h: 36, phase: "new", wallId: top.id, runId: null, props: {},
  });
  doc.electrical.push(
    { id: "out", levelId: L, type: "outlet", x: 36, y: 3, heightAff: 42, wallId: top.id, circuit: "K1", switchLegTo: [], phase: "new" },
    { id: "sw", levelId: L, type: "switch", x: 141, y: 90, heightAff: 48, wallId: right.id, circuit: "", switchLegTo: ["rl"], phase: "new" },
    { id: "rl", levelId: L, type: "recessed", x: 72, y: 84, heightAff: 96, wallId: null, circuit: "", switchLegTo: [], phase: "new" },
  );
  doc.walls.push({ id: "gone", levelId: L, a: { x: 72, y: 100 }, b: { x: 144, y: 100 }, thickIn: 4.5, heightIn: 96, kind: "remove" });
  doc = withRooms(doc);
  if (doc.rooms[0]) doc.rooms[0].name = "Kitchen";
  return doc;
}

function baseInput(doc, overrides = {}) {
  return {
    doc,
    designName: "Kitchen",
    versionLabel: "v1 · Test",
    dateLabel: "September 16, 2026",
    project: { name: "Henderson kitchen", clientName: "Pat Henderson", address: "123 Elm St, Edina MN" },
    company: { name: "SJ Carpentry LLC", license: "BC123456", address: "Minneapolis, MN", phone: "612-361-6585", email: "joe@example.com" },
    sheets: ["cover", "new", "cabinet", "electrical", "elevations", "schedules"],
    paper: "letter",
    orientation: "landscape",
    captures: [],
    notes: "Verify all dimensions in the field.",
    watermark: "NOT FOR CONSTRUCTION",
    ...overrides,
  };
}

function pageCount(buf) {
  const s = buf.toString("latin1");
  const pages = (s.match(/\/Type \/Page/g) ?? []).length;
  const trees = (s.match(/\/Type \/Pages/g) ?? []).length;
  return pages - trees;
}

test("fitScale picks 1/4\" = 1' for a 30' × 20' room on letter landscape", () => {
  // Letter landscape drawing area: 792 − 72 margins wide, 612 − 72 − 54 title block tall.
  const sc = fitScale({ w: 360, h: 240 }, { w: 720, h: 486 });
  assert.equal(sc.label, '1/4" = 1\'-0"');
  assert.ok(Math.abs(sc.ptPerIn - 72 / 48) < 1e-9);
  // A small room on a big sheet gets 1/2".
  assert.equal(fitScale({ w: 120, h: 96 }, { w: 720, h: 486 }).label, '1/2" = 1\'-0"');
  // Too big for any standard scale → custom ratio that still fits.
  const huge = fitScale({ w: 3000, h: 2000 }, { w: 720, h: 486 });
  assert.ok(huge.label.startsWith("1 : "), huge.label);
  assert.ok(3000 * huge.ptPerIn <= 720 + 1e-6);
});

test("drawOpsToPdf renders every primitive without throwing", async () => {
  const pdf = new PDFDocument({ size: "LETTER", margin: 0 });
  const chunks = [];
  pdf.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => pdf.on("end", res));
  const s = { stroke: "#000000", strokeWidth: "hairline" };
  const ops = [
    { t: "line", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, s, layer: "walls" },
    { t: "polyline", pts: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }], s: { ...s, dash: [2, 1] }, layer: "walls" },
    { t: "polygon", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], s: { ...s, fill: "#cccccc", hatch: "diag" }, layer: "walls" },
    { t: "polygon", pts: [{ x: 0, y: 60 }, { x: 40, y: 60 }, { x: 40, y: 90 }], s: { ...s, hatch: "cross", opacity: 0.5 }, layer: "walls" },
    { t: "rect", x: 10, y: 10, w: 30, h: 20, rotDeg: 30, s: { ...s, fill: "#eeeeee", hatch: "dots", strokeWidth: 0.5 }, layer: "cabinets" },
    { t: "circle", c: { x: 50, y: 50 }, r: 10, s: { ...s, fill: "none" }, layer: "plumbing" },
    { t: "arc", c: { x: 50, y: 50 }, r: 20, startDeg: 0, endDeg: 90, s, layer: "openings" },
    { t: "text", p: { x: 50, y: 50 }, text: "B36 ⅛ ½", size: 6, anchor: "middle", baseline: "middle", weight: "bold", s: { fill: "#000000" }, layer: "notes" },
    { t: "text", p: { x: 10, y: 80 }, text: "rotated", size: 5, rotDeg: -90, anchor: "end", font: "mono", s: {}, layer: "dims" },
    { t: "image", fileId: "x", x: 0, y: 0, w: 10, h: 10, layer: "underlay" },
  ];
  drawOpsToPdf(pdf, ops, { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } }, { x: 36, y: 36, w: 540, h: 700 }, 3);
  pdf.end();
  await done;
  const buf = Buffer.concat(chunks);
  assert.ok(buf.subarray(0, 4).toString() === "%PDF");
});

test("renderPlanSheetsCore builds a multi-sheet set for the kitchen", async () => {
  const buf = await renderPlanSheetsCore(baseInput(kitchen()));
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  const n = pageCount(buf);
  assert.ok(n >= 6, `expected ≥ 6 pages, got ${n}`);
});

test("captures render on the views sheet and the cover", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
  const buf = await renderPlanSheetsCore(
    baseInput(kitchen(), {
      sheets: ["cover", "views", "demo", "finish", "notes", "sections"],
      paper: "tabloid",
      orientation: "portrait",
      captures: [
        { fileId: "cap-1", label: "Kitchen from the door", png },
        { fileId: "cap-2", label: "Island view", png },
        { fileId: "cap-3", label: "Sink wall", png },
      ],
      watermark: null,
    }),
  );
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  // cover + 2 view pages + demo + finish + notes; sections skipped (none drawn).
  assert.equal(pageCount(buf), 6);
});

test("rejects an empty sheet list", async () => {
  await assert.rejects(renderPlanSheetsCore(baseInput(kitchen(), { sheets: [] })), /No sheets/);
});
