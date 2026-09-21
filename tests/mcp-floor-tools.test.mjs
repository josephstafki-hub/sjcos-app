// Exercises mcp/floor-tools.mjs against a fake MCP server and an in-memory
// stand-in for rows(). The stub answers the handful of SQL shapes the module
// issues (matched on leading keywords), so the tests cover the real op
// pipeline (applyOps → parseDoc → write) without a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerFloorTools } from "../mcp/floor-tools.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => JSON.parse(res.content[0].text);

function fakeDb() {
  const db = { designs: new Map(), versions: [], comments: [], nextId: 1, writes: 0 };
  const rows = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT id FROM projects WHERE slug/i.test(s)) return params[0] === "demo-project" ? [{ id: "p-uuid" }] : [];
    if (/^SELECT slug FROM leads WHERE slug/i.test(s)) return params[0] === "demo-lead" ? [{ slug: "demo-lead" }] : [];
    if (/^SELECT key, value FROM app_settings/i.test(s)) return [];
    if (/^SELECT d\.id, d\.name.*FROM plan_designs d/i.test(s)) {
      const all = [...db.designs.values()].map((d) => ({ ...d, project_slug: d.project_id ? "demo-project" : null, version_count: db.versions.filter((v) => v.design_id === d.id).length }));
      if (/WHERE d\.id = \$1/.test(s)) return all.filter((d) => d.id === Number(params[0]));
      return all;
    }
    if (/^INSERT INTO plan_designs/i.test(s)) {
      db.writes++;
      const id = db.nextId++;
      db.designs.set(id, { id, project_id: params[0], lead_slug: params[1], name: params[2], is_template: false, doc: JSON.parse(params[3]), rev: 0, updated_at: new Date() });
      return [{ id }];
    }
    if (/^UPDATE plan_designs SET doc/i.test(s)) {
      const d = db.designs.get(Number(params[0]));
      if (!d) return [];
      if (params[2] != null && d.rev !== params[2]) return [];
      db.writes++;
      d.doc = JSON.parse(params[1]);
      d.rev += 1;
      return [{ rev: d.rev }];
    }
    if (/^SELECT COALESCE\(MAX\(number\), 0\) \+ 1 AS n FROM plan_design_versions/i.test(s))
      return [{ n: db.versions.filter((v) => v.design_id === Number(params[0])).length + 1 }];
    if (/^INSERT INTO plan_design_versions/i.test(s)) {
      db.writes++;
      const v = { id: 100 + db.versions.length, design_id: params[0], number: params[1], label: params[2], doc: JSON.parse(params[3]), created_at: new Date() };
      db.versions.push(v);
      return [{ id: v.id, number: v.number }];
    }
    if (/^SELECT id, number, label, created_at, doc FROM plan_design_versions/i.test(s))
      return db.versions.filter((v) => v.design_id === Number(params[0])).sort((a, b) => b.number - a.number);
    if (/^SELECT id, number FROM plan_design_versions WHERE id/i.test(s))
      return db.versions.filter((v) => v.id === Number(params[0]) && v.design_id === Number(params[1]));
    if (/^INSERT INTO plan_design_comments/i.test(s)) {
      db.writes++;
      const c = { id: 500 + db.comments.length, design_id: params[0], version_id: params[1], anchor: JSON.parse(params[2]), author_name: params[3], body: params[4] };
      db.comments.push(c);
      return [{ id: c.id }];
    }
    throw new Error(`fakeRows: unhandled SQL: ${s.slice(0, 80)}`);
  };
  return { db, rows };
}

function setup() {
  const { db, rows } = fakeDb();
  const tools = new Map();
  const fakeServer = { registerTool: (name, spec, handler) => tools.set(name, { spec, handler }) };
  registerFloorTools(fakeServer, { rows, json });
  const call = async (name, args = {}) => parse(await tools.get(name).handler(args));
  return { db, tools, call };
}

test("registers the full §12 surface, every tool with a description and schema", () => {
  const { tools } = setup();
  const expected = [
    "list_plan_designs", "get_plan_design", "describe_plan_design", "create_plan_design", "duplicate_plan_design",
    "apply_plan_ops", "list_plan_library", "list_plan_finishes", "get_plan_measures", "run_plan_checks",
    "save_plan_version", "list_plan_versions", "stage_plan_sheet", "add_plan_comment",
  ];
  for (const n of expected) {
    assert.ok(tools.has(n), `missing tool ${n}`);
    assert.ok(tools.get(n).spec.description.length > 20, `${n} needs a description`);
    assert.ok(tools.get(n).spec.inputSchema, `${n} needs an inputSchema`);
  }
  assert.equal(tools.size, expected.length);
});

test("create_plan_design from the kitchen-l template stores a doc with walls, items and a room", async () => {
  const { db, call } = setup();
  const res = await call("create_plan_design", { project_slug: "demo-project", name: "Kitchen A", template_key: "kitchen-l" });
  assert.equal(res.ok, true);
  assert.ok(Number.isInteger(res.id) && res.id > 0);
  const stored = db.designs.get(res.id);
  assert.ok(stored.doc.walls.length >= 4, `expected >=4 walls, got ${stored.doc.walls.length}`);
  assert.ok(stored.doc.items.length > 5);
  assert.equal(stored.doc.rooms.length, 1);
  assert.equal(res.counts.walls, stored.doc.walls.length);
  assert.equal(stored.project_id, "p-uuid");
});

test("create_plan_design refuses an unknown scope, template, or half a rectangle", async () => {
  const { db, call } = setup();
  assert.equal((await call("create_plan_design", { project_slug: "nope", name: "x" })).ok, false);
  assert.equal((await call("create_plan_design", { lead_slug: "demo-lead", name: "x", template_key: "no-such" })).ok, false);
  assert.equal((await call("create_plan_design", { lead_slug: "demo-lead", name: "x", room_width_in: 120 })).ok, false);
  assert.equal(db.writes, 0);
  const ok = await call("create_plan_design", { lead_slug: "demo-lead", name: "Bath", room_width_in: 60, room_depth_in: 96 });
  assert.equal(ok.ok, true);
  assert.equal(ok.counts.walls, 4);
  assert.equal(ok.counts.rooms, 1);
});

test("apply_plan_ops [addRoomRect, addOpening, placeRun] bumps rev and reports counts + created ids", async () => {
  const { db, call } = setup();
  const { id } = await call("create_plan_design", { project_slug: "demo-project", name: "Empty" });
  const first = await call("apply_plan_ops", { design_id: id, ops: [{ op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 148.5, y: 172.5 }, name: "Kitchen" }] });
  assert.equal(first.ok, true);
  assert.equal(first.rev, 1);
  assert.equal(first.created.walls.length, 4);
  assert.deepEqual(first.applied, ["Draw room"]);
  const [top, , bottom] = first.created.walls;
  const second = await call("apply_plan_ops", {
    design_id: id,
    expected_rev: 1,
    ops: [
      { op: "addOpening", wallId: bottom, atIn: 56, kind: "door" },
      { op: "placeRun", wallId: top, side: "right", startIn: 0, keys: ["base-SB36", "appl-dw-24", "base-B24"] },
    ],
  });
  assert.equal(second.ok, true, second.error);
  assert.equal(second.rev, 2);
  assert.ok(second.counts.items >= 3, `items ${second.counts.items}`);
  assert.equal(second.counts.openings, 1);
  assert.equal(second.created.items.length, 3);
  assert.equal(second.created.openings.length, 1);
  assert.equal(db.designs.get(id).rev, 2);
  assert.equal(db.designs.get(id).doc.items.length, 3);
  assert.ok(Array.isArray(second.new_checks));
});

test("an invalid op returns ok:false and writes nothing; a stale expected_rev is refused", async () => {
  const { db, call } = setup();
  const { id } = await call("create_plan_design", { project_slug: "demo-project", name: "Empty" });
  const writesBefore = db.writes;
  const bad = await call("apply_plan_ops", {
    design_id: id,
    ops: [
      { op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: 148.5, y: 172.5 } },
      { op: "placeRun", wallId: "w_does_not_exist", side: "right", startIn: 0, keys: ["base-B36"] },
    ],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Op rejected/);
  assert.equal(db.writes, writesBefore);
  assert.equal(db.designs.get(id).rev, 0);
  assert.equal(db.designs.get(id).doc.walls.length, 0);

  const unknownOp = await call("apply_plan_ops", { design_id: id, ops: [{ op: "teleport" }] });
  assert.equal(unknownOp.ok, false);
  assert.equal(db.writes, writesBefore);

  const stale = await call("apply_plan_ops", { design_id: id, expected_rev: 7, ops: [{ op: "addNote", at: { x: 0, y: 0 }, text: "hi" }] });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /rev 0, not 7/);
  assert.equal(db.writes, writesBefore);

  const missing = await call("apply_plan_ops", { design_id: 999, ops: [{ op: "addNote", at: { x: 0, y: 0 }, text: "hi" }] });
  assert.equal(missing.ok, false);
});

test("describe_plan_design mentions the room count and the layout", async () => {
  const { call } = setup();
  const { id } = await call("create_plan_design", { project_slug: "demo-project", name: "Kitchen A", template_key: "kitchen-l" });
  const res = await call("describe_plan_design", { design_id: id });
  assert.equal(res.ok, true);
  assert.equal(typeof res.description, "string");
  assert.match(res.description, /1 room/);
  assert.match(res.description, /base/);
  assert.match(res.description, /check/);
  assert.ok(res.description.split(/\s+/).length < 140, "keep it short");
});

test("get_plan_design, measures, checks and library reads", async () => {
  const { call } = setup();
  const { id } = await call("create_plan_design", { project_slug: "demo-project", name: "Kitchen A", template_key: "kitchen-l" });
  const g = await call("get_plan_design", { design_id: id });
  assert.equal(g.ok, true);
  assert.equal(g.doc, undefined);
  assert.ok(g.walls.length >= 4 && typeof g.walls[0].length === "string");
  assert.ok(g.items.some((i) => i.kind === "appliance"));
  assert.ok(g.rooms[0].size.includes("x"));
  assert.ok(Array.isArray(g.measures) && Array.isArray(g.checks));
  const full = await call("get_plan_design", { design_id: id, include_doc: true });
  assert.equal(full.doc.v, 1);

  const m = await call("get_plan_measures", { design_id: id });
  assert.equal(m.ok, true);
  assert.ok(m.measures.length > 0 && m.summary.length > 0);
  const c = await call("run_plan_checks", { design_id: id });
  assert.equal(c.ok, true);
  assert.equal(c.count, c.checks.length);

  const lib = await call("list_plan_library", {});
  assert.ok(lib.items.length <= 60 && lib.room_templates.some((t) => t.key === "kitchen-l"));
  const fridge = await call("list_plan_library", { query: "fridge" });
  assert.ok(fridge.items.some((i) => i.key === "appl-fridge-36"));
  assert.equal(fridge.room_templates, undefined);
  const fin = await call("list_plan_finishes", {});
  assert.ok(fin.finishes.some((f) => f.key === "paint-white"));

  const list = await call("list_plan_designs", { project_slug: "demo-project" });
  assert.equal(list.designs.length, 1);
  assert.equal(list.designs[0].id, id);
});

test("versions, duplicate, sheet request and comments write the expected rows", async () => {
  const { db, call } = setup();
  const { id } = await call("create_plan_design", { project_slug: "demo-project", name: "Kitchen A", template_key: "kitchen-l" });
  const v1 = await call("save_plan_version", { design_id: id, label: "Option A" });
  assert.equal(v1.ok, true);
  assert.equal(v1.number, 1);
  const v2 = await call("save_plan_version", { design_id: id });
  assert.equal(v2.number, 2);
  const list = await call("list_plan_versions", { design_id: id });
  assert.deepEqual(list.versions.map((v) => v.number), [2, 1]);

  const dup = await call("duplicate_plan_design", { design_id: id });
  assert.equal(dup.ok, true);
  assert.equal(dup.name, "Kitchen A (copy)");
  assert.equal(db.designs.get(dup.id).doc.meta.createdFrom.designId, id);

  const sheet = await call("stage_plan_sheet", { design_id: id, version_id: v1.version_id, note: "plan + elevations for the client call" });
  assert.equal(sheet.ok, true);
  assert.equal(sheet.rendered, false);
  assert.match(sheet.instructions, /owner grant/);
  const c = db.comments.find((x) => x.id === sheet.comment_id);
  assert.equal(c.author_name, "MCP");
  assert.match(c.body, /^Sheet requested: plan \+ elevations/);
  assert.deepEqual(c.anchor, { levelId: "L1", x: 0, y: 0 });
  assert.equal(c.version_id, v1.version_id);
  const wrongVersion = await call("stage_plan_sheet", { design_id: dup.id, version_id: v1.version_id });
  assert.equal(wrongVersion.ok, false);

  const itemId = db.designs.get(id).doc.items[0].id;
  const pin = await call("add_plan_comment", { design_id: id, x: 12, y: 24, item_id: itemId, body: "Swap for a 36in sink base?", agent_name: "Claude" });
  assert.equal(pin.ok, true);
  assert.deepEqual(pin.anchor, { levelId: "L1", x: 12, y: 24, itemId });
  assert.equal(db.comments.find((x) => x.id === pin.comment_id).author_name, "Claude");
  const badPin = await call("add_plan_comment", { design_id: id, x: 0, y: 0, item_id: "nope", body: "x" });
  assert.equal(badPin.ok, false);
});
