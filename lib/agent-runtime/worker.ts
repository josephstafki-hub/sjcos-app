// Background operating-agent worker (A24).
//
//   runWorkerOnce(tx, opts)  claim up to N pending triggers, run each through
//                            the configured operating model, record everything
//                            in agent_executions, finish the trigger, sweep
//                            stranded leases. Called by
//                            scripts/run-business-agent.mjs (systemd timer,
//                            every 3 min, --once) and by scripts/run-evals.mjs.
//   processTrigger(tx, trigger, opts)  one trigger end to end.
//
// The model runner is injected (`opts.runner`) so tests drive the whole path
// with a fake and evaluations use lib/agent-runtime/claude-runner.mjs. Every
// run is finite: the runner has a timeout + turn cap, the trigger lease
// expires, and sweepStrandedTriggers re-queues what a dead worker left.
//
// `tx(fn)` runs fn(run) in ONE transaction (tests/commands-core-db pattern);
// `direct` is an autocommit run for reads and long-running bookkeeping.
// Pure: no server-only import.

import type { Run } from "../commands/core.ts";
import { laneOpen } from "../commands/policies.ts";
import { buildBusinessInstructions, parseRunSummary, RUN_SUMMARY_FORMAT, toolListChecksum } from "./instructions.ts";
import { countOwnerPrompts, finishExecution, recordsFromTrace, startExecution, type ToolTraceEntry } from "./executions.ts";
import { claimAgentTriggers, finishAgentTrigger, heartbeatTrigger, sweepStrandedTriggers, type AgentTrigger } from "./triggers.ts";

export type Tx = <T>(fn: (run: Run) => Promise<T>) => Promise<T>;

export interface RunnerResult {
  ok: boolean;
  timedOut?: boolean;
  resultText: string;
  error: string | null;
  trace: ToolTraceEntry[];
  toolNames: string[];
  toolListChecksum?: string | null;
  costUsd: number | null;
  durationMs: number;
  numTurns: number | null;
  sessionId?: string | null;
  model?: string | null;
}

export interface ModelRunner {
  name: string;
  run: (input: { prompt: string; systemBlock: string; trigger: AgentTrigger; model: string | null }) => Promise<RunnerResult>;
}

export interface WorkerOptions {
  runner: ModelRunner;
  worker?: string;
  model?: string | null;
  limit?: number;
  leaseSeconds?: number;
  entryPoint?: "worker" | "eval";
  /** Extra task text appended after the context (evals use it for the scenario task). */
  taskText?: string | null;
  onLog?: (line: string) => void;
  /** Skip the lane kill-switch check (evals). */
  ignoreLane?: boolean;
}

export const WORKER_NAME = "business-agent-worker";
export const WORKER_PRINCIPAL = { kind: "agent", agent: WORKER_NAME, onBehalfOf: null, label: "unattended business agent (worker:business-agent-worker)" };

function taskFor(trigger: AgentTrigger): string {
  const base =
    `TASK: work this event under the operating instructions above. Apply the event loop: (1) resolve what the event is and what it resolves; ` +
    `(2) inspect the current records with the read tools; (3) extract facts/choices/decisions with sources; (4) update through the tools; ` +
    `(5) execute the authorized next steps and stage exact approvals; (6) verify and record (record_agent_run, record_receipt). ` +
    `Do not stop at writing a to-do for Joe. Stop at a real authority or information boundary and say exactly which.`;
  const byKind: Record<string, string> = {
    signature: `A signature event: if it is a verified SIGNED pre-construction agreement, start W02 preparation now (scope register, site-visit plan, design brief/path, working formal estimate structure with explicit gaps) without waiting for payment or a site visit. If the signature is not valid/signed, do NOT start preparation. If this preparation already exists (previous runs, open work items, existing estimate), resume it; never duplicate.`,
    message: `An inbound message: determine what it resolves or asks. A question about an option is not a choice; enthusiasm is not approval; a request to change payment/bank details is a fraud-risk fact to flag, never an update. Apply supported state changes only; draft any reply for approval (never send).`,
    note: `Owner/site notes: extract source-linked facts, measurements, decisions and issues; update affected records; preserve Joe's allocations and dedicated prices unless the notes explicitly change them; ask targeted clarifications for ambiguities. A site-note update never constitutes release permission.`,
    quote: `A supplier/sub quote: check product, quantity, unit basis, tax/freight coverage and revision. Noncompetitive → replace the provisional cost in the draft estimate. Competing → prepare an equivalent-scope comparison and stage the owner choice; never sum or auto-select. Never reprice an offer already sent to the client.`,
    selection: `A client selection/feedback event: incorporate an actual choice into the estimate (remove superseded options; unselected options stay out of the total). Feedback → revise the affected artifact and stage the revision for Joe's review; never broadcast an unapproved revision.`,
    payment: `A payment event: record what it unlocks (gates: signed construction agreement AND initial payment before confirming dates or ordering). Invoices sent and promised payments are not collected funds.`,
    field_report: `A field report: use the evidence already supplied; ask precisely and only for what is missing; prepare Joe's completion confirmation with evidence; a sub's claim or photos alone never authorize completion or billing. Snags: alert Joe with facts, impact, recommendation and the specific continue/pause decision; never decide it yourself.`,
    approval: `An owner decision was resolved: apply exactly what it authorizes for that exact content/recipient; nothing broader. If rejected/revoked, stop the dependent action and record why.`,
    signoff: `Written client sign-off: the final invoice for the verified remaining balance (approved CO balances, all payments/credits applied once) and configured post-project follow-through are automatic ONLY under their active policy; if no policy is active, stage them and record the missing policy as the blocked reason. Never a duplicate final invoice. Never invent warranties or marketing enrollment.`,
    sweep: `Repair sweep: look for stranded work on this job (open obligations with no next action, approved items nobody resumed, stale drafts) and advance what is permitted; do not create duplicate to-dos.`,
  };
  return `${base}\n${byKind[trigger.kind] ?? ""}\n\n${RUN_SUMMARY_FORMAT}`;
}

/** One trigger, end to end. Returns the execution id and the outcome. */
export async function processTrigger(tx: Tx, direct: Run, trigger: AgentTrigger, opts: WorkerOptions): Promise<{ executionId: string; status: "done" | "blocked" | "failed" | "timeout"; result: RunnerResult | null }> {
  const log = opts.onLog ?? (() => {});
  const startedAt = Date.now();
  // 1. Assemble the instruction block + scoped context (outside any long tx).
  const built = await buildBusinessInstructions(direct, {
    projectId: trigger.project_id,
    leadId: trigger.lead_id,
    trigger: { kind: trigger.kind, ref: trigger.ref, payload: trigger.payload },
    principal: WORKER_PRINCIPAL,
  });
  const exec = await tx((run) =>
    startExecution(run, {
      triggerId: trigger.id,
      triggerKind: trigger.kind,
      triggerRef: trigger.ref,
      runtime: opts.runner.name,
      entryPoint: opts.entryPoint ?? "worker",
      principal: WORKER_PRINCIPAL,
      projectId: trigger.project_id,
      leadId: trigger.lead_id,
      instructionVersions: built.versions as unknown as Record<string, unknown>,
      model: opts.model ?? null,
      contextRefs: built.context.refs,
      contextChars: built.context.chars,
    }),
  );
  log(`execution ${exec.id} for ${trigger.kind}:${trigger.ref} (context ${built.context.chars} chars; versions ${Object.entries(built.versions).filter(([k]) => k !== "standing_instructions").map(([k, v]) => `${k}#${String((v as { checksum?: string }).checksum ?? "").slice(0, 8)}`).join(" ")})`);
  const prompt = `${built.prompt}\n\n${taskFor(trigger)}${opts.taskText ? `\n\n${opts.taskText}` : ""}`;

  // 2. Run the model, heartbeating the lease.
  const hb = setInterval(() => {
    direct(`UPDATE agent_triggers SET lease_until = now() + interval '15 minutes' WHERE id = $1 AND lease_token = $2 AND state = 'leased'`, [trigger.id, trigger.lease_token]).catch(() => {});
  }, 30_000);
  let result: RunnerResult | null = null;
  let runnerError: string | null = null;
  try {
    result = await opts.runner.run({ prompt, systemBlock: built.text, trigger, model: opts.model ?? null });
  } catch (err) {
    runnerError = (err as Error).message;
  } finally {
    clearInterval(hb);
  }

  // 3. Records touched = trace-derived + MCP writes logged during the run.
  const trace = result?.trace ?? [];
  const touched = recordsFromTrace(trace);
  try {
    const scopes = await direct<{ scope: string; n: string }>(
      `SELECT scope, count(*)::text AS n FROM app_change_log WHERE source = 'mcp' AND created_at >= $1::timestamptz GROUP BY scope ORDER BY scope`,
      [new Date(startedAt).toISOString()],
    );
    for (const s of scopes) touched.push({ kind: `table:${s.scope}`, id: null, action: `${s.n} write(s)` });
  } catch {
    /* app_change_log absent */
  }
  const summary = parseRunSummary(result?.resultText);
  const status: "done" | "blocked" | "failed" | "timeout" = runnerError || !result
    ? "failed"
    : result.timedOut
      ? "timeout"
      : !result.ok
        ? "failed"
        : summary.blocked && summary.blocked !== "none"
          ? "blocked"
          : "done";
  await tx((run) =>
    finishExecution(run, exec.id, {
      status,
      toolTrace: trace,
      toolNames: (result?.toolNames ?? []).filter((t) => t.startsWith("mcp__sjcos__")).map((t) => t.replace(/^mcp__sjcos__/, "")),
      toolListChecksum: result?.toolListChecksum ?? (result?.toolNames?.length ? toolListChecksum(result.toolNames.filter((t) => t.startsWith("mcp__sjcos__"))) : null),
      resultSummary: summary.result ?? (result?.resultText ? result.resultText.slice(0, 1500) : null),
      recordsTouched: touched,
      ownerPrompts: countOwnerPrompts(trace),
      blockedReason: summary.blocked && summary.blocked !== "none" ? summary.blocked : null,
      nextTrigger: summary.nextTrigger && summary.nextTrigger !== "none" ? { text: summary.nextTrigger } : null,
      error: runnerError ?? result?.error ?? null,
      latencyMs: result?.durationMs ?? Date.now() - startedAt,
      costUsd: result?.costUsd ?? null,
      numTurns: result?.numTurns ?? null,
      sessionId: result?.sessionId ?? null,
      model: result?.model ?? opts.model ?? null,
    }),
  );
  return { executionId: exec.id, status, result };
}

export interface WorkerRunReport {
  claimed: number;
  done: number;
  blocked: number;
  failed: number;
  swept: { requeued: number; failed: number; executionsTimedOut: number };
  lane: { open: boolean; reason?: string };
  executions: { triggerId: string; executionId: string; status: string; kind: string; ref: string }[];
}

/** One pass: sweep, check the 'agents' lane, claim, process. */
export async function runWorkerOnce(tx: Tx, direct: Run, opts: WorkerOptions): Promise<WorkerRunReport> {
  const log = opts.onLog ?? (() => {});
  const swept = await tx((run) => sweepStrandedTriggers(run));
  if (swept.requeued || swept.failed || swept.executionsTimedOut) log(`sweep: requeued ${swept.requeued}, failed ${swept.failed}, executions timed out ${swept.executionsTimedOut}`);
  const report: WorkerRunReport = { claimed: 0, done: 0, blocked: 0, failed: 0, swept, lane: { open: true }, executions: [] };
  if (!opts.ignoreLane) {
    const lane = await laneOpen(direct, "agents");
    if (!lane.open) {
      report.lane = { open: false, reason: lane.reason };
      log(`lane 'agents' paused: ${lane.reason}`);
      return report;
    }
  }
  const worker = opts.worker ?? WORKER_NAME;
  const claimed = await tx((run) => claimAgentTriggers(run, { worker, limit: opts.limit ?? 1, leaseSeconds: opts.leaseSeconds ?? 900 }));
  report.claimed = claimed.length;
  for (const trigger of claimed) {
    let outcome: Awaited<ReturnType<typeof processTrigger>> | null = null;
    let fatal: string | null = null;
    try {
      outcome = await processTrigger(tx, direct, trigger, opts);
    } catch (err) {
      fatal = (err as Error).message;
    }
    if (!outcome) {
      report.failed++;
      await tx((run) => finishAgentTrigger(run, trigger.id, trigger.lease_token!, { kind: "retry", error: fatal ?? "worker error" }));
      log(`trigger ${trigger.id} ${trigger.kind}:${trigger.ref} → retry (${fatal})`);
      continue;
    }
    report.executions.push({ triggerId: trigger.id, executionId: outcome.executionId, status: outcome.status, kind: trigger.kind, ref: trigger.ref });
    if (outcome.status === "done" || outcome.status === "blocked") {
      // A blocked run STOPPED at a real boundary and recorded it; the next
      // wakeup is the owner's reply/approval, not a retry of the same event.
      report[outcome.status]++;
      await tx((run) => finishAgentTrigger(run, trigger.id, trigger.lease_token!, { kind: "done", executionId: outcome!.executionId }));
    } else {
      report.failed++;
      await tx((run) => finishAgentTrigger(run, trigger.id, trigger.lease_token!, { kind: "retry", error: outcome!.result?.error ?? outcome!.status, executionId: outcome!.executionId }));
    }
    log(`trigger ${trigger.id} ${trigger.kind}:${trigger.ref} → ${outcome.status}`);
  }
  await heartbeatWorker(direct, worker, report).catch(() => {});
  return report;
}

async function heartbeatWorker(direct: Run, worker: string, report: WorkerRunReport): Promise<void> {
  await direct(
    `INSERT INTO workers (name, instance_id, version, state, heartbeat_at, last_run_at, last_result)
     VALUES ($1, $2, 'a24', 'idle', now(), now(), $3::jsonb)
     ON CONFLICT (name) DO UPDATE SET instance_id = EXCLUDED.instance_id, heartbeat_at = now(), last_run_at = now(), last_result = EXCLUDED.last_result, state = 'idle'`,
    [worker, String(process.pid), JSON.stringify({ claimed: report.claimed, done: report.done, blocked: report.blocked, failed: report.failed, swept: report.swept })],
  );
}
