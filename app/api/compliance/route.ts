import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getComplianceData } from "@/lib/compliance";

// GET /api/compliance — the deadline calendar (windows + year-ahead timeline).
// Mock-backed today (see lib/compliance.ts); becomes real DB + AI in Phase 7.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "compliance")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getComplianceData();
  return NextResponse.json(data);
}
