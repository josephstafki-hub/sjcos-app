import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getNewsletterData } from "@/lib/newsletter";

// GET /api/newsletter — issues, audience, the parked outbox, and email content.
// Real, DB-backed (see lib/newsletter.ts).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "newsletter")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getNewsletterData();
  return NextResponse.json(data);
}
