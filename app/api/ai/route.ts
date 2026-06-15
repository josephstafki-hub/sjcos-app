import { NextResponse } from "next/server";
import { getAssistantData } from "@/lib/assistant";

// GET /api/ai — the Ask-Claude screen payload (context, skills, thread).
// Mock-backed today; the assistant body comes from lib/ai.ts (swap to a real
// streaming model in Phase 7).
export async function GET() {
  const data = await getAssistantData();
  return NextResponse.json(data);
}
