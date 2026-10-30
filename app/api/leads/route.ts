import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getLeadsData } from "@/lib/leads";

// GET /api/leads — pipeline + lead table. Mock-backed (see lib/leads.ts).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "leads")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getLeadsData();
  return NextResponse.json(data);
}
