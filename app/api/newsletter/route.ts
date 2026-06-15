import { NextResponse } from "next/server";
import { getNewsletterData } from "@/lib/newsletter";

// GET /api/newsletter — issues, audience, performance, and the email content.
// Mock-backed today (see lib/newsletter.ts).
export async function GET() {
  const data = await getNewsletterData();
  return NextResponse.json(data);
}
