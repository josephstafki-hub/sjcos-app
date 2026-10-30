import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getSub } from "@/lib/subs";

// GET /api/subs/[slug] — a single subcontractor profile. Mock-backed today
// (see lib/subs.ts); becomes real DB + AI in Phase 7.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "subs")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { slug } = await params;
  const sub = await getSub(slug);
  if (!sub) {
    return NextResponse.json({ error: "Sub not found" }, { status: 404 });
  }
  return NextResponse.json(sub);
}
