// Capability status (A18) — implemented / deployed / enabled / proven as FOUR
// INDEPENDENT booleans, each claim backed by dated evidence.
//
//   implemented  code + tests exist on a branch (assignee, branch, commit)
//   deployed     that version runs on the live service (build id / restart time)
//   enabled      the policy / lane / setting is switched on for a stated scope
//   proven       observed doing the job on real cases, with evidence references
//
// None implies another: deployed-but-disabled is a normal state, and "proven"
// on a fixture is not "proven" in production. STATUS.md: "Each operational
// claim needs date, version and evidence." So setCapabilityState refuses to
// flip any state to true without an evidence entry. Nothing here promotes
// anything else. See docs/automation-reliability/capabilities.md.

import type { Run } from "../commands/core.ts";

export interface CapabilityDef {
  key: string;
  title: string;
  group: "task" | "feature";
  /** Workstream that owns the code (BUILD.md). */
  owner: string;
}

export const CAPABILITIES: readonly CapabilityDef[] = [
  { key: "A00", title: "Current evidence, test environment and migration discipline", group: "task", owner: "integration" },
  { key: "A01", title: "Stable obligations and protected task state", group: "task", owner: "WS-recovery" },
  { key: "A02", title: "Transactional runbook start, advance and repair", group: "task", owner: "WS-recovery" },
  { key: "A03a", title: "Shared server commands and minimum action records", group: "task", owner: "integration" },
  { key: "A03b", title: "Durable intake and supervised worker", group: "task", owner: "WS-worker" },
  { key: "A04", title: "Evidence-backed completion", group: "task", owner: "WS-recovery" },
  { key: "A05_A06", title: "Approval binding and duplicate-safe external actions", group: "task", owner: "WS-approvals" },
  { key: "A07a", title: "Small independent invoice integrity repair", group: "task", owner: "WS-money" },
  { key: "A07b", title: "Invoice lifecycle, balances and automatic contract billing", group: "task", owner: "WS-money" },
  { key: "A08a", title: "Immediate business-agent access restrictions", group: "task", owner: "WS-access" },
  { key: "A08b", title: "Enforced worker identities, budgets and recovery", group: "task", owner: "WS-access" },
  { key: "A09a", title: "Off-host backups, basic alerts and restore proof", group: "task", owner: "WS-worker" },
  { key: "A09b", title: "Independent uptime and business-progress monitoring", group: "task", owner: "WS-worker" },
  { key: "A10", title: "Automatic routine policy and one-tap decision surfaces", group: "task", owner: "WS-approvals" },
  { key: "A11", title: "Complete lead intake and follow-up", group: "task", owner: "WS-procurement" },
  { key: "A12", title: "Subcontractor paperwork collection", group: "task", owner: "WS-procurement" },
  { key: "A13", title: "Procurement, commitments and approved bill payment", group: "task", owner: "WS-procurement" },
  { key: "A14", title: "QuickBooks Online connection and reconciliation", group: "task", owner: "WS-money" },
  { key: "A15", title: "Evidence-based estimates and closeout cost learning", group: "task", owner: "WS-estimating" },
  { key: "A16", title: "Sub portal field evidence, scheduling and weekly client summaries", group: "task", owner: "WS-field" },
  { key: "A17", title: "Closeout, warranty, signed documents and approved marketing", group: "task", owner: "WS-field" },
  { key: "A18", title: "Baseline, overhead, learning governance and truthful procedures", group: "task", owner: "WS-measure" },
  { key: "A19", title: "Owner site and office time capture", group: "task", owner: "WS-field" },
  { key: "A20", title: "Square card and ACH customer payments", group: "task", owner: "WS-money" },
  { key: "A21", title: "Integrate existing full 3-D designer and retire Houzz dependency", group: "task", owner: "WS-field" },
  { key: "A22", title: "Delegated approvals and employee accounts", group: "task", owner: "WS-access" },
  { key: "A23", title: "Confirmed lead-to-closeout workflow and proactive estimate assembly", group: "task", owner: "integration" },
  { key: "A24", title: "Operating-agent instructions, context and behavior evaluations", group: "task", owner: "WS-agents" },
  { key: "feature.decisions", title: "One-tap decisions (stage / resolve / consume)", group: "feature", owner: "WS-approvals" },
  { key: "feature.dispatcher", title: "Intent dispatcher and provider adapters", group: "feature", owner: "WS-approvals" },
  { key: "feature.square", title: "Square payments", group: "feature", owner: "WS-money" },
  { key: "feature.qbo", title: "QuickBooks Online sync", group: "feature", owner: "WS-money" },
  { key: "feature.weekly_summary", title: "Weekly client summary", group: "feature", owner: "WS-field" },
  { key: "feature.owner_time", title: "Owner time capture", group: "feature", owner: "WS-field" },
  { key: "feature.measurement", title: "Measurement cases and baseline", group: "feature", owner: "WS-measure" },
  { key: "feature.overhead", title: "Overhead subscriptions and metered charges", group: "feature", owner: "WS-measure" },
  { key: "feature.procedure_checks", title: "Procedure versioning and truthfulness checks", group: "feature", owner: "WS-measure" },
];

export const CAPABILITY_STATES = ["implemented", "deployed", "enabled", "proven"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export interface CapabilityEvidence {
  date: string;
  version: string;
  note: string;
  /** Which states this entry supports. */
  states: CapabilityState[];
  by?: string;
}

export interface CapabilityRow {
  key: string;
  title: string;
  implemented: boolean;
  deployed: boolean;
  enabled: boolean;
  proven: boolean;
  evidence: CapabilityEvidence[];
  notes: string;
  updated_at: string;
}

const COLS = `key, title, implemented, deployed, enabled, proven, evidence, notes, updated_at::text AS updated_at`;

/** Make sure every catalogue entry has a row (all false). Idempotent; never
 *  resets states that are already set. */
export async function ensureCapabilities(run: Run): Promise<number> {
  let inserted = 0;
  for (const c of CAPABILITIES) {
    const rows = await run(`INSERT INTO capability_status (key, title) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title WHERE capability_status.title = '' RETURNING key`, [c.key, c.title]);
    inserted += rows.length;
  }
  return inserted;
}

export interface SetCapabilityInput {
  implemented?: boolean;
  deployed?: boolean;
  enabled?: boolean;
  proven?: boolean;
  /** Required when any state is set to true. */
  evidence?: { date?: string; version: string; note: string; by?: string } | null;
  notes?: string;
}

export class CapabilityEvidenceRequired extends Error {
  constructor(key: string, states: string[]) {
    super(`capability ${key}: setting ${states.join(", ")} to true needs evidence {date, version, note}`);
    this.name = "CapabilityEvidenceRequired";
  }
}

/** Set any subset of the four states. States not mentioned are untouched —
 *  they are independent. Flipping to true appends an evidence entry that
 *  names the states it supports. */
export async function setCapabilityState(run: Run, key: string, input: SetCapabilityInput): Promise<CapabilityRow> {
  const def = CAPABILITIES.find((c) => c.key === key);
  const claimed = CAPABILITY_STATES.filter((s) => input[s] === true);
  if (claimed.length && !(input.evidence && input.evidence.version && input.evidence.note)) {
    throw new CapabilityEvidenceRequired(key, claimed);
  }
  const entry: CapabilityEvidence | null = input.evidence
    ? {
        date: input.evidence.date ?? new Date().toISOString().slice(0, 10),
        version: input.evidence.version,
        note: input.evidence.note,
        states: claimed.length ? claimed : CAPABILITY_STATES.filter((s) => input[s] === false),
        ...(input.evidence.by ? { by: input.evidence.by } : {}),
      }
    : null;
  const [row] = await run<CapabilityRow>(
    `INSERT INTO capability_status (key, title, implemented, deployed, enabled, proven, evidence, notes)
     VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), COALESCE($5, false), COALESCE($6, false),
             COALESCE($7::jsonb, '[]'::jsonb), COALESCE($8, ''))
     ON CONFLICT (key) DO UPDATE SET
       implemented = COALESCE($3, capability_status.implemented),
       deployed    = COALESCE($4, capability_status.deployed),
       enabled     = COALESCE($5, capability_status.enabled),
       proven      = COALESCE($6, capability_status.proven),
       evidence    = capability_status.evidence || COALESCE($7::jsonb, '[]'::jsonb),
       notes       = COALESCE($8, capability_status.notes),
       updated_at  = now()
     RETURNING ${COLS}`,
    [key, def?.title ?? key, input.implemented ?? null, input.deployed ?? null, input.enabled ?? null, input.proven ?? null, entry ? JSON.stringify([entry]) : null, input.notes ?? null],
  );
  return row;
}

export interface CapabilityReport {
  generated_at: string;
  counts: Record<CapabilityState, number> & { total: number };
  rows: (CapabilityRow & { group: string; owner: string; in_catalogue: boolean })[];
  caveat: string;
}

export async function capabilityReport(run: Run): Promise<CapabilityReport> {
  const rows = await run<CapabilityRow>(`SELECT ${COLS} FROM capability_status ORDER BY key`);
  const byKey = new Map(CAPABILITIES.map((c) => [c.key, c]));
  const merged = rows.map((r) => {
    const d = byKey.get(r.key);
    return { ...r, evidence: Array.isArray(r.evidence) ? r.evidence : [], group: d?.group ?? "other", owner: d?.owner ?? "", in_catalogue: Boolean(d) };
  });
  const counts = { implemented: 0, deployed: 0, enabled: 0, proven: 0, total: merged.length };
  for (const r of merged) for (const s of CAPABILITY_STATES) if (r[s]) counts[s] += 1;
  return {
    generated_at: new Date().toISOString(),
    counts,
    rows: merged.sort((a, b) => (a.group === b.group ? a.key.localeCompare(b.key) : a.group === "task" ? -1 : 1)),
    caveat: "The four states are independent claims, each dated with a version and evidence. Deployed-but-disabled is normal; proven means observed on real cases within the evidence's stated scope, nothing wider.",
  };
}
