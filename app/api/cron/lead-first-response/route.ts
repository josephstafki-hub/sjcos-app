import { NextResponse } from "next/server";
import { sweepLeadFirstResponses } from "@/lib/lead-first-response";
import { cronAuthorized, runCronJob } from "../_lib/guard";

// POST/GET /api/cron/lead-first-response — 10-minute safety net for the
// same-day first response. The normal path runs right at intake (Next
// `after()` in createInboundLead); this sweep picks up any inbound lead from
// the last 3 days that still has no first-response row (model was down, the
// process restarted mid-draft, …). Same shared-secret gate as the other cron
// routes; fails closed when CRON_SECRET is unset. Whether anything actually
// mails depends on the owner's ai.leadFirstResponseAutoSend toggle — off means
// the sweep only stages drafts on the lead page.
//
// Failures (incl. a Gmail quota hit) go through runCronJob: one log line +
// a notifications row, never an unhandled stack in the journal.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runCronJob("lead first response", () => sweepLeadFirstResponses({ max: 5 }));
}

export const GET = handle;
export const POST = handle;
