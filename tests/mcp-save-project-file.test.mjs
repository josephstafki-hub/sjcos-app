// save_project_file (mcp/bidding-tools.mjs): an agent's written brief lands as
// a real project file — blob under uploads/, files row tagged as asked, never
// client-visible — and saving the same name again replaces it in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerBiddingTools } from "../mcp/bidding-tools.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const parse = (res) => {
  try {
    return JSON.parse(res.content[0].text);
  } catch {
    return { ok: false, error: res.content[0].text };
  }
};

function harness(uploadDir) {
  const files = [];
  const rows = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT id, slug, name FROM projects WHERE slug/i.test(s)) return params[0] === "libby-mahowald" ? [{ id: "p-1", slug: "libby-mahowald", name: "Libby Mahowald" }] : [];
    if (/^SELECT id, storage_path FROM files WHERE project_key = \$1 AND name = \$2/i.test(s)) return files.filter((f) => f.project_key === params[0] && f.name === params[1]);
    if (/^SELECT id, name, mime_type, size_label, project_key, storage_path FROM files WHERE id = \$1/i.test(s)) return files.filter((f) => f.id === params[0]);
    if (/^INSERT INTO files/i.test(s)) {
      files.push({ id: params[0], project_key: params[1], name: params[2], tag: params[3], size_label: params[4], subtitle: params[5], storage_path: params[6], mime_type: params[7], client_visible: /-1, \$7, \$8, false/.test(s) ? false : null });
      return [];
    }
    if (/^UPDATE files SET tag/i.test(s)) {
      const f = files.find((x) => x.id === params[0]);
      Object.assign(f, { tag: params[1], subtitle: params[2], size_label: params[3], mime_type: params[4] });
      return [];
    }
    throw new Error(`unhandled SQL: ${s.slice(0, 80)}`);
  };
  const tools = new Map();
  const server = { registerTool: (name, _meta, fn) => tools.set(name, fn) };
  registerBiddingTools(server, { rows, json, biddingCall: async () => ({}), uploadDir, envValue: () => "", strippedDollarError: () => null });
  return { files, call: async (name, args) => parse(await tools.get(name)(args)) };
}

test("save_project_file stores a markdown brief and replaces it by name", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sjc-save-"));
  try {
    const { files, call } = harness(dir);
    const first = await call("save_project_file", { project_slug: "libby-mahowald", filename: "Permit requirements — Saint Paul", content: "# Permits\n\nv1", tag: "PERMIT · Requirements" });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.name, "Permit requirements — Saint Paul.md");
    assert.equal(files.length, 1);
    assert.equal(files[0].tag, "PERMIT · Requirements");
    assert.equal(files[0].client_visible, false);
    assert.match(files[0].mime_type, /^text\/markdown/);
    assert.equal(await readFile(path.join(dir, files[0].storage_path), "utf8"), "# Permits\n\nv1");

    const again = await call("save_project_file", { project_slug: "libby-mahowald", filename: "Permit requirements — Saint Paul.md", content: "# Permits\n\nv2", tag: "PERMIT · Requirements" });
    assert.equal(again.replaced, true);
    assert.equal(again.file_id, first.file_id);
    assert.equal(files.length, 1);
    assert.equal(await readFile(path.join(dir, files[0].storage_path), "utf8"), "# Permits\n\nv2");

    const got = await call("get_project_file", { file_id: first.file_id });
    assert.equal(got.text, "# Permits\n\nv2", "agents read a text file inline, no link to open");
    assert.equal(got.truncated, false);

    assert.equal((await call("save_project_file", { project_slug: "nope", filename: "x", content: "y" })).ok, false);
    assert.equal((await call("save_project_file", { project_slug: "libby-mahowald", filename: "x", content: "" })).ok, false);
    const traversal = await call("save_project_file", { project_slug: "libby-mahowald", filename: "../../etc/passwd", content: "z" });
    assert.equal(traversal.name, "passwd.md");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
