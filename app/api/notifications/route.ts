import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { getNotificationsData } from "@/lib/notifications";

// GET /api/notifications — the signed-in account's notification feed. /api/* is
// outside proxy.ts's matcher, so the access check belongs here.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "today")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getNotificationsData(user);
  return NextResponse.json(data);
}
