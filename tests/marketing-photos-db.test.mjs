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
  "@/lib/commands/db": ["runDirect", "userPrincipal"],
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
