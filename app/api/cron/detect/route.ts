import { NextResponse } from "next/server";
import { runDetectors } from "@/lib/detectors";
import { refreshTextSummaries } from "@/lib/comms-summaries";
import { cronAuthorized, runCronJob } from "../_lib/guard";

// POST/GET /api/cron/detect — the W1 detector sweep (see lib/detectors.ts).
// Machine-triggered by the sjcos-detect systemd user timer (deploy/README)
// hourly at :20. Not session-gated (the proxy matcher excludes /api);
// protected by the same shared CRON_SECRET as the other cron routes.
// force-dynamic so it never caches. Pass ?dry=1 to compute + return what
// WOULD be filed/bumped/resolved without writing — used for the go-live
// review of first-run volume, and safe to reuse any time a threshold changes.
//
// Failures (incl. a Gmail quota hit in the needs-reply scan) go through
// runCronJob: one log line + a notifications row, never an unhandled stack.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  return runCronJob("detector sweep", async () => {
    const result = await runDetectors({ dryRun });
    // Shared text-conversation summaries for the record pages (lib/comms-summaries.ts).
    // Best-effort: a summary failure never fails the sweep.
    const textSummaries = await refreshTextSummaries({ dryRun }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    return { ...result, textSummaries };
  });
}

export const GET = handle;
export const POST = handle;
