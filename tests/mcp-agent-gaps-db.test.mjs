// The worker's 2026-10-30 dead ends, against a REAL disposable Postgres:
//   • get_project_file reads a PDF (text by default, page images on request or
//     for a scan) instead of only handing back a URL the worker can't open;
//   • set_project_status_line corrects / clears the Projects-list status line
//     and never touches the computed job money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import PDFDocument from "pdfkit";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { registerBiddingTools } from "../mcp/bidding-tools.mjs";
import { registerProjectTools } from "../mcp/project-tools.mjs";

const havePoppler = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const skip = (!harnessAvailable() && "postgresql-16 binaries not installed") || (!havePoppler && "poppler not installed");
const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => {
  const textBlock = res.content.find((c) => c.type === "text");
  try {
    return { ...JSON.parse(textBlock.text), _images: res.content.filter((c) => c.type === "image").length };
  } catch {
    return { ok: false, error: textBlock?.text, isError: res.isError };
  }
};
const STRIPPED = /(^|\s),\d{3}\b/;

function writePdf(file, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const out = createWriteStream(file);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);
    draw(doc);
    doc.end();
  });
}

async function harness(url, uploadDir) {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const tools = new Map();
  const server = { registerTool: (name, _meta, fn) => tools.set(name, fn) };
  const envValue = (k) => (k === "SESSION_SECRET" ? "s" : "");
  const strippedDollarError = (...t) => (t.some((x) => typeof x === "string" && STRIPPED.test(x)) ? json({ ok: false, error: "stripped dollar" }) : null);
  const principal = { current: { userId: null, role: null, name: null, active: false, revoked: false } };
  registerBiddingTools(server, { rows, json, biddingCall: async () => ({}), uploadDir, envValue, strippedDollarError });
  registerProjectTools(server, { rows, json, strippedDollarError, currentPrincipal: async () => principal.current });
  return { pool, call: async (name, args) => parse(await tools.get(name)(args)) };
}

test("get_project_file reads PDFs: text by default, page images for a scan or on request", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sjc-pdf-"));
    const h = await harness(url, dir);
    try {
      await writePdf(path.join(dir, "zz-est.pdf"), (doc) => {
        doc.text("Estimate ES-10151 Garage - Flanagan. Framing labor 120 hours. Concrete slab with thickened edge.");
        doc.addPage().text("Roofing 30 squares architectural shingles. Estimate total $48,250.00");
      });
      await writePdf(path.join(dir, "zz-scan.pdf"), (doc) => doc.rect(60, 60, 300, 120).fill("#333"));
      await client.query(`INSERT INTO projects (slug, name) VALUES ('zz-flan', 'ZZ Flanagan')`);
      await client.query(
        `INSERT INTO files (id, project_key, type, name, storage_path, mime_type) VALUES
           ('zz-est', 'zz-flan', 'doc', 'ES-10151.pdf', 'zz-est.pdf', 'application/pdf'),
           ('zz-scan', 'zz-flan', 'doc', 'Signed contract scan.pdf', 'zz-scan.pdf', 'application/pdf')`,
      );

      const est = await h.call("get_project_file", { file_id: "zz-est" });
      assert.equal(est.format, "text", JSON.stringify(est));
      assert.equal(est.pages, 2);
      assert.match(est.text, /ES-10151/);
      assert.match(est.text, /\$48,250\.00/);

      const p2 = await h.call("get_project_file", { file_id: "zz-est", page_from: 2 });
      assert.equal(p2.shown, "2-2");
      assert.doesNotMatch(p2.text, /ES-10151/);

      const imgs = await h.call("get_project_file", { file_id: "zz-est", format: "pages" });
      assert.equal(imgs.format, "pages");
      assert.equal(imgs._images, 2);

      const scan = await h.call("get_project_file", { file_id: "zz-scan" });
      assert.equal(scan.format, "pages", "a PDF with no text layer comes back as page images");
      assert.equal(scan._images, 1);
      assert.match(scan.note, /no text layer/);

      const url1 = await h.call("get_project_file", { file_id: "zz-est", format: "url" });
      assert.match(url1.url, /\/api\/files\/zz-est\?exp=/, "url still works for PDFs");
    } finally {
      await h.pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("set_project_status_line corrects and clears the line, refuses bad text, leaves job money alone", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sjc-line-"));
    const h = await harness(url, dir);
    try {
      await client.query(`INSERT INTO projects (slug, name, stage_label) VALUES ('zz-alc', 'ZZ Alcantara', 'The two changes remain approved but unbilled.')`);
      const money = async () => (await client.query(`SELECT total_cents::text, collected_cents::text, progress FROM projects WHERE slug = 'zz-alc'`)).rows[0];
      const before = await money();

      const r = await h.call("set_project_status_line", { project_slug: "zz-alc", text: "  All work billed;   waiting on the final payment. " });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.before, "The two changes remain approved but unbilled.");
      assert.equal(r.after, "All work billed; waiting on the final payment.");
      assert.equal((await client.query(`SELECT stage_label FROM projects WHERE slug = 'zz-alc'`)).rows[0].stage_label, r.after);

      assert.equal((await h.call("set_project_status_line", { project_slug: "zz-alc", text: "x".repeat(301) })).ok, false);
      assert.equal((await h.call("set_project_status_line", { project_slug: "zz-alc", text: "Deposit of ,500 received" })).ok, false, "shell-eaten dollars refused");
      assert.equal((await h.call("set_project_status_line", { project_slug: "zz-nope", text: "x" })).ok, false);

      const cleared = await h.call("set_project_status_line", { project_slug: "zz-alc", text: "" });
      assert.equal(cleared.after, null);
      assert.equal((await client.query(`SELECT stage_label FROM projects WHERE slug = 'zz-alc'`)).rows[0].stage_label, null);
      assert.deepEqual(await money(), before, "the computed total / paid / % never move");
    } finally {
      await h.pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
