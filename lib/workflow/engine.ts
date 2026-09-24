// A23 — the confirmed lead-to-closeout workflow join (WORKFLOW.md W01–W12).
//
// This module owns NO business logic of its own: it joins the feature
// commands the other workstreams built (estimating scope/design/estimate,
// billing acceptance/initial invoice, field schedule/milestones, closeout
// sign-off) into one project workflow with one history, and it is the place
// every trigger lands:
//
//   onSignatureSigned(run, id)   verified signed pre-construction agreement
//                                → W02 preparation NOW (scope register, site-
//                                visit plan, design decisions, working formal
//                                estimate structure) without a payment gate;
//                                accepted formal estimate → W08 (billing
//                                already issued the initial invoice); signed
//                                construction agreement → W09 gate; written
//                                completion sign-off → W12.
//   recordWorkflowEvent(...)     one history row per (project, kind, ref) —
//                                a repeated event resumes, never duplicates.
//   projectWorkflowView(run,id)  derived stage, gates, blockers, pending
//                                decisions and ready next actions — computed
//                                from the records, never from prose.
//
// Pure `run(sql, params)` style (no server-only import): node --test drives it
// against the disposable harness; lib/workflow/server.ts binds it to the pool.

import type { Run } from "../commands/core.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { decideDesignPath, inferDirection } from "../estimating/rules.ts";
import { loadLeadFacts, prepareScopeRegisterFromLead } from "../estimating/scope.ts";
import { setDesignPath } from "../estimating/design.ts";
import { ensureScopeLines, recomputeDraftEstimate } from "../estimating/assembly.ts";
import { enqueueAgentTrigger } from "../agent-runtime/triggers.ts";

export const WORKFLOW_DEFINITION_VERSION = "workflow@2026-09-23";
export type Stage = "W01" | "W02" | "W03" | "W04" | "W05" | "W06" | "W07" | "W08" | "W09" | "W10" | "W11" | "W12" | "done";
export const STAGE_TITLE: Record<Stage, string> = {
  W01: "Lead qualification and rough estimate",
  W02: "Signature starts preparation",
  W03: "Scope allocation and the site visit",
  W04: "Design direction, selections and feedback",
  W05: "Price discovery and supplier knowledge",
  W06: "Review and release of scope/bid packages",
  W07: "Continuous formal-estimate assembly and client pricing",
  W08: "Acceptance, agreement and initial invoice",
  W09: "Schedule, material buyout and project cash",
  W10: "Field progress, reports and schedule changes",
  W11: "Snags, owner decisions and change orders",
  W12: "Closeout, post-project and learning",
  done: "Closed",
};

export interface ProjectWorkflowRow {
  project_id: string;
  definition_version: string;
  policy_versions: Record<string, unknown>;
  stage: Stage;
  precon_signature_request_id: number | null;
  precon_signed_at: string | null;
  scope_prepared_at: string | null;
  accepted_estimate_id: number | null;
  accepted_at: string | null;
  contract_signed_at: string | null;
  initial_paid_at: string | null;
  schedule_confirmed_at: string | null;
  client_signoff_at: string | null;
  blocked: Array<{ code: string; detail: string }>;
  started_by: string;
}

const WF_COLS = `project_id, definition_version, policy_versions, stage, precon_signature_request_id::int AS precon_signature_request_id,
  precon_signed_at::text AS precon_signed_at, scope_prepared_at::text AS scope_prepared_at, accepted_estimate_id::int AS accepted_estimate_id,
  accepted_at::text AS accepted_at, contract_signed_at::text AS contract_signed_at, initial_paid_at::text AS initial_paid_at,
  schedule_confirmed_at::text AS schedule_confirmed_at, client_signoff_at::text AS client_signoff_at, blocked, started_by`;

/** Active policy versions pinned onto the workflow when it starts. */
async function activePolicyVersions(run: Run): Promise<Record<string, number>> {
  const rows = await run<{ key: string; version: number }>(`SELECT key, version FROM policies WHERE state = 'active'`);
  return Object.fromEntries(rows.map((r) => [r.key, r.version]));
}

export async function ensureProjectWorkflow(run: Run, projectId: string, startedBy = "system"): Promise<ProjectWorkflowRow> {
  const [row] = await run<ProjectWorkflowRow>(
    `INSERT INTO project_workflows (project_id, definition_version, policy_versions, started_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (project_id) DO UPDATE SET project_id = EXCLUDED.project_id
     RETURNING ${WF_COLS}`,
    [projectId, WORKFLOW_DEFINITION_VERSION, JSON.stringify(await activePolicyVersions(run)), startedBy],
  );
  return row;
}

export async function getProjectWorkflow(run: Run, projectId: string): Promise<ProjectWorkflowRow | null> {
  const [row] = await run<ProjectWorkflowRow>(`SELECT ${WF_COLS} FROM project_workflows WHERE project_id = $1`, [projectId]);
  return row ?? null;
}

/** Append one history row. Returns created=false when the exact event was
 *  already recorded (a replayed webhook, a second processor). */
export async function recordWorkflowEvent(
  run: Run,
  input: { projectId: string; kind: string; ref: string; detail?: Record<string, unknown>; actor?: string; stageAfter?: Stage | null },
): Promise<{ created: boolean; id: number | null }> {
  const wf = await ensureProjectWorkflow(run, input.projectId);
  const [row] = await run<{ id: number }>(
    `INSERT INTO project_workflow_events (project_id, kind, ref, stage_before, stage_after, detail, actor)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (project_id, kind, ref) DO NOTHING RETURNING id::int AS id`,
    [input.projectId, input.kind, input.ref, wf.stage, input.stageAfter ?? wf.stage, JSON.stringify(input.detail ?? {}), input.actor ?? "system"],
  );
  if (row && input.stageAfter && input.stageAfter !== wf.stage) {
    await run(`UPDATE project_workflows SET stage = $2 WHERE project_id = $1`, [input.projectId, input.stageAfter]);
  }
  return { created: Boolean(row), id: row?.id ?? null };
}

// ── Signature classification ───────────────────────────────────────────────

export type SignedDocKind = "precon" | "estimate" | "contract" | "change_order" | "completion" | "other";

interface SigRow {
  id: number;
  project_id: string | null;
  lead_slug: string | null;
  lead_id: string | null;
  doc_type: string;
  title: string;
  status: string;
  signed_at: string | null;
  signed_name: string | null;
  estimate_id: number | null;
  template_key: string | null;
}

async function loadSignature(run: Run, id: number): Promise<SigRow | null> {
  const [row] = await run<SigRow>(
    `SELECT s.id::int AS id, s.project_id, s.lead_slug, l.id AS lead_id, s.doc_type, s.title, s.status, s.signed_at::text AS signed_at,
            s.signed_name, s.estimate_id::int AS estimate_id,
            (SELECT d.template_key FROM document_drafts d WHERE d.signature_request_id = s.id LIMIT 1) AS template_key
       FROM signature_requests s LEFT JOIN leads l ON l.slug = s.lead_slug WHERE s.id = $1`,
    [id],
  );
  return row ?? null;
}

/** What a signed request is, from its records (doc_type, the template it was
 *  generated from, and — only as a last resort — its title). */
export function classifySignedDoc(sig: Pick<SigRow, "doc_type" | "template_key" | "title">): SignedDocKind {
  const t = (sig.template_key ?? "").toLowerCase();
  const title = (sig.title ?? "").toLowerCase();
  if (sig.doc_type === "precon" || /precon|pre-con|pre_con|preconstruction/.test(t) || /pre-?construction agreement/.test(title)) return "precon";
  if (sig.doc_type === "estimate") return "estimate";
  if (sig.doc_type === "contract" || /^contract/.test(t)) return "contract";
  if (sig.doc_type === "change_order") return "change_order";
  if (sig.doc_type === "completion") return "completion";
  return "other";
}

// ── W02: signature starts preparation ─────────────────────────────────────

export interface PreparationResult {
  projectId: string;
  projectCreated: boolean;
  scope: { register_id: string; created: boolean; items_created: number; plan_id: string; plan_created: boolean };
  design: { scope_key: string; path: string; created: boolean }[];
  estimate: { id: number; created: boolean; lines_created: number; unknown_cost_lines: number };
  event_created: boolean;
  trigger_created: boolean;
}

/** Minimal, pure lead → project conversion for a signature-triggered start
 *  (mirrors lib/actions/leads.ts convertLeadToProject's essential rows; the
 *  owner's UI conversion remains the full path when a person does it). */
async function projectForLead(run: Run, leadId: string, actor: string): Promise<{ id: string; created: boolean }> {
  const [existing] = await run<{ id: string }>(`SELECT id FROM projects WHERE lead_id = $1 ORDER BY created_at LIMIT 1`, [leadId]);
  if (existing) return { id: existing.id, created: false };
  const [lead] = await run<{ slug: string; name: string; scope: string; scope_city: string | null; value_display: string | null; address: string | null }>(
    `SELECT slug, name, scope, scope_city, value_display, address FROM leads WHERE id = $1`,
    [leadId],
  );
  if (!lead) throw new Error("lead not found");
  const base = `${lead.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `job-${leadId.slice(0, 8)}`;
  let slug = base;
  for (let i = 2; ; i++) {
    const [hit] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE slug = $1`, [slug]);
    if (!hit?.n) break;
    slug = `${base}-${i}`;
  }
  const [p] = await run<{ id: string }>(
    `INSERT INTO projects (slug, name, status, client_name, address, value_display, lead_id)
     VALUES ($1, $2, 'precon_signed', $3, $4, $5, $6) RETURNING id`,
    [slug, `${lead.name} — ${lead.scope.split(/[.,\n]/)[0].trim().slice(0, 50) || "project"}`.slice(0, 80), lead.name, lead.address ?? lead.scope_city ?? null, lead.value_display, leadId],
  );
  await run(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'note', $2, $3)`, [leadId, "Project started automatically from the signed pre-construction agreement", actor]);
  // Lead-stage files gain the project key (portal users are carried by the owner conversion path).
  await run(`UPDATE files SET project_key = $2 WHERE lead_slug = $1 AND (project_key IS NULL OR project_key = '')`, [lead.slug, slug]).catch?.(() => {});
  return { id: p.id, created: true };
}

/** Ensure the job's ONE formal estimate exists (kind = 'formal'; the
 *  Documents › Formal Estimate record) and its scope lines are materialised. */
async function ensureFormalEstimate(run: Run, projectId: string): Promise<{ id: number; created: boolean }> {
  const [e] = await run<{ id: number }>(`SELECT id::int AS id FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY created_at LIMIT 1`, [projectId]);
  if (e) return { id: e.id, created: false };
  const [n] = await run<{ id: number }>(`INSERT INTO estimates (project_id, title, kind, rail, status) VALUES ($1, 'Formal estimate', 'formal', 'plans', 'draft') RETURNING id::int AS id`, [projectId]);
  return { id: n.id, created: true };
}

/** W02: run (or resume) preparation for a verified signed pre-construction
 *  agreement. Payment is NOT a gate. Idempotent: every piece keys on the
 *  project, so a duplicate signature event resumes the same work. */
export async function prepareFromSignedPrecon(run: Run, signatureRequestId: number, principal: Principal): Promise<PreparationResult | { ok: false; reason: string }> {
  const sig = await loadSignature(run, signatureRequestId);
  if (!sig) return { ok: false, reason: "no such signature request" };
  if (sig.status !== "signed" || !sig.signed_at) return { ok: false, reason: `signature request is ${sig.status}; only a verified SIGNED agreement starts preparation` };
  if (classifySignedDoc(sig) !== "precon") return { ok: false, reason: `not a pre-construction agreement (${sig.doc_type})` };
  const actor = principalLabel(principal);

  let projectId = sig.project_id;
  let projectCreated = false;
  if (!projectId) {
    if (!sig.lead_id) return { ok: false, reason: "signature is attached to neither a project nor a lead" };
    const p = await projectForLead(run, sig.lead_id, actor);
    projectId = p.id;
    projectCreated = p.created;
    await run(`UPDATE signature_requests SET project_id = $2 WHERE id = $1 AND project_id IS NULL`, [sig.id, projectId]);
  }
  await ensureProjectWorkflow(run, projectId, actor);
  await run(
    `UPDATE project_workflows SET precon_signature_request_id = COALESCE(precon_signature_request_id, $2), precon_signed_at = COALESCE(precon_signed_at, $3::timestamptz)
      WHERE project_id = $1`,
    [projectId, sig.id, sig.signed_at],
  );
  const ev = await recordWorkflowEvent(run, {
    projectId,
    kind: "precon_signed",
    ref: `signature_request:${sig.id}`,
    detail: { signed_at: sig.signed_at, signed_name: sig.signed_name, title: sig.title },
    actor,
    stageAfter: "W02",
  });

  // 1. Preliminary scope register + site-visit plan (from lead facts only;
  //    site-dependent items are marked unverified by the estimating rules).
  const facts = await loadLeadFacts(run, projectId);
  const scope = await prepareScopeRegisterFromLead(run, projectId, facts, { principal });

  // 2. Design brief per room/scope: exact products → straight to the
  //    estimate; defined direction → selections; unclear → mood board.
  const scopeRows = await run<{ key: string; room: string; required_finishes: Array<{ label: string; status: string }> | null }>(
    `SELECT key, room, required_finishes FROM scope_items WHERE project_id = $1 AND status NOT IN ('superseded','excluded') ORDER BY room, key`,
    [projectId],
  );
  const intakeText = (facts.intake ?? []).map((q) => `${q.question}: ${q.answer}`).join("\n").toLowerCase();
  const styleDefined = /\b(style|look|finish|colou?r|modern|traditional|shaker|farmhouse|contemporary|transitional)\b/.test(intakeText);
  const design: PreparationResult["design"] = [];
  for (const s of scopeRows) {
    const finishes = s.required_finishes ?? [];
    if (!finishes.length) continue; // nothing to decide for this scope
    const exact = finishes.filter((f) => f.status === "decided" || f.status === "exact").length;
    const direction = inferDirection({ exact_products: exact, stated_preferences: styleDefined ? 2 : 0, style_defined: styleDefined });
    const r = await setDesignPath(run, { project_id: projectId, scope_key: s.key, room: s.room, direction, principal });
    design.push({ scope_key: s.key, path: decideDesignPath(direction), created: r.changed });
  }

  // 3. Working formal-estimate structure: known costs, explicit gaps, never zero.
  const est = await ensureFormalEstimate(run, projectId);
  const lines = await ensureScopeLines(run, est.id);
  const rc = await recomputeDraftEstimate(run, est.id, { principal });

  await run(`UPDATE project_workflows SET scope_prepared_at = COALESCE(scope_prepared_at, now()) WHERE project_id = $1`, [projectId]);
  await recordWorkflowEvent(run, {
    projectId,
    kind: "scope_prepared",
    ref: `register:${scope.register_id}`,
    detail: { items_created: scope.items_created, plan_id: scope.plan_id, estimate_id: est.id, unknown_cost_lines: rc.unknown_cost_lines, design_paths: design },
    actor,
  });

  // 4. Wake the operating agent (A24): the agent enriches the register from
  //    the correspondence, drafts the site-visit questions and the design brief
  //    text, and stages the scope-allocation review for Joe. Idempotent on
  //    (kind, ref).
  const trig = await enqueueAgentTrigger(run, {
    kind: "signature",
    ref: `signature_request:${sig.id}:signed`,
    projectId,
    leadId: sig.lead_id,
    enqueuedBy: "workflow:precon",
    payload: { signature_request_id: sig.id, doc_type: "precon", title: sig.title, signed_at: sig.signed_at, stage: "W02", estimate_id: est.id, scope_register_id: scope.register_id },
  });

  return {
    projectId,
    projectCreated,
    scope: { register_id: scope.register_id, created: scope.created, items_created: scope.items_created, plan_id: scope.plan_id, plan_created: scope.plan_created },
    design,
    estimate: { id: est.id, created: est.created, lines_created: lines.created, unknown_cost_lines: rc.unknown_cost_lines },
    event_created: ev.created,
    trigger_created: trig.created,
  };
}

// ── The event entry point every signature completion calls ───────────────

export interface SignatureWorkflowOutcome {
  signatureRequestId: number;
  kind: SignedDocKind;
  projectId: string | null;
  preparation?: PreparationResult | { ok: false; reason: string };
  event?: { created: boolean };
}

/** Called after the binding signature write (lib/actions/esign.ts) and by the
 *  worker's signature processor. Billing has its own idempotent hook for the
 *  money effects (lib/billing); this records the workflow history and starts
 *  W02 for a pre-construction agreement. Safe to call repeatedly. */
export async function onSignatureSigned(run: Run, signatureRequestId: number, principal: Principal): Promise<SignatureWorkflowOutcome> {
  const sig = await loadSignature(run, signatureRequestId);
  if (!sig || sig.status !== "signed") return { signatureRequestId, kind: "other", projectId: sig?.project_id ?? null };
  const kind = classifySignedDoc(sig);
  const actor = principalLabel(principal);
  if (kind === "precon") {
    const preparation = await prepareFromSignedPrecon(run, signatureRequestId, principal);
    return { signatureRequestId, kind, projectId: "projectId" in preparation ? preparation.projectId : sig.project_id, preparation };
  }
  if (!sig.project_id) return { signatureRequestId, kind, projectId: null };
  if (kind === "estimate") {
    const [est] = await run<{ id: number; kind: string }>(`SELECT id::int AS id, kind FROM estimates WHERE id = $1`, [sig.estimate_id]);
    const formal = est?.kind === "formal";
    await ensureProjectWorkflow(run, sig.project_id, actor);
    if (formal) await run(`UPDATE project_workflows SET accepted_estimate_id = COALESCE(accepted_estimate_id, $2), accepted_at = COALESCE(accepted_at, $3::timestamptz) WHERE project_id = $1`, [sig.project_id, est.id, sig.signed_at]);
    const event = await recordWorkflowEvent(run, { projectId: sig.project_id, kind: formal ? "estimate_accepted" : "precon_change_accepted", ref: `signature_request:${sig.id}`, detail: { estimate_id: sig.estimate_id, signed_at: sig.signed_at }, actor, stageAfter: formal ? "W08" : null });
    await enqueueAgentTrigger(run, { kind: "signature", ref: `signature_request:${sig.id}:signed`, projectId: sig.project_id, leadId: sig.lead_id, enqueuedBy: "workflow:estimate", payload: { signature_request_id: sig.id, doc_type: "estimate", stage: "W08" } });
    return { signatureRequestId, kind, projectId: sig.project_id, event };
  }
  if (kind === "contract") {
    await ensureProjectWorkflow(run, sig.project_id, actor);
    await run(`UPDATE project_workflows SET contract_signed_at = COALESCE(contract_signed_at, $2::timestamptz) WHERE project_id = $1`, [sig.project_id, sig.signed_at]);
    const event = await recordWorkflowEvent(run, { projectId: sig.project_id, kind: "contract_signed", ref: `signature_request:${sig.id}`, detail: { signed_at: sig.signed_at }, actor, stageAfter: "W09" });
    await enqueueAgentTrigger(run, { kind: "signature", ref: `signature_request:${sig.id}:signed`, projectId: sig.project_id, leadId: sig.lead_id, enqueuedBy: "workflow:contract", payload: { signature_request_id: sig.id, doc_type: "contract", stage: "W09" } });
    return { signatureRequestId, kind, projectId: sig.project_id, event };
  }
  if (kind === "completion") {
    await ensureProjectWorkflow(run, sig.project_id, actor);
    await run(`UPDATE project_workflows SET client_signoff_at = COALESCE(client_signoff_at, $2::timestamptz) WHERE project_id = $1`, [sig.project_id, sig.signed_at]);
    const event = await recordWorkflowEvent(run, { projectId: sig.project_id, kind: "client_signoff", ref: `signature_request:${sig.id}`, detail: { signed_at: sig.signed_at }, actor, stageAfter: "W12" });
    await enqueueAgentTrigger(run, { kind: "signoff", ref: `signature_request:${sig.id}:signed`, projectId: sig.project_id, leadId: sig.lead_id, enqueuedBy: "workflow:signoff", payload: { signature_request_id: sig.id, stage: "W12" } });
    return { signatureRequestId, kind, projectId: sig.project_id, event };
  }
  if (kind === "change_order") {
    const event = await recordWorkflowEvent(run, { projectId: sig.project_id, kind: "change_order_signed", ref: `signature_request:${sig.id}`, detail: { signed_at: sig.signed_at }, actor });
    return { signatureRequestId, kind, projectId: sig.project_id, event };
  }
  return { signatureRequestId, kind, projectId: sig.project_id };
}

/** Other feature events land here as history + stage moves (called by the
 *  owning workstream's binding or the worker's processors). */
export async function noteWorkflowEvent(run: Run, input: { projectId: string; kind: "initial_paid" | "schedule_confirmed" | "milestone_confirmed" | "snag" | "package_released" | "estimate_offered" | "final_invoiced" | "post_project" | "site_notes"; ref: string; detail?: Record<string, unknown>; actor?: string }): Promise<{ created: boolean }> {
  const stageAfter: Partial<Record<typeof input.kind, Stage>> = { initial_paid: "W09", schedule_confirmed: "W10", milestone_confirmed: "W10", snag: "W11", final_invoiced: "W12", post_project: "done" };
  const r = await recordWorkflowEvent(run, { projectId: input.projectId, kind: input.kind, ref: input.ref, detail: input.detail, actor: input.actor, stageAfter: stageAfter[input.kind] ?? null });
  const stamp: Partial<Record<typeof input.kind, string>> = { initial_paid: "initial_paid_at", schedule_confirmed: "schedule_confirmed_at" };
  if (r.created && stamp[input.kind]) await run(`UPDATE project_workflows SET ${stamp[input.kind]} = COALESCE(${stamp[input.kind]}, now()) WHERE project_id = $1`, [input.projectId]);
  return { created: r.created };
}

// ── The view: gates, blockers, decisions, next actions from records ───────

export interface WorkflowGate {
  key: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface WorkflowView {
  project_id: string;
  stage: Stage;
  stage_title: string;
  definition_version: string;
  policy_versions: Record<string, unknown>;
  gates: WorkflowGate[];
  blockers: string[];
  pending_decisions: Array<{ id: string; kind: string; title: string; created_at: string }>;
  next_actions: string[];
  history: Array<{ kind: string; ref: string; stage_after: string | null; actor: string; created_at: string }>;
}

async function exists(run: Run, table: string): Promise<boolean> {
  const [r] = await run<{ present: string | null }>(`SELECT to_regclass($1)::text AS present`, [`public.${table}`]);
  return Boolean(r?.present);
}

export async function projectWorkflowView(run: Run, projectId: string): Promise<WorkflowView | null> {
  const wf = await getProjectWorkflow(run, projectId);
  const [proj] = await run<{ id: string; status: string; name: string }>(`SELECT id, status, name FROM projects WHERE id = $1`, [projectId]);
  if (!proj) return null;
  const row = wf ?? (await ensureProjectWorkflow(run, projectId));
  const gates: WorkflowGate[] = [];
  const blockers: string[] = [];
  const next: string[] = [];

  gates.push({ key: "precon_signed", label: "Pre-construction agreement signed", met: Boolean(row.precon_signed_at), detail: row.precon_signed_at ? `signed ${row.precon_signed_at.slice(0, 10)}` : "no verified signature on record" });
  gates.push({ key: "scope_prepared", label: "Scope register and site-visit plan prepared", met: Boolean(row.scope_prepared_at), detail: row.scope_prepared_at ? "prepared" : "not prepared" });

  if (await exists(run, "scope_items")) {
    const [sc] = await run<{ total: number; unassigned: number; joe: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE responsibility = 'unassigned')::int AS unassigned, count(*) FILTER (WHERE responsibility = 'joe')::int AS joe
         FROM scope_items WHERE project_id = $1 AND status NOT IN ('superseded','excluded')`,
      [projectId],
    );
    const allocated = sc.total > 0 && sc.unassigned === 0;
    gates.push({ key: "scope_allocated", label: "Joe's scope-allocation review done", met: allocated, detail: sc.total ? `${sc.total - sc.unassigned}/${sc.total} allocated (${sc.joe} retained by Joe)` : "no scope items" });
    if (sc.total > 0 && !allocated) next.push(`Scope allocation: ${sc.unassigned} item(s) still unassigned (Joe / sub / supplier) before any bid package is released.`);
  }
  if (await exists(run, "site_visit_plans")) {
    const [pl] = await run<{ open: number; total: number }>(
      `SELECT COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(items) i WHERE i->>'status' = 'open')), 0)::int AS open,
              COALESCE(sum(jsonb_array_length(items)), 0)::int AS total
         FROM site_visit_plans WHERE project_id = $1 AND status <> 'superseded'`,
      [projectId],
    );
    gates.push({ key: "site_visit", label: "Site visit findings recorded", met: pl.total > 0 && pl.open === 0, detail: pl.total ? `${pl.total - pl.open}/${pl.total} checklist items answered` : "no plan" });
  }
  const [est] = await run<{ id: number; status: string; offered_at: string | null; offer_stale: boolean | null; total: number }>(
    `SELECT id::int AS id, status, offered_at::text AS offered_at, offer_stale, total FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY created_at LIMIT 1`,
    [projectId],
  ).catch(() => [] as Array<{ id: number; status: string; offered_at: string | null; offer_stale: boolean | null; total: number }>);
  if (est) {
    if (await exists(run, "estimate_gaps")) {
      const [g] = await run<{ hard: number; soft: number }>(`SELECT count(*) FILTER (WHERE severity = 'hard')::int AS hard, count(*) FILTER (WHERE severity = 'soft')::int AS soft FROM estimate_gaps WHERE estimate_id = $1 AND status = 'open'`, [est.id]);
      gates.push({ key: "estimate_ready", label: "Formal estimate has no hard gaps", met: g.hard === 0, detail: `${g.hard} hard / ${g.soft} soft gaps open` });
      if (g.hard > 0) next.push(`Estimate: ${g.hard} hard gap(s) (unknown costs, missing quantities, competing quotes) before a fixed-price offer.`);
    }
    gates.push({ key: "offer_sent", label: "Owner-approved offer sent to the client", met: Boolean(est.offered_at), detail: est.offered_at ? `offered ${est.offered_at.slice(0, 10)}${est.offer_stale ? " (STALE — estimate changed since)" : ""}` : "not offered" });
    if (est.offer_stale) blockers.push("The sent offer no longer matches the estimate; a revised offer needs fresh approval before it can be sent.");
  }
  gates.push({ key: "accepted", label: "Client accepted the exact offer", met: Boolean(row.accepted_at), detail: row.accepted_at ? `accepted ${row.accepted_at.slice(0, 10)}` : "not accepted" });
  if (await exists(run, "invoice_payments")) {
    const [inv] = await run<{ initial_id: number | null; issued: number; settled: number }>(
      `SELECT i.id::int AS initial_id, i.amount::int AS issued,
              COALESCE((SELECT sum(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind = 'payment' AND p.status = 'settled'), 0)::int AS settled
         FROM invoices i WHERE i.project_id = $1 AND i.economic_key LIKE 'estimate:%:initial' AND i.status <> 'void' ORDER BY i.id LIMIT 1`,
      [projectId],
    ).catch(() => [] as Array<{ initial_id: number | null; issued: number; settled: number }>);
    const paid = Boolean(inv?.initial_id) && inv.settled >= inv.issued && inv.issued > 0;
    gates.push({ key: "initial_paid", label: "Initial payment received", met: paid || Boolean(row.initial_paid_at), detail: inv?.initial_id ? `invoice ${inv.initial_id}: ${inv.settled}/${inv.issued} cents settled` : "no initial invoice" });
  }
  gates.push({ key: "contract_signed", label: "Construction agreement signed", met: Boolean(row.contract_signed_at), detail: row.contract_signed_at ? `signed ${row.contract_signed_at.slice(0, 10)}` : "not signed" });
  if (await exists(run, "schedule_plans")) {
    const [sp] = await run<{ status: string | null }>(`SELECT status FROM schedule_plans WHERE project_id = $1 ORDER BY revision DESC LIMIT 1`, [projectId]);
    gates.push({ key: "schedule_confirmed", label: "Schedule approved by Joe and confirmed", met: sp?.status === "confirmed", detail: sp ? `latest plan: ${sp.status}` : "no schedule plan" });
    if (sp && sp.status !== "confirmed" && row.contract_signed_at && gates.find((g) => g.key === "initial_paid")?.met) next.push("Gates met for confirmation: submit the schedule for Joe's approval, then confirm dates.");
  }
  gates.push({ key: "client_signoff", label: "Written client sign-off", met: Boolean(row.client_signoff_at), detail: row.client_signoff_at ? `signed ${row.client_signoff_at.slice(0, 10)}` : "not signed" });

  const pending = await run<{ id: string; kind: string; title: string; created_at: string }>(
    `SELECT id, kind, title, created_at::text AS created_at FROM decisions WHERE project_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at`,
    [projectId],
  );
  for (const d of pending) next.push(`Decision waiting on Joe: ${d.title} (${d.kind}).`);
  const lanes = await run<{ lane: string; reason: string }>(`SELECT lane, reason FROM lane_pauses`);
  for (const l of lanes) blockers.push(`Lane "${l.lane}" is paused: ${l.reason}`);
  const history = await run<{ kind: string; ref: string; stage_after: string | null; actor: string; created_at: string }>(
    `SELECT kind, ref, stage_after, actor, created_at::text AS created_at FROM project_workflow_events WHERE project_id = $1 ORDER BY id DESC LIMIT 50`,
    [projectId],
  );
  if (!row.precon_signed_at && proj.status === "precon_signed") blockers.push("Project is marked pre-con signed but no verified signature is on record; preparation starts only from the signature event.");
  return {
    project_id: projectId,
    stage: row.stage,
    stage_title: STAGE_TITLE[row.stage],
    definition_version: row.definition_version,
    policy_versions: row.policy_versions,
    gates,
    blockers: [...blockers, ...row.blocked.map((b) => `${b.code}: ${b.detail}`)],
    pending_decisions: pending,
    next_actions: next,
    history,
  };
}
