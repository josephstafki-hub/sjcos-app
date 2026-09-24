import "server-only";

// Next.js binding for lib/field: wraps the pure functions in typed commands
// over the shared pool, binds the injected hooks to the real modules, and
// defers owner pushes until after COMMIT.
//
// Hooks the integration owner should re-point once the sibling workstreams
// land (see docs/automation-reliability/status/A16.md):
//   fundingAvailable        → lib/funding (WS-procurement)
//   initialPaymentReceived  → lib/billing (WS-money)         [default reads invoices/invoice_payments]
//   onMilestoneConfirmed    → lib/billing issue_progress_on_owner_confirmation (WS-money)
//   createFollowUp          → lib/obligations (WS-recovery)  [default: a work_items row]

import { command, withTransaction, ownerPrincipalForPolicy } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { notifyOwner } from "@/lib/notify-owner";
import type { Run } from "@/lib/commands/core";
import { defaultFieldHooks, type FieldHooks, type OwnerAlert } from "./hooks";
import { recordSubProgress, completionReportReceived, compileWeeklySubReport, type RecordProgressInput, type CompletionInput } from "./reports";
import { reportSnag, applyOwnerSnagDecision, type SnagInput, type SnagChoice } from "./incidents";
import { buildWeeklyClientSummary, dueWeeklySummaries } from "./weekly-summary";
import { sweepApprovedFieldDecisions } from "./apply-decisions";

/** Default follow-up creator: a work item on the project (WS-recovery's
 *  obligations engine can replace this by re-binding the hook). Deduped on
 *  source_id so a repeated call never files twice. */
async function defaultCreateFollowUp(run: Run, req: Parameters<FieldHooks["createFollowUp"]>[1]): Promise<string | null> {
  const [existing] = await run<{ id: string }>(`SELECT id FROM work_items WHERE source_kind = 'field' AND source_id = $1 AND status NOT IN ('done','cancelled') LIMIT 1`, [req.dedupeKey]);
  if (existing) return existing.id;
  const [row] = await run<{ id: string }>(
    `INSERT INTO work_items (title, body, status, priority, assignee_kind, assignee_key, project_id, source_kind, source_id, requires_approval, created_by)
     VALUES ($1, $2, $3, $4, 'human', 'human-joe', $5, 'field', $6, false, 'field')
     RETURNING id`,
    [req.title, req.body, req.audience === "sub" ? "waiting_on_sub" : "queued", req.priority ?? "normal", req.projectId, req.dedupeKey],
  );
  return row?.id ?? null;
}

/** Build hooks whose owner pushes are parked until `flush()` (post-commit). */
export function boundFieldHooks(overrides: Partial<FieldHooks> = {}): { hooks: FieldHooks; flush: () => Promise<void> } {
  const parked: OwnerAlert[] = [];
  const hooks = defaultFieldHooks({
    createFollowUp: defaultCreateFollowUp,
    notifyOwner: async (a) => {
      parked.push(a);
    },
    ...overrides,
  });
  const flush = async () => {
    for (const a of parked.splice(0)) {
      try {
        await notifyOwner({ kind: a.kind, title: a.title, body: a.body, href: a.href });
      } catch (err) {
        console.error("[field] owner push failed:", (err as Error).message);
      }
    }
  };
  return { hooks, flush };
}

export async function recordSubProgressCmd(principal: Principal, input: RecordProgressInput) {
  const key = input.clientEventId ? `field_report:${input.projectId}:${input.clientEventId}` : `field_report:${input.projectId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return command({ name: "field.record_progress", requestKey: key, input, principal }, async ({ run }) => ({ result: await recordSubProgress(run, principal, input) }));
}

export async function completionReportCmd(principal: Principal, input: CompletionInput) {
  const { hooks, flush } = boundFieldHooks();
  const key = `field_completion:${input.projectId}:${input.milestoneKey}:${input.clientEventId ?? Date.now()}`;
  return command({ name: "field.completion_report", requestKey: key, input, principal }, async ({ run }) => ({
    result: await completionReportReceived(run, principal, input, hooks),
    afterCommit: [flush],
  }));
}

export async function reportSnagCmd(principal: Principal, input: SnagInput) {
  const { hooks, flush } = boundFieldHooks();
  const key = `field_snag:${input.projectId}:${input.clientEventId ?? Date.now()}`;
  return command({ name: "field.report_snag", requestKey: key, input, principal }, async ({ run }) => ({
    result: await reportSnag(run, principal, input, hooks),
    afterCommit: [flush],
  }));
}

export async function applySnagDecisionCmd(principal: Principal, input: { incidentId: string; choice: SnagChoice; instructions?: string }) {
  const { hooks, flush } = boundFieldHooks();
  return command({ name: "field.apply_snag_decision", requestKey: `snag_apply:${input.incidentId}:${input.choice}`, input, principal }, async ({ run }) => ({
    result: await applyOwnerSnagDecision(run, principal, input, hooks),
    afterCommit: [flush],
  }));
}

export async function compileWeeklySubReportCmd(principal: Principal, input: { projectId: string; subSlug: string; weekStart?: string }) {
  const { hooks, flush } = boundFieldHooks();
  return command({ name: "field.compile_weekly_sub_report", requestKey: `weekly_sub:${input.projectId}:${input.subSlug}:${input.weekStart ?? "current"}:${Date.now()}`, input, principal }, async ({ run }) => ({
    result: await compileWeeklySubReport(run, { ...input, principal }, hooks),
    afterCommit: [flush],
  }));
}

/** The weekly-summary timer body: build + publish every due summary once,
 *  then apply any approved-but-unspent field decisions. */
export async function runWeeklySummaryTick(now = new Date()): Promise<{ due: number; built: { projectId: string; outcome: string }[]; applied: number }> {
  const principal = await ownerPrincipalForPolicy();
  const due = await withTransaction((run) => dueWeeklySummaries(run, now));
  const built: { projectId: string; outcome: string }[] = [];
  for (const d of due) {
    const r = await command(
      { name: "field.weekly_client_summary", requestKey: `weekly_summary:${d.projectId}:${d.weekStart}:rev1`, input: d, principal, authRef: "policy:weekly.client_summary" },
      async ({ run, commandId }) => ({ result: await buildWeeklyClientSummary(run, principal, d.projectId, d.weekStart, { commandId }) }),
    );
    built.push({ projectId: d.projectId, outcome: r.result.outcome });
  }
  const { hooks, flush } = boundFieldHooks();
  const applied = await withTransaction((run) => sweepApprovedFieldDecisions(run, principal, hooks));
  await flush();
  return { due: due.length, built, applied: applied.filter((a) => a.applied).length };
}
