// Project money builder (Review-round-3 S5A). DB-backed reads of the invoices
// + retainers tables for the project Money tab. Amounts are integer dollars;
// retainer balance is derived (collected - applied). Writes live in
// lib/actions/money.ts.

import { query, queryOne } from "./db";

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
}

export interface RetainerLedger {
  collected: number;
  applied: number;
  balance: number;
}

export interface ProjectMoney {
  invoices: Invoice[];
  retainer: RetainerLedger;
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
}

/** Format integer dollars as "$12,400". */
export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function statusLabel(r: InvoiceRow): string {
  if (r.status === "paid") return r.paid_label ? `Paid ${r.paid_label}` : "Paid";
  if (r.status === "sent") return r.sent_label ? `Sent ${r.sent_label}` : "Sent";
  return "Draft";
}

/** Read a project's invoices + retainer ledger. Empty/zeroed when none exist. */
export async function getProjectMoney(slug: string): Promise<ProjectMoney> {
  const { rows } = await query<InvoiceRow>(
    `SELECT i.id, i.number, i.milestone, i.amount, i.line_items, i.status,
            to_char(i.sent_at, 'Mon FMDD') AS sent_label,
            to_char(i.paid_at, 'Mon FMDD') AS paid_label
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
  }));

  const ret = await queryOne<{ collected: number; applied: number }>(
    `SELECT r.collected, r.applied FROM retainers r
       JOIN projects p ON p.id = r.project_id WHERE p.slug = $1`,
    [slug],
  );
  const collected = ret?.collected ?? 0;
  const applied = ret?.applied ?? 0;

  return {
    invoices,
    retainer: { collected, applied, balance: collected - applied },
    paidTotal: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0),
    outstanding: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amount, 0),
  };
}
