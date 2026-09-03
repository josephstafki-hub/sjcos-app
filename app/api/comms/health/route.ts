import { NextResponse } from "next/server";
import { runCommsHealthCheck } from "@/lib/comms-health";

// GET /api/comms/health — the SMS + voice integration health check.
// 200 when everything enabled is configured, Telnyx answers for the
// messaging profile and the call-control app, and nothing is stale; 503 with
// the named problems otherwise. Bearer-gated with CRON_SECRET (it reveals
// config state, not secrets). ?probe=0 skips the Telnyx round trips.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3017/api/comms/health
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const probe = new URL(req.url).searchParams.get("probe") !== "0";
  const h = await runCommsHealthCheck({ probe });
  return NextResponse.json(h, { status: h.ok ? 200 : 503 });
}
