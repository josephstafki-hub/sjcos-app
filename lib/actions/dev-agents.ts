"use server";

import { requireRole } from "@/lib/dal";
import { getDevAgentRun, failStaleRuns, stopDevAgentRun } from "@/lib/dev-agents";
import { failStaleTasks } from "@/lib/orchestrator/ladder";
import {
  answerInteraction,
  dismissInteraction,
  listPendingInteractions,
  type AgentInteraction,
  type InteractionResponse,
} from "@/lib/agent-interactions";
import { query } from "@/lib/db";
import { ACTION_LABEL } from "@/lib/owner-grant-types";
import { getRunFocus } from "@/lib/run-focus";
import type { RunFocus } from "@/lib/entity-href";

// dev_agent_runs polling. Backs every async agent turn started from the Ask
// window / embedded command bar — Claude runs (detached CLI) and, since
// Qwen/Hermes turns also run in the background now (lib/actions/ai-chat.ts),
// their turns too. Agent-agnostic: the row just carries status/activity/answer.
//
// A poll on a LIVE run also carries everything the agent is waiting on Joe
// for, so the panel can render it inline:
//   interactions — question boxes (ask_owner) and tool-use approvals (the
//                  Claude CLI's permission prompt) from agent_interactions.
//   grants       — pending request_owner_permission rows (owner_grants
//                  'requested'), approvable right in the chat.
//   focus        — the page for whatever entity the run touched last
//                  (run_effects → lib/run-focus.ts), so the app view can
//                  follow the work (LiveActionNav).
// Plus the live context size (tokens) the Claude runner streams.

/** A request_owner_permission the panel can approve/deny inline. */
export interface PendingGrant {
  id: string;
  requestedBy: string;
  /** Human label of the gated action(s), e.g. "Send invoice" / "any send". */
  label: string;
  targetId: string | null;
  reason: string;
  createdAt: string;
}

export type PollResult =
  | {
      ok: true;
      status: "pending" | "running";
      activity: string | null;
      /** Live context size (tokens in the window) — Claude runs only. */
      contextTokens: number | null;
      /** Question boxes / permission prompts waiting on Joe. */
      interactions: AgentInteraction[];
      /** Permission requests (owner grants) waiting on Joe. */
      grants: PendingGrant[];
      focus: RunFocus | null;
    }
  | {
      ok: true;
      status: "done";
      answer: string;
      costUsd: number | null;
      nextRunId?: string;
      activity: string | null;
      /** Who actually ran ('claude'|'qwen'|'hermes') — an 'auto' thread's
       *  transcript labels the reply with it. */
      agent: string;
      contextTokens: number | null;
      /** Result envelope bookkeeping (usage, modelUsage, num_turns). */
      tokenUsage: Record<string, unknown> | null;
      /** The thread's resumable CLI session id. */
      sessionId: string | null;
      focus: RunFocus | null;
    }
  | { ok: false; error: string };

async function pendingGrants(runId: string, conversationId: string | null): Promise<PendingGrant[]> {
  const { rows } = await query<{
    id: string;
    requested_by: string;
    actions: string[];
    target_id: string | null;
    reason: string;
    created_at: string;
  }>(
    `SELECT id, requested_by, actions, target_id, reason, created_at::text AS created_at
       FROM owner_grants
      WHERE status = 'requested'
        AND (run_id = $1
             OR ($2::uuid IS NOT NULL AND conversation_id = $2)
             OR created_at > now() - interval '20 minutes')
      ORDER BY created_at ASC
      LIMIT 3`,
    [runId, conversationId],
  );
  return rows.map((g) => ({
    id: g.id,
    requestedBy: g.requested_by,
    label: g.actions.includes("*")
      ? "any send"
      : g.actions.map((a) => ACTION_LABEL[a as keyof typeof ACTION_LABEL] ?? a).join(", "),
    targetId: g.target_id,
    reason: g.reason,
    createdAt: g.created_at,
  }));
}

export async function pollAgentRun(runId: string): Promise<PollResult> {
  await requireRole("owner");
  await failStaleRuns();
  await failStaleTasks();
  const run = await getDevAgentRun(runId);
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status === "error")
    return { ok: false, error: run.answer ?? "The agent run failed." };
  if (run.status === "done")
    return {
      ok: true,
      status: "done",
      answer: run.answer ?? "(no output)",
      costUsd: run.costUsd,
      nextRunId: run.nextRunId,
      activity: run.activity,
      agent: run.agent,
      contextTokens: run.contextTokens,
      tokenUsage: run.tokenUsage,
      sessionId: run.sessionId,
      focus: await getRunFocus(runId),
    };
  const [interactions, grants, focus] = await Promise.all([
    listPendingInteractions(runId, run.conversationId),
    pendingGrants(runId, run.conversationId),
    getRunFocus(runId),
  ]);
  return {
    ok: true,
    status: run.status,
    activity: run.activity,
    contextTokens: run.contextTokens,
    interactions,
    grants,
    focus,
  };
}

/** ⏹ Stop a live run. Claude: SIGTERMs the detached runner (which kills the
 *  CLI and records the stop); Hermes/Qwen: settles the row (their guarded
 *  pipelines then discard the late result). */
export async function stopAgentRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const r = await stopDevAgentRun(runId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Answer a question box / permission prompt — the blocked agent's poll picks
 *  it up within ~2s. */
export async function answerInteractionAction(
  id: string,
  response: InteractionResponse,
): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const row = await answerInteraction(id, response);
  return { ok: row != null };
}

/** Dismiss without answering (the agent is told to use its judgment). */
export async function dismissInteractionAction(id: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await dismissInteraction(id);
  return { ok: true };
}
