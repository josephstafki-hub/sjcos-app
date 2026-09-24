// Measurement cases (A18) — pure `run` style, no server-only import.
//
// A case is opened the moment a piece of work becomes ELIGIBLE for automation
// (a lead needs a follow-up, a package is ready to release, an invoice is due
// to go out …) and closed with an outcome. The case stays in the denominator
// whatever happens to it. Owner time is derived from owner_touches linked by
// decision_id / work_item_id so a manual review or correction counts as
// owner time even when the agent did the rest.
//
// Other workstreams call:
//   openCase(run, { kind, ref, ... })   when work becomes eligible
//   recordOwnerTouch(run, { ... })      whenever Joe approves / edits / corrects
//   closeCase(run, id, { outcome })     when the outcome is known

import type { Run } from "../commands/core.ts";
import { deriveMode, deriveOwnerSeconds, summarizeCases, type CaseRow, type CaseSummary, type Mode, type Outcome } from "./math.ts";

export interface OpenCaseInput {
  kind: string;
  /** Stable business reference; (kind, ref.kind, ref.id) is unique → re-opening returns the existing case. */
  ref?: { kind: string; id: string } | null;
  workItemId?: string | null;
  decisionId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  eligible?: boolean;
  mode?: Mode;
  authRef?: string | null;
  openedBy?: string;
  notes?: string;
}

export interface MeasurementCase {
  id: string;
  kind: string;
  ref_kind: string | null;
  ref_id: string | null;
  work_item_id: string | null;
  decision_id: string | null;
  project_id: string | null;
  lead_id: string | null;
  eligible: boolean;
  outcome: Outcome;
  mode: Mode;
  owner_seconds: number | null;
  agent_seconds: number | null;
  latency_ms: string | null;
  cost_usd: string | null;
  auth_ref: string | null;
  opened_by: string;
  created_at: string;
  closed_at: string | null;
  notes: string;
}

const CASE_COLS = `id, kind, ref_kind, ref_id, work_item_id, decision_id, project_id, lead_id, eligible, outcome, mode,
  owner_seconds, agent_seconds, latency_ms::text AS latency_ms, cost_usd::text AS cost_usd, auth_ref, opened_by,
  created_at::text AS created_at, closed_at::text AS closed_at, notes`;

/** Open (or return the already-open) case for a business reference. */
export async function openCase(run: Run, input: OpenCaseInput): Promise<MeasurementCase> {
  if (input.ref?.id) {
    const [existing] = await run<MeasurementCase>(
      `SELECT ${CASE_COLS} FROM measurement_cases WHERE kind = $1 AND ref_kind = $2 AND ref_id = $3`,
      [input.kind, input.ref.kind, input.ref.id],
    );
    if (existing) return existing;
  }
  const [row] = await run<MeasurementCase>(
    `INSERT INTO measurement_cases (kind, ref_kind, ref_id, work_item_id, decision_id, project_id, lead_id, eligible, mode, auth_ref, opened_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${CASE_COLS}`,
    [
      input.kind,
      input.ref?.kind ?? null,
      input.ref?.id ?? null,
      input.workItemId ?? null,
      input.decisionId ?? null,
      input.projectId ?? null,
      input.leadId ?? null,
      input.eligible ?? true,
      input.mode ?? "unknown",
      input.authRef ?? null,
      input.openedBy ?? "system",
      input.notes ?? "",
    ],
  );
  return row;
}

export interface CloseCaseInput {
  outcome: Exclude<Outcome, "pending">;
  /** Explicit owner seconds (e.g. a timed manual review). Otherwise derived from linked owner_touches. */
  ownerSeconds?: number | null;
  agentSeconds?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  mode?: Mode;
  notes?: string;
  /** Link the case to a decision/work item at close time when it was not known at open. */
  decisionId?: string | null;
  workItemId?: string | null;
}

/** Close a case with its outcome. Failures stay in the denominator — this
 *  never deletes or marks a case ineligible. Owner seconds come from linked
 *  owner_touches unless given explicitly; null means unknown. */
export async function closeCase(run: Run, id: string, input: CloseCaseInput): Promise<MeasurementCase | null> {
  const [current] = await run<MeasurementCase>(`SELECT ${CASE_COLS} FROM measurement_cases WHERE id = $1 FOR UPDATE`, [id]);
  if (!current) return null;
  const decisionId = input.decisionId ?? current.decision_id;
  const workItemId = input.workItemId ?? current.work_item_id;
  const touches = await linkedTouches(run, { decisionId, workItemId, caseId: id });
  const owner = deriveOwnerSeconds(input.ownerSeconds, touches);
  const mode = deriveMode(input.mode ?? current.mode, touches);
  const [row] = await run<MeasurementCase>(
    `UPDATE measurement_cases
        SET outcome = $2, owner_seconds = $3, agent_seconds = COALESCE($4, agent_seconds), cost_usd = COALESCE($5, cost_usd),
            latency_ms = COALESCE($6, (EXTRACT(EPOCH FROM (now() - created_at)) * 1000)::bigint),
            mode = $7, decision_id = $8, work_item_id = $9, closed_at = COALESCE(closed_at, now()),
            notes = CASE WHEN $10 = '' THEN notes ELSE trim(both E'\\n' from notes || E'\\n' || $10) END
      WHERE id = $1
      RETURNING ${CASE_COLS}`,
    [id, input.outcome, owner.seconds, input.agentSeconds ?? null, input.costUsd ?? null, input.latencyMs ?? null, mode, decisionId, workItemId, input.notes ?? ""],
  );
  return row;
}

async function linkedTouches(run: Run, link: { decisionId: string | null; workItemId: string | null; caseId: string }): Promise<{ kind: string; seconds: number | null }[]> {
  return run<{ kind: string; seconds: number | null }>(
    `SELECT kind, seconds FROM owner_touches
      WHERE ($1::uuid IS NOT NULL AND decision_id = $1)
         OR ($2::uuid IS NOT NULL AND work_item_id = $2)
         OR (detail->>'case_id') = $3
      ORDER BY created_at`,
    [link.decisionId, link.workItemId, link.caseId],
  );
}

export interface OwnerTouchInput {
  /** approve / reject / edit / manual_send / review / correction / question_answer / … */
  kind: string;
  actorUserId?: string | null;
  decisionId?: string | null;
  workItemId?: string | null;
  projectId?: string | null;
  /** Explicit measurement case to attribute the time to (when no decision/work item link exists). */
  caseId?: string | null;
  /** Measured or estimated review time. Leave undefined when unknown — never guess 0. */
  seconds?: number | null;
  detail?: Record<string, unknown>;
}

/** Record one owner touch. Other modules call this from their own
 *  transaction whenever Joe approves, rejects, edits, corrects or manually
 *  sends something an agent prepared. */
export async function recordOwnerTouch(run: Run, input: OwnerTouchInput): Promise<{ id: string }> {
  const detail = { ...(input.detail ?? {}) } as Record<string, unknown>;
  if (input.caseId) detail.case_id = input.caseId;
  const [row] = await run<{ id: string }>(
    `INSERT INTO owner_touches (kind, actor_user_id, decision_id, work_item_id, project_id, seconds, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id::text AS id`,
    [input.kind, input.actorUserId ?? null, input.decisionId ?? null, input.workItemId ?? null, input.projectId ?? null, input.seconds ?? null, JSON.stringify(detail)],
  );
  return row;
}

export async function getCase(run: Run, id: string): Promise<MeasurementCase | null> {
  const [row] = await run<MeasurementCase>(`SELECT ${CASE_COLS} FROM measurement_cases WHERE id = $1`, [id]);
  return row ?? null;
}

export async function listCases(run: Run, opts: { from?: string; to?: string; kind?: string; limit?: number } = {}): Promise<MeasurementCase[]> {
  return run<MeasurementCase>(
    `SELECT ${CASE_COLS} FROM measurement_cases
      WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)
        AND ($3::text IS NULL OR kind = $3)
      ORDER BY created_at DESC LIMIT $4`,
    [opts.from ?? null, opts.to ?? null, opts.kind ?? null, opts.limit ?? 200],
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface AgentCostSummary {
  /** Sum of dev_agent_runs.cost_usd in the window (owner/dev panel runs). */
  dev_agent_runs_usd: number;
  dev_agent_runs: number;
  dev_agent_runs_unknown_cost: number;
  /** Sum of agent_usage.cost_usd (business worker runs), null when the table does not exist. */
  agent_usage_usd: number | null;
  agent_usage_runs: number | null;
  agent_usage_unknown_cost: number | null;
  /** Sum of agent_runs.cost_usd (operational receipts). */
  agent_runs_usd: number;
  agent_runs: number;
  agent_runs_unknown_cost: number;
  /** Everything known, added up. A floor: unknown-cost runs are listed, not zeroed. */
  known_total_usd: number;
  caveat: string;
}

export interface OwnerTouchSummary {
  touches: number;
  minutes_known: number;
  touches_unknown_seconds: number;
  by_kind: { kind: string; touches: number; minutes_known: number; unknown: number }[];
}

export interface MeasurementSummary extends CaseSummary {
  owner_touches: OwnerTouchSummary;
  agent_cost: AgentCostSummary;
}

/** Counts by kind with an explicit denominator and window, owner minutes
 *  (from cases AND from every owner touch in the window), agent cost and
 *  latency. Never a company-wide percentage. */
export async function measurementSummary(run: Run, window: { from: string; to: string }): Promise<MeasurementSummary> {
  const rows = await run<CaseRow>(
    `SELECT kind, eligible, outcome, mode, owner_seconds, agent_seconds, latency_ms::text AS latency_ms, cost_usd::text AS cost_usd,
            created_at::text AS created_at, closed_at::text AS closed_at
       FROM measurement_cases WHERE created_at >= $1 AND created_at < $2`,
    [window.from, window.to],
  );
  const base = summarizeCases(rows, window);
  const touchRows = await run<{ kind: string; touches: string; seconds: string | null; unknown: string }>(
    `SELECT kind, count(*)::text AS touches, sum(seconds)::text AS seconds, count(*) FILTER (WHERE seconds IS NULL)::text AS unknown
       FROM owner_touches WHERE created_at >= $1 AND created_at < $2 GROUP BY kind ORDER BY kind`,
    [window.from, window.to],
  );
  const by_kind = touchRows.map((r) => ({ kind: r.kind, touches: Number(r.touches), minutes_known: Math.round((Number(r.seconds ?? 0) / 60) * 10) / 10, unknown: Number(r.unknown) }));
  const owner_touches: OwnerTouchSummary = {
    touches: by_kind.reduce((a, r) => a + r.touches, 0),
    minutes_known: Math.round(by_kind.reduce((a, r) => a + r.minutes_known, 0) * 10) / 10,
    touches_unknown_seconds: by_kind.reduce((a, r) => a + r.unknown, 0),
    by_kind,
  };
  const agent_cost = await agentCost(run, window);
  const caveats = [...base.caveats];
  if (owner_touches.touches_unknown_seconds) caveats.push(`${owner_touches.touches_unknown_seconds} owner touch(es) carry no duration — counted as touches, not minutes.`);
  caveats.push(agent_cost.caveat);
  return { ...base, caveats, owner_touches, agent_cost };
}

async function tableExists(run: Run, name: string): Promise<boolean> {
  const [r] = await run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return Boolean(r?.ok);
}

export async function agentCost(run: Run, window: { from: string; to: string }): Promise<AgentCostSummary> {
  const [dev] = await run<{ usd: string | null; n: string; unknown: string }>(
    `SELECT sum(cost_usd)::text AS usd, count(*)::text AS n, count(*) FILTER (WHERE cost_usd IS NULL)::text AS unknown
       FROM dev_agent_runs WHERE created_at >= $1 AND created_at < $2`,
    [window.from, window.to],
  );
  const [ops] = await run<{ usd: string | null; n: string; unknown: string }>(
    `SELECT sum(cost_usd)::text AS usd, count(*)::text AS n, count(*) FILTER (WHERE cost_usd IS NULL)::text AS unknown
       FROM agent_runs WHERE started_at >= $1 AND started_at < $2`,
    [window.from, window.to],
  );
  let usage: { usd: string | null; n: string; unknown: string } | null = null;
  if (await tableExists(run, "agent_usage")) {
    [usage] = await run<{ usd: string | null; n: string; unknown: string }>(
      `SELECT sum(cost_usd)::text AS usd, count(*)::text AS n, count(*) FILTER (WHERE cost_usd IS NULL)::text AS unknown
         FROM agent_usage WHERE created_at >= $1 AND created_at < $2`,
      [window.from, window.to],
    );
  }
  const f = (s: string | null | undefined) => (s === null || s === undefined ? 0 : Number(s));
  const out: AgentCostSummary = {
    dev_agent_runs_usd: f(dev?.usd),
    dev_agent_runs: Number(dev?.n ?? 0),
    dev_agent_runs_unknown_cost: Number(dev?.unknown ?? 0),
    agent_usage_usd: usage ? f(usage.usd) : null,
    agent_usage_runs: usage ? Number(usage.n) : null,
    agent_usage_unknown_cost: usage ? Number(usage.unknown) : null,
    agent_runs_usd: f(ops?.usd),
    agent_runs: Number(ops?.n ?? 0),
    agent_runs_unknown_cost: Number(ops?.unknown ?? 0),
    known_total_usd: 0,
    caveat: "",
  };
  out.known_total_usd = Math.round((out.dev_agent_runs_usd + (out.agent_usage_usd ?? 0) + out.agent_runs_usd) * 1e6) / 1e6;
  const unknown = out.dev_agent_runs_unknown_cost + (out.agent_usage_unknown_cost ?? 0) + out.agent_runs_unknown_cost;
  out.caveat =
    `Agent cost is the sum of recorded per-run cost (dev_agent_runs${usage ? ", agent_usage" : ""}, agent_runs); ` +
    `${unknown} run(s) have no recorded cost, so this is a floor. Subscriptions are overhead, not per-run cost, and do not imply API credits.` +
    (usage ? "" : " agent_usage table not present — business-worker usage not included.");
  return out;
}
