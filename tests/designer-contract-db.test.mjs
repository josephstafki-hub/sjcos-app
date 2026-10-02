import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, cleanField, seedField } from "./field-fixtures.mjs";
import { emptyDoc, MAIN_LEVEL_ID } from "../lib/plan-doc.ts";
import { rectWalls, withRooms } from "../lib/plan-geometry.ts";
import { designQuantitiesForEstimate, resolveDesignRef, pinDesignVersion, designSharingFor, designVersionPinned } from "../lib/designer-contract.ts";
import { ingestDesignerActivity } from "../lib/owner-time/designer.ts";

// V26: design revisions survive save/export/reopen; quantities and time
// events identify the correct revision/job; a version cannot be read through
// another design; portal sharing is by published version only.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const L = MAIN_LEVEL_ID;

function kitchen() {
  const doc = emptyDoc();
  doc.walls = rectWalls(L, { x: 0, y: 0 }, { x: 144, y: 120 }, 4.5, 96, "existing");
  doc.walls.push({ id: "part", levelId: L, a: { x: 72, y: 0 }, b: { x: 72, y: 120 }, thickIn: 4.5, heightIn: 96, kind: "new" });
  return withRooms(doc);
}

test("V26 designer contract: immutable version → stable revision + quantities; live edits do not move it; activity events resolve the job server-side; sharing by published version", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await cleanField(client);
    const f = await seedField(client);
    const run = runOf(client);
    const doc = kitchen();
    const [d] = await run(`INSERT INTO plan_designs (project_id, name, doc, rev) VALUES ($1, 'zz-kitchen', $2::jsonb, 3) RETURNING id`, [f.p1, JSON.stringify(doc)]);
    const designId = Number(d.id);
    // Live doc is not an estimate source.
    const live = await designQuantitiesForEstimate(run, designId, null);
    assert.match(live.error, /saved version/);
    // Save version 1 (what savePlanVersion writes).
    const [v1] = await run(`INSERT INTO plan_design_versions (design_id, number, label, doc) VALUES ($1, 1, 'Site measured', $2::jsonb) RETURNING id`, [designId, JSON.stringify(doc)]);
    const q1 = await designQuantitiesForEstimate(run, designId, Number(v1.id));
    assert.ok(!q1.error);
    assert.equal(q1.ref.projectId, f.p1);
    assert.match(q1.ref.revision, new RegExp(`^design:${designId}@v1#[0-9a-f]{12}$`));
    const wall = q1.items.find((i) => i.key === "wall_new_lf");
    assert.equal(wall.quantity, 10);
    assert.equal(wall.unit, "lf");
    assert.equal(wall.verified, false, "drawn dimensions are assumptions until field-verified");
    assert.equal(wall.revision, q1.ref.revision);
    for (const i of q1.items) assert.equal(i.revision, q1.ref.revision);
    // Edit the live doc (add a wall, bump rev): the version's quantities and revision are unchanged (reopen/export safe).
    const edited = kitchen();
    edited.walls.push({ id: "part2", levelId: L, a: { x: 36, y: 0 }, b: { x: 36, y: 120 }, thickIn: 4.5, heightIn: 96, kind: "new" });
    await run(`UPDATE plan_designs SET doc = $2::jsonb, rev = rev + 1 WHERE id = $1`, [designId, JSON.stringify(withRooms(edited))]);
    const q1b = await designQuantitiesForEstimate(run, designId, Number(v1.id));
    assert.equal(q1b.ref.revision, q1.ref.revision);
    assert.equal(q1b.provenance, q1.provenance);
    // Version 2 from the edited doc → a different revision and more wall.
    const [v2] = await run(`INSERT INTO plan_design_versions (design_id, number, label, doc) VALUES ($1, 2, 'Added partition', $2::jsonb) RETURNING id`, [designId, JSON.stringify(withRooms(edited))]);
    const q2 = await designQuantitiesForEstimate(run, designId, Number(v2.id));
    assert.notEqual(q2.ref.revision, q1.ref.revision);
    assert.equal(q2.items.find((i) => i.key === "wall_new_lf").quantity, 20);
    // A version cannot be read through another design id.
    const [other] = await run(`INSERT INTO plan_designs (project_id, name, doc) VALUES ($1, 'zz-other', '{}'::jsonb) RETURNING id`, [f.p2]);
    assert.equal(await resolveDesignRef(run, Number(other.id), Number(v1.id)), null);
    assert.match((await designQuantitiesForEstimate(run, Number(other.id), Number(v1.id))).error, /another design/);
    // Activity events: the job comes from the design, not the client.
    const r = await ingestDesignerActivity(run, { userId: f.owner.userId, designId, sessionId: "S-v26", seq: 1, kind: "focus", at: new Date().toISOString() });
    assert.equal(r.projectId, f.p1);
    const [evt] = await run(`SELECT project_id, design_id FROM designer_activity_events WHERE session_id = 'S-v26'`);
    assert.equal(evt.project_id, f.p1);
    assert.equal(Number(evt.design_id), designId);
    await assert.rejects(ingestDesignerActivity(run, { userId: f.owner.userId, designId: 999999999, sessionId: "S-x", seq: 1, kind: "focus", at: new Date().toISOString() }), /Unknown design/);
    // Pin v1 as an approved artifact; pinning again is the same revision.
    const p = await pinDesignVersion(run, Number(v1.id), "signature:test");
    assert.equal(p.revision.revision, 1);
    assert.equal((await pinDesignVersion(run, Number(v1.id), "signature:test")).revision.id, p.revision.id);
    assert.ok((await designVersionPinned(run, Number(v1.id))).content_hash);
    // Sharing: only a PUBLISHED floorplan row pointing at a version is visible.
    await run(`INSERT INTO project_floorplans (project_id, version, file_id, design_id, design_version_id) VALUES ($1, 1, 'zz-f1', $2, $3)`, [f.p1, designId, v1.id]);
    assert.equal((await designSharingFor(run, designId)).length, 0, "unpublished stays private");
    await run(`UPDATE project_floorplans SET published_at = now() WHERE design_version_id = $1`, [v1.id]);
    const shared = await designSharingFor(run, designId);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].versionNumber, 1);
  });
});
