// Project money builder (Review-round-3 S5A; A07b read model). DB-backed reads
// of the invoices table + payment ledger for the project Money tab and the
// client portal. Amounts are integer CENTS. Writes live in lib/actions/money.ts
// and lib/billing/*.
//
// A07b separates four facts per invoice that used to be one status column:
//   • issued amount (`amount`) and lifecycle (`lifecycle`: draft / issued /
//     sent / partially_paid / paid / void / disputed);
//   • delivery (`deliveryState`) — only sendInvoiceOp's result sets it;
//   • cash (`paid`, `credits`, `pending`, `balance`) from invoice_payments;
//   • external sync (`syncState`) from QBO mappings.
// `status` stays the legacy 3-bucket display state (draft / sent / paid) so
// MoneyPanel and the portal keep rendering unchanged: every open lifecycle
// state buckets to "sent", void rows are listed separately.

import { query } from "./db";

export type InvoiceStatus = "draft" | "sent" | "paid";
export type InvoiceLifecycle = "draft" | "issued" | "sent" | "partially_paid" | "paid" | "void" | "disputed";
export type InvoiceDeliveryState = "none" | "queued" | "accepted" | "delivered" | "failed" | "unknown";
export type InvoiceSyncState = "none" | "posted" | "settled" | "reconciled" | "conflict" | "unmapped";

export interface InvoiceLine {
  label: string;
  amount: number;
}

export interface Invoice {
  id: number;
  number: string;
  milestone: string;
  amount: number;
  lines: InvoiceLine[];
  /** Legacy display bucket: draft / sent (any open state) / paid. */
  status: InvoiceStatus;
  /** The real lifecycle state (A07b). */
  lifecycle: InvoiceLifecycle;
  /** Display date for the status, e.g. "Sent Apr 30" / "Paid May 2" / "Draft". */
  statusLabel: string;
  /** Days past the verified due date (null when no due date or not open). */
  daysOverdue: number | null;
  /** Settled cash applied. */
  paid: number;
  /** Credits + write-offs applied. */
  credits: number;
  /** Payments pending (ACH in flight) — not cash. */
  pending: number;
  /** Refunds + returns that re-opened balance. */
  returns: number;
  /** amount − paid − credits + returns (0 for draft/void). */
  balance: number;
  deliveryState: InvoiceDeliveryState;
  deliveryError: string | null;
  syncState: InvoiceSyncState;
  dueAt: string | null;
  terms: string | null;
  economicKey: string | null;
  revision: number;
  source: string;
  exceptionFlags: string[];
}

export interface ProjectMoney {
  invoices: Invoice[];
  /** Voided invoices (kept for lineage; never in totals). */
  voided: Invoice[];
  /** Σ settled cash across live invoices. */
  paidTotal: number;
  /** Σ verified open balances across live invoices. */
  outstanding: number;
  /** Σ payments in flight (not cash, not outstanding). */
  pendingTotal: number;
}

interface InvoiceRow {
  id: number;
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  lifecycle: InvoiceLifecycle;
  sent_label: string | null;
  paid_label: string | null;
  issued_label: string | null;
  due_at: string | null;
  days_overdue: number | null;
  settled: number;
  pending: number;
  credits: number;
  returns: number;
  delivery_state: InvoiceDeliveryState;
  delivery_error: string | null;
  terms: string | null;
  economic_key: string | null;
  revision: number;
  source: string;
  exception_flags: string[];
  sync_state: string | null;
}

/** Format integer CENTS as "$12,400.00" (Phase 5.0 — money tables are cents). */
export function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );
}

function bucket(l: InvoiceLifecycle): InvoiceStatus {
  if (l === "draft") return "draft";
  if (l === "paid") return "paid";
  return "sent";
}

function statusLabel(r: InvoiceRow, balance: number): string {
  switch (r.lifecycle) {
    case "paid":
      return r.paid_label ? `Paid ${r.paid_label}` : "Paid";
    case "partially_paid":
      return `${usd(balance)} open${r.sent_label ? ` · sent ${r.sent_label}` : ""}`;
    case "sent":
      return r.sent_label ? `Sent ${r.sent_label}` : "Sent";
    case "issued": {
      const d = r.delivery_state === "queued" ? "queued to send" : r.delivery_state === "failed" ? "send failed" : "not sent";
      return `Issued${r.issued_label ? ` ${r.issued_label}` : ""} · ${d}`;
    }
    case "void":
      return "Void";
    case "disputed":
      return "Disputed";
    default:
      return "Draft";
  }
}

/** Read a project's invoices. Empty/zeroed when none exist. */
export async function getProjectMoney(slug: string): Promise<ProjectMoney> {
  const { rows } = await query<InvoiceRow>(
    `SELECT i.id::int AS id, i.number, i.milestone, i.amount, i.line_items, i.status AS lifecycle,
            to_char(i.sent_at, 'Mon FMDD') AS sent_label,
            to_char(i.paid_at, 'Mon FMDD') AS paid_label,
            to_char(i.issued_at, 'Mon FMDD') AS issued_label,
            i.due_at::text AS due_at,
            CASE WHEN i.status IN ('issued','sent','partially_paid') AND i.due_at IS NOT NULL
                 THEN (CURRENT_DATE - i.due_at) END AS days_overdue,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind = 'payment' AND p.status = 'settled'), 0)::int AS settled,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind = 'payment' AND p.status = 'pending'), 0)::int AS pending,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind IN ('credit','writeoff') AND p.status = 'settled'), 0)::int AS credits,
            COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.kind IN ('refund','return') AND p.status = 'settled'), 0)::int AS returns,
            i.delivery_state, i.delivery_error, i.terms, i.economic_key, i.revision, i.source, i.exception_flags,
            (SELECT m.state FROM qbo_mappings m WHERE m.entity_kind = 'Invoice' AND m.internal_kind = 'invoice' AND m.internal_id = i.id::text
              ORDER BY m.updated_at DESC LIMIT 1) AS sync_state
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
      WHERE p.slug = $1
      ORDER BY i.created_at, i.id`,
    [slug],
  );
  const all: Invoice[] = rows.map((r) => {
    const live = r.lifecycle !== "draft" && r.lifecycle !== "void";
    const balance = live ? r.amount - r.settled - r.credits + r.returns : 0;
    return {
      id: r.id,
      number: r.number,
      milestone: r.milestone,
      amount: r.amount,
      lines: Array.isArray(r.line_items) ? r.line_items : [],
      status: bucket(r.lifecycle),
      lifecycle: r.lifecycle,
      statusLabel: statusLabel(r, balance),
      daysOverdue: r.days_overdue == null ? null : Number(r.days_overdue),
      paid: r.settled,
      credits: r.credits,
      pending: r.pending,
      returns: r.returns,
      balance,
      deliveryState: r.delivery_state,
      deliveryError: r.delivery_error,
      syncState: (r.sync_state as InvoiceSyncState | null) ?? "none",
      dueAt: r.due_at,
      terms: r.terms,
      economicKey: r.economic_key,
      revision: Number(r.revision),
      source: r.source,
      exceptionFlags: r.exception_flags ?? [],
    };
  });
  const invoices = all.filter((i) => i.lifecycle !== "void");
  const voided = all.filter((i) => i.lifecycle === "void");
  return {
    invoices,
    voided,
    paidTotal: invoices.reduce((s, i) => s + i.paid, 0),
    outstanding: invoices.reduce((s, i) => s + Math.max(0, i.balance), 0),
    pendingTotal: invoices.reduce((s, i) => s + i.pending, 0),
  };
}
