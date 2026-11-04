// GET /api/mobile/time/sites — active jobs (in construction) with their job
// site, for the phone's geofences and the manual timer's job picker.
// POST /api/mobile/time/sites — { projectId, lat, lng }: place a job's site
// from the phone's address lookup, once; an existing site is never moved.
// Owner-only. See docs/mobile-time-contract.md.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { withTransaction } from "@/lib/commands/db";
import { activeJobSites, locateJobSite } from "@/lib/owner-time/sites";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  return NextResponse.json({ jobs: await withTransaction((run) => activeJobSites(run)) });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  let body: { projectId?: unknown; lat?: unknown; lng?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.projectId !== "string" || !body.projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  try {
    const job = await withTransaction((run) => locateJobSite(run, { projectId: String(body.projectId), lat: Number(body.lat), lng: Number(body.lng) }));
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
