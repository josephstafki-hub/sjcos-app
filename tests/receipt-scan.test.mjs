import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import * as r from "../lib/receipt-scan-core.ts";
import * as u from "../lib/unsorted-docs-core.ts";

// Receipt scanning: Claude's reply → a checked read (amounts in cents, slugs
// that exist, "sure" only with a slug), when a read files itself vs waits on
// /unsorted, and — against a real disposable Postgres — that applyRead saves
// the read, files a receipt that names its job (cost logged once, Undo puts it
// back) and leaves an unsure / duplicate one in the tray.

const meta = { model: "test", readAt: "2026-10-20T12:00:00Z" };
const known = new Set(["zz-libby", "zz-egan"]);

const reply = (o) => "Here you go:\n```json\n" + JSON.stringify(o) + "\n```";
const base = {
  is_receipt: true, kind: "receipt", vendor: "Menards", location: "#3112 Maple Grove MN", date: "2026-10-18", time: "2:41 PM",
  number: "88213", payment: "VISA ****4412", subtotal: 43.19, tax: "3.11", total: "$46.30", job_hint: "LIBBY",
  items: [{ qty: 2, description: "2x4x8 stud, kiln dried", sku: "", amount: 8.94 }, { qty: "x", description: "", amount: null }],
  summary: "Framing lumber", notes: "", project_slug: "zz-libby", confidence: "sure", reason: "LIBBY written as the job",
  guesses: [{ project_slug: "zz-egan", reason: "same week" }, { project_slug: "nope", reason: "x" }, { project_slug: "zz-libby", reason: "dupe" }],
  overhead_likely: false,
};

test("toCents reads dollars the way receipts print them", () => {
  assert.equal(r.toCents(46.3), 4630);
  assert.equal(r.toCents("$1,046.30"), 104630);
  assert.equal(r.toCents("(12.00)"), -1200);
  assert.equal(r.toCents("-5"), -500);
  assert.equal(r.toCents("abc"), null);
  assert.equal(r.toCents(null), null);
  assert.equal(r.toCents(""), null);
});

test("parseReceiptReply checks everything Claude sends", () => {
  const x = r.parseReceiptReply(reply(base), known, meta);
  assert.ok(x);
  assert.equal(x.total_cents, 4630);
  assert.equal(x.tax_cents, 311);
  assert.equal(x.subtotal_cents, 4319);
  assert.equal(x.items.length, 1, "an empty line is dropped");
  assert.deepEqual(x.items[0], { qty: 2, description: "2x4x8 stud, kiln dried", sku: "", amount_cents: 894 });
  assert.deepEqual(x.match, { project_slug: "zz-libby", confidence: "sure", reason: "LIBBY written as the job" });
  assert.deepEqual(x.guesses, [{ project_slug: "zz-egan", reason: "same week" }], "unknown slugs and the match itself are dropped");
  assert.equal(x.model, "test");

  const unknown = r.parseReceiptReply(reply({ ...base, project_slug: "made-up" }), known, meta);
  assert.deepEqual(unknown.match, { project_slug: null, confidence: "none", reason: "LIBBY written as the job" }, "a slug that doesn't exist is never sure");
  const noConf = r.parseReceiptReply(reply({ ...base, confidence: "none" }), known, meta);
  assert.equal(noConf.match.project_slug, null);
  assert.equal(r.parseReceiptReply(reply({ ...base, date: "10/18/2026" }), known, meta).date, null);
  assert.equal(r.parseReceiptReply("I can't read this", known, meta), null);
  assert.equal(r.parseReceiptReply(reply({ is_receipt: false }), known, meta).is_receipt, false);
});

test("a read files itself only when the job is certain", () => {
  const x = r.parseReceiptReply(reply(base), known, meta);
  assert.deepEqual(r.autoFileTarget(x, null, null), { projectSlug: "zz-libby", why: "LIBBY written as the job" });
  assert.deepEqual(r.autoFileTarget({ ...x, match: { project_slug: null, confidence: "none", reason: "" } }, "zz-egan", null), { projectSlug: "zz-egan", why: "the sender picked the job" });
  assert.equal(r.autoFileTarget({ ...x, match: { ...x.match, confidence: "likely" } }, null, null), null, "likely waits on Joe");
  assert.equal(r.autoFileTarget({ ...x, total_cents: null }, "zz-egan", null), null, "no total, no filing");
  assert.equal(r.autoFileTarget({ ...x, is_receipt: false }, "zz-egan", null), null);
  assert.equal(r.autoFileTarget(x, null, 7), null, "a likely duplicate waits");
  assert.match(r.whyUnsure(x, 7), /#7/);
  assert.match(r.whyUnsure(x, 0), /already logged/);
  assert.match(r.whyUnsure({ ...x, total_cents: null }, null), /total/);
  assert.match(r.whyUnsure({ ...x, match: { project_slug: null, confidence: "none", reason: "" } }, null), /LIBBY/);
});

test("the prompt carries the sender's hints and the job list", () => {
  const p = r.receiptPrompt({
    fromLabel: "Text from Mike", senderProject: null, senderNote: "for the egan deck", threadLink: 'project "Libby" (zz-libby)',
    today: "2026-10-20", jobs: [{ slug: "zz-libby", name: "Libby basement", client_name: "Libby", address: "1 Elm" }],
  });
  assert.match(p, /for the egan deck/);
  assert.match(p, /zz-libby \| Libby basement \| Libby \| 1 Elm/);
  assert.match(p, /a hint only/);
  assert.match(p, /never sure/);
});

test("applyRead saves the read, files a sure one and leaves the rest", { skip: !harnessAvailable() && "postgresql-16 binaries not installed" }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    await client.query("BEGIN");
    try {
      await run(`INSERT INTO projects (slug, name, status, client_name, address) VALUES ('zz-libby','Libby basement','construction','Libby','1 Elm'), ('zz-egan','Egan deck','construction','Egan','2 Oak')`);
      const fileRow = (id) => run(`INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type) VALUES ($1, '', 'doc', $1, '', $1, 'image/jpeg')`, [id]);
      const stage = async (ref, fileId) => {
        await fileRow(fileId);
        const s = await u.stageDoc(run, { sourceRef: ref, kind: "receipt", fromLabel: "Scanned by Joe", subject: "Receipt photo", attachmentFileIds: [fileId], stagedBy: "scan" });
        assert.ok(s.ok);
        await run(`UPDATE unsorted_docs SET extract_state = 'reading', extract_started_at = now() WHERE id = $1`, [s.id]);
        return s.id;
      };

      // ---- sure: filed to the job, expense logged with the photo as its receipt
      const a = await stage("scan:zz-a", "zz-scan-a");
      const x = r.parseReceiptReply(reply(base), known, meta);
      const out = await r.applyRead(run, a, x, { senderProjectSlug: null, today: "2026-10-20", by: "Claude" });
      assert.deepEqual(out, { status: "filed", project_slug: "zz-libby", agent_queued: true });
      let doc = await u.getDoc(run, a);
      assert.equal(doc.status, "filed");
      assert.equal(doc.extract_state, "done");
      assert.equal(doc.extracted.vendor, "Menards");
      assert.equal(doc.extracted.items[0].amount_cents, 894);
      assert.equal(doc.amount_cents, 4630);
      assert.equal(doc.doc_date, "2026-10-18");
      assert.equal(doc.resolved_by, "Claude");
      assert.equal(doc.why_unsure, "", "nothing to be unsure about once it filed itself");
      assert.match(doc.agent_note, /LIBBY/);
      const [exp] = await run(`SELECT amount_cents, receipt_file_id, expense_date::text AS d FROM expenses WHERE source_ref = 'scan:zz-a'`);
      assert.deepEqual(exp, { amount_cents: 4630, receipt_file_id: "zz-scan-a", d: "2026-10-18" });
      const [trig] = await run(`SELECT kind, payload->>'mode' AS mode FROM agent_triggers WHERE ref = $1`, [`unsorted:${a}`]);
      assert.deepEqual(trig, { kind: "filing", mode: "place_cost" }, "the filing agent places the cost like when Joe files it");

      // ---- Undo takes it back to the tray, expense gone
      assert.ok((await u.undoDoc(run, a)).ok);
      assert.equal((await run(`SELECT count(*)::int AS n FROM expenses WHERE source_ref = 'scan:zz-a'`))[0].n, 0);

      // ---- same total + date as another receipt: waits, flagged
      const b = await stage("scan:zz-b", "zz-scan-b");
      const dup = await r.applyRead(run, b, x, { senderProjectSlug: null, today: "2026-10-20", by: "Claude" });
      assert.equal(dup.status, "pending");
      doc = await u.getDoc(run, b);
      assert.match(doc.why_unsure, new RegExp(`#${a}`));
      assert.equal(doc.extracted.total_cents, 4630);

      // ---- only likely: waits with Claude's guess first, sender's pick ahead of it
      const c = await stage("scan:zz-c", "zz-scan-c");
      await run(`UPDATE unsorted_docs SET sender_project_id = (SELECT id FROM projects WHERE slug = 'zz-egan') WHERE id = $1`, [c]);
      const likely = { ...x, total_cents: 1299, match: { project_slug: "zz-libby", confidence: "likely", reason: "lumber, Libby is framing" }, guesses: [] };
      const lk = await r.applyRead(run, c, { ...likely, is_receipt: false }, { senderProjectSlug: "zz-egan", today: "2026-10-20", by: "Claude" });
      assert.equal(lk.status, "pending", "not a receipt: never filed, even with a job picked");
      doc = await u.getDoc(run, c);
      assert.equal(doc.doc_kind, "other");
      assert.equal(doc.sender_project_slug, "zz-egan");
      assert.deepEqual(doc.suggestions.map((s) => s.project_slug), ["zz-egan", "zz-libby"]);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
