import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, loadSchema } from "./_harness/testdb.mjs";
import { refreshSourcedWorkItem, flagUnseenForReview } from "../lib/obligations/work-items.ts";
import { createOrTouchObligation, handleReply, markWaiting, resolveObligation, reopenObligation, getObligation, listObligations } from "../lib/obligations/core.ts";
import { catchUpMailbox, readCheckpoint } from "../lib/obligations/catchup.ts";
import { applyBatch, normalizeBatch } from "../scripts/upsert-inbox-work-items.mjs";
import { collisionReport } from "../scripts/report-work-item-collisions.mjs";

// A01 — stable obligations and protected task state, against a REAL
// disposable Postgres (VALIDATION.md V01, V02, V18). Skipped only when the
// postgres binaries are missing — never redirected at production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

// Own database per test FILE on the shared harness cluster: node --test runs
// files in parallel and the foundation tests truncate shared tables, so a
// shared sjcos_test would race. Created once per file, cleaned per test.
const OWN_DB = "sjcos_test_obligations";
let ownUrl = null;
async function withDb(fn) {
  if (!ownUrl) {
    ownUrl = withTestDb(async (url) => {
      const admin = url.replace("/sjcos_test?", "/postgres?");
      const own = url.replace("/sjcos_test?", `/${OWN_DB}?`);
      const a = new pg.Client({ connectionString: admin });
      await a.connect();
      try {
        await a.query(`DROP DATABASE IF EXISTS ${OWN_DB} WITH (FORCE)`);
        await a.query(`CREATE DATABASE ${OWN_DB}`);
      } finally {
        await a.end();
      }
      await loadSchema(own);
      return own;
    });
  }
  const url = await ownUrl;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(url, client);
  } finally {
    await client.end();
  }
}


const runOver = (client) => async (sql, params) => (await client.query(sql, params)).rows;

async function clean(client) {
  await client.query(`TRUNCATE work_items, obligations, mailbox_checkpoints, runbook_instances, agent_runs, agent_receipts, detector_state, calls RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM leads WHERE slug LIKE 'zz-%'`);
}

async function seedLead(client, slug = "zz-a01-lead") {
  const r = await client.query(`INSERT INTO leads (slug, name, email) VALUES ($1, 'ZZ A01', 'zz-a01@example.test') RETURNING id`, [slug]);
  return r.rows[0].id;
}

const wi = async (client, id) => (await client.query(`SELECT * FROM work_items WHERE id = $1`, [id])).rows[0];

test("V01 refresh preserves execution state; only source facts move", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const leadId = await seedLead(client);
    const first = await refreshSourcedWorkItem(run, {
      sourceKind: "email", sourceId: "thr-1", provider: "gmail", title: "Railing question", body: "v1 body",
      status: "waiting_on_human", priority: "normal", leadId, createdBy: "inbox-cron", stampScan: true,
    });
    assert.equal(first.action, "created");
    assert.ok(first.obligationId, "obligation created alongside");
    const created = await wi(client, first.id);
    assert.equal(created.obligation_id, first.obligationId);
    assert.ok(created.last_seen_in_scan_at);

    // Joe / an agent works the card: every execution field changes.
    const soon = new Date(Date.now() + 3 * 86400e3).toISOString();
    await client.query(
      `UPDATE work_items SET status = 'in_progress', priority = 'urgent', assignee_kind = 'agent', assignee_key = 'claude-code-server',
              approval_status = 'requested', due_at = $2 WHERE id = $1`,
      [first.id, soon],
    );
    // The Central due_at trigger snoozed it to the due day's midnight (and
    // cleared promoted_at, as today). Then Joe promotes it by hand.
    await client.query(`UPDATE work_items SET promoted_at = now() WHERE id = $1`, [first.id]);
    const mid = await wi(client, first.id);
    const snoozeBefore = mid.snoozed_until;
    assert.ok(snoozeBefore, "trigger snoozed the future-dated item");

    // A re-scan of the same thread with different source-side values.
    const again = await refreshSourcedWorkItem(run, {
      sourceKind: "email", sourceId: "thr-1", provider: "gmail", title: "Railing question (re)", body: "v2 body",
      status: "queued", priority: "low", leadId: null, createdBy: "inbox-cron", stampScan: true,
    });
    assert.equal(again.action, "refreshed");
    assert.equal(again.id, first.id, "same item, no twin");
    const after = await wi(client, first.id);
    assert.equal(after.status, "in_progress");
    assert.equal(after.priority, "urgent");
    assert.equal(after.assignee_kind, "agent");
    assert.equal(after.assignee_key, "claude-code-server");
    assert.equal(after.approval_status, "requested");
    assert.equal(new Date(after.due_at).toISOString(), new Date(mid.due_at).toISOString());
    assert.equal(String(after.snoozed_until), String(snoozeBefore));
    assert.ok(after.promoted_at, "promoted_at untouched");
    assert.equal(after.lead_id, leadId, "empty source link does not clear an existing one");
    assert.equal(after.body, "v2 body", "untouched body follows the source");
    assert.equal(after.title, "Railing question (re)");

    // Once an agent has recorded work, the body/title stop following the source.
    await client.query(`INSERT INTO agent_runs (work_item_id, runtime_name, status) VALUES ($1, 'claude', 'succeeded')`, [first.id]);
    await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-1", provider: "gmail", title: "T3", body: "v3 body", createdBy: "inbox-cron" });
    const locked = await wi(client, first.id);
    assert.equal(locked.body, "v2 body");
    assert.equal(locked.title, "Railing question (re)");
  });
});

test("V01 replay cannot resurrect done work; same titles stay distinct; a new message in an old thread is new work", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const a = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-A", provider: "gmail", title: "Send the estimate", body: "a", createdBy: "inbox-cron" });
    const b = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-B", provider: "gmail", title: "Send the estimate", body: "b", createdBy: "inbox-cron" });
    assert.equal(a.action, "created");
    assert.equal(b.action, "created");
    assert.notEqual(a.id, b.id, "same title, different stable id → separate items");
    assert.notEqual(a.obligationId, b.obligationId);

    await client.query(`UPDATE work_items SET status = 'done', completed_at = now() WHERE id = $1`, [a.id]);
    const replay = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-A", provider: "gmail", title: "Send the estimate", body: "a again", createdBy: "inbox-cron" });
    assert.equal(replay.action, "kept_done");
    assert.equal(replay.id, a.id);
    const n = await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_id = 'thr-A'`);
    assert.equal(n.rows[0].n, 1, "no twin for a done thread");
    assert.equal((await wi(client, a.id)).status, "done");

    // A NEW message id on thread A: a new promise → new obligation + new item.
    const promise = await refreshSourcedWorkItem(run, {
      sourceKind: "email", sourceId: "thr-A", messageId: "msg-A2", provider: "gmail", title: "Send the estimate", body: "they also asked about the deck", createdBy: "inbox-cron",
    });
    assert.equal(promise.action, "created");
    assert.notEqual(promise.id, a.id);
    assert.notEqual(promise.obligationId, a.obligationId);
    assert.equal((await wi(client, a.id)).status, "done", "old work untouched");
    // Replaying the same message id touches the same item, no third.
    const replay2 = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-A", messageId: "msg-A2", provider: "gmail", title: "x", body: "y", createdBy: "inbox-cron" });
    assert.equal(replay2.action, "refreshed");
    assert.equal(replay2.id, promise.id);
    const n2 = await client.query(`SELECT count(*)::int AS n FROM work_items WHERE source_id = 'thr-A'`);
    assert.equal(n2.rows[0].n, 2);

    // No stable identity at all → review item, stable across re-scans.
    const unknown = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: null, title: "Mystery", body: "?", createdBy: "inbox-cron" });
    assert.equal(unknown.action, "review");
    const u = await wi(client, unknown.id);
    assert.equal(u.status, "waiting_on_human");
    assert.equal(u.blocked_reason, "unknown source identity; review");
    assert.equal((await getObligation(run, unknown.obligationId)).status, "review");
    const unknownAgain = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: null, title: "Mystery", body: "?", createdBy: "inbox-cron" });
    assert.equal(unknownAgain.id, unknown.id);
  });
});

test("V01 scan absence flags for review at most once and never cancels", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const it = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-old", provider: "gmail", title: "Old", body: "b", createdBy: "inbox-cron", stampScan: true });
    // trg_work_items_updated_at stamps now() on every update; backdate with it off.
    const backdate = async (days) => {
      await client.query(`ALTER TABLE work_items DISABLE TRIGGER trg_work_items_updated_at`);
      await client.query(`UPDATE work_items SET last_seen_in_scan_at = now() - ($2::int * interval '1 day'), updated_at = now() - ($2::int * interval '1 day') WHERE id = $1`, [it.id, days]);
      await client.query(`ALTER TABLE work_items ENABLE TRIGGER trg_work_items_updated_at`);
    };
    await client.query(`UPDATE work_items SET status = 'queued' WHERE id = $1`, [it.id]);
    await backdate(20);
    const flagged = await flagUnseenForReview(run, { sourceKind: "email", createdBy: "inbox-cron" });
    assert.deepEqual(flagged, [it.id]);
    const w = await wi(client, it.id);
    assert.equal(w.status, "waiting_on_human");
    assert.equal(w.blocked_reason, "not seen in scan; review");
    assert.ok(w.scan_review_flagged_at);
    assert.equal((await getObligation(run, it.obligationId)).status, "review");
    // Joe puts it back to queued; still unseen — but never flagged twice, never cancelled.
    await client.query(`UPDATE work_items SET status = 'queued', blocked_reason = NULL WHERE id = $1`, [it.id]);
    await backdate(30);
    const second = await flagUnseenForReview(run, { sourceKind: "email", createdBy: "inbox-cron" });
    assert.deepEqual(second, []);
    assert.equal((await wi(client, it.id)).status, "queued");
  });
});

test("V02 checkpointed catch-up pages past 150 threads and holds the watermark on errors", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const base = Date.parse("2026-09-01T12:00:00Z");
    const all = Array.from({ length: 412 }, (_, i) => ({ id: `t${i}`, date: base + i * 60e3 }));
    const fetchPage = async ({ since, pageToken, pageSize }) => {
      const eligible = all.filter((t) => since == null || t.date >= since).sort((a, b) => b.date - a.date);
      const start = pageToken ? Number(pageToken) : 0;
      const threads = eligible.slice(start, start + pageSize);
      const next = start + pageSize < eligible.length ? String(start + pageSize) : null;
      return { threads, nextPageToken: next };
    };
    const handled = new Set();
    const clock = () => new Date(base + 412 * 60e3 + 1000);
    const r1 = await catchUpMailbox(run, { mailbox: "Joe@Example.test", scope: "test", fetchPage, handleThread: async (t) => void handled.add(t.id), pageSize: 100, overlapMs: 5 * 60e3, now: clock });
    assert.equal(r1.mode, "full");
    assert.equal(r1.pages, 5);
    assert.equal(r1.threads, 412);
    assert.equal(handled.size, 412, "nothing beyond a 150 cap was skipped");
    assert.equal(r1.advanced, true);
    const cp = await readCheckpoint(run, "joe@example.test", "test");
    assert.ok(cp.last_ok_at);
    assert.equal(new Date(cp.watermark_at).getTime(), clock().getTime());

    // Incremental: three new threads arrive; the overlap re-covers the tail.
    const later = clock().getTime();
    all.push({ id: "n1", date: later + 1000 }, { id: "n2", date: later + 2000 }, { id: "n3", date: later + 3000 });
    const seen2 = [];
    const r2 = await catchUpMailbox(run, { mailbox: "joe@example.test", scope: "test", fetchPage, handleThread: async (t) => void seen2.push(t.id), pageSize: 100, overlapMs: 5 * 60e3, now: () => new Date(later + 10e3) });
    assert.equal(r2.mode, "incremental");
    assert.ok(seen2.includes("n1") && seen2.includes("n2") && seen2.includes("n3"));
    assert.ok(seen2.length < 20, `overlap window only re-covers the tail (${seen2.length})`);

    // A handler error holds the watermark where it was.
    all.push({ id: "bad", date: later + 20e3 });
    const r3 = await catchUpMailbox(run, {
      mailbox: "joe@example.test", scope: "test", fetchPage,
      handleThread: async (t) => { if (t.id === "bad") throw new Error("gmail hiccup"); },
      pageSize: 100, overlapMs: 5 * 60e3, now: () => new Date(later + 30e3),
    });
    assert.equal(r3.advanced, false);
    assert.equal(r3.errors.length, 1);
    const cp3 = await readCheckpoint(run, "joe@example.test", "test");
    assert.equal(new Date(cp3.watermark_at).getTime(), later + 10e3, "watermark held");
    assert.match(cp3.last_error, /handler error/);
  });
});

test("V02 an old unresolved obligation beside a new answered one: replies resolve only their own obligation", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const src = (messageId, role) => ({ provider: "gmail", account: "joe@example.test", threadId: "thr-Z", messageId, role });
    const old = await createOrTouchObligation(run, { source: src("m1", "origin"), title: "Old question: permit timing", createdBy: "test" });
    const fresh = await createOrTouchObligation(run, { source: src("m3", "origin"), title: "New question: paint colour", createdBy: "test" });
    assert.equal(old.action, "created");
    assert.equal(fresh.action, "created");
    assert.notEqual(old.obligation.id, fresh.obligation.id, "two promises on one thread");

    // We answer the NEW one (In-Reply-To m3).
    const out = await handleReply(run, { reply: src("m4", "reply"), inReplyToMessageId: "m3", direction: "outbound", by: "joe" });
    assert.deepEqual(out.resolved.map((o) => o.id), [fresh.obligation.id]);
    assert.deepEqual(out.untouched.map((o) => o.id), [old.obligation.id]);
    assert.equal((await getObligation(run, old.obligation.id)).status, "open", "older unanswered stays open");
    assert.equal((await getObligation(run, fresh.obligation.id)).status, "done");
    assert.equal((await getObligation(run, fresh.obligation.id)).resolution.kind, "reply_sent");

    // We answer the old one too; now we wait on them.
    const out2 = await handleReply(run, { reply: src("m5", "reply"), inReplyToMessageId: "m1", direction: "outbound", by: "joe" });
    assert.deepEqual(out2.resolved.map((o) => o.id), [old.obligation.id]);

    // A waiting obligation: their inbound answer resolves it; an unrelated new inbound is unmatched.
    const waiting = await createOrTouchObligation(run, { source: src("m6", "origin"), title: "Sent the estimate; waiting on signature", createdBy: "test" });
    await markWaiting(run, waiting.obligation.id, "chase in 3 days");
    const inbound = await handleReply(run, { reply: src("m7", "reply"), inReplyToMessageId: "m6", direction: "inbound", by: "gmail" });
    assert.deepEqual(inbound.resolved.map((o) => o.id), [waiting.obligation.id]);
    assert.equal((await getObligation(run, waiting.obligation.id)).resolution.kind, "business_response");
    const stray = await handleReply(run, { reply: src("m8", "reply"), inReplyToMessageId: null, direction: "inbound", by: "gmail" });
    assert.equal(stray.unmatched, true);

    // Reopen rules: a replay of a known message is refused; a new message with a reason reopens.
    const bad = await reopenObligation(run, waiting.obligation.id, { reason: "they replied again", source: src("m6", "origin"), by: "test" });
    assert.equal(bad.ok, false);
    const good = await reopenObligation(run, waiting.obligation.id, { reason: "signature bounced", source: src("m9", "origin"), by: "test" });
    assert.equal(good.ok, true);
    assert.equal(good.obligation.status, "open");
    assert.ok(good.obligation.source_message_ids.includes("m9"));

    // Evidence is required to resolve.
    const noEvidence = await resolveObligation(run, waiting.obligation.id, null, "test");
    assert.equal(noEvidence.ok, false);
    const list = await listObligations(run, { status: ["open", "waiting"] });
    assert.ok(list.some((o) => o.id === waiting.obligation.id));
  });
});

test("V18 the Central due_at snooze applies unchanged to obligation-created work items", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const run = runOver(client);
    const dueLater = new Date(Date.now() + 5 * 86400e3).toISOString();
    const r = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-due", provider: "gmail", title: "Scheduled", body: "b", dueAt: dueLater, createdBy: "inbox-cron" });
    const w = await wi(client, r.id);
    const expected = (await client.query(`SELECT work_item_due_day_start($1::timestamptz) AS d`, [dueLater])).rows[0].d;
    assert.equal(new Date(w.snoozed_until).getTime(), new Date(expected).getTime(), "snoozed to 00:00 America/Chicago of the due day");
    assert.equal(w.promoted_at, null);
    const chicagoMidnight = new Date(expected).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false });
    assert.match(chicagoMidnight, /^(00|24):00:00$/);

    const today = await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-today", provider: "gmail", title: "Now", body: "b", dueAt: new Date().toISOString(), createdBy: "inbox-cron" });
    assert.equal((await wi(client, today.id)).snoozed_until, null);
    // A refresh never moves due_at, so the snooze stays exactly as the trigger set it.
    await refreshSourcedWorkItem(run, { sourceKind: "email", sourceId: "thr-due", provider: "gmail", title: "Scheduled", body: "b2", dueAt: null, createdBy: "inbox-cron" });
    const w2 = await wi(client, r.id);
    assert.equal(new Date(w2.due_at).toISOString(), new Date(dueLater).toISOString());
    assert.equal(new Date(w2.snoozed_until).getTime(), new Date(expected).getTime());
  });
});

test("inbox batch script + read-only collision report", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    await seedLead(client, "zz-batch-lead");
    const batch = normalizeBatch([
      { title: "Reply to Larson", body: "deck", thread_id: "g-1", message_id: "g-1-m1", lead_slug: "zz-batch-lead", priority: "high" },
      { title: "Reply to Larson", body: "other", thread_id: "g-2" },
      { title: "No id at all", body: "?" },
    ]);
    await client.query("BEGIN");
    const r1 = await applyBatch(client, batch);
    await client.query("COMMIT");
    assert.deepEqual(r1.map((r) => r.action), ["created", "created", "review"]);
    await client.query(`UPDATE work_items SET priority = 'urgent', status = 'in_progress' WHERE id = $1`, [r1[0].id]);
    await client.query("BEGIN");
    const r2 = await applyBatch(client, batch);
    await client.query("COMMIT");
    assert.deepEqual(r2.map((r) => r.action), ["refreshed", "refreshed", "refreshed"]);
    assert.equal(r2[0].id, r1[0].id);
    const w = await wi(client, r1[0].id);
    assert.equal(w.priority, "urgent");
    assert.equal(w.status, "in_progress");
    const before = (await client.query(`SELECT count(*)::int AS n FROM work_items`)).rows[0].n;
    const report = await collisionReport(client);
    assert.equal(report.sameTitle.length, 1);
    assert.equal(report.sameTitle[0].n, 2);
    assert.equal(report.sameTitle[0].sources, 2, "flagged as distinct");
    const after = (await client.query(`SELECT count(*)::int AS n FROM work_items`)).rows[0].n;
    assert.equal(before, after, "report changed nothing");
  });
});
