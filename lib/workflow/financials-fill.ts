// When the background agent fills in a job's financials (skill
// fill-project-financials): budget lines from the estimate, the costs on file,
// each dollar counted once. Joe, 2026-10-30: the skill only ran when somebody
// happened to ask, and seven "Fill in the financials" to-dos sat queued for
// five weeks. Now two events wake it:
//
//   enqueueFinancialsFill(run, projectId, by)
//     Construction start (lib/workflow/construction-start.ts), beside the
//     permit research.
//   enqueueMissingFinancials(run)
//     Every agent-worker pass (scripts/run-business-agent.mjs): any job in
//     construction whose budget isn't finished and that has never had a run.
//
// One run per job: both use the trigger ref project:<id>:financials, and the
// catch-up skips a job that has the trigger in any state. A run that can't
// finish files one work item for Joe saying what's missing; it is not retried.
//
// Pure over run(sql, params).

import type { Run } from "../commands/core.ts";
import { enqueueAgentTrigger } from "../agent-runtime/triggers.ts";

export const financialsRef = (projectId: string) => `project:${projectId}:financials`;

export async function enqueueFinancialsFill(run: Run, projectId: string, by: string): Promise<{ id: string; created: boolean }> {
  const [p] = await run<{ slug: string }>(`SELECT slug FROM projects WHERE id = $1`, [projectId]);
  const r = await enqueueAgentTrigger(run, {
    kind: "financials",
    ref: financialsRef(projectId),
    projectId,
    enqueuedBy: by,
    payload: { project_slug: p?.slug ?? null, reason: by },
    maxAttempts: 2,
  });
  return { id: r.trigger.id, created: r.created };
}

/** Construction jobs whose budget isn't finished and that never had a run. */
export async function enqueueMissingFinancials(run: Run, opts: { limit?: number } = {}): Promise<string[]> {
  const rows = await run<{ id: string }>(
    `SELECT p.id FROM projects p
      WHERE p.status = 'construction' AND NOT p.budget_complete
        AND NOT EXISTS (SELECT 1 FROM agent_triggers t WHERE t.kind = 'financials' AND t.ref = 'project:' || p.id || ':financials')
      ORDER BY p.updated_at DESC
      LIMIT $1`,
    [opts.limit ?? 5],
  );
  const queued: string[] = [];
  for (const r of rows) {
    await enqueueFinancialsFill(run, r.id, "workflow:financials-catch-up");
    queued.push(r.id);
  }
  return queued;
}
