import { NextResponse } from "next/server";
import { handleSquareWebhook, SQUARE_SIGNATURE_HEADER } from "@/lib/payments/server";

// POST /api/webhooks/square — Square event notifications (A20).
// Verified on the RAW body with SQUARE_WEBHOOK_SIGNATURE_KEY against the
// registered SQUARE_WEBHOOK_NOTIFICATION_URL, persisted to source_events
// BEFORE any 200, then processed idempotently (provider state decides, not
// arrival order). Unverified events are recorded (ignored) and answered 401.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const { status, body } = await handleSquareWebhook(raw, req.headers.get(SQUARE_SIGNATURE_HEADER));
  return NextResponse.json(body, { status });
}
