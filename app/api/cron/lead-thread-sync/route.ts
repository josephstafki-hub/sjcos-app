import { NextResponse } from "next/server";
import { syncLeadThreads } from "@/lib/lead-thread-sync";

// POST/GET /api/cron/lead-thread-sync — live "needs reply" sync (see
// lib/lead-thread-sync.ts). Machine-triggered by the systemd user timer (see
// deploy/README) every 15 min. Not session-gated (the proxy matcher excludes
// /api); protected by the same shared CRON_SECRET as /api/cron/reminders.
// force-dynamic so it never caches. Pass ?dry=1 to compute + return what
// WOULD change without writing — used once to sanity-check the feature
// before the timer was turned on, and safe to reuse any time.
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
  const result = await syncLeadThreads({ dryRun });
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
