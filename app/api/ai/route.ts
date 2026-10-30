import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getAssistantData } from "@/lib/assistant";

// GET /api/ai — the Ask-Claude screen payload (context, skills, thread).
// Mock-backed today; the assistant body comes from lib/ai.ts (swap to a real
// streaming model in Phase 7).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "ai")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await getAssistantData();
  return NextResponse.json(data);
}
