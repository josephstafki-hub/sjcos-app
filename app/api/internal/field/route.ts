// Internal bridge (MCP → app) for WS-field and WS-closeout commands (A16,
// A17, WORKFLOW W09–W12). The MCP server runs in its own process and the
// field/closeout libraries need the app-bound hooks (funding, billing,
// owner pushes after commit), so their writes land here. Bearer-gated with
// CRON_SECRET like the other internal routes; the person behind the agent
// (principal_user_id) is resolved server-side into the acting principal.

import { NextResponse } from "next/server";
import { agentPrincipal, servicePrincipal, withTransaction } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { boundFieldHooks, recordSubProgressCmd, completionReportCmd, reportSnagCmd, applySnagDecisionCmd, compileWeeklySubReportCmd } from "@/lib/field/server";
import { prepareTentativeSchedule, submitScheduleForApproval, confirmSchedule, adjustInternalSchedule, listPlans, planBuyout as planFieldBuyout } from "@/lib/field/schedule-plans";
import { listFieldReports } from "@/lib/field/reports";
import { openIncidents } from "@/lib/field/incidents";
import { assembleWeeklyContent, listPublishedSummaries } from "@/lib/field/weekly-summary";
import { centralWeekStart } from "@/lib/field/dates";
import { prepareInternalInspectionCmd, confirmCorrectionsCmd, scheduleWalkthroughCmd, checkInReplyCmd, recordCloseoutActualsCmd } from "@/lib/closeout/server";
import { recordCorrection, recordClientPunch, resolveClientPunch, closeoutOverview } from "@/lib/closeout/checklist";
import { activePolicy, policyRef } from "@/lib/commands/policies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const svc = servicePrincipal(req, "mcp:field");
  if (!svc) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const str = (k: string) => (body[k] == null ? undefined : String(body[k]));
  const principal: Principal = await agentPrincipal(str("agent") ?? "mcp", { onBehalfOfUserId: str("principal_user_id") ?? null, runId: str("run_id") ?? null });
  const projectId = str("project_id");
  try {
    switch (action) {
      // ── field ────────────────────────────────────────────────────────
      case "record_progress":
        return NextResponse.json(await recordSubProgressCmd(principal, body.input as Parameters<typeof recordSubProgressCmd>[1]));
      case "completion_report":
        return NextResponse.json(await completionReportCmd(principal, body.input as Parameters<typeof completionReportCmd>[1]));
      case "report_snag":
        return NextResponse.json(await reportSnagCmd(principal, body.input as Parameters<typeof reportSnagCmd>[1]));
      case "apply_snag_decision":
        return NextResponse.json(await applySnagDecisionCmd(principal, body.input as Parameters<typeof applySnagDecisionCmd>[1]));
      case "compile_weekly_report":
        return NextResponse.json(await compileWeeklySubReportCmd(principal, body.input as Parameters<typeof compileWeeklySubReportCmd>[1]));
      case "list_reports":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json({ ok: true, reports: await withTransaction((run) => listFieldReports(run, projectId, { weekStart: str("week_start"), subSlug: str("sub_slug"), limit: 100 })), incidents: await withTransaction((run) => openIncidents(run, projectId)) });
      case "weekly_content": {
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        const out = await withTransaction(async (run) => {
          const ws = str("week_start") ?? (await centralWeekStart(run));
          return { week_start: ws, content: await assembleWeeklyContent(run, projectId, ws), published: await listPublishedSummaries(run, projectId, 8) };
        });
        return NextResponse.json({ ok: true, ...out });
      }
      // ── schedule (W09/W10) ───────────────────────────────────────────
      case "prepare_schedule": {
        const { hooks, flush } = boundFieldHooks();
        const plan = await withTransaction((run) => prepareTentativeSchedule(run, principal, body.input as Parameters<typeof prepareTentativeSchedule>[2], hooks));
        await flush();
        return NextResponse.json({ ok: true, plan });
      }
      case "submit_schedule": {
        const out = await withTransaction((run) => submitScheduleForApproval(run, principal, String(body.plan_id ?? "")));
        return NextResponse.json({ ok: true, ...out });
      }
      case "confirm_schedule": {
        const { hooks, flush } = boundFieldHooks();
        const out = await withTransaction((run) => confirmSchedule(run, String(body.plan_id ?? ""), hooks, (body.commitments as Parameters<typeof confirmSchedule>[3]) ?? []));
        await flush();
        return NextResponse.json(out);
      }
      case "adjust_schedule": {
        const { hooks, flush } = boundFieldHooks();
        const out = await withTransaction(async (run) => {
          const pol = await activePolicy(run, "schedule.internal_adjust");
          return adjustInternalSchedule(run, principal, body.input as Parameters<typeof adjustInternalSchedule>[2], hooks, pol ? policyRef(pol) : null);
        });
        await flush();
        return NextResponse.json(out);
      }
      case "list_plans":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json({ ok: true, plans: await withTransaction((run) => listPlans(run, projectId)) });
      case "plan_buyout_dates":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json({ ok: true, obligations: await withTransaction((run) => planFieldBuyout(run, { projectId, planId: str("plan_id") ?? null, items: (body.items as Parameters<typeof planFieldBuyout>[1]["items"]) ?? [] })) });
      // ── closeout (W12) ───────────────────────────────────────────────
      case "closeout_overview":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json({ ok: true, checklists: await withTransaction((run) => closeoutOverview(run, projectId)) });
      case "prepare_inspection":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json(await prepareInternalInspectionCmd(principal, projectId));
      case "record_correction":
        return NextResponse.json({ ok: true, checklist: await withTransaction((run) => recordCorrection(run, body.input as Parameters<typeof recordCorrection>[1])) });
      case "confirm_corrections":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json(await confirmCorrectionsCmd(principal, projectId));
      case "schedule_walkthrough":
        if (!projectId) return NextResponse.json({ ok: false, error: "project_id required" }, { status: 400 });
        return NextResponse.json(await scheduleWalkthroughCmd(principal, projectId, String(body.at ?? "")));
      case "record_client_punch":
        return NextResponse.json({ ok: true, checklist: await withTransaction((run) => recordClientPunch(run, body.input as Parameters<typeof recordClientPunch>[1])) });
      case "resolve_client_punch":
        return NextResponse.json({ ok: true, checklist: await withTransaction((run) => resolveClientPunch(run, body.input as Parameters<typeof resolveClientPunch>[1])) });
      case "checkin_reply":
        return NextResponse.json(await checkInReplyCmd(principal, body.input as Parameters<typeof checkInReplyCmd>[1]));
      case "record_actuals":
        return NextResponse.json(await recordCloseoutActualsCmd(principal, body.input as Parameters<typeof recordCloseoutActualsCmd>[1]));
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
