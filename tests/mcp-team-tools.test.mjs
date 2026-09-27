// Exercises mcp/team-tools.mjs against a fake MCP server and an in-memory
// users table. Covers every option Settings › Team & roles offers: roles,
// staff areas, portal link slugs, temp passwords (given / generated), owner
// confirm, area edits, password reset, disable/enable — and the refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { registerTeamTools, generateTempPassword, initialsOf } from "../mcp/team-tools.mjs";
import { PERMISSION_KEYS } from "../lib/permissions.ts";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => JSON.parse(res.content[0].text);

function fakeDb() {
  const db = { users: [], audits: [], subs: ["marco"], projects: ["henderson"] };
  const pub = (u) => ({ ...u });
  const rows = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^INSERT INTO agent_runs/i.test(s)) { db.audits.push(params); return []; }
    if (/^SELECT slug FROM subs/i.test(s)) return db.subs.includes(params[0]) ? [{ slug: params[0] }] : [];
    if (/^SELECT slug FROM projects/i.test(s)) return db.projects.includes(params[0]) ? [{ slug: params[0] }] : [];
    if (/^SELECT 1 FROM users WHERE lower\(email\)/i.test(s)) return db.users.filter((u) => u.email === params[0].toLowerCase()).map(() => ({ 1: 1 }));
    if (/^SELECT id, name, email, role, initials, link_slug, active, permissions, created_at FROM users/i.test(s)) {
      let list = db.users;
      if (/WHERE id = \$1/.test(s)) list = list.filter((u) => u.id === params[0]);
      else if (/WHERE lower\(email\) = lower\(\$1\)/.test(s)) list = list.filter((u) => u.email === params[0].toLowerCase());
      else {
        if (/role = \$1/.test(s)) list = list.filter((u) => u.role === params[0]);
        if (/active = true/.test(s)) list = list.filter((u) => u.active);
      }
      return list.map(pub);
    }
    if (/^INSERT INTO users/i.test(s)) {
      const [email, password_hash, name, role, initials, link_slug, active, permissions] = params;
      const u = { id: `00000000-0000-4000-8000-${String(db.users.length + 1).padStart(12, "0")}`, email, password_hash, name, role, initials, link_slug, active, permissions, created_at: "2026-09-27" };
      db.users.push(u);
      return [pub(u)];
    }
    if (/^UPDATE users SET permissions/i.test(s)) {
      const u = db.users.find((x) => x.id === params[0] && x.role === "staff");
      if (!u) return [];
      u.permissions = params[1];
      return [pub(u)];
    }
    if (/^UPDATE users SET password_hash/i.test(s)) {
      const u = db.users.find((x) => x.id === params[0] && x.role !== "owner");
      if (!u) return [];
      u.password_hash = params[1];
      return [{ id: u.id }];
    }
    if (/^UPDATE users SET active/i.test(s)) {
      const u = db.users.find((x) => x.id === params[0] && x.role !== "owner");
      if (!u) return [];
      u.active = params[1];
      return [pub(u)];
    }
    throw new Error(`fakeRows: unhandled SQL: ${s.slice(0, 90)}`);
  };
  return { db, rows };
}

function setup() {
  const { db, rows } = fakeDb();
  const tools = new Map();
  const fakeServer = { registerTool: (name, spec, handler) => tools.set(name, { spec, handler }) };
  registerTeamTools(fakeServer, { rows, json });
  const call = async (name, args = {}) => parse(await tools.get(name).handler(args));
  return { db, tools, call };
}

// Same check lib/password.ts verifyPassword runs.
async function verify(password, stored) {
  const [salt, hashHex] = stored.split(":");
  const derived = await promisify(scrypt)(password, salt, 64);
  return derived.toString("hex") === hashHex;
}

test("registers the six team tools, each described", () => {
  const { tools } = setup();
  const expected = ["list_access_areas", "list_users", "create_user", "update_user_access", "reset_user_password", "set_user_active"];
  for (const n of expected) {
    assert.ok(tools.has(n), `missing tool ${n}`);
    assert.ok(tools.get(n).spec.description.length > 40, `${n} needs a description`);
  }
  assert.equal(tools.size, expected.length);
});

test("list_access_areas mirrors the permissions catalog and the four roles", async () => {
  const { call } = setup();
  const r = await call("list_access_areas");
  assert.deepEqual(r.areas.map((a) => a.key), [...PERMISSION_KEYS]);
  assert.ok(r.areas.find((a) => a.key === "ai").sensitive);
  assert.deepEqual(r.roles.map((x) => x.role), ["staff", "sub", "client", "owner"]);
});

test("create_user: staff with areas, given temp password, initials + lowercased email, audit row", async () => {
  const { db, call } = setup();
  const r = await call("create_user", { name: "Marco Rivas", email: "Marco@SJC.com", permissions: ["projects", "today"], temp_password: "hunter2hunter2" });
  assert.equal(r.ok, true);
  assert.equal(r.user.email, "marco@sjc.com");
  assert.equal(r.user.initials, "MR");
  assert.equal(r.user.role, "staff");
  assert.deepEqual(r.user.permissions, ["today", "projects"]); // catalog order
  assert.equal(r.temp_password, undefined);
  assert.equal(r.user.password_hash, undefined);
  assert.ok(await verify("hunter2hunter2", db.users[0].password_hash));
  assert.equal(db.audits.length, 1);
  assert.match(db.audits[0][1], /staff marco@sjc.com/);
});

test("create_user: generated temp password is returned once and verifies against the stored hash", async () => {
  const { db, call } = setup();
  const r = await call("create_user", { name: "Ana", email: "ana@sjc.com", permissions: ["leads"] });
  assert.equal(r.ok, true);
  assert.equal(typeof r.temp_password, "string");
  assert.ok(r.temp_password.length >= 12);
  assert.ok(await verify(r.temp_password, db.users[0].password_hash));
});

test("create_user refusals: no areas, short password, duplicate email, bad slug, owner without confirm", async () => {
  const { db, call } = setup();
  assert.match((await call("create_user", { name: "A", email: "a@x.com" })).error, /at least one area/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", permissions: ["leads"], temp_password: "short" })).error, /at least 8/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "sub" })).error, /link_slug/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "sub", link_slug: "nobody" })).error, /No sub/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "client", link_slug: "nope" })).error, /No project/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "owner" })).error, /confirm_owner/);
  assert.equal(db.users.length, 0, "every refusal happens before any write");
  assert.equal((await call("create_user", { name: "A", email: "a@x.com", permissions: ["leads"] })).ok, true);
  assert.match((await call("create_user", { name: "B", email: "A@x.com", permissions: ["leads"] })).error, /already exists/);
});

test("create_user: sub + client portal logins carry link_slug and no areas; owner with confirm", async () => {
  const { call } = setup();
  const sub = await call("create_user", { name: "Marco", email: "m@x.com", role: "sub", link_slug: "marco", permissions: ["ai"] });
  assert.equal(sub.user.link_slug, "marco");
  assert.deepEqual(sub.user.permissions, []);
  const client = await call("create_user", { name: "Hendersons", email: "h@x.com", role: "client", link_slug: "henderson", active: false });
  assert.equal(client.user.link_slug, "henderson");
  assert.equal(client.user.active, false);
  const owner = await call("create_user", { name: "Joe", email: "j@x.com", role: "owner", confirm_owner: true });
  assert.equal(owner.ok, true);
  assert.equal(owner.user.role, "owner");
  const list = await call("list_users", { role: "client" });
  assert.equal(list.count, 1);
  assert.equal((await call("list_users", { include_inactive: false })).count, 2);
});

test("update_user_access: replace, add/remove, refuses empty set and non-staff", async () => {
  const { call } = setup();
  await call("create_user", { name: "Ana", email: "ana@x.com", permissions: ["leads"] });
  let r = await call("update_user_access", { user: "ana@x.com", permissions: ["projects", "invoices"] });
  assert.deepEqual(r.user.permissions, ["projects", "invoices"]);
  assert.deepEqual(r.before, ["leads"]);
  r = await call("update_user_access", { user: r.user.id, add: ["today"], remove: ["invoices"] });
  assert.deepEqual(r.user.permissions, ["today", "projects"]);
  assert.match((await call("update_user_access", { user: "ana@x.com", remove: ["today", "projects"] })).error, /no areas/);
  assert.match((await call("update_user_access", { user: "ana@x.com" })).error, /permissions/);
  await call("create_user", { name: "M", email: "m@x.com", role: "sub", link_slug: "marco" });
  assert.match((await call("update_user_access", { user: "m@x.com", permissions: ["leads"] })).error, /staff/);
  assert.match((await call("update_user_access", { user: "ghost@x.com", permissions: ["leads"] })).error, /No user/);
});

test("reset_user_password + set_user_active: non-owner only", async () => {
  const { db, call } = setup();
  await call("create_user", { name: "Ana", email: "ana@x.com", permissions: ["leads"], temp_password: "firstpass1" });
  await call("create_user", { name: "Joe", email: "joe@x.com", role: "owner", confirm_owner: true });
  const r = await call("reset_user_password", { user: "ana@x.com" });
  assert.equal(r.ok, true);
  assert.ok(await verify(r.temp_password, db.users[0].password_hash));
  const r2 = await call("reset_user_password", { user: "ana@x.com", new_password: "secondpass2" });
  assert.equal(r2.temp_password, undefined);
  assert.ok(await verify("secondpass2", db.users[0].password_hash));
  assert.match((await call("reset_user_password", { user: "ana@x.com", new_password: "short" })).error, /at least 8/);
  assert.match((await call("reset_user_password", { user: "joe@x.com" })).error, /can't be reset/);
  const off = await call("set_user_active", { user: "ana@x.com", active: false });
  assert.equal(off.user.active, false);
  assert.equal((await call("set_user_active", { user: "ana@x.com", active: true })).user.active, true);
  assert.match((await call("set_user_active", { user: "joe@x.com", active: false })).error, /Owner/);
  assert.equal(db.users[1].active, true);
});

test("helpers: initials + temp password alphabet", () => {
  assert.equal(initialsOf("Marco Rivas"), "MR");
  assert.equal(initialsOf("Cher"), "CH");
  assert.equal(initialsOf("  "), "?");
  const pw = generateTempPassword();
  assert.equal(pw.length, 14);
  assert.doesNotMatch(pw, /[0O1lI]/);
});
