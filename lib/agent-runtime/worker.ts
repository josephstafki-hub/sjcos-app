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
  /** Only claim triggers of these kinds (the app's immediate filing pass claims 'filing' only). */
  kinds?: readonly string[] | null;
}

/** The one to-do that collects what Joe owes the financials runs, across jobs. */
export const FINANCIALS_MISSING_TITLE = "Financials: what's missing";

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
    message: `An inbound message: determine what it resolves or asks. A question about an option is not a choice; enthusiasm is not approval; a request to change payment/bank details is a fraud-risk fact to flag, never an update. Apply supported state changes only; draft any reply for approval (never send). Always draft the reply, even when Joe has to decide something first (then a short holding reply that promises nothing). Reply on the channel it came in on: a message with channel "portal" gets a portal reply — submit_draft_for_approval with channel "portal" and only the message body, so Approve posts it in the client's portal thread; an email gets an email draft (To:/Subject:).`,
    note: `Owner/site notes: extract source-linked facts, measurements, decisions and issues; update affected records; preserve Joe's allocations and dedicated prices unless the notes explicitly change them; ask targeted clarifications for ambiguities. A site-note update never constitutes release permission.`,
    quote: `A supplier/sub quote: check product, quantity, unit basis, tax/freight coverage and revision. Noncompetitive → replace the provisional cost in the draft estimate. Competing → prepare an equivalent-scope comparison and stage the owner choice; never sum or auto-select. Never reprice an offer already sent to the client.`,
    selection: `A client selection/feedback event: incorporate an actual choice into the estimate (remove superseded options; unselected options stay out of the total). Feedback → revise the affected artifact and stage the revision for Joe's review; never broadcast an unapproved revision.`,
    payment: `A payment event: record what it unlocks (gates: signed construction agreement AND initial payment before confirming dates or ordering). Invoices sent and promised payments are not collected funds.`,
    field_report: `A field report: use the evidence already supplied; ask precisely and only for what is missing; prepare Joe's completion confirmation with evidence; a sub's claim or photos alone never authorize completion or billing. Snags: alert Joe with facts, impact, recommendation and the specific continue/pause decision; never decide it yourself.`,
    approval: `An owner decision was resolved: apply exactly what it authorizes for that exact content/recipient; nothing broader. If rejected/revoked, stop the dependent action and record why.`,
    signoff: `Written client sign-off: the final invoice for the verified remaining balance (approved CO balances, all payments/credits applied once) and configured post-project follow-through are automatic ONLY under their active policy; if no policy is active, stage them and record the missing policy as the blocked reason. Never a duplicate final invoice. Never invent warranties or marketing enrollment.`,
    permit: `Construction just started on this job (construction agreement signed, deposit paid). Work out what the city needs before work can start and file it on the project. This run — and only this kind of run — has WebSearch and WebFetch: use them on the city's / county's own official pages (permit office, building code adoption, fee schedule, application portal), not on blogs or forums.
(1) Read the job: get_project (address = jurisdiction; the formal estimate and documents = the scope), get_project_workflow, list_project_files (plans, survey, engineering on file), and search_knowledge on the project for anything already known about permits here.
(2) From the address, find the jurisdiction that issues the permit (city, or the county/township if unincorporated) and its permit office/portal. For THIS scope, decide which permits apply: building; electrical, plumbing, mechanical/HVAC and gas (note which are normally pulled by the licensed sub, not SJ Carpentry); demolition; zoning/land-use or setback/variance review; right-of-way/dumpster; historic district review; anything else the city lists.
(3) For each permit: what the application needs (forms, plan sets and their required detail, site plan/survey, energy code or structural calcs, contractor license number, job valuation, owner authorization), the fee or how it is computed, typical review time, and the inspections it triggers. Compare against the project files and mark each item on hand (cite the file id) or MISSING.
(4) save_project_file ONE markdown file named "Permit requirements — <City>.md" with tag "PERMIT · Requirements" (it replaces an earlier copy with the same name). Sections: Summary (jurisdiction, permits needed, who pulls each, est. fees, est. review time); Permit-by-permit detail; Checklist (on hand → file id / MISSING); Portal steps for a computer-use agent (portal URL, account/login needed, each screen and what to enter — address, owner, contractor SJ Carpentry LLC, valuation from the formal estimate, scope description — and which project files to upload); Sources (every official URL you used, with the date read). Never invent a fee, form name or URL: if you could not confirm it, write UNCONFIRMED and say where to check.
(5) If anything is MISSING or needs Joe, create ONE work item for Joe on this project titled "Permit: what's missing for <City>" listing exactly what is needed and from whom (check list_work_items first; never duplicate). Do not apply for, pay for or submit anything, and do not contact the city or the client.`,
    filing: `Joe sorted an emailed invoice / receipt on the Unsorted page (payload.doc_id) and this run finishes the job right away. Load skill file-invoice-receipt-rebate. Read the document with list_unsorted_documents (statuses as needed; match id = payload.doc_id). Be quick: a handful of tool calls.
If payload.mode = "owner_note": Joe typed where it goes (owner_note) instead of picking a project. Work out what he meant (list_projects / search for the job by client, street or nickname). Exactly one project, "overhead" or "not a business cost" → file_unsorted_document (target project + project_slug / overhead / dismiss, agent "claude-filing"). A split across jobs → file it to the job with the larger share with log_cost false, then record each job's share with record_sub_invoice (invoice) or add_expense (receipt) using source_ref "<doc source_ref>:<project slug>". If you can't tell where it goes, do NOT guess: reply_on_unsorted_document with one short question and give_back true, so it returns to Joe's tray. Once it is filed to a job with a cost, place that cost exactly as in "place_cost" below, then reply_on_unsorted_document (give_back false) with one plain line on where it went — never just repeat Joe's note.
If payload.mode = "place_cost": Joe already filed it to this project and the cost was logged (payload.cost_source / payload.cost_id). Put that cost in the right place on the job: get_project_financials, then assign_cost to the trade line (line_key) or change order the document is clearly for, and link_cost_to_po when it pays an open purchase order from the same vendor. If two lines fit or none clearly does, leave it unassigned. If an earlier cost looks like the same bill (same vendor and amount), don't delete anything: say so. Always finish with reply_on_unsorted_document (give_back false) in one plain line: where the cost went, or why it stayed unassigned / looks like a duplicate.
A cost logged on the right job but left unassigned is a finished filing, not a block: when the job has no budget lines, change orders or POs yet (or it is an internal holding job), unassigned is the correct state and the job's financials pass places it once its budget exists. Then BLOCKED is "none". Don't ask Joe to set up budget lines for a receipt, and don't create budget lines yourself here.
Never send anything. Never change another document.`,
    financials: `Fill in this job's financials so Money › Overview can say what it is making. Load the skill with get_skill "fill-project-financials" and follow its steps exactly; it is the procedure, this is only the brief.
In short: get_project_financials, then the documents (list_project_files / get_project_file: the formal estimate, sub bids and invoices, purchase orders, receipts, Houzz PDFs — get_project_file returns a PDF's text, or its pages as images when it is a scan, so read them; "can't read the PDF" is not a reason to stop); budget lines (adopt_estimate_as_budget when the job has an approved estimate, else set_budget_lines); every cost on file entered once (record_sub_invoice / add_expense with a source_ref, assign_cost, link_cost_to_po); set_budget_settings with costs_through and notes. Mark budget_complete only when every trade is listed with a real expected cost.
The job total and what has been paid are computed from the records — never try to change them, and don't create change orders or invoices.
If an open work item titled "Fill in the financials for …" exists on this job (list_work_items), mark it done when you finish.
What Joe still has to supply goes on ONE shared to-do for every job, so he answers them in one sitting instead of a to-do per job: "${FINANCIALS_MISSING_TITLE}" (no job linked, Joe's). Find it with list_work_items { status: "queued", limit: 200 } (exact title). If it exists, update_work_item its body: replace this job's section if it has one, otherwise append it, and keep every other job's section exactly as it is. If it doesn't exist, create_work_item it with this job's section as the body. A section is "## <job name> (<project slug>)" then a short list of exactly what is needed and from whom (a cost, an hours figure, a document); nothing Joe has already given. If an older per-job to-do "Financials: what's missing for <job name>" is open on this job, carry its still-open points into your section and update_work_item_status it to cancelled with a note naming the shared to-do. When nothing is missing, remove this job's section (cancel the shared to-do if no sections are left). Finish with record_receipt.`,
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

export const DAILY_COST_CAP_KEY = "agents.daily_cost_cap_usd";
const DEFAULT_DAILY_COST_CAP_USD = 25;

/** Tier 4: a dollar ceiling on background agent runs per Central day
 *  (app_settings agents.daily_cost_cap_usd, default $25; 0 = no cap). Normal
 *  days run $1–$9; the cap stops a runaway loop, not normal work. When it is
 *  reached the worker claims nothing more today (triggers wait, nothing is
 *  lost) and Joe gets one bell + push for the day. */
export async function dailyCostCap(run: Run): Promise<{ reached: boolean; spentUsd: number; capUsd: number; reason: string }> {
  const [setting] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [DAILY_COST_CAP_KEY]);
  const capUsd = setting ? Number(setting.value) : DEFAULT_DAILY_COST_CAP_USD;
  const [row] = await run<{ spent: string }>(
    `SELECT COALESCE(sum(cost_usd), 0)::text AS spent FROM agent_executions
      WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')`,
  );
  const spentUsd = Number(row?.spent ?? 0);
  if (!Number.isFinite(capUsd) || capUsd <= 0 || spentUsd < capUsd) return { reached: false, spentUsd, capUsd, reason: "" };
  const reason = `Background agents stopped for today: $${spentUsd.toFixed(2)} spent, over the $${capUsd.toFixed(2)} daily cap. Waiting work resumes tomorrow (raise agents.daily_cost_cap_usd to resume now).`;
  const [day] = await run<{ d: string }>(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text AS d`);
  const claimed = await run(`INSERT INTO reminder_log (dedup_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING dedup_key`, [`agent-cost-cap:${day?.d ?? "today"}`]);
  if (claimed.length) {
    await run(`INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href) VALUES ('job', 'Agents', 'flag', 'star', $1, $2, 'Just now', true, '/engine')`, ["Background agents hit today's spending cap", reason]);
    await run(`INSERT INTO push_outbox (kind, title, body, href, send_after) VALUES ('agent_failure', $1, $2, '/engine', now())`, ["Agents hit today's spending cap", reason]);
  }
  return { reached: true, spentUsd, capUsd, reason };
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
  if (!opts.ignoreLane) {
    const cap = await dailyCostCap(direct);
    if (cap.reached) {
      report.lane = { open: false, reason: cap.reason };
      log(cap.reason);
      return report;
    }
  }
  const worker = opts.worker ?? WORKER_NAME;
  const claimed = await tx((run) => claimAgentTriggers(run, { worker, limit: opts.limit ?? 1, leaseSeconds: opts.leaseSeconds ?? 900, kinds: opts.kinds }));
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
