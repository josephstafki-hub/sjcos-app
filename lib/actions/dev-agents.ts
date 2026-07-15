"use server";

import { requireRole } from "@/lib/dal";
import { getDevAgentRun, failStaleRuns } from "@/lib/dev-agents";

// dev_agent_runs polling. Backs every async agent turn started from the Ask
// window / embedded command bar — Claude runs (detached CLI) and, since
// Qwen/Hermes turns also run in the background now (lib/actions/ai-chat.ts),
// their turns too. Agent-agnostic: the row just carries status/activity/answer.

export type PollResult =
  | { ok: true; status: "pending" | "running"; activity: string | null }
  | { ok: true; status: "done"; answer: string; costUsd: number | null }
  | { ok: false; error: string };

export async function pollAgentRun(runId: string): Promise<PollResult> {
  await requireRole("owner");
  await failStaleRuns();
  const run = await getDevAgentRun(runId);
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status === "error")
    return { ok: false, error: run.answer ?? "The agent run failed." };
  if (run.status === "done")
    return { ok: true, status: "done", answer: run.answer ?? "(no output)", costUsd: run.costUsd };
  return { ok: true, status: run.status, activity: run.activity };
}
