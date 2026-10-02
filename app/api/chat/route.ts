import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { chatViewerFor, getChatData } from "@/lib/chat";

// GET /api/chat — channels + rooms + DMs + transcripts, scoped to the signed-in
// account. /api/* is outside proxy.ts's matcher, so the access check belongs
// here: these transcripts are internal conversations.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "chat")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getChatData(await chatViewerFor(user));
  return NextResponse.json(data);
}
