import { NextResponse } from "next/server";
import { getNewsletterData } from "@/lib/newsletter";

// GET /api/newsletter — issues, audience, the parked outbox, and email content.
// Real, DB-backed (see lib/newsletter.ts).
export async function GET() {
  const data = await getNewsletterData();
  return NextResponse.json(data);
}
