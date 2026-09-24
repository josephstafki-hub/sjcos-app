import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cronAuthorized } from "@/app/api/cron/_lib/guard";
import { workerHealth } from "@/lib/worker/health";
import { backupHealth } from "@/lib/backup/status";
import { latestBackupRuns } from "@/lib/backup/runs";
import { listLanePauses } from "@/lib/commands/policies";

// GET /api/health/deep — CRON_SECRET bearer. The full worker/queue report
// (lib/worker/health.ts) plus backup health (lib/backup/status.ts) and lane
// pauses. Used by the monitor when the app is up and by the monitoring page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const run = async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => (await query(sql, params as never[])).rows as T[];
  try {
    const [worker, runs, lanes] = await Promise.all([workerHealth(run), latestBackupRuns(run), listLanePauses(run)]);
    const backups = backupHealth(runs);
    const problems = [...worker.problems, ...backups.problems];
    return NextResponse.json({ ok: problems.length === 0, at: new Date().toISOString(), problems, worker, backups, lane_pauses: lanes });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message.slice(0, 300) }, { status: 503 });
  }
}
