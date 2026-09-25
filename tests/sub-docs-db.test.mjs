import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedSub, seedFile, activateRoutinePolicy, IN_WINDOW, OUT_OF_WINDOW } from "./_fixtures-procurement.mjs";
import { detectMissingOrExpiring, requestDocument, ingestSubDocument, acceptDocument, canAccessSubDocument, listOpenRequests } from "../lib/sub-docs/index.ts";

// VALIDATION V15 (expired/wrong document) + V19 (multi-job sub, cross ids).
const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const subPrincipal = (slug) => ({ kind: "user", userId: null, role: "sub", name: slug, permissions: [], linkSlug: slug });

test("A12 detect → request (staged when policy inactive, sent under policy) → exceptions → accept stops contact", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const projectId = await seedProject(client, "zz-job1");
    const a = await seedSub(client, "zz-sub-a", { coiStatus: "expiring", coiExpiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) });
    const b = await seedSub(client, "zz-sub-b");
    const det = await detectMissingOrExpiring(run, { subSlugs: [a, b], jobRequirements: [{ projectId, subSlug: a, docTypes: ["agreement"] }] });
    const keys = det.requirements.map((r) => `${r.subSlug}:${r.docType}:${r.reason}`).sort();
    assert.deepEqual(keys, ["zz-sub-a:agreement:job_requirement", "zz-sub-a:coi:missing", "zz-sub-a:w9:missing", "zz-sub-b:coi:missing", "zz-sub-b:w9:missing"]);
    assert.equal(det.openedRequestIds.length, 5);
    const det2 = await detectMissingOrExpiring(run, { subSlugs: [a, b], jobRequirements: [{ projectId, subSlug: a, docTypes: ["agreement"] }] });
    assert.equal(det2.openedRequestIds.length, 0, "one open request per sub/doc/job");
    const open = await listOpenRequests(run, { subSlug: a });
    const coiReq = open.find((r) => r.doc_type === "coi");

    // policy inactive → staged decision, nothing enqueued
    let req = await requestDocument(run, { requestId: coiReq.id, principal: agent, at: IN_WINDOW });
    assert.equal(req.ok, true);
    assert.equal(req.mode, "staged");
    assert.equal(req.contact, "zz-sub-a@example.test", "trusted sub record contact");
    assert.match(req.reason, /not active/);
    assert.doesNotMatch(req.body, /call|inspection/i, "no invented call");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM action_intents`)).rows[0].n, 0);
    // policy active → intent under policy ref; outside the window → staged
    await activateRoutinePolicy(client);
    await client.query(`UPDATE decisions SET status = 'revoked' WHERE id = $1`, [req.decision.id]);
    req = await requestDocument(run, { requestId: coiReq.id, principal: agent, at: OUT_OF_WINDOW });
    assert.equal(req.mode, "staged");
    assert.match(req.reason, /window/);
    await client.query(`UPDATE decisions SET status = 'revoked' WHERE id = $1`, [req.decision.id]);
    req = await requestDocument(run, { requestId: coiReq.id, principal: agent, at: IN_WINDOW });
    assert.equal(req.mode, "sent");
    assert.equal(req.policyRef, "policy:routine.followup@1");
    const intent = await client.query(`SELECT kind, recipient, policy_ref, state FROM action_intents WHERE id = $1`, [req.intentId]);
    assert.equal(intent.rows[0].kind, "send_email");
    assert.equal(intent.rows[0].recipient, "zz-sub-a@example.test");
    assert.equal(intent.rows[0].policy_ref, "policy:routine.followup@1");
    // cadence: a second ask right away is held
    const soon = await requestDocument(run, { requestId: coiReq.id, principal: agent, at: IN_WINDOW });
    assert.equal(soon.mode, "staged");
    assert.match(soon.reason, /within the last 48h/);
    // opt-out is honoured
    await client.query(`INSERT INTO communication_optouts (channel, address, reason) VALUES ('email', 'zz-sub-b@example.test', 'asked')`);
    const bReq = (await listOpenRequests(run, { subSlug: b })).find((r) => r.doc_type === "w9");
    const optOut = await requestDocument(run, { requestId: bReq.id, principal: agent, at: new Date(IN_WINDOW.getTime() + 3 * 86_400_000) });
    assert.equal(optOut.mode, "staged");
    assert.match(optOut.reason, /opted out/);

    // files arrive
    await seedFile(client, "zz-coi-bad", { storagePath: null });
    await seedFile(client, "zz-coi-old");
    await seedFile(client, "zz-coi-dup");
    await seedFile(client, "zz-coi-good");
    await seedFile(client, "zz-agr-wrongjob");
    const unreadable = await ingestSubDocument(run, { subSlug: a, docType: "coi", fileId: "zz-coi-bad", principal: agent });
    assert.equal(unreadable.ok, false);
    assert.equal(unreadable.exception, "unreadable");
    const expired = await ingestSubDocument(run, { subSlug: a, docType: "coi", fileId: "zz-coi-old", expiresAt: "2025-01-01", checksum: "sha-old", principal: agent });
    assert.equal(expired.exception, "expired");
    const other = await seedProject(client, "zz-job2");
    const wrongJob = await ingestSubDocument(run, { subSlug: a, docType: "agreement", fileId: "zz-agr-wrongjob", projectId, claimedProjectId: other, principal: agent });
    assert.equal(wrongJob.exception, "wrong_job");
    const good = await ingestSubDocument(run, { subSlug: a, docType: "coi", fileId: "zz-coi-good", expiresAt: "2027-06-30", checksum: "sha-good", principal: agent });
    assert.equal(good.ok, true);
    assert.equal(good.document.status, "received", "receipt is not acceptance");
    assert.equal(good.document.restricted, true);
    assert.deepEqual(good.requestIds, [coiReq.id]);
    assert.equal((await listOpenRequests(run, { subSlug: a })).find((r) => r.doc_type === "coi").state, "open", "request stays open until accepted");
    const dup = await ingestSubDocument(run, { subSlug: a, docType: "coi", fileId: "zz-coi-dup", expiresAt: "2027-06-30", checksum: "sha-good", principal: agent });
    assert.equal(dup.exception, "duplicate");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM sub_documents WHERE sub_slug = $1 AND doc_type = 'coi'`, [a])).rows[0].n, 4, "every arrival is a distinct version row");
    // still not coverage: detection still lists the COI as missing
    const det3 = await detectMissingOrExpiring(run, { subSlugs: [a], openRequests: false });
    assert.ok(det3.requirements.some((r) => r.docType === "coi"));

    // acceptance needs metadata; missing → escalated with evidence; TIN refused; then accepted stops contact
    const noMeta = await acceptDocument(run, { documentId: good.document.id, metadata: null, principal: owner, escalateIfUnclear: true });
    assert.equal(noMeta.ok, false);
    assert.ok(noMeta.escalatedDecisionId);
    const esc = await client.query(`SELECT kind, summary FROM decisions WHERE id = $1`, [noMeta.escalatedDecisionId]);
    assert.equal(esc.rows[0].summary.attachments[0].fileId, "zz-coi-good");
    const tin = await acceptDocument(run, { documentId: good.document.id, metadata: { insurer: "X", policyNumber: "P1", limits: { each: 1000000 }, effectiveDate: "2026-07-01", expiryDate: "2027-06-30", tin: "12-3456789" }, principal: owner });
    assert.equal(tin.ok, false);
    assert.match(tin.reason, /TIN/);
    const agentTry = await acceptDocument(run, { documentId: good.document.id, metadata: { insurer: "X" }, principal: { kind: "agent", agent: "hermes", onBehalfOf: null } });
    assert.equal(agentTry.ok, false);
    const acc = await acceptDocument(run, { documentId: good.document.id, metadata: { insurer: "Acme Mutual", policyNumber: "GL-1", limits: { eachOccurrence: 1000000, aggregate: 2000000 }, effectiveDate: "2026-07-01", expiryDate: "2027-06-30" }, principal: owner });
    assert.equal(acc.ok, true);
    assert.equal(acc.document.status, "accepted");
    assert.deepEqual(acc.satisfiedRequestIds, [coiReq.id]);
    assert.equal((await client.query(`SELECT coi_status, coi_expires_at::text AS e FROM subs WHERE slug = $1`, [a])).rows[0].coi_status, "current");
    const after = await requestDocument(run, { requestId: coiReq.id, principal: agent, at: new Date(IN_WINDOW.getTime() + 5 * 86_400_000) });
    assert.equal(after.ok, false, "accepted document stops contact");
    assert.match(after.reason, /satisfied/);
    assert.equal((await client.query(`SELECT status FROM decisions WHERE id = $1`, [soon.decision.id])).rows[0].status, "revoked", "pending routine card withdrawn on acceptance");
    const det4 = await detectMissingOrExpiring(run, { subSlugs: [a], openRequests: false });
    assert.equal(det4.requirements.some((r) => r.docType === "coi"), false);
  });
});

test("V19 another sub cannot fetch a document by changing ids; restricted docs never leave the owner route", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await seedOwner(client);
    const run = runOver(client);
    const a = await seedSub(client, "zz-sub-a");
    const b = await seedSub(client, "zz-sub-b");
    await seedFile(client, "zz-w9-a");
    const doc = await ingestSubDocument(run, { subSlug: a, docType: "w9", fileId: "zz-w9-a", principal: agent });
    assert.equal(doc.ok, true);
    const asB = await canAccessSubDocument(run, subPrincipal(b), doc.document.id, { via: "portal" });
    assert.equal(asB.ok, false);
    assert.equal(asB.status, 404, "does not even confirm the id exists");
    const asAPortal = await canAccessSubDocument(run, subPrincipal(a), doc.document.id, { via: "portal" });
    assert.equal(asAPortal.ok, false);
    assert.equal(asAPortal.status, 403, "restricted document is not served through the portal");
    const asAOwnerRoute = await canAccessSubDocument(run, subPrincipal(a), doc.document.id, { via: "owner_route" });
    assert.equal(asAOwnerRoute.ok, true);
    const asOwner = await canAccessSubDocument(run, owner, doc.document.id, { via: "owner_route" });
    assert.equal(asOwner.ok, true);
    const staffNoSubs = { kind: "user", userId: null, role: "staff", name: "Sam", permissions: ["estimates"] };
    assert.equal((await canAccessSubDocument(run, staffNoSubs, doc.document.id, { via: "owner_route" })).ok, false);
    const staffSubs = { ...staffNoSubs, permissions: ["subs"] };
    assert.equal((await canAccessSubDocument(run, staffSubs, doc.document.id, { via: "owner_route" })).ok, true);
    const client1 = { kind: "user", userId: null, role: "client", name: "C", permissions: [], linkSlug: "zz-job1" };
    assert.equal((await canAccessSubDocument(run, client1, doc.document.id, { via: "portal" })).ok, false);
    assert.equal((await canAccessSubDocument(run, owner, 999999, { via: "owner_route" })).status, 404);
  });
});
