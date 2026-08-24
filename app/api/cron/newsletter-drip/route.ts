import { NextResponse } from "next/server";
import { cancelScamLeadNurture, runDrip } from "@/lib/newsletter-drip";

// POST/GET /api/cron/newsletter-drip — hourly drip sweep. Advances every welcome-
// sequence subscription whose next step has come due and mails it.
//
// This is the only machine-triggered path in SJC OS that sends to a real client
// without the owner clicking Release; the guards that make that acceptable are
// documented at the top of lib/newsletter-drip.ts. Same shared-secret protection
// as the other cron routes (the proxy matcher excludes /api, so there is no
// session gate here) and it fails closed when CRON_SECRET is unset.
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
  // W4-L: scam-flagged leads come off the nurture BEFORE any step can send.
  // The scam flag is agent-set data (no app write path to hook), so this sweep
  // is the chokepoint — running it here, ahead of every send pass, is what
  // guarantees a flagged lead never receives a nurture step.
  const scamCancelled = await cancelScamLeadNurture();
  const result = await runDrip();
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), scamCancelled, ...result });
}

export const GET = handle;
export const POST = handle;
