import "server-only";

import { query, queryOne } from "@/lib/db";
import { getTurns, insertMessage } from "@/lib/ai-chat";
import { hermesChat, startClaudeRun, type ChatTurn } from "@/lib/dev-agents";
import { finalizeHermesAnswer } from "./effects";
import { reviewHermesRound } from "./claude-review";

// The Claude↔Hermes ladder: Hermes attempts OS work, Claude reviews the
// result, feedback loops back into Hermes' own session (it learns from the
// critique) until Claude approves — or Claude takes over with the sjcos MCP
// tools and explains why Hermes couldn't finish. Applies to 'auto'
// conversations' Hermes turns and to Qwen escalations; a conversation PINNED
// to Hermes bypasses review entirely (that's the escape hatch, same as
// routing).
//
// The whole ladder lives inside ONE dev_agent_runs row — the one the panel is
// already polling. Progress streams through that row's `activity`
// ("Hermes is working (round 2)…" / "Claude is reviewing…"), the final answer
// lands as the row's answer with a compact ladder summary, and the
// orchestration_tasks/_events tables keep the full audit trail. Rounds are
// NOT persisted as chat messages — the thread stays one ask, one answer.

const MAX_ROUNDS = Number(process.env.ORCH_MAX_ROUNDS ?? 3);
/** Server-side wait for a detached takeover run: 3s × 300 = 15 min, matched
 *  to failStaleRuns' cutoff so a dead runner resolves before we give up. */
const TAKEOVER_POLL_MS = 3_000;
const TAKEOVER_POLL_MAX = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setActivity(runId: string, activity: string): Promise<void> {
  await query(`UPDATE dev_agent_runs SET activity = $2, updated_at = now() WHERE id = $1`, [
    runId,
    activity,
  ]);
}

async function addEvent(
  taskId: string,
  actor: string,
  kind: string,
  note: string,
  runId?: string,
): Promise<void> {
  await query(
    `INSERT INTO orchestration_events (task_id, actor, kind, run_id, note) VALUES ($1, $2, $3, $4, $5)`,
    [taskId, actor, kind, runId ?? null, note.slice(0, 500)],
  ).catch(() => {});
}

async function effectsDigest(runId: string): Promise<string> {
  const { rows } = await query<{ entity_kind: string; entity_id: string | null; action: string; source: string }>(
    `SELECT entity_kind, entity_id, action, source FROM run_effects WHERE run_id = $1 ORDER BY id`,
    [runId],
  );
  return rows
    .map((r) => `- ${r.action} ${r.entity_kind}${r.entity_id ? ` ${r.entity_id}` : ""} (${r.source})`)
    .join("\n");
}

export interface LadderInput {
  runId: string;
  conversationId: string;
  /** What the owner asked for (the task being judged). */
  taskPrompt: string;
  pageContext?: string;
  /** Present when this ladder is a Qwen escalation — Claude's critique of the
   *  rejected attempt, fed to Hermes as round-1 context. */
  initialFeedback?: string;
}

/**
 * Run the ladder to completion. Never throws; always returns the display
 * answer for the run (the caller persists it). The run row's activity is used
 * as the live progress line throughout.
 */
export async function runHermesLadder(input: LadderInput): Promise<string> {
  const { runId, conversationId, taskPrompt, pageContext } = input;
  let taskId: string | null = null;
  try {
    const task = await queryOne<{ id: string }>(
      `INSERT INTO orchestration_tasks (conversation_id, task_prompt, status, stage, max_rounds)
       VALUES ($1, $2, 'running', 'hermes', $3) RETURNING id`,
      [conversationId, taskPrompt.slice(0, 4000), MAX_ROUNDS],
    );
    taskId = task!.id;
    await query(`UPDATE dev_agent_runs SET orchestration_task_id = $2 WHERE id = $1`, [runId, taskId]);
  } catch {
    // Migration not applied yet — degrade to a plain reviewed-less turn.
  }

  const baseTurns: ChatTurn[] = (await getTurns(conversationId)) as ChatTurn[];
  // Feedback exchanges live in memory only (see module comment).
  const extra: ChatTurn[] = input.initialFeedback
    ? [
        {
          role: "user",
          content:
            `[REVIEW] A smaller model attempted this and Claude held its work:\n` +
            `${input.initialFeedback}\n\nPlease do the task properly with your sjcos tools now.`,
        },
      ]
    : [];

  let lastAnswer = "";
  let lastNote = "";
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (taskId) {
      await query(
        `UPDATE orchestration_tasks SET round = $2, stage = 'hermes', updated_at = now() WHERE id = $1`,
        [taskId, round],
      ).catch(() => {});
    }
    await setActivity(runId, round === 1 ? "Hermes is working…" : `Hermes is retrying (round ${round})…`);

    let raw: string;
    try {
      raw = await hermesChat([...baseTurns, ...extra], pageContext, conversationId);
    } catch (err) {
      const msg = (err as Error).message;
      if (taskId) await addEvent(taskId, "hermes", "error", msg, runId);
      if (round < MAX_ROUNDS) continue; // transient gateway trouble — one more try
      if (taskId) await query(`UPDATE orchestration_tasks SET status = 'error', updated_at = now() WHERE id = $1`, [taskId]).catch(() => {});
      return `⚠️ ${msg}`;
    }
    lastAnswer = await finalizeHermesAnswer(runId, raw);
    if (taskId) await addEvent(taskId, "hermes", "answered", lastAnswer.slice(0, 200), runId);

    // Claude review. Read-only rounds still get judged — "did it actually do
    // the task" matters as much as "did it change the right thing".
    await setActivity(runId, `Claude is reviewing Hermes' work${round > 1 ? ` (round ${round})` : ""}…`);
    const digest = await effectsDigest(runId);
    let verdict = await reviewHermesRound(taskPrompt, lastAnswer, digest, round);
    if (!verdict) {
      // Review unavailable: retry once on the next round, else take over —
      // never silently approve.
      if (taskId) await addEvent(taskId, "claude-review", "error", "verdict unavailable", runId);
      verdict = { verdict: round < MAX_ROUNDS ? "retry" : "takeover", feedback: "Claude's review did not complete — redo the task carefully.", userNote: "" };
    }
    if (taskId) await addEvent(taskId, "claude-review", verdict.verdict, verdict.feedback || verdict.userNote, runId);

    if (verdict.verdict === "approve") {
      if (taskId) {
        await query(
          `UPDATE orchestration_tasks SET status = 'done', stage = 'done', final_run_id = $2, updated_at = now() WHERE id = $1`,
          [taskId, runId],
        ).catch(() => {});
      }
      const trail =
        round === 1
          ? "✓ Reviewed and approved by Claude"
          : `✓ Approved by Claude after ${round} rounds of feedback`;
      return `${lastAnswer}\n\n${trail}${verdict.userNote ? ` — ${verdict.userNote}` : ""}`;
    }

    lastNote = verdict.feedback;
    if (verdict.verdict === "takeover") break;

    // retry: feed the critique back through Hermes' own session so it learns.
    extra.push({ role: "assistant", content: raw });
    extra.push({
      role: "user",
      content:
        `[REVIEW — round ${round}] Claude reviewed your work and is not satisfied yet:\n` +
        `${verdict.feedback}\n\nPlease address every point and redo the task now.`,
    });
  }

  // ── Takeover ───────────────────────────────────────────────────────────────
  await setActivity(runId, "Claude is taking over…");
  if (taskId) {
    await query(`UPDATE orchestration_tasks SET stage = 'takeover', updated_at = now() WHERE id = $1`, [taskId]).catch(() => {});
  }
  const takeoverPrompt =
    `[ORCHESTRATOR TAKEOVER] Hermes could not complete this task after review. Finish it yourself ` +
    `using the sjcos MCP tools. Client-facing sends and money documents stay owner-approved — ` +
    `draft, never send.\n\n` +
    `The task:\n${taskPrompt}\n\n` +
    `Hermes' last attempt:\n${lastAnswer.slice(0, 2000)}\n\n` +
    `Claude's outstanding critique:\n${lastNote.slice(0, 1000)}\n\n` +
    `Open your reply with a short "Why Hermes couldn't finish:" paragraph, then do the task and ` +
    `report what you did.`;
  let takeoverRunId: string;
  try {
    takeoverRunId = await startClaudeRun(
      takeoverPrompt,
      pageContext,
      undefined, // its own CLI session; the reply is copied into this thread below
      { mode: "acceptEdits", effort: "default" },
      undefined,
      { withMcp: true, orchestrationTaskId: taskId ?? undefined },
    );
  } catch (err) {
    if (taskId) await query(`UPDATE orchestration_tasks SET status = 'error', updated_at = now() WHERE id = $1`, [taskId]).catch(() => {});
    return `${lastAnswer}\n\n⚠️ Claude takeover failed to start (${(err as Error).message}). Claude's last critique of Hermes:\n${lastNote}`;
  }
  if (taskId) await addEvent(taskId, "claude-takeover", "started", "", takeoverRunId);

  for (let i = 0; i < TAKEOVER_POLL_MAX; i++) {
    await sleep(TAKEOVER_POLL_MS);
    const row = await queryOne<{ status: string; answer: string | null; activity: string | null }>(
      `SELECT status, answer, activity FROM dev_agent_runs WHERE id = $1`,
      [takeoverRunId],
    );
    if (!row) break;
    if (row.status === "done" || row.status === "error") {
      const answer = row.answer ?? "(no output)";
      if (taskId) {
        await query(
          `UPDATE orchestration_tasks SET status = $2, stage = 'done', final_run_id = $3, updated_at = now() WHERE id = $1`,
          [taskId, row.status === "done" ? "done" : "error", takeoverRunId],
        ).catch(() => {});
        await addEvent(taskId, "claude-takeover", row.status, answer.slice(0, 200), takeoverRunId);
      }
      // Feed the outcome back into Hermes' long-term session so it learns —
      // non-blocking, best-effort.
      void hermesChat(
        [
          {
            role: "user",
            content:
              `[FYI — no action needed, reply briefly] Claude took over the task "${taskPrompt.slice(0, 200)}" ` +
              `after your attempts. Its critique was:\n${lastNote.slice(0, 800)}\n\nRemember this for similar tasks.`,
          },
        ],
        undefined,
        conversationId,
      ).catch(() => {});
      return row.status === "done"
        ? `🤝 Claude took this over.\n\n${answer}`
        : `⚠️ Claude's takeover failed: ${answer}\n\nHermes' last attempt:\n${lastAnswer}`;
    }
    if (row.activity) await setActivity(runId, `Claude is taking over…\n${row.activity.split("\n").slice(-3).join("\n")}`);
  }
  if (taskId) await query(`UPDATE orchestration_tasks SET status = 'error', updated_at = now() WHERE id = $1`, [taskId]).catch(() => {});
  return `${lastAnswer}\n\n⚠️ Claude's takeover did not report back in time. Its last critique of Hermes:\n${lastNote}`;
}

/** Reap ladders whose driver died (crashed process mid-round). 45 minutes —
 *  the per-run 15-minute reap stays; a 3-round loop can legitimately run
 *  longer at the task level. */
export async function failStaleTasks(): Promise<void> {
  await query(
    `UPDATE orchestration_tasks SET status = 'error', updated_at = now()
      WHERE status = 'running' AND created_at < now() - interval '45 minutes'`,
  ).catch(() => {});
}

/**
 * The Qwen escalation hook (lib/orchestrator/proposals.ts setEscalateHook):
 * a proposal Claude held re-routes to Hermes as its own tracked ladder run in
 * the same conversation. Fire-and-forget past the row insert — the reply
 * lands in the thread when it lands (getConversation's pendingRunId resumes a
 * reopened panel onto it). Returns the new run id, or null when the hand-off
 * couldn't start (the caller then reports plain rejection).
 */
export async function escalateToHermesLadder(args: {
  runId: string;
  conversationId: string;
  userMessage: string;
  critique: string;
}): Promise<string | null> {
  try {
    const run = await queryOne<{ id: string }>(
      `INSERT INTO dev_agent_runs (agent, prompt, page_context, status, conversation_id, activity)
       VALUES ('hermes', $1, NULL, 'running', $2, 'Hermes is working…') RETURNING id`,
      [args.userMessage, args.conversationId],
    );
    const newRunId = run!.id;
    void (async () => {
      try {
        const answer = await runHermesLadder({
          runId: newRunId,
          conversationId: args.conversationId,
          taskPrompt: args.userMessage,
          initialFeedback: args.critique,
        });
        await insertMessage(args.conversationId, "assistant", answer);
        await query(
          `UPDATE dev_agent_runs SET status = 'done', answer = $2, updated_at = now() WHERE id = $1`,
          [newRunId, answer],
        );
      } catch (err) {
        const msg = `⚠️ ${(err as Error).message}`;
        await insertMessage(args.conversationId, "assistant", msg).catch(() => {});
        await query(
          `UPDATE dev_agent_runs SET status = 'error', answer = $2, updated_at = now() WHERE id = $1`,
          [newRunId, msg],
        ).catch(() => {});
      }
    })();
    return newRunId;
  } catch {
    return null;
  }
}
