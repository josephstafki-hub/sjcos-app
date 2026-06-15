import { NextResponse } from "next/server";
import { getCatalogData } from "@/lib/catalog";

// GET /api/catalog — the material library payload. Mock-backed today
// (see lib/catalog.ts).
export async function GET() {
  const data = await getCatalogData();
  return NextResponse.json(data);
}
