// Internal bridge (MCP → app) for the W6 RUNBOOK STEPPER. The MCP server runs
// in its own process and can't import lib/runbook-engine.ts (TS, plus the
// agent-ping machinery), so its runbook writes land here — same shape as the
// notify-owner bridge. Bearer-gated with CRON_SECRET (trusted local caller).
//
// Actions:
//   start   — start_runbook MCP tool: start a runbook against one lead/project
//             (slug or id). Refuses politely when an instance is already live.
//   advance — after the MCP update_work_item_status / submit_draft_for_approval
//             handlers touch a runbook step item; no-op for ordinary items.
//
// Deliberately NO cancel action — cancelling an instance is owner-only in the
// app UI (lib/actions/engine.ts cancelRunbook).

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { startRunbook, maybeAdvanceRunbook } from "@/lib/runbook-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function slugToId(table: "leads" | "projects", slug: string | undefined): Promise<string | null> {
  if (!slug) return null;
  const row = await queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
  return row?.id ?? null;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const str = (k: string) => (body[k] == null ? undefined : String(body[k]));
  try {
    switch (action) {
      case "start": {
        const runbookSlug = str("runbook_slug");
        if (!runbookSlug) return NextResponse.json({ ok: false, error: "runbook_slug required" }, { status: 400 });
        const leadId = str("lead_id") ?? (await slugToId("leads", str("lead_slug")));
        const projectId = str("project_id") ?? (await slugToId("projects", str("project_slug")));
        if (!leadId && !projectId) {
          return NextResponse.json(
            { ok: false, error: "lead_slug/project_slug required (or did not match a record)" },
            { status: 400 },
          );
        }
        const r = await startRunbook(runbookSlug, { leadId, projectId }, str("started_by") ?? "agent");
        return NextResponse.json(
          r.ok ? { ok: true, instance_id: r.instanceId, work_item_id: r.workItemId } : { ok: false, error: r.error },
        );
      }
      case "advance": {
        const workItemId = str("work_item_id");
        if (!workItemId) return NextResponse.json({ ok: false, error: "work_item_id required" }, { status: 400 });
        await maybeAdvanceRunbook(workItemId);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
