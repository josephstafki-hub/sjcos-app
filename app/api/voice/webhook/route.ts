import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyTelnyxSignature } from "@/lib/comms/telnyx-signature";
import { parseVoiceEvent } from "@/lib/comms/voice-flow";
import { voiceConfig, voiceStatus, handleVoiceEvent } from "@/lib/voice";
import { touchWebhookStamp } from "@/lib/comms-shared";
import { reportCommsFailure } from "@/lib/comms-health";
import { runDirect } from "@/lib/commands/db";
import { persistInbound } from "@/lib/worker/intake";
import { TELNYX_PROVIDER } from "@/lib/worker/telnyx-processor";

// POST /api/voice/webhook — Telnyx Call Control webhook (API V2, Ed25519-
// signed with the SAME key as messaging). Public URL:
// https://os.sjcarpentryllc.com/api/voice/webhook — configured on the Call
// Control application in the Telnyx portal. Do not rename without saying so.
//
// Order of operations (A03b durable intake):
//   1. Fail closed when misconfigured (503, Telnyx retries).
//   2. Verify the signature on the RAW body (401, never processed).
//   3. PERSIST the verified event to source_events under
//      (telnyx, <call-control app id>, <event id>) — before any 200. If the
//      database write fails → 503 so Telnyx retries; nothing was acted on.
//   4. Duplicate receipt → 200 immediately, no after() work: the first copy's
//      processing is finished (or resumed) by the worker, not re-run here.
//   5. 200, then after(): ONLY the immediate Call Control command for this
//      event (answer / record / dial / bridge / voicemail) — latency matters.
//      Recording download, transcript + AI notes, the voicemail work item and
//      the owner push run in sjcos-worker (phase "deferred"), which also
//      re-runs the immediate half if the app died before after() ran.
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

  const persisted = await persistInbound(runDirect, {
    provider: TELNYX_PROVIDER,
    account: cfg.applicationId,
    eventId: ev.eventId ?? `${ev.type}:${ev.callControlId ?? "?"}:${ev.occurredAt ?? rawBody.length}`,
    eventType: ev.type,
    payload: parsed as Record<string, unknown>,
    sourceAt: ev.occurredAt,
  });
  if (!persisted.ok) {
    console.error(`[voice:webhook] could not persist event ${ev.eventId ?? ""}: ${persisted.error} — answering 503 so Telnyx retries`);
    return NextResponse.json({ error: "persistence unavailable", retry: true }, { status: 503 });
  }
  if (!persisted.created) return NextResponse.json({ ok: true, event: ev.type, duplicate: true });

  after(async () => {
    try {
      const r = await handleVoiceEvent(ev, { phase: "immediate" });
      if (r.handled) revalidatePath("/calls");
    } catch (err) {
      await reportCommsFailure("voice-webhook", err, { detail: `event ${ev.type} ${ev.eventId ?? ""}`.trim(), href: "/calls" });
    }
  });

  return NextResponse.json({ ok: true, event: ev.type });
}
