import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getSubsData } from "@/lib/subs";

// GET /api/subs — the subcontractor directory payload. Mock-backed today
// (see lib/subs.ts); becomes real DB queries in Phase 7.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "subs")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getSubsData();
  return NextResponse.json(data);
}
