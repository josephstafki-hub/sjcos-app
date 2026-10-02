// Field-side consumers of resolved decisions. WS-approvals' surfaces resolve
// the card (resolveDecision); this module turns an approved decision into the
// field effect it authorised. Every consumer is idempotent, so it can be
// called from a post-resolve hook AND from the periodic sweep without a
// double effect.

import type { Run } from "../commands/core.ts";
import { getDecision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import type { FieldHooks } from "./hooks.ts";
import { confirmMilestone } from "./reports.ts";
import { publishApprovedWeeklySummary } from "./weekly-summary.ts";

export const FIELD_DECISION_KINDS = ["milestone_confirmation", "weekly_summary", "schedule", "schedule_impact", "snag_decision"] as const;

export type ApplyOutcome = { kind: string; decisionId: string; applied: boolean; note: string };

/** Apply one resolved decision of a field kind. Unknown kinds are ignored. */
export async function applyFieldDecision(run: Run, principal: Principal, decisionId: string, hooks: FieldHooks): Promise<ApplyOutcome> {
  const d = await getDecision(run, decisionId);
  if (!d) return { kind: "?", decisionId, applied: false, note: "no such decision" };
  switch (d.kind) {
    case "milestone_confirmation": {
      const r = await confirmMilestone(run, decisionId, hooks);
      return { kind: d.kind, decisionId, applied: r.ok && r.confirmed, note: r.ok ? `${r.milestoneKey}${r.hookFired ? " · hook fired" : ""}` : r.reason };
    }
    case "weekly_summary": {
      const r = await publishApprovedWeeklySummary(run, principal, decisionId);
      return { kind: d.kind, decisionId, applied: r.ok, note: r.ok ? `summary ${r.summary.id} ${r.summary.status}` : r.reason };
    }
    case "schedule":
      // confirmSchedule is called explicitly (it also needs the signature +
      // payment gates); approval alone confirms nothing.
      return { kind: d.kind, decisionId, applied: false, note: "plan approved; confirmSchedule() runs the remaining gates" };
    case "schedule_impact":
      return { kind: d.kind, decisionId, applied: false, note: "approved; revised dates/messages are prepared for release by the operator" };
    case "snag_decision":
      return { kind: d.kind, decisionId, applied: false, note: "resolved; applyOwnerSnagDecision() records the instruction" };
    default:
      return { kind: d.kind, decisionId, applied: false, note: "not a field decision" };
  }
}

/** Approved-but-unspent field decisions → apply. Safe to run on a timer. */
export async function sweepApprovedFieldDecisions(run: Run, principal: Principal, hooks: FieldHooks): Promise<ApplyOutcome[]> {
  const rows = await run<{ id: string }>(
    `SELECT id FROM decisions WHERE status = 'approved' AND uses = 0 AND kind IN ('milestone_confirmation','weekly_summary') ORDER BY decided_at`,
  );
  const out: ApplyOutcome[] = [];
  for (const r of rows) out.push(await applyFieldDecision(run, principal, r.id, hooks));
  return out;
}
