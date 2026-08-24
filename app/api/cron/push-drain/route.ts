import { NextResponse } from "next/server";
import { runPushDrain } from "@/lib/notify-owner";

// POST/GET /api/cron/push-drain — the W3 owner-push drain (see
// lib/notify-owner.ts). Machine-triggered by the sjcos-push-drain systemd
// user timer every 5 minutes at :02/:07/…. Transmits parked pushes whose
// send_after has arrived (quiet-hours / throttle parking), then nudges on
// approvals that have sat pending for 4+ hours. Not session-gated (the proxy
// matcher excludes /api); protected by the same shared CRON_SECRET as the
// other cron routes. force-dynamic so it never caches. Pass ?dry=1 to report
// what WOULD transmit without sending or writing.
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
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const result = await runPushDrain({ dryRun });
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
