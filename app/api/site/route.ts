import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getSiteComposerData } from "@/lib/site";

// GET /api/site — the Website Content Composer payload (blog post drafts + the
// per-project media-readiness the composer flags). Read-only; nothing here
// publishes outward. See lib/site.ts.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "site")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getSiteComposerData();
  return NextResponse.json(data);
}
