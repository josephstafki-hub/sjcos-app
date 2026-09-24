import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyTelnyxSignature } from "@/lib/comms/telnyx-signature";
import { parseMessagingEvent } from "@/lib/comms/sms-inbound";
import { smsConfig, smsStatus } from "@/lib/sms";
import { touchWebhookStamp } from "@/lib/comms-shared";
import { reportCommsFailure } from "@/lib/comms-health";
import { runDirect } from "@/lib/commands/db";
import { persistInbound, processInline } from "@/lib/worker/intake";
import { TELNYX_PROVIDER, telnyxMessagingInline } from "@/lib/worker/telnyx-processor";

// POST /api/sms/webhook — Telnyx messaging webhook (API V2, Ed25519-signed).
// Public URL: https://os.sjcarpentryllc.com/api/sms/webhook — configured on
// the "SJC OS" messaging profile in the Telnyx portal. Do not rename without
// saying so.
//
// Order of operations, deliberately (A03b durable intake):
//   1. Fail closed: SMS misconfigured → 503 naming what's missing (Telnyx
//      retries; the startup check has already filed a work item).
//   2. RAW body as text, THEN verify the signature. Any failure → 401, logged,
//      body never processed.
//   3. PERSIST the verified event to source_events under
//      (telnyx, <messaging profile id>, <event id>) BEFORE acknowledging. A
//      failed write → 503 so Telnyx retries. A duplicate → 200 with no work:
//      the first copy is finished/resumed by sjcos-worker.
//   4. 200 immediately, then after(): the inbound record / delivery receipt
//      runs inline under a lease on that source event (fast path). If the
//      process dies mid-way the lease expires and the worker re-runs the same
//      idempotent processor (sms_messages.provider_sid dedupes).
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

  const persisted = await persistInbound(runDirect, {
    provider: TELNYX_PROVIDER,
    account: cfg.messagingProfileId,
    eventId: ev.eventId ?? `${ev.eventType}:${ev.messageId ?? "?"}:${ev.toStatus ?? ""}`,
    eventType: ev.eventType,
    payload: parsed as Record<string, unknown>,
    sourceAt: ev.occurredAt,
  });
  if (!persisted.ok) {
    console.error(`[sms:webhook] could not persist event ${ev.eventId ?? ""}: ${persisted.error} — answering 503 so Telnyx retries`);
    return NextResponse.json({ error: "persistence unavailable", retry: true }, { status: 503 });
  }
  if (!persisted.created) return NextResponse.json({ ok: true, event: ev.eventType, duplicate: true });

  const sourceEventId = persisted.event.id;
  after(async () => {
    try {
      const r = await processInline(runDirect, telnyxMessagingInline, sourceEventId);
      if (r === "done") revalidatePath("/messages");
    } catch (err) {
      await reportCommsFailure("sms-webhook", err, { detail: `event ${ev.eventType} ${ev.eventId ?? ""}`.trim(), href: "/messages" });
    }
  });

  return NextResponse.json({ ok: true, event: ev.eventType });
}
