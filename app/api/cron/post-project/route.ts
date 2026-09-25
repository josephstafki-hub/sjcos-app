import { NextResponse } from "next/server";
import { cronAuthorized, runCronJob } from "@/app/api/cron/_lib/guard";
import { runPostProjectTick } from "@/lib/closeout/server";

// GET/POST /api/cron/post-project — WORKFLOW W12 post-project follow-through
// (A17): warranty/care documents from configured terms only, the review
// request when a review URL is configured, the check-in at the configured
// day, and the closeout learning hand-off. Automatic ONLY under the active
// `postproject.followthrough` policy; otherwise each due action is staged as a
// decision. Hourly (sjcos-post-project timer, :40). Protected by CRON_SECRET.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runCronJob("post-project follow-through", async () => {
    const out = await runPostProjectTick();
    const byState: Record<string, number> = {};
    for (const s of out.states) byState[s] = (byState[s] ?? 0) + 1;
    return { processed: out.processed, by_state: byState };
  });
}

export const GET = handle;
export const POST = handle;
