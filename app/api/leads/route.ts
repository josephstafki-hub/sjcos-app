import { NextResponse } from "next/server";
import { getLeadsData } from "@/lib/leads";

// GET /api/leads — pipeline + lead table. Mock-backed (see lib/leads.ts).
export async function GET() {
  const data = await getLeadsData();
  return NextResponse.json(data);
}
