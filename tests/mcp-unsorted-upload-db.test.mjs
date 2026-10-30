// Agent uploads into the Unsorted tray (mcp/upload-tools.mjs create/append/
// commit_unsorted_upload) against a REAL disposable Postgres: aimed at a doc by
// id → the file lands on that tray card; the same name again replaces it in
// place (same file_id); a source_ref nothing is staged under yet holds the
// file; filing the doc moves every attachment onto the project's Files as
// "RECEIPT · <vendor>" with the expense linked to it; a file committed onto a
// doc already filed goes straight to the project. delete_expense removes a
// duplicate, records why, and clears the doc's cost link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { registerUploadTools } from "../mcp/upload-tools.mjs";
import { registerFinancialsTools } from "../mcp/financials-tools.mjs";
import { PUT_NAME, stagingDir, CHUNK_LIMIT_BYTES } from "../lib/upload-staging.ts";
import * as u from "../lib/unsorted-docs-core.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => {
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return { ok: false, error: res.content[0].text, isError: res.isError };
  }
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pdfOf = (kb) => Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(kb * 1024)]);

async function harness(url, uploadDir) {
  process.env.SJCOS_AGENT_NAME = "test-agent";
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const principal = { current: { userId: null, role: null, name: null, active: false, revoked: false } };
  const tools = new Map();
  const server = { registerTool: (name, _meta, fn) => tools.set(name, fn) };
  const envValue = (k) => (k === "SESSION_SECRET" ? "test-secret" : k === "NEXT_PUBLIC_APP_URL" ? "https://os.example.test" : "");
  registerUploadTools(server, { rows, json, pool, uploadDir, envValue, currentPrincipal: async () => principal.current });
  registerFinancialsTools(server, { rows, json, pool, strippedDollarError: () => null, currentPrincipal: async () => principal.current });
  return { pool, rows, principal, call: async (name, args) => parse(await tools.get(name)(args)) };
}

/** What app/api/uploads/[id]/route.ts leaves behind after a good PUT. */
async function put(dir, uploadId, buf) {
  await mkdir(stagingDir(dir, uploadId), { recursive: true });
  await writeFile(path.join(stagingDir(dir, uploadId), PUT_NAME), buf);
}

test("upload receipts into the Unsorted tray, replace by name, hold by source_ref, file to a job", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sjc-unsorted-upl-"));
    const h = await harness(url, dir);
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    try {
      await client.query(`INSERT INTO projects (slug, name, status) VALUES ('zz-battey', 'ZZ Battey Kitchen', 'construction')`);
      const staged = await u.stageDoc(run, { sourceRef: "homedepot:4521-00987", kind: "receipt", vendorLabel: "Home Depot", amountCents: 18744, docDate: "2026-10-20", stagedBy: "hermes" });
      assert.ok(staged.ok && !staged.existed);
      const docId = staged.id;
      const name = "Home Depot 4521-00987.pdf";
      // Re-staging with only some fields (an agent adding a file) keeps the rest.
      assert.ok((await u.stageDoc(run, { sourceRef: "homedepot:4521-00987", summary: "Cabinet hardware" })).existed);
      const kept = await u.getDoc(run, docId);
      assert.deepEqual([kept.vendor_label, kept.amount_cents, kept.doc_kind, kept.doc_date, kept.summary], ["Home Depot", 18744, "receipt", "2026-10-20", "Cabinet hardware"]);

      // ── guards
      const pdf = pdfOf(120);
      const base = { filename: name, mime_type: "application/pdf", size_bytes: pdf.length, sha256: sha(pdf) };
      assert.match((await h.call("create_unsorted_upload", base)).error, /exactly one of document_id or source_ref/);
      assert.match((await h.call("create_unsorted_upload", { ...base, document_id: docId, source_ref: "homedepot:x" })).error, /exactly one/);
      assert.match((await h.call("create_unsorted_upload", { ...base, document_id: 999999 })).error, /No Unsorted document 999999/);

      // ── by document_id: PUT, commit → on that tray card
      const c1 = await h.call("create_unsorted_upload", { ...base, document_id: docId });
      assert.equal(c1.ok, true, JSON.stringify(c1));
      assert.equal(c1.target_document_id, docId);
      assert.equal(c1.source_ref, "homedepot:4521-00987");
      assert.equal(c1.will_replace_file_id, null);
      assert.equal(c1.method, "PUT");
      assert.equal(new URL(c1.upload_url).pathname, `/api/uploads/${c1.upload_id}`);
      assert.match((await h.call("commit_unsorted_upload", { upload_id: c1.upload_id })).error, /Nothing received yet.*append_unsorted_upload/);
      assert.match((await h.call("commit_project_upload", { upload_id: c1.upload_id })).error, /commit_unsorted_upload/);
      await put(dir, c1.upload_id, pdf);
      const d1 = await h.call("commit_unsorted_upload", { upload_id: c1.upload_id });
      assert.equal(d1.ok, true, JSON.stringify(d1));
      assert.deepEqual([d1.document_id, d1.name, d1.replaced, d1.held, d1.received_via], [docId, name, false, false, "put"]);
      const fileId = d1.file_id;
      let doc = await u.getDoc(run, docId);
      assert.deepEqual(doc.attachment_file_ids, [fileId]);
      let [f] = await run(`SELECT project_key, tag, sha256, mime_type, storage_path, client_visible FROM files WHERE id = $1`, [fileId]);
      assert.deepEqual([f.project_key, f.tag, f.sha256, f.client_visible], ["", u.UNSORTED_TAG, sha(pdf), false]);
      assert.ok((await readFile(path.join(dir, f.storage_path))).equals(pdf));
      const twice = await h.call("commit_unsorted_upload", { upload_id: c1.upload_id });
      assert.deepEqual([twice.already_committed, twice.file_id, twice.document_id], [true, fileId, docId]);

      // ── same name again → replaced in place, same file_id, one copy
      const v2 = pdfOf(90);
      const c2 = await h.call("create_unsorted_upload", { ...base, size_bytes: v2.length, sha256: sha(v2), document_id: docId });
      assert.equal(c2.will_replace_file_id, fileId);
      const parts = Math.ceil(v2.length / CHUNK_LIMIT_BYTES);
      for (let n = 1; n <= parts; n++) {
        const r = await h.call("append_unsorted_upload", { upload_id: c2.upload_id, part_number: n, data_base64: v2.subarray((n - 1) * CHUNK_LIMIT_BYTES, n * CHUNK_LIMIT_BYTES).toString("base64") });
        assert.equal(r.ok, true, JSON.stringify(r));
      }
      const d2 = await h.call("commit_unsorted_upload", { upload_id: c2.upload_id });
      assert.equal(d2.ok, true, JSON.stringify(d2));
      assert.deepEqual([d2.file_id, d2.replaced, d2.received_via], [fileId, true, "parts"]);
      doc = await u.getDoc(run, docId);
      assert.deepEqual(doc.attachment_file_ids, [fileId], "one current copy");
      assert.ok((await readFile(path.join(dir, f.storage_path))).equals(v2));
      assert.equal((await run(`SELECT sha256 FROM files WHERE id = $1`, [fileId]))[0].sha256, sha(v2));

      // replace_existing:false keeps both; a photo is an image row.
      const img = randomBytes(4000);
      const c3 = await h.call("create_unsorted_upload", { filename: "receipt photo", mime_type: "image/jpeg", size_bytes: img.length, sha256: sha(img), source_ref: "homedepot:4521-00987", replace_existing: false });
      assert.deepEqual([c3.name, c3.target_document_id], ["receipt photo.jpg", docId]);
      await put(dir, c3.upload_id, img);
      const d3 = await h.call("commit_unsorted_upload", { upload_id: c3.upload_id });
      assert.equal(d3.ok, true, JSON.stringify(d3));
      assert.equal((await run(`SELECT type FROM files WHERE id = $1`, [d3.file_id]))[0].type, "img");
      doc = await u.getDoc(run, docId);
      assert.deepEqual(doc.attachment_file_ids, [fileId, d3.file_id]);

      // ── a source_ref nothing is staged under yet: held, then replaced by name while held
      const held = pdfOf(30);
      const c4 = await h.call("create_unsorted_upload", { filename: "Menards 88123.pdf", mime_type: "application/pdf", size_bytes: held.length, sha256: sha(held), source_ref: "menards:88123" });
      assert.equal(c4.target_document_id, null);
      assert.match(c4.note, /held/);
      await put(dir, c4.upload_id, held);
      const d4 = await h.call("commit_unsorted_upload", { upload_id: c4.upload_id });
      assert.deepEqual([d4.ok, d4.document_id, d4.held], [true, null, true], JSON.stringify(d4));
      const heldAgain = pdfOf(31);
      const c5 = await h.call("create_unsorted_upload", { filename: "Menards 88123.pdf", mime_type: "application/pdf", size_bytes: heldAgain.length, sha256: sha(heldAgain), source_ref: "menards:88123" });
      assert.equal(c5.will_replace_file_id, d4.file_id);
      await put(dir, c5.upload_id, heldAgain);
      const d5 = await h.call("commit_unsorted_upload", { upload_id: c5.upload_id });
      assert.deepEqual([d5.file_id, d5.replaced, d5.held], [d4.file_id, true, true]);
      const waiting = await run(`SELECT file_id FROM project_uploads WHERE target = 'unsorted' AND status = 'committed' AND unsorted_doc_id IS NULL AND source_ref = 'menards:88123'`);
      assert.deepEqual([...new Set(waiting.map((w) => w.file_id))], [d4.file_id]);

      // ── file the Home Depot doc: every attachment onto the job as RECEIPT · Home Depot, expense linked
      const filed = await u.fileDoc(run, docId, { to: "project", projectSlug: "zz-battey" }, { by: "hermes", today: "2026-10-29" });
      assert.ok(filed.ok, JSON.stringify(filed));
      assert.equal(filed.cost.source, "expense");
      const onJob = await run(`SELECT id, project_key, tag FROM files WHERE id = ANY($1::text[]) ORDER BY id`, [[fileId, d3.file_id]]);
      assert.ok(onJob.every((x) => x.project_key === "zz-battey" && x.tag === "RECEIPT · Home Depot"), JSON.stringify(onJob));
      const [exp] = await run(`SELECT receipt_file_id, amount_cents FROM expenses WHERE id = $1`, [filed.cost.id]);
      assert.deepEqual([exp.receipt_file_id, Number(exp.amount_cents)], [fileId, 18744]);

      // ── a file committed onto a doc already filed goes straight onto the project
      const late = pdfOf(10);
      const c6 = await h.call("create_unsorted_upload", { filename: "packing slip.pdf", mime_type: "application/pdf", size_bytes: late.length, sha256: sha(late), document_id: docId });
      assert.match(c6.note, /already filed/);
      await put(dir, c6.upload_id, late);
      const d6 = await h.call("commit_unsorted_upload", { upload_id: c6.upload_id });
      assert.equal(d6.ok, true, JSON.stringify(d6));
      [f] = await run(`SELECT project_key, tag FROM files WHERE id = $1`, [d6.file_id]);
      assert.deepEqual([f.project_key, f.tag], ["zz-battey", "RECEIPT · Home Depot"]);
      assert.equal((await u.getDoc(run, docId)).attachment_file_ids.length, 3);

      // Undo puts them all back in the tray.
      assert.ok((await u.undoDoc(run, docId)).ok);
      assert.ok((await run(`SELECT tag FROM files WHERE id = ANY($1::text[])`, [[fileId, d3.file_id, d6.file_id]])).every((x) => x.tag === u.UNSORTED_TAG));

      // ── attachDocFiles on a doc whose expense receipt was the email: re-linked to the PDF
      const e2 = await u.stageDoc(run, { sourceRef: "gmail:zz-e2", kind: "receipt", vendorLabel: "Menards", amountCents: 5000, docDate: "2026-10-21" });
      await run(`INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type) VALUES ('zz-mail-e2', '', 'doc', 'Email.html', '', 'zz-mail-e2', 'text/html')`);
      await run(`UPDATE unsorted_docs SET email_file_id = 'zz-mail-e2' WHERE id = $1`, [e2.id]);
      const f2 = await u.fileDoc(run, e2.id, { to: "project", projectSlug: "zz-battey" }, { by: "hermes", today: "2026-10-29" });
      assert.equal((await run(`SELECT receipt_file_id FROM expenses WHERE id = $1`, [f2.cost.id]))[0].receipt_file_id, "zz-mail-e2");
      assert.equal((await run(`SELECT tag FROM files WHERE id = 'zz-mail-e2'`))[0].tag, "RECEIPT · Menards");
      await run(`INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type) VALUES ('zz-pdf-e2', '', 'doc', 'r.pdf', '', 'zz-pdf-e2', 'application/pdf')`);
      const att = await u.attachDocFiles(run, e2.id, { attachmentFileIds: ["zz-pdf-e2", "zz-pdf-e2"] });
      assert.deepEqual(att.added, ["zz-pdf-e2"]);
      assert.equal((await run(`SELECT receipt_file_id FROM expenses WHERE id = $1`, [f2.cost.id]))[0].receipt_file_id, "zz-pdf-e2");
      assert.deepEqual((await u.attachDocFiles(run, e2.id, { attachmentFileIds: ["zz-pdf-e2"] })).added, [], "already on the doc");

      // ── list filters: prefix + paging
      const hd = await u.listDocsByStatus(run, ["pending", "needs_agent", "filed", "dismissed"], 10, { sourceRefPrefix: "homedepot:" });
      assert.deepEqual(hd.map((d) => d.id), [docId]);
      assert.equal(await u.countDocsByStatus(run, ["pending", "filed"], { sourceRefPrefix: "gmail:" }), 1);
      const page1 = await u.listDocsByStatus(run, ["pending", "filed"], 1);
      const page2 = await u.listDocsByStatus(run, ["pending", "filed"], 1, { offset: 1 });
      assert.equal(page1.length + page2.length, 2);
      assert.notEqual(page1[0].id, page2[0].id);

      // ── delete_expense: reason required, history kept, the doc's cost link cleared
      assert.match((await h.call("delete_expense", { project_slug: "zz-battey", id: f2.cost.id, reason: " " })).error, /reason is required/);
      assert.match((await h.call("delete_expense", { project_slug: "zz-battey", id: 987654, reason: "dup" })).error, /No expense 987654/);
      const del = await h.call("delete_expense", { project_slug: "zz-battey", id: f2.cost.id, reason: "Duplicate of the Home Depot order" });
      assert.equal(del.ok, true, JSON.stringify(del));
      assert.deepEqual(del.unsorted_document_ids, [e2.id]);
      assert.equal((await run(`SELECT count(*)::int AS n FROM expenses WHERE id = $1`, [f2.cost.id]))[0].n, 0);
      const after = await u.getDoc(run, e2.id);
      assert.deepEqual([after.status, after.cost_source, after.cost_id], ["filed", null, null]);
      assert.match(after.agent_note, /Expense removed: Duplicate/);
      const [ev] = await run(`SELECT detail, actor FROM project_workflow_events WHERE kind = 'expense_deleted'`);
      assert.equal(ev.detail.reason, "Duplicate of the Home Depot order");
      assert.equal(ev.actor, "agent:test-agent");
    } finally {
      await h.pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, { fresh: true, name: "sjcos_test_unsorted_uploads" });
});

test("Financial tools need the money area when an agent acts for a team member; owner and unattended runs pass", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sjc-fin-area-"));
    const h = await harness(url, dir);
    try {
      const staff = (await client.query(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-fin@example.test','x','Sam','staff','S', ARRAY['projects']) RETURNING id`)).rows[0].id;
      h.principal.current = { userId: staff, role: "staff", name: "Sam", active: true, revoked: false };
      const refused = await h.call("company_financials", {});
      assert.match(refused.error ?? "", /no "money" access/);
      await client.query(`UPDATE users SET permissions = ARRAY['projects','money'] WHERE id = $1`, [staff]);
      assert.equal((await h.call("company_financials", {})).error, undefined);
      h.principal.current = { userId: null, role: null, name: null, active: false, revoked: false };
      assert.equal((await h.call("company_financials", {})).error, undefined);
    } finally {
      await h.pool.end();
    }
  });
});
