// Internal bridge (MCP → app) for the W6 RUNBOOK STEPPER (v2, A02/A04). The
// MCP server runs in its own process and can't import lib/runbook-engine.ts
// (TS, plus the agent-ping machinery), so its runbook writes land here —
// same shape as the notify-owner bridge. Bearer-gated with CRON_SECRET
// (trusted local caller).
//
// Actions:
//   start     — start_runbook MCP tool: start a runbook against one lead/project
//               (slug or id). Refuses politely when an instance is already live.
//   advance   — after the MCP update_work_item_status / submit_draft_for_approval
//               handlers touch a runbook step item; no-op for ordinary items.
//   complete  — evidence-backed completion (lib/completion/complete.ts):
//               { work_item_id, evidence, agent?, on_behalf_of_user_id?, run_id?,
//                 agent_run_id?, note? }. Validates the evidence, writes the
//               receipt, flips done and advances the runbook in ONE transaction.
//   repair    — { dry_run (default true), limit } → repairRunbookInstances.
//   drain     — deliver pending runbook_wakeups (recovery path for a crashed
//               post-commit ping); timers may call this.
//
// Deliberately NO cancel action — cancelling an instance is owner-only in the
// app UI (lib/actions/engine.ts cancelRunbook).

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { withTransaction, agentPrincipal, servicePrincipal } from "@/lib/commands/db";
import { startRunbook, maybeAdvanceRunbook, repairRunbookInstances, drainRunbookWakeups } from "@/lib/runbook-engine";
import { completeWorkItem, type CompletionEvidence } from "@/lib/completion/complete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function slugToId(table: "leads" | "projects", slug: string | undefined): Promise<string | null> {
  if (!slug) return null;
  const row = await queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
  return row?.id ?? null;
}

export async function POST(req: Request) {
  const service = servicePrincipal(req, "internal:runbooks");
  if (!service) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

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
          return NextResponse.json({ ok: false, error: "lead_slug/project_slug required (or did not match a record)" }, { status: 400 });
        }
        const r = await startRunbook(runbookSlug, { leadId, projectId }, str("started_by") ?? "agent");
        return NextResponse.json(r.ok ? { ok: true, instance_id: r.instanceId, work_item_id: r.workItemId } : { ok: false, error: r.error });
      }
      case "advance": {
        const workItemId = str("work_item_id");
        if (!workItemId) return NextResponse.json({ ok: false, error: "work_item_id required" }, { status: 400 });
        await maybeAdvanceRunbook(workItemId);
        return NextResponse.json({ ok: true });
      }
      case "complete": {
        const workItemId = str("work_item_id");
        if (!workItemId) return NextResponse.json({ ok: false, error: "work_item_id required" }, { status: 400 });
        const evidence = body.evidence as CompletionEvidence | undefined;
        if (!evidence || typeof evidence !== "object") return NextResponse.json({ ok: false, error: "evidence object required" }, { status: 400 });
        // The agent is data; its authority comes from the user it acts for,
        // looked up server-side (an unknown id = unattended agent).
        const principal = str("agent")
          ? await agentPrincipal(str("agent")!, { onBehalfOfUserId: str("on_behalf_of_user_id") ?? null, runId: str("run_id") ?? null })
          : service;
        const r = await withTransaction((run) =>
          completeWorkItem(run, { workItemId, principal, evidence, agentRunId: str("agent_run_id") ?? null, note: str("note") ?? null }),
        );
        if (r.ok && r.runbook?.outcome === "advanced") await drainRunbookWakeups();
        return NextResponse.json(
          r.ok
            ? { ok: true, work_item_id: r.workItemId, receipt_id: r.receiptId, already_done: r.alreadyDone, legacy: r.legacy, required_evidence: r.required, runbook: r.runbook, obligation_id: r.obligationId }
            : { ok: false, error: r.error, required_evidence: r.required ?? null },
        );
      }
      case "repair": {
        const dryRun = body.dry_run === undefined ? true : Boolean(body.dry_run);
        const limit = body.limit == null ? undefined : Number(body.limit);
        const report = await repairRunbookInstances({ dryRun, limit, by: str("by") ?? "internal:runbooks" });
        return NextResponse.json({ ok: true, ...report });
      }
      case "drain": {
        const out = await drainRunbookWakeups(body.limit == null ? 20 : Number(body.limit));
        return NextResponse.json({ ok: true, ...out });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
