import { NextResponse } from "next/server";
import { cronAuthorized, runCronJob } from "@/app/api/cron/_lib/guard";
import { runDispatchPass } from "@/lib/dispatch/db";
import { sweepUnansweredReplies } from "@/lib/owner-reply-delivery";

// POST/GET /api/cron/dispatch — the intent dispatcher pass (A05/A06). Run by
// the sjcos-dispatch systemd user timer every 2 minutes: sweeps expired
// leases (→ unknown, held), expires stale decisions, wakes held intents whose
// decision was approved or whose lane reopened, dispatches everything due,
// then reconciles unknown/accepted outcomes with each provider. Protected by
// CRON_SECRET like every other cron route. ?limit=N caps a pass.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return runCronJob("intent dispatch", async () => {
    const r = await runDispatchPass({ limit: Number.isFinite(limit) && limit > 0 ? limit : 50 });
    const byClass: Record<string, number> = {};
    for (const o of r.dispatched) byClass[o.responseClass] = (byClass[o.responseClass] ?? 0) + 1;
    // Telegram replies whose turn ended without an answer get its last message.
    const replies = await sweepUnansweredReplies().catch((err) => ({ error: (err as Error).message }));
    return { swept: r.swept, expired_decisions: r.expiredDecisions, dispatched: r.dispatched.length, by_class: byClass, reconciled: r.reconciled, owner_replies: replies };
  });
}

export const GET = handle;
export const POST = handle;
