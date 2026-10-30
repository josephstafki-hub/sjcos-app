// Exercises mcp/team-tools.mjs against a fake MCP server and an in-memory
// users table. Covers every option Settings › Team & roles offers: roles,
// staff areas, portal link slugs, temp passwords (given / generated), area
// edits, password reset, disable/enable — and the refusals: the write tools
// run only for a run acting for the owner, and never mint or touch an owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { registerTeamTools, generateTempPassword, initialsOf, userAdminRefusal } from "../mcp/team-tools.mjs";
import { PERMISSION_KEYS } from "../lib/permissions.ts";

// What mcp/sjcos-mcp.mjs currentPrincipal() resolves for each kind of run.
const JOE_ID = "00000000-0000-4000-8000-00000000a0e1";
const JOE_RUN = { userId: JOE_ID, role: "owner", name: "Joe", active: true, revoked: false, runId: "run-1" };
const STAFF_RUN = { userId: "00000000-0000-4000-8000-00000000ab19", role: "staff", name: "Abigail", active: true, revoked: false, runId: "run-2" };
const UNATTENDED_RUN = { userId: null, role: null, name: null, active: false, revoked: false, runId: null };
const REVOKED_JOE_RUN = { ...JOE_RUN, revoked: true };

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

/** `as` = the run's principal (default Joe's own run); `as(p)` switches it
 *  mid-test. `{ resolver: false }` registers with no currentPrincipal at all. */
function setup({ principal = JOE_RUN, resolver = true } = {}) {
  const { db, rows } = fakeDb();
  const tools = new Map();
  const fakeServer = { registerTool: (name, spec, handler) => tools.set(name, { spec, handler }) };
  let current = principal;
  const currentPrincipal = resolver ? async () => current : undefined;
  registerTeamTools(fakeServer, { rows, json, currentPrincipal });
  const call = async (name, args = {}) => parse(await tools.get(name).handler(args));
  const as = (p) => {
    current = p;
  };
  /** An owner row as the app's Settings › Team (or the seed) makes it. */
  const seedOwner = (email = "joe@x.com") => {
    db.users.push({ id: JOE_ID, email, password_hash: "salt:hash", name: "Joe", role: "owner", initials: "J", link_slug: null, active: true, permissions: [], created_at: "2026-09-27" });
    return db.users[db.users.length - 1];
  };
  return { db, tools, call, as, seedOwner };
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

test("create_user refusals: no areas, short password, duplicate email, bad slug, owner", async () => {
  const { db, call } = setup();
  assert.match((await call("create_user", { name: "A", email: "a@x.com" })).error, /at least one area/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", permissions: ["leads"], temp_password: "short" })).error, /at least 8/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "sub" })).error, /link_slug/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "sub", link_slug: "nobody" })).error, /No sub/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "client", link_slug: "nope" })).error, /No project/);
  assert.match((await call("create_user", { name: "A", email: "a@x.com", role: "owner" })).error, /can't create an owner/);
  assert.equal(db.users.length, 0, "every refusal happens before any write");
  assert.equal((await call("create_user", { name: "A", email: "a@x.com", permissions: ["leads"] })).ok, true);
  assert.match((await call("create_user", { name: "B", email: "A@x.com", permissions: ["leads"] })).error, /already exists/);
});

test("create_user: sub + client portal logins carry link_slug and no areas", async () => {
  const { call } = setup();
  const sub = await call("create_user", { name: "Marco", email: "m@x.com", role: "sub", link_slug: "marco", permissions: ["ai"] });
  assert.equal(sub.user.link_slug, "marco");
  assert.deepEqual(sub.user.permissions, []);
  const client = await call("create_user", { name: "Hendersons", email: "h@x.com", role: "client", link_slug: "henderson", active: false });
  assert.equal(client.user.link_slug, "henderson");
  assert.equal(client.user.active, false);
  const list = await call("list_users", { role: "client" });
  assert.equal(list.count, 1);
  assert.equal((await call("list_users", { include_inactive: false })).count, 1);
});

test("create_user: an owner account is refused for EVERY run — Joe's own, staff, unattended — even with the old confirm flag", async () => {
  const { db, call, as, tools } = setup();
  // The schema no longer offers the confirm switch at all.
  assert.equal("confirm_owner" in tools.get("create_user").spec.inputSchema, false);
  assert.match(tools.get("create_user").spec.description, /'owner' is always refused/);
  for (const run of [JOE_RUN, STAFF_RUN, UNATTENDED_RUN, REVOKED_JOE_RUN]) {
    as(run);
    const r = await call("create_user", { name: "Mallory", email: "mallory@x.com", role: "owner", confirm_owner: true, temp_password: "letmein-please" });
    assert.equal(r.ok, false);
    assert.match(r.error, /can't create an owner account/);
    assert.match(r.error, /Settings › Team/);
    assert.equal(r.temp_password, undefined, "no password is ever handed back");
  }
  assert.equal(db.users.length, 0, "no owner row was written");
  assert.equal(db.audits.length, 0);
  // list_access_areas says so too, instead of advertising a confirm flag.
  const areas = await call("list_access_areas");
  assert.match(areas.roles.find((x) => x.role === "owner").needs, /not available through MCP/);
});

test("user-admin writes refuse a run with no person behind it (unattended worker / connector), a staff run, a revoked owner, and a missing resolver — and write nothing", async () => {
  const { db, call, as, seedOwner } = setup();
  seedOwner();
  // Joe's run sets up a staff login to aim the refused calls at.
  const ana = await call("create_user", { name: "Ana", email: "ana@x.com", permissions: ["leads"], temp_password: "firstpass1" });
  assert.equal(ana.ok, true);
  const hashBefore = db.users[1].password_hash;
  const auditsBefore = db.audits.length;

  const attempts = [
    ["create_user", { name: "Eve", email: "eve@x.com", permissions: ["ai"] }],
    ["update_user_access", { user: "ana@x.com", add: ["invoices", "ai"] }],
    ["reset_user_password", { user: "ana@x.com" }],
    ["set_user_active", { user: "ana@x.com", active: false }],
  ];
  for (const [run, pattern] of [
    [UNATTENDED_RUN, /isn't acting for him/],
    [STAFF_RUN, /Only Joe can/],
    [REVOKED_JOE_RUN, /disabled or was signed out/],
  ]) {
    as(run);
    for (const [tool, args] of attempts) {
      const r = await call(tool, args);
      assert.equal(r.ok, false, `${tool} must refuse ${run.role ?? "unattended"}`);
      assert.match(r.error, pattern);
      assert.match(r.error, /Ask Joe, or use Settings › Team/);
      assert.equal(r.temp_password, undefined);
    }
  }
  // Nothing moved.
  assert.equal(db.users.length, 2);
  assert.deepEqual(db.users[1].permissions, ["leads"]);
  assert.equal(db.users[1].password_hash, hashBefore);
  assert.equal(db.users[1].active, true);
  assert.equal(db.audits.length, auditsBefore);

  // Reads stay open to any run (no password material in them).
  as(UNATTENDED_RUN);
  assert.equal((await call("list_users")).count, 2);
  assert.ok((await call("list_access_areas")).areas.length > 0);

  // No resolver wired in at all → fail closed, never "unattended = allowed".
  const bare = setup({ resolver: false });
  assert.match((await bare.call("create_user", { name: "Eve", email: "eve@x.com", permissions: ["leads"] })).error, /isn't acting for him/);
  assert.equal(bare.db.users.length, 0);
});

test("userAdminRefusal: only an active, un-revoked owner passes; a throwing resolver fails closed", async () => {
  assert.equal(await userAdminRefusal(async () => JOE_RUN), null);
  assert.match(await userAdminRefusal(async () => STAFF_RUN), /Only Joe/);
  assert.match(await userAdminRefusal(async () => UNATTENDED_RUN), /isn't acting for him/);
  assert.match(await userAdminRefusal(async () => REVOKED_JOE_RUN), /signed out/);
  assert.match(await userAdminRefusal(async () => ({ ...JOE_RUN, active: false })), /disabled/);
  assert.match(await userAdminRefusal(async () => ({ ...JOE_RUN, role: "client" })), /Only Joe/);
  assert.match(await userAdminRefusal(async () => {
    throw new Error("db down");
  }), /isn't acting for him/);
  assert.match(await userAdminRefusal(undefined), /isn't acting for him/);
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

test("update_user_access never touches an owner row, even on Joe's run", async () => {
  const { db, call, seedOwner } = setup();
  seedOwner();
  const r = await call("update_user_access", { user: "joe@x.com", permissions: ["leads"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /owner login/);
  assert.match(r.error, /Settings › Team/);
  assert.equal(db.users[0].role, "owner");
  assert.deepEqual(db.users[0].permissions, []);
});

test("reset_user_password + set_user_active: non-owner only", async () => {
  const { db, call, seedOwner } = setup();
  await call("create_user", { name: "Ana", email: "ana@x.com", permissions: ["leads"], temp_password: "firstpass1" });
  const joe = seedOwner();
  const r = await call("reset_user_password", { user: "ana@x.com" });
  assert.equal(r.ok, true);
  assert.ok(await verify(r.temp_password, db.users[0].password_hash));
  const r2 = await call("reset_user_password", { user: "ana@x.com", new_password: "secondpass2" });
  assert.equal(r2.temp_password, undefined);
  assert.ok(await verify("secondpass2", db.users[0].password_hash));
  assert.match((await call("reset_user_password", { user: "ana@x.com", new_password: "short" })).error, /at least 8/);
  assert.match((await call("reset_user_password", { user: "joe@x.com" })).error, /never reset or change an owner's password/);
  assert.match((await call("reset_user_password", { user: JOE_ID, new_password: "pwned-by-email" })).error, /owner login/);
  assert.equal(joe.password_hash, "salt:hash", "owner password untouched");
  const off = await call("set_user_active", { user: "ana@x.com", active: false });
  assert.equal(off.user.active, false);
  assert.equal((await call("set_user_active", { user: "ana@x.com", active: true })).user.active, true);
  assert.match((await call("set_user_active", { user: "joe@x.com", active: false })).error, /owner login/);
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
