import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getProjectsData } from "@/lib/projects";

// GET /api/projects — projects grouped by status. Mock-backed (lib/projects.ts).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "projects")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getProjectsData();
  return NextResponse.json(data);
}
