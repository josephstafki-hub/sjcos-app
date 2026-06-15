import { NextResponse } from "next/server";
import { getSub } from "@/lib/subs";

// GET /api/subs/[slug] — a single subcontractor profile. Mock-backed today
// (see lib/subs.ts); becomes real DB + AI in Phase 7.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const sub = await getSub(slug);
  if (!sub) {
    return NextResponse.json({ error: "Sub not found" }, { status: 404 });
  }
  return NextResponse.json(sub);
}
