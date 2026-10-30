// The sub-portal upload + Joe's Accept / Reject server actions
// (lib/actions/sub-docs.ts), run for real against the disposable Postgres
// harness. Only the Next/session edges are stubbed: the signed-in user
// (lib/dal), the file store (writes a files row, no disk), the bell
// (lib/notify), revalidatePath, and the sub/job lookups. Transactions run on
// the harness database, so the whole write path — sub_documents, the review
// to-do, subs.coi_status — is the real SQL.
//
// Bug 6 (2026-10-30): the upload set subs.coi_status = 'current' from the
// expiry date the SUB typed, so a lapsed or fake certificate read current and
// the COI reminders stopped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { cleanProcurement, seedOwner, seedProject, seedSub, txOver } from "./_fixtures-procurement.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);

const STUBS = {
  "server-only": [],
  "next/cache": ["revalidatePath"],
  "@/lib/dal": ["requireRole"],
  "@/lib/notify": ["emit"],
  "@/lib/upload-store": ["storeUpload"],
  "@/lib/subs": ["getSub"],
  "@/lib/sub-portal": ["getSubCurrentProject"],
  "@/lib/commands/db": ["withTransaction", "userPrincipal"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".tsx", ".mjs", "/index.ts"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) return { url: base + ext, shortCircuit: true };
        } catch {
          /* try the next extension */
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    const source = names.map((n) => `export const ${n} = (...a) => globalThis.__subdocs.${n}(...a);`).join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const pdf = (text) => new File([text], "coi.pdf", { type: "application/pdf" });
const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

test("sub-portal COI upload is not coverage; only Joe's Accept makes it current; Reject asks again", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await client.query(`DELETE FROM work_items WHERE source_kind = 'sub_document'`);
    const owner = await seedOwner(client);
    const jobId = await seedProject(client, "zz-job1", { name: "ZZ Kitchen" });
    const fresh = await seedSub(client, "zz-sub-a", { name: "ZZ Sparky" });
    const current = await seedSub(client, "zz-sub-b", { name: "ZZ Tile", coiStatus: "current", coiExpiresAt: day(90) });

    const emitted = [];
    let fileN = 0;
    const w = {
      user: null,
      revalidatePath: () => {},
      requireRole: async (...roles) => {
        if (!roles.includes(w.user.role)) throw new Error("NEXT_REDIRECT");
        return w.user;
      },
      emit: async (n) => emitted.push(n),
      storeUpload: async (file) => {
        const buf = Buffer.from(await file.arrayBuffer());
        const id = `zz-subdoc-${++fileN}`;
        await client.query(
          `INSERT INTO files (id, project_key, type, name, storage_path, mime_type, sha256) VALUES ($1, '', 'doc', $2, $3, 'application/pdf', $4)`,
          [id, file.name, `${id}.pdf`, createHash("sha256").update(buf).digest("hex")],
        );
        return { ok: true, id, type: "doc" };
      },
      getSub: async (slug) => ({ name: slug === fresh ? "ZZ Sparky" : "ZZ Tile" }),
      getSubCurrentProject: async () => ({ id: jobId, name: "ZZ Kitchen" }),
      withTransaction: txOver(url),
      userPrincipal: (u) => ({ kind: "user", userId: u.id, role: u.role, name: u.name, permissions: [], linkSlug: u.linkSlug }),
    };
    globalThis.__subdocs = w;
    const asSub = (slug) => (w.user = { id: null, role: "sub", name: slug, linkSlug: slug, permissions: [] });
    const asOwner = () => (w.user = { id: owner.userId, role: "owner", name: "Joe", linkSlug: null, permissions: [] });

    const { uploadSubDocument, acceptSubDocument, rejectSubDocument } = await import("../lib/actions/sub-docs.ts");
    const subOf = async (slug) => (await client.query(`SELECT coi_status, coi_expires_at::text AS e FROM subs WHERE slug = $1`, [slug])).rows[0];
    const latestDoc = async (slug) =>
      (await client.query(`SELECT id, status, expires_at::text AS e, project_id FROM sub_documents WHERE sub_slug = $1 ORDER BY id DESC LIMIT 1`, [slug])).rows[0];
    const docStatus = async (id) => (await client.query(`SELECT status FROM sub_documents WHERE id = $1`, [id])).rows[0].status;
    const reviewItem = async (docId) =>
      (await client.query(`SELECT status, project_id, assignee_key FROM work_items WHERE source_kind = 'sub_document' AND source_id = $1`, [`subdoc:${docId}:review`])).rows[0];

    // ── BEFORE the fix this flipped zz-sub-a to 'current' on the sub's word.
    asSub(fresh);
    const up = await uploadSubDocument("ignored-slug", form({ docType: "coi", expires: day(365), file: pdf("acme mutual GL") }));
    assert.deepEqual(up, { ok: true });
    assert.deepEqual(await subOf(fresh), { coi_status: "missing", e: null }, "a typed future date is not coverage");
    const doc = await latestDoc(fresh);
    assert.equal(doc.status, "under_review");
    assert.equal(doc.e, day(365), "the typed date is kept as received");
    assert.equal(doc.project_id, null, "the COI stays company-level");
    const item = await reviewItem(doc.id);
    assert.equal(item.status, "waiting_on_human");
    assert.equal(item.assignee_key, "human-joe");
    assert.equal(item.project_id, jobId, "Joe's to-do names the job");
    assert.match(emitted.at(-1).title, /ZZ Sparky uploaded a COI — review it/);
    assert.match(emitted.at(-1).subline, /not current until you accept it/);

    // An existing sub with a current COI: an upload changes nothing.
    asSub(current);
    assert.equal((await uploadSubDocument(current, form({ docType: "coi", expires: day(400), file: pdf("tile co renewal") }))).ok, true);
    assert.deepEqual(await subOf(current), { coi_status: "current", e: day(90) });
    const tileDoc = await latestDoc(current);

    // The same file twice → refused, no second to-do.
    const again = await uploadSubDocument(current, form({ docType: "coi", expires: day(400), file: pdf("tile co renewal") }));
    assert.equal(again.ok, false);
    assert.match(again.error, /already uploaded/);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_kind = 'sub_document'`)).rows[0].n, 2);

    // A past typed date → told plainly, nothing changes.
    asSub(fresh);
    const lapsed = await uploadSubDocument(fresh, form({ docType: "coi", expires: day(-3), file: pdf("old cert") }));
    assert.equal(lapsed.ok, false);
    assert.match(lapsed.error, /already passed/);
    assert.deepEqual(await subOf(fresh), { coi_status: "missing", e: null });

    // ── Accept / Reject are Joe's.
    await assert.rejects(() => acceptSubDocument(fresh, doc.id, form({ expires: day(360) })), /NEXT_REDIRECT/, "a sub can't accept");
    await assert.rejects(() => rejectSubDocument(fresh, doc.id, form({ reason: "x" })), /NEXT_REDIRECT/, "a sub can't reject");
    assert.deepEqual(await subOf(fresh), { coi_status: "missing", e: null });

    asOwner();
    const wrongSub = await acceptSubDocument(current, doc.id, form({ expires: day(360) }));
    assert.equal(wrongSub.ok, false, "the document must belong to the page's sub");
    const pastAccept = await acceptSubDocument(fresh, doc.id, form({ expires: day(-1) }));
    assert.equal(pastAccept.ok, false);
    assert.match(pastAccept.error, /already passed/);
    assert.deepEqual(await acceptSubDocument(fresh, doc.id, form({ expires: day(360) })), { ok: true });
    assert.deepEqual(await subOf(fresh), { coi_status: "current", e: day(360) }, "current, on the date Joe confirmed");
    assert.equal(await docStatus(doc.id), "accepted");
    assert.equal((await reviewItem(doc.id)).status, "done");

    // Reject the tile sub's upload: not current-by-upload, the sub is asked
    // again (policy inactive here → held for Joe's OK), its COI is untouched.
    const noReason = await rejectSubDocument(current, tileDoc.id, form({ reason: "  " }));
    assert.equal(noReason.ok, false);
    const rej = await rejectSubDocument(current, tileDoc.id, form({ reason: "Certificate holder is wrong" }));
    assert.equal(rej.ok, true);
    assert.match(rej.notice, /^Rejected\. The email asking for a new one \(to zz-sub-b@example\.test\) is waiting for your OK\.$/);
    assert.equal(await docStatus(tileDoc.id), "rejected");
    assert.equal((await reviewItem(tileDoc.id)).status, "done");
    assert.deepEqual(await subOf(current), { coi_status: "current", e: day(90) });
    const held = await client.query(`SELECT summary FROM decisions WHERE status = 'pending' AND target_kind = 'sub_document_request'`);
    assert.equal(held.rows.length, 1);
    assert.match(held.rows[0].summary.body, /Certificate holder is wrong\./);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents`)).rows[0].n, 0, "nothing was sent");
  });
});
