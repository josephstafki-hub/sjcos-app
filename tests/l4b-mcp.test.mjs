import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { registerDirectoryTools } from "../mcp/directory-tools.mjs";
test("directory MCP tools use the shared archive/edit services and reject portal callers", async () => {
  const c = new pg.Client({
    connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos",
  });
  await c.connect();
  const rows = async (s, p) => (await c.query(s, p)).rows;
  const registry = new Map();
  let principal = { userId: "test", role: "owner" };
  registerDirectoryTools(
    { registerTool: (name, _spec, handler) => registry.set(name, handler) },
    {
      rows,
      json: (r) => r,
      currentPrincipal: async () => principal,
      pool: {
        query: c.query.bind(c),
        connect: async () => ({
          query: async (s, p) =>
            /^(BEGIN|COMMIT|ROLLBACK)$/.test(s)
              ? { rows: [], rowCount: 0 }
              : c.query(s, p),
          release() {},
        }),
      },
    },
  );
  try {
    await c.query("BEGIN");
    await rows(
      "INSERT INTO vendors(slug,name) VALUES('zz-qa-l4b-mcp','ZZ QA L4b MCP')",
    );
    assert.equal(
      (
        await registry.get("set_vendor_archived")({
          vendor_slug: "zz-qa-l4b-mcp",
          archived: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await rows(
          "SELECT archived_at IS NOT NULL AS a FROM vendors WHERE slug='zz-qa-l4b-mcp'",
        )
      )[0].a,
      true,
    );
    await registry.get("set_vendor_archived")({
      vendor_slug: "zz-qa-l4b-mcp",
      archived: false,
    });
    assert.equal(
      (
        await registry.get("update_vendor_record")({
          slug: "zz-qa-l4b-mcp",
          name: "Corrected",
          trade: "Tile",
          email: "a@b.test",
          phone: "123",
        })
      ).ok,
      true,
    );
    principal = { userId: "test", role: "sub" };
    assert.equal(
      (
        await registry.get("set_vendor_archived")({
          vendor_slug: "zz-qa-l4b-mcp",
          archived: true,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await rows("SELECT archived_at FROM vendors WHERE slug='zz-qa-l4b-mcp'")
      )[0].archived_at,
      null,
    );
    assert.ok(registry.has("set_sub_assignment_active"));
    assert.ok(registry.has("trash_file"));
    assert.ok(registry.has("restore_file"));
    assert.ok(registry.has("list_catalog_materials"));
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
});
