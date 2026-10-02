import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { query } from "@/lib/db";

// GET /api/health — unauthenticated, minimal liveness + version surface for
// the independent monitor (scripts/sjcos-monitor.sh) and an external cron.
// Answers 200 only when the database answers; 503 otherwise. Exposes NO
// secrets, NO business data: code version, schema ledger head, active policy
// versions, worker heartbeat age and DB readiness. The deep report (queues,
// backups, cron ledger) is behind CRON_SECRET at /api/health/deep.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedVersion: { sha: string; build_id: string } | null = null;

function codeVersion(): { sha: string; build_id: string } {
  if (cachedVersion) return cachedVersion;
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8").trim();
    } catch {
      return "";
    }
  };
  const dist = process.env.SJC_DIST_DIR || ".next";
  const build_id = read(path.join(process.cwd(), dist, "BUILD_ID"));
  let sha = (process.env.SJC_GIT_SHA ?? "").trim();
  if (!sha) {
    const head = read(path.join(process.cwd(), ".git", "HEAD"));
    if (/^[0-9a-f]{40}$/.test(head)) sha = head;
    else if (head.startsWith("ref: ")) sha = read(path.join(process.cwd(), ".git", head.slice(5)));
    else if (head) {
      // worktree: .git is a file "gitdir: <path>"
      const gitdir = read(path.join(process.cwd(), ".git")).replace(/^gitdir:\s*/, "");
      const h = gitdir ? read(path.join(gitdir, "HEAD")) : "";
      sha = h.startsWith("ref: ") ? read(path.join(gitdir, "..", "..", h.slice(5))) : h;
    }
  }
  cachedVersion = { sha: sha.slice(0, 12), build_id };
  return cachedVersion;
}

export async function GET() {
  const startedAt = Date.now();
  const version = codeVersion();
  try {
    const [ledger, policies, workers] = await Promise.all([
      query<{ head: number | null; n: number }>(`SELECT max(id)::int AS head, count(*)::int AS n FROM schema_migrations`),
      query<{ key: string; version: number }>(`SELECT key, version FROM policies WHERE state = 'active' ORDER BY key`),
      query<{ name: string; state: string; version: string; age: number }>(
        `SELECT name, state, version, EXTRACT(EPOCH FROM (now() - heartbeat_at))::int AS age FROM workers ORDER BY name`,
      ),
    ]);
    const worker = workers.rows.find((w) => w.name === "sjcos-worker") ?? workers.rows[0] ?? null;
    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      code: version,
      schema: { head: ledger.rows[0]?.head ?? null, applied: ledger.rows[0]?.n ?? 0 },
      policies: Object.fromEntries(policies.rows.map((p) => [p.key, p.version])),
      worker: worker ? { name: worker.name, state: worker.state, version: worker.version, heartbeat_age_s: Number(worker.age) } : null,
      db: { ready: true, latency_ms: Date.now() - startedAt },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, at: new Date().toISOString(), code: version, db: { ready: false, error: (err as Error).message.slice(0, 200) } },
      { status: 503 },
    );
  }
}
