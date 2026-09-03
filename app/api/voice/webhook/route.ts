import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyTelnyxSignature } from "@/lib/comms/telnyx-signature";
import { parseVoiceEvent } from "@/lib/comms/voice-flow";
import { voiceConfig, voiceStatus, handleVoiceEvent } from "@/lib/voice";
import { touchWebhookStamp } from "@/lib/comms-shared";
import { reportCommsFailure } from "@/lib/comms-health";

// POST /api/voice/webhook — Telnyx Call Control webhook (API V2, Ed25519-
// signed with the SAME key as messaging). Public URL:
// https://os.sjcarpentryllc.com/api/voice/webhook — configured on the Call
// Control application in the Telnyx portal. Do not rename without saying so.
//
// Same discipline as the SMS webhook: fail closed when misconfigured, verify
// the RAW body first, acknowledge 200 fast, do the work in after(). Call
// Control is command-driven, so "the work" is issuing the next command for
// the call (answer / record / dial / bridge / voicemail) — see lib/voice.ts
// and the pure planner in lib/comms/voice-flow.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = voiceConfig();
  if (!cfg) {
    const s = voiceStatus();
    console.error(`[voice:webhook] refused — ${s.enabled ? s.problems.join("; ") : "VOICE_APPLICATION_ID unset"}`);
    return NextResponse.json({ error: "voice not configured", problems: s.problems }, { status: 503 });
  }

  const rawBody = await req.text();
  const verdict = verifyTelnyxSignature({
    rawBody,
    timestamp: req.headers.get("telnyx-timestamp"),
    signature: req.headers.get("telnyx-signature-ed25519"),
    publicKeyB64: cfg.publicKey,
  });
  if (!verdict.ok) {
    console.error(`[voice:webhook] signature rejected: ${verdict.reason}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ev = parseVoiceEvent(parsed);
  touchWebhookStamp("voice");
  if (!ev) return NextResponse.json({ ok: true, ignored: "not a call event" });

  after(async () => {
    try {
      const r = await handleVoiceEvent(ev);
      if (r.handled) revalidatePath("/calls");
    } catch (err) {
      await reportCommsFailure("voice-webhook", err, { detail: `event ${ev.type} ${ev.eventId ?? ""}`.trim(), href: "/calls" });
    }
  });

  return NextResponse.json({ ok: true, event: ev.type });
}
