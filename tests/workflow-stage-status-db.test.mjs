import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { ensureProjectWorkflow } from "../lib/workflow/engine.ts";

// 0054: a job's workflow stage follows its status forward, never back.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("workflow stage follows the project status forward; an event-set later stage is kept; new rows start where the status is", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-stage%'`);
    const stage = async (id) => (await run(`SELECT stage FROM project_workflows WHERE project_id = $1`, [id]))[0]?.stage ?? null;

    const [a] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-stage-a', 'ZZ A', 'precon_signed', 'ZZ') RETURNING id`);
    assert.equal((await ensureProjectWorkflow(run, a.id)).stage, "W02", "a new row starts at the status's stage, not W01");
    await run(`UPDATE projects SET status = 'bidding' WHERE id = $1`, [a.id]);
    assert.equal(await stage(a.id), "W06");
    await run(`UPDATE projects SET status = 'construction' WHERE id = $1`, [a.id]);
    assert.equal(await stage(a.id), "W10");
    // An event already moved it on (snag → W11): a status that implies W10 doesn't pull it back.
    await run(`UPDATE project_workflows SET stage = 'W11' WHERE project_id = $1`, [a.id]);
    await run(`UPDATE projects SET status = 'construction_contract' WHERE id = $1`, [a.id]);
    assert.equal(await stage(a.id), "W11");
    await run(`UPDATE projects SET status = 'warranty' WHERE id = $1`, [a.id]);
    assert.equal(await stage(a.id), "done");
    const ev = await run(`SELECT stage_before, stage_after FROM project_workflow_events WHERE project_id = $1 AND kind = 'stage_from_status' ORDER BY id`, [a.id]);
    assert.deepEqual(ev.map((e) => `${e.stage_before}>${e.stage_after}`), ["W02>W06", "W06>W10", "W11>done"]);

    // A job with no workflow row gets one when its status moves.
    const [b] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-stage-b', 'ZZ B', 'selections', 'ZZ') RETURNING id`);
    assert.equal(await stage(b.id), null);
    await run(`UPDATE projects SET status = 'construction' WHERE id = $1`, [b.id]);
    assert.equal(await stage(b.id), "W10");
  });
});
