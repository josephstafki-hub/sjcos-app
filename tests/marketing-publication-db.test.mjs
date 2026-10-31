// The posting agent (A17): an approved /marketing post goes to ONE platform
// through the dispatcher's `publication` kind and the publisher provider,
// which starts a posting run and reads its journal back. Pure parts (limits,
// sites, lock, journal verdicts, the provider with a fake launcher) and the
// whole chain against a disposable Postgres. No browser, no network: the
// launcher is a fake and the "run" is a journal the test writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, txOver } from "./field-fixtures.mjs";

process.env.SJC_PUBLISHER_DIR = mkdtempSync(path.join(tmpdir(), "sjc-publisher-test-"));
const pubDir = process.env.SJC_PUBLISHER_DIR;
test.after(() => rmSync(pubDir, { recursive: true, force: true }));

const { postProblem } = await import("../lib/marketing-types.ts");
const core = await import("../lib/publisher/core.ts");
const { makePublisherProvider } = await import("../lib/providers/publisher.ts");

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeLauncher() {
  const l = { started: [], activeUnits: new Set(), fail: null };
  l.start = (intentId, unit) => {
    if (l.fail) return { ok: false, error: l.fail };
    l.started.push(intentId);
    l.activeUnits.add(unit);
    return { ok: true };
  };
  l.active = (unit) => l.activeUnits.has(unit);
  return l;
}

/** Run a provider call with real (non-fake) outbound for the publisher only. */
async function live(fn) {
  const prev = process.env.SJC_OUTBOUND_DISABLED;
  delete process.env.SJC_OUTBOUND_DISABLED;
  try {
    return await fn();
  } finally {
    if (prev !== undefined) process.env.SJC_OUTBOUND_DISABLED = prev;
  }
}

test("platform limits: Instagram needs a photo, Google takes one photo and 1500 characters", () => {
  assert.equal(postProblem("facebook", "Deck done", 0), null);
  assert.match(postProblem("instagram", "Deck done", 0), /needs at least one photo/);
  assert.match(postProblem("google_business", "x".repeat(1501), 0), /1500 characters/);
  assert.match(postProblem("google_business", "ok", 2), /up to 1 photo/);
  assert.match(postProblem("facebook", "  ", 0), /no text/);
  assert.match(postProblem("instagram", Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), 1), /30 hashtags/);
});

test("sites: the browser stays on the platform, notices sign-in pages, and only takes a real post link", () => {
  assert.equal(core.hostAllowed("facebook", "https://www.facebook.com/SJCarpentry"), true);
  assert.equal(core.hostAllowed("facebook", "https://evil.example/facebook.com"), false);
  assert.equal(core.hostAllowed("facebook", "http://www.facebook.com/"), false, "https only");
  assert.equal(core.hostAllowed("instagram", "https://www.facebook.com/"), false);
  assert.equal(core.looksSignedOut("facebook", "https://www.facebook.com/login/?next=x"), true);
  assert.equal(core.looksSignedOut("instagram", "https://www.instagram.com/accounts/login/"), true);
  assert.equal(core.looksSignedOut("google_business", "https://accounts.google.com/v3/signin/identifier"), true);
  assert.equal(core.validPostUrl("instagram", "https://www.instagram.com/p/Cx12_ab/"), true);
  assert.equal(core.validPostUrl("instagram", "https://www.instagram.com/sjcarpentry/"), false, "a profile isn't a post");
  assert.equal(core.validPostUrl("google_business", "https://posts.gle/AbC123"), true);
  assert.equal(core.startUrlFor("facebook", { facebookPage: "https://www.facebook.com/SJC", instagramHandle: "", googleBusinessName: "" }), "https://www.facebook.com/SJC");
  assert.equal(core.startUrlFor("facebook", { facebookPage: "https://evil.example/", instagramHandle: "", googleBusinessName: "" }), "https://www.facebook.com/");
  assert.equal(core.startUrlFor("instagram", { facebookPage: "", instagramHandle: "@sjc", googleBusinessName: "" }), "https://www.instagram.com/sjc/");
});

test("one browser at a time: a live holder blocks, a dead one is taken over", () => {
  const release = core.acquireBrowser({ mode: "signin", ref: "facebook" });
  assert.ok(release);
  assert.equal(core.browserHolder()?.mode, "signin");
  assert.equal(core.acquireBrowser({ mode: "post", ref: uuid(1) }), null, "busy while Joe signs in");
  release();
  assert.equal(core.browserHolder(), null);
  // A holder whose process is gone is stale.
  const stale = core.acquireBrowser({ mode: "post", ref: uuid(2), pid: 2 ** 22 + 12345 });
  assert.ok(stale);
  assert.equal(core.browserHolder(), null, "dead pid doesn't count");
  const again = core.acquireBrowser({ mode: "post", ref: uuid(3) });
  assert.ok(again, "stale lock taken over");
  again();
});

test("journal verdicts: posted → confirmed; never pressed Post → failed (retryable by Joe); pressed Post without an answer → Joe checks", () => {
  const j = core.newJournal(uuid(10), "facebook", 1);
  assert.equal(core.verdictFromJournal(null, true).state, "unknown");
  assert.equal(core.verdictFromJournal(null, false).state, "permanent_failure");
  assert.match(core.verdictFromJournal(j, true).note, /Still posting/);
  assert.equal(core.verdictFromJournal(j, false).state, "permanent_failure", "stopped before Post: nothing went up");
  const pressed = { ...j, submittedAt: new Date().toISOString() };
  const v1 = core.verdictFromJournal(pressed, false);
  assert.equal(v1.state, "unknown");
  assert.equal(core.needsOwnerCheck(v1.note), true);
  const said = core.verdictFromJournal({ ...pressed, outcome: { kind: "not_posted", reason: "error toast", at: "x" } }, false);
  assert.equal(said.state, "unknown", "after pressing Post a 'not posted' still needs Joe's eyes");
  const ok = core.verdictFromJournal({ ...pressed, outcome: { kind: "posted", url: "https://www.facebook.com/x/posts/1", at: "x" } }, false);
  assert.deepEqual([ok.state, ok.providerRef, ok.providerState], ["confirmed", "https://www.facebook.com/x/posts/1", "posted"]);
  const noLink = core.verdictFromJournal({ ...pressed, outcome: { kind: "posted", url: null, at: "x" } }, false);
  assert.deepEqual([noLink.state, noLink.providerRef, noLink.providerState], ["confirmed", null, "posted:no-link"]);
});

test("provider: starts one run, never a second; busy browser and a failed start leave nothing sent", async () => {
  const l = fakeLauncher();
  const p = makePublisherProvider(l);
  const payload = { draft_id: 1, platform: "facebook", body: "x", media: [] };
  await live(async () => {
    const id = uuid(20);
    const r = await p.send(payload, { intentId: id, operationKey: "k", attempt: 1 });
    assert.deepEqual([r.responseClass, r.transmitted, r.providerRef], ["accepted", true, core.publishUnitFor(id)]);
    // The run wrote its journal; a second send for the same intent starts nothing.
    core.writeJournal(core.newJournal(id, "facebook", 1));
    const again = await p.send(payload, { intentId: id, operationKey: "k", attempt: 2 });
    assert.equal(again.responseClass, "unknown");
    assert.equal(l.started.length, 1);

    const release = core.acquireBrowser({ mode: "signin", ref: "facebook" });
    const busy = await p.send(payload, { intentId: uuid(21), operationKey: "k2", attempt: 1 });
    assert.deepEqual([busy.responseClass, busy.transmitted], ["retryable", false]);
    release();

    l.fail = "no user bus";
    const failed = await p.send(payload, { intentId: uuid(22), operationKey: "k3", attempt: 1 });
    assert.deepEqual([failed.responseClass, failed.transmitted], ["retryable", false]);
    const bad = await p.send({ ...payload, platform: "myspace" }, { intentId: uuid(23), operationKey: "k4", attempt: 1 });
    assert.equal(bad.responseClass, "permanent");
  });
});

test("the chain: rights → pick photos → card → approve → dispatch hands it to the agent → journal → posted with its link; a run that never pressed Post fails, Joe tries again, Joe settles an unsure one", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runOf(client);
    const tx = txOver(url);
    await client.query(`TRUNCATE publication_rights, marketing_draft_media, document_revisions, intent_authority RESTART IDENTITY CASCADE`);
    await client.query(`DELETE FROM marketing_drafts WHERE title LIKE 'zz-%'`);
    await client.query(`DELETE FROM projects WHERE slug = 'zz-pub'`);
    await client.query(`DELETE FROM files WHERE id LIKE 'zz-pub-%'`);
    await client.query(`DELETE FROM notifications WHERE title LIKE 'Posted to %' OR title LIKE 'Not posted to %'`);
    await client.query(`DELETE FROM users WHERE email = 'zz-owner@example.test'`);
    const [o] = await run(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
    const owner = { kind: "user", userId: o.id, role: "owner", name: "Joe", permissions: [] };
    const staff = { kind: "user", userId: uuid(99), role: "staff", name: "Abigail", permissions: ["marketing"] };
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-pub', 'ZZ Porch', 'warranty', 'ZZ') RETURNING id`);
    await run(`INSERT INTO files (id, project_key, type, name, storage_path) VALUES ('zz-pub-1', 'zz-pub', 'img', 'a.jpg', 'a.jpg'), ('zz-pub-2', 'zz-pub', 'img', 'b.jpg', 'b.jpg'), ('zz-pub-3', 'zz-pub', 'img', 'c.jpg', 'c.jpg')`);

    const m = await import("../lib/closeout/marketing.ts");
    const { resolveDecision, getDecision } = await import("../lib/commands/decisions.ts");
    const { getIntent } = await import("../lib/commands/intents.ts");
    const { dispatchOnce, reconcileUnknown } = await import("../lib/dispatch/core.ts");
    const { EFFECTS } = await import("../lib/dispatch/effects.ts");
    const { getIntentAuthority } = await import("../lib/dispatch/authority.ts");
    const { postStage } = await import("../lib/publisher/stage.ts");

    await m.grantPublicationRights(run, { fileIds: ["zz-pub-1", "zz-pub-2"], projectId: p.id, grantedBy: "Pat Client" });
    const [d0] = await run(`INSERT INTO marketing_drafts (project_id, kind, title, body, status) VALUES ($1, 'social', 'zz-porch', 'New porch is done! #carpentry', 'draft') RETURNING id`, [p.id]);
    const id = Number(d0.id);

    // Pick: Instagram, two shareable photos + one that isn't (left out).
    const picked = await m.setDraftPost(run, id, { platform: "instagram", photoIds: ["zz-pub-2", "zz-pub-1", "zz-pub-3"], actor: "owner:Joe" });
    assert.deepEqual(picked.draft.media, ["zz-pub-2", "zz-pub-1"], "order kept, unshareable dropped");
    assert.deepEqual(picked.rejectedPhotoIds, ["zz-pub-3"]);

    // Staff can stage the card; it waits for Joe.
    const s = await m.stagePublication(run, staff, id);
    assert.equal(s.decision.action, "publish_marketing");
    assert.equal(s.decision.recipient, "instagram");
    // An edit retires the waiting card.
    await m.noteDraftEdited(run, id, "staff:Abigail");
    assert.equal((await getDecision(run, s.decision.id)).status, "superseded");
    assert.equal((await m.getDraft(run, id)).status, "draft");
    const s2 = await m.stagePublication(run, staff, id);
    await resolveDecision(run, { id: s2.decision.id, outcome: "approved", principal: owner, via: "app" });

    // Queue: the decision is NOT spent here; the dispatcher spends it.
    const service = { kind: "service", name: `publication-card:${s2.decision.id}` };
    const q = await m.queueApprovedPublication(run, service, id);
    assert.equal(q.ok, true);
    assert.equal((await getDecision(run, s2.decision.id)).status, "approved");
    assert.equal((await m.getDraft(run, id)).status, "queued");
    await assert.rejects(m.noteDraftEdited(run, id, "owner:Joe"), /on its way/, "no edits while it's going up");

    // Dispatch with the real publisher provider over a fake launcher.
    const l = fakeLauncher();
    const deps = { tx, run, providers: { publisher: makePublisherProvider(l) }, worker: "w1" };
    const [out] = await live(() => dispatchOnce(deps, { intentIds: [q.intentId] }));
    assert.equal(out.responseClass, "accepted", out.error ?? "");
    assert.equal(l.started[0], q.intentId);
    assert.equal((await getDecision(run, s2.decision.id)).status, "consumed", "spent at dispatch");
    assert.equal((await getIntentAuthority(run, q.intentId)).kind, "decision");
    assert.equal((await m.getDraft(run, id)).status, "posting");

    // The run's own check passes while it's in flight…
    const ok = await m.checkPublicationRun(run, q.intentId);
    assert.equal(ok.ok, true, ok.reason);
    assert.deepEqual(ok.photos.map((x) => x.storagePath), ["b.jpg", "a.jpg"]);
    // …and fails the moment a photo's right is withdrawn.
    await run(`UPDATE publication_rights SET withdrawn_at = now() WHERE file_id = 'zz-pub-1'`);
    const withdrawn = await m.checkPublicationRun(run, q.intentId);
    assert.equal(withdrawn.ok, false);
    assert.match(withdrawn.reason, /rights were withdrawn/);
    await run(`UPDATE publication_rights SET withdrawn_at = NULL WHERE file_id = 'zz-pub-1'`);

    // Still running → nothing changes.
    core.writeJournal(core.journalStep(core.newJournal(q.intentId, "instagram", id), "photos in (2)"));
    await run(`UPDATE action_intents SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [q.intentId]);
    let rec = await reconcileUnknown(deps, { minAgeSeconds: 0 });
    assert.equal(rec.stillUnknown, 1);
    assert.equal((await getIntent(run, q.intentId)).state, "accepted");

    // The agent posts and reports the link → confirmed, draft posted, Joe told.
    const j = core.readJournal(q.intentId);
    core.writeJournal({ ...j, textFilledAt: "t", photosUploadedAt: "t", submittedAt: "t", outcome: { kind: "posted", url: "https://www.instagram.com/p/ZZ123/", at: "t" } });
    l.activeUnits.clear();
    await run(`UPDATE action_intents SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [q.intentId]);
    rec = await reconcileUnknown(deps, { minAgeSeconds: 0 });
    assert.equal(rec.confirmed, 1);
    const posted = await m.getDraft(run, id);
    assert.equal(posted.status, "posted");
    const [row] = await run(`SELECT posted_url, posted_at IS NOT NULL AS at FROM marketing_drafts WHERE id = $1`, [id]);
    assert.deepEqual([row.posted_url, row.at], ["https://www.instagram.com/p/ZZ123/", true]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM notifications WHERE title LIKE 'Posted to Instagram%'`))[0].n, 1);
    await assert.rejects(m.stagePublication(run, owner, id), /Already posted/);

    // ── A second post that never got to Post, then Joe tries again. ──
    const [d1] = await run(`INSERT INTO marketing_drafts (project_id, kind, title, body, status) VALUES ($1, 'social', 'zz-porch-fb', 'Porch, Facebook version', 'draft') RETURNING id`, [p.id]);
    const id2 = Number(d1.id);
    await m.setDraftPost(run, id2, { platform: "facebook", photoIds: [], actor: "owner:Joe" });
    const c2 = await m.stagePublication(run, owner, id2);
    await resolveDecision(run, { id: c2.decision.id, outcome: "approved", principal: owner, via: "app" });
    const q2 = await m.queueApprovedPublication(run, { kind: "service", name: "card" }, id2);
    await live(() => dispatchOnce(deps, { intentIds: [q2.intentId] }));
    core.writeJournal({ ...core.newJournal(q2.intentId, "facebook", id2), outcome: { kind: "not_posted", reason: "Facebook needs you to sign in again.", at: "t", signIn: true } });
    l.activeUnits.clear();
    await run(`UPDATE action_intents SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [q2.intentId]);
    rec = await reconcileUnknown(deps, { minAgeSeconds: 0 });
    assert.equal(rec.failed, 1);
    let d2 = await m.getDraft(run, id2);
    assert.equal(d2.status, "failed");
    assert.equal((await run(`SELECT count(*)::int AS n FROM notifications WHERE title LIKE 'Not posted to Facebook%'`))[0].n, 1);

    assert.equal((await m.retryPublication(run, staff, id2)).ok, false, "only Joe tries again");
    const again = await m.retryPublication(run, owner, id2);
    assert.equal(again.ok, true, again.reason);
    assert.notEqual(again.intentId, q2.intentId);
    const [out2] = await live(() => dispatchOnce(deps, { intentIds: [again.intentId] }));
    assert.equal(out2.responseClass, "accepted", out2.error ?? "");
    assert.equal((await getIntentAuthority(run, again.intentId)).kind, "owner", "Joe's click is the authority for the retry");

    // This one pressed Post and died: Joe looks and says it's up.
    core.writeJournal({ ...core.newJournal(again.intentId, "facebook", id2), submittedAt: "t" });
    l.activeUnits.clear();
    await run(`UPDATE action_intents SET updated_at = now() - interval '10 minutes' WHERE id = $1`, [again.intentId]);
    await reconcileUnknown(deps, { minAgeSeconds: 0 });
    const unsure = await getIntent(run, again.intentId);
    assert.equal(unsure.state, "accepted");
    assert.equal(core.needsOwnerCheck(unsure.last_error), true);
    d2 = await m.getDraft(run, id2);
    assert.equal(postStage({ status: d2.status, decision_status: "consumed", intent_id: unsure.id, intent_state: unsure.state, intent_error: unsure.last_error, hold_reason: null, post_error: null }).stage, "check");
    assert.equal((await m.settlePublicationByOwner(run, staff, id2, { posted: true, url: null })).ok, false);
    const settled = await m.settlePublicationByOwner(run, owner, id2, { posted: true, url: "https://www.facebook.com/sjc/posts/9" });
    assert.equal(settled.ok, true);
    assert.equal(settled.intent.state, "confirmed");
    await EFFECTS.publication(run, settled.intent, { responseClass: "confirmed", providerRef: settled.intent.provider_ref, providerState: settled.intent.provider_state, transmitted: true }, "confirmed");
    const [r2] = await run(`SELECT status, posted_url FROM marketing_drafts WHERE id = $1`, [id2]);
    assert.deepEqual([r2.status, r2.posted_url], ["posted", "https://www.facebook.com/sjc/posts/9"]);
  });
});
