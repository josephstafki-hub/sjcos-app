import { NextResponse } from "next/server";
import { previewBidFollowUps, runBidFollowUps } from "@/lib/bid-follow-ups";

// POST/GET /api/cron/bid-follow-ups — hourly bid-chase sweep. Nudges subs who
// haven't answered an open bid request (day 2 and day 5), sends the softer
// check-in to subs marked "working on it" (day 4 after they said so), and
// catches up any thank-you that failed at record time.
//
// Like the newsletter drip, this transmits email on a timer without a Release
// click — the guards that make that acceptable are documented at the top of
// lib/bid-follow-ups.ts. Same shared-secret protection as the other cron
// routes (the proxy matcher excludes /api, so there is no session gate here)
// and it fails closed when CRON_SECRET is unset.
//
// ?dry_run=1 (or =true) returns what the sweep would send — same SELECTs, all
// guards — without claiming a ledger row or touching Gmail.
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry_run");
  if (dry === "1" || dry === "true") {
    const would_send = await previewBidFollowUps();
    return NextResponse.json({
      ok: true,
      dry_run: true,
      ran_at: new Date().toISOString(),
      count: would_send.length,
      would_send,
    });
  }
  const result = await runBidFollowUps();
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
