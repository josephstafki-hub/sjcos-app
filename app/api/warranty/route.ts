import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getWarrantyData } from "@/lib/warranty";

// GET /api/warranty — active claims + under-warranty projects. Mock-backed
// today (see lib/warranty.ts); becomes real DB + AI in Phase 7.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "warranty")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getWarrantyData();
  return NextResponse.json(data);
}
