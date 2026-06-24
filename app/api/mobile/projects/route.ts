import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getProjectsData } from "@/lib/projects";

// GET /api/mobile/projects — projects list (grouped) for the iOS app (owner only).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getProjectsData();
  return NextResponse.json(data);
}
