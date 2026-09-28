import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getInboxData } from "@/lib/inbox";

// GET /api/mobile/inbox — email threads for the iOS app. The bearer user is
// passed through explicitly: there is no session cookie on a native request, so
// getInboxData() could not resolve whose mailbox to open on its own.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "inbox")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getInboxData(user);
  return NextResponse.json(data);
}
