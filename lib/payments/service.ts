// Customer payment service (A20). Pure `run` / `tx` style.
//
// Invariants:
//   • the SERVER computes the chargeable amount = the invoice's verified open
//     balance (lib/billing invoiceBalance); the browser's amount/paid flag is
//     only ever compared against it (mismatch → "stale");
//   • one payment_attempt per (invoice, revision, client nonce) — the
//     intent_key — and the attempt's id is Square's idempotency key and
//     reference_id (squareKeyFor), so repeat taps, refreshes and retries
//     reuse the attempt and never create a second charge;
//   • one attempt maps to one invoice revision (deposits / installments are
//     separate invoices, so ACH's full-balance rule holds: every ACH attempt
//     pays a whole invoice balance under its own Square order; no partial ACH
//     against one order);
//   • provider state, not arrival order, decides the attempt state; a
//     duplicate or out-of-order webhook is a no-op;
//   • PENDING is never "paid": the ledger row is pending until Square says
//     COMPLETED; FAILED / returned later restores the balance via the ledger
//     without fabricating invoices;
//   • refunds run only after a consumed 'refund' decision bound to the
//     original payment + exact amount;
//   • a credit card pays a surcharge on top of the balance (surcharge.ts):
//     amount_cents is what Square charges, surcharge_cents the part never
//     credited to the invoice. A surcharged card is authorized first and only
//     completed once Square's own reading says it is a credit card — a debit
//     or prepaid card is voided, so it is never charged the surcharge.

import type { Run } from "../commands/core.ts";
import { runCommand } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { stageDecision, consumeDecision, contentHashOf } from "../commands/decisions.ts";
import { invoiceBalance, recordInvoicePayment, INVOICE_COLS, type InvoiceRow } from "../billing/core.ts";
import { ProviderDeclinedError, ProviderUnknownOutcomeError, type PaymentMethod, type SquareAdapter, type SquarePayment, type SquareRefund } from "./square/types.ts";
import type { Tx } from "../billing/commands.ts";
import { stagePaymentReceipt, type ReceiptOutcome } from "./receipt.ts";
import { stagePaymentAlert } from "./owner-alert.ts";
import { loadSurchargeConfig, surchargeCents, surchargeable, type CardFacts } from "./surcharge.ts";

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export type AttemptState = "created" | "pending" | "completed" | "failed" | "returned" | "refunded" | "disputed" | "unknown";

export interface AttemptRow {
  id: string;
  invoice_id: number;
  invoice_revision: number;
  intent_key: string;
  /** What Square charges: the invoice share + surcharge_cents. */
  amount_cents: number;
  /** Credit card surcharge inside amount_cents; never credited to the invoice. */
  surcharge_cents: number;
  card_brand: string | null;
  card_type: string | null;
  currency: string;
  method: PaymentMethod;
  provider: string;
  provider_payment_id: string | null;
  provider_order_id: string | null;
  provider_status: string | null;
  state: AttemptState;
  source_event_ids: string[];
  last_error: string | null;
  actor: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const ATTEMPT_COLS = `id, invoice_id::int AS invoice_id, invoice_revision, intent_key, amount_cents, surcharge_cents, card_brand, card_type, currency, method, provider, provider_payment_id,
  provider_order_id, provider_status, state, source_event_ids, last_error, actor, created_at::text AS created_at, updated_at::text AS updated_at,
  completed_at::text AS completed_at`;

export function intentKeyFor(invoiceId: number, revision: number, nonce: string): string {
  return `square:inv:${invoiceId}:rev${revision}:${nonce}`;
}

/** What Square sees as idempotency_key AND reference_id: the attempt's uuid.
 *  The intent_key runs ~55 characters; Square caps idempotency_key at 45 and
 *  reference_id at 40 (VALUE_TOO_LONG, first live charge 2026-10-10). One
 *  attempt per intent_key, so this is just as stable across retries. */
export function squareKeyFor(attempt: Pick<AttemptRow, "id">): string {
  return attempt.id;
}

/** The part of an attempt that pays the invoice (what the ledger records). */
export function invoiceShareCents(attempt: Pick<AttemptRow, "amount_cents" | "surcharge_cents">): number {
  return attempt.amount_cents - (attempt.surcharge_cents ?? 0);
}

/** Does a provider reference_id point at this attempt? Accepts the uuid and
 *  the old intent_key form (sandbox payments made before the change). */
function referencesAttempt(referenceId: string | null, attempt: Pick<AttemptRow, "id" | "intent_key">): boolean {
  return !!referenceId && (referenceId === squareKeyFor(attempt) || referenceId === attempt.intent_key);
}

export async function getAttempt(run: Run, id: string): Promise<AttemptRow | null> {
  const [r] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE id = $1`, [id]);
  return r ?? null;
}

export async function getAttemptByProviderId(run: Run, providerPaymentId: string): Promise<AttemptRow | null> {
  const [r] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE provider = 'square' AND provider_payment_id = $1`, [providerPaymentId]);
  return r ?? null;
}

// ── Prepare (server-computed amount, idempotent attempt) ───────────────────

export interface PrepareInput {
  invoiceId: number;
  method: PaymentMethod;
  /** Browser-generated once per invoice revision and kept in session storage. */
  nonce: string;
  /** What the browser displayed; must equal the verified balance. */
  expectedAmountCents?: number | null;
  expectedRevision?: number | null;
  /** The pay page's reading of the card (Web Payments SDK tokenize details). */
  card?: CardFacts | null;
  /** The surcharge the pay page showed; must equal the server's. */
  expectedSurchargeCents?: number | null;
  actor: Principal | string;
}

export type PrepareResult =
  | { ok: true; attempt: AttemptRow; invoice: InvoiceRow; reused: boolean }
  | { ok: false; code: "not_found" | "not_payable" | "nothing_due" | "stale" | "in_flight" | "bad_nonce"; reason: string };

export async function prepareAttempt(run: Run, input: PrepareInput): Promise<PrepareResult> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.nonce)) return { ok: false, code: "bad_nonce", reason: "Bad attempt nonce." };
  const [inv] = await run<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1 FOR UPDATE`, [input.invoiceId]);
  if (!inv) return { ok: false, code: "not_found", reason: "Invoice not found." };
  // Same tap / refresh / retry: the attempt already exists for this nonce.
  // Return it before any other check so a refresh after success shows the
  // completed attempt instead of "nothing due".
  const key = intentKeyFor(inv.id, inv.revision, input.nonce);
  const [existing] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE intent_key = $1 FOR UPDATE`, [key]);
  if (existing) return { ok: true, attempt: existing, invoice: inv, reused: true };
  if (inv.status === "paid") return { ok: false, code: "nothing_due", reason: `Invoice ${inv.number} is already paid.` };
  if (!["issued", "sent", "partially_paid"].includes(inv.status)) return { ok: false, code: "not_payable", reason: `Invoice ${inv.number} is ${inv.status.replace("_", " ")}; nothing to pay online.` };
  if (inv.exception_flags.includes("hold")) return { ok: false, code: "not_payable", reason: `Invoice ${inv.number} is on hold.` };
  const b = (await invoiceBalance(run, inv.id))!;
  if (b.balanceCents <= 0) return { ok: false, code: "nothing_due", reason: `Invoice ${inv.number} has no open balance.` };
  if (input.expectedRevision != null && Number(input.expectedRevision) !== Number(inv.revision)) return { ok: false, code: "stale", reason: "This invoice was revised after the page loaded. Reload to see the current version." };
  if (input.expectedAmountCents != null && Number(input.expectedAmountCents) !== b.balanceCents) return { ok: false, code: "stale", reason: "The amount due changed after the page loaded. Reload to see the current balance." };
  // Another attempt still in flight on this invoice (an ACH pending): no
  // second charge until it resolves.
  const [inflight] = await run<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE invoice_id = $1 AND state IN ('pending','unknown') LIMIT 1`,
    [inv.id],
  );
  if (inflight) return { ok: false, code: "in_flight", reason: `A ${inflight.method === "ach" ? "bank transfer" : "payment"} for this invoice is still processing. It will show here once it settles.` };
  const surcharge = input.method === "card" ? surchargeCents(b.balanceCents, await loadSurchargeConfig(run), input.card) : 0;
  if (input.expectedSurchargeCents != null && Number(input.expectedSurchargeCents) !== surcharge) return { ok: false, code: "stale", reason: "The card surcharge changed after the page loaded. Reload to see the current amount." };
  const card = input.method === "card" && input.card ? input.card : null;
  const [row] = await run<AttemptRow>(
    `INSERT INTO payment_attempts (invoice_id, invoice_revision, intent_key, amount_cents, surcharge_cents, card_brand, card_type, currency, method, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', $8, $9) RETURNING ${ATTEMPT_COLS}`,
    [inv.id, inv.revision, key, b.balanceCents + surcharge, surcharge, card?.brand ?? null, card?.cardType ?? null, input.method, typeof input.actor === "string" ? input.actor : principalLabel(input.actor)],
  );
  return { ok: true, attempt: row, invoice: inv, reused: false };
}

// ── Provider call (outside any transaction) ────────────────────────────────

export type ChargeOutcome = { kind: "payment"; payment: SquarePayment } | { kind: "declined"; code: string; reason: string } | { kind: "unknown"; reason: string };

/** Code a voided surcharged card comes back with: Square read it as debit /
 *  prepaid. The pay page retries once without the surcharge. */
export const SURCHARGE_MISMATCH = "SURCHARGE_CARD_MISMATCH";

export async function chargeAttempt(adapter: SquareAdapter, attempt: AttemptRow, opts: { sourceId: string; locationId: string; buyerEmail?: string | null; note?: string }): Promise<ChargeOutcome> {
  // A surcharged card is authorized only; finishSurchargedCard completes it
  // once Square confirms a credit card, or voids it.
  const authorizeOnly = attempt.method === "card" && attempt.surcharge_cents > 0;
  try {
    const payment = await adapter.createPayment({
      idempotencyKey: squareKeyFor(attempt),
      sourceId: opts.sourceId,
      amountCents: attempt.amount_cents,
      currency: attempt.currency,
      locationId: opts.locationId,
      method: attempt.method,
      referenceId: squareKeyFor(attempt),
      note: opts.note,
      buyerEmail: opts.buyerEmail ?? null,
      ...(authorizeOnly ? { autocomplete: false } : {}),
    });
    if (authorizeOnly && payment.status === "APPROVED") return await finishSurchargedCard(adapter, payment);
    return { kind: "payment", payment };
  } catch (err) {
    if (err instanceof ProviderDeclinedError) return { kind: "declined", code: err.code, reason: err.message };
    if (err instanceof ProviderUnknownOutcomeError) return { kind: "unknown", reason: err.message };
    return { kind: "unknown", reason: (err as Error).message };
  }
}

/** Complete an authorized surcharged card if Square reads it as a credit
 *  card; otherwise void it (debit / prepaid cards can't carry a surcharge)
 *  and report a decline — nothing was charged. Also used by the reconcile
 *  sweep for an authorization the checkout never finished. */
export async function finishSurchargedCard(adapter: SquareAdapter, payment: SquarePayment): Promise<ChargeOutcome> {
  try {
    if (surchargeable(payment.card)) return { kind: "payment", payment: await adapter.completePayment(payment.id) };
    await adapter.cancelPayment(payment.id);
    return {
      kind: "declined",
      code: SURCHARGE_MISMATCH,
      reason: "Square reads this as a debit or prepaid card, which doesn't carry the credit card surcharge.",
    };
  } catch (err) {
    if (err instanceof ProviderDeclinedError) return { kind: "unknown", reason: `finishing authorized payment ${payment.id}: ${err.message}` };
    return { kind: "unknown", reason: (err as Error).message };
  }
}

// ── Apply provider state (webhook, poll, or the create response) ───────────

const RANK: Record<AttemptState, number> = { created: 0, unknown: 0, pending: 1, completed: 2, failed: 2, returned: 3, refunded: 3, disputed: 3 };

function stateFor(current: AttemptState, status: SquarePayment["status"]): AttemptState | null {
  switch (status) {
    case "COMPLETED":
      return current === "completed" || RANK[current] > 2 ? null : "completed";
    case "PENDING":
    case "APPROVED":
      return RANK[current] >= 1 ? null : "pending";
    case "FAILED":
    case "CANCELED":
      if (current === "completed") return "returned"; // settled then reversed by the bank
      return RANK[current] >= 2 ? null : "failed";
    default:
      return null;
  }
}

export interface ApplyResult {
  attempt: AttemptRow;
  changed: boolean;
  from: AttemptState;
  to: AttemptState;
  /** Set when this call moved the attempt to completed (lib/payments/receipt.ts). */
  receipt?: ReceiptOutcome;
  /** push_outbox row telling Joe about this transition (lib/payments/owner-alert.ts);
   *  the caller sends it after commit with sendOwnerPushesNow. */
  ownerPushId?: string;
}

/** Idempotent: the same provider state applied twice (duplicate webhook,
 *  poll after webhook) changes nothing; an older state arriving late is
 *  ignored. Ledger rows key on the provider payment id. */
export async function applyProviderPayment(run: Run, input: { attemptId?: string | null; payment: SquarePayment; sourceEventId?: string | null; actor: Principal | string }): Promise<ApplyResult | null> {
  let attempt: AttemptRow | null = null;
  if (input.attemptId) attempt = await getAttempt(run, input.attemptId);
  if (!attempt) attempt = await getAttemptByProviderId(run, input.payment.id);
  if (!attempt && input.payment.referenceId) {
    const [r] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE id::text = $1 OR intent_key = $1 LIMIT 1`, [input.payment.referenceId]);
    attempt = r ?? null;
  }
  if (!attempt) return null;
  const [locked] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attempt.id]);
  attempt = locked;
  const who = typeof input.actor === "string" ? input.actor : principalLabel(input.actor);
  if (input.payment.amountCents !== attempt.amount_cents) {
    await run(`UPDATE payment_attempts SET last_error = $2, state = 'disputed' WHERE id = $1 AND state NOT IN ('completed','refunded')`, [attempt.id, `provider amount ${input.payment.amountCents} ≠ attempt ${attempt.amount_cents}`]);
    return { attempt: (await getAttempt(run, attempt.id))!, changed: true, from: attempt.state, to: "disputed" };
  }
  // An APPROVED card is a surcharged authorization still being checked
  // (finishSurchargedCard): not money yet, and not worth a "pending" row.
  const next = input.payment.status === "APPROVED" && attempt.method === "card" ? null : stateFor(attempt.state, input.payment.status);
  // Always record ids/status/event evidence even when the state does not move.
  await run(
    `UPDATE payment_attempts
        SET provider_payment_id = COALESCE(provider_payment_id, $2), provider_order_id = COALESCE(provider_order_id, $3), provider_status = $4,
            source_event_ids = CASE WHEN $5::uuid IS NULL OR $5::uuid = ANY(source_event_ids) THEN source_event_ids ELSE array_append(source_event_ids, $5::uuid) END,
            card_brand = COALESCE($6, card_brand), card_type = COALESCE($7, card_type)
      WHERE id = $1`,
    [attempt.id, input.payment.id, input.payment.orderId, input.payment.status, input.sourceEventId ?? null, input.payment.card?.brand ?? null, input.payment.card?.cardType ?? null],
  );
  if (!next) return { attempt: (await getAttempt(run, attempt.id))!, changed: false, from: attempt.state, to: attempt.state };

  const method = attempt.method;
  const refCommon = { invoiceId: attempt.invoice_id, method, provider: "square", principal: typeof input.actor === "string" ? ({ kind: "service", name: input.actor } as Principal) : input.actor };
  // The ledger credits the invoice share only; a credit card surcharge is
  // carried on the row's external_sync and on the attempt.
  const share = invoiceShareCents(attempt);
  const surchargeNote = attempt.surcharge_cents > 0 ? ` (charged ${usd(attempt.amount_cents)} incl. ${usd(attempt.surcharge_cents)} credit card surcharge)` : "";
  const sync = {
    square: { payment_id: input.payment.id, order_id: input.payment.orderId, fee_cents: input.payment.feeCents, receipt_url: input.payment.receiptUrl },
    ...(attempt.surcharge_cents > 0 ? { charged_cents: attempt.amount_cents, card_surcharge_cents: attempt.surcharge_cents } : {}),
  };
  if (next === "pending") {
    await recordInvoicePayment(run, { ...refCommon, kind: "payment", amountCents: share, providerRef: input.payment.id, status: "pending", externalSync: sync, note: `Square ${method} pending${surchargeNote}` });
  } else if (next === "completed") {
    await recordInvoicePayment(run, { ...refCommon, kind: "payment", amountCents: share, providerRef: input.payment.id, status: "settled", externalSync: sync, receivedAt: input.payment.updatedAt, note: `Square ${method}${surchargeNote}` });
  } else if (next === "failed") {
    // A pending ledger row (ACH) flips to failed; a card that never completed has no row.
    await run(`UPDATE invoice_payments SET status = 'failed' WHERE provider = 'square' AND provider_ref = $1 AND status = 'pending'`, [input.payment.id]);
  } else if (next === "returned") {
    await recordInvoicePayment(run, { ...refCommon, kind: "return", amountCents: share, providerRef: `${input.payment.id}:return`, status: "settled", externalSync: { ...sync, original_payment_id: input.payment.id }, note: `Square ${method} returned by the bank` });
  }
  const [updated] = await run<AttemptRow>(
    `UPDATE payment_attempts SET state = $2, completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
            last_error = CASE WHEN $2 IN ('failed','returned') THEN COALESCE($3, last_error) ELSE last_error END
      WHERE id = $1 RETURNING ${ATTEMPT_COLS}`,
    [attempt.id, next, `provider status ${input.payment.status}`],
  );
  // Recompute cash status happened inside recordInvoicePayment; for 'failed'
  // there may have been no row, so nothing to recompute.
  void who;
  let receipt: ReceiptOutcome | undefined;
  if (next === "completed") {
    // The client's receipt email. Under a savepoint: a receipt problem must
    // never undo the payment we just recorded.
    await run(`SAVEPOINT payment_receipt`);
    try {
      receipt = await stagePaymentReceipt(run, { attemptId: attempt.id, invoiceId: attempt.invoice_id, amountCents: attempt.amount_cents, surchargeCents: attempt.surcharge_cents, method, receiptUrl: input.payment.receiptUrl, principal: refCommon.principal });
      await run(`RELEASE SAVEPOINT payment_receipt`);
    } catch (err) {
      await run(`ROLLBACK TO SAVEPOINT payment_receipt`);
      receipt = { staged: "skipped", reason: `receipt not staged: ${(err as Error).message}`.slice(0, 300) };
    }
  }
  let ownerPushId: string | null = null;
  if (next === "completed" || next === "pending" || next === "returned") {
    // Joe's "you got paid" alert. Same savepoint rule as the receipt.
    await run(`SAVEPOINT payment_owner_alert`);
    try {
      ownerPushId = await stagePaymentAlert(run, { attemptId: attempt.id, invoiceId: attempt.invoice_id, amountCents: attempt.amount_cents, surchargeCents: attempt.surcharge_cents, method, state: next });
      await run(`RELEASE SAVEPOINT payment_owner_alert`);
    } catch (err) {
      await run(`ROLLBACK TO SAVEPOINT payment_owner_alert`);
      console.error("[payments] owner alert not staged:", (err as Error).message);
    }
  }
  return { attempt: updated, changed: true, from: attempt.state, to: next, ...(receipt ? { receipt } : {}), ...(ownerPushId ? { ownerPushId } : {}) };
}

export async function markAttemptDeclined(run: Run, attemptId: string, code: string, reason: string): Promise<AttemptRow> {
  const [r] = await run<AttemptRow>(
    `UPDATE payment_attempts SET state = 'failed', last_error = $2 WHERE id = $1 AND state IN ('created','unknown') RETURNING ${ATTEMPT_COLS}`,
    [attemptId, `${code}: ${reason}`.slice(0, 500)],
  );
  return r ?? (await getAttempt(run, attemptId))!;
}

export async function markAttemptUnknown(run: Run, attemptId: string, reason: string): Promise<AttemptRow> {
  const [r] = await run<AttemptRow>(
    `UPDATE payment_attempts SET state = 'unknown', last_error = $2 WHERE id = $1 AND state = 'created' RETURNING ${ATTEMPT_COLS}`,
    [attemptId, reason.slice(0, 500)],
  );
  return r ?? (await getAttempt(run, attemptId))!;
}

// ── Webhook payload → SquarePayment ────────────────────────────────────────

export interface SquareWebhookEnvelope {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
}

export function paymentFromWebhook(payload: SquareWebhookEnvelope): SquarePayment | null {
  const p = payload.data?.object?.payment as Record<string, unknown> | undefined;
  if (!p || typeof p.id !== "string" || typeof p.status !== "string") return null;
  const money = p.amount_money as { amount?: number; currency?: string } | undefined;
  const fees = (p.processing_fee as { amount_money?: { amount?: number } }[] | undefined) ?? [];
  const card = (p.card_details as { card?: { card_brand?: string; card_type?: string; prepaid_type?: string } } | undefined)?.card;
  return {
    id: p.id,
    status: p.status as SquarePayment["status"],
    amountCents: Number(money?.amount ?? 0),
    currency: money?.currency ?? "USD",
    method: p.source_type === "BANK_ACCOUNT" ? "ach" : "card",
    referenceId: typeof p.reference_id === "string" ? p.reference_id : null,
    orderId: typeof p.order_id === "string" ? p.order_id : null,
    receiptUrl: typeof p.receipt_url === "string" ? p.receipt_url : null,
    feeCents: fees.length ? fees.reduce((s, f) => s + Number(f.amount_money?.amount ?? 0), 0) : null,
    refundedCents: Number((p.refunded_money as { amount?: number } | undefined)?.amount ?? 0),
    refundIds: Array.isArray(p.refund_ids) ? (p.refund_ids as string[]) : [],
    card: card ? { brand: card.card_brand ?? null, cardType: card.card_type ?? null, prepaidType: card.prepaid_type ?? null } : null,
    createdAt: typeof p.created_at === "string" ? p.created_at : new Date().toISOString(),
    updatedAt: typeof p.updated_at === "string" ? p.updated_at : new Date().toISOString(),
  };
}

export function refundFromWebhook(payload: SquareWebhookEnvelope): SquareRefund | null {
  const r = payload.data?.object?.refund as Record<string, unknown> | undefined;
  if (!r || typeof r.id !== "string" || typeof r.payment_id !== "string") return null;
  const money = r.amount_money as { amount?: number } | undefined;
  return { id: r.id, paymentId: r.payment_id, status: (r.status as SquareRefund["status"]) ?? "PENDING", amountCents: Number(money?.amount ?? 0), createdAt: typeof r.created_at === "string" ? r.created_at : new Date().toISOString() };
}

export interface SquareDispute {
  id: string;
  paymentId: string;
  /** Square's dispute state: EVIDENCE_REQUIRED, PROCESSING, WON, LOST, ACCEPTED, INQUIRY_* … */
  state: string;
  amountCents: number;
  reason: string | null;
  dueAt: string | null;
}

export function disputeFromWebhook(payload: SquareWebhookEnvelope): SquareDispute | null {
  const d = payload.data?.object?.dispute as Record<string, unknown> | undefined;
  if (!d) return null;
  const id = typeof d.id === "string" ? d.id : typeof d.dispute_id === "string" ? d.dispute_id : null;
  const paymentId = (d.disputed_payment as { payment_id?: string } | undefined)?.payment_id ?? (typeof d.payment_id === "string" ? d.payment_id : null);
  if (!id || !paymentId || typeof d.state !== "string") return null;
  return {
    id,
    paymentId,
    state: d.state,
    amountCents: Number((d.amount_money as { amount?: number } | undefined)?.amount ?? 0),
    reason: typeof d.reason === "string" ? d.reason : null,
    dueAt: typeof d.due_at === "string" ? d.due_at : null,
  };
}

const DISPUTE_WON = new Set(["WON", "INQUIRY_CLOSED"]);
const DISPUTE_LOST = new Set(["LOST", "ACCEPTED"]);

/** A card dispute (chargeback) from Square. Open → the payment reads
 *  disputed and Joe is told to answer it in Square. Won → it stands again.
 *  Lost / accepted → the card company took the money back: a 'return' on
 *  the invoice (the invoice share, like a refund), and the balance re-opens.
 *  Idempotent per dispute id + outcome. */
export async function applyProviderDispute(run: Run, input: { dispute: SquareDispute; actor: Principal | string }): Promise<{ state: string; changed: boolean; ownerPushId?: string } | null> {
  const found = await getAttemptByProviderId(run, input.dispute.paymentId);
  if (!found) return null;
  const [a] = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE id = $1 FOR UPDATE`, [found.id]);
  const principal: Principal = typeof input.actor === "string" ? { kind: "service", name: input.actor } : input.actor;
  const dz = input.dispute;
  const amount = dz.amountCents || a.amount_cents;
  const alert = async (state: "disputed" | "dispute_won" | "dispute_lost", detail?: string | null) => {
    await run(`SAVEPOINT dispute_alert`);
    try {
      const id = await stagePaymentAlert(run, { attemptId: a.id, invoiceId: a.invoice_id, amountCents: amount, method: a.method, state, detail, eventKey: dz.id });
      await run(`RELEASE SAVEPOINT dispute_alert`);
      return id ?? undefined;
    } catch (err) {
      await run(`ROLLBACK TO SAVEPOINT dispute_alert`);
      console.error("[payments] dispute alert not staged:", (err as Error).message);
      return undefined;
    }
  };
  if (DISPUTE_LOST.has(dz.state)) {
    const invoicePart = a.surcharge_cents > 0 ? Math.round((amount * invoiceShareCents(a)) / a.amount_cents) : amount;
    const before = await run<{ n: number }>(`SELECT count(*)::int AS n FROM invoice_payments WHERE provider = 'square' AND provider_ref = $1`, [`${dz.id}:chargeback`]);
    if (Number(before[0].n) > 0) return { state: "lost", changed: false };
    await recordInvoicePayment(run, {
      invoiceId: a.invoice_id,
      kind: "return",
      amountCents: invoicePart,
      method: a.method,
      provider: "square",
      providerRef: `${dz.id}:chargeback`,
      status: "settled",
      principal,
      externalSync: { square: { dispute_id: dz.id, payment_id: dz.paymentId, state: dz.state } },
      note: `Card dispute ${dz.state === "ACCEPTED" ? "accepted" : "lost"}${dz.reason ? ` (${dz.reason.toLowerCase().replace(/_/g, " ")})` : ""}`,
    });
    await run(`UPDATE payment_attempts SET state = 'returned', last_error = $2 WHERE id = $1`, [a.id, `dispute ${dz.id} ${dz.state}`]);
    return { state: "lost", changed: true, ownerPushId: await alert("dispute_lost") };
  }
  if (DISPUTE_WON.has(dz.state)) {
    if (a.state !== "disputed") return { state: "won", changed: false };
    await run(`UPDATE payment_attempts SET state = 'completed', last_error = NULL WHERE id = $1`, [a.id]);
    return { state: "won", changed: true, ownerPushId: await alert("dispute_won") };
  }
  // Still open (evidence required, processing, inquiry): money is held, not lost.
  if (a.state !== "completed" && a.state !== "refunded") return { state: "open", changed: false };
  await run(`UPDATE payment_attempts SET state = 'disputed', last_error = $2 WHERE id = $1`, [a.id, `dispute ${dz.id} ${dz.state}`]);
  const due = dz.dueAt ? `answer by ${dz.dueAt.slice(0, 10)}` : null;
  const why = dz.reason ? dz.reason.toLowerCase().replace(/_/g, " ") : null;
  return { state: "open", changed: true, ownerPushId: await alert("disputed", [why, due].filter(Boolean).join(" · ") || null) };
}

/** Process one verified Square event (already persisted in source_events). */
export async function processSquareEvent(run: Run, input: { payload: SquareWebhookEnvelope; sourceEventId: string }): Promise<{ handled: string; changed: boolean; receiptIntentId?: string; ownerPushId?: string }> {
  const type = payload(input.payload.type);
  if (type.startsWith("payment.")) {
    const p = paymentFromWebhook(input.payload);
    if (!p) return { handled: "ignored:malformed", changed: false };
    const r = await applyProviderPayment(run, { payment: p, sourceEventId: input.sourceEventId, actor: "webhook:square" });
    if (!r) return { handled: "ignored:unknown_payment", changed: false };
    return { handled: `payment:${r.from}->${r.to}`, changed: r.changed, ...(r.receipt?.staged === "intent" ? { receiptIntentId: r.receipt.intentId } : {}), ...(r.ownerPushId ? { ownerPushId: r.ownerPushId } : {}) };
  }
  if (type.startsWith("refund.")) {
    const rf = refundFromWebhook(input.payload);
    if (!rf) return { handled: "ignored:malformed", changed: false };
    const r = await applyProviderRefund(run, { refund: rf, actor: "webhook:square" });
    return { handled: `refund:${r ? r.state : "unknown_payment"}`, changed: !!r?.changed, ...(r?.ownerPushId ? { ownerPushId: r.ownerPushId } : {}) };
  }
  if (type.startsWith("dispute.")) {
    const dz = disputeFromWebhook(input.payload);
    if (!dz) return { handled: "ignored:malformed", changed: false };
    const r = await applyProviderDispute(run, { dispute: dz, actor: "webhook:square" });
    return { handled: `dispute:${r ? r.state : "unknown_payment"}`, changed: !!r?.changed, ...(r?.ownerPushId ? { ownerPushId: r.ownerPushId } : {}) };
  }
  return { handled: `ignored:${type || "untyped"}`, changed: false };
}

function payload(t: unknown): string {
  return typeof t === "string" ? t : "";
}

// ── Reconciliation (poll pending / unknown; stale escalation) ──────────────

export interface ReconcileSummary {
  checked: number;
  changed: number;
  stale: number;
  unresolved: number;
  /** Owner alerts staged this sweep, for sendOwnerPushesNow after commit. */
  ownerPushIds: string[];
}

export async function reconcilePendingAttempts(run: Run, adapter: SquareAdapter, opts: { staleAfterHours?: number; principal?: Principal; now?: Date } = {}): Promise<ReconcileSummary> {
  const staleAfter = opts.staleAfterHours ?? 72;
  const now = opts.now ?? new Date();
  const principal: Principal = opts.principal ?? { kind: "service", name: "cron:payments-reconcile" };
  const rows = await run<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE state IN ('created','pending','unknown') ORDER BY created_at`);
  const out: ReconcileSummary = { checked: 0, changed: 0, stale: 0, unresolved: 0, ownerPushIds: [] };
  for (const a of rows) {
    out.checked++;
    let payment: SquarePayment | null = null;
    if (a.provider_payment_id) payment = await adapter.getPayment(a.provider_payment_id);
    else {
      const since = new Date(new Date(a.created_at).getTime() - 5 * 60_000).toISOString();
      payment = (await adapter.listPaymentsSince(since)).find((p) => referencesAttempt(p.referenceId, a)) ?? null;
    }
    if (payment && payment.status === "APPROVED" && a.method === "card" && a.surcharge_cents > 0) {
      // A surcharged authorization the checkout never finished (crash or
      // lost response between authorize and complete): finish it now.
      const done = await finishSurchargedCard(adapter, payment);
      if (done.kind === "payment") payment = done.payment;
      else if (done.kind === "declined") {
        await markAttemptDeclined(run, a.id, done.code, done.reason);
        await run(`UPDATE payment_attempts SET provider_payment_id = COALESCE(provider_payment_id, $2), provider_status = 'CANCELED' WHERE id = $1`, [a.id, payment.id]);
        out.changed++;
        continue;
      } else {
        out.unresolved++;
        continue;
      }
    }
    if (payment) {
      const r = await applyProviderPayment(run, { attemptId: a.id, payment, actor: principal });
      if (r?.changed) out.changed++;
      if (r?.ownerPushId) out.ownerPushIds.push(r.ownerPushId);
      if (r && r.to === "pending") await maybeEscalateStale(run, r.attempt, staleAfter, now, principal, out);
      continue;
    }
    const ageHours = (now.getTime() - new Date(a.created_at).getTime()) / 3_600_000;
    if (a.state === "created" && ageHours >= 1) {
      // Never reached Square (or Square never recorded it): safe to fail.
      await run(`UPDATE payment_attempts SET state = 'failed', last_error = 'no provider record after 1h' WHERE id = $1 AND state = 'created'`, [a.id]);
      out.changed++;
    } else if (a.state === "unknown") {
      await maybeEscalateStale(run, a, Math.min(staleAfter, 24), now, principal, out);
      out.unresolved++;
    } else out.unresolved++;
  }
  await sweepSettledAttempts(run, adapter, { principal, now, out });
  return out;
}

/** After completion Square can still move money: a bank return on an ACH, a
 *  refund made in the Square Dashboard, or a webhook that never arrived.
 *  Re-read recent completed payments (90 days) and apply what changed. A
 *  provider error on one payment skips it; the next sweep tries again. */
async function sweepSettledAttempts(run: Run, adapter: SquareAdapter, ctx: { principal: Principal; now: Date; out: ReconcileSummary }): Promise<void> {
  const since = new Date(ctx.now.getTime() - 90 * 86_400_000).toISOString();
  const rows = await run<AttemptRow>(
    `SELECT ${ATTEMPT_COLS} FROM payment_attempts WHERE state IN ('completed','refunded') AND provider_payment_id IS NOT NULL AND COALESCE(completed_at, created_at) >= $1 ORDER BY completed_at`,
    [since],
  );
  for (const a of rows) {
    ctx.out.checked++;
    let payment: SquarePayment | null;
    try {
      payment = await adapter.getPayment(a.provider_payment_id!);
    } catch (err) {
      console.error(`[payments] late check of ${a.provider_payment_id} failed:`, (err as Error).message);
      continue;
    }
    if (!payment) continue;
    if (payment.status === "FAILED" || payment.status === "CANCELED") {
      const r = await applyProviderPayment(run, { attemptId: a.id, payment, actor: ctx.principal });
      if (r?.changed) ctx.out.changed++;
      if (r?.ownerPushId) ctx.out.ownerPushIds.push(r.ownerPushId);
      continue;
    }
    const [{ n: recorded }] = await run<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoice_payments WHERE provider = 'square' AND kind = 'refund' AND external_sync->'square'->>'payment_id' = $1`,
      [payment.id],
    );
    if (!payment.refundedCents || (payment.refundIds ?? []).length <= Number(recorded)) continue;
    for (const refundId of payment.refundIds ?? []) {
      const rf = await adapter.getRefund(refundId).catch(() => null);
      if (!rf) continue;
      const r = await applyProviderRefund(run, { refund: rf, actor: ctx.principal });
      if (r?.changed) ctx.out.changed++;
      if (r?.ownerPushId) ctx.out.ownerPushIds.push(r.ownerPushId);
    }
  }
}

async function maybeEscalateStale(run: Run, a: AttemptRow, staleAfterHours: number, now: Date, principal: Principal, out: ReconcileSummary) {
  const ageHours = (now.getTime() - new Date(a.created_at).getTime()) / 3_600_000;
  if (ageHours < staleAfterHours) return;
  const { created } = await stageDecision(run, {
    kind: "payment_stale",
    action: "payment.review_stale",
    title: `Payment ${a.method === "ach" ? "bank transfer" : "card"} for invoice #${a.invoice_id} has been ${a.state} for ${Math.floor(ageHours)}h`,
    summary: { effect: "Reminders stay paused while it is pending. Check Square, then mark it or contact the client.", gaps: [a.last_error ?? "no provider error"] },
    targetKind: "payment_attempt",
    targetId: a.id,
    amountCents: a.amount_cents,
    dedupeKey: `payment:${a.id}:stale`,
    requestedBy: principal,
    content: { attemptId: a.id, state: a.state },
    projectId: (await run<{ project_id: string }>(`SELECT project_id FROM invoices WHERE id = $1`, [a.invoice_id]))[0]?.project_id ?? null,
  });
  if (created) out.stale++;
}

// ── Refunds: one-tap decision, then execute ────────────────────────────────

export interface RefundRow {
  id: string;
  payment_attempt_id: string;
  amount_cents: number;
  reason: string;
  decision_id: string;
  provider_ref: string | null;
  state: "requested" | "pending" | "completed" | "failed" | "unknown";
  last_error: string | null;
}

const REFUND_COLS = `id, payment_attempt_id, amount_cents, reason, decision_id, provider_ref, state, last_error`;

export async function refundableCents(run: Run, attemptId: string): Promise<{ attempt: AttemptRow; refundable: number } | null> {
  const a = await getAttempt(run, attemptId);
  if (!a) return null;
  if (a.state !== "completed" && a.state !== "refunded") return { attempt: a, refundable: 0 };
  const [{ n }] = await run<{ n: number }>(`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM refunds WHERE payment_attempt_id = $1 AND state IN ('requested','pending','completed','unknown')`, [attemptId]);
  return { attempt: a, refundable: Math.max(0, a.amount_cents - Number(n)) };
}

export async function stageRefundDecision(run: Run, input: { attemptId: string; amountCents: number; reason: string; principal: Principal }) {
  const r = await refundableCents(run, input.attemptId);
  if (!r) throw new Error("No such payment.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Refund must be a positive whole number of cents.");
  if (input.amountCents > r.refundable) throw new Error(`Only ${r.refundable} cents are refundable on this payment.`);
  const [inv] = await run<{ project_id: string; number: string }>(`SELECT project_id, number FROM invoices WHERE id = $1`, [r.attempt.invoice_id]);
  return stageDecision(run, {
    kind: "refund",
    action: "payment.refund",
    title: `Refund ${input.amountCents} cents of the ${r.attempt.method} payment on invoice ${inv?.number ?? r.attempt.invoice_id}`,
    summary: { effect: "Square refunds to the original method; the invoice balance re-opens by the same amount.", assumptions: [input.reason] },
    targetKind: "payment_attempt",
    targetId: input.attemptId,
    amountCents: input.amountCents,
    projectId: inv?.project_id ?? null,
    dedupeKey: `refund:${input.attemptId}:${input.amountCents}`,
    requestedBy: input.principal,
    content: { attemptId: input.attemptId, amountCents: input.amountCents, providerPaymentId: r.attempt.provider_payment_id },
  });
}

/** `payment.refund` command: consumes the approved decision (exact attempt +
 *  amount), records the refund, calls the provider AFTER commit with the
 *  refund id as idempotency key, then records the provider's answer. */
export async function executeRefund(tx: Tx, adapter: SquareAdapter, input: { decisionId: string; principal: Principal }): Promise<{ ok: true; refund: RefundRow } | { ok: false; reason: string }> {
  const decision = await tx((run) => run<{ id: string; target_id: string | null; amount_cents: string | null; content_hash: string | null; status: string }>(`SELECT id, target_id, amount_cents::text AS amount_cents, content_hash, status FROM decisions WHERE id = $1 AND kind = 'refund'`, [input.decisionId]));
  const d = decision[0];
  if (!d) return { ok: false, reason: "No such refund decision." };
  if (!d.target_id || d.amount_cents == null) return { ok: false, reason: "The refund decision is not bound to a payment and amount." };
  const attemptId = d.target_id;
  const amount = Number(d.amount_cents);
  try {
    const out = await runCommand(
      tx,
      { name: "payment.refund", requestKey: `refund:${d.id}`, input: { attemptId, amountCents: amount }, principal: input.principal, authRef: `decision:${d.id}` },
      async ({ run }) => {
        const r = await refundableCents(run, attemptId);
        if (!r || !r.attempt.provider_payment_id) throw new Error("The original payment has no provider record to refund against.");
        if (amount > r.refundable) throw new Error(`Only ${r.refundable} cents are refundable now.`);
        const c = await consumeDecision(run, {
          id: d.id,
          action: "payment.refund",
          amountCents: amount,
          targetKind: "payment_attempt",
          targetId: attemptId,
          contentHash: contentHashOf({ attemptId, amountCents: amount, providerPaymentId: r.attempt.provider_payment_id }),
          consumer: "payment.refund",
        });
        if (!c.ok) throw new Error(c.reason);
        const [row] = await run<RefundRow>(
          `INSERT INTO refunds (payment_attempt_id, amount_cents, reason, decision_id, actor) VALUES ($1, $2, $3, $4, $5) RETURNING ${REFUND_COLS}`,
          [attemptId, amount, "owner-approved refund", d.id, principalLabel(input.principal)],
        );
        const providerPaymentId = r.attempt.provider_payment_id;
        return {
          result: { refundId: row.id },
          afterCommit: [
            async () => {
              let outcome: { refund?: SquareRefund; error?: string; unknown?: boolean };
              try {
                outcome = { refund: await adapter.createRefund({ idempotencyKey: row.id, paymentId: providerPaymentId, amountCents: amount, currency: "USD", reason: "owner-approved refund" }) };
              } catch (err) {
                outcome = err instanceof ProviderUnknownOutcomeError ? { unknown: true, error: err.message } : { error: (err as Error).message };
              }
              await tx((run2) => applyRefundOutcome(run2, row.id, outcome, input.principal));
            },
          ],
        };
      },
    );
    const refund = await tx((run) => run<RefundRow>(`SELECT ${REFUND_COLS} FROM refunds WHERE id = $1`, [out.result.refundId]));
    return { ok: true, refund: refund[0] };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

async function applyRefundOutcome(run: Run, refundId: string, outcome: { refund?: SquareRefund; error?: string; unknown?: boolean }, principal: Principal): Promise<void> {
  const [rf] = await run<RefundRow>(`SELECT ${REFUND_COLS} FROM refunds WHERE id = $1 FOR UPDATE`, [refundId]);
  if (!rf) return;
  if (outcome.refund) {
    await run(`UPDATE refunds SET provider_ref = $2, state = $3, last_error = NULL WHERE id = $1`, [refundId, outcome.refund.id, outcome.refund.status === "COMPLETED" ? "completed" : outcome.refund.status === "PENDING" ? "pending" : "failed"]);
    if (outcome.refund.status === "COMPLETED") await settleRefund(run, rf, outcome.refund, principal);
  } else if (outcome.unknown) {
    await run(`UPDATE refunds SET state = 'unknown', last_error = $2 WHERE id = $1`, [refundId, outcome.error ?? "unknown"]);
  } else {
    await run(`UPDATE refunds SET state = 'failed', last_error = $2 WHERE id = $1`, [refundId, outcome.error ?? "failed"]);
  }
}

async function settleRefund(run: Run, rf: RefundRow, refund: SquareRefund, principal: Principal): Promise<void> {
  const a = await getAttempt(run, rf.payment_attempt_id);
  if (!a) return;
  // A surcharged payment refunds the surcharge in proportion; only the
  // invoice share of the refund re-opens the invoice.
  const invoicePart = a.surcharge_cents > 0 ? Math.round((refund.amountCents * invoiceShareCents(a)) / a.amount_cents) : refund.amountCents;
  await recordInvoicePayment(run, {
    invoiceId: a.invoice_id,
    kind: "refund",
    amountCents: invoicePart,
    method: a.method,
    provider: "square",
    providerRef: refund.id,
    status: "settled",
    principal,
    externalSync: { square: { refund_id: refund.id, payment_id: refund.paymentId } },
    note: "Square refund",
  });
  const r = await refundableCents(run, a.id);
  if (r && r.refundable === 0) await run(`UPDATE payment_attempts SET state = 'refunded' WHERE id = $1 AND state = 'completed'`, [a.id]);
}

/** A refund event from Square (ours confirming, or one made in the Square
 *  dashboard). Idempotent on the refund id. */
export async function applyProviderRefund(run: Run, input: { refund: SquareRefund; actor: Principal | string }): Promise<{ state: string; changed: boolean; ownerPushId?: string } | null> {
  const a = await getAttemptByProviderId(run, input.refund.paymentId);
  if (!a) return null;
  const principal: Principal = typeof input.actor === "string" ? { kind: "service", name: input.actor } : input.actor;
  const [ours] = await run<RefundRow>(`SELECT ${REFUND_COLS} FROM refunds WHERE provider_ref = $1 FOR UPDATE`, [input.refund.id]);
  if (input.refund.status !== "COMPLETED") {
    if (ours) await run(`UPDATE refunds SET state = $2 WHERE id = $1 AND state IN ('requested','pending','unknown')`, [ours.id, input.refund.status === "PENDING" ? "pending" : "failed"]);
    return { state: input.refund.status.toLowerCase(), changed: !!ours };
  }
  if (ours && ours.state !== "completed") await run(`UPDATE refunds SET state = 'completed' WHERE id = $1`, [ours.id]);
  const before = await run<{ n: number }>(`SELECT count(*)::int AS n FROM invoice_payments WHERE provider = 'square' AND provider_ref = $1`, [input.refund.id]);
  await settleRefund(run, ours ?? { id: "", payment_attempt_id: a.id, amount_cents: input.refund.amountCents, reason: "", decision_id: "", provider_ref: input.refund.id, state: "completed", last_error: null }, input.refund, principal);
  const changed = Number(before[0].n) === 0;
  // A refund nobody asked for in SJC OS (made in the Square Dashboard) is news.
  let ownerPushId: string | undefined;
  if (changed && !ours) {
    await run(`SAVEPOINT refund_alert`);
    try {
      ownerPushId = (await stagePaymentAlert(run, { attemptId: a.id, invoiceId: a.invoice_id, amountCents: input.refund.amountCents, method: a.method, state: "refunded_outside", eventKey: input.refund.id })) ?? undefined;
      await run(`RELEASE SAVEPOINT refund_alert`);
    } catch (err) {
      await run(`ROLLBACK TO SAVEPOINT refund_alert`);
      console.error("[payments] refund alert not staged:", (err as Error).message);
    }
  }
  return { state: "completed", changed, ...(ownerPushId ? { ownerPushId } : {}) };
}
