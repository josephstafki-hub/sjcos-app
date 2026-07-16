// Project money builder (Review-round-3 S5A). DB-backed reads of the invoices
// table for the project Money tab. Amounts are integer CENTS (Phase 5.0 cents
// migration). Writes live in lib/actions/money.ts.
// P1-B7: the retainer ledger was removed — SJC is fixed-price only.

import { query } from "./db";

export type InvoiceStatus = "draft" | "sent" | "paid";

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
  status: InvoiceStatus;
  /** Display date for the status, e.g. "Sent Apr 30" / "Paid May 2" / "Draft". */
  statusLabel: string;
  /** Days since a sent invoice was sent (for collections triggers); null else. */
  daysOverdue: number | null;
}

export interface ProjectMoney {
  invoices: Invoice[];
  /** Σ paid invoices. */
  paidTotal: number;
  /** Σ sent-but-unpaid invoices. */
  outstanding: number;
}

interface InvoiceRow {
  id: number;
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  status: InvoiceStatus;
  sent_label: string | null;
  paid_label: string | null;
  days_overdue: number | null;
}

/** Format integer CENTS as "$12,400.00" (Phase 5.0 — money tables are cents). */
export function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );
}

function statusLabel(r: InvoiceRow): string {
  if (r.status === "paid") return r.paid_label ? `Paid ${r.paid_label}` : "Paid";
  if (r.status === "sent") return r.sent_label ? `Sent ${r.sent_label}` : "Sent";
  return "Draft";
}

/** Read a project's invoices. Empty/zeroed when none exist. */
export async function getProjectMoney(slug: string): Promise<ProjectMoney> {
  const { rows } = await query<InvoiceRow>(
    `SELECT i.id, i.number, i.milestone, i.amount, i.line_items, i.status,
            to_char(i.sent_at, 'Mon FMDD') AS sent_label,
            to_char(i.paid_at, 'Mon FMDD') AS paid_label,
            CASE WHEN i.status = 'sent' AND i.sent_at IS NOT NULL
                 THEN (CURRENT_DATE - i.sent_at::date) END AS days_overdue
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
      WHERE p.slug = $1
      ORDER BY i.created_at, i.id`,
    [slug],
  );
  const invoices: Invoice[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    milestone: r.milestone,
    amount: r.amount,
    lines: Array.isArray(r.line_items) ? r.line_items : [],
    status: r.status,
    statusLabel: statusLabel(r),
    daysOverdue: r.days_overdue,
  }));

  return {
    invoices,
    paidTotal: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0),
    outstanding: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amount, 0),
  };
}
