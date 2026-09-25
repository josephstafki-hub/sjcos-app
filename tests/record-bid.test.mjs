import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import pg from "pg";
import { z } from "zod";
import { registerBiddingTools } from "../mcp/bidding-tools.mjs";

// Recording a sub's bid (lib/bidding.ts recordBidOp): shared by the owner's
// Record bid button (lib/actions/bidding.ts recordBid) and the MCP record_bid
// tool (mcp/bidding-tools.mjs → app/api/internal/bidding/route.ts). The rules
// that matter: every refusal happens before anything is written, a bad file id
// writes nothing, re-recording files revision 2, and the thank-you is deferred
// to sendBidThanks — stubbed here, so nothing is ever emailed.
//
// The real op, action and route run; every module they talk to (db, Gmail,
// notify, uploads, the follow-up mailer, next/*) is stubbed below. The db stub
// is an in-memory fake by default. Set FIN_TEST_DATABASE_URL (same harness as
// budget-writes-db.test.mjs) to also run the SQL against a real Postgres,
// inside one transaction that is rolled back.

const root = new URL("../", import.meta.url);
const lib = (p) => new URL(`lib/${p}.ts`, root).href;
const fwd = (...names) => names.map((n) => `export const ${n} = (...a) => globalThis.__rb.${n}(...a);`).join("\n");
const STUBS = {
  "server-only": "export {};",
  "next/server": `${fwd("after")}
    export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`,
  "next/cache": fwd("revalidatePath"),
  [lib("db")]: fwd("query", "queryOne"),
  [lib("dal")]: fwd("requireAccess"),
  [lib("notify")]: fwd("emit"),
  [lib("upload-store")]: fwd("storeUpload"),
  [lib("bid-follow-ups")]: fwd("sendBidThanks"),
  [lib("gmail")]: fwd("gmailConfigured", "sendNewEmail"),
  [lib("uploads")]: fwd("readUpload"),
};
registerHooks({
  resolve(specifier, context, next) {
    let url = null;
    if (specifier.startsWith("@/")) url = new URL(`${specifier.slice(2)}.ts`, root).href;
    else if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      url = new URL(`${specifier}.ts`, context.parentURL).href; // lib/*.ts import each other extensionless
    }
    const key = url ?? specifier;
    if (Object.hasOwn(STUBS, key)) return { url: `stub:${key}`, shortCircuit: true };
    return next(url ?? specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    return { format: "module", source: STUBS[url.slice("stub:".length)], shortCircuit: true };
  },
});
const { recordBidOp } = await import("../lib/bidding.ts");
const { recordBid } = await import("../lib/actions/bidding.ts");
const { POST } = await import("../app/api/internal/bidding/route.ts");

// Spaeth excavation/foundation/slab — bid package 16, invite 127.
const INVITE = {
  id: 127,
  sub_slug: "mn-framers-ral-concrete",
  sub_name: "MN Framers / RAL Concrete",
  status: "sent",
  package_id: 16,
  title: "Excavation, foundation & slab",
  package_status: "open",
  slug: "spaeth",
  project_name: "Spaeth",
};
const FILES = {
  "proj-quote": { id: "proj-quote", project_key: "spaeth", storage_path: "quote.pdf" },
  "proj-photo": { id: "proj-photo", project_key: "spaeth", storage_path: "photo.jpeg" },
  "proj-nostore": { id: "proj-nostore", project_key: "spaeth", storage_path: null },
  "proj-other-job": { id: "proj-other-job", project_key: "tierney", storage_path: "plans.pdf" },
};

/** The handful of SQL shapes the record path issues, over in-memory tables. */
function fakeRun(w, sql, params = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  w.queries.push({ sql: s, params });
  if (/FROM bid_invites i JOIN subs s .* WHERE i\.id = \$1$/.test(s)) {
    return Number(params[0]) === w.invite.id ? [{ ...w.invite }] : [];
  }
  if (/^SELECT id FROM files WHERE id = ANY\(\$1::text\[\]\) AND storage_path IS NOT NULL AND project_key = \$2$/.test(s)) {
    return Object.values(w.files).filter((f) => params[0].includes(f.id) && f.storage_path && f.project_key === params[1]).map((f) => ({ id: f.id }));
  }
  if (/^SELECT COALESCE\(MAX\(revision\) \+ 1, 1\) AS next FROM bid_submissions WHERE invite_id = \$1$/.test(s)) {
    const revs = w.submissions.filter((x) => x.invite_id === params[0]).map((x) => x.revision);
    return [{ next: revs.length ? Math.max(...revs) + 1 : 1 }];
  }
  if (/^INSERT INTO bid_submissions \(invite_id, total, notes, exclusions, lead_time, revision\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\) RETURNING id$/.test(s)) {
    const [invite_id, total, notes, exclusions, lead_time, revision] = params;
    const id = String(900 + w.submissions.length);
    w.submissions.push({ id, invite_id, total, notes, exclusions, lead_time, revision });
    return [{ id }];
  }
  if (/^INSERT INTO bid_submission_lines .* FROM unnest\(\$2::text\[\], \$3::bigint\[\]\) WITH ORDINALITY/.test(s)) {
    params[1].forEach((description, i) => w.lines.push({ submission_id: params[0], description, amount: params[2][i], sort_order: i }));
    return [];
  }
  if (/^INSERT INTO bid_submission_files \(submission_id, file_id\) VALUES \(\$1, \$2\)$/.test(s)) {
    w.subFiles.push({ submission_id: params[0], file_id: params[1] });
    return [];
  }
  if (/^UPDATE bid_invites SET status = 'submitted', responded_at = now\(\) WHERE id = \$1$/.test(s)) {
    if (Number(params[0]) === w.invite.id) w.invite.status = "submitted";
    return [];
  }
  if (/^INSERT INTO agent_runs/.test(s)) {
    w.audits.push(params);
    return [];
  }
  throw new Error(`fake db: unhandled SQL: ${s.slice(0, 100)}`);
}

/** Fresh recorders for one test; `invite` overrides the invite/package state. */
function world(invite = {}, run = null) {
  const w = {
    invite: { ...INVITE, ...invite },
    files: structuredClone(FILES),
    submissions: [], lines: [], subFiles: [], queries: [], audits: [],
    afters: [], thanked: [], emitted: [], revalidated: [], access: [], uploads: [],
  };
  const exec = run ?? (async (sql, params) => fakeRun(w, sql, params));
  const nope = (name) => () => { throw new Error(`${name} must not be called when recording a bid`); };
  globalThis.__rb = {
    query: async (sql, params) => ({ rows: await exec(sql, params) }),
    queryOne: async (sql, params) => (await exec(sql, params))[0] ?? null,
    after: (fn) => { w.afters.push(fn); },
    sendBidThanks: async (id) => { w.thanked.push(id); return { sent: true }; },
    emit: async (n) => { w.emitted.push(n); },
    revalidatePath: (...a) => { w.revalidated.push(a); },
    requireAccess: async (area) => { w.access.push(area); },
    storeUpload: async (file, opts) => {
      const id = `bid-upload-${w.uploads.length + 1}`;
      w.uploads.push({ name: file.name, opts });
      w.files[id] = { id, project_key: opts.projectKey, storage_path: `${id}.pdf` };
      return { ok: true, id, type: "doc" };
    },
    gmailConfigured: nope("gmailConfigured"),
    sendNewEmail: nope("sendNewEmail"),
    readUpload: nope("readUpload"),
  };
  return w;
}

const writes = (w) => w.queries.filter((q) => /^(INSERT|UPDATE|DELETE)\b/i.test(q.sql));
/** Run what the op deferred with after() — the thank-you. */
const flushAfter = async (w) => { for (const fn of w.afters.splice(0)) await fn(); };

/** Nothing written, nothing deferred, nothing announced. */
function assertUntouched(w) {
  assert.deepEqual(writes(w).map((q) => q.sql.slice(0, 40)), []);
  assert.deepEqual([w.afters.length, w.emitted.length, w.thanked.length], [0, 0, 0]);
}

// ---- recordBidOp -----------------------------------------------------------

test("total only: one submission, no lines, invite submitted, thank-you deferred, $ notification", async () => {
  const w = world();
  const r = await recordBidOp(127, { totalCents: 2_250_000, exclusions: "Winter conditions", leadTime: "2 weeks", notes: "Per Ryan's email 9/25" });
  assert.deepEqual(r, { ok: true, invite_id: 127, submission_id: 900, revision: 1, total_cents: 2_250_000 });
  assert.deepEqual(w.submissions, [{ id: "900", invite_id: 127, total: 2_250_000, notes: "Per Ryan's email 9/25", exclusions: "Winter conditions", lead_time: "2 weeks", revision: 1 }]);
  assert.deepEqual([w.lines, w.subFiles], [[], []]);
  assert.equal(w.invite.status, "submitted");
  assert.equal(w.emitted.length, 1);
  assert.equal(w.emitted[0].title, "Bid in from MN Framers / RAL Concrete — $22,500");
  assert.equal(w.emitted[0].subline, "Spaeth · Excavation, foundation & slab");
  assert.equal(w.emitted[0].href, "/projects/spaeth");
  assert.deepEqual(w.thanked, [], "the thank-you waits until after the response");
  await flushAfter(w);
  assert.deepEqual(w.thanked, [127], "sendBidThanks decides (follow-ups switch) — the op always hands it over");
});

test("lines only: the total is their sum, blank rows drop out, order kept", async () => {
  const w = world();
  const r = await recordBidOp(127, {
    lines: [
      { description: "Excavation", amountCents: 850_000 },
      { description: "  ", amountCents: 0 },
      { description: "Foundation walls", amountCents: 1_000_000 },
      { description: "Slab", amountCents: 400_000 },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.total_cents, 2_250_000);
  assert.equal(w.submissions[0].total, 2_250_000);
  assert.deepEqual(w.lines.map((l) => [l.description, l.amount, l.sort_order]), [
    ["Excavation", 850_000, 0],
    ["Foundation walls", 1_000_000, 1],
    ["Slab", 400_000, 2],
  ]);
  assert.deepEqual([w.submissions[0].notes, w.submissions[0].exclusions, w.submissions[0].lead_time], ["", "", ""]);
});

test("a total and lines: the total given wins, the lines are kept as the breakdown", async () => {
  const w = world();
  const r = await recordBidOp(127, { totalCents: 2_300_000, lines: [{ description: "Excavation", amountCents: 850_000 }] });
  assert.equal(r.total_cents, 2_300_000);
  assert.equal(w.lines.length, 1);
});

test("a total of zero or less is refused, and nothing is written", async () => {
  for (const input of [{ totalCents: 0 }, { totalCents: -2_250_000 }, {}, { lines: [{ description: "Excavation", amountCents: 0 }] }]) {
    const w = world();
    const r = await recordBidOp(127, input);
    assert.deepEqual(r, { ok: false, error: "Enter your bid total (or line items that add up to one)." }, JSON.stringify(input));
    assertUntouched(w);
    assert.equal(w.invite.status, "sent");
  }
});

test("bad amounts are refused before any write: fractional cents, negative lines, past int4", async () => {
  for (const [input, error] of [
    [{ totalCents: 22_500.5 }, /whole cents/],
    [{ totalCents: 3_000_000_000 }, /too large/],
    [{ lines: [{ description: "Credit", amountCents: -5_000 }] }, /Line "Credit" needs an amount in whole cents/],
  ]) {
    const w = world();
    const r = await recordBidOp(127, input);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assertUntouched(w);
  }
});

test("a closed or awarded package is refused, and nothing is written", async () => {
  for (const state of [
    { package_status: "closed" },
    { package_status: "awarded", status: "awarded" },
    { package_status: "awarded", status: "not_awarded" },
    { status: "not_awarded" },
  ]) {
    const w = world(state);
    const r = await recordBidOp(127, { totalCents: 2_250_000 });
    assert.deepEqual(r, { ok: false, error: "Bidding on this package has closed." }, JSON.stringify(state));
    assertUntouched(w);
  }
});

test("a draft (never emailed) invite is refused, and nothing is written", async () => {
  const w = world({ status: "draft", package_status: "draft" });
  const r = await recordBidOp(127, { totalCents: 2_250_000 });
  assert.deepEqual(r, { ok: false, error: "This invite hasn't been emailed yet." });
  assertUntouched(w);
});

test("an unknown invite is refused", async () => {
  const w = world();
  assert.deepEqual(await recordBidOp(999, { totalCents: 2_250_000 }), { ok: false, error: "Bid invite not found." });
  assertUntouched(w);
});

test("a bad file id — unknown, no stored blob, or another job's — refuses the lot and writes nothing", async () => {
  for (const bad of ["proj-typo", "proj-nostore", "proj-other-job"]) {
    const w = world();
    const r = await recordBidOp(127, { totalCents: 2_250_000, lines: [{ description: "Slab", amountCents: 400_000 }], fileIds: ["proj-quote", bad] });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, new RegExp(`No stored file on Spaeth with id "${bad}" — nothing was recorded`));
    assert.match(r.error, /list_project_files/);
    assertUntouched(w);
    assert.equal(w.invite.status, "sent");
  }
});

test("file ids link existing files to the submission, in order, once each", async () => {
  const w = world();
  const r = await recordBidOp(127, { totalCents: 2_250_000, fileIds: ["proj-quote", "proj-photo", "proj-quote"] });
  assert.equal(r.ok, true);
  assert.deepEqual(w.subFiles, [
    { submission_id: 900, file_id: "proj-quote" },
    { submission_id: 900, file_id: "proj-photo" },
  ]);
  const check = w.queries.find((q) => q.sql.startsWith("SELECT id FROM files"));
  assert.deepEqual(check.params, [["proj-quote", "proj-photo"], "spaeth"], "one lookup, scoped to the invite's project");
});

test("re-recording files revision 2; the first revision stays", async () => {
  const w = world();
  assert.equal((await recordBidOp(127, { totalCents: 2_250_000 })).revision, 1);
  const r2 = await recordBidOp(127, { totalCents: 2_150_000, notes: "Revised after walkthrough" });
  assert.equal(r2.ok, true);
  assert.equal(r2.revision, 2);
  assert.deepEqual(w.submissions.map((s) => [s.revision, s.total]), [[1, 2_250_000], [2, 2_150_000]]);
  assert.equal(w.invite.status, "submitted");
  assert.equal(w.afters.length, 2);
});

test("a declined sub who comes back with a number can still be recorded (same as the button)", async () => {
  const w = world({ status: "declined" });
  assert.equal((await recordBidOp(127, { totalCents: 2_250_000 })).ok, true);
  assert.equal(w.invite.status, "submitted");
});

// ---- the owner's Record bid button (lib/actions/bidding.ts) ------------------

function bidForm(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  for (const f of files) fd.append("files", f);
  return fd;
}

test("owner button: same parsing, same writes, the upload stored on the project and linked", async () => {
  const w = world();
  const quote = new File(["%PDF quote"], "RAL quote.pdf", { type: "application/pdf" });
  const empty = new File([], "empty.pdf", { type: "application/pdf" });
  const r = await recordBid(127, bidForm([
    ["total", ""],
    ["lineDesc", "Excavation"], ["lineAmount", "$8,500"],
    ["lineDesc", ""], ["lineAmount", ""],
    ["lineDesc", "Foundation + slab"], ["lineAmount", "14,000.00"],
    ["exclusions", "  Winter conditions  "],
    ["leadTime", "2 weeks"],
    ["notes", ""],
  ], [quote, empty]));
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(w.access, ["bidding"]);
  assert.deepEqual(w.uploads, [{
    name: "RAL quote.pdf",
    opts: { idPrefix: "bid", projectKey: "spaeth", tag: "SUB BID", subtitle: "Bid · MN Framers / RAL Concrete · Excavation, foundation & slab" },
  }], "empty file inputs are skipped");
  assert.deepEqual(w.submissions.map((s) => [s.total, s.exclusions, s.lead_time, s.notes, s.revision]), [[2_250_000, "Winter conditions", "2 weeks", "", 1]]);
  assert.deepEqual(w.lines.map((l) => [l.description, l.amount]), [["Excavation", 850_000], ["Foundation + slab", 1_400_000]]);
  assert.deepEqual(w.subFiles, [{ submission_id: 900, file_id: "bid-upload-1" }]);
  assert.equal(w.invite.status, "submitted");
  assert.equal(w.emitted.length, 1);
  assert.deepEqual(w.revalidated, [["/projects/spaeth"], ["/notifications"]]);
  await flushAfter(w);
  assert.deepEqual(w.thanked, [127]);
});

test("owner button: a typed total wins over the lines, like before", async () => {
  const w = world();
  await recordBid(127, bidForm([["total", "$22,500"], ["lineDesc", "Excavation"], ["lineAmount", "8500"]]));
  assert.equal(w.submissions[0].total, 2_250_000);
});

test("owner button: a refused bid stores no upload and writes nothing", async () => {
  const w = world({ package_status: "closed" });
  const quote = new File(["%PDF quote"], "RAL quote.pdf", { type: "application/pdf" });
  const r = await recordBid(127, bidForm([["total", "22500"]], [quote]));
  assert.deepEqual(r, { ok: false, error: "Bidding on this package has closed." });
  assert.deepEqual(w.uploads, []);
  assertUntouched(w);
  assert.deepEqual(w.revalidated, []);

  const w2 = world();
  assert.deepEqual(await recordBid(127, bidForm([["total", ""]], [quote])), { ok: false, error: "Enter your bid total (or line items that add up to one)." });
  assert.deepEqual(w2.uploads, []);
  assertUntouched(w2);
});

// ---- the MCP → app bridge (app/api/internal/bidding/route.ts) ---------------

process.env.CRON_SECRET = "test-secret";
const post = (body, secret = "test-secret") =>
  POST(new Request("http://app.test/api/internal/bidding", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

test("route record_bid: the MCP payload (snake_case) lands as the same record, audited", async () => {
  const w = world();
  const res = await post({
    action: "record_bid", invite_id: 127, lines: [{ description: "Excavation", amount_cents: 850_000 }, { description: "Foundation + slab", amount_cents: 1_400_000 }],
    exclusions: "Winter conditions", lead_time: "2 weeks", notes: "From Ryan's email", file_ids: ["proj-quote"],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, invite_id: 127, submission_id: 900, revision: 1, total_cents: 2_250_000 });
  assert.deepEqual(w.submissions.map((s) => [s.total, s.exclusions, s.lead_time, s.notes]), [[2_250_000, "Winter conditions", "2 weeks", "From Ryan's email"]]);
  assert.deepEqual(w.subFiles, [{ submission_id: 900, file_id: "proj-quote" }]);
  assert.equal(w.audits.length, 1);
  assert.equal(w.audits[0][0], "record_bid");
  assert.match(w.audits[0][1], /"total_cents":2250000/);
  assert.deepEqual(w.revalidated, [["/projects/[slug]", "page"], ["/notifications"]]);
});

test("route record_bid: a refusal is a 400 with the reason, not audited, nothing written", async () => {
  const w = world();
  const res = await post({ action: "record_bid", invite_id: 127, total_cents: 2_250_000, file_ids: ["proj-typo"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /"proj-typo"/);
  assert.deepEqual(w.audits, []);
  assertUntouched(w);
});

test("route: the bearer secret is still required", async () => {
  const w = world();
  const res = await post({ action: "record_bid", invite_id: 127, total_cents: 2_250_000 }, "wrong");
  assert.equal(res.status, 401);
  assertUntouched(w);
});

// ---- the MCP tool (mcp/bidding-tools.mjs) -----------------------------------

function mcpTools() {
  const tools = {};
  const calls = [];
  const guarded = [];
  const server = { registerTool: (name, config, handler) => { tools[name] = { config, handler }; } };
  const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
  registerBiddingTools(server, {
    rows: async () => { throw new Error("record_bid must go through the app, not direct SQL"); },
    json,
    biddingCall: async (action, payload) => { calls.push([action, payload]); return { ok: true, revision: 1 }; },
    uploadDir: "/nonexistent",
    envValue: () => "",
    strippedDollarError: (...texts) => {
      guarded.push(texts);
      return texts.some((t) => typeof t === "string" && /(^|\s),\d{3}\b/.test(t)) ? json({ ok: false, error: "Rejected — nothing was written" }) : null;
    },
  });
  return { tool: tools.record_bid, calls, guarded };
}

test("record_bid tool: registered in the write section with the spec'd description and inputs", () => {
  const { tool } = mcpTools();
  assert.ok(tool, "record_bid is registered");
  assert.match(tool.config.description, /^Record a sub's bid that came back by email\/phone, the same as the owner's Record bid button/);
  assert.match(tool.config.description, /only if the package's auto follow-ups are on/);
  assert.match(tool.config.description, /Money in integer cents\.$/);
  const schema = z.object(tool.config.inputSchema);
  assert.equal(schema.safeParse({ invite_id: 127, total_cents: 2_250_000 }).success, true);
  assert.equal(schema.safeParse({ invite_id: 127, total_cents: 22_500.5 }).success, false, "integer cents");
  assert.equal(schema.safeParse({ invite_id: 127, file_ids: Array.from({ length: 11 }, (_, i) => `f${i}`) }).success, false, "max 10 files");
  assert.equal(schema.safeParse({ invite_id: 127, lines: [{ description: "Slab", amount_cents: 400_000 }] }).success, true);
});

test("record_bid tool: forwards to the app's record_bid action unchanged", async () => {
  const { tool, calls } = mcpTools();
  const args = { invite_id: 127, total_cents: 2_250_000, lines: [{ description: "Slab", amount_cents: 400_000 }], exclusions: "Winter conditions", lead_time: "2 weeks", notes: "n", file_ids: ["proj-quote"] };
  const res = await tool.handler(args);
  assert.deepEqual(calls, [["record_bid", args]]);
  assert.deepEqual(JSON.parse(res.content[0].text), { ok: true, revision: 1 });
});

test("record_bid tool: shell-stripped dollars in any text field are rejected before the app is called", async () => {
  const { tool, calls, guarded } = mcpTools();
  const res = await tool.handler({ invite_id: 127, total_cents: 2_250_000, exclusions: "Excludes ,500 for winter heat" });
  assert.match(res.content[0].text, /Rejected — nothing was written/);
  assert.deepEqual(calls, []);
  await tool.handler({ invite_id: 127, lines: [{ description: "Slab", amount_cents: 1 }], lead_time: "2 weeks", notes: "n" });
  assert.deepEqual(guarded[1], [undefined, "2 weeks", "n", "Slab"], "exclusions, lead time, notes and every line description are checked");
});

// ---- against a real Postgres (optional) -------------------------------------

const url = process.env.FIN_TEST_DATABASE_URL;

test("the record path's SQL against a real Postgres (rolled back)", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query("BEGIN");
    const [project] = await run(
      `INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date)
       VALUES ('zz-bid-test', 'ZZ Bid Test', 'bidding', 'ZZ Test', 0, 0) RETURNING id`);
    await run(`INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date)
               VALUES ('zz-bid-other', 'ZZ Other', 'bidding', 'ZZ Test', 0, 0)`);
    await run(`INSERT INTO subs (slug, name, trade, email) VALUES ('zz-concrete', 'ZZ Concrete', 'Concrete', 'zz@example.com')`);
    const [pkg] = await run(
      `INSERT INTO bid_packages (project_id, title, trade, status, follow_ups) VALUES ($1, 'ZZ slab', 'Concrete', 'open', true) RETURNING id`,
      [project.id]);
    const [inv] = await run(
      `INSERT INTO bid_invites (package_id, sub_slug, status, sent_at) VALUES ($1, 'zz-concrete', 'sent', now()) RETURNING id`,
      [pkg.id]);
    const inviteId = Number(inv.id);
    await run(`INSERT INTO files (id, project_key, name, storage_path) VALUES
                 ('zz-quote', 'zz-bid-test', 'quote.pdf', 'zz-quote.pdf'),
                 ('zz-noblob', 'zz-bid-test', 'ghost.pdf', NULL),
                 ('zz-elsewhere', 'zz-bid-other', 'other.pdf', 'zz-other.pdf')`);

    const w = world({}, run);
    const count = async () => (await run(`SELECT count(*)::int AS n FROM bid_submissions WHERE invite_id = $1`, [inviteId]))[0].n;

    for (const bad of ["zz-typo", "zz-noblob", "zz-elsewhere"]) {
      const r = await recordBidOp(inviteId, { totalCents: 2_250_000, fileIds: ["zz-quote", bad] });
      assert.equal(r.ok, false, bad);
      assert.match(r.error, new RegExp(`"${bad}"`));
    }
    assert.equal(await count(), 0, "a bad file id wrote nothing");

    const r1 = await recordBidOp(inviteId, {
      lines: [{ description: "Excavation", amountCents: 850_000 }, { description: "Slab", amountCents: 1_400_000 }],
      exclusions: "Winter conditions", leadTime: "2 weeks", fileIds: ["zz-quote"],
    });
    assert.equal(r1.ok, true, r1.error);
    assert.equal(r1.revision, 1);
    const r2 = await recordBidOp(inviteId, { totalCents: 2_150_000 });
    assert.equal(r2.revision, 2);

    const subs = await run(`SELECT id, total, exclusions, lead_time, revision FROM bid_submissions WHERE invite_id = $1 ORDER BY revision`, [inviteId]);
    assert.deepEqual(subs.map((s) => [s.total, s.exclusions, s.lead_time, s.revision]), [[2_250_000, "Winter conditions", "2 weeks", 1], [2_150_000, "", "", 2]]);
    assert.deepEqual(
      (await run(`SELECT description, amount, sort_order FROM bid_submission_lines WHERE submission_id = $1 ORDER BY sort_order`, [subs[0].id]))
        .map((l) => [l.description, l.amount, l.sort_order]),
      [["Excavation", 850_000, 0], ["Slab", 1_400_000, 1]]);
    assert.deepEqual((await run(`SELECT file_id FROM bid_submission_files WHERE submission_id = $1`, [subs[0].id])).map((f) => f.file_id), ["zz-quote"]);
    const [invite] = await run(`SELECT status, responded_at FROM bid_invites WHERE id = $1`, [inviteId]);
    assert.equal(invite.status, "submitted");
    assert.ok(invite.responded_at);

    await run(`UPDATE bid_packages SET status = 'closed' WHERE id = $1`, [pkg.id]);
    assert.deepEqual(await recordBidOp(inviteId, { totalCents: 1 }), { ok: false, error: "Bidding on this package has closed." });
    assert.equal(await count(), 2);
    assert.deepEqual(w.thanked, [], "thank-yous stay deferred (and stubbed)");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
