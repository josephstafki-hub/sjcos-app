import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getInboxData } from "@/lib/inbox";

// GET /api/mobile/inbox — email threads for the iOS app (owner only).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "inbox")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getInboxData();
  return NextResponse.json(data);
}
