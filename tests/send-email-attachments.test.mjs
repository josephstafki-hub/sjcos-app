import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { loadFileAttachments, MAX_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS } from "../lib/mail-attachments.ts";

// send_email with attachment_file_ids (mcp/grants-tools.mjs → lib/agent-sends.ts).
// The rules that matter: a plain-text email with no attachments stages exactly
// the same intent as before, attachments travel on the intent as file
// REFERENCES (the provider reads bytes at dispatch), and a bad file id /
// missing blob / oversize packet is refused BEFORE any intent is staged — a
// typo must never burn Joe's one-use grant (it is spent at dispatch).
//
// performGrantedAction runs for real; every module it talks to (db, intents,
// dispatcher, grants, disk) is stubbed below, so nothing is queried, spent or
// emailed.

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
  "@/lib/sms": ["sendSms"],
  "@/lib/voice": ["placeCall"],
  "@/lib/uploads": ["readUpload"],
  "@/lib/commands/db": ["withTransaction"],
  "@/lib/commands/intents": ["enqueueIntent"],
  "@/lib/dispatch/db": ["dispatchIntentsNow", "describeOutcome"],
  "@/lib/owner-grants": ["checkGrantCovers", "consumeGrant", "recordGrantResult", "refundGrantUse"],
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

/** Fresh recorders for one send: what was queried, staged, dispatched, audited. */
function world() {
  const f = fakeFiles();
  const w = { covers: [], consumed: [], refunded: [], intents: [], dispatched: [], audits: [], files: f };
  globalThis.__sends = {
    query: async (sql, params) => {
      if (/FROM files/.test(sql)) return { rows: await f.run(sql, params) };
      if (/INSERT INTO agent_runs/.test(sql)) w.audits.push(params);
      return { rows: [] };
    },
    queryOne: async () => null,
    notifyAgentFailure: async () => {},
    readUpload: f.read,
    checkGrantCovers: async (...a) => {
      w.covers.push(a);
      return { ok: true };
    },
    consumeGrant: async (...a) => {
      w.consumed.push(a);
      return { ok: true };
    },
    recordGrantResult: async () => {},
    refundGrantUse: async (...a) => {
      w.refunded.push(a);
    },
    withTransaction: async (fn) => fn(async () => []),
    enqueueIntent: async (_run, input) => {
      w.intents.push(input);
      return { intent: { id: `intent-${w.intents.length}` }, created: true };
    },
    dispatchIntentsNow: async (ids) => {
      w.dispatched.push(ids);
      return ids.map(() => ({ responseClass: "accepted", state: "accepted" }));
    },
    describeOutcome: (o, what) => (o?.responseClass === "accepted" ? { ok: true, summary: `${what} — accepted.`, state: "accepted" } : { ok: false, error: `${what}: not sent`, state: "held" }),
  };
  return w;
}

const send = (email) =>
  performGrantedAction({ action: "send_email", grantId: GRANT, agent: "claude", email: { to: TO, subject: "Tierney kitchen layout", body: "Photos attached.", ...email } });

test("no attachments: one plain-text intent bound to the grant, no files query, no attachments key", async () => {
  const w = world();
  const r = await send({});
  assert.equal(r.ok, true);
  assert.equal(r.summary, `Email to ${TO}: "Tierney kitchen layout" — accepted.`);
  assert.equal(r.attachments, undefined);
  assert.equal(w.intents.length, 1);
  assert.equal(w.intents[0].kind, "send_email");
  assert.equal(w.intents[0].grantId, GRANT);
  assert.equal(w.intents[0].recipient, TO);
  assert.equal(w.intents[0].payload.to, TO);
  assert.equal(w.intents[0].payload.subject, "Tierney kitchen layout");
  assert.equal(w.intents[0].payload.bodyText, "Photos attached.");
  assert.equal(Object.hasOwn(w.intents[0].payload, "attachments"), false, "no attachments key at all");
  assert.deepEqual(w.dispatched, [["intent-1"]]);
  assert.equal(w.files.calls.length, 0, "no files query");
  assert.equal(w.consumed.length, 0, "the grant is spent at dispatch, not here");
  assert.equal(w.audits[0][2], `send_email email:${TO}`);
});

test("valid attachments: one intent carrying file references, named in the summary + audit", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-46", "proj-47", "proj-46"] });
  assert.equal(r.ok, true);
  assert.equal(r.summary, `Email to ${TO}: "Tierney kitchen layout" — accepted. with 2 attachments: IMG_0046.jpeg, IMG_0047.jpeg`);
  assert.deepEqual(r.attachments, ["IMG_0046.jpeg", "IMG_0047.jpeg"]);
  assert.equal(w.intents.length, 1);
  assert.deepEqual(w.intents[0].payload.attachments, [
    { filename: "IMG_0046.jpeg", mimeType: "image/jpeg", fileId: "proj-46" },
    { filename: "IMG_0047.jpeg", mimeType: "image/jpeg", fileId: "proj-47" },
  ]);
  assert.equal(w.audits[0][2], `send_email email:${TO} + IMG_0046.jpeg, IMG_0047.jpeg`);
});

test("different attachments are a different operation (no replay of the earlier intent)", async () => {
  const w = world();
  await send({ attachment_file_ids: ["proj-46"] });
  await send({ attachment_file_ids: ["proj-47"] });
  await send({});
  const keys = w.intents.map((i) => i.operationKey);
  assert.equal(new Set(keys).size, 3);
});

test("an unknown file id is refused before any intent is staged", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-46", "proj-typo"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /"proj-typo"/);
  assert.deepEqual([w.covers.length, w.intents.length, w.dispatched.length, w.consumed.length, w.refunded.length], [0, 0, 0, 0, 0]);
});

test("a missing blob is refused before any intent is staged", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-gone"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /missing from storage/);
  assert.deepEqual([w.intents.length, w.dispatched.length], [0, 0]);
});

test("over the size cap is refused before any intent is staged", async () => {
  const w = world();
  const r = await send({ attachment_file_ids: ["proj-big1", "proj-big2"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /over Gmail's ~25 MB limit/);
  assert.deepEqual([w.intents.length, w.dispatched.length], [0, 0]);
});
