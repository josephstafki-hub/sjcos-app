// W08 (Tier 3): the client signed the formal estimate → the construction
// agreement is drafted from it and printed; it goes out for signature on its
// own only while contract.send_on_acceptance is active. lib/db points at the
// disposable test database; the document steps and Joe's notification are
// stubbed and recorded, so nothing renders or sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);

const STUBS = {
  "server-only": [],
  "@/lib/doc-drafts": ["createDocDraft", "renderDocDraft", "submitDocDraftForSignature"],
  "@/lib/notify-owner": ["notifyOwner"],
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
    const source = names.map((n) => `export const ${n} = (...a) => globalThis.__w08.${n}(...a);`).join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

test("W08: acceptance drafts + prints the agreement; sends only under the policy; never twice; not for other estimates", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    const { pool } = await import("../lib/db.ts");
    const { prepareAgreementOnAcceptance } = await import("../lib/workflow/agreement.ts");
    try {
      await cleanFoundation(client);
      await client.query(readFileSync(new URL("../db/migrations/0050_contract_send_on_acceptance_policy.sql", import.meta.url), "utf8"));
      await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-w08%'`);
      const calls = { created: [], rendered: [], submitted: [], told: [] };
      let missing = [];
      globalThis.__w08 = {
        createDocDraft: async (key, scope, opts) => {
          const [{ id }] = (await client.query(`INSERT INTO document_drafts (project_id, template_key, template_version, title, status, created_via, estimate_id) SELECT id, $1, 1, 'Construction agreement', 'draft', $3, $4 FROM projects WHERE slug = $2 RETURNING id::int AS id`, [key, scope.slug, opts.createdVia, scope.estimateId])).rows;
          calls.created.push({ key, scope });
          return { ok: true, id, fillReport: {}, missing, title: "Construction agreement" };
        },
        renderDocDraft: async (id) => (calls.rendered.push(id), { ok: true, pdfFileId: "f", docxFileId: "d" }),
        submitDocDraftForSignature: async (id) => (calls.submitted.push(id), { ok: true, signatureRequestId: 999, delivery: {} }),
        notifyOwner: async (n) => void calls.told.push(n),
      };
      const job = async (slug) => (await client.query(`INSERT INTO projects (slug, name, status, client_name) VALUES ($1, $1, 'construction_contract', 'ZZ Client') RETURNING id`, [slug])).rows[0].id;
      const signedEstimate = async (projectId, kind) => {
        const [e] = (await client.query(`INSERT INTO estimates (project_id, kind, status, title) VALUES ($1, $2, 'draft', 'Estimate') RETURNING id`, [projectId, kind])).rows;
        const [s] = (await client.query(`INSERT INTO signature_requests (project_id, doc_type, title, status, estimate_id, signed_at) VALUES ($1, 'estimate', 'Estimate', 'signed', $2, now()) RETURNING id`, [projectId, e.id])).rows;
        return Number(s.id);
      };

      // A pre-con change estimate is not the offer that brings a contract.
      const p0 = await job("zz-w08-change");
      assert.equal((await prepareAgreementOnAcceptance(await signedEstimate(p0, "precon_change"))).done, "skipped");

      // Policy off: drafted, printed, Joe told it's ready. Nothing sent.
      const p1 = await job("zz-w08-a");
      const s1 = await signedEstimate(p1, "formal");
      const r1 = await prepareAgreementOnAcceptance(s1);
      assert.equal(r1.done, "drafted");
      assert.equal(calls.created[0].key, "contract");
      assert.equal(calls.rendered.length, 1);
      assert.equal(calls.submitted.length, 0);
      assert.match(calls.told.at(-1).title, /ready to send · ZZ Client/);
      // A retry (or a second signature event) makes nothing new.
      assert.equal((await prepareAgreementOnAcceptance(s1)).done, "skipped");
      assert.equal(calls.created.length, 1);

      // Missing fields: drafted, not printed, Joe told what to fill.
      missing = ["start_date"];
      const r2 = await prepareAgreementOnAcceptance(await signedEstimate(await job("zz-w08-b"), "formal"));
      assert.equal(r2.done, "drafted");
      assert.match(r2.note, /start_date/);
      assert.equal(calls.rendered.length, 1);
      missing = [];

      // Policy on: it goes out for signature.
      await client.query(`UPDATE policies SET state = 'active', effective_from = now() WHERE key = 'contract.send_on_acceptance' AND version = 1`);
      const r3 = await prepareAgreementOnAcceptance(await signedEstimate(await job("zz-w08-c"), "formal"));
      assert.equal(r3.done, "sent");
      assert.equal(calls.submitted.length, 1);
    } finally {
      await pool.end();
    }
  });
});
