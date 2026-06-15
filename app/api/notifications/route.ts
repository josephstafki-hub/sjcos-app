import { NextResponse } from "next/server";
import { getNotificationsData } from "@/lib/notifications";

// GET /api/notifications — filterable notification feed. Mock-backed (see
// lib/notifications.ts).
export async function GET() {
  const data = await getNotificationsData();
  return NextResponse.json(data);
}
