import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getProject } from "@/lib/projects";

// GET /api/projects/[slug] — single project detail. Mock-backed (lib/projects.ts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "projects")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}
