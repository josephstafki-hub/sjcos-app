import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyTelnyxSignature } from "@/lib/comms/telnyx-signature";
import { parseMessagingEvent } from "@/lib/comms/sms-inbound";
import { smsConfig, smsStatus, recordInboundSms, applyDeliveryReceipt } from "@/lib/sms";
import { touchWebhookStamp } from "@/lib/comms-shared";
import { reportCommsFailure } from "@/lib/comms-health";

// POST /api/sms/webhook — Telnyx messaging webhook (API V2, Ed25519-signed).
// Public URL: https://os.sjcarpentryllc.com/api/sms/webhook — configured on
// the "SJC OS" messaging profile in the Telnyx portal. Do not rename without
// saying so.
//
// Order of operations, deliberately:
//   1. Fail closed: SMS misconfigured → 503 naming what's missing (Telnyx
//      retries; the startup check has already filed a work item).
//   2. RAW body as text, THEN verify the signature (section 5 of the build
//      prompt). Any failure → 401, logged, body never processed.
//   3. Acknowledge with 200 immediately — including for event types we don't
//      handle — and do the work in `after()`. Telnyx retries non-200s, so a
//      slow MMS download must never turn into a duplicate delivery.
//
// The proxy matcher excludes /api, so no session redirect fires here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = smsConfig();
  if (!cfg) {
    const s = smsStatus();
    console.error(`[sms:webhook] refused — ${s.enabled ? s.problems.join("; ") : "SMS_PROVIDER unset"}`);
    return NextResponse.json({ error: "SMS not configured", problems: s.problems }, { status: 503 });
  }

  const rawBody = await req.text();
  const verdict = verifyTelnyxSignature({
    rawBody,
    timestamp: req.headers.get("telnyx-timestamp"),
    signature: req.headers.get("telnyx-signature-ed25519"),
    publicKeyB64: cfg.publicKey,
  });
  if (!verdict.ok) {
    console.error(`[sms:webhook] signature rejected: ${verdict.reason}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ev = parseMessagingEvent(parsed);
  touchWebhookStamp("sms");
  if (!ev) return NextResponse.json({ ok: true, ignored: "not a messaging event" });

  after(async () => {
    try {
      if (ev.eventType === "message.received" && ev.direction !== "outbound") {
        const r = await recordInboundSms(ev);
        if (!r.duplicate) revalidatePath("/messages");
      } else if (ev.eventType === "message.sent" || ev.eventType === "message.finalized") {
        const r = await applyDeliveryReceipt(ev);
        if (r.matched) revalidatePath("/messages");
      }
      // Anything else (e.g. future event types) is acknowledged and ignored.
    } catch (err) {
      await reportCommsFailure("sms-webhook", err, { detail: `event ${ev.eventType} ${ev.eventId ?? ""}`.trim(), href: "/messages" });
    }
  });

  return NextResponse.json({ ok: true, event: ev.eventType });
}
