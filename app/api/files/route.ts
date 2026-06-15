import { NextResponse } from "next/server";
import { getFilesData } from "@/lib/files";

// GET /api/files — the files browser payload (tree + list + previews).
// Mock-backed today (see lib/files.ts); becomes a Drive-mirrored tree in Phase 7.
export async function GET() {
  const data = await getFilesData();
  return NextResponse.json(data);
}
