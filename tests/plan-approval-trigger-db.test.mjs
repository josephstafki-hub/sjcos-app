import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { onClientPlanApproved } from "../lib/agent-runtime/hooks.ts";
import { assembleScopedContext } from "../lib/agent-runtime/context.ts";

// Mahowald, 2026-10-14: Libby approved floor plan v4 in the portal on Oct 9,
// but no agent could see it — a stale "waiting on client" card won and the
// permit brief called the plan pending. The approval now wakes the agent once,
// and every agent's context shows the Floor-tab approvals.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("client floor-plan approval: one selection trigger, visible in agent context", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`TRUNCATE agent_triggers RESTART IDENTITY CASCADE`).catch(() => {});
    await client.query(`DELETE FROM projects WHERE slug = 'zz-plan-ok'`);
    const [p] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-plan-ok', 'ZZ Plan', 'construction_contract', 'ZZ') RETURNING id`);
    await run(`INSERT INTO files (id, project_key, type, name, storage_path) VALUES ('fp-zz-1', 'zz-plan-ok', 'doc', 'v3.pdf', 'x'), ('fp-zz-2', 'zz-plan-ok', 'doc', 'v4.pdf', 'y') ON CONFLICT DO NOTHING`);
    const [v3] = await run(`INSERT INTO project_floorplans (project_id, version, file_id, notes, published_at) VALUES ($1, 3, 'fp-zz-1', 'Version 3', now()) RETURNING id`, [p.id]);
    const [v4] = await run(`INSERT INTO project_floorplans (project_id, version, file_id, notes, published_at, client_approved_at, client_approved_name) VALUES ($1, 4, 'fp-zz-2', 'Version 4', now(), now(), 'ZZ Client') RETURNING id`, [p.id]);

    assert.equal(await onClientPlanApproved(run, Number(v3.id)), null, "an unapproved version wakes nothing");
    const t1 = await onClientPlanApproved(run, Number(v4.id));
    assert.equal(t1.kind, "selection");
    assert.equal(t1.ref, `floorplan:${v4.id}:approved`);
    await onClientPlanApproved(run, Number(v4.id));
    assert.equal((await run(`SELECT count(*)::int AS n FROM agent_triggers WHERE ref LIKE 'floorplan:%'`))[0].n, 1, "idempotent");

    const ctx = await assembleScopedContext(run, { projectId: p.id, leadId: null });
    assert.match(ctx.text, /v4 "Version 4" — CLIENT APPROVED \d{4}-\d{2}-\d{2} by ZZ Client/);
    assert.match(ctx.text, /v3 "Version 3" — shared with client .*not approved/);
  });
});
