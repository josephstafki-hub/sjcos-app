import { NextResponse } from "next/server";
import { getProjectsData } from "@/lib/projects";

// GET /api/projects — projects grouped by status. Mock-backed (lib/projects.ts).
export async function GET() {
  const data = await getProjectsData();
  return NextResponse.json(data);
}
