import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getCatalogData } from "@/lib/catalog";

// GET /api/catalog — the material library payload. Mock-backed today
// (see lib/catalog.ts).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "catalog")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getCatalogData();
  return NextResponse.json(data);
}
