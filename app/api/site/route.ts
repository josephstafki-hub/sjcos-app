import { NextResponse } from "next/server";
import { getSiteData } from "@/lib/site";

// GET /api/site — the CMS payload (pages, auto-publish queue, home content).
// Mock-backed today (see lib/site.ts); reads the live site in Phase 7.
export async function GET() {
  const data = await getSiteData();
  return NextResponse.json(data);
}
