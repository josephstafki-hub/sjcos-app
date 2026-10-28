// Agent binary uploads (mcp/upload-tools.mjs) against a REAL disposable
// Postgres: create → PUT body or base64 parts → commit (size + sha256),
// replace-by-name keeps one copy and its file_id, list_project_files shows the
// sha256 / updated_at / created_by, and delete_project_file goes through the
// 30-day trash (restore, reference guard, person-made files refused).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { registerUploadTools } from "../mcp/upload-tools.mjs";
import { registerBiddingTools } from "../mcp/bidding-tools.mjs";
import { PUT_NAME, stagingDir, verifyUploadSignature, CHUNK_LIMIT_BYTES } from "../lib/upload-staging.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const SECRET = "test-secret";
const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => {
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return { ok: false, error: res.content[0].text, isError: res.isError };
  }
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function harness(url, uploadDir) {
  process.env.SJCOS_AGENT_NAME = "test-agent";
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const principal = { current: { userId: null, role: null, name: null, active: false, revoked: false } };
  const tools = new Map();
  const server = { registerTool: (name, _meta, fn) => tools.set(name, fn) };
  const envValue = (k) => (k === "SESSION_SECRET" ? SECRET : k === "NEXT_PUBLIC_APP_URL" ? "https://os.example.test" : "");
  registerUploadTools(server, { rows, json, pool, uploadDir, envValue, currentPrincipal: async () => principal.current });
  registerBiddingTools(server, { rows, json, biddingCall: async () => ({}), uploadDir, envValue, strippedDollarError: () => null });
  return { pool, rows, principal, call: async (name, args) => parse(await tools.get(name)(args)) };
}

/** Send a buffer the fallback way: base64 parts of chunk_limit_bytes. */
async function appendAll(call, uploadId, buf, { order = "forward" } = {}) {
  const parts = [];
  for (let i = 0; i * CHUNK_LIMIT_BYTES < buf.length; i++) parts.push(i + 1);
  if (order === "reverse") parts.reverse();
  let last;
  for (const n of parts) {
    const slice = buf.subarray((n - 1) * CHUNK_LIMIT_BYTES, n * CHUNK_LIMIT_BYTES);
    last = await call("append_project_upload", { upload_id: uploadId, part_number: n, data_base64: slice.toString("base64") });
    assert.equal(last.ok, true, JSON.stringify(last));
  }
  return { calls: parts.length, last };
}

test("upload a 400 KB PDF, replace it by name, delete and restore", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sjc-upl-"));
    const h = await harness(url, dir);
    try {
      await client.query(`INSERT INTO projects (slug, name) VALUES ('zz-nkh', 'ZZ NKH Eden Prairie TI')`);
      const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(400 * 1024 - 9)]);
      const name = "NKH Eden Prairie TI - Plan Set (Bid).pdf";

      // ── fallback path: create → parts (reverse order, one resent) → commit
      const c1 = await h.call("create_project_upload", {
        project_slug: "zz-nkh", filename: name, mime_type: "application/pdf",
        size_bytes: pdf.length, sha256: sha(pdf), tag: "PLAN · Drawings",
      });
      assert.equal(c1.ok, true, JSON.stringify(c1));
      assert.equal(c1.name, name);
      assert.equal(c1.chunk_limit_bytes, 48 * 1024);
      assert.equal(c1.will_replace_file_id, null);
      const u = new URL(c1.upload_url);
      assert.equal(u.origin, "https://os.example.test");
      assert.equal(u.pathname, `/api/uploads/${c1.upload_id}`);
      assert.ok(verifyUploadSignature(SECRET, c1.upload_id, Number(u.searchParams.get("exp")), u.searchParams.get("sig")));
      assert.ok(!verifyUploadSignature("other", c1.upload_id, Number(u.searchParams.get("exp")), u.searchParams.get("sig")));

      const early = await h.call("commit_project_upload", { upload_id: c1.upload_id });
      assert.match(early.error, /Nothing received yet/);

      const { calls, last } = await appendAll(h.call, c1.upload_id, pdf, { order: "reverse" });
      assert.equal(calls, 9);
      assert.equal(last.received_bytes_total, pdf.length);
      // Resending a part overwrites it (total unchanged).
      const again = await h.call("append_project_upload", { upload_id: c1.upload_id, part_number: 2, data_base64: pdf.subarray(CHUNK_LIMIT_BYTES, 2 * CHUNK_LIMIT_BYTES).toString("base64") });
      assert.equal(again.received_bytes_total, pdf.length);
      // Guards on a part.
      assert.match((await h.call("append_project_upload", { upload_id: c1.upload_id, part_number: 10, data_base64: "AAAA" })).error, /past the end/);
      assert.match((await h.call("append_project_upload", { upload_id: c1.upload_id, part_number: 1, data_base64: randomBytes(CHUNK_LIMIT_BYTES + 1).toString("base64") })).error, /limit is/);
      assert.match((await h.call("append_project_upload", { upload_id: c1.upload_id, part_number: 1, data_base64: "not base64!" })).error, /valid base64/);

      const done = await h.call("commit_project_upload", { upload_id: c1.upload_id });
      assert.equal(done.ok, true, JSON.stringify(done));
      assert.equal(done.replaced, false);
      assert.equal(done.size_label, "400 KB");
      assert.equal(done.received_via, "parts");
      const fileId = done.file_id;
      const twice = await h.call("commit_project_upload", { upload_id: c1.upload_id });
      assert.equal(twice.already_committed, true);
      assert.equal(twice.file_id, fileId);

      let list = await h.call("list_project_files", { project_slug: "zz-nkh" });
      assert.equal(list.length, 1);
      assert.equal(list[0].sha256, sha(pdf));
      assert.equal(list[0].created_by, "agent:test-agent");
      assert.equal(list[0].tag, "PLAN · Drawings");
      assert.ok(list[0].updated_at);
      const [row] = (await client.query(`SELECT storage_path, client_visible, type FROM files WHERE id = $1`, [fileId])).rows;
      assert.equal(row.client_visible, false);
      assert.equal(row.type, "doc");
      assert.ok((await readFile(path.join(dir, row.storage_path))).equals(pdf));
      // No cost, no Unsorted.
      assert.equal(Number((await client.query(`SELECT count(*) FROM unsorted_docs`)).rows[0].count), 0);

      // ── PUT path, same name → replaces in place, one copy, same id
      const v2 = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(300 * 1024)]);
      const c2 = await h.call("create_project_upload", { project_slug: "zz-nkh", filename: name, mime_type: "application/pdf", size_bytes: v2.length, sha256: sha(v2) });
      assert.equal(c2.will_replace_file_id, fileId);
      // What app/api/uploads/[id]/route.ts leaves behind after a good PUT.
      // First a truncated body: commit refuses and the upload stays open.
      await mkdir(stagingDir(dir, c2.upload_id), { recursive: true });
      await writeFile(path.join(stagingDir(dir, c2.upload_id), PUT_NAME), v2.subarray(0, 1000));
      const bad = await h.call("commit_project_upload", { upload_id: c2.upload_id });
      assert.match(bad.error, /Doesn't match what was declared.*PUT body is 1000 bytes/);
      const [open] = (await client.query(`SELECT status, last_error FROM project_uploads WHERE id = $1`, [c2.upload_id])).rows;
      assert.equal(open.status, "open");
      assert.match(open.last_error, /1000 bytes/);
      await writeFile(path.join(stagingDir(dir, c2.upload_id), PUT_NAME), v2);
      const put = await h.call("commit_project_upload", { upload_id: c2.upload_id });
      assert.equal(put.ok, true, JSON.stringify(put));
      assert.equal(put.replaced, true);
      assert.equal(put.file_id, fileId);
      assert.equal(put.received_via, "put");
      list = await h.call("list_project_files", { project_slug: "zz-nkh" });
      assert.equal(list.length, 1, "one current copy");
      assert.equal(list[0].sha256, sha(v2));
      assert.ok((await readFile(path.join(dir, row.storage_path))).equals(v2));

      // replace_existing:false keeps both.
      const img = randomBytes(5000);
      const c3 = await h.call("create_project_upload", { project_slug: "zz-nkh", filename: "site photo", mime_type: "image/jpeg", size_bytes: img.length, sha256: sha(img), replace_existing: false });
      assert.equal(c3.name, "site photo.jpg");
      await appendAll(h.call, c3.upload_id, img);
      const photo = await h.call("commit_project_upload", { upload_id: c3.upload_id });
      assert.equal(photo.ok, true);
      assert.equal((await client.query(`SELECT type FROM files WHERE id = $1`, [photo.file_id])).rows[0].type, "img");

      // ── delete → trash → restore
      assert.match((await h.call("delete_project_file", { project_slug: "zz-nkh", file_id: fileId, reason: "" })).error, /reason is required/);
      const del = await h.call("delete_project_file", { project_slug: "zz-nkh", file_id: fileId, reason: "Superseded by the 10/27 bid set" });
      assert.equal(del.ok, true, JSON.stringify(del));
      list = await h.call("list_project_files", { project_slug: "zz-nkh" });
      assert.deepEqual(list.map((f) => f.id), [photo.file_id]);
      const trash = await h.call("restore_project_file", { project_slug: "zz-nkh" });
      assert.equal(trash.deleted_files.length, 1);
      assert.equal(trash.deleted_files[0].reason, "Superseded by the 10/27 bid set");
      const ev = (await client.query(`SELECT kind, actor, detail FROM project_workflow_events WHERE kind = 'file_deleted'`)).rows;
      assert.equal(ev.length, 1);
      assert.equal(ev[0].detail.reason, "Superseded by the 10/27 bid set");
      assert.equal(ev[0].actor, "agent:test-agent");
      const back = await h.call("restore_project_file", { project_slug: "zz-nkh", file_id: fileId });
      assert.equal(back.ok, true, JSON.stringify(back));
      list = await h.call("list_project_files", { project_slug: "zz-nkh" });
      assert.equal(list.length, 2);
      assert.equal(list.find((f) => f.id === fileId).sha256, sha(v2), "restored row is the same row");

      // A file a bid packet uses is refused.
      const [pkg] = (await client.query(`INSERT INTO bid_packages (project_id, title) SELECT id, 'Framing' FROM projects WHERE slug = 'zz-nkh' RETURNING id`)).rows;
      await client.query(`INSERT INTO bid_package_files (package_id, file_id) VALUES ($1, $2)`, [pkg.id, fileId]);
      const used = await h.call("delete_project_file", { project_slug: "zz-nkh", file_id: fileId, reason: "x" });
      assert.match(used.error, /still used by bid_package_files\.file_id/);

      // A person's upload: refused for an unattended agent, allowed on Joe's login.
      await client.query(
        `INSERT INTO files (id, project_key, name, storage_path, mime_type, created_by) VALUES ('up-joe', 'zz-nkh', 'joe.pdf', 'up-joe__joe.pdf', 'application/pdf', 'user')`,
      );
      assert.match((await h.call("delete_project_file", { project_slug: "zz-nkh", file_id: "up-joe", reason: "dup" })).error, /only Joe can delete it/);
      h.principal.current = { userId: "00000000-0000-4000-8000-000000000001", role: "owner", name: "Joe", active: true, revoked: false };
      assert.equal((await h.call("delete_project_file", { project_slug: "zz-nkh", file_id: "up-joe", reason: "dup" })).ok, true);
    } finally {
      await h.pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, { fresh: true, name: "sjcos_test_uploads" });
});
