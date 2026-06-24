import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getTodayData } from "@/lib/today";

// GET /api/mobile/today — daily dashboard for the iOS app (owner only).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getTodayData();
  return NextResponse.json(data);
}
