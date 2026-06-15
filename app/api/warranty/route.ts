import { NextResponse } from "next/server";
import { getWarrantyData } from "@/lib/warranty";

// GET /api/warranty — active claims + under-warranty projects. Mock-backed
// today (see lib/warranty.ts); becomes real DB + AI in Phase 7.
export async function GET() {
  const data = await getWarrantyData();
  return NextResponse.json(data);
}
