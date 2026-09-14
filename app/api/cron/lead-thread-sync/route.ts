import { NextResponse } from "next/server";
import { syncLeadThreads } from "@/lib/lead-thread-sync";
import { cronAuthorized, runCronJob } from "../_lib/guard";

// POST/GET /api/cron/lead-thread-sync — live "needs reply" sync (see
// lib/lead-thread-sync.ts). Machine-triggered by the systemd user timer (see
// deploy/README) every 15 min. Not session-gated (the proxy matcher excludes
// /api); protected by the same shared CRON_SECRET as /api/cron/reminders.
// force-dynamic so it never caches.
//   ?dry=1   compute + return what WOULD change without writing (and without
//            advancing the watermark) — safe to reuse any time.
//   ?full=1  ignore the watermark and rescan the newest 150 threads
//            (metadata-only; still cheap) — e.g. after a lead's email changed.
// A Gmail quota hit is caught by runCronJob: one log line + a notifications
// row, never an unhandled stack in the journal.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dry") === "1";
  const full = params.get("full") === "1";
  return runCronJob("lead thread sync", () => syncLeadThreads({ dryRun, full }));
}

export const GET = handle;
export const POST = handle;
