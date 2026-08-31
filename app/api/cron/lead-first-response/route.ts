import { NextResponse } from "next/server";
import { sweepLeadFirstResponses } from "@/lib/lead-first-response";

// POST/GET /api/cron/lead-first-response — 10-minute safety net for the
// same-day first response. The normal path runs right at intake (Next
// `after()` in createInboundLead); this sweep picks up any inbound lead from
// the last 3 days that still has no first-response row (model was down, the
// process restarted mid-draft, …). Same shared-secret gate as the other cron
// routes; fails closed when CRON_SECRET is unset. Whether anything actually
// mails depends on the owner's ai.leadFirstResponseAutoSend toggle — off means
// the sweep only stages drafts on the lead page.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sweepLeadFirstResponses({ max: 5 });
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
