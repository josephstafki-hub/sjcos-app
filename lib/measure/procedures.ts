// Procedure versioning + truthfulness checks (A18). Pure `run` style.
//
// snapshotProcedures(run) records what the agents are actually being told —
// skills (skill_versions), runbooks (+ runbook_definition_versions when
// present), active policies and instruction blocks (agent_instruction_versions
// when WS-agents lands it) — as (kind, key, version, checksum) rows with the
// tool and field names each body references.
//
// checkProcedures(run, { knownTools, knownFields, retiredFields }) opens a
// procedure_checks row for every finding and resolves rows whose finding is
// gone:
//   missing_tool                 a procedure names a tool the MCP server does not register
//   retired_field                a procedure names a field that no longer exists
//   contradiction                an approved skill/runbook says the opposite of an ACTIVE
//                                policy or a settled DECISIONS.md rule (small ruleset below)
//   unapproved_authority_change  a pending agent memory / proposed skill would change what
//                                agents may send, pay or price — "proposed rule, not authority"
//
// Nothing here promotes, approves, retires or rewrites anything. It records.
// The tool list is an INPUT (scripts/list-mcp-tools.mjs prints it) so this
// module never has to import the MCP server.

import { createHash } from "node:crypto";
import type { Run } from "../commands/core.ts";
import { classifyMemory, isUnapprovedAuthorityChange, type MemoryLike } from "./learning.ts";

export type ProcedureKind = "skill" | "runbook" | "policy" | "instruction_block";
export type CheckKind = "missing_tool" | "retired_field" | "contradiction" | "unapproved_authority_change";

export interface ProcedureVersion {
  kind: ProcedureKind;
  key: string;
  version: string;
  checksum: string;
  tool_refs: string[];
  field_refs: string[];
  status: string;
  body: string;
}

export interface ProcedureCheck {
  id: string;
  procedure_kind: string;
  procedure_key: string;
  version: string;
  check_kind: CheckKind;
  detail: string;
  fingerprint: string;
  detected_at: string;
  resolved_at: string | null;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ── Reference extraction ────────────────────────────────────────────────────

const IDENT = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const TOOL_VERB = /^(get|list|create|update|send|record|add|set|submit|request|search|fetch|snooze|capture|suggest|start|mark|award|close|queue|release|remember|place|import|render|enrich|propose|adopt|assign|link|attach|remove|delete|compare|build|describe|duplicate|save|stage|run|view|check|ask|apply|arrange|complete|advance|repair|open|reconcile|pay|approve|reject|resolve|consume|enqueue|dispatch|classify|measure)_/;

/** Fields that used to exist and were retired; a procedure still naming them
 *  is out of date. Callers extend via `retiredFields`. */
export const RETIRED_FIELDS: readonly string[] = ["retainer_status", "houzz_project_id", "hermes_only", "estimate_status_legacy"];

/** Tool-shaped identifiers in a body: anything in the known list, plus any
 *  verb_noun identifier (candidate tools an author may have invented). */
export function extractToolRefs(body: string, knownTools: readonly string[] = []): string[] {
  const known = new Set(knownTools);
  const out = new Set<string>();
  for (const m of body.matchAll(IDENT)) {
    const t = m[0];
    if (known.has(t) || TOOL_VERB.test(t)) out.add(t);
  }
  return [...out].sort();
}

/** Field-shaped identifiers: anything in the known or retired lists. */
export function extractFieldRefs(body: string, knownFields: readonly string[] = [], retiredFields: readonly string[] = RETIRED_FIELDS): string[] {
  const set = new Set([...knownFields, ...retiredFields]);
  const out = new Set<string>();
  for (const m of body.matchAll(IDENT)) if (set.has(m[0])) out.add(m[0]);
  return [...out].sort();
}

// ── Contradiction ruleset (DECISIONS.md, encoded small) ────────────────────

export interface ContradictionRule {
  id: string;
  /** Only fires while this policy is active; omit for always-on DECISIONS.md rules. */
  policyKey?: string;
  pattern: RegExp;
  message: string;
}

export const CONTRADICTION_RULES: readonly ContradictionRule[] = [
  {
    id: "invoice.initial_on_acceptance",
    policyKey: "invoice.initial_on_acceptance",
    pattern: /\binvoices?\b[^.\n]{0,80}\b(always|must|only)\b[^.\n]{0,60}\b(joe|owner)('s)?\b[^.\n]{0,40}\b(send|approv|sign[- ]?off|permission)/i,
    message: "says invoices always need Joe's send, but policy invoice.initial_on_acceptance is active: the initial invoice goes out automatically on verified acceptance.",
  },
  {
    id: "routine.followup",
    policyKey: "routine.followup",
    pattern: /\b(follow[- ]?ups?|nudges?|reminders?)\b[^.\n]{0,80}\b(always|must|never without|only with)\b[^.\n]{0,60}\b(joe|owner)('s)?\b[^.\n]{0,40}\b(approv|permission|ok|sign[- ]?off)/i,
    message: "says routine follow-ups always need Joe's approval, but policy routine.followup is active: routine follow-ups run automatically within the policy.",
  },
  {
    id: "weekly.client_summary",
    policyKey: "weekly.client_summary",
    pattern: /\bweekly\b[^.\n]{0,40}\b(summary|summaries|update)\b[^.\n]{0,80}\b(always|must|never without)\b[^.\n]{0,60}\b(joe|owner)/i,
    message: "says weekly client summaries always need Joe, but policy weekly.client_summary is active: verified summaries go automatically.",
  },
  {
    id: "profit_policy",
    pattern: /\b(markup|margin|profit target|profit)\b[^.\n]{0,80}\b(without|no need for|skip|don'?t need)\b[^.\n]{0,40}\b(approv|asking|joe|owner)/i,
    message: "allows changing markup / profit targets without approval; DECISIONS.md Profit policy: changes to markup and profit targets need approval.",
  },
  {
    id: "urgent_issues",
    pattern: /\b(delay|unexpected condition|added cost|material problem)s?\b[^.\n]{0,80}\b(tell|notify|email|text|inform)\b[^.\n]{0,20}\bclient\b[^.\n]{0,60}\b(directly|immediately|without (joe|owner|asking))/i,
    message: "sends delays / unexpected conditions / added costs straight to the client; DECISIONS.md Urgent issues: these go to Joe before client notification.",
  },
  {
    id: "new_paid_services",
    pattern: /\b(sign up|subscribe|buy|purchase|enable)\b[^.\n]{0,40}\b(api|service|plan|credits?)\b[^.\n]{0,60}\b(without|no need for|skip)\b[^.\n]{0,30}\b(approv|asking|joe|owner)/i,
    message: "authorises new paid services without approval; DECISIONS.md AI budget: new paid services require purchase approval.",
  },
];

export function findContradictions(body: string, activePolicyKeys: ReadonlySet<string>, rules: readonly ContradictionRule[] = CONTRADICTION_RULES): ContradictionRule[] {
  return rules.filter((r) => (!r.policyKey || activePolicyKeys.has(r.policyKey)) && r.pattern.test(body));
}

// ── Snapshot ────────────────────────────────────────────────────────────────

async function tableExists(run: Run, name: string): Promise<boolean> {
  const [r] = await run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return Boolean(r?.ok);
}

async function columns(run: Run, table: string): Promise<Set<string>> {
  const rows = await run<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return new Set(rows.map((r) => r.column_name));
}

/** Load every current procedure body (no writes). */
export async function loadProcedures(run: Run, opts: { knownTools?: readonly string[]; knownFields?: readonly string[]; retiredFields?: readonly string[] } = {}): Promise<ProcedureVersion[]> {
  const out: ProcedureVersion[] = [];
  const mk = (kind: ProcedureKind, key: string, version: string, body: string, status: string): ProcedureVersion => ({
    kind,
    key,
    version,
    checksum: sha256(body),
    tool_refs: extractToolRefs(body, opts.knownTools),
    field_refs: extractFieldRefs(body, opts.knownFields, opts.retiredFields),
    status,
    body,
  });

  const skills = await run<{ slug: string; version: number | null; body: string | null; status: string; review_status: string; allowed_tools: string[] | null; approval_rules: string; when_to_use: string }>(
    `SELECT s.slug, v.version, v.body_markdown AS body, COALESCE(v.status, 'none') AS status, s.review_status, s.allowed_tools, s.approval_rules, s.when_to_use
       FROM skills s LEFT JOIN skill_versions v ON v.id = s.current_version_id
      WHERE s.active`,
  );
  for (const s of skills) {
    const body = [s.when_to_use, s.approval_rules, (s.allowed_tools ?? []).join(" "), s.body ?? ""].join("\n");
    out.push(mk("skill", s.slug, String(s.version ?? 0), body, `${s.review_status}/${s.status}`));
  }

  const runbooks = await run<{ slug: string; body_markdown: string; active: boolean }>(`SELECT slug, body_markdown, active FROM runbooks WHERE active`);
  const rdv = (await tableExists(run, "runbook_definition_versions"))
    ? await run<{ runbook_slug: string; version: number; steps: unknown; checksum: string }>(
        `SELECT DISTINCT ON (runbook_slug) runbook_slug, version, steps, checksum FROM runbook_definition_versions ORDER BY runbook_slug, version DESC`,
      )
    : [];
  const rdvBySlug = new Map(rdv.map((r) => [r.runbook_slug, r]));
  for (const r of runbooks) {
    const d = rdvBySlug.get(r.slug);
    const body = [r.body_markdown, d ? JSON.stringify(d.steps) : ""].join("\n");
    out.push(mk("runbook", r.slug, d ? String(d.version) : "0", body, "active"));
  }

  const policies = await run<{ key: string; version: number; config: unknown; state: string }>(`SELECT key, version, config, state FROM policies WHERE state = 'active'`);
  for (const p of policies) out.push(mk("policy", p.key, String(p.version), JSON.stringify(p.config), p.state));

  if (await tableExists(run, "agent_instruction_versions")) {
    const cols = await columns(run, "agent_instruction_versions");
    const keyCol = ["key", "block_key", "slug", "name"].find((c) => cols.has(c));
    const verCol = ["version", "version_no"].find((c) => cols.has(c));
    const bodyCol = ["body", "body_markdown", "content", "text"].find((c) => cols.has(c));
    const statusCol = ["status", "state", "review_status"].find((c) => cols.has(c));
    if (keyCol && verCol && bodyCol) {
      const rows = await run<{ k: string; v: string; b: string; s: string | null }>(
        `SELECT ${keyCol}::text AS k, ${verCol}::text AS v, ${bodyCol}::text AS b, ${statusCol ? `${statusCol}::text` : "NULL"} AS s FROM agent_instruction_versions`,
      );
      for (const r of rows) out.push(mk("instruction_block", r.k, r.v, r.b, r.s ?? "unknown"));
    }
  }
  return out;
}

/** Record the current versions (idempotent on (kind, key, version, checksum)). */
export async function snapshotProcedures(run: Run, opts: { knownTools?: readonly string[]; knownFields?: readonly string[]; retiredFields?: readonly string[] } = {}): Promise<{ snapshot_id: string; recorded: number; unchanged: number; procedures: ProcedureVersion[] }> {
  const procedures = await loadProcedures(run, opts);
  const [{ id: snapshot_id }] = await run<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
  let recorded = 0;
  for (const p of procedures) {
    const rows = await run(
      `INSERT INTO procedure_versions (kind, key, version, checksum, tool_refs, field_refs, status, snapshot_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (kind, key, version, checksum) DO NOTHING RETURNING id`,
      [p.kind, p.key, p.version, p.checksum, p.tool_refs, p.field_refs, p.status, snapshot_id],
    );
    recorded += rows.length;
  }
  return { snapshot_id, recorded, unchanged: procedures.length - recorded, procedures };
}

// ── Checks ──────────────────────────────────────────────────────────────────

export interface Finding {
  procedure_kind: ProcedureKind | "memory";
  procedure_key: string;
  version: string;
  check_kind: CheckKind;
  detail: string;
  subject: string;
}

export interface CheckOptions {
  /** Registered MCP tool names (scripts/list-mcp-tools.mjs). Required for missing_tool checks. */
  knownTools: readonly string[];
  knownFields?: readonly string[];
  retiredFields?: readonly string[];
  rules?: readonly ContradictionRule[];
}

/** Compute findings without writing. */
export async function findProcedureIssues(run: Run, opts: CheckOptions): Promise<Finding[]> {
  const retired = opts.retiredFields ?? RETIRED_FIELDS;
  const procedures = await loadProcedures(run, { knownTools: opts.knownTools, knownFields: opts.knownFields, retiredFields: retired });
  const known = new Set(opts.knownTools);
  const activeKeys = new Set((await run<{ key: string }>(`SELECT key FROM policies WHERE state = 'active'`)).map((r) => r.key));
  const findings: Finding[] = [];
  for (const p of procedures) {
    if (p.kind === "policy") continue;
    if (known.size) {
      for (const t of p.tool_refs) {
        if (!known.has(t)) findings.push({ procedure_kind: p.kind, procedure_key: p.key, version: p.version, check_kind: "missing_tool", subject: t, detail: `${p.kind} "${p.key}" v${p.version} names tool "${t}", which the MCP server does not register.` });
      }
    }
    for (const f of p.field_refs) {
      if (retired.includes(f)) findings.push({ procedure_kind: p.kind, procedure_key: p.key, version: p.version, check_kind: "retired_field", subject: f, detail: `${p.kind} "${p.key}" v${p.version} refers to retired field "${f}".` });
    }
    const approved = p.kind === "runbook" || p.kind === "instruction_block" || /approved/.test(p.status);
    if (approved) {
      for (const r of findContradictions(p.body, activeKeys, opts.rules)) {
        findings.push({ procedure_kind: p.kind, procedure_key: p.key, version: p.version, check_kind: "contradiction", subject: r.id, detail: `${p.kind} "${p.key}" v${p.version} ${r.message}` });
      }
    } else if (p.kind === "skill") {
      // A proposed skill that would change send/pay/price authority is a proposal, not authority.
      if (isUnapprovedAuthorityChange({ memory_type: "instruction", content: p.body, review_status: "pending" })) {
        findings.push({ procedure_kind: p.kind, procedure_key: p.key, version: p.version, check_kind: "unapproved_authority_change", subject: "skill", detail: `skill "${p.key}" v${p.version} is ${p.status} and would change what agents may send, pay or price — proposed rule, not authority until approved in /engine.` });
      }
    }
  }
  const memories = await run<MemoryLike & { id: string }>(
    `SELECT id::text AS id, memory_type, summary, content, lead_id::text AS lead_id, project_id::text AS project_id, review_status, can_use_as_instruction
       FROM agent_memories WHERE review_status = 'pending' AND memory_type IN ('instruction','preference')`,
  );
  for (const m of memories) {
    if (isUnapprovedAuthorityChange(m)) {
      findings.push({ procedure_kind: "memory", procedure_key: m.id, version: "", check_kind: "unapproved_authority_change", subject: classifyMemory(m), detail: `pending agent memory "${(m.summary ?? m.content).slice(0, 120)}" proposes a company rule about sending, paying or pricing — proposed rule, not authority; it stays can_use_as_instruction=false until Joe approves it.` });
    }
  }
  return findings;
}

/** Run the checks and persist: open a row per new finding, resolve rows whose
 *  finding no longer appears. Returns the open set. */
export async function checkProcedures(run: Run, opts: CheckOptions): Promise<{ findings: Finding[]; opened: number; resolved: number; open: ProcedureCheck[] }> {
  const findings = await findProcedureIssues(run, opts);
  const fps = findings.map((f) => `${f.procedure_kind}|${f.procedure_key}|${f.version}|${f.check_kind}|${f.subject}`);
  let opened = 0;
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const rows = await run(
      `INSERT INTO procedure_checks (procedure_kind, procedure_key, version, check_kind, detail, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (fingerprint) WHERE resolved_at IS NULL DO NOTHING RETURNING id`,
      [f.procedure_kind, f.procedure_key, f.version, f.check_kind, f.detail, fps[i]],
    );
    opened += rows.length;
  }
  const resolvedRows = await run(`UPDATE procedure_checks SET resolved_at = now() WHERE resolved_at IS NULL AND NOT (fingerprint = ANY($1::text[])) RETURNING id`, [fps]);
  const open = await listOpenChecks(run);
  return { findings, opened, resolved: resolvedRows.length, open };
}

export async function listOpenChecks(run: Run): Promise<ProcedureCheck[]> {
  return run<ProcedureCheck>(
    `SELECT id::text AS id, procedure_kind, procedure_key, version, check_kind, detail, fingerprint, detected_at::text AS detected_at, resolved_at::text AS resolved_at
       FROM procedure_checks WHERE resolved_at IS NULL ORDER BY check_kind, procedure_kind, procedure_key`,
  );
}

/** Pending memories, labelled. Read-only; for the review surface. */
export async function classifyPendingMemories(run: Run, limit = 100): Promise<(MemoryLike & { id: string; classification: ReturnType<typeof classifyMemory>; unapproved_authority_change: boolean })[]> {
  const rows = await run<MemoryLike & { id: string }>(
    `SELECT id::text AS id, memory_type, summary, content, lead_id::text AS lead_id, project_id::text AS project_id, review_status, can_use_as_instruction
       FROM agent_memories WHERE review_status = 'pending' ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((m) => ({ ...m, classification: classifyMemory(m), unapproved_authority_change: isUnapprovedAuthorityChange(m) }));
}
