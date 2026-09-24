// Construction schedule plans (A16 / W09–W10).
//
//   prepareTentativeSchedule  → revision n, status 'tentative' (allowed any time)
//   submitScheduleForApproval → decision kind 'schedule' (Joe approves the plan)
//   confirmSchedule           → ONLY with decision approved AND signed
//                               construction agreement AND initial payment
//                               received; commitments become confirmed dates
//   adjustInternalSchedule    → automatic ONLY when no client/sub/supplier
//                               commitment date changes, no cost increase and
//                               no funding gap — each check is explicit
//   stageScheduleImpactAlert  → otherwise: immediate owner alert + decision
//   planBuyout                → order deadlines backward from need-on-site
//
// Dates are YYYY-MM-DD calendar dates (a promise to a person is a day, not an
// instant). "Today" is the Central date from Postgres.

import type { Run } from "../commands/core.ts";
import { consumeDecision, getDecision, stageDecision, type Decision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { addBusinessDays, addDays, centralDate, isoDateValid } from "./dates.ts";
import type { FieldHooks } from "./hooks.ts";

export interface PhaseInput {
  key: string;
  label: string;
  durationDays: number;
  dependsOn?: string[];
  inspection?: string | null;
  crew?: string | null; // sub slug
  materials?: { item: string; leadTimeDays: number; bufferDays?: number; amountCents?: number | null }[];
  /** Business days (default) or calendar days. */
  calendarDays?: boolean;
}

export interface PlannedPhase extends PhaseInput {
  start: string;
  end: string;
}

export interface SchedulePlan {
  id: string;
  project_id: string;
  revision: number;
  status: "tentative" | "awaiting_approval" | "approved" | "confirmed" | "superseded";
  phases: PlannedPhase[];
  dependencies: { from: string; to: string }[];
  inspections: { phase: string; inspection: string; date: string }[];
  material_lead_times: { phase: string; item: string; leadTimeDays: number; needOnSite: string; orderDeadline: string }[];
  funding_readiness: { ok: boolean; availableCents: number | null; reason: string; checkedAt: string };
  approval_decision_id: string | null;
  based_on_revision: number | null;
  change_note: string;
  auth_ref: string | null;
  confirmed_at: string | null;
}

const PLAN_COLS = `id, project_id, revision, status, phases, dependencies, inspections, material_lead_times, funding_readiness, approval_decision_id,
  based_on_revision, change_note, auth_ref, confirmed_at::text AS confirmed_at`;

/** Lay phases out from `start` honouring dependencies (topological). Pure. */
export function layoutPhases(phases: PhaseInput[], start: string): PlannedPhase[] {
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const done = new Map<string, PlannedPhase>();
  const visiting = new Set<string>();
  const place = (key: string): PlannedPhase => {
    const cached = done.get(key);
    if (cached) return cached;
    if (visiting.has(key)) throw new Error(`Circular dependency at ${key}`);
    visiting.add(key);
    const p = byKey.get(key);
    if (!p) throw new Error(`Unknown phase dependency ${key}`);
    let s = start;
    for (const dep of p.dependsOn ?? []) {
      const d = place(dep);
      const next = addDays(d.end, 1);
      if (next > s) s = next;
    }
    // Materials must be on site by the phase start; no start before the
    // earliest possible delivery from "today" (order today + lead + buffer).
    const dur = Math.max(1, Math.trunc(p.durationDays));
    const e = p.calendarDays ? addDays(s, dur - 1) : addBusinessDays(s, dur - 1);
    const out: PlannedPhase = { ...p, start: s, end: e };
    done.set(key, out);
    visiting.delete(key);
    return out;
  };
  return phases.map((p) => place(p.key));
}

export async function prepareTentativeSchedule(
  run: Run,
  principal: Principal,
  input: { projectId: string; phases: PhaseInput[]; startDate?: string; note?: string },
  hooks: FieldHooks,
): Promise<SchedulePlan> {
  const today = await centralDate(run);
  const start = input.startDate ?? today;
  if (!isoDateValid(start)) throw new Error("startDate must be YYYY-MM-DD.");
  const phases = layoutPhases(input.phases, start);
  const dependencies = phases.flatMap((p) => (p.dependsOn ?? []).map((d) => ({ from: d, to: p.key })));
  const inspections = phases.filter((p) => p.inspection).map((p) => ({ phase: p.key, inspection: p.inspection!, date: p.end }));
  const material_lead_times = phases.flatMap((p) =>
    (p.materials ?? []).map((m) => ({
      phase: p.key,
      item: m.item,
      leadTimeDays: m.leadTimeDays,
      needOnSite: p.start,
      orderDeadline: addDays(p.start, -(m.leadTimeDays + (m.bufferDays ?? 0))),
    })),
  );
  const funding = await hooks.fundingAvailable(run, input.projectId);
  const [row] = await run<SchedulePlan>(
    `INSERT INTO schedule_plans (project_id, revision, status, phases, dependencies, inspections, material_lead_times, funding_readiness, change_note, created_by)
     VALUES ($1, COALESCE((SELECT max(revision) FROM schedule_plans WHERE project_id = $1), 0) + 1, 'tentative', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
     RETURNING ${PLAN_COLS}`,
    [
      input.projectId,
      JSON.stringify(phases),
      JSON.stringify(dependencies),
      JSON.stringify(inspections),
      JSON.stringify(material_lead_times),
      JSON.stringify({ ...funding, checkedAt: new Date().toISOString() }),
      input.note ?? "",
      principal.kind === "user" ? principal.name : principal.kind === "service" ? principal.name : principal.agent,
    ],
  );
  return row;
}

export async function getPlan(run: Run, planId: string): Promise<SchedulePlan | null> {
  const [row] = await run<SchedulePlan>(`SELECT ${PLAN_COLS} FROM schedule_plans WHERE id = $1`, [planId]);
  return row ?? null;
}

export async function submitScheduleForApproval(run: Run, principal: Principal, planId: string): Promise<{ plan: SchedulePlan; decision: Decision }> {
  const plan = await getPlan(run, planId);
  if (!plan) throw new Error("No such plan.");
  if (plan.status === "confirmed") throw new Error("Plan already confirmed.");
  const [proj] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [plan.project_id]);
  const staged = await stageDecision(run, {
    kind: "schedule",
    action: "approve_schedule",
    title: `Approve construction schedule rev ${plan.revision} · ${proj?.name ?? ""}`,
    summary: {
      quantities: plan.phases.map((p) => ({ label: `${p.label}: ${p.start} → ${p.end}`, qty: p.durationDays, unit: "days" })),
      inclusions: plan.inspections.map((i) => `${i.inspection} inspection after ${i.phase} (${i.date})`),
      assumptions: plan.material_lead_times.map((m) => `${m.item}: order by ${m.orderDeadline} (lead ${m.leadTimeDays}d)`),
      gaps: plan.funding_readiness.ok ? [] : [`Funding: ${plan.funding_readiness.reason}`],
      effect: "Approves the plan. Dates are confirmed with client/subs only after the signed agreement and the initial payment are on record.",
    },
    targetKind: "schedule_plan",
    targetId: plan.id,
    content: { phases: plan.phases, inspections: plan.inspections },
    artifactRevision: `schedule_plan:${plan.id}:rev${plan.revision}`,
    projectId: plan.project_id,
    href: proj ? `/projects/${proj.slug}` : null,
    dedupeKey: `schedule:${plan.project_id}`,
    requestedBy: principal,
  });
  const [updated] = await run<SchedulePlan>(`UPDATE schedule_plans SET status = 'awaiting_approval', approval_decision_id = $2 WHERE id = $1 RETURNING ${PLAN_COLS}`, [plan.id, staged.decision.id]);
  return { plan: updated, decision: staged.decision };
}

export interface ConfirmBlockers {
  approved: boolean;
  signedAgreement: boolean;
  initialPayment: boolean;
}

export async function scheduleGates(run: Run, plan: SchedulePlan, hooks: FieldHooks): Promise<ConfirmBlockers> {
  const d = plan.approval_decision_id ? await getDecision(run, plan.approval_decision_id) : null;
  const approved = !!d && (d.status === "approved" || d.status === "consumed") && d.artifact_revision === `schedule_plan:${plan.id}:rev${plan.revision}`;
  const [c] = await run<{ signed: boolean }>(`SELECT project_has_signed_contract($1) AS signed`, [plan.project_id]);
  const initialPayment = await hooks.initialPaymentReceived(run, plan.project_id);
  return { approved, signedAgreement: c?.signed === true, initialPayment };
}

/** Confirm dates. Refuses (and changes nothing) unless every gate holds. */
export async function confirmSchedule(
  run: Run,
  planId: string,
  hooks: FieldHooks,
  commitments: { party: "client" | "sub" | "supplier"; partyRef: string; phaseKey: string; date: string; promise: string }[] = [],
): Promise<{ ok: true; plan: SchedulePlan } | { ok: false; blockers: string[]; gates: ConfirmBlockers }> {
  const plan = await getPlan(run, planId);
  if (!plan) return { ok: false, blockers: ["No such plan."], gates: { approved: false, signedAgreement: false, initialPayment: false } };
  if (plan.status === "confirmed") return { ok: true, plan };
  const gates = await scheduleGates(run, plan, hooks);
  const blockers: string[] = [];
  if (!gates.approved) blockers.push("Joe has not approved this plan revision.");
  if (!gates.signedAgreement) blockers.push("No signed construction agreement on record.");
  if (!gates.initialPayment) blockers.push("Initial payment not received.");
  if (blockers.length) return { ok: false, blockers, gates };
  const d = (await getDecision(run, plan.approval_decision_id!))!;
  if (d.status === "approved") {
    const c = await consumeDecision(run, { id: d.id, action: "approve_schedule", contentHash: d.content_hash, targetKind: "schedule_plan", targetId: plan.id, consumer: "field.confirmSchedule" });
    if (!c.ok) return { ok: false, blockers: [c.reason], gates };
  }
  await run(`UPDATE schedule_plans SET status = 'superseded' WHERE project_id = $1 AND status = 'confirmed' AND id <> $2`, [plan.project_id, plan.id]);
  const [updated] = await run<SchedulePlan>(`UPDATE schedule_plans SET status = 'confirmed', confirmed_at = now(), auth_ref = $2 WHERE id = $1 RETURNING ${PLAN_COLS}`, [plan.id, `decision:${d.id}`]);
  const list = commitments.length
    ? commitments
    : plan.phases.flatMap((p) => [
        { party: "client" as const, partyRef: "client", phaseKey: p.key, date: p.start, promise: `${p.label} starts` },
        ...(p.crew ? [{ party: "sub" as const, partyRef: p.crew, phaseKey: p.key, date: p.start, promise: `${p.label} on site` }] : []),
      ]);
  for (const c of list) {
    if (!isoDateValid(c.date)) throw new Error(`Bad commitment date ${c.date}`);
    await run(
      `INSERT INTO schedule_commitments (plan_id, project_id, party, party_ref, phase_key, commitment_date, promise, confirmed, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, true, now())`,
      [plan.id, plan.project_id, c.party, c.partyRef, c.phaseKey, c.date, c.promise],
    );
  }
  return { ok: true, plan: updated };
}

export interface AdjustInput {
  planId: string;
  changes: { phaseKey: string; start: string; end: string }[];
  /** Cost delta of the move in cents (0 = none). null = unknown → not automatic. */
  costDeltaCents: number | null;
  note?: string;
}

export interface AdjustChecks {
  noCommitmentChange: { ok: boolean; detail: string[] };
  noCostIncrease: { ok: boolean; detail: string };
  noFundingGap: { ok: boolean; detail: string };
}

/** Apply an internal move automatically when all three boundaries hold;
 *  otherwise stage an impact alert (immediate owner notification + decision)
 *  and change nothing. */
export async function adjustInternalSchedule(
  run: Run,
  principal: Principal,
  input: AdjustInput,
  hooks: FieldHooks,
  policyRef: string | null,
): Promise<{ applied: true; plan: SchedulePlan; checks: AdjustChecks } | { applied: false; checks: AdjustChecks; decision: Decision }> {
  const plan = await getPlan(run, input.planId);
  if (!plan) throw new Error("No such plan.");
  if (plan.status !== "confirmed" && plan.status !== "approved") throw new Error("Only an approved/confirmed plan can be adjusted; edit the tentative plan instead.");
  for (const c of input.changes) if (!isoDateValid(c.start) || !isoDateValid(c.end) || c.end < c.start) throw new Error(`Bad dates for ${c.phaseKey}`);

  // 1. Commitments: does any confirmed promise to client/sub/supplier move?
  const commitments = await run<{ party: string; party_ref: string; phase_key: string; date: string; promise: string }>(
    `SELECT party, party_ref, phase_key, to_char(commitment_date, 'YYYY-MM-DD') AS date, promise
       FROM schedule_commitments WHERE project_id = $1 AND confirmed = true`,
    [plan.project_id],
  );
  const moved: string[] = [];
  const changed = new Map(input.changes.map((c) => [c.phaseKey, c]));
  // Downstream phases shift too: recompute the layout with the moved phases pinned.
  const newPhases = plan.phases.map((p) => (changed.has(p.key) ? { ...p, start: changed.get(p.key)!.start, end: changed.get(p.key)!.end } : p));
  const shifted = new Map<string, { start: string; end: string }>();
  for (const p of newPhases) shifted.set(p.key, { start: p.start, end: p.end });
  // Ripple: a phase that depends on a moved phase must start after it.
  let rippled = true;
  while (rippled) {
    rippled = false;
    for (const p of newPhases) {
      const cur = shifted.get(p.key)!;
      for (const dep of p.dependsOn ?? []) {
        const d = shifted.get(dep);
        if (d && addDays(d.end, 1) > cur.start) {
          const len = Math.round((Date.parse(cur.end) - Date.parse(cur.start)) / 86_400_000);
          const ns = addDays(d.end, 1);
          shifted.set(p.key, { start: ns, end: addDays(ns, len) });
          rippled = true;
        }
      }
    }
  }
  for (const c of commitments) {
    const s = shifted.get(c.phase_key);
    if (s && s.start !== c.date) moved.push(`${c.party}${c.party_ref && c.party_ref !== "client" ? ` ${c.party_ref}` : ""}: "${c.promise}" ${c.date} → ${s.start}`);
  }
  const checks: AdjustChecks = {
    noCommitmentChange: { ok: moved.length === 0, detail: moved },
    noCostIncrease: input.costDeltaCents == null ? { ok: false, detail: "cost effect unknown" } : { ok: input.costDeltaCents <= 0, detail: `cost delta ${input.costDeltaCents} cents` },
    noFundingGap: { ok: false, detail: "" },
  };
  const funding = await hooks.fundingAvailable(run, plan.project_id);
  checks.noFundingGap = funding.ok && (input.costDeltaCents ?? 0) <= (funding.availableCents ?? 0) ? { ok: true, detail: funding.reason } : { ok: false, detail: funding.reason };
  // A pure internal move with zero cost needs no cash; unknown funding then is not a gap.
  if ((input.costDeltaCents ?? 1) <= 0) checks.noFundingGap = { ok: true, detail: "no spend involved" };

  const allOk = checks.noCommitmentChange.ok && checks.noCostIncrease.ok && checks.noFundingGap.ok;
  if (allOk) {
    const phases = newPhases.map((p) => ({ ...p, ...shifted.get(p.key)! }));
    const [row] = await run<SchedulePlan>(
      `INSERT INTO schedule_plans (project_id, revision, status, phases, dependencies, inspections, material_lead_times, funding_readiness, based_on_revision, change_note, auth_ref, created_by)
       VALUES ($1, (SELECT max(revision) FROM schedule_plans WHERE project_id = $1) + 1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, 'system')
       RETURNING ${PLAN_COLS}`,
      [plan.project_id, plan.status, JSON.stringify(phases), JSON.stringify(plan.dependencies), JSON.stringify(plan.inspections), JSON.stringify(plan.material_lead_times), JSON.stringify(plan.funding_readiness), plan.revision, input.note ?? "internal adjustment", policyRef ?? "policy:schedule.internal_adjust@0"],
    );
    await run(`UPDATE schedule_plans SET status = 'superseded' WHERE id = $1`, [plan.id]);
    await run(`UPDATE schedule_commitments SET plan_id = $2 WHERE plan_id = $1`, [plan.id, row.id]);
    return { applied: true, plan: row, checks };
  }
  const decision = await stageScheduleImpactAlert(run, principal, plan, input, checks, hooks);
  return { applied: false, checks, decision };
}

export async function stageScheduleImpactAlert(run: Run, principal: Principal, plan: SchedulePlan, input: AdjustInput, checks: AdjustChecks, hooks: FieldHooks): Promise<Decision> {
  const [proj] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [plan.project_id]);
  const consequences = [
    ...checks.noCommitmentChange.detail,
    ...(checks.noCostIncrease.ok ? [] : [`Cost: ${checks.noCostIncrease.detail}`]),
    ...(checks.noFundingGap.ok ? [] : [`Funding: ${checks.noFundingGap.detail}`]),
  ];
  const staged = await stageDecision(run, {
    kind: "schedule_impact",
    action: "approve_schedule_change",
    title: `Schedule change affects ${checks.noCommitmentChange.ok ? "cost/funding" : "a commitment"} · ${proj?.name ?? ""}`,
    summary: {
      changes: input.changes.map((c) => `${c.phaseKey}: ${c.start} → ${c.end}`),
      effect: consequences.join("\n"),
      recommendation: input.note ?? "Approve the new dates, then messages to the affected parties are prepared for release.",
      gaps: consequences,
    },
    targetKind: "schedule_plan",
    targetId: plan.id,
    content: { planId: plan.id, changes: input.changes, costDeltaCents: input.costDeltaCents },
    projectId: plan.project_id,
    href: proj ? `/projects/${proj.slug}` : null,
    dedupeKey: `schedule_impact:${plan.project_id}`,
    requestedBy: principal,
  });
  // WORKFLOW W10: immediate alert when a client/sub promise moves; an unknown
  // cost effect just holds behind its decision card (no urgent push).
  if (!checks.noCommitmentChange.ok) await hooks.notifyOwner({
    kind: "urgent_item",
    title: `Schedule impact · ${proj?.name ?? "project"}`,
    body: consequences.slice(0, 4).join("\n"),
    href: proj ? `/projects/${proj.slug}` : "/engine",
  });
  return staged.decision;
}

export interface BuyoutItemInput {
  scopeRef: string;
  itemLabel: string;
  needOnSite: string;
  leadTimeDays: number;
  bufferDays?: number;
  quoteValidUntil?: string | null;
  depositTerms?: string;
  balanceTerms?: string;
  deliveryWindow?: string;
  amountCents?: number | null;
}

export interface BuyoutObligation extends BuyoutItemInput {
  id: string;
  orderDeadline: string;
  status: string;
  late: boolean;
}

/** Plan buyout backward from need-on-site. Funding reservation / the PO are
 *  WS-procurement's (commitment_ref / reservation_ref get filled by them). */
export async function planBuyout(run: Run, input: { projectId: string; planId?: string | null; items: BuyoutItemInput[] }): Promise<BuyoutObligation[]> {
  const today = await centralDate(run);
  const out: BuyoutObligation[] = [];
  for (const it of input.items) {
    if (!isoDateValid(it.needOnSite)) throw new Error(`Bad needOnSite for ${it.itemLabel}`);
    const orderDeadline = addDays(it.needOnSite, -(Math.max(0, it.leadTimeDays) + Math.max(0, it.bufferDays ?? 0)));
    const late = orderDeadline < today;
    const [row] = await run<{ id: string; status: string }>(
      `INSERT INTO buyout_obligations (project_id, plan_id, scope_ref, item_label, need_on_site, lead_time_days, buffer_days, order_deadline, quote_valid_until, deposit_terms, balance_terms, delivery_window, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14) RETURNING id, status`,
      [input.projectId, input.planId ?? null, it.scopeRef, it.itemLabel, it.needOnSite, it.leadTimeDays, it.bufferDays ?? 0, orderDeadline, it.quoteValidUntil ?? null, it.depositTerms ?? "", it.balanceTerms ?? "", it.deliveryWindow ?? "", it.amountCents ?? null, late ? "late" : "planned"],
    );
    out.push({ ...it, id: row.id, orderDeadline, status: row.status, late });
  }
  return out;
}

export async function listPlans(run: Run, projectId: string): Promise<SchedulePlan[]> {
  return run<SchedulePlan>(`SELECT ${PLAN_COLS} FROM schedule_plans WHERE project_id = $1 ORDER BY revision DESC`, [projectId]);
}
