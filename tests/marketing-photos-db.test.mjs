// Marketing (copy and paste): Joe marks which job photos the client OK'd
// sharing; only those are offered for download, and taking it back withdraws
// the right. Session, cache, AI and notify are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { txOver } from "./_fixtures-procurement.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);
const STUBS = {
  "server-only": [],
  "next/cache": ["revalidatePath"],
  "@/lib/dal": ["requireAccess"],
  "@/lib/ai": ["ai"],
  "@/lib/notify": ["emit"],
  "@/lib/commands/db": ["runDirect", "userPrincipal", "withTransaction"],
  "@/lib/upload-store": ["storeUpload"],
};
registerHooks({
  resolve(specifier, context, next) {
    let url = null;
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".mjs"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) { url = base + ext; break; }
        } catch {
          /* next */
        }
      }
    } else if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      url = new URL(`${specifier}.ts`, context.parentURL).href;
    }
    const key = Object.hasOwn(STUBS, specifier) ? specifier : url;
    if (key && Object.hasOwn(STUBS, key)) return { url: `stub:${key}`, shortCircuit: true };
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    return { format: "module", source: names.map((n) => `export const ${n} = (...a) => globalThis.__mk.${n}(...a);`).join("\n"), shortCircuit: true };
  },
});

test("photo OK-to-share: owner only, scoped to the job's photos, withdraw takes it back", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    const { pool } = await import("../lib/db.ts");
    try {
      await cleanFoundation(client);
      await client.query(`DELETE FROM projects WHERE slug = 'zz-mk'`);
      const [p] = (await client.query(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-mk', 'ZZ Deck', 'warranty', 'ZZ') RETURNING id`)).rows;
      await client.query(`INSERT INTO files (id, project_key, type, name, storage_path) VALUES ('zz-mk-1', 'zz-mk', 'img', 'deck.jpg', 'x'), ('zz-mk-2', 'other', 'img', 'other.jpg', 'y') ON CONFLICT DO NOTHING`);
      let user = { id: null, role: "staff", name: "Abigail" };
      globalThis.__mk = {
        revalidatePath: () => {},
        requireAccess: async () => user,
        ai: { ask: async () => ({ answer: "" }) },
        emit: async () => {},
        runDirect: async (sql, params) => (await client.query(sql, params)).rows,
        userPrincipal: (u) => ({ kind: "user", userId: u.id, role: u.role, name: u.name, permissions: [], linkSlug: null }),
      };
      const { setPhotoShareable } = await import("../lib/actions/marketing.ts");
      assert.equal((await setPhotoShareable("zz-mk", "zz-mk-1", true)).ok, false, "staff can't record the client's OK");
      user = { id: null, role: "owner", name: "Joe" };
      assert.equal((await setPhotoShareable("zz-mk", "zz-mk-2", true)).ok, false, "not this job's photo");
      assert.equal((await setPhotoShareable("zz-mk", "zz-mk-1", true)).ok, true);
      const live = async () => (await client.query(`SELECT count(*)::int AS n FROM publication_rights WHERE file_id = 'zz-mk-1' AND withdrawn_at IS NULL AND project_id = $1`, [p.id])).rows[0].n;
      assert.equal(await live(), 1);
      assert.equal((await setPhotoShareable("zz-mk", "zz-mk-1", true)).ok, true);
      assert.equal(await live(), 1, "marking twice is one right");
      assert.equal((await setPhotoShareable("zz-mk", "zz-mk-1", false)).ok, true);
      assert.equal(await live(), 0);
    } finally {
      await pool.end();
    }
  });
});

test("adding photos to a post: Joe's own are OK to share (ready to download), staff uploads wait for Joe", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    {
      await cleanFoundation(client);
      await client.query(`TRUNCATE publication_rights, document_revisions RESTART IDENTITY CASCADE`);
      await client.query(`DELETE FROM projects WHERE slug = 'zz-mk2'`);
      await client.query(`DELETE FROM files WHERE id LIKE 'zz-k-%' OR id LIKE 'zz-up-%'`);
      const [p] = (await client.query(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-mk2', 'ZZ Kitchen', 'warranty', 'ZZ') RETURNING id`)).rows;
      await client.query(
        `INSERT INTO files (id, project_key, type, name, storage_path, created_at) VALUES
           ('zz-k-old', 'zz-mk2', 'img', 'old.jpg', 'o', now() - interval '3 days'),
           ('zz-k-mid', 'zz-mk2', 'img', 'mid.jpg', 'm', now() - interval '2 days'),
           ('zz-k-new', 'zz-mk2', 'img', 'new.jpg', 'n', now() - interval '1 day'),
           ('zz-k-no',  'zz-mk2', 'img', 'no.jpg',  'x', now())`,
      );
      await client.query(`INSERT INTO publication_rights (file_id, project_id, granted_by) VALUES ('zz-k-old', $1, 'Pat'), ('zz-k-mid', $1, 'Pat'), ('zz-k-new', $1, 'Pat')`, [p.id]);
      const [d] = (await client.query(`INSERT INTO marketing_drafts (project_id, kind, title, body, status) VALUES ($1, 'social', 'zz-k', 'Kitchen done', 'draft') RETURNING id`, [p.id])).rows;
      const id = Number(d.id);
      let user = { id: null, role: "owner", name: "Joe" };
      let n = 0;
      globalThis.__mk = {
        revalidatePath: () => {},
        requireAccess: async () => user,
        ai: { ask: async () => ({ answer: "" }) },
        emit: async () => {},
        runDirect: async (sql, params) => (await client.query(sql, params)).rows,
        userPrincipal: (u) => ({ kind: "user", userId: u.id, role: u.role, name: u.name, permissions: [], linkSlug: null }),
        withTransaction: async (fn) => fn(async (sql, params) => (await client.query(sql, params)).rows),
        storeUpload: async (_f, opts) => {
          const fid = `zz-up-${++n}`;
          await client.query(`INSERT INTO files (id, project_key, type, name, storage_path) VALUES ($1, $2, 'img', 'mine.jpg', 'u')`, [fid, opts.projectKey]);
          return { ok: true, id: fid, type: "img" };
        },
      };
      const { addPostPhotos } = await import("../lib/actions/marketing.ts");
      const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], "mine.jpg", { type: "image/jpeg" });
      const fd = new FormData();
      fd.set("draftId", String(id));
      fd.append("photos", photo());
      fd.append("photos", photo());
      let r = await addPostPhotos(fd);
      assert.equal(r.ok, true, r.error);
      assert.match(r.message, /Added 2 photos, OK to share and ready to download/);
      const rights = (await client.query(`SELECT count(*)::int AS n FROM publication_rights WHERE file_id LIKE 'zz-up-%' AND withdrawn_at IS NULL AND project_id = $1`, [p.id])).rows[0].n;
      assert.equal(rights, 2);
      // Not a photo type the sites take → refused, nothing stored.
      const bad = new FormData();
      bad.set("draftId", String(id));
      bad.append("photos", new File([new Uint8Array([1])], "x.heic", { type: "image/heic" }));
      assert.equal((await addPostPhotos(bad)).ok, false);
      assert.equal(n, 2);

      // Staff: on the job, but not shareable until Joe says.
      user = { id: null, role: "staff", name: "Abigail" };
      const sfd = new FormData();
      sfd.set("draftId", String(id));
      sfd.append("photos", photo());
      r = await addPostPhotos(sfd);
      assert.equal(r.ok, true);
      assert.match(r.message, /Joe ticks OK to share/);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM publication_rights WHERE file_id = 'zz-up-3'`)).rows[0].n, 0);

    }
  });
});

test("job facts for drafting: the signed estimate's lines and approved changes, the city, never prices; a draft estimate isn't work done", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await client.query(`DELETE FROM projects WHERE slug = 'zz-facts'`);
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    const { loadJobFacts } = await import("../lib/closeout/marketing.ts");
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name, address) VALUES ('zz-facts', 'Elaine Zz', 'warranty', 'Elaine Zz', '13186 Crane Street Northwest, Minneapolis, Minnesota, 55448') RETURNING id`);
    // Only a draft so far: no work to speak of.
    const [draft] = await run(`INSERT INTO estimates (project_id, title, kind, status) VALUES ($1, 'Bathroom idea', 'formal', 'draft') RETURNING id`, [p.id]);
    await run(`INSERT INTO estimate_lines (estimate_id, section, description, unit_cost, extended) VALUES ($1, 'Tile', 'Tile the shower', 100, 100)`, [draft.id]);
    let f = await loadJobFacts(run, p.id);
    assert.equal(f.work, "");
    assert.deepEqual(f.lines, []);
    assert.equal(f.city, "Minneapolis");
    // The signed one is the record.
    const [est] = await run(`INSERT INTO estimates (project_id, title, kind, status) VALUES ($1, 'Kitchen Refresh', 'formal', 'draft') RETURNING id`, [p.id]);
    await run(
      `INSERT INTO estimate_lines (estimate_id, section, description, unit_cost, extended, sort_order) VALUES ($1, 'Countertops', 'Install quartz counters — Cambria Beaumont', 500000, 500000, 2), ($1, 'Cabinets', 'Install island cabinets', 300000, 300000, 1), ($1, 'General', '  ', 0, 0, 3)`,
      [est.id],
    );
    await run(`UPDATE estimates SET status = 'approved', approved_at = now() WHERE id = $1`, [est.id]);
    await run(`INSERT INTO change_orders (project_id, title, description, status) VALUES ($1, 'Pendant lights', 'Two pendants over the island', 'approved'), ($1, 'Wine fridge', '', 'declined')`, [p.id]);
    f = await loadJobFacts(run, p.id);
    assert.equal(f.work, "Kitchen Refresh");
    assert.deepEqual(f.lines, [{ section: "Cabinets", text: "Install island cabinets" }, { section: "Countertops", text: "Install quartz counters — Cambria Beaumont" }]);
    assert.deepEqual(f.changes, ["Pendant lights: Two pendants over the island"]);
    assert.ok(f.privateWords.includes("Elaine Zz"));
    assert.doesNotMatch(JSON.stringify({ ...f, privateWords: [] }), /5000|Crane|13186|Bathroom|shower/);
  });
});
