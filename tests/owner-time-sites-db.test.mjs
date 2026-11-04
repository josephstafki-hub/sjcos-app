import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { run as runOf, cleanField, seedField } from "./field-fixtures.mjs";
import { activeJobSites, locateJobSite } from "../lib/owner-time/sites.ts";
import { ingestLocationEvent } from "../lib/owner-time/location.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("job sites: active jobs listed, located once from the phone, never moved, then arrivals prompt", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await cleanField(client);
    const f = await seedField(client);
    const run = runOf(client);
    await client.query(`UPDATE projects SET address = '12 Elm St, Minneapolis MN' WHERE id = $1`, [f.p1]);
    await client.query(`INSERT INTO projects (slug, name, status, address) VALUES ('zz-p3','zz Done Three','warranty','1 Oak Ave')`);

    const jobs = await activeJobSites(run);
    const mine = jobs.filter((j) => j.slug.startsWith("zz-"));
    assert.deepEqual(mine.map((j) => j.slug).sort(), ["zz-p1", "zz-p2"]);
    assert.equal(mine.find((j) => j.slug === "zz-p1").site, null);

    // No address → refused; warranty job → refused; bad point → refused.
    await assert.rejects(() => locateJobSite(run, { projectId: f.p2, lat: 44.9, lng: -93.2 }), /no address/);
    const [p3] = await run(`SELECT id FROM projects WHERE slug = 'zz-p3'`);
    await assert.rejects(() => locateJobSite(run, { projectId: p3.id, lat: 44.9, lng: -93.2 }), /construction/);
    await assert.rejects(() => locateJobSite(run, { projectId: f.p1, lat: 120, lng: -93.2 }), /valid point/);

    const placed = await locateJobSite(run, { projectId: f.p1, lat: 44.9778, lng: -93.265 });
    assert.equal(placed.site.lat, 44.9778);
    assert.equal(placed.site.radiusM, 150);
    // A second lookup does not move it.
    const again = await locateJobSite(run, { projectId: f.p1, lat: 45.5, lng: -94 });
    assert.equal(again.site.lat, 44.9778);

    const enter = await ingestLocationEvent(run, { userId: f.owner.userId, deviceId: "iphone", clientEventId: "S1", kind: "enter", lat: 44.9778, lng: -93.265, accuracyM: 150, at: new Date().toISOString() });
    assert.equal(enter.kind, "prompt");
    assert.equal(enter.interval.project_id, f.p1);

    // An exit reported for another job's site (the phone starts monitoring
    // and says "outside" for every other site) leaves this prompt alone.
    await client.query(`INSERT INTO job_sites (project_id, lat, lng) VALUES ($1, 45.1, -93.5)`, [f.p2]);
    const away = await ingestLocationEvent(run, { userId: f.owner.userId, deviceId: "iphone", clientEventId: "S2", kind: "exit", lat: 45.1, lng: -93.5, accuracyM: 150, at: new Date().toISOString() });
    assert.equal(away.kind, "ignored");
    const [still] = await run(`SELECT state FROM time_intervals WHERE id = $1`, [enter.interval.id]);
    assert.equal(still.state, "inferred");
  });
});
