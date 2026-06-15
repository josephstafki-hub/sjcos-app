import { NextResponse } from "next/server";
import { getChatData } from "@/lib/chat";

// GET /api/chat — channels + project rooms + DMs + per-channel transcripts.
// Mock-backed (see lib/chat.ts).
export async function GET() {
  const data = await getChatData();
  return NextResponse.json(data);
}
