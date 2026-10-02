// Billing service boundary (A07a / A07b). Pure `run` style — no server-only
// import, so tests/billing-db.test.mjs drives it against the disposable
// harness; lib/actions/money.ts and lib/billing/commands.ts wrap it.
//
// Rules (DESIGN.md "Financial identity and ownership"):
//   • one live invoice per (project, economic_key) — a replayed or concurrent
//     issue returns the same row; the row lock on invoice_numbers serializes
//     issuers per project so numbers have no gaps and no duplicates;
//   • issued amount, delivery, cash and external sync are separate facts;
//   • balance = amount − settled payments − credits/write-offs + refunds/returns;
//   • issued rows are corrected by void/credit/revision with audit, never
//     deleted or renumbered;
//   • due_at only from verified terms; unknown → NULL + `terms_unknown`.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { stageDecision } from "../commands/decisions.ts";
import { parseNetTerms, addDaysIso } from "./terms.ts";

export type InvoiceStatus = "draft" | "issued" | "sent" | "partially_paid" | "paid" | "void" | "disputed";
export type DeliveryState = "none" | "queued" | "accepted" | "delivered" | "failed" | "unknown";
export type PaymentKind = "payment" | "credit" | "refund" | "return" | "writeoff";
export type PaymentStatus = "pending" | "settled" | "failed" | "returned";
export type InvoiceSource = "manual" | "draw" | "acceptance" | "progress" | "final";

export interface InvoiceLine {
  label: string;
  amount: number;
}

export interface InvoiceRow {
  id: number;
  project_id: string;
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  status: InvoiceStatus;
  economic_key: string | null;
  revision: number;
  issued_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  superseded_by: number | null;
  delivery_state: DeliveryState;
  delivery_error: string | null;
  send_intent_id: string | null;
  due_at: string | null;
  terms: string | null;
  estimate_id: number | null;
  change_order_id: number | null;
  contract_signature_request_id: number | null;
  source: string;
  exception_flags: string[];
  external_ref: Record<string, unknown>;
  created_at: string;
}

export const INVOICE_COLS = `id::int AS id, project_id, number, milestone, amount, line_items, status, economic_key, revision,
  issued_at::text AS issued_at, sent_at::text AS sent_at, paid_at::text AS paid_at, voided_at::text AS voided_at, void_reason,
  superseded_by::int AS superseded_by, delivery_state, delivery_error, send_intent_id, due_at::text AS due_at, terms,
  estimate_id::int AS estimate_id, change_order_id::int AS change_order_id, contract_signature_request_id::int AS contract_signature_request_id,
  source, exception_flags, external_ref, created_at::text AS created_at`;

export class BillingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "milestone";
}

/** Economic key for a draw-schedule line: stable across contract revisions
 *  as long as the line keeps its position and label. */
export function drawEconomicKey(index: number, label: string): string {
  return `draw:${index}:${slugify(label)}`;
}

export function isIntegerCents(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && Number.isFinite(n);
}

function actor(p: Principal | null | undefined): string {
  return p ? principalLabel(p) : "system";
}

export async function getInvoice(run: Run, id: number): Promise<InvoiceRow | null> {
  const [row] = await run<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1`, [id]);
  return row ?? null;
}

export async function logInvoiceEvent(run: Run, invoiceId: number, kind: string, who: Principal | string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await run(`INSERT INTO invoice_events (invoice_id, kind, actor, detail) VALUES ($1, $2, $3, $4::jsonb)`, [
    invoiceId,
    kind,
    typeof who === "string" ? who : actor(who),
    JSON.stringify(detail),
  ]);
}

// ── Numbering ───────────────────────────────────────────────────────────────

/** Lock the project's billing row for the rest of the transaction. Every
 *  issuer for a project passes through here, so two concurrent issues of the
 *  same economic key are serialized (the second sees the first's row). Must be
 *  called inside a transaction. */
export async function lockProjectBilling(run: Run, projectId: string): Promise<void> {
  await run(
    `INSERT INTO invoice_numbers (project_id, next) VALUES ($1, 0)
     ON CONFLICT (project_id) DO UPDATE SET next = invoice_numbers.next`,
    [projectId],
  );
}

/** Allocate the next display number under the row lock (UPDATE … RETURNING).
 *  Never count(*)+1: two concurrent callers get two different numbers. */
export async function allocateInvoiceNumber(run: Run, projectId: string): Promise<{ seq: number; number: string }> {
  await lockProjectBilling(run, projectId);
  const [row] = await run<{ next: number }>(`UPDATE invoice_numbers SET next = next + 1 WHERE project_id = $1 RETURNING next`, [projectId]);
  const seq = Number(row.next);
  return { seq, number: `INV-${String(seq).padStart(3, "0")}` };
}

// ── Terms → due date ────────────────────────────────────────────────────────

export interface ResolvedTerms {
  terms: string | null;
  netDays: number | null;
  source: "input" | "company_default" | "unknown";
}

/** Verified terms only: the caller's explicit terms (estimate/contract terms
 *  field), else the company default `contract.terms` in app_settings when it
 *  parses to Net N / due on receipt. Otherwise unknown. */
export async function resolveTerms(run: Run, input: { terms?: string | null }): Promise<ResolvedTerms> {
  const explicit = parseNetTerms(input.terms);
  if (explicit) return { terms: explicit.label, netDays: explicit.netDays, source: "input" };
  const [row] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'contract.terms'`);
  const company = parseNetTerms(row?.value);
  if (company) return { terms: company.label, netDays: company.netDays, source: "company_default" };
  return { terms: input.terms?.trim() || null, netDays: null, source: "unknown" };
}

// ── Issue ───────────────────────────────────────────────────────────────────

export interface IssueMilestoneInput {
  projectId: string;
  /** Stable economic identity, e.g. `estimate:12:initial`, `draw:1:rough-in-complete`, `project:<id>:final`. */
  economicKey: string;
  milestone: string;
  amountCents: number;
  lines?: InvoiceLine[];
  source: InvoiceSource;
  estimateId?: number | null;
  changeOrderId?: number | null;
  contractSignatureRequestId?: number | null;
  /** Verified terms text; falls back to the company default. */
  terms?: string | null;
  /** 'issued' (default) = obligation exists now; 'draft' = staged for the owner. */
  status?: "draft" | "issued";
  principal: Principal;
}

export interface IssueResult {
  invoice: InvoiceRow;
  /** false when an invoice with this economic key already existed (replay / concurrent caller). */
  created: boolean;
}

/** Idempotent on (project, economic_key). Concurrent or replayed calls return
 *  the same invoice; a different amount for the same key is NOT a new invoice
 *  (the identity already exists — correct it with void/credit/revision). */
export async function issueMilestoneInvoice(run: Run, input: IssueMilestoneInput): Promise<IssueResult> {
  if (!input.economicKey || !/^[a-z0-9_-]+(:[A-Za-z0-9_-]+)+$/.test(input.economicKey)) {
    throw new BillingError("bad_key", `Economic key "${input.economicKey}" is not of the form kind:id[:part].`);
  }
  if (!isIntegerCents(input.amountCents) || input.amountCents < 0) {
    throw new BillingError("bad_amount", "Invoice amount must be a whole, non-negative number of cents.");
  }
  await lockProjectBilling(run, input.projectId);
  const [existing] = await run<InvoiceRow>(
    `SELECT ${INVOICE_COLS} FROM invoices WHERE project_id = $1 AND economic_key = $2 AND status <> 'void'`,
    [input.projectId, input.economicKey],
  );
  if (existing) return { invoice: existing, created: false };

  const lines: InvoiceLine[] = (input.lines?.length ? input.lines : [{ label: input.milestone, amount: input.amountCents }]).map((l) => ({
    label: String(l.label ?? "").trim(),
    amount: Math.max(0, Math.round(Number(l.amount) || 0)),
  }));
  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
  if (lineTotal !== input.amountCents) {
    throw new BillingError("lines_mismatch", `Line items total ${lineTotal} cents but the invoice amount is ${input.amountCents}.`);
  }

  const status = input.status ?? "issued";
  const terms = await resolveTerms(run, { terms: input.terms });
  const [{ today }] = await run<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  const dueAt = status === "issued" && terms.netDays != null ? addDaysIso(today, terms.netDays) : null;
  const flags: string[] = terms.netDays == null ? ["terms_unknown"] : [];
  // Revision: a voided predecessor with the same key bumps the revision so
  // the send intent key (`invoice:<id>:send:rev<n>`) is fresh.
  const [prev] = await run<{ id: number; revision: number }>(
    `SELECT id::int AS id, revision FROM invoices WHERE project_id = $1 AND economic_key = $2 AND status = 'void' ORDER BY revision DESC LIMIT 1`,
    [input.projectId, input.economicKey],
  );
  const { number } = await allocateInvoiceNumber(run, input.projectId);
  const [invoice] = await run<InvoiceRow>(
    `INSERT INTO invoices
       (project_id, number, milestone, amount, line_items, status, economic_key, revision, issued_at, due_at, terms,
        estimate_id, change_order_id, contract_signature_request_id, source, exception_flags)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, CASE WHEN $6 = 'issued' THEN now() END, $9::date, $10, $11, $12, $13, $14, $15::text[])
     RETURNING ${INVOICE_COLS}`,
    [
      input.projectId,
      number,
      input.milestone.trim() || "Progress draw",
      input.amountCents,
      JSON.stringify(lines),
      status,
      input.economicKey,
      prev ? Number(prev.revision) + 1 : 1,
      dueAt,
      terms.terms,
      input.estimateId ?? null,
      input.changeOrderId ?? null,
      input.contractSignatureRequestId ?? null,
      input.source,
      flags,
    ],
  );
  if (prev) await run(`UPDATE invoices SET superseded_by = $2 WHERE id = $1`, [prev.id, invoice.id]);
  await logInvoiceEvent(run, invoice.id, status === "issued" ? "issued" : "drafted", input.principal, {
    economicKey: input.economicKey,
    amountCents: input.amountCents,
    source: input.source,
    terms: terms.terms,
    termsSource: terms.source,
    dueAt,
    supersedes: prev?.id ?? null,
  });
  if (flags.includes("terms_unknown")) {
    await stageDecision(run, {
      kind: "billing_exception",
      action: "set_invoice_terms",
      title: `Invoice ${number}: payment terms unknown — set terms so the due date can be verified`,
      summary: {
        effect: "No reminder will run for this invoice until terms are set; no due date was guessed.",
        gaps: [input.terms ? `Terms text "${input.terms}" did not parse to Net N.` : "No terms on the estimate/contract and the company default (Settings › Documents) does not parse to Net N."],
      },
      targetKind: "invoice",
      targetId: invoice.id,
      amountCents: input.amountCents,
      projectId: input.projectId,
      dedupeKey: `invoice:${invoice.id}:terms`,
      requestedBy: input.principal,
      content: { invoiceId: invoice.id, terms: input.terms ?? null },
    });
  }
  return { invoice, created: true };
}

/** Owner sets verified terms on an issued invoice; clears `terms_unknown`. */
export async function setInvoiceTerms(run: Run, input: { invoiceId: number; terms: string; principal: Principal }): Promise<InvoiceRow> {
  const parsed = parseNetTerms(input.terms);
  if (!parsed) throw new BillingError("terms_unparsed", `"${input.terms}" does not read as Net N or due on receipt.`);
  const [row] = await run<InvoiceRow>(
    `UPDATE invoices
        SET terms = $2, due_at = (COALESCE(issued_at, now())::date + $3::int),
            exception_flags = array_remove(exception_flags, 'terms_unknown')
      WHERE id = $1 RETURNING ${INVOICE_COLS}`,
    [input.invoiceId, parsed.label, parsed.netDays],
  );
  if (!row) throw new BillingError("not_found", "Invoice not found.");
  await logInvoiceEvent(run, row.id, "terms_set", input.principal, { terms: parsed.label, dueAt: row.due_at });
  return row;
}

// ── Balances ────────────────────────────────────────────────────────────────

export interface InvoiceBalance {
  invoiceId: number;
  amountCents: number;
  status: InvoiceStatus;
  settledCents: number;
  pendingCents: number;
  creditsCents: number;
  returnsCents: number;
  /** amount − settled − credits + returns (0 for draft/void). */
  balanceCents: number;
  hasPending: boolean;
}

const BALANCE_SQL = `
  SELECT i.id AS invoice_id, i.amount, i.status,
         COALESCE(SUM(CASE WHEN p.kind = 'payment' AND p.status = 'settled' THEN p.amount_cents END), 0)::int AS settled,
         COALESCE(SUM(CASE WHEN p.kind = 'payment' AND p.status = 'pending' THEN p.amount_cents END), 0)::int AS pending,
         COALESCE(SUM(CASE WHEN p.kind IN ('credit','writeoff') AND p.status = 'settled' THEN p.amount_cents END), 0)::int AS credits,
         COALESCE(SUM(CASE WHEN p.kind IN ('refund','return') AND p.status = 'settled' THEN p.amount_cents END), 0)::int AS returns
    FROM invoices i LEFT JOIN invoice_payments p ON p.invoice_id = i.id`;

function toBalance(r: { invoice_id: number; amount: number; status: InvoiceStatus; settled: number; pending: number; credits: number; returns: number }): InvoiceBalance {
  const live = r.status !== "draft" && r.status !== "void";
  const balance = live ? r.amount - r.settled - r.credits + r.returns : 0;
  return {
    invoiceId: Number(r.invoice_id),
    amountCents: r.amount,
    status: r.status,
    settledCents: r.settled,
    pendingCents: r.pending,
    creditsCents: r.credits,
    returnsCents: r.returns,
    balanceCents: balance,
    hasPending: r.pending > 0,
  };
}

export async function invoiceBalance(run: Run, invoiceId: number): Promise<InvoiceBalance | null> {
  const rows = await run<{ invoice_id: number; amount: number; status: InvoiceStatus; settled: number; pending: number; credits: number; returns: number }>(
    `${BALANCE_SQL} WHERE i.id = $1 GROUP BY i.id`,
    [invoiceId],
  );
  return rows[0] ? toBalance(rows[0]) : null;
}

export interface VerifiedBalanceRow extends InvoiceBalance {
  projectId: string;
  number: string;
  milestone: string;
  dueAt: string | null;
  deliveryState: DeliveryState;
  exceptionFlags: string[];
  daysPastDue: number | null;
}

/** Every live invoice with its verified balance — the helper WS-recovery's
 *  A/R scan (lib/reminders.ts) should read instead of `status = 'sent'`. */
export async function verifiedBalances(run: Run, opts: { projectId?: string | null; onlyOpen?: boolean } = {}): Promise<VerifiedBalanceRow[]> {
  const rows = await run<{
    invoice_id: number; amount: number; status: InvoiceStatus; settled: number; pending: number; credits: number; returns: number;
    project_id: string; number: string; milestone: string; due_at: string | null; delivery_state: DeliveryState; exception_flags: string[]; days_past_due: number | null;
  }>(
    `SELECT b.*, i.project_id, i.number, i.milestone, i.due_at::text AS due_at, i.delivery_state, i.exception_flags,
            CASE WHEN i.due_at IS NOT NULL THEN (CURRENT_DATE - i.due_at) END AS days_past_due
       FROM (${BALANCE_SQL} WHERE ($1::uuid IS NULL OR i.project_id = $1) GROUP BY i.id) b
       JOIN invoices i ON i.id = b.invoice_id
      ORDER BY i.project_id, i.created_at, i.id`,
    [opts.projectId ?? null],
  );
  return rows
    .map((r) => ({
      ...toBalance(r),
      projectId: r.project_id,
      number: r.number,
      milestone: r.milestone,
      dueAt: r.due_at,
      deliveryState: r.delivery_state,
      exceptionFlags: r.exception_flags ?? [],
      daysPastDue: r.days_past_due == null ? null : Number(r.days_past_due),
    }))
    .filter((r) => !opts.onlyOpen || r.balanceCents > 0);
}

/** Recompute the cash status from the ledger. Delivery is untouched. */
export async function syncInvoiceCashStatus(run: Run, invoiceId: number): Promise<InvoiceRow | null> {
  const [inv] = await run<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
  if (!inv) return null;
  if (!["issued", "sent", "partially_paid", "paid"].includes(inv.status)) return inv;
  const b = (await invoiceBalance(run, invoiceId))!;
  let next: InvoiceStatus;
  if (inv.amount > 0 && b.balanceCents <= 0) next = "paid";
  else if (b.settledCents - b.returnsCents > 0 || b.creditsCents > 0) next = "partially_paid";
  else next = inv.delivery_state === "delivered" ? "sent" : "issued";
  if (next === inv.status) return inv;
  const [row] = await run<InvoiceRow>(
    `UPDATE invoices SET status = $2, paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END WHERE id = $1 RETURNING ${INVOICE_COLS}`,
    [invoiceId, next],
  );
  return row;
}

// ── Ledger writes ───────────────────────────────────────────────────────────

export interface RecordPaymentInput {
  invoiceId: number;
  kind: PaymentKind;
  amountCents: number;
  method: string;
  provider?: string | null;
  providerRef?: string | null;
  receivedAt?: string | Date | null;
  status?: PaymentStatus;
  note?: string;
  externalSync?: Record<string, unknown>;
  principal: Principal;
}

export interface PaymentRow {
  id: number;
  invoice_id: number;
  kind: PaymentKind;
  amount_cents: number;
  method: string;
  provider: string | null;
  provider_ref: string | null;
  received_at: string;
  status: PaymentStatus;
  actor: string;
  note: string;
  external_sync: Record<string, unknown>;
}

const PAYMENT_COLS = `id::int AS id, invoice_id::int AS invoice_id, kind, amount_cents, method, provider, provider_ref, received_at::text AS received_at, status, actor, note, external_sync`;

/** Record a ledger row. Idempotent on (provider, provider_ref): a replayed
 *  webhook or a retried manual entry with the same reference returns the
 *  existing row and moves its status forward only (pending → settled/failed,
 *  never settled → pending). Then the invoice cash status is recomputed. */
export async function recordInvoicePayment(run: Run, input: RecordPaymentInput): Promise<{ payment: PaymentRow; created: boolean; invoice: InvoiceRow }> {
  if (!isIntegerCents(input.amountCents) || input.amountCents < 0) throw new BillingError("bad_amount", "Amount must be whole non-negative cents.");
  const [inv] = await run<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1 FOR UPDATE`, [input.invoiceId]);
  if (!inv) throw new BillingError("not_found", "Invoice not found.");
  if (inv.status === "draft" || inv.status === "void") throw new BillingError("not_live", `Invoice ${inv.number} is ${inv.status}; nothing can be applied to it.`);
  const status = input.status ?? "settled";
  const who = actor(input.principal);
  let payment: PaymentRow | undefined;
  let created = false;
  if (input.providerRef) {
    const [existing] = await run<PaymentRow>(
      `SELECT ${PAYMENT_COLS} FROM invoice_payments WHERE provider = $1 AND provider_ref = $2 FOR UPDATE`,
      [input.provider ?? null, input.providerRef],
    );
    if (existing) {
      if (existing.invoice_id !== inv.id) throw new BillingError("ref_conflict", `Provider reference ${input.providerRef} is already applied to another invoice.`);
      const rank: Record<PaymentStatus, number> = { pending: 0, settled: 1, failed: 1, returned: 2 };
      if (rank[status] > rank[existing.status] || (existing.status === "pending" && status !== "pending")) {
        const [upd] = await run<PaymentRow>(
          `UPDATE invoice_payments SET status = $2, external_sync = external_sync || $3::jsonb WHERE id = $1 RETURNING ${PAYMENT_COLS}`,
          [existing.id, status, JSON.stringify(input.externalSync ?? {})],
        );
        payment = upd;
        await logInvoiceEvent(run, inv.id, `payment_${status}`, who, { paymentId: existing.id, kind: existing.kind, amountCents: existing.amount_cents, providerRef: input.providerRef });
      } else payment = existing;
    }
  }
  if (!payment) {
    const [row] = await run<PaymentRow>(
      `INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, provider, provider_ref, received_at, status, actor, note, external_sync)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11::jsonb)
       ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING ${PAYMENT_COLS}`,
      [
        inv.id, input.kind, input.amountCents, input.method, input.provider ?? null, input.providerRef ?? null,
        input.receivedAt ? new Date(input.receivedAt).toISOString() : null, status, who, input.note ?? "", JSON.stringify(input.externalSync ?? {}),
      ],
    );
    if (row) {
      payment = row;
      created = true;
      await logInvoiceEvent(run, inv.id, `${input.kind}_${status}`, who, { paymentId: row.id, amountCents: input.amountCents, method: input.method, provider: input.provider ?? null, providerRef: input.providerRef ?? null });
    } else {
      // Lost a race on the provider ref: read the winner.
      const [w] = await run<PaymentRow>(`SELECT ${PAYMENT_COLS} FROM invoice_payments WHERE provider = $1 AND provider_ref = $2`, [input.provider ?? null, input.providerRef]);
      payment = w;
    }
  }
  const invoice = (await syncInvoiceCashStatus(run, inv.id))!;
  return { payment: payment!, created, invoice };
}

/** Void an issued invoice that has no settled cash on it (otherwise credit or
 *  refund first). Audit kept; the economic key becomes free for a re-issue
 *  that supersedes this row. */
export async function voidInvoice(run: Run, input: { invoiceId: number; reason: string; principal: Principal }): Promise<InvoiceRow> {
  const [inv] = await run<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1 FOR UPDATE`, [input.invoiceId]);
  if (!inv) throw new BillingError("not_found", "Invoice not found.");
  if (inv.status === "void") return inv;
  const b = (await invoiceBalance(run, inv.id))!;
  if (b.settledCents - b.returnsCents > 0) throw new BillingError("has_cash", `Invoice ${inv.number} has settled payments; refund or credit it instead of voiding.`);
  if (b.hasPending) throw new BillingError("pending_payment", `Invoice ${inv.number} has a payment pending; wait for it to settle or fail.`);
  const [row] = await run<InvoiceRow>(
    `UPDATE invoices SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1 RETURNING ${INVOICE_COLS}`,
    [inv.id, input.reason.trim() || "voided"],
  );
  await logInvoiceEvent(run, inv.id, "voided", input.principal, { reason: input.reason, previousStatus: inv.status });
  return row;
}

/** Credit part (or all) of an issued invoice with a reason. Never edits the
 *  issued amount — the credit is a ledger row so the original stays auditable. */
export async function creditInvoice(run: Run, input: { invoiceId: number; amountCents: number; reason: string; principal: Principal; kind?: "credit" | "writeoff" }): Promise<{ invoice: InvoiceRow; payment: PaymentRow }> {
  if (!isIntegerCents(input.amountCents) || input.amountCents <= 0) throw new BillingError("bad_amount", "Credit must be a positive whole number of cents.");
  const b = await invoiceBalance(run, input.invoiceId);
  if (!b) throw new BillingError("not_found", "Invoice not found.");
  if (input.amountCents > b.balanceCents) throw new BillingError("over_credit", `Credit ${input.amountCents} exceeds the open balance ${b.balanceCents}.`);
  const r = await recordInvoicePayment(run, {
    invoiceId: input.invoiceId,
    kind: input.kind ?? "credit",
    amountCents: input.amountCents,
    method: "credit",
    note: input.reason,
    principal: input.principal,
  });
  return { invoice: r.invoice, payment: r.payment };
}

/** Link the signed construction contract to the acceptance invoice — same
 *  economic identity, no rebilling. Idempotent. */
export async function linkContractToInvoice(run: Run, input: { invoiceId: number; signatureRequestId: number; principal: Principal }): Promise<InvoiceRow | null> {
  const [row] = await run<InvoiceRow>(
    `UPDATE invoices SET contract_signature_request_id = $2 WHERE id = $1 AND contract_signature_request_id IS DISTINCT FROM $2 RETURNING ${INVOICE_COLS}`,
    [input.invoiceId, input.signatureRequestId],
  );
  if (row) await logInvoiceEvent(run, row.id, "contract_linked", input.principal, { signatureRequestId: input.signatureRequestId });
  return row ?? (await getInvoice(run, input.invoiceId));
}

// ── Delivery bookkeeping (sendInvoiceOp's result is the only truth) ─────────

export async function recordDeliveryOutcome(run: Run, input: { invoiceId: number; ok: boolean; error?: string | null; principal: Principal | string }): Promise<void> {
  if (input.ok) {
    await run(
      `UPDATE invoices SET delivery_state = 'delivered', delivery_error = NULL, issued_at = COALESCE(issued_at, now()),
              due_at = CASE WHEN due_at IS NULL AND terms IS NOT NULL THEN due_at ELSE due_at END
        WHERE id = $1`,
      [input.invoiceId],
    );
    await logInvoiceEvent(run, input.invoiceId, "delivered", input.principal);
  } else {
    // Never mark sent on failure; record the failure only on a still-open row.
    await run(
      `UPDATE invoices SET delivery_state = 'failed', delivery_error = $2
        WHERE id = $1 AND status IN ('draft','issued') AND delivery_state <> 'delivered'`,
      [input.invoiceId, (input.error ?? "send failed").slice(0, 500)],
    );
    await logInvoiceEvent(run, input.invoiceId, "delivery_failed", input.principal, { error: input.error ?? null });
  }
}

// ── Read-only collision report ──────────────────────────────────────────────

export interface CollisionReport {
  generatedAt: string;
  sharedMilestoneLabels: { projectId: string; projectSlug: string; milestone: string; invoiceIds: number[]; numbers: string[]; amounts: number[] }[];
  sharedAmounts: { projectId: string; projectSlug: string; amountCents: number; invoiceIds: number[]; numbers: string[]; milestones: string[] }[];
  noEconomicKey: { projectId: string; projectSlug: string; invoiceId: number; number: string; milestone: string; amountCents: number; status: string }[];
  duplicateNumbers: { projectId: string; projectSlug: string; number: string; invoiceIds: number[] }[];
  counts: { invoices: number; withoutKey: number; labelGroups: number; amountGroups: number; duplicateNumbers: number };
}

export async function invoiceCollisionReport(run: Run): Promise<CollisionReport> {
  const labels = await run<{ project_id: string; slug: string; milestone: string; ids: number[]; numbers: string[]; amounts: number[] }>(
    `SELECT i.project_id, p.slug, lower(trim(i.milestone)) AS milestone,
            array_agg(i.id ORDER BY i.id) AS ids, array_agg(i.number ORDER BY i.id) AS numbers, array_agg(i.amount ORDER BY i.id) AS amounts
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.status <> 'void' AND trim(i.milestone) <> ''
      GROUP BY i.project_id, p.slug, lower(trim(i.milestone)) HAVING count(*) > 1 ORDER BY p.slug`,
  );
  const amounts = await run<{ project_id: string; slug: string; amount: number; ids: number[]; numbers: string[]; milestones: string[] }>(
    `SELECT i.project_id, p.slug, i.amount, array_agg(i.id ORDER BY i.id) AS ids, array_agg(i.number ORDER BY i.id) AS numbers, array_agg(i.milestone ORDER BY i.id) AS milestones
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.status <> 'void' AND i.amount > 0
      GROUP BY i.project_id, p.slug, i.amount HAVING count(*) > 1 ORDER BY p.slug`,
  );
  const noKey = await run<{ project_id: string; slug: string; id: number; number: string; milestone: string; amount: number; status: string }>(
    `SELECT i.project_id, p.slug, i.id, i.number, i.milestone, i.amount, i.status
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.economic_key IS NULL ORDER BY p.slug, i.id`,
  );
  const dupNumbers = await run<{ project_id: string; slug: string; number: string; ids: number[] }>(
    `SELECT i.project_id, p.slug, i.number, array_agg(i.id ORDER BY i.id) AS ids
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.number <> '' GROUP BY i.project_id, p.slug, i.number HAVING count(*) > 1 ORDER BY p.slug`,
  );
  const [{ n }] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM invoices`);
  return {
    generatedAt: new Date().toISOString(),
    sharedMilestoneLabels: labels.map((r) => ({ projectId: r.project_id, projectSlug: r.slug, milestone: r.milestone, invoiceIds: r.ids.map(Number), numbers: r.numbers, amounts: r.amounts.map(Number) })),
    sharedAmounts: amounts.map((r) => ({ projectId: r.project_id, projectSlug: r.slug, amountCents: Number(r.amount), invoiceIds: r.ids.map(Number), numbers: r.numbers, milestones: r.milestones })),
    noEconomicKey: noKey.map((r) => ({ projectId: r.project_id, projectSlug: r.slug, invoiceId: Number(r.id), number: r.number, milestone: r.milestone, amountCents: Number(r.amount), status: r.status })),
    duplicateNumbers: dupNumbers.map((r) => ({ projectId: r.project_id, projectSlug: r.slug, number: r.number, invoiceIds: r.ids.map(Number) })),
    counts: { invoices: n, withoutKey: noKey.length, labelGroups: labels.length, amountGroups: amounts.length, duplicateNumbers: dupNumbers.length },
  };
}
