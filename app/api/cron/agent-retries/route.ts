import { NextResponse } from "next/server";
import { retryFailedApprovalPings } from "@/lib/dev-agents";
import { autoSettleQuietThreads } from "@/lib/thread-folders";

// POST/GET /api/cron/agent-retries — periodic sweep that re-pings a work
// item's owner agent (Hermes/Claude) when the approval-ping from
// notifyAgentOwner() errored out. Machine-triggered by the systemd user timer
// (see deploy/README). Not session-gated (the proxy matcher excludes /api);
// protected by a shared secret in the Authorization header instead.
// force-dynamic so it never caches.
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
  const result = await retryFailedApprovalPings();
  // Panel thread auto-settle (docs/thread-folders-plan.md §3.3) shares this
  // 10-minute timer so quiet threads settle even when nobody is polling.
  const threads = await autoSettleQuietThreads({ force: true }).catch(() => ({ settled: 0 }));
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result, threads_settled: threads.settled });
}

export const GET = handle;
export const POST = handle;
