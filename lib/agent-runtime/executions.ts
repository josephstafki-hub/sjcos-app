// agent_executions — the record of every operating-agent run (A24).
//
// One row per run from ANY entry point: the background worker, the Ask-window
// business profile, Hermes, claude.ai over MCP (record_agent_execution). What
// gets recorded: the instruction versions loaded (checksums), the tool-list
// checksum, model, context refs, the tool trace, records touched, owner
// prompts, blocked reason, next trigger, latency and cost.
//
// Pure over run(sql, params).

import type { Run } from "../commands/core.ts";

export interface ToolTraceEntry {
  seq: number;
  tool: string;
  input: unknown;
  result?: string | null;
  is_error?: boolean;
  at?: string;
}

export interface RecordTouched {
  kind: string;
  id: string | null;
  action: string;
}

export interface StartExecutionInput {
  triggerId?: string | null;
  triggerKind: string;
  triggerRef: string;
  runtime: string;
  entryPoint: "worker" | "panel" | "mcp" | "eval" | "external";
  principal: Record<string, unknown>;
  projectId?: string | null;
  leadId?: string | null;
  instructionVersions: Record<string, unknown>;
  runbookVersion?: string | null;
  model?: string | null;
  contextRefs?: unknown[];
  contextChars?: number | null;
  devAgentRunId?: string | null;
}

export interface FinishExecutionInput {
  status: "done" | "blocked" | "failed" | "timeout";
  toolTrace?: ToolTraceEntry[];
  toolNames?: string[];
  toolListChecksum?: string | null;
  resultSummary?: string | null;
  recordsTouched?: RecordTouched[];
  ownerPrompts?: number;
  blockedReason?: string | null;
  nextTrigger?: unknown;
  error?: string | null;
  latencyMs?: number | null;
  costUsd?: number | null;
  numTurns?: number | null;
  sessionId?: string | null;
  model?: string | null;
  skillVersions?: unknown[];
}

export interface AgentExecution {
  id: string;
  trigger_id: string | null;
  trigger_kind: string;
  trigger_ref: string;
  runtime: string;
  entry_point: string;
  principal: Record<string, unknown>;
  project_id: string | null;
  lead_id: string | null;
  instruction_versions: Record<string, unknown>;
  runbook_version: string | null;
  tool_list_checksum: string | null;
  tool_names: string[];
  model: string | null;
  context_refs: unknown[];
  context_chars: number | null;
  tool_trace: ToolTraceEntry[];
  result_summary: string | null;
  records_touched: RecordTouched[];
  owner_prompts: number;
  blocked_reason: string | null;
  next_trigger: unknown;
  status: "running" | "done" | "blocked" | "failed" | "timeout";
  error: string | null;
  latency_ms: number | null;
  cost_usd: string | null;
  num_turns: number | null;
  dev_agent_run_id: string | null;
  session_id: string | null;
  started_at: string;
  finished_at: string | null;
}

const COLS = `id, trigger_id, trigger_kind, trigger_ref, runtime, entry_point, principal, project_id, lead_id, instruction_versions, runbook_version,
  tool_list_checksum, tool_names, model, context_refs, context_chars, tool_trace, result_summary, records_touched, owner_prompts, blocked_reason,
  next_trigger, status, error, latency_ms, cost_usd::text AS cost_usd, num_turns, dev_agent_run_id, session_id, started_at::text AS started_at, finished_at::text AS finished_at`;

export async function startExecution(run: Run, input: StartExecutionInput): Promise<AgentExecution> {
  const [row] = await run<AgentExecution>(
    `INSERT INTO agent_executions (trigger_id, trigger_kind, trigger_ref, runtime, entry_point, principal, project_id, lead_id, instruction_versions, runbook_version, model, context_refs, context_chars, dev_agent_run_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14)
     RETURNING ${COLS}`,
    [
      input.triggerId ?? null,
      input.triggerKind,
      input.triggerRef,
      input.runtime,
      input.entryPoint,
      JSON.stringify(input.principal ?? {}),
      input.projectId ?? null,
      input.leadId ?? null,
      JSON.stringify(input.instructionVersions ?? {}),
      input.runbookVersion ?? null,
      input.model ?? null,
      JSON.stringify(input.contextRefs ?? []),
      input.contextChars ?? null,
      input.devAgentRunId ?? null,
    ],
  );
  return row;
}

/** Bounded, secret-free tool trace: results truncated, inputs kept (they are
 *  what the model asked for), no env or credentials ever appear. */
export function boundTrace(trace: ToolTraceEntry[], maxEntries = 200, maxResultChars = 600, maxInputChars = 2000): ToolTraceEntry[] {
  return trace.slice(0, maxEntries).map((t) => {
    let input: unknown = t.input;
    try {
      const s = JSON.stringify(t.input ?? null);
      if (s.length > maxInputChars) input = { truncated: true, preview: s.slice(0, maxInputChars) };
    } catch {
      input = { unserializable: true };
    }
    const result = t.result == null ? null : String(t.result).slice(0, maxResultChars);
    return { seq: t.seq, tool: t.tool, input, result, is_error: !!t.is_error, at: t.at };
  });
}

export async function finishExecution(run: Run, id: string, input: FinishExecutionInput): Promise<AgentExecution | null> {
  const [row] = await run<AgentExecution>(
    `UPDATE agent_executions
        SET status = $2, tool_trace = $3::jsonb, tool_names = $4::jsonb, tool_list_checksum = COALESCE($5, tool_list_checksum), result_summary = $6,
            records_touched = $7::jsonb, owner_prompts = $8, blocked_reason = $9, next_trigger = $10::jsonb, error = $11,
            latency_ms = COALESCE($12, EXTRACT(EPOCH FROM (now() - started_at))::int * 1000), cost_usd = $13, num_turns = $14, session_id = COALESCE($15, session_id),
            model = COALESCE($16, model), skill_versions = $17::jsonb, finished_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [
      id,
      input.status,
      JSON.stringify(boundTrace(input.toolTrace ?? [])),
      JSON.stringify(input.toolNames ?? []),
      input.toolListChecksum ?? null,
      input.resultSummary == null ? null : String(input.resultSummary).slice(0, 4000),
      JSON.stringify(input.recordsTouched ?? []),
      input.ownerPrompts ?? 0,
      input.blockedReason == null ? null : String(input.blockedReason).slice(0, 2000),
      input.nextTrigger === undefined ? null : JSON.stringify(input.nextTrigger),
      input.error == null ? null : String(input.error).slice(0, 2000),
      input.latencyMs ?? null,
      input.costUsd ?? null,
      input.numTurns ?? null,
      input.sessionId ?? null,
      input.model ?? null,
      JSON.stringify(input.skillVersions ?? []),
    ],
  );
  return row ?? null;
}

export async function getExecution(run: Run, id: string): Promise<AgentExecution | null> {
  const [row] = await run<AgentExecution>(`SELECT ${COLS} FROM agent_executions WHERE id = $1`, [id]);
  return row ?? null;
}

export async function listExecutions(run: Run, opts: { projectId?: string | null; leadId?: string | null; limit?: number } = {}): Promise<AgentExecution[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.projectId) {
    params.push(opts.projectId);
    where.push(`project_id = $${params.length}`);
  }
  if (opts.leadId) {
    params.push(opts.leadId);
    where.push(`lead_id = $${params.length}`);
  }
  params.push(opts.limit ?? 20);
  return run<AgentExecution>(`SELECT ${COLS} FROM agent_executions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT $${params.length}`, params);
}

/** Records the model touched, derived from the tool trace (what it asked
 *  for) plus the app_change_log scopes written via MCP during the run. */
export function recordsFromTrace(trace: ToolTraceEntry[]): RecordTouched[] {
  const out: RecordTouched[] = [];
  const seen = new Set<string>();
  const push = (kind: string, id: unknown, action: string) => {
    if (id === null || id === undefined || id === "") return;
    const key = `${kind}:${String(id)}:${action}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, id: String(id).slice(0, 120), action });
  };
  for (const t of trace) {
    if (t.is_error) continue;
    const p = (t.input && typeof t.input === "object" ? t.input : {}) as Record<string, unknown>;
    const action = /^(create_|import_|add_|start_|submit_|request_)/.test(t.tool) ? "created" : /^(get_|list_|search|fetch|business_snapshot|suggest_|check_)/.test(t.tool) ? "read" : "updated";
    if (action === "read") continue;
    if (typeof p.project_slug === "string") push("project", p.project_slug, action);
    if (typeof p.lead_slug === "string") push("lead", p.lead_slug, action);
    if (typeof p.work_item_id === "string") push("work_item", p.work_item_id, action);
    if (p.estimate_id != null) push("estimate", p.estimate_id, action);
    if (p.selection_id != null) push("selection", p.selection_id, action);
    if (p.po_id != null) push("purchase_order", p.po_id, action);
    if (p.id != null && /work_item/.test(t.tool)) push("work_item", p.id, action);
    if (p.id != null && /document_draft/.test(t.tool)) push("document_draft", p.id, action);
    if (p.id != null && /purchase_order/.test(t.tool)) push("purchase_order", p.id, action);
    if (p.id != null && /bid/.test(t.tool)) push("bid_package", p.id, action);
    // Ids returned by create tools.
    if (t.result) {
      try {
        const r = JSON.parse(t.result) as Record<string, unknown>;
        if (r && typeof r === "object" && r.ok !== false && (typeof r.id === "string" || typeof r.id === "number")) {
          const kind = /work_item/.test(t.tool) ? "work_item" : /estimate/.test(t.tool) ? "estimate" : /selection_section/.test(t.tool) ? "selection_section" : /selection/.test(t.tool) ? "selection" : /knowledge/.test(t.tool) ? "knowledge_item" : /agent_run/.test(t.tool) ? "agent_run" : /receipt/.test(t.tool) ? "agent_receipt" : /mood/.test(t.tool) ? "mood_board" : /lead/.test(t.tool) ? "lead" : t.tool;
          push(kind, r.id, "created");
        }
      } catch {
        /* result is not JSON */
      }
    }
  }
  return out;
}

/** Tool calls that put something in front of Joe. */
export const OWNER_PROMPT_TOOLS = new Set(["ask_owner", "request_owner_permission", "submit_draft_for_approval"]);

export function countOwnerPrompts(trace: ToolTraceEntry[]): number {
  let n = 0;
  for (const t of trace) {
    if (t.is_error) continue;
    if (OWNER_PROMPT_TOOLS.has(t.tool)) n++;
    else if (t.tool === "create_work_item") {
      const p = (t.input && typeof t.input === "object" ? t.input : {}) as Record<string, unknown>;
      if ((p.assignee_kind ?? "human") === "human") n++;
    }
  }
  return n;
}
