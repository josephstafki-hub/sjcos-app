import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scopeChangePath } from "../lib/estimate-kinds.ts";

// The scope-change rule against a REAL Postgres: project_scope_change_path()
// agrees with the pure mirror, and the triggers refuse a change order before
// the contract is signed and a pre-con change estimate after it
// (docs/estimates-and-change-orders.md). Same harness as
// budget-writes-db.test.mjs:
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/estimate-kinds-db.test.mjs
//
// Skipped without that variable. Everything happens inside ONE transaction
// that is rolled back, on throwaway ZZ jobs the test creates — nothing is left
// behind whichever database it is aimed at.

const url = process.env.FIN_TEST_DATABASE_URL;

test("the database decides the path and refuses the wrong record", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  const path = async (id) => (await run(`SELECT project_scope_change_path($1) AS p`, [id]))[0].p;
  /** Run `fn` expecting it to raise; leaves the transaction usable. */
  const refused = async (fn, re) => {
    await client.query("SAVEPOINT attempt");
    await assert.rejects(fn, re);
    await client.query("ROLLBACK TO SAVEPOINT attempt");
  };
  try {
    await client.query("BEGIN");
    const mk = async (slug, status) => (await run(
      `INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date)
       VALUES ($1, $1, $2, 'ZZ Test', 0, 0) RETURNING id`, [slug, status]))[0].id;

    // ---- the path, per status, agrees with lib/estimate-kinds.ts
    for (const status of ["precon_signed", "floor_plan", "mood_board", "selections", "bidding", "construction_contract", "construction", "closeout", "warranty"]) {
      const id = await mk(`zz-kind-${status}`, status);
      assert.equal(await path(id), scopeChangePath(status, false), `${status}, no signed contract`);
    }
    assert.equal(await path("00000000-0000-0000-0000-000000000000"), null, "unknown project → null, not a guess");

    // ---- the Construction-contract stage flips on a signed contract (either record)
    const stage = await mk("zz-kind-stage", "construction_contract");
    assert.equal(await path(stage), "precon_estimate");
    await client.query("SAVEPOINT sig");
    await run(`INSERT INTO signature_requests (project_id, doc_type, title, body, status, signer_name, signer_email)
               VALUES ($1, 'contract', 'Contract', '', 'signed', 'ZZ', 'zz@example.com')`, [stage]);
    assert.equal(await path(stage), "change_order", "signed e-sign contract");
    await client.query("ROLLBACK TO SAVEPOINT sig");
    await run(`INSERT INTO document_drafts (project_id, template_key, title, status) VALUES ($1, 'contract', 'Construction Contract', 'signed')`, [stage]);
    assert.equal(await path(stage), "change_order", "signed Contract template draft");
    await run(`UPDATE document_drafts SET status = 'submitted' WHERE project_id = $1`, [stage]);
    assert.equal(await path(stage), "precon_estimate", "a contract out for signature is not signed");

    // ---- change orders: only once the contract is signed
    const precon = await mk("zz-kind-precon", "selections");
    const onSite = await mk("zz-kind-site", "construction");
    await refused(
      () => run(`INSERT INTO change_orders (project_id, title, price_cents) VALUES ($1, 'Add lighting', 250000)`, [precon]),
      /pre-construction \(selections\)[\s\S]*Money › Estimate/,
    );
    assert.equal((await run(`SELECT count(*)::int AS n FROM change_orders WHERE project_id = $1`, [precon]))[0].n, 0);
    const [co] = await run(`INSERT INTO change_orders (project_id, title, price_cents) VALUES ($1, 'Add lighting', 250000) RETURNING id`, [onSite]);
    assert.ok(co.id, "a change order on a job under contract is fine");

    // ---- estimates: 'formal' anywhere, 'precon_change' only before the contract
    const [f1] = await run(`INSERT INTO estimates (project_id, title) VALUES ($1, 'Base bid') RETURNING kind`, [precon]);
    assert.equal(f1.kind, "formal", "kind defaults to formal");
    const [pc] = await run(`INSERT INTO estimates (project_id, title, kind) VALUES ($1, 'Add pantry', 'precon_change') RETURNING id`, [precon]);
    assert.ok(pc.id, "a pre-con change before the contract is fine");
    const [f2] = await run(`INSERT INTO estimates (project_id, title, kind) VALUES ($1, 'Houzz import', 'formal') RETURNING id`, [onSite]);
    assert.ok(f2.id, "a formal estimate may be backfilled on a live job");
    await refused(
      () => run(`INSERT INTO estimates (project_id, title, kind) VALUES ($1, 'Add pantry', 'precon_change')`, [onSite]),
      /under contract \(construction\)[\s\S]*Money › Change orders/,
    );
    await refused(
      () => run(`UPDATE estimates SET kind = 'precon_change' WHERE id = $1`, [f2.id]),
      /under contract \(construction\)/,
    );
    await refused(
      () => run(`INSERT INTO estimates (project_id, title, kind) VALUES ($1, 'x', 'revision')`, [precon]),
      /estimates_kind_check/,
    );
    // Lead-scoped estimates (no project) are outside the phase rule.
    const [lead] = await run(`INSERT INTO estimates (lead_slug, title, kind) VALUES ('zz-lead', 'Lead precon change', 'precon_change') RETURNING id`);
    assert.ok(lead.id);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
