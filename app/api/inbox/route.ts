import { NextResponse } from "next/server";
import { getInboxData } from "@/lib/inbox";

// GET /api/inbox — smart views + channels + thread list + readers. Mock-backed
// (see lib/inbox.ts).
export async function GET() {
  const data = await getInboxData();
  return NextResponse.json(data);
}
