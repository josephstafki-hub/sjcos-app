import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getLead } from "@/lib/leads";

// GET /api/leads/[slug] — single lead detail. Mock-backed (see lib/leads.ts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "leads")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { slug } = await params;
  const lead = await getLead(slug);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(lead);
}
