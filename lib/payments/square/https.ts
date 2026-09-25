// Real Square Payments API adapter (A20). Constructed ONLY when
// SQUARE_ACCESS_TOKEN and SQUARE_ENV=sandbox|production are set and outbound
// is not disabled — never in tests. Secrets live in the environment; nothing
// here logs a request body, a source id or the token.
//
// Endpoints (Square-Version pinned): POST /v2/payments (idempotency_key),
// GET /v2/payments/{id}, GET /v2/payments?updated_at… (reconciliation),
// POST /v2/refunds, GET /v2/refunds/{id}, GET /v2/locations/{id}.

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

const SQUARE_VERSION = "2025-01-23";

interface RawMoney {
  amount?: number;
  currency?: string;
}
interface RawPayment {
  id: string;
  status: SquarePayment["status"];
  amount_money?: RawMoney;
  reference_id?: string;
  order_id?: string;
  receipt_url?: string;
  source_type?: string;
  processing_fee?: { amount_money?: RawMoney }[];
  refunded_money?: RawMoney;
  created_at?: string;
  updated_at?: string;
}
interface RawRefund {
  id: string;
  payment_id: string;
  status: SquareRefund["status"];
  amount_money?: RawMoney;
  created_at?: string;
}

export function mapRawPayment(p: RawPayment): SquarePayment {
  return {
    id: p.id,
    status: p.status,
    amountCents: Number(p.amount_money?.amount ?? 0),
    currency: p.amount_money?.currency ?? "USD",
    method: p.source_type === "BANK_ACCOUNT" ? "ach" : "card",
    referenceId: p.reference_id ?? null,
    orderId: p.order_id ?? null,
    receiptUrl: p.receipt_url ?? null,
    feeCents: p.processing_fee?.length ? p.processing_fee.reduce((s, f) => s + Number(f.amount_money?.amount ?? 0), 0) : null,
    refundedCents: Number(p.refunded_money?.amount ?? 0),
    createdAt: p.created_at ?? new Date().toISOString(),
    updatedAt: p.updated_at ?? p.created_at ?? new Date().toISOString(),
  };
}

function mapRawRefund(r: RawRefund): SquareRefund {
  return { id: r.id, paymentId: r.payment_id, status: r.status, amountCents: Number(r.amount_money?.amount ?? 0), createdAt: r.created_at ?? new Date().toISOString() };
}

export class HttpsSquare implements SquareAdapter {
  readonly environment: "sandbox" | "production";
  readonly ready = true;
  private base: string;
  private token: string;

  constructor(opts: { environment: "sandbox" | "production"; accessToken: string }) {
    this.environment = opts.environment;
    this.token = opts.accessToken;
    this.base = opts.environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { transmitIsUnknown?: boolean } = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      // A POST that may have been transmitted has an unknown outcome.
      if (opts.transmitIsUnknown) throw new ProviderUnknownOutcomeError((err as Error).message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: { errors?: { code?: string; detail?: string; category?: string }[] } & Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      if (opts.transmitIsUnknown) throw new ProviderUnknownOutcomeError(`unparseable ${res.status} response`);
      throw new Error(`Square returned ${res.status} with a non-JSON body`);
    }
    if (!res.ok) {
      const e = json.errors?.[0];
      if (res.status >= 500 || res.status === 429) {
        if (opts.transmitIsUnknown) throw new ProviderUnknownOutcomeError(`${res.status} ${e?.code ?? ""}`.trim());
        throw new Error(`Square ${res.status}: ${e?.detail ?? e?.code ?? "error"}`);
      }
      throw new ProviderDeclinedError(e?.code ?? `HTTP_${res.status}`, e?.detail ?? `Square refused the request (${res.status}).`);
    }
    return json as T;
  }

  async createPayment(input: CreatePaymentInput): Promise<SquarePayment> {
    const out = await this.call<{ payment: RawPayment }>(
      "POST",
      "/v2/payments",
      {
        idempotency_key: input.idempotencyKey,
        source_id: input.sourceId,
        amount_money: { amount: input.amountCents, currency: input.currency },
        location_id: input.locationId,
        reference_id: input.referenceId,
        note: input.note?.slice(0, 500),
        buyer_email_address: input.buyerEmail ?? undefined,
        autocomplete: true,
      },
      { transmitIsUnknown: true },
    );
    return mapRawPayment(out.payment);
  }

  async getPayment(paymentId: string): Promise<SquarePayment | null> {
    try {
      const out = await this.call<{ payment: RawPayment }>("GET", `/v2/payments/${encodeURIComponent(paymentId)}`);
      return mapRawPayment(out.payment);
    } catch (err) {
      if (err instanceof ProviderDeclinedError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  }

  async listPaymentsSince(sinceIso: string, locationId?: string | null): Promise<SquarePayment[]> {
    const q = new URLSearchParams({ begin_time: sinceIso, sort_order: "ASC", limit: "100" });
    if (locationId) q.set("location_id", locationId);
    const out: SquarePayment[] = [];
    let cursor: string | undefined;
    do {
      if (cursor) q.set("cursor", cursor);
      const page = await this.call<{ payments?: RawPayment[]; cursor?: string }>("GET", `/v2/payments?${q}`);
      for (const p of page.payments ?? []) out.push(mapRawPayment(p));
      cursor = page.cursor;
    } while (cursor && out.length < 1000);
    return out;
  }

  async createRefund(input: CreateRefundInput): Promise<SquareRefund> {
    const out = await this.call<{ refund: RawRefund }>(
      "POST",
      "/v2/refunds",
      { idempotency_key: input.idempotencyKey, payment_id: input.paymentId, amount_money: { amount: input.amountCents, currency: input.currency }, reason: input.reason.slice(0, 192) },
      { transmitIsUnknown: true },
    );
    return mapRawRefund(out.refund);
  }

  async getRefund(refundId: string): Promise<SquareRefund | null> {
    try {
      const out = await this.call<{ refund: RawRefund }>("GET", `/v2/refunds/${encodeURIComponent(refundId)}`);
      return mapRawRefund(out.refund);
    } catch (err) {
      if (err instanceof ProviderDeclinedError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  }

  async verifyConnection(locationId: string | null): Promise<SquareCapabilities> {
    if (!locationId) return { merchantApproved: false, card: false, ach: false, refunds: false, note: "Set the location id first." };
    const out = await this.call<{ location: { name?: string; status?: string; capabilities?: string[] } }>("GET", `/v2/locations/${encodeURIComponent(locationId)}`);
    const caps = out.location.capabilities ?? [];
    const active = out.location.status === "ACTIVE";
    return {
      merchantApproved: active,
      card: active && caps.includes("CREDIT_CARD_PROCESSING"),
      ach: active && caps.includes("AUTOMATIC_TRANSFERS"),
      refunds: active,
      locationName: out.location.name ?? null,
      note: `Square ${this.environment}: ${out.location.status ?? "unknown status"}; capabilities ${caps.join(", ") || "none reported"}`,
    };
  }
}
