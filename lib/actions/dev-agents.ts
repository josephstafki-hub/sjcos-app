"use server";

import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import {
  askHermes,
  startClaudeRun,
  getDevAgentRun,
  failStaleRuns,
  type DevAgent,
} from "@/lib/dev-agents";

// Ask-window multi-agent actions. Owner-only: Claude and Hermes are dev-only
// channels (Claude has edit access to this repo), Qwen is the production
// assistant. Qwen + Hermes answer inline; Claude returns a run id to poll.

export type AskAgentResult =
  | { ok: true; answer: string } // qwen / hermes — synchronous
  | { ok: true; pending: true; runId: string } // claude — async
  | { ok: false; error: string };

export async function askAgent(
  agent: DevAgent,
  prompt: string,
  pageContext?: string,
): Promise<AskAgentResult> {
  await requireRole("owner");
  const q = prompt.trim();
  if (!q) return { ok: false, error: "Ask something first." };

  try {
    if (agent === "qwen") {
      const { answer } = await ai.ask({ prompt: q, context: pageContext });
      return { ok: true, answer: answer || "I don't have an answer for that yet." };
    }
    if (agent === "hermes") {
      const answer = await askHermes(q, pageContext);
      return { ok: true, answer };
    }
    // claude — kick off the detached headless run, poll from the client.
    const runId = await startClaudeRun(q, pageContext);
    return { ok: true, pending: true, runId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

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
    return { ok: false, error: run.answer ?? "The Claude run failed." };
  if (run.status === "done")
    return { ok: true, status: "done", answer: run.answer ?? "(no output)", costUsd: run.costUsd };
  return { ok: true, status: run.status, activity: run.activity };
}
