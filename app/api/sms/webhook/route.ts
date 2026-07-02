import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { smsConfigured, recordInboundSms } from "@/lib/sms";

// POST /api/sms/webhook — inbound SMS from the provider (Twilio/Telnyx/etc).
// The provider POSTs a form-encoded delivery for each incoming text; we record
// it against the counterparty's thread. The proxy matcher excludes /api so no
// session redirect fires. Protected by a shared secret in the query string
// (?secret=…) matching SMS_WEBHOOK_SECRET — fail-closed. Returns empty TwiML so
// Twilio doesn't auto-reply.
//
// INERT until SMS is configured: returns 503 so a misfire is obvious.
export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml() {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: Request) {
  if (!smsConfigured()) {
    return NextResponse.json({ error: "SMS not configured" }, { status: 503 });
  }

  const secret = (process.env.SMS_WEBHOOK_SECRET ?? "").trim();
  const presented = new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret || presented !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Providers post application/x-www-form-urlencoded (Twilio: From, Body,
  // MessageSid). Parse leniently so a JSON provider also works.
  let from = "";
  let body = "";
  let sid: string | null = null;
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      const j = (await req.json()) as Record<string, unknown>;
      from = String(j.from ?? j.From ?? "");
      body = String(j.body ?? j.Body ?? j.text ?? "");
      sid = (j.sid ?? j.MessageSid ?? j.id ?? null) as string | null;
    } else {
      const form = await req.formData();
      from = String(form.get("From") ?? form.get("from") ?? "");
      body = String(form.get("Body") ?? form.get("body") ?? "");
      sid = (form.get("MessageSid") ?? form.get("sid")) as string | null;
    }
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!from) return NextResponse.json({ error: "missing sender" }, { status: 400 });

  try {
    await recordInboundSms({ from, body, providerSid: sid });
    revalidatePath("/messages");
  } catch (err) {
    console.error(`[sms:webhook] failed to record inbound — ${(err as Error).message}`);
    return NextResponse.json({ error: "record failed" }, { status: 500 });
  }

  return twiml();
}
