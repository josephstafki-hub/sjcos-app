import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getScheduleData } from "@/lib/schedule";

// GET /api/schedule — the week-strip + daily-log payload.
// Mock-backed today (see lib/schedule.ts); becomes real DB + AI in Phase 7.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "projects")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getScheduleData();
  return NextResponse.json(data);
}
