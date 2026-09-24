// POST /api/mobile/time/events — offline-safe batch of location events
// (enter / exit / heartbeat with stable client ids and original timestamps)
// and optional designer events from the iOS app. Owner-only. Location
// suggests a job; the app then shows the prompt the server returns. See
// docs/mobile-time-contract.md.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { ingestTimeEvents, type DesignerEventBody, type LocationEventBody } from "@/lib/owner-time/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  let body: { location?: LocationEventBody[]; designer?: DesignerEventBody[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const location = Array.isArray(body.location) ? body.location.slice(0, 500) : [];
  const designer = Array.isArray(body.designer) ? body.designer.slice(0, 200) : [];
  if (!location.length && !designer.length) return NextResponse.json({ error: "No events." }, { status: 400 });
  return NextResponse.json(await ingestTimeEvents(user.id, { location, designer }));
}
