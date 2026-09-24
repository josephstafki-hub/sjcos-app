// Automatic contract billing commands (A07b; WORKFLOW W08 / W10 / W12).
// Pure: takes a transaction runner (`tx`) like lib/commands/core.runCommand
// so tests drive it on the harness and lib/commands/db.ts binds it to the
// pool in the app. Every command:
//   • verifies the business evidence itself (never trusts the caller's word);
//   • cites an active policy (auth_ref) or a consumed decision / owner;
//   • issues through issueMilestoneInvoice (idempotent on economic_key);
//   • enqueues a `send_invoice` intent — WS-approvals' dispatcher delivers.
//
// Owner approval of an estimate ≠ client acceptance: only a SIGNED
// signature_request of doc_type 'estimate' linked to a kind='formal' estimate
// on a project is acceptance. Repeated signature events collapse on the
// command request key (the economic key), so nothing issues twice.

import type { Run } from "../commands/core.ts";
import { runCommand, CommandConflictError } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { isOwner } from "../commands/principal.ts";
import { activePolicy, policyRef, laneOpen } from "../commands/policies.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { stageDecision, consumeDecision, contentHashOf } from "../commands/decisions.ts";
import { parseDrawSchedule, defaultDrawSchedule, type DrawLine } from "../draw-schedule.ts";
import {
  issueMilestoneInvoice,
  drawEconomicKey,
  linkContractToInvoice,
  logInvoiceEvent,
  getInvoice,
  INVOICE_COLS,
  type InvoiceRow,
} from "./core.ts";

export type Tx = <T>(fn: (run: Run) => Promise<T>) => Promise<T>;

export const POLICY_INITIAL = "invoice.initial_on_acceptance";
export const POLICY_FINAL = "invoice.final_on_signoff";

export type IssueOutcome =
  | { issued: true; invoiceId: number; invoiceNumber: string; created: boolean; intentId: string | null; replayed: boolean }
  | { issued: false; reason: string; decisionId?: string | null; code: "not_acceptance" | "policy_inactive" | "changed" | "uncertain" | "nothing_due" | "unauthorized" | "not_signoff" | "no_milestone" };

interface SigRow {
  id: number;
  project_id: string | null;
  lead_slug: string | null;
  doc_type: string;
  status: string;
  estimate_id: number | null;
  change_order_id: number | null;
  sent_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
}

interface EstimateRow {
  id: number;
  project_id: string | null;
  kind: string;
  status: string;
  total: number;
  draw_schedule: unknown;
  sent_at: string | null;
  lines_changed_at: string | null;
}

async function loadSignature(run: Run, id: number): Promise<SigRow | null> {
  const [r] = await run<SigRow>(
    `SELECT id::int AS id, project_id, lead_slug, doc_type, status, estimate_id::int AS estimate_id, change_order_id::int AS change_order_id,
            sent_at::text AS sent_at, signed_at::text AS signed_at, signed_name
       FROM signature_requests WHERE id = $1`,
    [id],
  );
  return r ?? null;
}

async function loadEstimate(run: Run, id: number): Promise<EstimateRow | null> {
  const [r] = await run<EstimateRow>(
    `SELECT e.id::int AS id, e.project_id, e.kind, e.status, e.total, e.draw_schedule, e.sent_at::text AS sent_at,
            (SELECT max(l.created_at)::text FROM estimate_lines l WHERE l.estimate_id = e.id) AS lines_changed_at
       FROM estimates e WHERE e.id = $1`,
    [id],
  );
  return r ?? null;
}

async function drawScheduleFor(run: Run, est: EstimateRow): Promise<DrawLine[]> {
  const parsed = parseDrawSchedule(est.draw_schedule);
  if (parsed) return parsed;
  const [row] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'contract.deposit_pct'`);
  const pct = Number(row?.value);
  return defaultDrawSchedule(Number.isFinite(pct) && pct > 0 ? pct : 10);
}

function drawAmount(totalCents: number, percent: number): number {
  return Math.round((totalCents * percent) / 100);
}

/** Mark a draw line billed in the estimate's schedule (hint only; the
 *  economic key on the invoice is the guard). */
async function markDrawBilled(run: Run, estimateId: number, index: number): Promise<void> {
  const est = await loadEstimate(run, estimateId);
  if (!est) return;
  const lines = await drawScheduleFor(run, est);
  if (!lines[index]) return;
  lines[index].billed = true;
  await run(`UPDATE estimates SET draw_schedule = $2::jsonb WHERE id = $1`, [estimateId, JSON.stringify(lines)]);
}

async function enqueueSend(run: Run, invoice: InvoiceRow, opts: { principal: Principal; commandId: string; policyRef?: string | null; decisionId?: string | null }) {
  const lane = await laneOpen(run, "sends");
  const { intent } = await enqueueIntent(run, {
    operationKey: `invoice:${invoice.id}:send:rev${invoice.revision}`,
    kind: "send_invoice",
    targetKind: "invoice",
    targetId: invoice.id,
    projectId: invoice.project_id,
    payload: { invoiceId: invoice.id },
    artifactRevision: `rev${invoice.revision}`,
    policyRef: opts.policyRef ?? null,
    decisionId: opts.decisionId ?? null,
    commandId: opts.commandId,
    principal: opts.principal,
    hold: lane.open ? null : `sends lane paused: ${lane.reason}`,
  });
  await run(`UPDATE invoices SET send_intent_id = $2, delivery_state = CASE WHEN delivery_state IN ('none','failed') THEN 'queued' ELSE delivery_state END WHERE id = $1`, [invoice.id, intent.id]);
  return intent;
}

// ── W08: client acceptance → initial invoice ────────────────────────────────

export interface AcceptanceContext {
  sig: SigRow;
  estimate: EstimateRow;
  projectId: string;
  firstDraw: DrawLine;
  amountCents: number;
  economicKey: string;
}

/** Verify the acceptance evidence. Returns a reason when this signature is
 *  not a client acceptance of an owner-approved formal estimate on a project. */
export async function acceptanceContext(run: Run, signatureRequestId: number): Promise<{ ok: true; ctx: AcceptanceContext } | { ok: false; reason: string; code: "not_acceptance" | "changed" }> {
  const sig = await loadSignature(run, signatureRequestId);
  if (!sig) return { ok: false, code: "not_acceptance", reason: "No such signature request." };
  if (sig.doc_type !== "estimate") return { ok: false, code: "not_acceptance", reason: `Signature ${sig.id} is a ${sig.doc_type}, not an estimate acceptance.` };
  if (sig.status !== "signed") return { ok: false, code: "not_acceptance", reason: `Signature ${sig.id} is ${sig.status}; only a client signature is acceptance.` };
  if (!sig.estimate_id) return { ok: false, code: "not_acceptance", reason: "The signed document is not linked to an estimate." };
  const est = await loadEstimate(run, sig.estimate_id);
  if (!est) return { ok: false, code: "not_acceptance", reason: "Linked estimate no longer exists." };
  if (est.kind !== "formal") return { ok: false, code: "not_acceptance", reason: `Estimate ${est.id} is a ${est.kind} estimate; only the formal estimate's acceptance issues the initial invoice.` };
  const projectId = est.project_id ?? sig.project_id;
  if (!projectId) return { ok: false, code: "not_acceptance", reason: "The accepted estimate is not on a project yet (lead stage); convert the lead first." };
  if (!(est.total > 0)) return { ok: false, code: "changed", reason: `Estimate ${est.id} has no total; nothing to bill.` };
  if (sig.sent_at && est.lines_changed_at && new Date(est.lines_changed_at).getTime() > new Date(sig.sent_at).getTime()) {
    return { ok: false, code: "changed", reason: "The estimate's lines changed after the offer was sent; the client did not accept this revision. Re-send for acceptance." };
  }
  const lines = await drawScheduleFor(run, est);
  const firstDraw = lines[0];
  const amountCents = drawAmount(est.total, firstDraw.percent);
  if (amountCents <= 0) return { ok: false, code: "changed", reason: "The first draw is 0% of the total; there is no initial invoice under this payment structure." };
  return { ok: true, ctx: { sig, estimate: est, projectId, firstDraw, amountCents, economicKey: `estimate:${est.id}:initial` } };
}

export interface IssueInitialInput {
  signatureRequestId: number;
  principal: Principal;
  /** An approved 'invoice_issue' decision when the policy is not active. */
  decisionId?: string | null;
}

export async function issueInitialOnAcceptance(tx: Tx, input: IssueInitialInput): Promise<IssueOutcome> {
  const pre = await tx((run) => acceptanceContext(run, input.signatureRequestId));
  if (!pre.ok) return { issued: false, code: pre.code, reason: pre.reason };
  const { ctx } = pre;

  // Authority: active policy, else a consumed decision, else stage one.
  let authRef: string | null = null;
  const policy = await tx((run) => activePolicy(run, POLICY_INITIAL));
  if (policy) authRef = policyRef(policy);
  else if (input.decisionId) authRef = `decision:${input.decisionId}`;
  else {
    const staged = await tx((run) =>
      stageDecision(run, {
        kind: "invoice_issue",
        action: "invoice.issue_initial",
        title: `Issue the initial invoice (${ctx.firstDraw.label}) — client accepted estimate #${ctx.estimate.id}`,
        summary: {
          effect: `Issues ${ctx.firstDraw.percent}% of the accepted total and queues it to the client. Policy "${POLICY_INITIAL}" is not active, so this needs your tap.`,
          inclusions: [`${ctx.firstDraw.label}: ${ctx.amountCents} cents`],
        },
        targetKind: "estimate",
        targetId: ctx.estimate.id,
        amountCents: ctx.amountCents,
        projectId: ctx.projectId,
        dedupeKey: ctx.economicKey,
        requestedBy: input.principal,
        content: { economicKey: ctx.economicKey, amountCents: ctx.amountCents },
      }),
    );
    return { issued: false, code: "policy_inactive", reason: `Policy ${POLICY_INITIAL} is not active; staged a decision instead.`, decisionId: staged.decision.id };
  }

  try {
    const out = await runCommand(
      tx,
      {
        name: "invoice.issue_initial_on_acceptance",
        requestKey: ctx.economicKey,
        input: { estimateId: ctx.estimate.id, amountCents: ctx.amountCents, drawLabel: ctx.firstDraw.label },
        principal: input.principal,
        authRef,
      },
      async ({ run, commandId }) => {
        if (input.decisionId && !policy) {
          const c = await consumeDecision(run, {
            id: input.decisionId,
            action: "invoice.issue_initial",
            amountCents: ctx.amountCents,
            targetKind: "estimate",
            targetId: ctx.estimate.id,
            contentHash: contentHashOf({ economicKey: ctx.economicKey, amountCents: ctx.amountCents }),
            consumer: "invoice.issue_initial_on_acceptance",
          });
          if (!c.ok) throw new Error(c.reason);
        }
        const { invoice, created } = await issueMilestoneInvoice(run, {
          projectId: ctx.projectId,
          economicKey: ctx.economicKey,
          milestone: ctx.firstDraw.label,
          amountCents: ctx.amountCents,
          source: "acceptance",
          estimateId: ctx.estimate.id,
          principal: input.principal,
        });
        await logInvoiceEvent(run, invoice.id, "acceptance_recorded", input.principal, { signatureRequestId: ctx.sig.id, signedBy: ctx.sig.signed_name, authRef });
        await markDrawBilled(run, ctx.estimate.id, 0);
        const intent = await enqueueSend(run, invoice, { principal: input.principal, commandId, policyRef: policy ? authRef : null, decisionId: policy ? null : input.decisionId });
        return { result: { invoiceId: invoice.id, invoiceNumber: invoice.number, created, intentId: intent.id } };
      },
    );
    return { issued: true, ...out.result, replayed: out.replayed };
  } catch (err) {
    if (err instanceof CommandConflictError) {
      return { issued: false, code: "changed", reason: "The accepted terms differ from the ones already billed under this economic identity; nothing was issued twice." };
    }
    throw err;
  }
}

// ── W08 (later): signed construction contract links, never rebills ─────────

export async function linkSignedContract(tx: Tx, input: { signatureRequestId: number; principal: Principal }): Promise<{ linked: number[]; reason?: string }> {
  return tx(async (run) => {
    const sig = await loadSignature(run, input.signatureRequestId);
    if (!sig || sig.doc_type !== "contract" || sig.status !== "signed" || !sig.project_id) return { linked: [], reason: "Not a signed project contract." };
    const rows = await run<InvoiceRow>(
      `SELECT ${INVOICE_COLS} FROM invoices
        WHERE project_id = $1 AND status <> 'void' AND source = 'acceptance'
          AND ($2::bigint IS NULL OR estimate_id = $2 OR estimate_id IS NULL)
          AND (contract_signature_request_id IS NULL OR contract_signature_request_id = $3)`,
      [sig.project_id, sig.estimate_id, sig.id],
    );
    const linked: number[] = [];
    for (const inv of rows) {
      await linkContractToInvoice(run, { invoiceId: inv.id, signatureRequestId: sig.id, principal: input.principal });
      linked.push(inv.id);
    }
    return { linked };
  });
}

// ── W10: owner-confirmed milestone → progress draw ──────────────────────────

export interface IssueProgressInput {
  projectId: string;
  /** Draw index (0-based) or the label slug of the draw line. */
  milestoneKey: string | number;
  principal: Principal;
  /** Approved decision of kind 'milestone_confirmation' (required unless the principal is the owner). */
  decisionId?: string | null;
  /** Evidence noted on the audit row (photo ids, inspection, note). */
  evidence?: Record<string, unknown>;
}

async function approvedFormalEstimate(run: Run, projectId: string): Promise<EstimateRow | null> {
  const [r] = await run<EstimateRow>(
    `SELECT e.id::int AS id, e.project_id, e.kind, e.status, e.total, e.draw_schedule, e.sent_at::text AS sent_at, NULL::text AS lines_changed_at
       FROM estimates e WHERE e.project_id = $1 AND e.kind = 'formal' AND e.status = 'approved'
      ORDER BY e.approved_at DESC NULLS LAST, e.id DESC LIMIT 1`,
    [projectId],
  );
  return r ?? null;
}

export async function resolveDraw(run: Run, projectId: string, milestoneKey: string | number): Promise<{ estimate: EstimateRow; index: number; line: DrawLine; amountCents: number; economicKey: string } | null> {
  const est = await approvedFormalEstimate(run, projectId);
  if (!est) return null;
  const lines = await drawScheduleFor(run, est);
  let index = -1;
  if (typeof milestoneKey === "number" || /^\d+$/.test(String(milestoneKey))) index = Number(milestoneKey);
  else {
    const want = String(milestoneKey).toLowerCase();
    index = lines.findIndex((l, i) => drawEconomicKey(i, l.label) === want || drawEconomicKey(i, l.label).endsWith(`:${want}`) || l.label.toLowerCase() === want);
  }
  const line = lines[index];
  if (!line) return null;
  return { estimate: est, index, line, amountCents: drawAmount(est.total, line.percent), economicKey: drawEconomicKey(index, line.label) };
}

/** Stage the owner's milestone confirmation card (W10). */
export async function stageMilestoneConfirmation(run: Run, input: { projectId: string; milestoneKey: string | number; principal: Principal; evidence?: Record<string, unknown> }) {
  const d = await resolveDraw(run, input.projectId, input.milestoneKey);
  if (!d) throw new Error("No such draw on the approved formal estimate.");
  return stageDecision(run, {
    kind: "milestone_confirmation",
    action: "invoice.issue_progress",
    title: `Confirm milestone "${d.line.label}" reached — bills ${d.line.percent}% (${d.amountCents} cents)`,
    summary: { effect: "On approve, the progress invoice is issued once and queued to the client.", assumptions: Object.keys(input.evidence ?? {}).map((k) => `${k}: ${JSON.stringify((input.evidence ?? {})[k])}`) },
    targetKind: "milestone",
    targetId: d.economicKey,
    amountCents: d.amountCents,
    projectId: input.projectId,
    dedupeKey: `project:${input.projectId}:${d.economicKey}`,
    requestedBy: input.principal,
    content: { economicKey: d.economicKey, amountCents: d.amountCents },
  });
}

export async function issueProgressOnOwnerConfirmation(tx: Tx, input: IssueProgressInput): Promise<IssueOutcome> {
  const d = await tx((run) => resolveDraw(run, input.projectId, input.milestoneKey));
  if (!d) return { issued: false, code: "no_milestone", reason: "No matching draw on the approved formal estimate." };
  // Index 0 is the acceptance invoice's identity when one exists: never bill it twice.
  if (d.index === 0) {
    const initial = await tx((run) => run<{ id: number }>(`SELECT id::int AS id FROM invoices WHERE project_id = $1 AND economic_key = $2 AND status <> 'void'`, [input.projectId, `estimate:${d.estimate.id}:initial`]));
    if (initial.length) return { issued: true, invoiceId: Number(initial[0].id), invoiceNumber: "", created: false, intentId: null, replayed: true };
  }
  let authRef: string;
  if (input.decisionId) authRef = `decision:${input.decisionId}`;
  else if (isOwner(input.principal)) authRef = "owner";
  else return { issued: false, code: "unauthorized", reason: "Progress billing needs Joe's milestone confirmation (a resolved decision) or the owner acting directly." };

  try {
    const out = await runCommand(
      tx,
      {
        name: "invoice.issue_progress_on_owner_confirmation",
        requestKey: `project:${input.projectId}:${d.economicKey}`,
        input: { economicKey: d.economicKey, amountCents: d.amountCents, estimateId: d.estimate.id },
        principal: input.principal,
        authRef,
      },
      async ({ run, commandId }) => {
        if (input.decisionId) {
          const c = await consumeDecision(run, {
            id: input.decisionId,
            action: "invoice.issue_progress",
            amountCents: d.amountCents,
            targetKind: "milestone",
            targetId: d.economicKey,
            contentHash: contentHashOf({ economicKey: d.economicKey, amountCents: d.amountCents }),
            consumer: "invoice.issue_progress_on_owner_confirmation",
          });
          if (!c.ok) throw new Error(c.reason);
        }
        const { invoice, created } = await issueMilestoneInvoice(run, {
          projectId: input.projectId,
          economicKey: d.economicKey,
          milestone: d.line.label,
          amountCents: d.amountCents,
          source: "progress",
          estimateId: d.estimate.id,
          principal: input.principal,
        });
        await logInvoiceEvent(run, invoice.id, "milestone_confirmed", input.principal, { authRef, evidence: input.evidence ?? {}, drawIndex: d.index });
        await markDrawBilled(run, d.estimate.id, d.index);
        const intent = await enqueueSend(run, invoice, { principal: input.principal, commandId, decisionId: input.decisionId ?? null });
        return { result: { invoiceId: invoice.id, invoiceNumber: invoice.number, created, intentId: intent.id } };
      },
    );
    return { issued: true, ...out.result, replayed: out.replayed };
  } catch (err) {
    if (err instanceof CommandConflictError) return { issued: false, code: "changed", reason: "This milestone was already billed under a different amount; nothing issued twice." };
    if (err instanceof Error && /decision/i.test(err.message)) return { issued: false, code: "unauthorized", reason: err.message };
    throw err;
  }
}

// ── W12: written client sign-off → final invoice = verified remainder ───────

export interface FinalReconciliation {
  projectId: string;
  contractTotalCents: number;
  contractSource: "price_cents" | "formal_estimate" | "contract_value";
  approvedChangeOrdersCents: number;
  previouslyIssuedCents: number;
  settledCents: number;
  creditsCents: number;
  pendingCents: number;
  remainderCents: number;
  economicKey: string;
  uncertain: string[];
}

export async function finalReconciliation(run: Run, projectId: string): Promise<FinalReconciliation | null> {
  const [p] = await run<{ id: string; price_cents: number | null; contract_value: number }>(`SELECT id, price_cents, contract_value FROM projects WHERE id = $1`, [projectId]);
  if (!p) return null;
  const est = await approvedFormalEstimate(run, projectId);
  let contractTotalCents: number;
  let contractSource: FinalReconciliation["contractSource"];
  if (p.price_cents != null) {
    contractTotalCents = Number(p.price_cents);
    contractSource = "price_cents";
  } else if (est && est.total > 0) {
    contractTotalCents = Number(est.total);
    contractSource = "formal_estimate";
  } else {
    contractTotalCents = Number(p.contract_value) * 100;
    contractSource = "contract_value";
  }
  const economicKey = `project:${projectId}:final`;
  const [co] = await run<{ n: number }>(`SELECT COALESCE(SUM(price_cents), 0)::int AS n FROM change_orders WHERE project_id = $1 AND status = 'approved'`, [projectId]);
  const [inv] = await run<{ issued: number; settled: number; credits: number; pending: number }>(
    `SELECT COALESCE(SUM(i.amount), 0)::int AS issued,
            COALESCE(SUM((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind = 'payment' AND p.status = 'settled')), 0)::int AS settled,
            COALESCE(SUM((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind IN ('credit','writeoff') AND p.status = 'settled')), 0)::int AS credits,
            COALESCE(SUM((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind = 'payment' AND p.status = 'pending')), 0)::int AS pending
       FROM invoices i WHERE i.project_id = $1 AND i.status NOT IN ('draft','void') AND (i.economic_key IS NULL OR i.economic_key <> $2)`,
    [projectId, economicKey],
  );
  const remainderCents = contractTotalCents + Number(co.n) - Number(inv.issued);
  const uncertain: string[] = [];
  if (contractTotalCents <= 0) uncertain.push("No contract total on record (no price, approved formal estimate or contract value).");
  if (Number(inv.pending) > 0) uncertain.push(`A payment of ${Number(inv.pending)} cents is still pending; wait for it to settle or fail.`);
  if (remainderCents < 0) uncertain.push(`Issued invoices (${Number(inv.issued)}) exceed contract + change orders (${contractTotalCents + Number(co.n)}); reconcile before billing.`);
  const [dis] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1 AND status = 'disputed'`, [projectId]);
  if (Number(dis.n) > 0) uncertain.push("An invoice on this job is disputed.");
  return {
    projectId,
    contractTotalCents,
    contractSource,
    approvedChangeOrdersCents: Number(co.n),
    previouslyIssuedCents: Number(inv.issued),
    settledCents: Number(inv.settled),
    creditsCents: Number(inv.credits),
    pendingCents: Number(inv.pending),
    remainderCents,
    economicKey,
    uncertain,
  };
}

export async function issueFinalOnClientSignoff(tx: Tx, input: { signatureRequestId: number; principal: Principal; decisionId?: string | null }): Promise<IssueOutcome> {
  const sig = await tx((run) => loadSignature(run, input.signatureRequestId));
  if (!sig || sig.doc_type !== "completion" || sig.status !== "signed" || !sig.project_id) {
    return { issued: false, code: "not_signoff", reason: "Only a signed completion sign-off on a project issues the final invoice." };
  }
  const projectId = sig.project_id;
  const rec = await tx((run) => finalReconciliation(run, projectId));
  if (!rec) return { issued: false, code: "not_signoff", reason: "Project not found." };
  if (rec.uncertain.length) {
    const staged = await tx((run) =>
      stageDecision(run, {
        kind: "billing_exception",
        action: "final_invoice_review",
        title: `Final invoice held — reconciliation uncertain`,
        summary: { gaps: rec.uncertain, effect: "No final invoice was issued. Resolve the items, then re-run the sign-off command.", quantities: [{ label: "remainder (cents)", qty: rec.remainderCents }] },
        targetKind: "project",
        targetId: projectId,
        amountCents: rec.remainderCents,
        projectId,
        dedupeKey: `${rec.economicKey}:review`,
        requestedBy: input.principal,
        content: rec,
      }),
    );
    return { issued: false, code: "uncertain", reason: rec.uncertain.join(" "), decisionId: staged.decision.id };
  }
  if (rec.remainderCents === 0) return { issued: false, code: "nothing_due", reason: "Everything under the contract and approved change orders has already been invoiced; no final invoice is needed." };

  let authRef: string | null = null;
  const policy = await tx((run) => activePolicy(run, POLICY_FINAL));
  if (policy) authRef = policyRef(policy);
  else if (input.decisionId) authRef = `decision:${input.decisionId}`;
  else {
    const staged = await tx((run) =>
      stageDecision(run, {
        kind: "invoice_issue",
        action: "invoice.issue_final",
        title: `Issue the final invoice (${rec.remainderCents} cents) — client signed off`,
        summary: {
          effect: `Policy "${POLICY_FINAL}" is not active, so this needs your tap.`,
          quantities: [
            { label: "contract", qty: rec.contractTotalCents },
            { label: "approved change orders", qty: rec.approvedChangeOrdersCents },
            { label: "previously invoiced", qty: rec.previouslyIssuedCents },
          ],
        },
        targetKind: "project",
        targetId: projectId,
        amountCents: rec.remainderCents,
        projectId,
        dedupeKey: rec.economicKey,
        requestedBy: input.principal,
        content: { economicKey: rec.economicKey, amountCents: rec.remainderCents },
      }),
    );
    return { issued: false, code: "policy_inactive", reason: `Policy ${POLICY_FINAL} is not active; staged a decision instead.`, decisionId: staged.decision.id };
  }

  try {
    const out = await runCommand(
      tx,
      {
        name: "invoice.issue_final_on_client_signoff",
        requestKey: rec.economicKey,
        input: { amountCents: rec.remainderCents, contract: rec.contractTotalCents, cos: rec.approvedChangeOrdersCents, issued: rec.previouslyIssuedCents },
        principal: input.principal,
        authRef,
      },
      async ({ run, commandId }) => {
        if (input.decisionId && !policy) {
          const c = await consumeDecision(run, {
            id: input.decisionId,
            action: "invoice.issue_final",
            amountCents: rec.remainderCents,
            targetKind: "project",
            targetId: projectId,
            contentHash: contentHashOf({ economicKey: rec.economicKey, amountCents: rec.remainderCents }),
            consumer: "invoice.issue_final_on_client_signoff",
          });
          if (!c.ok) throw new Error(c.reason);
        }
        const label = `Final balance — contract ${rec.contractTotalCents} + change orders ${rec.approvedChangeOrdersCents} − previously invoiced ${rec.previouslyIssuedCents} (cents)`;
        const { invoice, created } = await issueMilestoneInvoice(run, {
          projectId,
          economicKey: rec.economicKey,
          milestone: "Final invoice",
          amountCents: rec.remainderCents,
          lines: [{ label, amount: rec.remainderCents }],
          source: "final",
          contractSignatureRequestId: null,
          principal: input.principal,
        });
        await logInvoiceEvent(run, invoice.id, "signoff_recorded", input.principal, { signatureRequestId: sig.id, reconciliation: rec, authRef });
        const intent = await enqueueSend(run, invoice, { principal: input.principal, commandId, policyRef: policy ? authRef : null, decisionId: policy ? null : input.decisionId });
        return { result: { invoiceId: invoice.id, invoiceNumber: invoice.number, created, intentId: intent.id } };
      },
    );
    return { issued: true, ...out.result, replayed: out.replayed };
  } catch (err) {
    if (err instanceof CommandConflictError) return { issued: false, code: "changed", reason: "A final invoice was already issued for a different remainder; reconcile instead of issuing twice." };
    throw err;
  }
}

// ── Event entry point (esign handler, worker source-event processor) ────────

export interface SignatureSignedOutcome {
  signatureRequestId: number;
  docType: string | null;
  initial?: IssueOutcome;
  final?: IssueOutcome;
  contract?: { linked: number[]; reason?: string };
}

/** Idempotent on repeated signature events: every branch is keyed on the
 *  economic identity, so calling this twice (or from two processors) issues
 *  nothing twice. */
export async function onSignatureSigned(tx: Tx, signatureRequestId: number, principal: Principal): Promise<SignatureSignedOutcome> {
  const sig = await tx((run) => loadSignature(run, signatureRequestId));
  const out: SignatureSignedOutcome = { signatureRequestId, docType: sig?.doc_type ?? null };
  if (!sig || sig.status !== "signed") return out;
  if (sig.doc_type === "estimate") out.initial = await issueInitialOnAcceptance(tx, { signatureRequestId, principal });
  else if (sig.doc_type === "contract") out.contract = await linkSignedContract(tx, { signatureRequestId, principal });
  else if (sig.doc_type === "completion") out.final = await issueFinalOnClientSignoff(tx, { signatureRequestId, principal });
  return out;
}

export { getInvoice };
