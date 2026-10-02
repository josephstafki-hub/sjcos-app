import "server-only";

// W6 runbook stepper — v2 (A02). A runbook_instance is one live walk through a
// runbook against one lead or project. The engine spawns exactly ONE work
// item per step. The transactional core lives in lib/completion/runbook-core.ts
// (pure, harness-tested); this file binds it to the pool and delivers the
// wakeups after commit:
//
//   startRunbook()           → ONE transaction: instance + pinned definition
//                              version + step-1 work item + wakeup row
//   maybeAdvanceRunbook()    → called from EVERY work-item completion path
//                              (owner UI actions, orchestrator executors, and
//                              — via app/api/internal/runbooks — the MCP
//                              server); no-op unless the item carries a
//                              runbook_instance_id
//   advanceRunbookInstance() → ONE transaction: lock instance, validate the
//                              pinned definition + predecessor evidence,
//                              insert the uniquely keyed successor, update
//                              progress, record the wakeup
//   drainRunbookWakeups()    → AFTER commit: ping the agent / push Joe from
//                              the runbook_wakeups outbox (retried by polling)
//   repairRunbookInstances() → bounded, logged, dry-runnable missing-step repair
//
// Editing a runbook's steps never changes a live instance (it reads its
// pinned version). A legacy instance with no pinned version or a missing
// definition goes to repair_state 'needs_review' — never to a false 'done'.

import { query } from "@/lib/db";
import { withTransaction } from "@/lib/commands/db";
import { pingAgentWorkItem } from "@/lib/dev-agents";
import { notifyOwner } from "@/lib/notify-owner";
import {
  advanceRunbookTx,
  cancelRunbookInstanceTx,
  claimWakeups,
  finishWakeup,
  repairRunbookInstancesTx,
  startRunbookTx,
  type AdvanceOutcome,
  type RepairReport,
  type RunbookInstanceStatus,
  type StartRunbookResult,
} from "@/lib/completion/runbook-core";

export type { RunbookInstanceStatus, StartRunbookResult, AdvanceOutcome, RepairReport };

/** Start a runbook against one lead or project. Refuses (rather than throws)
 *  when an active instance of that runbook already exists for the target. */
export async function startRunbook(
  runbookSlug: string,
  target: { leadId?: string | null; projectId?: string | null },
  startedBy: string,
): Promise<StartRunbookResult> {
  let result: StartRunbookResult;
  try {
    result = await withTransaction((run) => startRunbookTx(run, runbookSlug, target, startedBy));
  } catch (err) {
    // Belt and braces: the advisory lock serializes starts, but the partial
    // unique index is the last line of defence.
    if ((err as { code?: string }).code === "23505") return { ok: false, error: `Runbook "${runbookSlug}" is already running for that target.` };
    throw err;
  }
  if (result.ok) await drainRunbookWakeups();
  return result;
}

/** Judge the current step's work item and move the instance accordingly, in
 *  one transaction. Idempotent: re-judging an already-advanced step is a
 *  no-op (the step-log unique key means only one caller ever spawns a step). */
export async function advanceRunbookInstance(instanceId: string): Promise<AdvanceOutcome> {
  const out = await withTransaction((run) => advanceRunbookTx(run, instanceId));
  if (out.outcome === "advanced") await drainRunbookWakeups();
  return out;
}

/** The completion-path hook: no-op unless the work item belongs to a runbook
 *  instance. Never throws — advancing is bookkeeping around a status change
 *  that already committed. */
export async function maybeAdvanceRunbook(workItemId: string): Promise<void> {
  try {
    const { rows } = await query<{ runbook_instance_id: string | null }>(`SELECT runbook_instance_id FROM work_items WHERE id = $1`, [workItemId]);
    const instanceId = rows[0]?.runbook_instance_id;
    if (!instanceId) return;
    await advanceRunbookInstance(instanceId);
  } catch (err) {
    console.error("[runbook-engine] advance failed", err);
  }
}

/** Owner-only (via lib/actions/engine.ts): cancel an instance and close out
 *  its open step work items so nothing orphaned stays in the queue. */
export async function cancelRunbookInstance(instanceId: string, note = "Cancelled by owner."): Promise<void> {
  await withTransaction((run) => cancelRunbookInstanceTx(run, instanceId, note));
}

/** Recreate the missing current-step work item of live instances. Dry-run by
 *  default; every decision is logged to runbook_repairs either way. */
export async function repairRunbookInstances(opts: { dryRun?: boolean; limit?: number; by?: string } = {}): Promise<RepairReport> {
  const report = await withTransaction((run) => repairRunbookInstancesTx(run, { dryRun: opts.dryRun ?? true, limit: opts.limit, by: opts.by ?? "repair" }));
  if (!report.dryRun && report.actions.some((a) => a.action === "recreate_step")) await drainRunbookWakeups();
  return report;
}

/** Deliver pending wakeups: agent pings via pingAgentWorkItem (same machinery
 *  as approval pings) and Joe's pushes via notifyOwner (W3). Each row is
 *  claimed under its own short transaction, delivered outside it, and marked
 *  sent / left pending for the next drain (up to 5 attempts). Safe to call
 *  from a timer as the recovery path for a crashed post-commit. */
export async function drainRunbookWakeups(limit = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  let rows;
  try {
    rows = await withTransaction((run) => claimWakeups(run, limit));
  } catch (err) {
    console.error("[runbook-engine] wakeup claim failed", err);
    return { sent, failed };
  }
  for (const w of rows) {
    if (w.state === "failed") {
      failed++;
      continue;
    }
    let ok = true;
    let error: string | null = null;
    try {
      const p = w.payload as Record<string, string | undefined>;
      if (w.kind === "agent_ping") {
        if (!w.work_item_id) throw new Error("wakeup has no work item");
        await pingAgentWorkItem(w.work_item_id, p.assignee_key ?? "hermes-telegram", p.title ?? "Runbook step", p.prompt ?? "", p.page_context);
      } else {
        // notifyOwner never throws; quiet hours / throttle park to push_outbox.
        await notifyOwner({ kind: "urgent_item", title: p.title ?? "Runbook step for you", body: p.body, href: p.href });
      }
    } catch (err) {
      ok = false;
      error = (err as Error).message ?? String(err);
      console.error("[runbook-engine] wakeup delivery failed (will retry on next drain)", err);
    }
    try {
      await withTransaction((run) => finishWakeup(run, w.id, ok, error));
    } catch (err) {
      console.error("[runbook-engine] wakeup bookkeeping failed", err);
    }
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

// ─── Read views (/engine block + lead/project badges) ────────────────────────

export interface RunbookInstanceView {
  id: string;
  runbookSlug: string;
  runbookTitle: string;
  status: RunbookInstanceStatus;
  currentStep: number;
  stepCount: number;
  currentStepTitle: string | null;
  startedAt: string;
  startedBy: string;
  targetKind: "lead" | "project" | null;
  targetSlug: string | null;
  targetName: string | null;
  repairState: string;
  blockedReason: string | null;
  definitionVersion: number | null;
}

interface InstanceViewRow {
  id: string;
  runbook_slug: string;
  runbook_title: string;
  status: RunbookInstanceStatus;
  current_step: number;
  step_count: number;
  current_step_title: string | null;
  started_at: string;
  started_by: string;
  lead_slug: string | null;
  lead_name: string | null;
  project_slug: string | null;
  project_name: string | null;
  repair_state: string;
  blocked_reason: string | null;
  definition_version: number | null;
}

// Step count / titles come from the PINNED version when the instance has one,
// so a runbook edited after the start still reads as the walk it is on.
const INSTANCE_VIEW_SQL = `
  SELECT i.id, i.runbook_slug, COALESCE(v.title, r.title, i.runbook_slug) AS runbook_title,
         i.status, i.current_step, i.started_at::text AS started_at, i.started_by,
         i.repair_state, i.blocked_reason, v.version AS definition_version,
         COALESCE(
           CASE WHEN v.id IS NOT NULL THEN jsonb_array_length(v.steps) END,
           (SELECT count(*)::int FROM runbook_steps s WHERE s.runbook_id = i.runbook_id), 0) AS step_count,
         COALESCE(
           (SELECT e->>'title' FROM jsonb_array_elements(COALESCE(v.steps, '[]'::jsonb)) e
             WHERE (e->>'step_order')::int = i.current_step LIMIT 1),
           (SELECT s.title FROM runbook_steps s WHERE s.runbook_id = i.runbook_id AND s.step_order = i.current_step)) AS current_step_title,
         l.slug AS lead_slug, l.name AS lead_name,
         p.slug AS project_slug, p.name AS project_name
    FROM runbook_instances i
    LEFT JOIN runbook_definition_versions v ON v.id = i.definition_version_id
    LEFT JOIN runbooks r ON r.id = i.runbook_id
    LEFT JOIN leads l    ON l.id = i.lead_id
    LEFT JOIN projects p ON p.id = i.project_id`;

function rowToInstanceView(r: InstanceViewRow): RunbookInstanceView {
  return {
    id: r.id,
    runbookSlug: r.runbook_slug,
    runbookTitle: r.runbook_title,
    status: r.status,
    currentStep: r.current_step,
    stepCount: r.step_count,
    currentStepTitle: r.current_step_title,
    startedAt: r.started_at,
    startedBy: r.started_by,
    targetKind: r.lead_slug ? "lead" : r.project_slug ? "project" : null,
    targetSlug: r.lead_slug ?? r.project_slug,
    targetName: r.lead_name ?? r.project_name,
    repairState: r.repair_state,
    blockedReason: r.blocked_reason,
    definitionVersion: r.definition_version,
  };
}

/** All non-terminal instances, newest first (the /engine "Active runbooks" block). */
export async function getActiveRunbookInstances(): Promise<RunbookInstanceView[]> {
  const { rows } = await query<InstanceViewRow>(
    `${INSTANCE_VIEW_SQL}
      WHERE i.status NOT IN ('done','cancelled')
      ORDER BY i.started_at DESC`,
  );
  return rows.map(rowToInstanceView);
}

/** Non-terminal instances on one lead/project (the detail-page badge). */
export async function getActiveRunbookInstancesFor(kind: "lead" | "project", slug: string): Promise<RunbookInstanceView[]> {
  const { rows } = await query<InstanceViewRow>(
    `${INSTANCE_VIEW_SQL}
      WHERE i.status NOT IN ('done','cancelled') AND ${kind === "lead" ? "l.slug" : "p.slug"} = $1
      ORDER BY i.started_at DESC`,
    [slug],
  );
  return rows.map(rowToInstanceView);
}
