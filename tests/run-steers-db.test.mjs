// Steering a live run (lib/run-steers.ts), against a REAL Postgres — the
// disposable test cluster, never the live database:
//
//   FIN_TEST_DATABASE_URL=$(node scripts/test-db.mjs url | cut -d= -f2-) node --test tests/run-steers-db.test.mjs
//
// Skipped without that variable. The module runs its own transactions (the
// accept/close race is the point), so rows are created under ZZ-tagged
// conversations and deleted at the end rather than rolled back.
//
// Checked:
//   1. A steer on a live run lands with its transcript line (steer = true);
//      taking it marks it delivered with how.
//   2. After closeSteering() a steer is refused — or goes to the live
//      follow-up run in the same thread when there is one.
//   3. THE promise, under a real race: every steer is either refused or
//      handed back by closeSteering(). Never accepted-and-stranded.
//   4. relaySteers() hands pending steers to an open takeover run only.
//   5. settleSteeredRun(): late steers get a follow-up turn, their lines move
//      after the answer, and the run settles; a stopped run is left alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { assertNotProduction } from "./_harness/testdb.mjs";

const url = process.env.FIN_TEST_DATABASE_URL;
const root = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root);
      for (const ext of ["", ".ts", ".tsx", ".mjs", "/index.ts"]) {
        const u = new URL(base.href + ext);
        if (existsSync(u) && !u.pathname.endsWith("/")) return { url: u.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(u, context, next) {
    if (u === "stub:server-only") return { format: "module", source: "", shortCircuit: true };
    return next(u, context);
  },
});

const skip = !url && "set FIN_TEST_DATABASE_URL to run";

test("run steers: accept, refuse after close, never stranded, relay, settle", { skip }, async () => {
  assertNotProduction(url);
  process.env.DATABASE_URL = url;
  const steers = await import(new URL("lib/run-steers.ts", root).href);
  const { pool, query, queryOne } = await import(new URL("lib/db.ts", root).href);
  const rows = async (sql, params) => (await query(sql, params)).rows;

  const conv = async () =>
    (await queryOne(`INSERT INTO ai_conversations (agent, title) VALUES ('hermes', 'ZZ steer test') RETURNING id`)).id;
  const run = async (conversationId, status = "running") =>
    (
      await queryOne(
        `INSERT INTO dev_agent_runs (agent, prompt, status, conversation_id) VALUES ('hermes', 'zz', $2, $1) RETURNING id`,
        [conversationId, status],
      )
    ).id;

  try {
    // ── 1. accept + take ─────────────────────────────────────────────────
    const c1 = await conv();
    const r1 = await run(c1);
    const a = await steers.enqueueSteer(r1, "  use the Larson project instead  ");
    assert.equal(a.ok, true);
    assert.equal(a.runId, r1);
    const [line] = await rows(`SELECT role, body, steer FROM ai_messages WHERE id = $1`, [a.messageId]);
    assert.deepEqual(line, { role: "user", body: "use the Larson project instead", steer: true });
    assert.equal(await steers.hasPendingSteers(r1), true);
    const taken = await steers.takePendingSteers(r1, "mid-turn");
    assert.deepEqual(taken.map((t) => t.body), ["use the Larson project instead"]);
    assert.equal(await steers.hasPendingSteers(r1), false);
    assert.deepEqual(
      (await steers.steersForRun(r1)).map((s) => [s.status, s.via]),
      [["delivered", "mid-turn"]],
    );
    // Released (the runtime couldn't take it this tick) → pending again.
    await steers.releaseSteers(taken.map((t) => t.id));
    assert.equal(await steers.hasPendingSteers(r1), true);

    // ── 2. close: leftovers handed back, later steers refused / forwarded ─
    const left = await steers.closeSteering(r1);
    assert.deepEqual(left.map((t) => t.body), ["use the Larson project instead"]);
    assert.deepEqual(await steers.enqueueSteer(r1, "too late"), { ok: false, finished: true });
    const r1b = await run(c1); // the follow-up turn in the same thread
    const fwd = await steers.enqueueSteer(r1, "for the follow-up");
    assert.equal(fwd.ok, true);
    assert.equal(fwd.runId, r1b, "a steer that missed the closed run goes to the live one in its thread");
    await steers.reopenSteering(r1);
    assert.equal((await steers.enqueueSteer(r1, "reopened")).ok, true);
    // A settled run takes nothing even if never closed.
    const r1c = await run(c1, "done");
    const c1other = await conv();
    await query(`UPDATE dev_agent_runs SET conversation_id = $2 WHERE id = $1`, [r1c, c1other]);
    assert.deepEqual(await steers.enqueueSteer(r1c, "x"), { ok: false, finished: true });

    // ── 3. the race: refused, or returned by close — never stranded ──────
    for (let i = 0; i < 40; i++) {
      const c = await conv();
      const r = await run(c);
      const delay = (ms) => new Promise((res) => setTimeout(res, ms));
      const [enq, closed] = await Promise.all([
        delay(i % 3).then(() => steers.enqueueSteer(r, `race ${i}`)),
        delay((i + 1) % 3).then(() => steers.closeSteering(r)),
      ]);
      const stillPending = await steers.hasPendingSteers(r);
      assert.equal(stillPending, false, `iteration ${i}: a steer was stranded on a closed run`);
      if (enq.ok) assert.deepEqual(closed.map((t) => t.body), [`race ${i}`], `iteration ${i}: accepted but not handed back`);
      else assert.deepEqual(enq, { ok: false, finished: true });
    }

    // ── 4. relay to a takeover ───────────────────────────────────────────
    const c4 = await conv();
    const parent = await run(c4);
    const takeover = await run(null);
    await steers.enqueueSteer(parent, "tell the takeover");
    assert.equal(await steers.relaySteers(parent, takeover), 1);
    assert.deepEqual((await steers.takePendingSteers(takeover, "mid-turn")).map((t) => t.body), ["tell the takeover"]);
    await steers.enqueueSteer(parent, "after takeover closed");
    await steers.closeSteering(takeover);
    assert.equal(await steers.relaySteers(parent, takeover), 0, "a closed takeover takes no relays");
    assert.equal(await steers.hasPendingSteers(parent), true, "…so the steer stays with the parent run");

    // ── 5. settle with late steers ───────────────────────────────────────
    const c5 = await conv();
    const r5 = await run(c5);
    await query(`INSERT INTO ai_messages (conversation_id, role, body) VALUES ($1, 'user', 'do the thing')`, [c5]);
    await steers.enqueueSteer(r5, "late one");
    await steers.enqueueSteer(r5, "late two");
    let followed = null;
    const ok = await steers.settleSteeredRun({
      runId: r5,
      conversationId: c5,
      agent: "hermes",
      status: "done",
      answer: "did the thing",
      followUp: async (p) => {
        followed = p;
      },
    });
    assert.equal(ok, true);
    assert.match(followed, /arrived too late for that answer/);
    assert.match(followed, /late one\n\nlate two/);
    const order = await rows(`SELECT role, body, steer FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at`, [c5]);
    assert.deepEqual(
      order.map((m) => m.body),
      ["do the thing", "did the thing", "late one", "late two"],
      "late steers read after the answer they missed",
    );
    const [settled] = await rows(`SELECT status, answer, steer_closed_at IS NOT NULL AS closed FROM dev_agent_runs WHERE id = $1`, [r5]);
    assert.deepEqual(settled, { status: "done", answer: "did the thing", closed: true });
    assert.deepEqual(
      (await steers.steersForRun(r5)).map((s) => s.via),
      ["follow-up", "follow-up"],
    );

    // A run Joe stopped is left alone: no answer line, no follow-up.
    const c6 = await conv();
    const r6 = await run(c6, "error");
    let called = false;
    const ok6 = await steers.settleSteeredRun({
      runId: r6,
      conversationId: c6,
      agent: "hermes",
      status: "done",
      answer: "late answer",
      followUp: async () => {
        called = true;
      },
    });
    assert.equal(ok6, false);
    assert.equal(called, false);
    assert.equal((await rows(`SELECT 1 FROM ai_messages WHERE conversation_id = $1`, [c6])).length, 0);
  } finally {
    await query(`DELETE FROM ai_conversations WHERE title = 'ZZ steer test'`);
    await query(`DELETE FROM dev_agent_runs WHERE prompt = 'zz'`);
    await pool.end();
  }
});
