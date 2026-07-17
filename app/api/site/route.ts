import { NextResponse } from "next/server";
import { getSiteComposerData } from "@/lib/site";

// GET /api/site — the Website Content Composer payload (blog post drafts + the
// per-project media-readiness the composer flags). Read-only; nothing here
// publishes outward. See lib/site.ts.
export async function GET() {
  const data = await getSiteComposerData();
  return NextResponse.json(data);
}
