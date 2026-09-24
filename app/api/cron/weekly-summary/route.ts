import { NextResponse } from "next/server";
import { cronAuthorized, runCronJob } from "@/app/api/cron/_lib/guard";
import { runWeeklySummaryTick } from "@/lib/field/server";

// GET/POST /api/cron/weekly-summary — WORKFLOW W10 weekly client summaries
// (A16). Runs hourly (sjcos-weekly-summary timer, :35); each project's
// configured day/time (default Friday 15:00 America/Chicago) decides whether
// a summary is due. Publishing is automatic ONLY under the active
// `weekly.client_summary` policy; otherwise the built summary is staged as a
// decision. Replay-safe: one summary per (project, week, revision).
// Protected by CRON_SECRET like every other cron route.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runCronJob("weekly client summary", async () => {
    const r = await runWeeklySummaryTick();
    return { due: r.due, built: r.built, applied_decisions: r.applied };
  });
}

export const GET = handle;
export const POST = handle;
