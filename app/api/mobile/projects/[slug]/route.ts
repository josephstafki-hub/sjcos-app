import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getProject, getProjectDailyLogs } from "@/lib/projects";

// GET /api/mobile/projects/[slug] — project detail + daily logs (owner only).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const dailyLogs = await getProjectDailyLogs(slug);
  return NextResponse.json({ project, dailyLogs });
}
