import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { verifyTelnyxSignature } from "../lib/comms/telnyx-signature.ts";
import { persistInbound, leaseEvent, processInline } from "../lib/worker/intake.ts";
import { runOnce, heartbeatSourceEvent } from "../lib/worker/loop.ts";
import { registerWorker, heartbeatWorker, getWorker } from "../lib/worker/registry.ts";
import { workerHealth } from "../lib/worker/health.ts";
import { recordCronRun, cronJobHealth } from "../lib/worker/cron-runs.ts";
import { deliver, fakeProcessor, ensureFakeTables, FAKE_PROVIDER } from "../lib/worker/fake-provider.ts";
import { claimSourceEvents, finishSourceEvent } from "../lib/commands/source-events.ts";
import { enqueueIntent, claimIntents, getIntentByKey } from "../lib/commands/intents.ts";
import { pauseLane, resumeLane } from "../lib/commands/policies.ts";

// A03b — V04 (intake), V07 (worker part), V12 (hung run) against the real
// disposable harness with the fake provider (lib/worker/fake-provider.ts).

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runner(client) {
  return async (sql, params) => (await client.query(sql, params)).rows;
}

async function freshWorker(run, instanceId = "test-1") {
  await registerWorker(run, { name: "sjcos-worker", instanceId, version: "test" });
  return { run, instanceId, version: "test", processors: [], limits: { idleSleepMs: 0, heartbeatMs: 100 } };
}

// ── V04: a bad signature cannot act ─────────────────────────────────────────
test("V04 intake: a bad or replayed signature is refused before anything is persisted", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const body = JSON.stringify({ data: { event_type: "message.received", id: "ev-1" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const good = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: good, publicKeyB64: pub }).ok, true);
  // tampered body
  assert.equal(verifyTelnyxSignature({ rawBody: body + " ", timestamp: ts, signature: good, publicKeyB64: pub }).ok, false);
  // wrong key
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: good, publicKeyB64: other }).ok, false);
  // replay (old timestamp)
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const oldSig = sign(null, Buffer.from(`${old}|${body}`), privateKey).toString("base64");
  const r = verifyTelnyxSignature({ rawBody: body, timestamp: old, signature: oldSig, publicKeyB64: pub });
  assert.equal(r.ok, false);
  assert.match(r.reason, /replay/);
  // The webhook persists only after ok=true — persistence with a failing run
  // is the "outage" case below; here nothing was even attempted.
});

test("V04 intake: persistence outage → no acceptance (503 semantics); duplicate → 200 without re-processing", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    const failing = async () => {
      throw new Error("connection refused");
    };
    const out = await persistInbound(failing, { provider: "telnyx", account: "acct", eventId: "e1", eventType: "message.received", payload: { a: 1 } });
    assert.equal(out.ok, false, "persistence failure surfaces as ok=false → route answers 503");
    const [{ n }] = await run(`SELECT count(*)::int AS n FROM source_events`);
    assert.equal(n, 0, "nothing persisted");

    const first = await persistInbound(run, { provider: "telnyx", account: "acct", eventId: "e1", eventType: "message.received", payload: { a: 1 } });
    assert.equal(first.ok && first.created, true);
    const dup = await persistInbound(run, { provider: "telnyx", account: "acct", eventId: "e1", eventType: "message.received", payload: { a: 1 } });
    assert.equal(dup.ok && dup.created, false, "duplicate receipt returns the existing row");
    // Another account with the same event id is a different event (account in the key).
    const otherAcct = await persistInbound(run, { provider: "telnyx", account: "acct-2", eventId: "e1", eventType: "message.received", payload: { a: 1 } });
    assert.equal(otherAcct.created, true);

    // Inline fast path takes the event under a lease; a second inline attempt is skipped.
    let calls = 0;
    const proc = { provider: "telnyx", process: async () => (calls++, { ok: true }) };
    assert.equal(await processInline(run, proc, first.event.id), "done");
    assert.equal(await processInline(run, proc, first.event.id), "skipped");
    assert.equal(calls, 1);
    const [row] = await run(`SELECT state FROM source_events WHERE id = $1`, [first.event.id]);
    assert.equal(row.state, "done");
  });
});

test("V04 intake: duplicate, late and out-of-order events converge by version; each effect exactly once", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    const deps = await freshWorker(run);
    const proc = fakeProcessor();
    deps.processors = [proc];
    // Arrival order: seq 3, seq 1, seq 2, then seq 1 AGAIN (late duplicate).
    const d = await deliver(run, "acct", [
      { eventId: "ev-3", eventType: "status", seq: 3, payload: { target: "t" } },
      { eventId: "ev-1", eventType: "status", seq: 1, payload: { target: "t" } },
      { eventId: "ev-2", eventType: "status", seq: 2, payload: { target: "t" } },
      { eventId: "ev-1", eventType: "status", seq: 1, payload: { target: "t" } },
    ]);
    assert.deepEqual(d, { created: 3, duplicates: 1 });
    const r = await runOnce(deps);
    assert.equal(r.error, null);
    assert.equal(r.source_events.claimed, 3);
    assert.equal(r.source_events.done, 3);
    const [t] = await run(`SELECT version, applied_events FROM fake_targets WHERE target = 't'`);
    assert.equal(t.version, 3, "final version is the newest seq, not the last arrival");
    assert.deepEqual([...proc.effects.values()], [1, 1, 1], "each event produced exactly one effect");
    // A very late re-delivery after processing: duplicate at intake, no worker work.
    const late = await deliver(run, "acct", [{ eventId: "ev-2", eventType: "status", seq: 2, payload: { target: "t" } }]);
    assert.equal(late.duplicates, 1);
    const r2 = await runOnce(deps);
    assert.equal(r2.source_events.claimed, 0);
    assert.equal(proc.effects.get("ev-2"), 1);
  });
});

test("V04 intake: a lost wakeup is recovered by polling; retryable failures back off and exhaust visibly", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    // Lost wakeup: a pending runbook_wakeups row older than the threshold and
    // no notification ever arrived. The loop's poll hands it to the drainer.
    const [inst] = await run(`INSERT INTO runbook_instances (runbook_slug) VALUES ('zz-test') RETURNING id`);
    await run(`INSERT INTO runbook_wakeups (instance_id, step_order, kind, created_at) VALUES ($1, 1, 'agent_ping', now() - interval '5 minutes')`, [inst.id]);
    const drained = [];
    const deps = await freshWorker(run);
    deps.limits.lostWakeupAfterSeconds = 30;
    deps.wakeupDrainer = async (limit) => {
      const rows = await run(`UPDATE runbook_wakeups SET state = 'sent', sent_at = now() WHERE state = 'pending' RETURNING id`);
      drained.push(...rows.map((r) => r.id));
      return { sent: Math.min(limit, rows.length), failed: 0 };
    };
    const r = await runOnce(deps);
    assert.equal(r.wakeups.pending, 1);
    assert.equal(r.wakeups.drained, 1);
    assert.equal(drained.length, 1);
    await run(`DELETE FROM runbook_instances WHERE id = $1`, [inst.id]);

    // Retry/backoff/exhaustion: fail ev-x twice then succeed; ev-y always fails.
    const proc = fakeProcessor({ failFirst: { "ev-x": 2 } });
    deps.processors = [proc];
    await deliver(run, "acct", [{ eventId: "ev-x", eventType: "status", seq: 1 }]);
    await run(`INSERT INTO source_events (provider, account, event_id, event_type, payload, payload_hash, verified, max_attempts)
               VALUES ($1, 'acct', 'ev-y', 'status', '{"boom":true}', 'h', true, 2)`, [FAKE_PROVIDER]);
    proc.process = ((orig) => async (ev, ctx) => (ev.event_id === "ev-y" ? { ok: false, error: "always", retryInSeconds: 0 } : orig(ev, ctx)))(proc.process);
    let r1 = await runOnce(deps);
    assert.equal(r1.source_events.failed, 2);
    let r2 = await runOnce(deps); // ev-x fails again (2nd), ev-y exhausts (max 2)
    assert.equal(r2.source_events.failed, 2);
    const [y] = await run(`SELECT state, attempts, last_error FROM source_events WHERE event_id = 'ev-y'`);
    assert.equal(y.state, "exhausted", "exhausted state is visible, not silently dropped");
    let r3 = await runOnce(deps); // ev-x succeeds on the 3rd attempt
    assert.equal(r3.source_events.done, 1);
    assert.equal(proc.attempts.get("ev-x"), 3);
    const h = await workerHealth(run);
    assert.equal(h.source_events.exhausted, 1);
    assert.ok(h.problems.some((p) => /exhausted/.test(p)), h.problems.join("; "));
  });
});

// ── V07: worker part ────────────────────────────────────────────────────────
test("V07 worker: latency with lease heartbeat completes; acceptance-then-timeout leaves the intent UNKNOWN, never retried", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    const deps = await freshWorker(run);
    const proc = fakeProcessor({ latencyMs: 150 });
    deps.processors = [proc];
    deps.limits.leaseSeconds = 30;
    await deliver(run, "acct", [{ eventId: "slow-1", eventType: "status", seq: 1 }]);
    const r = await runOnce(deps);
    assert.equal(r.source_events.done, 1, "slow provider still completes under a heartbeated lease");

    // An intent leased by a worker that died after transmitting: the lease
    // expires and the loop's sweep moves it to UNKNOWN (held), not pending.
    const { intent } = await enqueueIntent(run, { operationKey: "zz:send:1", kind: "send_email", recipient: "a@b.test", payload: { s: 1 }, principal: owner });
    const claimed = await claimIntents(run, { kinds: ["send_email"], leaseSeconds: 1, worker: "dead-worker" });
    assert.equal(claimed.intents.length, 1);
    await sleep(1200);
    const r2 = await runOnce(deps);
    assert.equal(r2.sweeps.intent_unknown, 1);
    const after = await getIntentByKey(run, "zz:send:1");
    assert.equal(after.state, "unknown");
    assert.equal(after.id, intent.id);
    const claimAgain = await claimIntents(run, { kinds: ["send_email"], worker: "w2" });
    assert.equal(claimAgain.intents.length, 0, "unknown intents are not re-dispatched");
    const h = await workerHealth(run);
    assert.ok(h.problems.some((p) => /UNKNOWN/.test(p)));
  });
});

test("V07 worker: a stale worker is fenced at both levels (instance id and lease token)", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    // Instance fencing: B registers under the same name; A's heartbeat and iteration are refused.
    const a = await freshWorker(run, "A");
    await registerWorker(run, { name: "sjcos-worker", instanceId: "B", version: "test" });
    assert.equal(await heartbeatWorker(run, { name: "sjcos-worker", instanceId: "A" }, "running"), false);
    const ra = await runOnce(a);
    assert.match(ra.error ?? "", /fenced/);
    const w = await getWorker(run, "sjcos-worker");
    assert.equal(w.instance_id, "B");

    // Lease fencing: a stale claim whose lease expired cannot finish the event
    // after the sweep re-issued it.
    await deliver(run, "acct", [{ eventId: "fence-1", eventType: "status", seq: 1 }]);
    const stale = await claimSourceEvents(run, { provider: FAKE_PROVIDER, leaseSeconds: 1 });
    assert.equal(stale.events.length, 1);
    await sleep(1200);
    assert.equal(await heartbeatSourceEvent(run, stale.events[0].id, stale.token, 30), false, "expired lease cannot be extended");
    const b = { run, instanceId: "B", version: "test", processors: [fakeProcessor()], limits: { idleSleepMs: 0 } };
    const rb = await runOnce(b);
    assert.equal(rb.sweeps.source_leases, 1);
    assert.equal(rb.source_events.done, 1);
    assert.equal(await finishSourceEvent(run, stale.events[0].id, stale.token, { ok: false, error: "late" }), false, "stale token is fenced");
    const [row] = await run(`SELECT state FROM source_events WHERE event_id = 'fence-1'`);
    assert.equal(row.state, "done");
  });
});

// ── V12: hung iteration ends visibly and recovers without duplicate actions ─
test("V12 worker: a hung processor ends the iteration visibly at the timeout; the next pass recovers with exactly one effect", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    const deps = await freshWorker(run);
    const hanging = fakeProcessor({ hang: new Set(["hang-1"]) });
    deps.processors = [hanging];
    deps.limits.iterationTimeoutMs = 300;
    deps.limits.leaseSeconds = 1;
    await deliver(run, "acct", [{ eventId: "hang-1", eventType: "status", seq: 1 }]);
    const r = await runOnce(deps);
    assert.equal(r.timed_out, true);
    assert.match(r.error, /exceeded 300ms/);
    const w = await getWorker(run, "sjcos-worker");
    assert.equal(w.state, "timed_out");
    assert.equal(w.last_result.timed_out, true, "failure signal is on the workers row");
    const h = await workerHealth(run);
    assert.ok(h.problems.some((p) => /timed out/.test(p)));

    await sleep(1200); // the abandoned lease expires
    const healthy = fakeProcessor();
    deps.processors = [healthy];
    const r2 = await runOnce(deps);
    assert.equal(r2.sweeps.source_leases, 1);
    assert.equal(r2.source_events.done, 1);
    assert.equal(healthy.effects.get("hang-1"), 1);
    assert.equal(hanging.effects.get("hang-1"), undefined, "the hung pass never produced an effect");
    const w2 = await getWorker(run, "sjcos-worker");
    assert.equal(w2.state, "idle");
  });
});

test("worker: lane pause ('agents' or 'all') and the stop file halt processing but keep heartbeating", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    await ensureFakeTables(run);
    const deps = await freshWorker(run);
    const proc = fakeProcessor();
    deps.processors = [proc];
    await deliver(run, "acct", [{ eventId: "p-1", eventType: "status", seq: 1 }]);
    await pauseLane(run, "agents", "test", "maintenance");
    const before = (await getWorker(run, "sjcos-worker")).heartbeat_at;
    await sleep(20);
    const r = await runOnce(deps);
    assert.deepEqual(r.paused, { reason: "agents lane paused: maintenance", by: "lane_pauses" });
    assert.equal(r.source_events.claimed, 0);
    const w = await getWorker(run, "sjcos-worker");
    assert.equal(w.state, "paused");
    assert.notEqual(w.heartbeat_at, before, "still heartbeating while paused");
    await resumeLane(run, "agents");

    const dir = mkdtempSync(path.join(tmpdir(), "sjc-stop-"));
    const stopFile = path.join(dir, "worker.stop");
    writeFileSync(stopFile, "");
    deps.stopFile = stopFile;
    const r2 = await runOnce(deps);
    assert.equal(r2.paused.by, "stop-file");
    rmSync(dir, { recursive: true, force: true });
    const r3 = await runOnce(deps);
    assert.equal(r3.paused, false);
    assert.equal(r3.source_events.done, 1);
  });
});

test("worker: leaseEvent takes exactly one pending event and the cron ledger counts consecutive rate-limit skips", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    const run = runner(client);
    const p = await persistInbound(run, { provider: "telnyx", account: "acct", eventId: "l1", eventType: "x", payload: {} });
    const l1 = await leaseEvent(run, p.event.id, 30);
    assert.ok(l1);
    assert.equal(await leaseEvent(run, p.event.id, 30), null, "second lease refused while the first is live");
    assert.equal(await finishSourceEvent(run, p.event.id, l1.token, { ok: true }), true);

    await run(`DELETE FROM cron_runs`);
    const t = new Date();
    await recordCronRun(run, { job: "lead thread sync", startedAt: t, ok: true });
    for (let i = 0; i < 4; i++) await recordCronRun(run, { job: "lead thread sync", startedAt: new Date(t.getTime() + 1000 * (i + 1)), ok: false, errorClass: "rate_limited", error: "429" });
    await recordCronRun(run, { job: "detect", startedAt: t, ok: false, errorClass: "failed", error: "boom" });
    const h = await cronJobHealth(run);
    const sync = h.find((j) => j.job === "lead thread sync");
    assert.equal(sync.consecutive_rate_limit_skips, 4);
    assert.equal(sync.last_ok_at !== null, true);
    const wh = await workerHealth(run);
    assert.ok(wh.problems.some((x) => /4 consecutive rate-limit skips/.test(x)), wh.problems.join("; "));
  });
});
