import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET /api/mobile/today — daily dashboard for the iOS app. The bearer user is
// passed through: Today is scoped to one person (owner's full board vs a team
// member's assigned to-dos) and there is no session cookie on a native request.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "today")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getTodayData(user);
  return NextResponse.json(data);
}
