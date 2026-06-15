import { NextResponse } from "next/server";
import { getComplianceData } from "@/lib/compliance";

// GET /api/compliance — the deadline calendar (windows + year-ahead timeline).
// Mock-backed today (see lib/compliance.ts); becomes real DB + AI in Phase 7.
export async function GET() {
  const data = await getComplianceData();
  return NextResponse.json(data);
}
