// Exercises mcp/lead-tools.mjs (save_lead_rough_estimate) against a fake MCP
// server and in-memory leads / lead_estimates / lead_activity tables: create,
// update, notes kept vs replaced, the reported /leads value, the sent guard,
// converted leads, access, and the shell-mangled-dollar refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLeadTools } from "../mcp/lead-tools.mjs";
import { compactEstimateValue } from "../lib/lead-estimate-value.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => JSON.parse(res.content[0].text);
const strippedDollarError = (...texts) =>
  texts.some((t) => typeof t === "string" && /(^|\s),\d{3}/.test(t)) ? json({ ok: false, error: "mangled" }) : null;

function fakeDb() {
  const db = {
    leads: [
      { id: "L1", slug: "chen-kitchen", name: "Amy Chen", value_display: "?", estimate_value: null },
      { id: "L2", slug: "old-lead", name: "Bo Old", value_display: "$40k", estimate_value: 40000 },
    ],
    projects: [{ slug: "old-bath", lead_id: "L2" }],
    users: [
      { id: "U-owner", role: "owner", permissions: [] },
      { id: "U-leads", role: "staff", permissions: ["leads"] },
      { id: "U-both", role: "staff", permissions: ["leads", "estimates"] },
    ],
    estimates: new Map(),
    activity: [],
  };
  const rows = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT permissions FROM users/i.test(s)) return db.users.filter((u) => u.id === params[0]);
    if (/^SELECT l\.id, l\.name, \(SELECT p\.slug FROM projects/i.test(s)) {
      const l = db.leads.find((x) => x.slug === params[0]);
      if (!l) return [];
      return [{ id: l.id, name: l.name, project_slug: db.projects.find((p) => p.lead_id === l.id)?.slug ?? null }];
    }
    if (/^SELECT status, sent_at FROM lead_estimates/i.test(s)) {
      const e = db.estimates.get(params[0]);
      return e ? [{ status: e.status, sent_at: e.sent_at }] : [];
    }
    if (/^INSERT INTO lead_estimates/i.test(s)) {
      const [leadId, lines, total, notes] = params;
      const prev = db.estimates.get(leadId);
      db.estimates.set(leadId, {
        line_items: JSON.parse(lines),
        total,
        notes: notes ?? prev?.notes ?? "",
        status: "draft",
        sent_at: null,
      });
      return [];
    }
    if (/^UPDATE leads SET value_display/i.test(s)) {
      const l = db.leads.find((x) => x.id === params[0]);
      l.value_display = params[1];
      l.estimate_value = params[2];
      return [];
    }
    if (/^INSERT INTO lead_activity/i.test(s)) {
      db.activity.push({ lead_id: params[0], summary: params[1], actor: params[2] });
      return [];
    }
    throw new Error(`fakeRows: unhandled SQL: ${s.slice(0, 90)}`);
  };
  return { db, rows };
}

function setup(userId = null) {
  const { db, rows } = fakeDb();
  const tools = new Map();
  const fakeServer = {
    registerTool: (name, spec, handler) => tools.set(name, { spec, handler }),
    server: { getClientVersion: () => ({ name: "Hermes" }) },
  };
  const currentPrincipal = async () => {
    const u = db.users.find((x) => x.id === userId);
    return { userId, role: u?.role ?? null, name: null, active: true, revoked: false, runId: null };
  };
  registerLeadTools(fakeServer, { rows, json, strippedDollarError, currentPrincipal });
  const call = async (args) => parse(await tools.get("save_lead_rough_estimate").handler(args));
  return { db, tools, call };
}

const LINES = [
  { label: "Cabinets + install", value: "$18,000–$22,000" },
  { label: "  Counters  ", value: " $6,000–$8,000 " },
  { label: "", value: "" },
];

test("registers save_lead_rough_estimate with a description", () => {
  const { tools } = setup();
  const t = tools.get("save_lead_rough_estimate");
  assert.ok(t);
  assert.match(t.spec.description, /never contacts the client/);
});

test("creates a draft, trims lines, reports the /leads value, logs a non-contact activity", async () => {
  const { db, call } = setup();
  const r = await call({ slug: "chen-kitchen", lines: LINES, total: "$24,000–$30,000", notes: "  Assumes stock cabinets.  " });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.status, "draft");
  const e = db.estimates.get("L1");
  assert.deepEqual(e.line_items, [
    { label: "Cabinets + install", value: "$18,000–$22,000" },
    { label: "Counters", value: "$6,000–$8,000" },
  ]);
  assert.equal(e.notes, "Assumes stock cabinets.");
  // The lead's own value_display / estimate_value follow the saved total in
  // Postgres (migration 0039, tests/lead-value-db.test.mjs); the tool only reports it.
  assert.equal(r.value_display, "$24–30k");
  assert.equal(r.value_display, compactEstimateValue("$24,000–$30,000").display);
  assert.equal(db.leads[0].value_display, "?", "the tool no longer writes the lead row itself");
  assert.deepEqual(db.activity, [{ lead_id: "L1", summary: "Rough estimate drafted by Hermes ($24,000–$30,000)", actor: "Hermes" }]);
});

test("an update keeps existing notes unless notes is passed", async () => {
  const { db, call } = setup();
  await call({ slug: "chen-kitchen", lines: LINES, total: "$24,000", notes: "Keep me" });
  const r = await call({ slug: "chen-kitchen", lines: [{ label: "All in", value: "$25,000" }], total: "$25,000" });
  assert.equal(r.created, false);
  assert.equal(r.notes_saved, false);
  assert.equal(db.estimates.get("L1").notes, "Keep me");
  assert.match(db.activity.at(-1).summary, /^Rough estimate updated by Hermes/);
  await call({ slug: "chen-kitchen", lines: [{ label: "All in", value: "$25,000" }], total: "$25,000", notes: "" });
  assert.equal(db.estimates.get("L1").notes, "");
});

test("a sent estimate is refused unless revise_sent, which puts it back to draft", async () => {
  const { db, call } = setup();
  db.estimates.set("L1", { line_items: [], total: "$20,000", notes: "", status: "sent", sent_at: "2026-10-10T15:00:00Z" });
  const refused = await call({ slug: "chen-kitchen", lines: LINES, total: "$24,000" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already sent to Amy Chen on 2026-10-10/);
  assert.equal(db.estimates.get("L1").status, "sent");
  assert.equal(db.activity.length, 0);

  const revised = await call({ slug: "chen-kitchen", lines: LINES, total: "$24,000", revise_sent: true });
  assert.equal(revised.ok, true);
  assert.equal(revised.revised_sent, true);
  assert.equal(db.estimates.get("L1").status, "draft");
  assert.match(db.activity.at(-1).summary, /revised after sending/);
});

test("refuses unknown and converted leads, writing nothing", async () => {
  const { db, call } = setup();
  const missing = await call({ slug: "nope", lines: LINES, total: "$1,000" });
  assert.equal(missing.ok, false);
  const converted = await call({ slug: "old-lead", lines: LINES, total: "$1,000" });
  assert.equal(converted.ok, false);
  assert.equal(converted.project_slug, "old-bath");
  assert.equal(db.estimates.size, 0);
  assert.equal(db.leads[1].value_display, "$40k");
});

test("blank lines and a blank total are refused", async () => {
  const { call } = setup();
  assert.equal((await call({ slug: "chen-kitchen", lines: [{ label: " ", value: "" }], total: "$1,000" })).ok, false);
  assert.equal((await call({ slug: "chen-kitchen", lines: LINES, total: "  " })).ok, false);
});

test("a total with no number saves but leaves the lead value alone, with a warning", async () => {
  const { db, call } = setup();
  const r = await call({ slug: "chen-kitchen", lines: LINES, total: "TBD after site visit" });
  assert.equal(r.ok, true);
  assert.equal(r.value_display, null);
  assert.ok(r.warning);
  assert.equal(db.leads[0].value_display, "?");
});

test("staff need both leads and estimates; owner always may", async () => {
  const leadsOnly = setup("U-leads");
  const r = await leadsOnly.call({ slug: "chen-kitchen", lines: LINES, total: "$24,000" });
  assert.equal(r.ok, false);
  assert.match(r.error, /"estimates" access/);
  assert.equal(leadsOnly.db.estimates.size, 0);
  assert.equal((await setup("U-both").call({ slug: "chen-kitchen", lines: LINES, total: "$24,000" })).ok, true);
  assert.equal((await setup("U-owner").call({ slug: "chen-kitchen", lines: LINES, total: "$24,000" })).ok, true);
});

test("a shell-mangled dollar amount is refused before anything is written", async () => {
  const { db, call } = setup();
  const r = await call({ slug: "chen-kitchen", lines: [{ label: "Cabinets", value: " ,000–,000" }], total: "$24,000" });
  assert.equal(r.ok, false);
  assert.equal(db.estimates.size, 0);
});
