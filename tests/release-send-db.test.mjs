import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedVendor, seedSub, seedFile } from "./_fixtures-procurement.mjs";
import { stagePackageRelease, stageSupplierPricingRequest as stageVendorPricingRequest } from "../lib/procurement/packages.ts";
import { stageSupplierPricingRequest } from "../lib/estimating/pricing.ts";
import { enqueueApprovedRelease, releaseFileIds, composePricingRequestEmail } from "../lib/procurement/release-send.ts";
import { resolveDecision, getDecision } from "../lib/commands/decisions.ts";
import { verifyAuthority } from "../lib/dispatch/authority.ts";
import { EFFECTS } from "../lib/dispatch/effects.ts";

// Tier 3: approving a release card sends its one email (it used to send
// nothing). The content is rebuilt at approval and must match the card.
const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const approve = async (run, id) => {
  const r = await resolveDecision(run, { id, outcome: "approved", principal: owner, via: "app" });
  assert.equal(r.ok, true, r.reason);
  return getDecision(run, id);
};
const intentRow = async (run, id) => (await run(`SELECT * FROM action_intents WHERE id = $1`, [id]))[0];
const file = (id, label) => ({ fileId: id, filename: `${id}.pdf`, mimeType: "application/pdf", label });

test("approved bid release card queues that one sub's email under the decision; an edited package sends nothing", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-rel1", { collectedCents: 100 });
    const a = await seedSub(client, "zz-sub-a", { trade: "Electrical", name: "Alpha Electric" });
    const b = await seedSub(client, "zz-sub-b", { trade: "Electrical" });
    await seedFile(client, "zz-plan-a1", { projectKey: "zz-rel1", name: "Plan A1.pdf" });
    const pid = Number((await client.query(`INSERT INTO bid_packages (project_id, title, trade, scope_notes, due_date) VALUES ($1, 'Electrical rough-in', 'Electrical', 'Rough-in per plan A1', '2026-11-20') RETURNING id`, [projectId])).rows[0].id);
    await client.query(`INSERT INTO bid_package_files (package_id, file_id, label) VALUES ($1, 'zz-plan-a1', 'Plan A1')`, [pid]);
    const ia = Number((await client.query(`INSERT INTO bid_invites (package_id, sub_slug, message) VALUES ($1, $2, 'Plans attached') RETURNING id`, [pid, a])).rows[0].id);
    const ib = Number((await client.query(`INSERT INTO bid_invites (package_id, sub_slug, message) VALUES ($1, $2, 'Hi there') RETURNING id`, [pid, b])).rows[0].id);
    const rel = await stagePackageRelease(run, { packageId: pid, exclusions: ["Joe sets the fixtures"], principal: agent });
    assert.equal(rel.ok, true, rel.reason);
    const cardA = rel.cards.find((c) => c.inviteId === ia).decision;
    const cardB = rel.cards.find((c) => c.inviteId === ib).decision;

    const pending = await enqueueApprovedRelease(run, cardA, [file("zz-plan-a1", "Plan A1")]);
    assert.equal(pending.ok, false, "a pending card sends nothing");

    const dA = await approve(run, cardA.id);
    assert.deepEqual(await releaseFileIds(run, dA), ["zz-plan-a1"]);
    const r = await enqueueApprovedRelease(run, dA, [file("zz-plan-a1", "Plan A1")]);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.to, "zz-sub-a@example.test");
    const intent = await intentRow(run, r.intentId);
    assert.equal(intent.kind, "send_bid_package");
    assert.equal(intent.decision_id, dA.id);
    assert.equal(intent.grant_id, null, "no second grant");
    assert.equal(intent.recipient, "zz-sub-a@example.test");
    assert.match(intent.payload.subject, /Bid request: Electrical rough-in/);
    assert.match(intent.payload.bodyText, /Hi Alpha,/);
    assert.match(intent.payload.bodyText, /Plans attached/);
    assert.match(intent.payload.bodyText, /Nov 20/);

    const auth = await verifyAuthority(run, intent, "test-worker");
    assert.equal(auth.ok, true, auth.reason);
    assert.equal(auth.kind, "decision");
    assert.equal((await getDecision(run, dA.id)).status, "consumed");

    const again = await enqueueApprovedRelease(run, dA, [file("zz-plan-a1", "Plan A1")]);
    assert.equal(again.ok, true);
    assert.equal(again.intentId, r.intentId, "a second tap reuses the same send");

    await EFFECTS.send_bid_package(run, intent, {}, "accepted");
    assert.equal((await client.query(`SELECT status FROM bid_invites WHERE id = $1`, [ia])).rows[0].status, "sent");
    assert.equal((await client.query(`SELECT status FROM bid_invites WHERE id = $1`, [ib])).rows[0].status, "draft", "the other sub is a separate card");

    // B's note was edited after the card was made: approval sends nothing.
    await client.query(`UPDATE bid_invites SET message = 'Changed note' WHERE id = $1`, [ib]);
    const dB = await approve(run, cardB.id);
    const refused = await enqueueApprovedRelease(run, dB, [file("zz-plan-a1", "Plan A1")]);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /changed after this card was made/);
    // ...and the same for a scope edit, even with the note put back.
    await client.query(`UPDATE bid_invites SET message = 'Hi there' WHERE id = $1`, [ib]);
    await client.query(`UPDATE bid_packages SET scope_notes = 'Rough-in per plan A2' WHERE id = $1`, [pid]);
    assert.equal((await enqueueApprovedRelease(run, dB, [file("zz-plan-a1", "Plan A1")])).ok, false);
    await client.query(`UPDATE bid_packages SET scope_notes = 'Rough-in per plan A1' WHERE id = $1`, [pid]);
    assert.equal((await enqueueApprovedRelease(run, dB, [file("zz-plan-a1", "Plan A1")])).ok, true, "back as approved → it sends");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents WHERE kind = 'send_bid_package'`)).rows[0].n, 2);
  });
});

test("approved supplier pricing request (estimating card) emails the vendor and marks the request sent", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-rel2", { collectedCents: 100 });
    const vendorId = await seedVendor(client, "zz-siweck", { name: "Siweck Lumber", email: "quotes@siweck.test" });
    const req = await stageSupplierPricingRequest(run, { project_id: projectId, supplier_name: "Siweck Lumber", vendor_id: vendorId, products: [{ product: { brand: "ZZ Trex", model: "Enhance", finish: "Clam Shell" }, qty: 40, unit: "ea" }, { product: { brand: "ZZ Trex", name: "Fascia" }, qty: null, unit: "lf" }], need_dates: { quote_by: "2026-11-10" }, principal: agent });
    const d = await approve(run, req.decision_id);
    const r = await enqueueApprovedRelease(run, d, []);
    assert.equal(r.ok, true, r.reason);
    const intent = await intentRow(run, r.intentId);
    assert.equal(intent.kind, "send_email");
    assert.equal(intent.decision_id, d.id);
    assert.equal(intent.recipient, "quotes@siweck.test");
    assert.match(intent.payload.bodyText, /^Hi Siweck,/);
    assert.match(intent.payload.bodyText, /- 40 ea ZZ Trex Enhance Clam Shell/);
    assert.match(intent.payload.bodyText, /Fascia \(quantity not yet measured/);
    assert.match(intent.payload.bodyText, /not an order/);
    const auth = await verifyAuthority(run, intent, "test-worker");
    assert.equal(auth.ok, true, auth.reason);
    await EFFECTS.send_email(run, intent, {}, "accepted");
    assert.equal((await client.query(`SELECT status FROM supplier_pricing_requests WHERE id = $1`, [req.request_id])).rows[0].status, "sent");
  });
});

test("vendor pricing card (procurement) sends from the request it carries; a changed vendor email or an old card sends nothing", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-rel3", { collectedCents: 100 });
    const vendorId = await seedVendor(client, "zz-abc", { name: "ABC Supply", email: "orders@abc.test" });
    const staged = await stageVendorPricingRequest(run, { projectId, vendorId, products: [{ description: "Ice and water shield", unit: "roll", qty: 6 }], neededBy: "2026-11-15", notes: "Delivery to site please.", principal: agent });
    assert.equal(staged.ok, true, staged.reason);
    const d = await approve(run, staged.decision.id);

    await client.query(`UPDATE vendors SET email = 'new@abc.test' WHERE id = $1`, [vendorId]);
    const moved = await enqueueApprovedRelease(run, d, []);
    assert.equal(moved.ok, false);
    assert.match(moved.reason, /email changed/);
    await client.query(`UPDATE vendors SET email = 'orders@abc.test' WHERE id = $1`, [vendorId]);

    const r = await enqueueApprovedRelease(run, d, []);
    assert.equal(r.ok, true, r.reason);
    const intent = await intentRow(run, r.intentId);
    assert.match(intent.payload.bodyText, /- 6 roll Ice and water shield/);
    assert.match(intent.payload.bodyText, /needed on site by 2026-11-15/);
    assert.match(intent.payload.bodyText, /Delivery to site please\./);
    assert.equal((await verifyAuthority(run, intent, "test-worker")).ok, true);

    const old = { ...d, id: "00000000-0000-0000-0000-000000000000", summary: { ...d.summary, request: undefined } };
    const stale = await enqueueApprovedRelease(run, old, []);
    assert.equal(stale.ok, false);
    assert.match(stale.reason, /Stage the pricing request again/);
  });
});

test("pricing request email never prices anything for the client", () => {
  const { subject, body } = composePricingRequestEmail("Siweck Lumber", "Larson Remodel", { lines: [{ label: "2x6x12", qty: 50, unit: "ea", gap: null }], neededBy: null, quoteBy: null, notes: "" }, ["Plan A1"]);
  assert.equal(subject, "Pricing request: Larson Remodel");
  assert.match(body, /Attached: Plan A1\./);
  assert.match(body, /Joe\nSJ Carpentry LLC\n612-361-6585$/);
  assert.doesNotMatch(body, /\$/);
});
