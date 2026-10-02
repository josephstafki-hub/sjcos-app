// Shared procurement types (A13). No db import — safe anywhere.

export type CommitmentKind = "purchase_order" | "sub_award" | "supplier_offer";
export type PayeeKind = "vendor" | "sub" | "one_off";
export type CommitmentState =
  | "draft"
  | "approved"
  | "committed"
  | "acknowledged"
  | "partially_delivered"
  | "delivered"
  | "reviewed"
  | "accepted"
  | "payable"
  | "paid"
  | "void";

export interface CommitmentItem {
  /** purchase_order_lines.id when the item came from a PO line. */
  lineId?: number | null;
  description: string;
  unit: string;
  qty: number;
  unitCents: number;
  extendedCents: number;
}

export interface Commitment {
  id: number;
  project_id: string;
  kind: CommitmentKind;
  ref: string;
  revision: number;
  payee_kind: PayeeKind;
  vendor_id: string | null;
  sub_slug: string | null;
  payee_name: string;
  payee_contact: string;
  scope_summary: string;
  items: CommitmentItem[];
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  terms: string;
  pay_now_bundled: boolean;
  content_hash: string;
  decision_id: string | null;
  state: CommitmentState;
  promised_date: string | null;
  acknowledgement: Record<string, unknown> | null;
  send_intent_id: string | null;
  superseded_by: number | null;
  created_at: string;
}

export const COMMITMENT_COLS = `id, project_id, kind, ref, revision, payee_kind, vendor_id, sub_slug, payee_name, payee_contact,
  scope_summary, items, subtotal_cents, tax_cents, shipping_cents, total_cents, currency, terms, pay_now_bundled, content_hash,
  decision_id, state, promised_date::text AS promised_date, acknowledgement, send_intent_id, superseded_by, created_at::text AS created_at`;

export type DeliveryKind = "acknowledgement" | "receipt" | "review" | "acceptance";

export interface DeliveryLine {
  lineId?: number | null;
  description: string;
  qtyReceived: number;
  unit?: string;
  /** For service deliverables: the value of what was delivered, in cents. */
  amountCents?: number | null;
  note?: string;
}

export interface Delivery {
  id: number;
  commitment_id: number;
  kind: DeliveryKind;
  received_at: string;
  lines: DeliveryLine[];
  late: boolean;
  wrong: boolean;
  revised: boolean;
  reviewed: boolean;
  accepted: boolean;
  issues: string[];
  evidence: Record<string, unknown>;
  recorded_by: string;
}

export type BillState = "pending" | "approved" | "paid" | "manual_pending" | "void";
export type MatchedState = "unmatched" | "matched" | "disputed";

export interface Bill {
  id: number;
  project_id: string | null;
  commitment_id: number | null;
  payee_kind: PayeeKind;
  vendor_id: string | null;
  sub_slug: string | null;
  payee_name: string;
  bill_number: string;
  amount_cents: number;
  currency: string;
  received_file_id: string | null;
  received_at: string;
  matched_state: MatchedState;
  match_note: string;
  payable_cents: number | null;
  destination: Record<string, unknown> | null;
  payment_decision_id: string | null;
  payment_intent_id: string | null;
  state: BillState;
  paid_evidence: Record<string, unknown> | null;
  paid_at: string | null;
}

export const BILL_COLS = `id, project_id, commitment_id, payee_kind, vendor_id, sub_slug, payee_name, bill_number, amount_cents, currency,
  received_file_id, received_at::text AS received_at, matched_state, match_note, payable_cents, destination, payment_decision_id,
  payment_intent_id, state, paid_evidence, paid_at::text AS paid_at`;

export const PURCHASE_ACTION = "commit_purchase";
export const PURCHASE_AND_PAY_ACTION = "commit_and_pay_purchase";
export const PAYMENT_ACTION = "pay_bill";

export function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
