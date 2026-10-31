// A21 (Tier 3): "estimate from plan" reads a pinned design version, never the
// live autosave. lib/db points at the test database; the session, cache and
// the estimate-line writer are stubbed (lines are recorded, not priced).
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);
const STUBS = {
  "server-only": [],
  "next/cache": ["revalidatePath"],
  "@/lib/dal": ["requireAccess"],
  "@/lib/cost-book": ["getDefaultMarkup"],
  "@/lib/actions/estimates": ["addTakeoffLines"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".mjs"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) return { url: base + ext, shortCircuit: true };
        } catch {
          /* next */
        }
      }
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    const source = names.map((n) => `export const ${n} = (...a) => globalThis.__pin.${n}(...a);`).join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

test("estimate from plan: pins the drawing it read, reuses an unchanged version, refuses a locked estimate", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    const { pool } = await import("../lib/db.ts");
    const { generateEstimateFromDesign } = await import("../lib/actions/plan-estimate.ts");
    const { emptyDoc, MAIN_LEVEL_ID: L } = await import("../lib/plan-doc.ts");
    const { rectWalls, withRooms } = await import("../lib/plan-geometry.ts");
    try {
      await cleanFoundation(client);
      await client.query(`DELETE FROM projects WHERE slug = 'zz-pin'`);
      const sections = [];
      globalThis.__pin = {
        revalidatePath: () => {},
        requireAccess: async () => ({ id: null, role: "owner", name: "Joe" }),
        getDefaultMarkup: async () => 25,
        addTakeoffLines: async (_e, _s, section, lines) => (sections.push(section), { ok: true, added: lines.length }),
      };
      const doc = emptyDoc();
      doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "new");
      const [p] = (await client.query(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-pin', 'ZZ Pin', 'construction', 'ZZ') RETURNING id`)).rows;
      const [d] = (await client.query(`INSERT INTO plan_designs (project_id, name, doc, rev) VALUES ($1, 'Kitchen', $2::jsonb, 1) RETURNING id`, [p.id, JSON.stringify(withRooms(doc))])).rows;
      const [ci] = (await client.query(`INSERT INTO cost_items (name, category, unit, unit_cost) VALUES ('ZZ wall framing', 'Framing', 'lf', 1200) RETURNING id`)).rows;
      await client.query(`INSERT INTO plan_cost_rules (measure, material_tag, cost_item_id, enabled) VALUES ('wall_new_lf', '', $1, true) ON CONFLICT DO NOTHING`, [ci.id]);

      const r1 = await generateEstimateFromDesign(Number(d.id), { newTitle: "Kitchen estimate" });
      assert.equal(r1.ok, true, r1.error);
      assert.equal(r1.result.versionNumber, 1);
      assert.match(r1.result.revision, new RegExp(`^design:${d.id}@v1#`));
      assert.ok(sections.every((s) => / v1 · /.test(s)), "the lines cite the version");
      const pins = async () => (await client.query(`SELECT count(*)::int AS n FROM document_revisions WHERE doc_kind = 'plan_design_version' AND doc_id IN (SELECT id::text FROM plan_design_versions WHERE design_id = $1)`, [d.id])).rows[0].n;
      assert.equal(await pins(), 1);

      // Same drawing again: the version is reused, not duplicated.
      const r2 = await generateEstimateFromDesign(Number(d.id), { estimateId: r1.result.estimateId });
      assert.equal(r2.result.versionNumber, 1);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM plan_design_versions WHERE design_id = $1`, [d.id])).rows[0].n, 1);

      // The drawing changed: a new version, cited.
      doc.walls.push({ id: "part", levelId: L, a: { x: 72, y: 0 }, b: { x: 72, y: 120 }, thickIn: 4.5, heightIn: 96, kind: "new" });
      await client.query(`UPDATE plan_designs SET doc = $2::jsonb, rev = rev + 1 WHERE id = $1`, [d.id, JSON.stringify(withRooms(doc))]);
      const r3 = await generateEstimateFromDesign(Number(d.id), { estimateId: r1.result.estimateId });
      assert.equal(r3.result.versionNumber, 2);
      assert.notEqual(r3.result.revision, r1.result.revision);

      // Out with the client: locked, refused before anything is written.
      await client.query(`UPDATE estimates SET status = 'sent' WHERE id = $1`, [r1.result.estimateId]);
      const locked = await generateEstimateFromDesign(Number(d.id), { estimateId: r1.result.estimateId });
      assert.equal(locked.ok, false);
      assert.match(locked.error, /locked/);
    } finally {
      await pool.end();
    }
  });
});
