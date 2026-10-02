#!/usr/bin/env node
// READ-ONLY collision report for the A01 obligation migration. Prints open
// work items that share a title, or share a stable source id, across
// different leads/projects — the cases the old title-based inbox merge could
// have glued together. It never merges, edits or deletes: the legacy
// resolution is explicit and per row (Joe / the integration owner decides).
//
//   node scripts/report-work-item-collisions.mjs            # human table
//   node scripts/report-work-item-collisions.mjs --json     # machine output
//   DATABASE_URL=… node scripts/report-work-item-collisions.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const env = readFileSync(envFile, "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`DATABASE_URL not found in ${envFile}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

export async function collisionReport(client) {
  const sameTitle = (
    await client.query(
      `SELECT lower(trim(title)) AS key, count(*)::int AS n,
              array_agg(json_build_object('id', id, 'source_kind', source_kind, 'source_id', source_id, 'lead_id', lead_id,
                                          'project_id', project_id, 'status', status, 'created_by', created_by,
                                          'obligation_id', obligation_id, 'created_at', created_at) ORDER BY created_at) AS items,
              count(DISTINCT COALESCE(lead_id::text, '') || '|' || COALESCE(project_id::text, ''))::int AS targets,
              count(DISTINCT COALESCE(source_id, ''))::int AS sources
         FROM work_items
        WHERE status NOT IN ('done','cancelled')
        GROUP BY lower(trim(title))
       HAVING count(*) > 1
        ORDER BY n DESC, key`,
    )
  ).rows;
  const sameSource = (
    await client.query(
      `SELECT source_kind, source_id, count(*)::int AS n,
              array_agg(json_build_object('id', id, 'title', title, 'lead_id', lead_id, 'project_id', project_id, 'status', status,
                                          'created_by', created_by, 'obligation_id', obligation_id, 'created_at', created_at) ORDER BY created_at) AS items,
              count(DISTINCT COALESCE(lead_id::text, '') || '|' || COALESCE(project_id::text, ''))::int AS targets
         FROM work_items
        WHERE status NOT IN ('done','cancelled') AND source_id IS NOT NULL
        GROUP BY source_kind, source_id
       HAVING count(*) > 1
        ORDER BY n DESC, source_kind, source_id`,
    )
  ).rows;
  const unidentified = (
    await client.query(
      `SELECT id, title, source_kind, created_by, status, created_at
         FROM work_items
        WHERE status NOT IN ('done','cancelled') AND source_kind IN ('email','sms','call') AND source_id IS NULL
        ORDER BY created_at`,
    )
  ).rows;
  return { sameTitle, sameSource, unidentified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const r = await collisionReport(client);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`Same-title open work items (${r.sameTitle.length} groups):`);
      for (const g of r.sameTitle) {
        console.log(`  "${g.key}" ×${g.n} — ${g.targets} target(s), ${g.sources} source id(s)${g.targets > 1 || g.sources > 1 ? "  ← DISTINCT, do not merge" : ""}`);
        for (const it of g.items) console.log(`      ${it.id}  ${it.status}  ${it.source_kind}:${it.source_id ?? "-"}  lead=${it.lead_id ?? "-"} project=${it.project_id ?? "-"}  by ${it.created_by}`);
      }
      console.log(`\nSame-source open work items (${r.sameSource.length} groups):`);
      for (const g of r.sameSource) {
        console.log(`  ${g.source_kind}:${g.source_id} ×${g.n} — ${g.targets} target(s)`);
        for (const it of g.items) console.log(`      ${it.id}  ${it.status}  "${it.title}"  lead=${it.lead_id ?? "-"} project=${it.project_id ?? "-"}`);
      }
      console.log(`\nOpen email/sms/call items with NO source id (${r.unidentified.length}) — need explicit resolution:`);
      for (const it of r.unidentified) console.log(`  ${it.id}  ${it.status}  "${it.title}"  by ${it.created_by}`);
      console.log("\nThis report changes nothing. Resolve rows by hand; never mass-merge.");
    }
  } finally {
    await client.end();
  }
}
