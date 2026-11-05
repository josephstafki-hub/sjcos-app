import { askBoundary, askFailure } from "@/lib/thread-access";
import { isAskFailure } from "@/lib/ask-result-codes";
import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getAssistantData } from "@/lib/assistant";

// GET /api/ai — the Ask-Claude screen payload (context, skills, thread).
// Mock-backed today; the assistant body comes from lib/ai.ts (swap to a real
// streaming model in Phase 7).
export async function GET(req: Request) {
 try{
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ok:false,code:"SIGN_IN_AGAIN"}, { status: 401 });
  if (!hasAccess(user, "ai")) return NextResponse.json({ok:false,code:"CHAT_OFF"}, { status: 403 });
  const data = await askBoundary(getAssistantData);
  return NextResponse.json(data,isAskFailure(data)?{status:data.code==="ASK_PAUSED"?503:409}:undefined);
 }catch(error){return NextResponse.json(askFailure(error),{status:503});}
}
