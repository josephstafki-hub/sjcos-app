// Job sites for the phone's geofences (A19). The phone watches a region
// around each active job; the server still decides what an arrival means
// (location.ts). A job without a site row is located once — the phone looks
// up the job's address and posts the point — and an existing row is never
// moved from the phone (radius/dwell/cooldown and corrections stay
// server-side).

import type { Run } from "../commands/core.ts";

export interface SiteJob {
  projectId: string;
  slug: string;
  name: string;
  address: string;
  site: { lat: number; lng: number; radiusM: number; dwellS: number; cooldownS: number; enabled: boolean } | null;
}

/** Jobs in construction, with their site row if one exists. */
export async function activeJobSites(run: Run): Promise<SiteJob[]> {
  const rows = await run<{ id: string; slug: string; name: string; address: string | null; lat: number | null; lng: number | null; radius_m: number | null; dwell_s: number | null; cooldown_s: number | null; enabled: boolean | null }>(
    `SELECT p.id, p.slug, p.name, p.address, s.lat, s.lng, s.radius_m, s.dwell_s, s.cooldown_s, s.enabled
       FROM projects p LEFT JOIN job_sites s ON s.project_id = p.id
      WHERE p.status = 'construction'
      ORDER BY p.name`,
  );
  return rows.map((r) => ({
    projectId: r.id,
    slug: r.slug,
    name: r.name,
    address: r.address ?? "",
    site: r.lat == null || r.lng == null ? null : { lat: Number(r.lat), lng: Number(r.lng), radiusM: Number(r.radius_m), dwellS: Number(r.dwell_s), cooldownS: Number(r.cooldown_s), enabled: !!r.enabled },
  }));
}

/** Place a job's site from the phone's address lookup. Only for a job in
 *  construction that has an address and no site yet; otherwise returns the
 *  existing row unchanged. */
export async function locateJobSite(run: Run, input: { projectId: string; lat: number; lng: number }): Promise<SiteJob> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) throw new Error("lat/lng are not a valid point.");
  const [p] = await run<{ status: string; address: string | null }>(`SELECT status, address FROM projects WHERE id = $1`, [input.projectId]);
  if (!p) throw new Error("Unknown project.");
  if (p.status !== "construction") throw new Error("Only jobs in construction get a job site.");
  if (!p.address?.trim()) throw new Error("This job has no address to locate.");
  await run(`INSERT INTO job_sites (project_id, lat, lng) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO NOTHING`, [input.projectId, input.lat, input.lng]);
  const job = (await activeJobSites(run)).find((j) => j.projectId === input.projectId);
  if (!job) throw new Error("Unknown project.");
  return job;
}
