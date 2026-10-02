// Square adapter contract (A20). Pure types — no server-only import.
//
// Two implementations: `fake` (deterministic, in-memory; used whenever
// SQUARE_ENV is unset or SJC_OUTBOUND_DISABLED=1 — i.e. every test) and
// `https` (real Payments API; only constructed when SQUARE_ACCESS_TOKEN and
// SQUARE_ENV=sandbox|production are set). Card / bank details never reach
// this layer: the browser tokenizes with Square's Web Payments SDK and the
// server only ever sees an opaque source id.

export type SquareEnvironment = "fake" | "sandbox" | "production";
export type SquarePaymentStatus = "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
export type SquareRefundStatus = "PENDING" | "COMPLETED" | "REJECTED" | "FAILED";
export type PaymentMethod = "card" | "ach";

export interface SquarePayment {
  id: string;
  status: SquarePaymentStatus;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  /** Our intent_key, echoed back as reference_id. */
  referenceId: string | null;
  orderId: string | null;
  receiptUrl: string | null;
  /** Processing fee Square reports (cents), when known. */
  feeCents: number | null;
  refundedCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface SquareRefund {
  id: string;
  paymentId: string;
  status: SquareRefundStatus;
  amountCents: number;
  createdAt: string;
}

export interface CreatePaymentInput {
  /** = payment_attempts.intent_key; Square dedupes on it. */
  idempotencyKey: string;
  sourceId: string;
  amountCents: number;
  currency: string;
  locationId: string;
  method: PaymentMethod;
  referenceId: string;
  note?: string;
  buyerEmail?: string | null;
}

export interface CreateRefundInput {
  idempotencyKey: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  reason: string;
}

export interface SquareCapabilities {
  merchantApproved: boolean;
  card: boolean;
  ach: boolean;
  refunds: boolean;
  locationName?: string | null;
  note?: string;
}

/** Thrown when the request may or may not have reached Square (timeout after
 *  transmit, connection reset mid-response). The caller marks the attempt
 *  `unknown` and lets reconciliation decide — never retries blindly. */
export class ProviderUnknownOutcomeError extends Error {
  constructor(message = "provider outcome unknown") {
    super(message);
    this.name = "ProviderUnknownOutcomeError";
  }
}

/** Thrown for a definite provider refusal (declined card, invalid token). */
export class ProviderDeclinedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderDeclinedError";
    this.code = code;
  }
}

export interface SquareAdapter {
  readonly environment: SquareEnvironment;
  /** True when a real charge can be attempted (fake: always). */
  readonly ready: boolean;
  createPayment(input: CreatePaymentInput): Promise<SquarePayment>;
  getPayment(paymentId: string): Promise<SquarePayment | null>;
  /** Payments created/updated since `sinceIso` (reconciliation sweep). */
  listPaymentsSince(sinceIso: string, locationId?: string | null): Promise<SquarePayment[]>;
  createRefund(input: CreateRefundInput): Promise<SquareRefund>;
  getRefund(refundId: string): Promise<SquareRefund | null>;
  /** Verify the connection + capabilities for the settings page. */
  verifyConnection(locationId: string | null): Promise<SquareCapabilities>;
}
