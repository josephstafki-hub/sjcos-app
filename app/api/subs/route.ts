import { NextResponse } from "next/server";
import { getSubsData } from "@/lib/subs";

// GET /api/subs — the subcontractor directory payload. Mock-backed today
// (see lib/subs.ts); becomes real DB queries in Phase 7.
export async function GET() {
  const data = await getSubsData();
  return NextResponse.json(data);
}
