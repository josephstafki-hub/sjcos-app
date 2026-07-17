import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { transcribeAudio, whisperAvailable } from "@/lib/transcribe";

// POST /api/transcribe — local speech-to-text for voice daily logs (7-voice).
// Session-gated (owner + sub only) inside the handler since the proxy matcher
// excludes /api. Accepts a recorded audio blob, returns { text }. force-dynamic
// so it never caches.
export const dynamic = "force-dynamic";

// GET /api/transcribe — availability probe so any client composer can self-gate
// its mic button without threading whisperAvailable() down through props. Same
// owner/sub session gate as POST; returns { available }.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ available: whisperAvailable() });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read the recording." }, { status: 400 });
  }

  const result = await transcribeAudio(bytes);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ text: result.text });
}
