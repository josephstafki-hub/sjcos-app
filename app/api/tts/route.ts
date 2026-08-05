import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { synthesizeSpeech, piperAvailable } from "@/lib/tts";

// POST /api/tts — local text-to-speech for voice conversation rounds (Phase
// B1). Session-gated (owner + sub only) inside the handler since the proxy
// matcher excludes /api. Accepts { text }, returns the WAV bytes. force-dynamic
// so it never caches. (A runId path — resolving a run's answer server-side —
// comes in a later phase; text only for now.)
export const dynamic = "force-dynamic";

// GET /api/tts — availability probe so any client surface can self-gate its
// speaker path without threading piperAvailable() down through props. Same
// owner/sub session gate as POST; returns { available }.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ available: piperAvailable() });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "sub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let text: string;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }

  const result = await synthesizeSpeech(text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return new Response(new Uint8Array(result.wav), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
}
