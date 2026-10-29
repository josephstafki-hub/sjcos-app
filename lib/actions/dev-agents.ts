"use server";

import { requireAccess } from "@/lib/dal";
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
import { ACTION_LABEL, type GrantDetail } from "@/lib/owner-grant-types";
import { describeGrants } from "@/lib/grant-detail";
import { getRunFocus } from "@/lib/run-focus";
import { autoSettleQuietThreads } from "@/lib/thread-folders";
import { enqueueSteer, steersForRun, type SteerStatus } from "@/lib/run-steers";
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
// Plus the live context size (tokens) the Claude runner streams, and the
// state of every steer Joe sent into the run (lib/run-steers.ts).

/** A request_owner_permission the panel can approve/deny inline. */
export interface PendingGrant {
  id: string;
  requestedBy: string;
  /** Human label of the gated action(s), e.g. "Send invoice" / "any send". */
  label: string;
  targetId: string | null;
  reason: string;
  createdAt: string;
  /** What approving does, in plain words, plus the draft (lib/grant-detail). */
  detail: GrantDetail | null;
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
      steers: SteerStatus[];
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
      steers: SteerStatus[];
    }
  | { ok: false; error: string; nextRunId?: string; steers?: SteerStatus[] };

async function pendingGrants(runId: string, conversationId: string | null): Promise<PendingGrant[]> {
  const { rows } = await query<{
    id: string;
    requested_by: string;
    actions: string[];
    target_kind: string | null;
    target_id: string | null;
    scope: Record<string, unknown>;
    reason: string;
    created_at: string;
  }>(
    `SELECT id, requested_by, actions, target_kind, target_id, scope, reason, created_at::text AS created_at
       FROM owner_grants
      WHERE status = 'requested' AND expires_at > now()
        AND (run_id = $1
             OR ($2::uuid IS NOT NULL AND conversation_id = $2)
             OR created_at > now() - interval '20 minutes')
      ORDER BY created_at ASC
      LIMIT 3`,
    [runId, conversationId],
  );
  const details = rows.length ? await describeGrants(rows, { cacheMs: 10_000 }) : {};
  return rows.map((g) => ({
    id: g.id,
    detail: details[g.id] ?? null,
    requestedBy: g.requested_by,
    label: g.actions.includes("*")
      ? "any send"
      : g.actions.map((a) => ACTION_LABEL[a as keyof typeof ACTION_LABEL] ?? a).join(", "),
    targetId: g.target_id,
    reason: g.reason,
    createdAt: g.created_at,
  }));
}

/** A22: the owner sees every run; a staff member with the `ai` area may
 *  follow only runs started under their own identity. */
async function requireRunAccess(runId: string) {
  const user = await requireAccess("ai");
  if (user.role === "owner") return user;
  const run = await getDevAgentRun(runId);
  if (!run || run.principalUserId !== user.id) throw new Error("That run is not yours.");
  return user;
}

/** Same rule for a question box / permission prompt: it belongs to a run. */
async function requireInteractionAccess(id: string) {
  const user = await requireAccess("ai");
  if (user.role === "owner") return user;
  const { rows } = await query<{ principal_user_id: string | null }>(
    `SELECT r.principal_user_id FROM agent_interactions i LEFT JOIN dev_agent_runs r ON r.id = i.run_id WHERE i.id = $1`,
    [id],
  );
  if (!rows[0] || rows[0].principal_user_id !== user.id) throw new Error("That question is not from one of your runs.");
  return user;
}

export async function pollAgentRun(runId: string): Promise<PollResult> {
  await requireRunAccess(runId);
  await failStaleRuns();
  await failStaleTasks();
  // Thread auto-settle rides the same heartbeat (throttled to once a minute
  // in-process); the agent-retries cron covers hours with no panel open.
  await autoSettleQuietThreads().catch(() => {});
  const run = await getDevAgentRun(runId);
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status === "error")
    return { ok: false, error: run.answer ?? "The agent run failed.", nextRunId: run.nextRunId, steers: await steersForRun(runId) };
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
      steers: await steersForRun(runId),
    };
  const [interactions, grants, focus, steers] = await Promise.all([
    listPendingInteractions(runId, run.conversationId),
    pendingGrants(runId, run.conversationId),
    getRunFocus(runId),
    steersForRun(runId),
  ]);
  return {
    ok: true,
    status: run.status,
    activity: run.activity,
    contextTokens: run.contextTokens,
    interactions,
    grants,
    focus,
    steers,
  };
}

/** ⏹ Stop a live run. Claude: SIGTERMs the detached runner (which kills the
 *  CLI and records the stop); Hermes/Qwen: settles the row (their guarded
 *  pipelines then discard the late result). */
export async function stopAgentRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  await requireRunAccess(runId);
  const r = await stopDevAgentRun(runId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export type SteerResult =
  | { ok: true; steerId: string; runId: string }
  | { ok: false; finished: true }
  | { ok: false; finished?: false; error: string };

/** Send a steer INTO a live run (the panel's composer while an agent works).
 *  `finished` = the run already took its last look at steers — the panel
 *  sends the text as the next message instead. */
export async function steerAgentRun(runId: string, text: string): Promise<SteerResult> {
  await requireRunAccess(runId);
  const r = await enqueueSteer(runId, text.slice(0, 8000));
  if (r.ok) return { ok: true, steerId: r.steerId, runId: r.runId };
  if ("finished" in r) return { ok: false, finished: true };
  return { ok: false, error: r.error };
}

/** Answer a question box / permission prompt — the blocked agent's poll picks
 *  it up within ~2s. */
export async function answerInteractionAction(
  id: string,
  response: InteractionResponse,
): Promise<{ ok: boolean }> {
  await requireInteractionAccess(id);
  const row = await answerInteraction(id, response);
  return { ok: row != null };
}

/** Dismiss without answering (the agent is told to use its judgment). */
export async function dismissInteractionAction(id: string): Promise<{ ok: boolean }> {
  await requireInteractionAccess(id);
  await dismissInteraction(id);
  return { ok: true };
}
