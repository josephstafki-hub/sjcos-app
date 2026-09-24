// Bills and approved payment (A13, DECISIONS "Pay an approved purchase or
// vendor bill", INTEGRATIONS "Purchase, vendor payment and refunds").
//
//   receiveBill      — a file/amount arrives. Nothing is payable.
//   matchBill        — bind to a commitment; payable_cents only when the
//                      commitment has accepted deliveries covering it.
//   stagePaymentDecision — SEPARATE 'payment' decision bound to bill +
//                      payable amount + validated destination (unless the
//                      purchase was explicitly pay-now bundled).
//   executePayment   — consumes the decision; with no rail → 'manual_pending'
//                      + owner execution step. Idempotent on bill+decision.
//   recordManualPaymentConfirmation — the only way a bill becomes 'paid';
//                      reconciles the cash reservation.
//
// Pure `run` module; no provider calls.

import type { Run } from "../commands/core.ts";
import { consumeDecision, stageDecision, type Decision } from "../commands/decisions.ts";
import { enqueueIntent, reconcileIntent } from "../commands/intents.ts";
import { laneOpen } from "../commands/policies.ts";
import { humanOf, principalLabel, type Principal } from "../commands/principal.ts";
import { consumeReservationOnPayment, escalateShortfall } from "../funding/index.ts";
import { getCommitment } from "./commitments.ts";
import { acceptedValueCents } from "./deliveries.ts";
import { loadPaymentRail, type PaymentRail } from "./payment-rail.ts";
import { BILL_COLS, PAYMENT_ACTION, PURCHASE_AND_PAY_ACTION, usd, type Bill, type PayeeKind } from "./types.ts";

function normalize(b: Bill): Bill {
  return {
    ...b,
    id: Number(b.id),
    commitment_id: b.commitment_id == null ? null : Number(b.commitment_id),
    amount_cents: Number(b.amount_cents),
    payable_cents: b.payable_cents == null ? null : Number(b.payable_cents),
  };
}

export async function getBill(run: Run, id: number, opts: { forUpdate?: boolean } = {}): Promise<Bill | null> {
  const [row] = await run<Bill>(`SELECT ${BILL_COLS} FROM bills WHERE id = $1${opts.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? normalize(row) : null;
}

export interface ReceiveBillInput {
  projectId?: string | null;
  commitmentId?: number | null;
  payeeKind: PayeeKind;
  vendorId?: string | null;
  subSlug?: string | null;
  payeeName: string;
  billNumber?: string;
  amountCents: number;
  currency?: string;
  /** Scoped file handle (files.id) — never bytes. */
  fileId?: string | null;
  principal: Principal;
}

/** A bill arrives. It is recorded, unmatched, with payable_cents NULL. */
export async function receiveBill(run: Run, input: ReceiveBillInput): Promise<{ ok: true; bill: Bill; matched: MatchResult | null } | { ok: false; reason: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, reason: "A bill needs a positive whole-cent amount." };
  if (input.fileId) {
    const [f] = await run<{ id: string }>(`SELECT id FROM files WHERE id = $1`, [input.fileId]);
    if (!f) return { ok: false, reason: "That file id does not exist." };
  }
  let projectId = input.projectId ?? null;
  if (input.commitmentId) {
    const c = await getCommitment(run, input.commitmentId);
    if (!c) return { ok: false, reason: "No such commitment." };
    projectId = c.project_id;
  }
  const [row] = await run<Bill>(
    `INSERT INTO bills (project_id, commitment_id, payee_kind, vendor_id, sub_slug, payee_name, bill_number, amount_cents, currency, received_file_id, created_by)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${BILL_COLS}`,
    [projectId, input.payeeKind, input.vendorId ?? null, input.subSlug ?? null, input.payeeName, input.billNumber ?? "", input.amountCents, input.currency ?? "USD", input.fileId ?? null, principalLabel(input.principal)],
  );
  const bill = normalize(row);
  let matched: MatchResult | null = null;
  if (input.commitmentId) matched = await matchBill(run, { billId: bill.id, commitmentId: input.commitmentId });
  return { ok: true, bill: matched && matched.ok ? matched.bill : bill, matched };
}

export type MatchResult = { ok: true; bill: Bill; payable: boolean; note: string } | { ok: false; reason: string };

/** Match a bill to a commitment. Payee must match the commitment's payee; the
 *  amount must not exceed what is unbilled; payable only against accepted
 *  deliveries. Anything else is 'disputed' with the reason kept. */
export async function matchBill(run: Run, input: { billId: number; commitmentId: number }): Promise<MatchResult> {
  const bill = await getBill(run, input.billId, { forUpdate: true });
  if (!bill) return { ok: false, reason: "No such bill." };
  if (bill.state === "paid" || bill.state === "void") return { ok: false, reason: `Bill is ${bill.state}.` };
  const c = await getCommitment(run, input.commitmentId, { forUpdate: true });
  if (!c) return { ok: false, reason: "No such commitment." };
  const samePayee =
    (c.payee_kind === "vendor" && bill.vendor_id && bill.vendor_id === c.vendor_id) ||
    (c.payee_kind === "sub" && bill.sub_slug && bill.sub_slug === c.sub_slug);
  const dispute = async (note: string): Promise<MatchResult> => {
    const [u] = await run<Bill>(
      `UPDATE bills SET commitment_id = $2, project_id = $3, matched_state = 'disputed', match_note = $4, payable_cents = NULL, updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`,
      [bill.id, c.id, c.project_id, note],
    );
    return { ok: true, bill: normalize(u), payable: false, note };
  };
  if (!samePayee) return dispute(`Bill payee (${bill.payee_name}) is not the commitment's payee (${c.payee_name}).`);
  if (["draft", "approved", "void"].includes(c.state)) return dispute(`Commitment is ${c.state}; nothing was ordered.`);
  const [others] = await run<{ billed: string }>(
    `SELECT COALESCE(sum(COALESCE(payable_cents, amount_cents)), 0)::bigint AS billed FROM bills WHERE commitment_id = $1 AND id <> $2 AND state <> 'void' AND matched_state = 'matched'`,
    [c.id, bill.id],
  );
  const alreadyBilled = Number(others?.billed ?? 0);
  if (alreadyBilled + bill.amount_cents > c.total_cents) {
    return dispute(`Bill ${usd(bill.amount_cents)} plus ${usd(alreadyBilled)} already billed exceeds the committed ${usd(c.total_cents)}.`);
  }
  const accepted = await acceptedValueCents(run, c);
  const payableCeiling = Math.max(0, accepted - alreadyBilled);
  const payable = Math.min(bill.amount_cents, payableCeiling);
  const note =
    payable <= 0
      ? `Matched to commitment #${c.id}; nothing accepted yet (accepted value ${usd(accepted)}), so not payable.`
      : payable < bill.amount_cents
        ? `Matched; payable limited to accepted work ${usd(payable)} of ${usd(bill.amount_cents)} billed.`
        : `Matched; ${usd(payable)} payable against accepted deliveries.`;
  const [u] = await run<Bill>(
    `UPDATE bills SET commitment_id = $2, project_id = $3, matched_state = 'matched', match_note = $4, payable_cents = $5, updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`,
    [bill.id, c.id, c.project_id, note, payable > 0 ? payable : null],
  );
  if (payable > 0 && ["accepted", "delivered", "reviewed", "partially_delivered"].includes(c.state)) {
    await run(`UPDATE commitments SET state = CASE WHEN state = 'accepted' THEN 'payable' ELSE state END, updated_at = now() WHERE id = $1`, [c.id]);
  }
  return { ok: true, bill: normalize(u), payable: payable > 0, note };
}

/** Validated destination: the trusted record's contact plus any OWNER-
 *  CONFIRMED payee_validations. Proposed/untrusted rows are ignored. */
export async function validatedDestination(run: Run, bill: Bill): Promise<{ ok: true; destination: Record<string, unknown> } | { ok: false; reason: string }> {
  if (bill.payee_kind === "vendor" && bill.vendor_id) {
    const [v] = await run<{ name: string; email: string | null; phone: string | null }>(`SELECT name, email, phone FROM vendors WHERE id = $1`, [bill.vendor_id]);
    if (!v) return { ok: false, reason: "Vendor record missing." };
    const confirmed = await run<{ field: string; proposed_value: string }>(
      `SELECT field, proposed_value FROM payee_validations WHERE payee_kind = 'vendor' AND vendor_id = $1 AND state = 'confirmed' ORDER BY confirmed_at DESC`,
      [bill.vendor_id],
    );
    const dest: Record<string, unknown> = { kind: "vendor", vendorId: bill.vendor_id, name: v.name, email: v.email, phone: v.phone };
    for (const row of confirmed) if (dest[row.field] === undefined) dest[row.field] = row.proposed_value;
    return { ok: true, destination: dest };
  }
  if (bill.payee_kind === "sub" && bill.sub_slug) {
    const [s] = await run<{ name: string; email: string | null; phone: string | null }>(`SELECT name, email, phone FROM subs WHERE slug = $1`, [bill.sub_slug]);
    if (!s) return { ok: false, reason: "Sub record missing." };
    const confirmed = await run<{ field: string; proposed_value: string }>(
      `SELECT field, proposed_value FROM payee_validations WHERE payee_kind = 'sub' AND sub_slug = $1 AND state = 'confirmed' ORDER BY confirmed_at DESC`,
      [bill.sub_slug],
    );
    const dest: Record<string, unknown> = { kind: "sub", subSlug: bill.sub_slug, name: s.name, email: s.email, phone: s.phone };
    for (const row of confirmed) if (dest[row.field] === undefined) dest[row.field] = row.proposed_value;
    return { ok: true, destination: dest };
  }
  return { ok: false, reason: "A payment destination needs a vendor or sub record; one-off payees cannot be validated." };
}

/** Propose a payee detail change. Untrusted sources (inbound email) can only
 *  ever create a 'proposed' row; confirmPayeeValidation is owner-only. */
export async function proposePayeeValidation(
  run: Run,
  input: { payeeKind: "vendor" | "sub"; vendorId?: string | null; subSlug?: string | null; field: "email" | "phone" | "bank" | "address"; value: string; source: string; sourceTrusted?: boolean },
): Promise<number> {
  const [row] = await run<{ id: number }>(
    `INSERT INTO payee_validations (payee_kind, vendor_id, sub_slug, field, proposed_value, source, source_trusted)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.payeeKind, input.vendorId ?? null, input.subSlug ?? null, input.field, input.value, input.source, Boolean(input.sourceTrusted)],
  );
  return Number(row.id);
}

export async function confirmPayeeValidation(run: Run, id: number, principal: Principal, note = ""): Promise<{ ok: true } | { ok: false; reason: string }> {
  const human = humanOf(principal);
  if (!human || human.role !== "owner") return { ok: false, reason: "Only the owner can confirm a payee change." };
  const rows = await run(`UPDATE payee_validations SET state = 'confirmed', confirmed_by = $2, confirmed_at = now(), note = $3 WHERE id = $1 AND state = 'proposed' RETURNING id`, [id, human.userId, note]);
  return rows.length ? { ok: true } : { ok: false, reason: "No open proposal with that id." };
}

export type StagePaymentResult =
  | { ok: true; decision: Decision; bill: Bill; bundled: boolean; created: boolean }
  | { ok: false; reason: string };

/** Stage the separate 'payment' decision for a matched, payable bill. */
export async function stagePaymentDecision(run: Run, input: { billId: number; principal: Principal; href?: string | null }): Promise<StagePaymentResult> {
  const bill = await getBill(run, input.billId, { forUpdate: true });
  if (!bill) return { ok: false, reason: "No such bill." };
  if (bill.state === "paid") return { ok: false, reason: "That bill is already paid." };
  if (bill.state === "manual_pending") return { ok: false, reason: "That payment is approved and waiting for the owner to execute it by hand." };
  if (bill.matched_state !== "matched" || bill.payable_cents == null || bill.payable_cents <= 0) {
    return { ok: false, reason: `Nothing is payable on this bill yet (${bill.match_note || "unmatched"}).` };
  }
  const dest = await validatedDestination(run, bill);
  if (!dest.ok) return { ok: false, reason: dest.reason };
  const c = bill.commitment_id ? await getCommitment(run, bill.commitment_id) : null;
  const [p] = bill.project_id ? await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [bill.project_id]) : [];

  if (c?.pay_now_bundled && c.decision_id) {
    const [d] = await run<Decision>(`SELECT id, status, uses, max_uses, action, amount_cents::bigint AS amount_cents FROM decisions WHERE id = $1`, [c.decision_id]);
    if (d && d.action === PURCHASE_AND_PAY_ACTION && d.status === "approved" && d.uses < d.max_uses && Number(d.amount_cents) === bill.payable_cents) {
      const [u] = await run<Bill>(`UPDATE bills SET payment_decision_id = $2, destination = $3::jsonb, state = 'approved', updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`, [bill.id, d.id, JSON.stringify(dest.destination)]);
      return { ok: true, decision: d, bill: normalize(u), bundled: true, created: false };
    }
  }
  const recipient = String(dest.destination.email ?? dest.destination.phone ?? "");
  const staged = await stageDecision(run, {
    kind: "payment",
    action: PAYMENT_ACTION,
    title: `Pay ${usd(bill.payable_cents)} to ${bill.payee_name}${bill.bill_number ? ` · bill ${bill.bill_number}` : ""}${p ? ` · ${p.name}` : ""}`.slice(0, 300),
    summary: {
      recipients: [{ name: bill.payee_name, address: recipient, role: bill.payee_kind }],
      amount: usd(bill.payable_cents),
      billed: usd(bill.amount_cents),
      commitment: c ? `#${c.id} rev${c.revision} ${c.scope_summary}` : "(none)",
      matched: bill.match_note,
      destination: dest.destination,
      effect: `Approving authorises a payment of exactly ${usd(bill.payable_cents)} to ${bill.payee_name}. No payment rail is connected: the owner completes it by hand and records the confirmation; the bill is not 'paid' until then.`,
    },
    targetKind: "bill",
    targetId: bill.id,
    recipient,
    amountCents: bill.payable_cents,
    currency: bill.currency,
    content: { billId: bill.id, payableCents: bill.payable_cents, destination: dest.destination, commitmentId: bill.commitment_id },
    projectId: bill.project_id,
    href: input.href ?? (p ? `/projects/${p.slug}` : null),
    dedupeKey: `payment:bill:${bill.id}`,
    requestedBy: input.principal,
  });
  const [u] = await run<Bill>(`UPDATE bills SET payment_decision_id = $2, destination = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`, [bill.id, staged.decision.id, JSON.stringify(dest.destination)]);
  return { ok: true, decision: staged.decision, bill: normalize(u), bundled: false, created: staged.created };
}

export type ExecutePaymentResult =
  | { ok: true; bill: Bill; outcome: "manual_pending" | "accepted" | "confirmed" | "unknown"; intentId: string | null; already: boolean; instructions?: string }
  | { ok: false; reason: string };

/** Execute an approved payment. Idempotent on (bill, decision): a retry
 *  returns the existing state and never disburses twice. */
export async function executePayment(
  run: Run,
  input: { billId: number; decisionId: string; principal: Principal; rail?: PaymentRail; commandId?: string | null },
): Promise<ExecutePaymentResult> {
  const bill = await getBill(run, input.billId, { forUpdate: true });
  if (!bill) return { ok: false, reason: "No such bill." };
  if (bill.state === "paid") return { ok: true, bill, outcome: "confirmed", intentId: bill.payment_intent_id, already: true };
  if (bill.state === "manual_pending") return { ok: true, bill, outcome: "manual_pending", intentId: bill.payment_intent_id, already: true };
  if (bill.state === "void") return { ok: false, reason: "That bill is void." };
  if (bill.payment_decision_id !== input.decisionId) return { ok: false, reason: "That decision is not the one staged for this bill." };
  if (bill.payable_cents == null || bill.payable_cents <= 0) return { ok: false, reason: "Nothing is payable on this bill." };
  if (!bill.destination) return { ok: false, reason: "No validated destination on this bill." };
  const lane = await laneOpen(run, "payments");
  if (!lane.open) return { ok: false, reason: `Payments are paused: ${lane.reason}` };

  const c = bill.commitment_id ? await getCommitment(run, bill.commitment_id) : null;
  const action = c?.pay_now_bundled ? PURCHASE_AND_PAY_ACTION : PAYMENT_ACTION;
  const contentHash = c?.pay_now_bundled ? c.content_hash : undefined;
  const consumed = await consumeDecision(run, {
    id: input.decisionId,
    action,
    contentHash: contentHash ?? (await run<{ content_hash: string }>(`SELECT content_hash FROM decisions WHERE id = $1`, [input.decisionId]))[0]?.content_hash ?? null,
    recipient: c?.pay_now_bundled ? c.payee_contact : String(bill.destination.email ?? bill.destination.phone ?? ""),
    amountCents: bill.payable_cents,
    targetKind: c?.pay_now_bundled ? "commitment" : "bill",
    targetId: c?.pay_now_bundled ? c.id : bill.id,
    consumer: principalLabel(input.principal),
  });
  if (!consumed.ok) return { ok: false, reason: consumed.reason };

  const operationKey = `bill:${bill.id}:pay:decision:${input.decisionId}`;
  const rail = input.rail ?? (await loadPaymentRail(run));
  const result = await rail.execute({ billId: bill.id, decisionId: input.decisionId, amountCents: bill.payable_cents, currency: bill.currency, destination: bill.destination, idempotencyKey: operationKey });

  const { intent } = await enqueueIntent(run, {
    operationKey,
    kind: "pay_bill",
    targetKind: "bill",
    targetId: bill.id,
    recipient: String(bill.destination.email ?? bill.destination.phone ?? "") || null,
    projectId: bill.project_id,
    payload: { billId: bill.id, amountCents: bill.payable_cents, currency: bill.currency, destination: bill.destination, rail: rail.name },
    decisionId: input.decisionId,
    commandId: input.commandId ?? null,
    principal: input.principal,
    hold: result.kind === "manual_required" ? `no payment rail (${rail.name}); owner executes by hand` : null,
    maxAttempts: 1,
  });

  if (result.kind === "manual_required") {
    const [p] = bill.project_id ? await run<{ id: string; slug: string }>(`SELECT id, slug FROM projects WHERE id = $1`, [bill.project_id]) : [];
    await run(
      `INSERT INTO work_items (title, body, status, priority, assignee_kind, assignee_key, project_id, source_kind, source_id, requires_approval, created_by)
       SELECT $1, $2, 'queued', 'high', 'human', 'human-joe', $3, 'agent', $4, false, $5
        WHERE NOT EXISTS (SELECT 1 FROM work_items WHERE source_kind = 'agent' AND source_id = $4 AND status NOT IN ('done','cancelled'))`,
      [
        `Pay ${usd(bill.payable_cents)} to ${bill.payee_name}${bill.bill_number ? ` (bill ${bill.bill_number})` : ""}`,
        `${result.instructions}\n\nWhen done, record the confirmation on bill #${bill.id} (record_manual_payment) with the method and reference.${p ? `\nProject: /projects/${p.slug}` : ""}`,
        p?.id ?? null,
        `bill:${bill.id}:manual-payment`,
        principalLabel(input.principal),
      ],
    );
    const [u] = await run<Bill>(`UPDATE bills SET state = 'manual_pending', payment_intent_id = $2, updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`, [bill.id, intent.id]);
    return { ok: true, bill: normalize(u), outcome: "manual_pending", intentId: intent.id, already: false, instructions: result.instructions };
  }
  // A real rail answered. 'confirmed' still goes through the confirmation
  // recorder so cash reconciliation happens in one place.
  const [u] = await run<Bill>(`UPDATE bills SET state = 'approved', payment_intent_id = $2, updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`, [bill.id, intent.id]);
  if (result.kind === "confirmed") {
    const conf = await recordManualPaymentConfirmation(run, { billId: bill.id, evidence: { method: rail.name, reference: result.providerRef, confirmedBy: "rail" }, principal: input.principal });
    if (conf.ok) return { ok: true, bill: conf.bill, outcome: "confirmed", intentId: intent.id, already: false };
  }
  return { ok: true, bill: normalize(u), outcome: result.kind === "accepted" ? "accepted" : "unknown", intentId: intent.id, already: false };
}

export interface PaymentEvidence {
  method: string; // check / ach / card / cash / rail name
  reference?: string | null;
  at?: string | null;
  fileId?: string | null;
  confirmedBy?: string;
  note?: string;
}

/** Mark a bill paid with evidence and reconcile its cash reservation. The
 *  only path to 'paid'. Idempotent. */
export async function recordManualPaymentConfirmation(
  run: Run,
  input: { billId: number; evidence: PaymentEvidence; principal: Principal },
): Promise<{ ok: true; bill: Bill; consumedCents: number; releasedCents: number; shortfallDecisionId: string | null; already: boolean } | { ok: false; reason: string }> {
  const bill = await getBill(run, input.billId, { forUpdate: true });
  if (!bill) return { ok: false, reason: "No such bill." };
  if (bill.state === "paid") return { ok: true, bill, consumedCents: 0, releasedCents: 0, shortfallDecisionId: null, already: true };
  if (bill.state !== "manual_pending" && bill.state !== "approved") return { ok: false, reason: `Bill is ${bill.state}; a payment must be approved before it can be confirmed.` };
  if (!input.evidence.method?.trim()) return { ok: false, reason: "Evidence needs at least the payment method (and ideally a reference)." };
  const evidence = { ...input.evidence, at: input.evidence.at ?? new Date().toISOString(), confirmedBy: input.evidence.confirmedBy ?? principalLabel(input.principal) };
  const paid = bill.payable_cents ?? bill.amount_cents;
  const [u] = await run<Bill>(`UPDATE bills SET state = 'paid', paid_evidence = $2::jsonb, paid_at = now(), updated_at = now() WHERE id = $1 RETURNING ${BILL_COLS}`, [bill.id, JSON.stringify(evidence)]);
  if (bill.payment_intent_id) await reconcileIntent(run, bill.payment_intent_id, { state: "confirmed", providerRef: evidence.reference ?? null, providerState: "manual_confirmed" });
  await run(`UPDATE work_items SET status = 'done', completed_at = now(), updated_at = now() WHERE source_kind = 'agent' AND source_id = $1 AND status NOT IN ('done','cancelled')`, [`bill:${bill.id}:manual-payment`]);

  let consumedCents = 0;
  let releasedCents = 0;
  let shortfallDecisionId: string | null = null;
  if (bill.commitment_id) {
    const c = await getCommitment(run, bill.commitment_id, { forUpdate: true });
    if (c) {
      const [paidRow] = await run<{ paid: string }>(`SELECT COALESCE(sum(COALESCE(payable_cents, amount_cents)), 0)::bigint AS paid FROM bills WHERE commitment_id = $1 AND state = 'paid'`, [c.id]);
      const totalPaid = Number(paidRow?.paid ?? 0);
      const complete = totalPaid >= c.total_cents && ["accepted", "payable", "paid", "delivered", "reviewed"].includes(c.state);
      const r = await consumeReservationOnPayment(run, { commitmentId: c.id, amountCents: paid, releaseRemainder: complete, note: `bill #${bill.id} paid` });
      consumedCents = r.consumedCents;
      releasedCents = r.releasedCents;
      if (complete) await run(`UPDATE commitments SET state = 'paid', updated_at = now() WHERE id = $1`, [c.id]);
      if (r.shortfallCents > 0) {
        const esc = await escalateShortfall(run, {
          projectId: c.project_id,
          amountCents: r.shortfallCents,
          purpose: `payment to ${c.payee_name} exceeded its reservation`,
          effect: `Bill #${bill.id} paid ${usd(paid)} against a reservation of ${usd(paid - r.shortfallCents)}; project cash is short by ${usd(r.shortfallCents)}.`,
          principal: input.principal,
          commitmentId: c.id,
        });
        shortfallDecisionId = esc.decision.id;
      }
    }
  }
  return { ok: true, bill: normalize(u), consumedCents, releasedCents, shortfallDecisionId, already: false };
}
