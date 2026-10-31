// A screenshot the posting agent took during a run (before and after it
// pressed Post), so Joe can see what went up. Owner only.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { readJournal, runDir } from "@/lib/publisher/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ intentId: string; shot: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "owner") return new Response("owner only", { status: 403 });
  const { intentId, shot } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(intentId) || !/^[\w-]+\.jpg$/.test(shot)) return new Response("Not found", { status: 404 });
  const j = readJournal(intentId);
  if (!j?.shots.includes(shot)) return new Response("Not found", { status: 404 });
  const buf = await readFile(path.join(runDir(intentId), path.basename(shot))).catch(() => null);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
