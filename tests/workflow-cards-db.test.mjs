import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { stageDecision } from "../lib/commands/decisions.ts";
import { resolveFromChannel } from "../lib/decisions/resolve.ts";
import { stageAllocationReview, allocationReviewed } from "../lib/workflow/cards.ts";
import { stagePackageRelease } from "../lib/procurement/packages.ts";

// Tier 3 W03 + W11. Approving the over-allowance card drafts the change order
// (Joe, 2026-10-30), or a Pre-con change before the contract; Joe reviews who
// does what before any bid request is staged.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: owner };

async function approve(client, run, id) {
  await client.query("BEGIN");
  const r = await resolveFromChannel(run, { decisionId: id, via: "app", principal: owner, outcome: "approved" });
  await client.query("COMMIT");
  return r;
}

test("W11: approving the over-allowance card drafts a change order under contract; before the contract it creates nothing", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-w11%'`);
    const [built] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-w11-a', 'ZZ Build', 'construction', 'ZZ') RETURNING id`);
    const [pre] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-w11-b', 'ZZ Pre', 'selections', 'ZZ') RETURNING id`);
    const card = async (projectId, key) =>
      (await stageDecision(run, { kind: "change_order", action: "prepare_change_order", title: "Tile over allowance", summary: { changes: ["Client chose the Fireclay tile: $1,850.00 over the $3,000.00 allowance"] }, targetKind: "estimate_line", targetId: key, projectId, amountCents: 185000, content: { key }, dedupeKey: `zz:${key}`, requestedBy: agent })).decision;

    const r1 = await approve(client, run, (await card(built.id, "a")).id);
    assert.equal(r1.ok, true);
    assert.match(r1.reply, /Change order #\d+ drafted \(\$1,850\.00\)/);
    const [co] = await run(`SELECT title, description, price_cents, status FROM change_orders WHERE project_id = $1`, [built.id]);
    assert.deepEqual([co.price_cents, co.status], [185000, "draft"]);
    assert.match(co.description, /Fireclay/);

    // An older card on a job not yet under contract: nothing to change-order, nothing created.
    const r2 = await approve(client, run, (await card(pre.id, "b")).id);
    assert.match(r2.reply, /No change order: the contract isn't signed yet/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM change_orders WHERE project_id = $1`, [pre.id]))[0].n, 0);
    assert.equal((await run(`SELECT count(*)::int AS n FROM estimates WHERE project_id = $1`, [pre.id]))[0].n, 0);
  });
});

test("W03: a package release waits for Joe's who-does-what review; approving records it; a change needs a new review", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`DELETE FROM projects WHERE slug = 'zz-w03'`);
    await client.query(`DELETE FROM subs WHERE slug = 'zz-w03-sub'`);
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-w03', 'ZZ Alloc', 'construction', 'ZZ') RETURNING id`);
    await run(`INSERT INTO scope_items (project_id, key, title, trade, responsibility, supply_by, install_by) VALUES ($1, 'framing', 'Framing', 'Framing', 'joe', 'joe', 'joe'), ($1, 'electrical', 'Electrical', 'Electrical', 'sub', 'sub', 'sub')`, [p.id]);
    await run(`INSERT INTO subs (slug, name, trade, email) VALUES ('zz-w03-sub', 'ZZ Sparks', 'Electrical', 'sparks@example.test')`);
    const [pkg] = await run(`INSERT INTO bid_packages (project_id, title, trade, scope_notes) VALUES ($1, 'Electrical', 'Electrical', 'Rough-in') RETURNING id`, [p.id]);
    await run(`INSERT INTO bid_invites (package_id, sub_slug) VALUES ($1, 'zz-w03-sub')`, [pkg.id]);

    assert.equal(await allocationReviewed(run, p.id), false);
    const blocked = await stagePackageRelease(run, { packageId: Number(pkg.id), principal: agent });
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /reviewed who does what/);
    const [review] = await run(`SELECT id, summary FROM decisions WHERE action = 'review_scope_allocation' AND status = 'pending'`);
    assert.ok(review.summary.inclusions.includes("Framing: Joe"));
    assert.ok(review.summary.inclusions.includes("Electrical: a sub"));

    const r = await approve(client, run, review.id);
    assert.match(r.reply, /Allocation reviewed/);
    assert.equal(await allocationReviewed(run, p.id), true);
    const released = await stagePackageRelease(run, { packageId: Number(pkg.id), principal: agent });
    assert.equal(released.ok, true, released.reason);

    // Joe takes the electrical back: the old review no longer covers it.
    await run(`UPDATE scope_items SET responsibility = 'joe', install_by = 'joe' WHERE project_id = $1 AND key = 'electrical'`, [p.id]);
    assert.equal(await allocationReviewed(run, p.id), false);
    const again = await stageAllocationReview(run, p.id, agent);
    assert.equal(again.ok, true);
    assert.notEqual(again.decision.id, review.id);
  });
});
