import { NextResponse } from "next/server";
import { getLead } from "@/lib/leads";

// GET /api/leads/[slug] — single lead detail. Mock-backed (see lib/leads.ts).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const lead = await getLead(slug);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(lead);
}
