import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import pg from "pg";
registerHooks({
  resolve(s, c, n) {
    if (s === "./db" && c.parentURL?.endsWith("/lib/subs.ts"))
      return { url: "stub:db", shortCircuit: true };
    if (s === "./ai" && c.parentURL?.endsWith("/lib/subs.ts"))
      return { url: "stub:ai", shortCircuit: true };
    if (s === "./sub-docs" && c.parentURL?.endsWith("/lib/subs.ts"))
      return {
        url: new URL("../lib/sub-docs/index.ts", import.meta.url).href,
        shortCircuit: true,
      };
    return n(s, c);
  },
  load(u, c, n) {
    if (u === "stub:db")
      return {
        format: "module",
        source:
          "export const query = (...a) => globalThis.l4bClient.query(...a);",
        shortCircuit: true,
      };
    if (u === "stub:ai")
      return {
        format: "module",
        source: "export const ai = {};",
        shortCircuit: true,
      };
    return n(u, c);
  },
});
test("F3/F4: new sub has actual creation date, no paperwork and no completed upcoming assignment", async () => {
  const client = new pg.Client({
    connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos",
  });
  await client.connect();
  globalThis.l4bClient = client;
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO subs(slug,name,trade,created_at) VALUES('zz-qa-l4b-test','ZZ QA L4b test','Tile','2026-10-30')",
    );
    const {
      rows: [p],
    } = await client.query(
      "INSERT INTO projects(slug,name,status) VALUES('zz-qa-l4b-test','ZZ QA L4b test','floor_plan') RETURNING id",
    );
    await client.query(
      "INSERT INTO project_subs(project_id,sub_slug) VALUES($1,'zz-qa-l4b-test')",
      [p.id],
    );
    const { getSub } = await import("../lib/subs.ts");
    const sub = await getSub("zz-qa-l4b-test");
    assert.equal(sub.jobsCount, 0);
    assert.equal(sub.w9, "missing");
    assert.match(sub.contact, /2026/);
    assert.doesNotMatch(sub.aiSummaryInput, /completed 1/);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
test("F8/F9/F11: archive and restore retain identities and history; material editing preserves other fields", async () => {
  const { setDirectoryArchived, updateDirectoryRecord, updateCatalogRecord } =
    await import("../lib/directory-maintenance.ts");
  const client = new pg.Client({
    connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos",
  });
  await client.connect();
  const run = async (s, p) => (await client.query(s, p)).rows;
  try {
    await client.query("BEGIN");
    for (const table of ["subs", "vendors"]) {
      await client.query(
        `INSERT INTO ${table}(slug,name) VALUES('zz-qa-l4b-test','ZZ QA L4b test')`,
      );
      assert.equal(
        (await setDirectoryArchived(run, table, "zz-qa-l4b-test", true)).ok,
        true,
      );
      assert.equal(
        (
          await run(
            `SELECT archived_at IS NOT NULL AS a FROM ${table} WHERE slug='zz-qa-l4b-test'`,
          )
        )[0].a,
        true,
      );
      await setDirectoryArchived(run, table, "zz-qa-l4b-test", false);
      assert.equal(
        (
          await run(
            `SELECT archived_at FROM ${table} WHERE slug='zz-qa-l4b-test'`,
          )
        )[0].archived_at,
        null,
      );
      await updateDirectoryRecord(run, table, "zz-qa-l4b-test", {
        name: "Corrected",
        trade: "Tile",
        email: "a@b.test",
        phone: "123",
        rate: "$80/hr",
      });
      assert.equal(
        (await run(`SELECT name FROM ${table} WHERE slug='zz-qa-l4b-test'`))[0]
          .name,
        "Corrected",
      );
    }
    const [m] = await run(
      "INSERT INTO catalog_items(name,sku,source_url) VALUES('ZZ QA L4b','before','https://example.test') RETURNING id",
    );
    await updateCatalogRecord(run, Number(m.id), {
      name: "Edited",
      sku: "after",
      price: "$123.45",
    });
    await setDirectoryArchived(run, "catalog_items", m.id, true);
    await setDirectoryArchived(run, "catalog_items", m.id, false);
    const [r] = await run("SELECT * FROM catalog_items WHERE id=$1", [m.id]);
    assert.equal(r.name, "Edited");
    assert.equal(
      r.price_cents,
      12345,
      "designer pricing must follow an edited catalog price",
    );
    assert.equal(r.source_url, "https://example.test");
    assert.equal(r.archived_at, null);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
test("F10: unscoped uploads use project-file trash and restore same file ID", async () => {
  const { trashProjectFile, restoreProjectFile } =
    await import("../lib/file-trash.ts");
  const client = new pg.Client({
    connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos",
  });
  await client.connect();
  const run = async (s, p) => (await client.query(s, p)).rows;
  try {
    await client.query("BEGIN");
    await run(
      "INSERT INTO files(id,project_key,type,name,storage_path) VALUES('zz-qa-l4b-file','','doc','ZZ QA L4b.txt','zz-qa-l4b.txt')",
    );
    const res = await trashProjectFile(run, {
      projectSlug: "",
      fileId: "zz-qa-l4b-file",
      reason: "Mistaken upload",
      deletedBy: "test",
    });
    assert.equal(res.ok, true);
    assert.equal(
      (await run("SELECT * FROM files WHERE id='zz-qa-l4b-file'")).length,
      0,
    );
    assert.equal(
      (
        await restoreProjectFile(run, {
          fileId: "zz-qa-l4b-file",
          restoredBy: "test",
        })
      ).ok,
      true,
    );
    assert.equal(
      (await run("SELECT storage_path FROM files WHERE id='zz-qa-l4b-file'"))[0]
        .storage_path,
      "zz-qa-l4b.txt",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
test("F8: assignment removal can be undone with its original scope and dates", async () => {
  const { removeAssignment, restoreAssignment } =
    await import("../lib/sub-assignment-maintenance.ts");
  const client = new pg.Client({
    connectionString: "postgresql://sjcos:qa@localhost:5499/sjcos",
  });
  await client.connect();
  const run = async (s, p) => (await client.query(s, p)).rows;
  try {
    await client.query("BEGIN");
    await run(
      "INSERT INTO subs(slug,name) VALUES('zz-qa-l4b-test','ZZ QA L4b test')",
    );
    const [p] = await run(
      "INSERT INTO projects(slug,name,status) VALUES('zz-qa-l4b-test','ZZ QA L4b test','floor_plan') RETURNING id",
    );
    await run(
      "INSERT INTO project_subs(project_id,sub_slug,role_label,scope_text,start_date,end_date) VALUES($1,'zz-qa-l4b-test','Tile','Shower','2026-11-02','2026-11-05')",
      [p.id],
    );
    await removeAssignment(run, p.id, "zz-qa-l4b-test");
    assert.equal(
      (await run("SELECT * FROM project_subs WHERE project_id=$1", [p.id]))
        .length,
      0,
    );
    assert.equal(
      (await restoreAssignment(run, p.id, "zz-qa-l4b-test")).ok,
      true,
    );
    const [a] = await run(
      "SELECT scope_text,start_date::text FROM project_subs WHERE project_id=$1",
      [p.id],
    );
    assert.equal(a.scope_text, "Shower");
    assert.equal(a.start_date, "2026-11-02");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
