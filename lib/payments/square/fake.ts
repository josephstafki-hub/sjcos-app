// Deterministic in-memory Square (A20). Engaged whenever SQUARE_ENV is unset
// or SJC_OUTBOUND_DISABLED=1, so tests and an unconfigured install never hit
// the network. Behaviour is chosen to exercise the real edge cases:
//   • idempotency: a repeated createPayment with the same key returns the
//     SAME payment (no second charge);
//   • card: COMPLETED at once (APPROVED when autocomplete is false, until
//     completePayment / cancelPayment); a source id containing "decline" is
//     refused; the card reads as a Visa credit card unless the source id
//     contains "debit" or "prepaid";
//     "timeout" throws ProviderUnknownOutcomeError AFTER the payment is
//     recorded (the classic accepted-then-timeout);
//   • ACH: PENDING on creation; the second getPayment() poll settles it —
//     COMPLETED, or FAILED when the amount ends in 99 cents;
//   • webhookEvent() builds a signed notification for replay tests.

import {
  ProviderDeclinedError,
  ProviderUnknownOutcomeError,
  type CreatePaymentInput,
  type CreateRefundInput,
  type SquareAdapter,
  type SquareCapabilities,
  type SquarePayment,
  type SquareRefund,
} from "./types.ts";
import { squareSignature } from "./signature.ts";

export const FAKE_SIGNATURE_KEY = "fake-signature-key";
export const FAKE_NOTIFICATION_URL = "https://os.example.test/api/webhooks/square";

export class FakeSquare implements SquareAdapter {
  readonly environment = "fake" as const;
  readonly ready = true;
  private payments = new Map<string, SquarePayment>();
  private byIdempotency = new Map<string, string>();
  private refunds = new Map<string, SquareRefund>();
  private refundsByIdempotency = new Map<string, string>();
  private polls = new Map<string, number>();
  private seq = 0;
  private eventSeq = 0;

  reset(): void {
    this.payments.clear();
    this.byIdempotency.clear();
    this.refunds.clear();
    this.refundsByIdempotency.clear();
    this.polls.clear();
    this.seq = 0;
    this.eventSeq = 0;
  }

  private now(): string {
    return new Date().toISOString();
  }

  async createPayment(input: CreatePaymentInput): Promise<SquarePayment> {
    // Square's real field limits (CreatePayment): the first live charge died
    // on these with VALUE_TOO_LONG, so the fake refuses the same way.
    if (input.idempotencyKey.length > 45) throw new ProviderDeclinedError("VALUE_TOO_LONG", "Field must not be greater than 45 length");
    if (input.referenceId.length > 40) throw new ProviderDeclinedError("VALUE_TOO_LONG", "Field must not be greater than 40 length");
    const existingId = this.byIdempotency.get(input.idempotencyKey);
    if (existingId) return structuredClone(this.payments.get(existingId)!);
    if (!input.sourceId) throw new ProviderDeclinedError("INVALID_SOURCE", "Missing payment source.");
    if (input.sourceId.includes("decline")) throw new ProviderDeclinedError("CARD_DECLINED", "The card was declined.");
    const id = `fake_pay_${++this.seq}`;
    const p: SquarePayment = {
      id,
      status: input.method === "ach" ? "PENDING" : input.autocomplete === false ? "APPROVED" : "COMPLETED",
      amountCents: input.amountCents,
      currency: input.currency,
      method: input.method,
      referenceId: input.referenceId,
      orderId: `fake_order_${this.seq}`,
      receiptUrl: `https://squareup.com/receipt/preview/${id}`,
      feeCents: input.method === "card" ? Math.round(input.amountCents * 0.029) + 30 : Math.min(500, Math.round(input.amountCents * 0.01)),
      refundedCents: 0,
      card:
        input.method === "card"
          ? {
              brand: "VISA",
              cardType: input.sourceId.includes("debit") || input.sourceId.includes("prepaid") ? "DEBIT" : "CREDIT",
              prepaidType: input.sourceId.includes("prepaid") ? "PREPAID" : "NOT_PREPAID",
            }
          : null,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.payments.set(id, p);
    this.byIdempotency.set(input.idempotencyKey, id);
    if (input.sourceId.includes("timeout")) throw new ProviderUnknownOutcomeError("socket hang up after the request was transmitted");
    return structuredClone(p);
  }

  async completePayment(paymentId: string): Promise<SquarePayment> {
    const p = this.payments.get(paymentId);
    if (!p) throw new ProviderDeclinedError("NOT_FOUND", "No such payment.");
    if (p.status === "APPROVED") {
      p.status = "COMPLETED";
      p.updatedAt = this.now();
    } else if (p.status !== "COMPLETED") throw new ProviderDeclinedError("BAD_REQUEST", `Payment is ${p.status}; only APPROVED payments can be completed.`);
    return structuredClone(p);
  }

  async cancelPayment(paymentId: string): Promise<SquarePayment> {
    const p = this.payments.get(paymentId);
    if (!p) throw new ProviderDeclinedError("NOT_FOUND", "No such payment.");
    if (p.status === "APPROVED") {
      p.status = "CANCELED";
      p.updatedAt = this.now();
    } else if (p.status !== "CANCELED") throw new ProviderDeclinedError("BAD_REQUEST", `Payment is ${p.status}; only APPROVED payments can be canceled.`);
    return structuredClone(p);
  }

  async getPayment(paymentId: string): Promise<SquarePayment | null> {
    const p = this.payments.get(paymentId);
    if (!p) return null;
    const n = (this.polls.get(paymentId) ?? 0) + 1;
    this.polls.set(paymentId, n);
    if (p.method === "ach" && p.status === "PENDING" && n >= 2) {
      p.status = p.amountCents % 100 === 99 ? "FAILED" : "COMPLETED";
      p.updatedAt = this.now();
    }
    return structuredClone(p);
  }

  async listPaymentsSince(sinceIso: string): Promise<SquarePayment[]> {
    const t = new Date(sinceIso).getTime();
    return [...this.payments.values()].filter((p) => new Date(p.updatedAt).getTime() >= t).map((p) => structuredClone(p));
  }

  async createRefund(input: CreateRefundInput): Promise<SquareRefund> {
    const existing = this.refundsByIdempotency.get(input.idempotencyKey);
    if (existing) return structuredClone(this.refunds.get(existing)!);
    const p = this.payments.get(input.paymentId);
    if (!p) throw new ProviderDeclinedError("NOT_FOUND", "No such payment.");
    if (p.status !== "COMPLETED") throw new ProviderDeclinedError("NOT_REFUNDABLE", `Payment is ${p.status}; only completed payments can be refunded.`);
    if (input.amountCents > p.amountCents - p.refundedCents) throw new ProviderDeclinedError("AMOUNT_TOO_HIGH", "Refund exceeds the refundable amount.");
    const id = `fake_ref_${++this.seq}`;
    const r: SquareRefund = { id, paymentId: p.id, status: "COMPLETED", amountCents: input.amountCents, createdAt: this.now() };
    p.refundedCents += input.amountCents;
    p.refundIds = [...(p.refundIds ?? []), id];
    p.updatedAt = this.now();
    this.refunds.set(id, r);
    this.refundsByIdempotency.set(input.idempotencyKey, id);
    return structuredClone(r);
  }

  async getRefund(refundId: string): Promise<SquareRefund | null> {
    const r = this.refunds.get(refundId);
    return r ? structuredClone(r) : null;
  }

  async verifyConnection(locationId: string | null): Promise<SquareCapabilities> {
    return { merchantApproved: true, card: true, ach: true, refunds: true, locationName: locationId ? `Fake location ${locationId}` : "Fake location", note: "fake adapter — no Square account is connected" };
  }

  // ── Test helpers ────────────────────────────────────────────────────────

  /** Force an ACH payment's outcome (bank return / late failure). */
  setStatus(paymentId: string, status: SquarePayment["status"]): void {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error("no such fake payment");
    p.status = status;
    p.updatedAt = this.now();
  }

  /** A refund made in the Square Dashboard (no SJC OS request, no webhook). */
  dashboardRefund(paymentId: string, amountCents: number): SquareRefund {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error("no such fake payment");
    const id = `fake_ref_${++this.seq}`;
    const r: SquareRefund = { id, paymentId, status: "COMPLETED", amountCents, createdAt: this.now() };
    p.refundedCents += amountCents;
    p.refundIds = [...(p.refundIds ?? []), id];
    p.updatedAt = this.now();
    this.refunds.set(id, r);
    return structuredClone(r);
  }

  /** Build a signed webhook notification for a payment (replayable). */
  webhookEvent(type: "payment.created" | "payment.updated", paymentId: string, opts: { eventId?: string; notificationUrl?: string; signatureKey?: string } = {}): { body: string; signature: string; eventId: string; url: string } {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error("no such fake payment");
    const eventId = opts.eventId ?? `fake_evt_${++this.eventSeq}`;
    const body = JSON.stringify({
      merchant_id: "FAKEMERCHANT",
      type,
      event_id: eventId,
      created_at: this.now(),
      data: {
        type: "payment",
        id: p.id,
        object: {
          payment: {
            id: p.id,
            status: p.status,
            amount_money: { amount: p.amountCents, currency: p.currency },
            reference_id: p.referenceId,
            order_id: p.orderId,
            source_type: p.method === "ach" ? "BANK_ACCOUNT" : "CARD",
            ...(p.card ? { card_details: { card: { card_brand: p.card.brand, card_type: p.card.cardType, prepaid_type: p.card.prepaidType } } } : {}),
            refunded_money: { amount: p.refundedCents, currency: p.currency },
            processing_fee: p.feeCents == null ? [] : [{ amount_money: { amount: p.feeCents, currency: p.currency }, type: "INITIAL" }],
            updated_at: p.updatedAt,
            created_at: p.createdAt,
          },
        },
      },
    });
    const url = opts.notificationUrl ?? FAKE_NOTIFICATION_URL;
    return { body, signature: squareSignature(opts.signatureKey ?? FAKE_SIGNATURE_KEY, url, body), eventId, url };
  }
}

/** One shared fake per process (the app and its tests see the same "Square"). */
export const fakeSquare = new FakeSquare();
