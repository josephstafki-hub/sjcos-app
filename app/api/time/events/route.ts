// Cookie-session ingest for designer activity from the in-app designer
// (components/floor/ActivityEmitter.tsx). Owner-only: office time is Joe's.
// The server resolves the project from the design; no client project id.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { ingestTimeEvents, type DesignerEventBody } from "@/lib/owner-time/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  let body: { designer?: DesignerEventBody[] };
  try {
    body = (await req.json()) as { designer?: DesignerEventBody[] };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const designer = Array.isArray(body.designer) ? body.designer.slice(0, 200) : [];
  return NextResponse.json(await ingestTimeEvents(user.id, { designer }));
}
