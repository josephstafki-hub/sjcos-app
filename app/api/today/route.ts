import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET /api/today — the daily dashboard payload for the signed-in account.
// /api/* is outside proxy.ts's matcher, so the access check belongs here.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "today")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getTodayData(user);
  return NextResponse.json(data);
}
