import { NextResponse } from "next/server";
import { retryFailedApprovalPings } from "@/lib/dev-agents";

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
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
