import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { gmailConfigured } from "@/lib/gmail";
import { draftReplyForThread } from "@/lib/inbox";
import type { DraftModel } from "@/lib/dev-agents-meta";

// POST /api/mobile/inbox/draft — generate an AI reply draft for one thread on
// demand (mobile mirror of draftReplyAction). Lazy because local-LLM drafting
// is too slow to run for every thread up front.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!gmailConfigured()) return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });

  let threadId: string;
  let model: DraftModel = "qwen";
  try {
    const parsed = (await req.json()) as { threadId?: unknown; model?: unknown };
    threadId = String(parsed?.threadId ?? "");
    if (parsed?.model === "hermes") model = "hermes";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  try {
    const draft = await draftReplyForThread(threadId, model);
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
