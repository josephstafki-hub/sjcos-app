// Internal bridge (MCP → app) for the one estimating step that needs the
// app's SSRF-guarded product-page fetcher: online price research. Every other
// estimating tool runs directly against the database in the MCP process.
// Bearer-gated with CRON_SECRET like the other internal routes.

import { NextResponse } from "next/server";
import { servicePrincipal, withTransaction } from "@/lib/commands/db";
import { researchPrice } from "@/lib/estimating/pricing";
import { chooseFetcher } from "@/lib/estimating/fetcher";
import { liveFetcher } from "@/lib/estimating/fetcher-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const svc = servicePrincipal(req, "mcp:estimating");
  if (!svc) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  try {
    if (action === "research_price") {
      const input = body.input as Parameters<typeof researchPrice>[1];
      const out = await withTransaction((run) => researchPrice(run, input, chooseFetcher(liveFetcher)));
      return NextResponse.json({ ok: true, ...out, fetcher: "live" });
    }
    return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
