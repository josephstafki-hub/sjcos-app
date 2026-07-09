import { NextResponse } from "next/server";
import { getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET /api/today — the daily dashboard payload.
// Mock-backed today (see lib/today.ts); becomes real DB + AI in Phase 7.
export async function GET() {
  const data = await getTodayData();
  return NextResponse.json(data);
}
