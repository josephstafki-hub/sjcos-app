import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import * as u from "../lib/unsorted-docs-core.ts";
import { STATEMENTS } from "../db/apply-unsorted-docs.mjs";

// Unsorted documents against a REAL Postgres: stage → file to a job (files
// move, cost logged once) → undo (cost removed, files back) → overhead /
// dismiss / note for the agent, and that an agent re-reading the inbox never
// re-opens a document Joe already filed. Sorting wakes the filing agent (one
// 'filing' trigger per doc), its answer lands on the doc, and Undo cancels a
// follow-up that hasn't started.
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/unsorted-docs-db.test.mjs
//
// Skipped without that variable. Everything runs inside ONE transaction that
// is rolled back (the migration included), so nothing is left behind.

const url = process.env.FIN_TEST_DATABASE_URL;

test("stage, file, undo and re-stage an emailed document", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query("BEGIN");
    for (const s of STATEMENTS) await client.query(typeof s === "string" ? s : s.sql, typeof s === "string" ? [] : s.params);

    const mk = async (slug) => (await run(
      `INSERT INTO projects (slug, name, status, client_name, address) VALUES ($1, $1, 'construction', 'ZZ Client', '1 Test Ln') RETURNING id`, [slug]))[0].id;
    const job = await mk("zz-unsorted-a");
    await mk("zz-unsorted-b");
    const fileRow = async (id) => run(
      `INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type) VALUES ($1, '', 'doc', $1, '', $1, 'application/pdf')`, [id]);
    await fileRow("zz-mail-pdf");
    await fileRow("zz-mail-html");
    const filesOf = async () => run(`SELECT id, project_key, tag FROM files WHERE id IN ('zz-mail-pdf','zz-mail-html') ORDER BY id`);

    // ---- stage
    const staged = await u.stageDoc(run, {
      sourceRef: "gmail:zz0001", kind: "invoice", gmailMessageId: "zz0001", fromLabel: "10 Electric <billing@10electric.test>",
      subject: "Invoice 1567", vendorLabel: "10 Electric", amountCents: 609000, docDate: "2026-10-14", docNumber: "1567",
      summary: "Electrical rough-in", whyUnsure: "No address on it",
      suggestions: [{ project_slug: "zz-unsorted-a", reason: "Electrical scope" }, { project_slug: "no-such-job", reason: "x" }, { project_slug: "zz-unsorted-a", reason: "dupe" }],
      emailFileId: "zz-mail-html", attachmentFileIds: ["zz-mail-pdf"], stagedBy: "hermes",
    });
    assert.ok(staged.ok && !staged.existed);
    assert.deepEqual(staged.unknown_slugs, ["no-such-job"]);
    let doc = await u.getDoc(run, staged.id);
    assert.deepEqual(doc.suggestions, [{ project_slug: "zz-unsorted-a", reason: "Electrical scope" }], "unknown slugs and repeats are dropped");
    assert.equal(doc.status, "pending");
    assert.ok((await filesOf()).every((f) => f.tag === u.UNSORTED_TAG && f.project_key === ""));
    assert.ok((await u.countPending(run)) >= 1);

    assert.equal((await u.stageDoc(run, { sourceRef: "gmail:zz0001", kind: "bogus" })).ok, false);

    // ---- a note for the agent, then Joe files it himself anyway
    assert.equal((await u.noteForAgent(run, staged.id, "  ")).ok, false);
    const noted = await u.noteForAgent(run, staged.id, "Mahowald, split later");
    assert.ok(noted.ok && noted.agent_queued);
    assert.equal((await u.getDoc(run, staged.id)).status, "needs_agent");
    const trig = async () => (await run(`SELECT state, payload FROM agent_triggers WHERE kind = 'filing' AND ref = $1`, [`unsorted:${staged.id}`]))[0];
    let t = await trig();
    assert.deepEqual([t.state, t.payload.mode, t.payload.owner_note, t.payload.doc_id], ["pending", "owner_note", "Mahowald, split later", staged.id]);

    // ---- the agent can't tell: its question hands the doc back to Joe
    const asked = await u.replyOnDoc(run, staged.id, "Which job gets the larger share?", true);
    assert.ok(asked.ok && asked.status === "pending");
    assert.equal((await u.getDoc(run, staged.id)).agent_note, "Which job gets the larger share?");
    assert.equal((await u.replyOnDoc(run, staged.id, " ", false)).ok, false);

    // ---- file to a job: files move, the invoice is logged as owed, once
    const filed = await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "owner", today: "2026-10-15" });
    assert.ok(filed.ok && filed.agent_queued, "Joe filed a cost → the agent places it");
    assert.deepEqual(filed.cost, { source: "sub_invoice", id: filed.cost.id, created: true });
    t = await trig();
    assert.deepEqual([t.state, t.payload.mode, t.payload.cost_source, t.payload.cost_id, t.payload.project_slug], ["pending", "place_cost", "sub_invoice", filed.cost.id, "zz-unsorted-a"]);
    assert.equal((await u.getDoc(run, staged.id)).agent_note, "", "filing clears the agent's old question");
    assert.ok((await filesOf()).every((f) => f.project_key === "zz-unsorted-a" && f.tag === "INVOICE · Email"));
    const [bill] = await run(`SELECT amount, vendor_label, invoice_date::text AS d, source_ref, status FROM sub_invoices WHERE id = $1`, [filed.cost.id]);
    assert.deepEqual([bill.amount, bill.vendor_label, bill.d, bill.source_ref, bill.status], [609000, "10 Electric", "2026-10-14", "gmail:zz0001", "approved"]);
    assert.equal((await u.fileDoc(run, staged.id, { to: "overhead" }, { by: "owner", today: "2026-10-15" })).ok, false, "filed docs need an Undo first");

    // ---- an agent re-reading the inbox never re-opens it
    const again = await u.stageDoc(run, { sourceRef: "gmail:zz0001", kind: "receipt", summary: "re-read" });
    assert.ok(again.ok && again.existed && again.status === "filed");
    doc = await u.getDoc(run, staged.id);
    assert.deepEqual([doc.doc_kind, doc.summary, doc.filed_project_slug], ["invoice", "Electrical rough-in", "zz-unsorted-a"]);

    // ---- undo: the bill filing made is removed, files go back, the follow-up is called off
    assert.ok((await u.undoDoc(run, staged.id)).ok);
    assert.equal((await trig()).state, "done");
    assert.equal((await run(`SELECT 1 FROM sub_invoices WHERE id = $1`, [filed.cost.id])).length, 0);
    assert.ok((await filesOf()).every((f) => f.project_key === "" && f.tag === u.UNSORTED_TAG));
    assert.equal((await u.getDoc(run, staged.id)).status, "pending");
    assert.equal((await u.undoDoc(run, staged.id)).ok, false);

    // ---- an invoice already entered by hand (same source_ref) is not removed by Undo
    await run(`INSERT INTO sub_invoices (project_id, vendor_label, amount, status, source_ref) VALUES ($1, 'Hand', 1000, 'approved', 'gmail:zz0001')`, [job]);
    const refiled = await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "hermes", note: "Address on page 2", today: "2026-10-15" });
    assert.ok(refiled.ok && refiled.cost.created === false, "updates the existing row instead of adding one");
    assert.equal(refiled.agent_queued, false, "an agent's own filing wakes nobody");
    assert.deepEqual([(await u.getDoc(run, staged.id)).agent_note, (await u.getDoc(run, staged.id)).owner_note], ["Address on page 2", "Mahowald, split later"]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM sub_invoices WHERE project_id = $1 AND source_ref = 'gmail:zz0001'`, [job]))[0].n, 1);
    assert.ok((await u.undoDoc(run, staged.id)).ok);
    assert.equal((await run(`SELECT count(*)::int AS n FROM sub_invoices WHERE project_id = $1 AND source_ref = 'gmail:zz0001'`, [job]))[0].n, 1, "a row filing didn't create stays");
    await run(`DELETE FROM sub_invoices WHERE project_id = $1`, [job]);

    // ---- a receipt becomes an expense with the receipt file linked; a paid-on bill blocks Undo
    const r = await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "owner", kind: "receipt", amountCents: 9054, vendorLabel: "Menards", today: "2026-10-15" });
    assert.ok(r.ok && r.cost.source === "expense");
    const [exp] = await run(`SELECT amount_cents, vendor_label, receipt_file_id, kind FROM expenses WHERE id = $1`, [r.cost.id]);
    assert.deepEqual([exp.amount_cents, exp.vendor_label, exp.receipt_file_id, exp.kind], [9054, "Menards", "zz-mail-pdf", "material"]);
    assert.ok((await u.undoDoc(run, staged.id)).ok);
    assert.equal((await run(`SELECT 1 FROM expenses WHERE id = $1`, [r.cost.id])).length, 0);

    const b = await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "owner", kind: "invoice", today: "2026-10-15" });
    assert.ok(b.ok && b.cost.source === "sub_invoice");
    await run(`UPDATE sub_invoices SET paid_cents = 1000 WHERE id = $1`, [b.cost.id]);
    assert.equal((await u.undoDoc(run, staged.id)).ok, false, "never lose a payment recorded since");
    await run(`UPDATE sub_invoices SET paid_cents = 0 WHERE id = $1`, [b.cost.id]);
    assert.ok((await u.undoDoc(run, staged.id)).ok);

    // ---- statements and rebates file without a cost; asking for one is refused
    assert.equal((await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "owner", kind: "statement", logCost: true, today: "2026-10-15" })).ok, false);
    const st = await u.fileDoc(run, staged.id, { to: "project", projectSlug: "zz-unsorted-a" }, { by: "owner", kind: "statement", today: "2026-10-15" });
    assert.ok(st.ok && st.cost === null);
    assert.ok((await u.undoDoc(run, staged.id)).ok);

    // ---- overhead and dismiss
    const oh = await u.fileDoc(run, staged.id, { to: "overhead" }, { by: "owner", today: "2026-10-15" });
    assert.ok(oh.ok && oh.status === "filed");
    assert.ok((await filesOf()).every((f) => f.tag === "OVERHEAD · 2026" && f.project_key === ""));
    assert.ok((await u.undoDoc(run, staged.id)).ok);
    const dz = await u.fileDoc(run, staged.id, { to: "dismiss" }, { by: "owner", today: "2026-10-15" });
    assert.ok(dz.ok && dz.status === "dismissed");
    assert.ok((await filesOf()).every((f) => f.tag === u.NOT_FILED_TAG));

    assert.equal((await u.fileDoc(run, 999999, { to: "overhead" }, { by: "owner", today: "2026-10-15" })).ok, false);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});

test("vendorFromSender reads a display name or the domain", () => {
  assert.equal(u.vendorFromSender('"Top Tier Heating" <billing@toptier.test>'), "Top Tier Heating");
  assert.equal(u.vendorFromSender("invoices@menards.com"), "Menards");
  assert.equal(u.vendorFromSender(""), "Unknown vendor");
});
