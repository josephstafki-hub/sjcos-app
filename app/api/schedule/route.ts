import { NextResponse } from "next/server";
import { getScheduleData } from "@/lib/schedule";

// GET /api/schedule — the week-strip + daily-log payload.
// Mock-backed today (see lib/schedule.ts); becomes real DB + AI in Phase 7.
export async function GET() {
  const data = await getScheduleData();
  return NextResponse.json(data);
}
