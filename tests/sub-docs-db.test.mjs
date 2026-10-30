import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { owner, agent, runOver, cleanProcurement, seedOwner, seedProject, seedSub, seedFile, activateRoutinePolicy, IN_WINDOW, OUT_OF_WINDOW } from "./_fixtures-procurement.mjs";
import {
  detectMissingOrExpiring,
  requestDocument,
  ingestSubDocument,
  acceptDocument,
  canAccessSubDocument,
  listOpenRequests,
  receiveSubDocument,
  confirmSubDocument,
  rejectDocument,
  subPaperworkForOwner,
} from "../lib/sub-docs/index.ts";

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

// Bug 6 (2026-10-30): a sub's typed COI date counted as accepted. A portal
// upload is now received + under review with a to-do for Joe; only Joe's
// accept makes it current, and a rejection asks the sub again.
test("portal COI: the sub's typed date is not coverage; Joe's to-do, accept with his date, reject asks again", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanProcurement(client);
    await client.query(`DELETE FROM work_items WHERE source_kind = 'sub_document'`);
    await seedOwner(client);
    const run = runOver(client);
    const job = await seedProject(client, "zz-job1");
    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const subOf = async (slug) => (await client.query(`SELECT coi_status, coi_expires_at::text AS e FROM subs WHERE slug = $1`, [slug])).rows[0];
    const itemOf = async (id) => (await client.query(`SELECT title, body, status, assignee_kind, assignee_key, project_id, source_kind, source_id, requires_approval FROM work_items WHERE id = $1`, [id])).rows[0];
    const docOf = async (id) => (await client.query(`SELECT status, review_note, expires_at::text AS e, validated_metadata FROM sub_documents WHERE id = $1`, [id])).rows[0];

    // An existing sub whose COI is current, and a new one with none.
    const a = await seedSub(client, "zz-sub-a", { coiStatus: "current", coiExpiresAt: day(60) });
    const b = await seedSub(client, "zz-sub-b");
    for (const f of ["zz-coi-a1", "zz-coi-b1", "zz-coi-c1", "zz-coi-c2", "zz-coi-d1", "zz-coi-d2", "zz-coi-e1"]) await seedFile(client, f);
    await detectMissingOrExpiring(run, { subSlugs: [b] }); // opens b's COI + W-9 requests
    await client.query(`UPDATE sub_document_requests SET next_at = now() WHERE sub_slug = $1`, [b]);

    // ── upload with a future typed date: under review, to-do for Joe, NOT current
    const got = await receiveSubDocument(run, { subSlug: b, docType: "coi", fileId: "zz-coi-b1", expiresAt: day(400), jobProjectId: job, principal: subPrincipal(b), createdBy: "sub-portal" });
    assert.equal(got.ok, true);
    assert.equal(got.document.status, "under_review", "receipt is not acceptance");
    assert.deepEqual(await subOf(b), { coi_status: "missing", e: null }, "the typed date does not make the COI current");
    const item = await itemOf(got.reviewItemId);
    assert.equal(item.status, "waiting_on_human");
    assert.equal(item.assignee_kind, "human");
    assert.equal(item.assignee_key, "human-joe");
    assert.equal(item.project_id, job, "the job is linked");
    assert.equal(item.source_kind, "sub_document");
    assert.equal(item.source_id, `subdoc:${got.document.id}:review`, "the document is linked");
    assert.equal(item.requires_approval, false);
    assert.match(item.title, /^Review ZZ Sub B's COI \(says it expires /);
    assert.match(item.body, /\/api\/files\/zz-coi-b1/);
    assert.match(item.body, /\/subs\/zz-sub-b/);
    assert.match(item.body, /\/projects\/zz-job1/);
    const coiReq = (await listOpenRequests(run, { subSlug: b })).find((r) => r.doc_type === "coi");
    assert.equal(coiReq.state, "open", "the chase keeps going until it's accepted");
    assert.equal(coiReq.next_at, null, "…but doesn't nag while it's waiting on Joe");
    assert.ok((await detectMissingOrExpiring(run, { subSlugs: [b], openRequests: false })).requirements.some((r) => r.docType === "coi"), "still missing until accepted");

    // The same on an existing current sub: nothing about its COI changes.
    const gotA = await receiveSubDocument(run, { subSlug: a, docType: "coi", fileId: "zz-coi-a1", expiresAt: day(30), principal: subPrincipal(a) });
    assert.equal(gotA.ok, true);
    assert.deepEqual(await subOf(a), { coi_status: "current", e: day(60) });

    // ── Joe accepts with the date he read; nobody else can, no lapsed date
    assert.equal((await confirmSubDocument(run, { documentId: got.document.id, expiresAt: day(380), principal: agent })).ok, false, "an agent can't accept on Joe's word");
    assert.equal((await confirmSubDocument(run, { documentId: got.document.id, subSlug: a, expiresAt: day(380), principal: owner })).ok, false, "wrong sub");
    const lapsed = await confirmSubDocument(run, { documentId: got.document.id, expiresAt: day(-1), principal: owner });
    assert.equal(lapsed.ok, false);
    assert.match(lapsed.reason, /already passed/);
    assert.equal((await confirmSubDocument(run, { documentId: got.document.id, expiresAt: "", principal: owner })).ok, false, "a COI needs the date");
    const acc = await confirmSubDocument(run, { documentId: got.document.id, subSlug: b, expiresAt: day(380), principal: owner });
    assert.equal(acc.ok, true);
    assert.deepEqual(await subOf(b), { coi_status: "current", e: day(380) }, "Joe's date, not the sub's");
    const accDoc = await docOf(got.document.id);
    assert.equal(accDoc.status, "accepted");
    assert.equal(accDoc.validated_metadata.confirmedByOwner, true);
    assert.equal(accDoc.validated_metadata.subTypedExpiry, day(400));
    assert.equal((await itemOf(got.reviewItemId)).status, "done", "the to-do closes");
    assert.deepEqual(acc.satisfiedRequestIds, [coiReq.id]);
    assert.equal((await confirmSubDocument(run, { documentId: got.document.id, expiresAt: day(380), principal: owner })).ok, false, "accepted once");

    // ── reject (policy inactive): not current, to-do closes, the ask is staged with the reason
    const rej = await rejectDocument(run, { documentId: gotA.document.id, subSlug: a, reason: "The policy number is cut off", principal: owner, at: IN_WINDOW });
    assert.equal(rej.ok, true);
    assert.equal(rej.document.status, "rejected");
    assert.equal(rej.ask.mode, "staged");
    const rejDoc = await docOf(gotA.document.id);
    assert.equal(rejDoc.review_note, "The policy number is cut off");
    assert.equal((await itemOf(gotA.reviewItemId)).status, "done");
    assert.deepEqual(await subOf(a), { coi_status: "current", e: day(60) }, "a rejection does not touch the sub's tracked COI");
    const staged = await client.query(`SELECT summary, recipient, target_kind FROM decisions WHERE id = $1`, [rej.ask.decisionId]);
    assert.equal(staged.rows[0].recipient, "zz-sub-a@example.test");
    assert.equal(staged.rows[0].target_kind, "sub_document_request");
    assert.match(staged.rows[0].summary.body, /wasn't able to accept that one: The policy number is cut off\./);
    const aReq = (await listOpenRequests(run, { subSlug: a })).find((r) => r.doc_type === "coi");
    assert.ok(aReq && aReq.next_at, "the chase resumes");
    assert.equal((await rejectDocument(run, { documentId: gotA.document.id, reason: "again", principal: owner })).ok, false, "rejected once");
    assert.equal((await rejectDocument(run, { documentId: got.document.id, reason: "x", principal: owner })).ok, false, "an accepted COI can't be rejected here");
    assert.equal((await rejectDocument(run, { documentId: gotA.document.id, reason: "  ", principal: owner })).ok, false);

    // ── b's accepted COI is still good: rejecting a junk upload asks nobody
    await seedFile(client, "zz-coi-b2");
    const junk = await receiveSubDocument(run, { subSlug: b, docType: "coi", fileId: "zz-coi-b2", expiresAt: day(500), principal: subPrincipal(b) });
    const rejJunk = await rejectDocument(run, { documentId: junk.document.id, reason: "Not a certificate", principal: owner, at: IN_WINDOW });
    assert.equal(rejJunk.ask.mode, "skipped");
    assert.match(rejJunk.ask.reason, /still good/);
    assert.deepEqual(await subOf(b), { coi_status: "current", e: day(380) });

    // ── another copy waiting on Joe: rejecting one doesn't chase the sub
    const c = await seedSub(client, "zz-sub-c");
    const c1 = await receiveSubDocument(run, { subSlug: c, docType: "coi", fileId: "zz-coi-c1", expiresAt: day(200), principal: subPrincipal(c) });
    await receiveSubDocument(run, { subSlug: c, docType: "coi", fileId: "zz-coi-c2", expiresAt: day(210), principal: subPrincipal(c) });
    const rejC = await rejectDocument(run, { documentId: c1.document.id, reason: "Blurry", principal: owner, at: IN_WINDOW });
    assert.equal(rejC.ask.mode, "skipped");
    assert.match(rejC.ask.reason, /already waiting for your review/);

    // ── accepting the newer of two waiting copies retires the older one and its to-do
    const d = await seedSub(client, "zz-sub-d");
    const d1 = await receiveSubDocument(run, { subSlug: d, docType: "coi", fileId: "zz-coi-d1", expiresAt: day(100), principal: subPrincipal(d) });
    const d2 = await receiveSubDocument(run, { subSlug: d, docType: "coi", fileId: "zz-coi-d2", expiresAt: day(300), principal: subPrincipal(d) });
    assert.equal((await confirmSubDocument(run, { documentId: d2.document.id, expiresAt: day(300), principal: owner })).ok, true);
    assert.equal((await docOf(d1.document.id)).status, "superseded");
    assert.equal((await itemOf(d1.reviewItemId)).status, "done");
    const paper = await subPaperworkForOwner(run, d);
    assert.equal(paper.coiStatus, "current");
    assert.deepEqual(paper.documents.map((x) => x.status), ["accepted", "superseded"]);

    // ── policy active, in the window: the ask goes out under the policy with Joe's reason
    await activateRoutinePolicy(client);
    const e = await seedSub(client, "zz-sub-e");
    const e1 = await receiveSubDocument(run, { subSlug: e, docType: "coi", fileId: "zz-coi-e1", expiresAt: day(90), principal: subPrincipal(e) });
    const rejE = await rejectDocument(run, { documentId: e1.document.id, reason: "Expired last month", principal: owner, at: IN_WINDOW });
    assert.equal(rejE.ask.mode, "sent");
    const intent = await client.query(`SELECT kind, recipient, policy_ref, payload FROM action_intents WHERE id = $1`, [rejE.ask.intentId]);
    assert.equal(intent.rows[0].kind, "send_email");
    assert.equal(intent.rows[0].recipient, "zz-sub-e@example.test");
    assert.equal(intent.rows[0].policy_ref, "policy:routine.followup@1");
    assert.match(intent.rows[0].payload.bodyText, /I wasn't able to accept that one: Expired last month\./);
    assert.deepEqual(await subOf(e), { coi_status: "missing", e: null });

    // ── a typed date already past: recorded as expired, no to-do, nothing changes
    await seedFile(client, "zz-coi-e2");
    const old = await receiveSubDocument(run, { subSlug: e, docType: "coi", fileId: "zz-coi-e2", expiresAt: day(-5), principal: subPrincipal(e) });
    assert.equal(old.ok, false);
    assert.equal(old.exception, "expired");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_id = $1`, [`subdoc:${old.documentId}:review`])).rows[0].n, 0);
    assert.deepEqual(await subOf(e), { coi_status: "missing", e: null });
  });
});
