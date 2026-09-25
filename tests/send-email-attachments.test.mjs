import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { loadFileAttachments, MAX_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS } from "../lib/mail-attachments.ts";

// send_email with attachment_file_ids (mcp/grants-tools.mjs → lib/agent-sends.ts).
// The rules that matter: a plain-text email with no attachments goes out exactly
// as before, and a bad file id / missing blob / oversize packet is refused
// BEFORE consumeGrant — a typo must never burn Joe's one-use grant.
//
// performGrantedAction runs for real; every module it talks to (db, Gmail,
// grants, disk) is stubbed below, so nothing is queried, spent, or emailed.

const JPEG = Buffer.from("fake jpeg bytes");
const FILES = {
  "proj-46": { id: "proj-46", name: "IMG_0046.jpeg", mime_type: "image/jpeg", storage_path: "a46.jpeg" },
  "proj-47": { id: "proj-47", name: "IMG_0047.jpeg", mime_type: "image/jpeg", storage_path: "a47.jpeg" },
  "proj-gone": { id: "proj-gone", name: "Plans.pdf", mime_type: "application/pdf", storage_path: "deleted.pdf" },
  "proj-big1": { id: "proj-big1", name: "Scan 1.pdf", mime_type: null, storage_path: "big1.pdf" },
  "proj-big2": { id: "proj-big2", name: "Scan 2.pdf", mime_type: null, storage_path: "big2.pdf" },
};
const BLOBS = {
  "a46.jpeg": JPEG,
  "a47.jpeg": JPEG,
  "big1.pdf": Buffer.alloc(12 * 1024 * 1024),
  "big2.pdf": Buffer.alloc(12 * 1024 * 1024),
};

/** A fake `run` over the files table that records every query. */
function fakeFiles() {
  const calls = [];
  const run = async (sql, params) => {
    calls.push({ sql, params });
    assert.match(sql, /FROM files WHERE id = ANY\(\$1::text\[\]\) AND storage_path IS NOT NULL/);
    return params[0].filter((id) => FILES[id]).map((id) => FILES[id]);
  };
  const reads = [];
  const read = async (storagePath) => {
    reads.push(storagePath);
    if (!BLOBS[storagePath]) throw Object.assign(new Error(`ENOENT: ${storagePath}`), { code: "ENOENT" });
    return BLOBS[storagePath];
  };
  return { run, read, calls, reads };
}

// ---- the resolver (lib/mail-attachments.ts) ---------------------------------

test("no ids → no attachments, and neither the db nor the disk is touched", async () => {
  const f = fakeFiles();
  assert.deepEqual(await loadFileAttachments(f.run, f.read, []), { ok: true, attachments: [] });
  assert.equal(f.calls.length, 0);
  assert.equal(f.reads.length, 0);
});

test("ids resolve to attachments in the order given, with name + mime type from the files row", async () => {
  const f = fakeFiles();
  const r = await loadFileAttachments(f.run, f.read, ["proj-47", "proj-46", "proj-47"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.attachments.map((a) => [a.filename, a.mimeType, a.content]), [
    ["IMG_0047.jpeg", "image/jpeg", JPEG],
    ["IMG_0046.jpeg", "image/jpeg", JPEG],
  ]);
  assert.deepEqual(f.calls[0].params, [["proj-47", "proj-46"]], "one query, duplicates dropped");
});

test("an unknown id (or one with no stored blob row) refuses the lot, naming the id, without reading any file", async () => {
  const f = fakeFiles();
  const r = await loadFileAttachments(f.run, f.read, ["proj-46", "proj-typo", ""]);
  assert.equal(r.ok, false);
  assert.match(r.error, /"proj-typo", ""/);
  assert.match(r.error, /list_project_files/);
  assert.equal(f.reads.length, 0);
});

test("a files row whose blob is gone from disk refuses, naming the file", async () => {
  const f = fakeFiles();
  const r = await loadFileAttachments(f.run, f.read, ["proj-46", "proj-gone"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /"Plans\.pdf" is missing from storage/);
});

test("over Gmail's cap in total refuses, even when each file is under it", async () => {
  const f = fakeFiles();
  assert.ok(BLOBS["big1.pdf"].length < MAX_ATTACHMENT_BYTES);
  const r = await loadFileAttachments(f.run, f.read, ["proj-big1", "proj-big2"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /24\.0 MB, over Gmail's ~25 MB limit \(22\.0 MB max\)/);
});

test("more than the per-email file limit is refused before any query", async () => {
  const f = fakeFiles();
  const ids = Array.from({ length: MAX_EMAIL_ATTACHMENTS + 1 }, (_, i) => `proj-${i}`);
  const r = await loadFileAttachments(f.run, f.read, ids);
  assert.equal(r.ok, false);
  assert.match(r.error, /Too many attachments \(11\)/);
  assert.equal(f.calls.length, 0);
});

// ---- the granted send (lib/agent-sends.ts) ----------------------------------

const root = new URL("../", import.meta.url);
const STUBS = {
  "@/lib/db": ["query", "queryOne"],
  "@/lib/notify-owner": ["notifyAgentFailure"],
  "@/lib/bidding": ["sendBidPackageOp"],
  "@/lib/send-ops": ["sendInvoiceOp", "sendPurchaseOrderOp"],
  "@/lib/newsletter-outbox": ["releaseOutboxItem"],
  "@/lib/doc-drafts": ["submitDocDraftForSignature"],
  "@/lib/gmail": ["gmailConfigured", "sendNewEmail"],
  "@/lib/sms": ["sendSms"],
  "@/lib/voice": ["placeCall"],
  "@/lib/uploads": ["readUpload"],
  "@/lib/owner-grants": ["consumeGrant", "recordGrantResult", "refundGrantUse"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const spec = url.slice("stub:".length);
    let source = STUBS[spec].map((n) => `export const ${n} = (...a) => globalThis.__sends.${n}(...a);`).join("\n");
    // The grant catalogue is pure — use the real one.
    if (spec === "@/lib/owner-grants") {
      source += `\nexport { ACTION_TARGET_KIND, isGatedAction } from ${JSON.stringify(new URL("lib/owner-grant-types.ts", root).href)};`;
    }
    return { format: "module", source, shortCircuit: true };
  },
});
const { performGrantedAction } = await import("../lib/agent-sends.ts");

const GRANT = "11111111-1111-4111-8111-111111111111";
const TO = "orders@fgtcabinetry.example";

/** Fresh recorders for one send: what was queried, spent, refunded, emailed, audited. */
function world() {
  const f = fakeFiles();
  const w = { consumed: [], recorded: [], refunded: [], sent: [], audits: [], files: f };
  globalThis.__sends = {
    query: async (sql, params) => {
      if (/FROM files/.test(sql)) return { rows: await f.run(sql, params) };
      if (/INSERT INTO agent_runs/.test(sql)) w.audits.push(params);
      return { rows: [] };
    },
    queryOne: async () => null,
    notifyAgentFailure: async () => {},
    readUpload: f.read,
    gmailConfigured: () => true,
    sendNewEmail: async (opts) => {
      w.sent.push(opts);
    },
    consumeGrant: async (...a) => {
      w.consumed.push(a);
      return { ok: true };
    },
    recordGrantResult: async (...a) => {
      w.recorded.push(a);
    },
    refundGrantUse: async (...a) => {
      w.refunded.push(a);
    },
  };
  return w;
}

const send = (email) =>
  performGrantedAction({ action: "send_email", grantId: GRANT, agent: "claude", email: { to: TO, subject: "Tierney kitchen layout", body: "Photos attached.", ...email } });

test("no attachments: the same plain-text send, summary, grant spend and audit as before", async () => {
  const w = world();
  const r = await send({});
  assert.deepEqual(r, { ok: true, summary: `Email sent to ${TO}: "Tierney kitchen layout"` });
  assert.deepEqual(w.sent, [{ to: TO, subject: "Tierney kitchen layout", bodyText: "Photos attached." }], "no attachments key at all");
  assert.deepEqual(w.consumed, [[GRANT, "send_email", { kind: "email", id: TO, to: TO }]]);
  assert.equal(w.files.calls.length, 0, "no files query");
  assert.equal(w.refunded.length, 0);
  assert.equal(w.audits[0][2], `send_email email:${TO}`);
});

test("valid attachments: spent once, emailed with the files, and named in the summary + audit", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-46", "proj-47"] });
  assert.equal(r.ok, true);
  assert.equal(r.summary, `Email sent to ${TO}: "Tierney kitchen layout" with 2 attachments: IMG_0046.jpeg, IMG_0047.jpeg`);
  assert.deepEqual(r.attachments, ["IMG_0046.jpeg", "IMG_0047.jpeg"]);
  assert.equal(w.consumed.length, 1);
  assert.equal(w.sent.length, 1);
  assert.deepEqual(w.sent[0].attachments.map((a) => [a.filename, a.mimeType, a.content]), [
    ["IMG_0046.jpeg", "image/jpeg", JPEG],
    ["IMG_0047.jpeg", "image/jpeg", JPEG],
  ]);
  assert.match(w.recorded[0][1], /^ok: .*with 2 attachments: IMG_0046\.jpeg, IMG_0047\.jpeg$/);
  assert.equal(w.audits[0][2], `send_email email:${TO} + IMG_0046.jpeg, IMG_0047.jpeg`);
});

test("an unknown file id is refused and the grant is NOT consumed", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-46", "proj-typo"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /"proj-typo"/);
  assert.deepEqual([w.consumed.length, w.recorded.length, w.refunded.length, w.sent.length], [0, 0, 0, 0]);
});

test("a missing blob is refused and the grant is NOT consumed", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-gone"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /missing from storage/);
  assert.deepEqual([w.consumed.length, w.sent.length], [0, 0]);
});

test("over the size cap is refused and the grant is NOT consumed", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-big1", "proj-big2"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /over Gmail's ~25 MB limit/);
  assert.deepEqual([w.consumed.length, w.sent.length], [0, 0]);
});
