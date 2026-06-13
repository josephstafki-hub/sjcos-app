import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";

// GET /api/projects/[slug] — single project detail. Mock-backed (lib/projects.ts).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}
