import { NextResponse } from "next/server";
import { runDetectors } from "@/lib/detectors";

// POST/GET /api/cron/detect — the W1 detector sweep (see lib/detectors.ts).
// Machine-triggered by the sjcos-detect systemd user timer (deploy/README)
// hourly at :20. Not session-gated (the proxy matcher excludes /api);
// protected by the same shared CRON_SECRET as the other cron routes.
// force-dynamic so it never caches. Pass ?dry=1 to compute + return what
// WOULD be filed/bumped/resolved without writing — used for the go-live
// review of first-run volume, and safe to reuse any time a threshold changes.
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
  const result = await runDetectors({ dryRun });
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
