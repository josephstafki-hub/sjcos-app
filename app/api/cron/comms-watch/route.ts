import { NextResponse } from "next/server";
import { runTendlcWatch } from "@/lib/tendlc-watch";
import { reportCommsFailure, runCommsHealthCheck, sweepStaleCalls } from "@/lib/comms-health";

// POST/GET /api/cron/comms-watch — the fifth systemd timer (daily; see
// deploy/sjcos-comms-watch.*). Three things, each of which files a work item
// and pushes Joe on trouble rather than logging into the void:
//   1. 10DLC registration watch: brand vetting score + campaign carrier
//      status vs the last stored snapshot (lib/tendlc-watch.ts). Rejection
//      is loud.
//   2. Comms health: env validation naming every missing var, Telnyx
//      reachability for the messaging profile + call-control app, webhook
//      freshness (lib/comms-health.ts).
//   3. Stale call sweep: transcripts that never arrived, calls that never
//      hung up.
// Gated by CRON_SECRET bearer, failing closed, like the other four. ?dry=1
// computes without writing.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  const tendlc = await runTendlcWatch({ dryRun });
  const health = await runCommsHealthCheck({ probe: true });
  if (!health.ok && !dryRun) {
    await reportCommsFailure("health", new Error(health.problems.join(" | ")), {
      detail: "Daily comms health check found problems. GET /api/comms/health for the full report.",
    });
  }
  const sweep = await sweepStaleCalls({ dryRun });

  return NextResponse.json({
    ok: health.ok,
    ran_at: new Date().toISOString(),
    dryRun,
    tendlc,
    health: { ok: health.ok, problems: health.problems, webhooks: health.webhooks, telnyx: health.telnyx },
    sweep,
  });
}

export const GET = handle;
export const POST = handle;
