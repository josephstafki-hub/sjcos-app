import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, cleanField, seedField, spyHooks } from "./field-fixtures.mjs";
import { resolveDecision, getDecision, stageDecision } from "../lib/commands/decisions.ts";
import { proposePolicyVersion, activatePolicy } from "../lib/commands/policies.ts";
import { getIntent } from "../lib/commands/intents.ts";
import { prepareInternalInspection, recordCorrection, confirmCorrectionsBeforeWalkthrough, scheduleClientWalkthrough, recordClientPunch, resolveClientPunch, recordWrittenSignoff, releaseSignoffHooks } from "../lib/closeout/checklist.ts";
import { runDuePostProjectActions, checkInReplyReceived, recordCloseoutActuals, listPostProjectActions } from "../lib/closeout/postproject.ts";
import { pinSignedSignatureRequest, pinRevision, decisionBindsCurrentRevision, revisionRef, listRevisions } from "../lib/closeout/revisions.ts";
import { grantPublicationRights, draftFromAuthorizedPhotos, stagePublication, queueApprovedPublication, withdrawPublicationRights } from "../lib/closeout/marketing.ts";
import { MN_WARRANTY_TIERS } from "../lib/warranty-mn.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

async function fresh(client) {
  await cleanFoundation(client);
  await cleanField(client);
  return seedField(client);
}

test("V44 closeout: walkthrough gated on Joe's confirmation, duplicate sign-off, hooks fire once and only after client punch is resolved", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    const { hooks, calls } = spyHooks();
    await run(`INSERT INTO project_punch (project_id, item) VALUES ($1, 'Caulk tub'), ($1, 'Touch up paint')`, [f.p1]);
    const insp = await prepareInternalInspection(run, f.p1);
    assert.equal(insp.items.length, 2);
    // Walkthrough before corrections are confirmed → refused.
    const early = await scheduleClientWalkthrough(run, { projectId: f.p1, at: "2026-10-01T15:00:00Z" });
    assert.equal(early.ok, false);
    // Sub evidence → 'corrected', not done; confirmation still refused while one is open.
    const keys = insp.items.map((i) => i.key);
    await recordCorrection(run, { projectId: f.p1, itemKey: keys[0], photoIds: ["zz-f1"], by: "Marco" });
    let c = await confirmCorrectionsBeforeWalkthrough(run, f.owner, f.p1);
    assert.equal(c.ok, false);
    assert.deepEqual(c.open, ["Touch up paint"]);
    await recordCorrection(run, { projectId: f.p1, itemKey: keys[1], by: "Marco" });
    const notOwner = await confirmCorrectionsBeforeWalkthrough(run, f.subA, f.p1);
    assert.equal(notOwner.ok, false);
    c = await confirmCorrectionsBeforeWalkthrough(run, f.owner, f.p1);
    assert.equal(c.ok, true);
    assert.equal((await scheduleClientWalkthrough(run, { projectId: f.p1, at: "2026-10-01T15:00:00Z" })).ok, true);
    // Client punch, then written sign-off while one item is still open.
    const punch = await recordClientPunch(run, { projectId: f.p1, items: [{ label: "Scratch on door" }] });
    const [sr] = await run(`INSERT INTO signature_requests (project_id, doc_type, title, body, status, signed_name, signed_at) VALUES ($1, 'completion', 'zz-signoff', 'Accepted as complete', 'signed', 'Pat Client', now()) RETURNING id`, [f.p1]);
    const s1 = await recordWrittenSignoff(run, Number(sr.id), hooks);
    assert.deepEqual([s1.ok, s1.recorded, s1.hooksFired], [true, true, false]);
    assert.match(s1.blocked, /punch/);
    assert.equal(calls.signoffs.length, 0);
    // Duplicate sign-off → not recorded twice.
    const s2 = await recordWrittenSignoff(run, Number(sr.id), hooks);
    assert.equal(s2.recorded, false);
    // Resolve the item → hooks fire exactly once.
    await resolveClientPunch(run, { projectId: f.p1, itemKey: punch.items[0].key, by: "Joe" });
    const rel = await releaseSignoffHooks(run, f.p1, hooks);
    assert.equal(rel.fired, true);
    assert.equal((await releaseSignoffHooks(run, f.p1, hooks)).fired, false);
    await recordWrittenSignoff(run, Number(sr.id), hooks);
    assert.equal(calls.signoffs.length, 1, "final invoice hook once");
    assert.equal((await listPostProjectActions(run, f.p1)).length, 4);
    // Unsigned / wrong doc type refused.
    const [draft] = await run(`INSERT INTO signature_requests (project_id, doc_type, title, status) VALUES ($1, 'completion', 'zz-unsigned', 'sent') RETURNING id`, [f.p2]);
    assert.equal((await recordWrittenSignoff(run, Number(draft.id), hooks)).ok, false);
  });
});

test("V45 post-project: warranty only from configured terms, review only with URL, check-in reply issue tracked, late actual → one revision", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    const { hooks, calls } = spyHooks();
    const [sr] = await run(`INSERT INTO signature_requests (project_id, doc_type, title, body, status, signed_at) VALUES ($1, 'completion', 'zz-signoff2', 'ok', 'signed', now()) RETURNING id`, [f.p1]);
    await recordWrittenSignoff(run, Number(sr.id), hooks);
    // Policy inactive + nothing configured: warranty/review not_configured, check-in not due, nothing sent or staged.
    let out = await runDuePostProjectActions(run, f.owner, { mnTiers: [] }, hooks);
    const states = Object.fromEntries(out.map((a) => [a.kind, a.state]));
    assert.equal(states.warranty_docs, "not_configured");
    assert.equal(states.review_request, "not_configured");
    assert.equal((await run(`SELECT count(*)::int AS n FROM action_intents`))[0].n, 0);
    // Configure terms + URL, activate the policy, re-schedule the two and run again.
    await run(`INSERT INTO app_settings (key, value) VALUES ('company.warranty_terms', '1-year workmanship on all carpentry.'), ('company.google_review_url', 'https://g.page/r/zz')`);
    const p = await proposePolicyVersion(run, "postproject.followthrough", { checkin_days: 30, review_delay_days: 0 }, "test");
    await activatePolicy(run, "postproject.followthrough", p.version);
    await run(`UPDATE post_project_actions SET state = 'scheduled' WHERE project_id = $1 AND kind IN ('warranty_docs','review_request')`, [f.p1]);
    out = await runDuePostProjectActions(run, f.owner, { mnTiers: MN_WARRANTY_TIERS }, hooks);
    const byKind = Object.fromEntries(out.map((a) => [a.kind, a]));
    assert.equal(byKind.warranty_docs.state, "queued");
    const w = await getIntent(run, byKind.warranty_docs.intent_id);
    assert.equal(w.kind, "send_email");
    assert.match(w.payload.body, /1-year workmanship on all carpentry/);
    assert.match(w.payload.body, /327A\.02/);
    assert.ok(!/2-yr roof|lifetime/i.test(w.payload.body), "no invented coverage");
    assert.equal(byKind.review_request.state, "queued");
    assert.match((await getIntent(run, byKind.review_request.intent_id)).payload.body, /g\.page\/r\/zz/);
    // Re-running does not re-queue (rows are no longer 'scheduled'; operation keys are stable).
    const again = await runDuePostProjectActions(run, f.owner, { mnTiers: MN_WARRANTY_TIERS }, hooks);
    assert.ok(!again.some((a) => a.kind === "warranty_docs"));
    // Check-in becomes due 31 days later.
    const later = new Date(Date.now() + 31 * 86_400_000);
    const due = await runDuePostProjectActions(run, f.owner, { mnTiers: MN_WARRANTY_TIERS, now: later }, hooks);
    assert.equal(due.find((a) => a.kind === "checkin")?.state, "queued");
    // A reply with a problem → warranty claim + escalation.
    const reply = await checkInReplyReceived(run, { projectId: f.p1, body: "The door sticks and one tile cracked", hasIssue: true }, hooks);
    assert.ok(reply.claimId);
    const [claim] = await run(`SELECT project_id, issue, source FROM warranty_claims WHERE id = $1`, [reply.claimId]);
    assert.equal(claim.project_id, f.p1);
    assert.equal(calls.alerts.length, 1);
    assert.equal((await listPostProjectActions(run, f.p1)).find((a) => a.kind === "checkin").state, "issue_reported");
    // Actuals: first record → rev 1; same → no re-ingest; late change → rev 2 superseding 1.
    const a1 = await recordCloseoutActuals(run, { projectId: f.p1, actuals: { materialsCents: 120000, subsCents: 300000, ownerHours: { site: 12 } } }, hooks);
    assert.deepEqual([a1.revision, a1.created], [1, true]);
    const a1b = await recordCloseoutActuals(run, { projectId: f.p1, actuals: { materialsCents: 120000, subsCents: 300000, ownerHours: { site: 12 } } }, hooks);
    assert.equal(a1b.created, false);
    const a2 = await recordCloseoutActuals(run, { projectId: f.p1, actuals: { materialsCents: 125500, subsCents: 300000, ownerHours: { site: 12 } }, reason: "late lumber bill" }, hooks);
    assert.deepEqual([a2.revision, a2.created], [2, true]);
    assert.equal(calls.actuals.length, 2);
    assert.equal(calls.actuals[1].supersedesRevision, 1);
  });
});

test("V29 signatures/marketing: edited signed artifact → new revision voids the decision; changed audience → fresh decision; withdrawn rights cancel queued publication", { skip }, async () => {
  await withTestDb(async (url, client) => {
    const f = await fresh(client);
    const run = runOf(client);
    // Signed document pinned; a decision bound to it; editing the body → new revision → decision invalid.
    const [sr] = await run(`INSERT INTO signature_requests (project_id, doc_type, title, body, status, signed_name, signed_at) VALUES ($1, 'contract', 'zz-contract', 'Version A', 'signed', 'Pat', now()) RETURNING id`, [f.p1]);
    const rev1 = await pinSignedSignatureRequest(run, Number(sr.id));
    assert.equal(rev1.revision, 1);
    assert.equal((await pinSignedSignatureRequest(run, Number(sr.id))).revision, 1, "same content → same revision");
    const { decision } = await stageDecision(run, { kind: "package_release", action: "send_contract", title: "t", summary: {}, artifactRevision: revisionRef(rev1), requestedBy: f.owner, content: { rev: revisionRef(rev1) } });
    assert.equal((await decisionBindsCurrentRevision(run, decision.id, "signature_request", sr.id)).ok, true);
    await run(`UPDATE signature_requests SET body = 'Version B (edited after signing)' WHERE id = $1`, [sr.id]);
    const rev2 = await pinSignedSignatureRequest(run, Number(sr.id));
    assert.equal(rev2.revision, 2);
    const v = await decisionBindsCurrentRevision(run, decision.id, "signature_request", sr.id);
    assert.equal(v.ok, false);
    assert.match(v.reason, /fresh decision/);
    assert.equal((await listRevisions(run, "signature_request", sr.id)).length, 2);

    // Marketing: rights on f1/f2 only. f3 requested → rejected. Portal visibility is not a right.
    await run(`UPDATE files SET client_visible = true WHERE id = 'zz-f3'`);
    await grantPublicationRights(run, { fileIds: ["zz-f1", "zz-f2"], projectId: f.p1, grantedBy: "Pat Client" });
    const { draft, rejectedPhotoIds } = await draftFromAuthorizedPhotos(run, { projectId: f.p1, kind: "social", title: "zz-post", body: "Kitchen done", audience: "instagram", requestedPhotoIds: ["zz-f1", "zz-f2", "zz-f3"] });
    assert.deepEqual(rejectedPhotoIds, ["zz-f3"]);
    assert.deepEqual(draft.media, ["zz-f1", "zz-f2"]);
    const s1 = await stagePublication(run, f.owner, draft.id);
    assert.equal(s1.decision.kind, "publication");
    // Change the audience → the old decision is superseded, a new one staged.
    await run(`UPDATE marketing_drafts SET audience = 'facebook' WHERE id = $1`, [draft.id]);
    const s2 = await stagePublication(run, f.owner, draft.id);
    assert.notEqual(s2.decision.id, s1.decision.id);
    assert.equal((await getDecision(run, s1.decision.id)).status, "superseded");
    // Approve, but edit the body before queueing → refused; restore → queued.
    await resolveDecision(run, { id: s2.decision.id, outcome: "approved", principal: f.owner, via: "app" });
    await run(`UPDATE marketing_drafts SET body = 'Kitchen done!!!' WHERE id = $1`, [draft.id]);
    let q = await queueApprovedPublication(run, f.owner, draft.id);
    assert.equal(q.ok, false);
    await run(`UPDATE marketing_drafts SET body = 'Kitchen done' WHERE id = $1`, [draft.id]);
    q = await queueApprovedPublication(run, f.owner, draft.id);
    assert.equal(q.ok, true);
    assert.equal((await getIntent(run, q.intentId)).state, "pending");
    // Withdraw rights on f1 → queued publication cancelled, draft back to draft.
    const w = await withdrawPublicationRights(run, f.owner, "zz-f1", "client asked");
    assert.equal(w.cancelledIntents, 1);
    assert.equal((await getIntent(run, q.intentId)).state, "cancelled");
    assert.equal((await run(`SELECT status FROM marketing_drafts WHERE id = $1`, [draft.id]))[0].status, "draft");
    await assert.rejects(stagePublication(run, f.owner, draft.id), /without publication rights/);
    await assert.rejects(withdrawPublicationRights(run, f.subA, "zz-f2", "x"), /owner/);
    // pinRevision works for any doc kind and dedupes by hash.
    const a = await pinRevision(run, "weekly_summary", "abc", { x: 1 }, "release");
    const b = await pinRevision(run, "weekly_summary", "abc", { x: 1 }, "release");
    assert.equal(a.revision.id, b.revision.id);
  });
});
