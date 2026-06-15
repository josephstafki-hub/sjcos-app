import { NextResponse } from "next/server";
import { getSearchData } from "@/lib/search";

// GET /api/search — grouped results + AI direct answer. Mock-backed today
// (see lib/search.ts).
export async function GET() {
  const data = await getSearchData();
  return NextResponse.json(data);
}
