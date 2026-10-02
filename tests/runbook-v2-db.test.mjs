import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, loadSchema } from "./_harness/testdb.mjs";
import {
  startRunbookTx, advanceRunbookTx, repairRunbookInstancesTx, cancelRunbookInstanceTx, claimWakeups, finishWakeup, loadPinnedDefinition,
} from "../lib/completion/runbook-core.ts";

// A02 — transactional runbook start / advance / repair against a REAL
// disposable Postgres (VALIDATION.md V03). Skipped only when the postgres
// binaries are missing — never redirected at production.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

// Own database per test FILE on the shared harness cluster: node --test runs
// files in parallel and the foundation tests truncate shared tables, so a
// shared sjcos_test would race. Created once per file, cleaned per test.
const OWN_DB = "sjcos_test_runbook_v2";
let ownUrl = null;
async function withDb(fn) {
  if (!ownUrl) {
    ownUrl = withTestDb(async (url) => {
      const admin = url.replace(/\/[^/?]+\?/, "/postgres?");
      const own = url.replace(/\/[^/?]+\?/, `/${OWN_DB}?`);
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


/** A tx runner over a fresh client each call (real COMMIT/ROLLBACK). An
 *  optional `dieAfter` throws inside the transaction after that many
 *  statements — the "process death at every write boundary" probe. */
function txOver(url, { dieAfter = null } = {}) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    let n = 0;
    const run = async (sql, params) => {
      const rows = (await c.query(sql, params)).rows;
      n++;
      if (dieAfter != null && n >= dieAfter) throw new Error(`simulated death after statement ${n}`);
      return rows;
    };
    try {
      await c.query("BEGIN");
      const out = await fn(run);
      await c.query("COMMIT");
      return { out, statements: n };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      await c.end();
    }
  };
}

async function clean(client) {
  await client.query(`TRUNCATE work_items, obligations, runbook_instances, runbook_repairs, agent_runs, agent_receipts RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM runbook_definition_versions WHERE runbook_slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM runbooks WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM leads WHERE slug LIKE 'zz-%'`);
}

async function seed(client) {
  const lead = (await client.query(`INSERT INTO leads (slug, name) VALUES ('zz-rb-lead', 'ZZ Runbook Lead') RETURNING id`)).rows[0].id;
  const rb = (await client.query(`INSERT INTO runbooks (slug, title) VALUES ('zz-runbook', 'ZZ Runbook') RETURNING id`)).rows[0].id;
  await client.query(
    `INSERT INTO runbook_steps (runbook_id, step_order, title, expected_output, requires_human_approval, assigned_to, required_evidence) VALUES
       ($1, 1, 'Triage', 'a verdict', false, 'agent', 'any'),
       ($1, 2, 'Draft reply', 'a draft', false, 'agent', 'draft'),
       ($1, 3, 'Site visit', 'notes', false, 'human', 'any')`,
    [rb],
  );
  return { lead, rb };
}

const counts = async (client, instanceId) => ({
  items: (await client.query(`SELECT count(*)::int AS n FROM work_items WHERE runbook_instance_id = $1`, [instanceId])).rows[0].n,
  logs: (await client.query(`SELECT count(*)::int AS n FROM runbook_steps_log WHERE instance_id = $1`, [instanceId])).rows[0].n,
  wakeups: (await client.query(`SELECT count(*)::int AS n FROM runbook_wakeups WHERE instance_id = $1`, [instanceId])).rows[0].n,
});

test("V03 concurrent start creates one instance; start is atomic under death at every write", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const { lead } = await seed(client);

    // Death at every statement boundary: nothing is left behind.
    const probe = await txOver(url)((run) => startRunbookTx(run, "zz-runbook", { leadId: lead }, "probe"));
    assert.equal(probe.out.ok, true);
    const total = probe.statements;
    await client.query(`DELETE FROM runbook_instances`);
    await client.query(`DELETE FROM work_items`);
    for (let k = 1; k < total; k++) {
      await assert.rejects(txOver(url, { dieAfter: k })((run) => startRunbookTx(run, "zz-runbook", { leadId: lead }, "dying")), /simulated death/);
      const left = (await client.query(`SELECT (SELECT count(*) FROM runbook_instances) + (SELECT count(*) FROM work_items) + (SELECT count(*) FROM runbook_steps_log) + (SELECT count(*) FROM runbook_wakeups) AS n`)).rows[0].n;
      assert.equal(Number(left), 0, `death after statement ${k} of ${total} left rows behind`);
    }

    // Five simultaneous starts → exactly one instance, one step, one wakeup.
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => txOver(url)((run) => startRunbookTx(run, "zz-runbook", { leadId: lead }, `starter-${i}`))));
    const oks = results.filter((r) => r.out.ok);
    assert.equal(oks.length, 1, "exactly one start wins");
    assert.ok(results.filter((r) => !r.out.ok).every((r) => /already running/.test(r.out.error)));
    const instanceId = oks[0].out.instanceId;
    assert.deepEqual(await counts(client, instanceId), { items: 1, logs: 1, wakeups: 1 });
    const inst = (await client.query(`SELECT * FROM runbook_instances WHERE id = $1`, [instanceId])).rows[0];
    assert.ok(inst.definition_version_id, "pinned a definition version");
    assert.equal(inst.policy_version, "def@1");
    assert.equal(inst.current_step, 1);
    const def = await loadPinnedDefinition((sql, p) => client.query(sql, p).then((r) => r.rows), inst.definition_version_id);
    assert.equal(def.steps.length, 3);
    assert.equal(def.steps[1].requiredEvidence, "draft");
  });
});

test("V03 concurrent advance creates one successor; death at every write strands nothing; edited definition does not alter the live instance", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const { lead, rb } = await seed(client);
    const start = await txOver(url)((run) => startRunbookTx(run, "zz-runbook", { leadId: lead }, "test"));
    const instanceId = start.out.instanceId;

    // Not done yet → waiting, no successor.
    const wait = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(wait.out.outcome, "waiting");
    assert.deepEqual(await counts(client, instanceId), { items: 1, logs: 1, wakeups: 1 });

    // The definition is edited mid-run: step 2 renamed, a step 4 added.
    await client.query(`UPDATE runbook_steps SET title = 'RENAMED', required_evidence = 'any' WHERE runbook_id = $1 AND step_order = 2`, [rb]);
    await client.query(`INSERT INTO runbook_steps (runbook_id, step_order, title) VALUES ($1, 4, 'Bonus step')`, [rb]);

    await client.query(`UPDATE work_items SET status = 'done', completed_at = now() WHERE runbook_instance_id = $1 AND runbook_step_order = 1`, [instanceId]);

    // Death at every write boundary while advancing: state never moves.
    const probe = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(probe.out.outcome, "advanced");
    const total = probe.statements;
    // Undo the successful probe so the death loop starts from step 1 done.
    await client.query(`DELETE FROM work_items WHERE runbook_instance_id = $1 AND runbook_step_order = 2`, [instanceId]);
    await client.query(`DELETE FROM runbook_steps_log WHERE instance_id = $1 AND step_order = 2`, [instanceId]);
    await client.query(`DELETE FROM runbook_wakeups WHERE instance_id = $1 AND step_order = 2`, [instanceId]);
    await client.query(`UPDATE runbook_instances SET current_step = 1, status = 'running' WHERE id = $1`, [instanceId]);
    for (let k = 1; k < total; k++) {
      await assert.rejects(txOver(url, { dieAfter: k })((run) => advanceRunbookTx(run, instanceId)), /simulated death/);
      assert.deepEqual(await counts(client, instanceId), { items: 1, logs: 1, wakeups: 1 }, `death after statement ${k} of ${total}`);
      assert.equal((await client.query(`SELECT current_step FROM runbook_instances WHERE id = $1`, [instanceId])).rows[0].current_step, 1);
    }

    // Five concurrent advances → exactly one successor.
    const results = await Promise.all(Array.from({ length: 5 }, () => txOver(url)((run) => advanceRunbookTx(run, instanceId))));
    assert.equal(results.filter((r) => r.out.outcome === "advanced").length, 1);
    assert.deepEqual(await counts(client, instanceId), { items: 2, logs: 2, wakeups: 2 });
    const step2 = (await client.query(`SELECT title, body FROM work_items WHERE runbook_instance_id = $1 AND runbook_step_order = 2`, [instanceId])).rows[0];
    assert.match(step2.title, /step 2: Draft reply$/, "pinned title, not the edited one");
    assert.match(step2.body, /step 2 of 3/, "pinned step count, not the edited one");
    assert.match(step2.body, /Completion evidence required: draft/);

    // Step 2 marked done WITHOUT its required draft evidence: refused, not advanced.
    await client.query(`UPDATE work_items SET status = 'done', completed_at = now() WHERE runbook_instance_id = $1 AND runbook_step_order = 2`, [instanceId]);
    const noEvidence = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(noEvidence.out.outcome, "evidence_missing");
    assert.deepEqual(await counts(client, instanceId), { items: 2, logs: 2, wakeups: 2 });
    assert.match((await client.query(`SELECT blocked_reason FROM runbook_instances WHERE id = $1`, [instanceId])).rows[0].blocked_reason, /no 'draft' evidence/);
    // With a draft receipt it advances to the human step 3.
    const wi2 = (await client.query(`SELECT id FROM work_items WHERE runbook_instance_id = $1 AND runbook_step_order = 2`, [instanceId])).rows[0].id;
    await client.query(`INSERT INTO agent_receipts (work_item_id, receipt_kind, label) VALUES ($1, 'draft', 'test draft')`, [wi2]);
    const adv3 = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(adv3.out.outcome, "advanced");
    assert.equal(adv3.out.stepOrder, 3);
    const inst3 = (await client.query(`SELECT status, blocked_reason FROM runbook_instances WHERE id = $1`, [instanceId])).rows[0];
    assert.equal(inst3.status, "waiting_human");
    assert.equal(inst3.blocked_reason, null);
    const wk = (await client.query(`SELECT kind FROM runbook_wakeups WHERE instance_id = $1 AND step_order = 3`, [instanceId])).rows[0];
    assert.equal(wk.kind, "owner_notify");

    // Finishing step 3 completes the instance — the edited-in step 4 does not exist for it.
    await client.query(`UPDATE work_items SET status = 'done', completed_at = now() WHERE runbook_instance_id = $1 AND runbook_step_order = 3`, [instanceId]);
    const fin = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(fin.out.outcome, "done");
    assert.deepEqual(await counts(client, instanceId), { items: 3, logs: 3, wakeups: 3 });
    const again = await txOver(url)((run) => advanceRunbookTx(run, instanceId));
    assert.equal(again.out.outcome, "noop");

    // Wakeup outbox: claim marks attempts, finish marks sent; a re-claim finds nothing pending.
    const claimed = await txOver(url)((run) => claimWakeups(run, 10));
    assert.equal(claimed.out.length, 3);
    for (const w of claimed.out) await txOver(url)((run) => finishWakeup(run, w.id, true));
    const again2 = await txOver(url)((run) => claimWakeups(run, 10));
    assert.equal(again2.out.length, 0);
  });
});

test("V03 repair: dry-run vs real recreates only the missing step; legacy/missing definitions go to needs_review, never done", { skip }, async () => {
  await withDb(async (url, client) => {
    await clean(client);
    const { lead } = await seed(client);
    const start = await txOver(url)((run) => startRunbookTx(run, "zz-runbook", { leadId: lead }, "test"));
    const instanceId = start.out.instanceId;
    // Simulate the stranded state: the step-1 work item vanished.
    await client.query(`DELETE FROM work_items WHERE runbook_instance_id = $1`, [instanceId]);
    assert.equal((await client.query(`SELECT work_item_id FROM runbook_steps_log WHERE instance_id = $1`, [instanceId])).rows[0].work_item_id, null);

    const dry = await txOver(url)((run) => repairRunbookInstancesTx(run, { dryRun: true }));
    assert.equal(dry.out.scanned, 1);
    assert.deepEqual(dry.out.actions.map((a) => a.action), ["recreate_step"]);
    assert.equal((await counts(client, instanceId)).items, 0, "dry-run created nothing");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM runbook_repairs WHERE dry_run`)).rows[0].n, 1, "dry-run is logged");

    const real = await txOver(url)((run) => repairRunbookInstancesTx(run, { dryRun: false, by: "test" }));
    assert.deepEqual(real.out.actions.map((a) => a.action), ["recreate_step"]);
    assert.ok(real.out.actions[0].workItemId);
    const c = await counts(client, instanceId);
    assert.equal(c.items, 1);
    assert.equal(c.logs, 1, "no duplicate log row");
    assert.equal((await client.query(`SELECT work_item_id FROM runbook_steps_log WHERE instance_id = $1`, [instanceId])).rows[0].work_item_id, real.out.actions[0].workItemId);
    assert.equal((await client.query(`SELECT repair_state FROM runbook_instances WHERE id = $1`, [instanceId])).rows[0].repair_state, "repaired");
    const rerun = await txOver(url)((run) => repairRunbookInstancesTx(run, { dryRun: false }));
    assert.equal(rerun.out.scanned, 0, "replay-safe");

    // A legacy instance with no pinned version: advance and repair both refuse to guess.
    const legacy = (await client.query(
      `INSERT INTO runbook_instances (runbook_id, runbook_slug, lead_id, started_by, current_step, status)
       SELECT id, slug, $1, 'legacy', 1, 'running' FROM runbooks WHERE slug = 'daily-sjc-operations-review' RETURNING id`,
      [lead],
    )).rows[0].id;
    await client.query(`UPDATE work_items SET status = 'done' WHERE runbook_instance_id = $1`, [legacy]);
    const adv = await txOver(url)((run) => advanceRunbookTx(run, legacy));
    assert.equal(adv.out.outcome, "needs_review");
    const rep = await txOver(url)((run) => repairRunbookInstancesTx(run, { dryRun: false }));
    assert.deepEqual(rep.out.actions.map((a) => a.action), ["needs_review"]);
    const l = (await client.query(`SELECT status, repair_state, blocked_reason FROM runbook_instances WHERE id = $1`, [legacy])).rows[0];
    assert.equal(l.status, "running", "never falsely completed");
    assert.equal(l.repair_state, "needs_review");
    assert.match(l.blocked_reason, /pinned definition/);

    // Cancel closes the open step items and voids pending wakeups.
    const ok = await txOver(url)((run) => cancelRunbookInstanceTx(run, instanceId, "test cancel"));
    assert.equal(ok.out, true);
    assert.equal((await client.query(`SELECT status FROM work_items WHERE runbook_instance_id = $1`, [instanceId])).rows[0].status, "cancelled");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM runbook_wakeups WHERE instance_id = $1 AND state = 'pending'`, [instanceId])).rows[0].n, 0);
  });
});

test("migration 0003 backfill pinned every seeded runbook", { skip }, async () => {
  await withDb(async (url, client) => {
    const missing = (await client.query(
      `SELECT r.slug FROM runbooks r WHERE r.slug NOT LIKE 'zz-%' AND NOT EXISTS (SELECT 1 FROM runbook_definition_versions v WHERE v.runbook_slug = r.slug)`,
    )).rows;
    assert.deepEqual(missing, []);
    const v = (await client.query(`SELECT jsonb_array_length(steps) AS n, checksum FROM runbook_definition_versions WHERE runbook_slug = 'daily-sjc-operations-review'`)).rows[0];
    assert.equal(Number(v.n), 2);
    assert.match(v.checksum, /^[0-9a-f]{64}$/);
  });
});
