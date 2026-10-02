import { NextResponse } from "next/server";
import { cronAuthorized, runCronJob } from "@/app/api/cron/_lib/guard";
import { runQboSync } from "@/lib/accounting/server";

// GET/POST /api/cron/qbo-sync — QuickBooks Online sync pass (A14). Imports
// posted entities from the cursor (a DRY RUN until the owner turns
// `import_read` on), then mirrors issued invoices / settled payments that
// have no mapping — each direction only when its switch is on. The adapter
// is fake until the Intuit credentials exist, so this is safe to run any
// time. Protected by CRON_SECRET. `?dry=1` forces a dry run.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return runCronJob("quickbooks sync", async () => {
    const r = await runQboSync({ dryRun: dry ? true : undefined });
    return { environment: r.environment, dry_run: r.import.dryRun, kinds: r.import.kinds, conflicts: r.import.conflicts.length, exported: r.exported };
  });
}

export const GET = handle;
export const POST = handle;
