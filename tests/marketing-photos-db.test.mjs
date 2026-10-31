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
  "@/lib/publisher/server": ["retryPost", "savePostingAccounts", "settlePost"],
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

test("posting photos: picking a site picks the newest shareable photos up to its limit; Joe's own uploads are OK to share and go in the post; staff uploads wait for Joe", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    {
      await cleanFoundation(client);
      await client.query(`TRUNCATE publication_rights, marketing_draft_media, document_revisions RESTART IDENTITY CASCADE`);
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
      const { setPostTarget, addPostPhotos } = await import("../lib/actions/marketing.ts");
      const media = async () => (await client.query(`SELECT file_id FROM marketing_draft_media WHERE draft_id = $1 ORDER BY sort`, [id])).rows.map((r) => r.file_id);

      // Picking a site with nothing picked: newest shareable first, never the unshared one.
      let r = await setPostTarget(id, "facebook", []);
      assert.equal(r.ok, true);
      assert.deepEqual(await media(), ["zz-k-new", "zz-k-mid", "zz-k-old"]);
      assert.match(r.message, /Picked 3 photos/);
      // Joe changes them: reorder and take one out — kept as he set it.
      r = await setPostTarget(id, "facebook", ["zz-k-old", "zz-k-new"]);
      assert.deepEqual(await media(), ["zz-k-old", "zz-k-new"]);
      // Same site, nothing picked on purpose: no automatic pick.
      await setPostTarget(id, "facebook", []);
      assert.deepEqual(await media(), []);
      // Google takes one photo: cut to the first.
      r = await setPostTarget(id, "google_business", ["zz-k-mid", "zz-k-new"]);
      assert.deepEqual(await media(), ["zz-k-mid"]);
      assert.match(r.message, /takes 1; 1 left out/);

      // Joe's own photos: kept on the job, OK to share, into the post.
      await setPostTarget(id, "instagram", ["zz-k-mid"]);
      const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], "mine.jpg", { type: "image/jpeg" });
      const fd = new FormData();
      fd.set("draftId", String(id));
      fd.append("photos", photo());
      fd.append("photos", photo());
      r = await addPostPhotos(fd);
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(await media(), ["zz-k-mid", "zz-up-1", "zz-up-2"]);
      const rights = (await client.query(`SELECT count(*)::int AS n FROM publication_rights WHERE file_id LIKE 'zz-up-%' AND withdrawn_at IS NULL AND project_id = $1`, [p.id])).rows[0].n;
      assert.equal(rights, 2);
      // Not a photo type the sites take → refused, nothing stored.
      const bad = new FormData();
      bad.set("draftId", String(id));
      bad.append("photos", new File([new Uint8Array([1])], "x.heic", { type: "image/heic" }));
      assert.equal((await addPostPhotos(bad)).ok, false);
      assert.equal(n, 2);

      // Staff: on the job, but not shareable and not in the post until Joe says.
      user = { id: null, role: "staff", name: "Abigail" };
      const sfd = new FormData();
      sfd.set("draftId", String(id));
      sfd.append("photos", photo());
      r = await addPostPhotos(sfd);
      assert.equal(r.ok, true);
      assert.match(r.message, /Joe ticks OK to share/);
      assert.deepEqual(await media(), ["zz-k-mid", "zz-up-1", "zz-up-2"]);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM publication_rights WHERE file_id = 'zz-up-3'`)).rows[0].n, 0);
    }
  });
});
