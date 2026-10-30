import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getFilesData } from "@/lib/files";

// GET /api/files — the files browser payload (tree + list + previews).
// Mock-backed today (see lib/files.ts); becomes a Drive-mirrored tree in Phase 7.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "projects")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getFilesData();
  return NextResponse.json(data);
}
