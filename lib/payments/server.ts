import "server-only";

// Pool-bound glue for customer payments (A20): provider config reads, the
// checkout core the portal route calls, webhook processing and the
// reconciliation sweep. Secrets stay in env; nothing here logs a source id.

import { withTransaction, runDirect } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { recordSourceEvent } from "@/lib/commands/source-events";
import { getSquareAdapter, squareEnvironment, squareWebhookConfig } from "./square/index";
import { verifyWebhookSignature, SQUARE_SIGNATURE_HEADER } from "./square/signature";
import {
  prepareAttempt,
  chargeAttempt,
  applyProviderPayment,
  markAttemptDeclined,
  markAttemptUnknown,
  processSquareEvent,
  reconcilePendingAttempts,
  type AttemptRow,
  type SquareWebhookEnvelope,
} from "./service";
import type { PaymentMethod } from "./square/types";

export interface ProviderConfig {
  provider: string;
  environment: "sandbox" | "production";
  location_id: string;
  application_id: string;
  notification_url: string;
  connection_state: "unconfigured" | "configured" | "connected" | "error";
  capabilities: Record<string, unknown>;
  last_error: string | null;
  verified_at: string | null;
}

export async function getProviderConfig(): Promise<ProviderConfig | null> {
  const rows = await runDirect<ProviderConfig>(
    `SELECT provider, environment, location_id, application_id, notification_url, connection_state, capabilities, last_error, verified_at::text AS verified_at
       FROM payment_provider_config WHERE provider = 'square'`,
  );
  return rows[0] ?? null;
}

/** What the portal needs to decide between the Square SDK and the offline text. */
export async function portalPaymentSetup(): Promise<
  | { online: true; applicationId: string; locationId: string; environment: "sandbox" | "production" | "fake"; card: boolean; ach: boolean }
  | { online: false; instructions: string }
> {
  const cfg = await getProviderConfig();
  const env = squareEnvironment();
  const offline = await runDirect<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'payments.offline_instructions'`);
  const instructions = offline[0]?.value?.trim() || "Online payment isn't set up yet. Pay by check to SJ Carpentry LLC, or use the payment link Joe sends you.";
  const connected = !!cfg && cfg.connection_state === "connected" && !!cfg.application_id && !!cfg.location_id;
  if (!connected) return { online: false, instructions };
  const caps = cfg!.capabilities as { card?: boolean; ach?: boolean };
  return { online: true, applicationId: cfg!.application_id, locationId: cfg!.location_id, environment: env === "fake" ? "fake" : cfg!.environment, card: caps.card !== false, ach: caps.ach === true };
}

export type CheckoutResult =
  | { ok: true; state: AttemptRow["state"]; attemptId: string; amountCents: number; reused: boolean; message: string }
  | { ok: false; code: string; reason: string; status: number };

/** Checkout core: prepare (server amount, idempotent attempt) → provider call
 *  outside the tx → apply provider state. */
export async function checkout(input: { invoiceId: number; method: PaymentMethod; nonce: string; sourceId: string; expectedAmountCents?: number | null; expectedRevision?: number | null; buyerEmail?: string | null; actor: Principal | string }): Promise<CheckoutResult> {
  const cfg = await getProviderConfig();
  const adapter = getSquareAdapter();
  const connected = adapter.environment === "fake" ? true : !!cfg && cfg.connection_state === "connected" && !!cfg.location_id;
  if (!connected) return { ok: false, code: "not_configured", reason: "Online payment isn't set up yet.", status: 503 };
  const prep = await withTransaction((run) => prepareAttempt(run, { invoiceId: input.invoiceId, method: input.method, nonce: input.nonce, expectedAmountCents: input.expectedAmountCents, expectedRevision: input.expectedRevision, actor: input.actor }));
  if (!prep.ok) return { ok: false, code: prep.code, reason: prep.reason, status: prep.code === "not_found" ? 404 : 409 };
  if (prep.reused && ["pending", "completed", "refunded", "failed", "disputed"].includes(prep.attempt.state)) {
    return { ok: true, state: prep.attempt.state, attemptId: prep.attempt.id, amountCents: prep.attempt.amount_cents, reused: true, message: describe(prep.attempt.state, prep.attempt.method) };
  }
  const outcome = await chargeAttempt(adapter, prep.attempt, { sourceId: input.sourceId, locationId: cfg?.location_id || "fake", buyerEmail: input.buyerEmail ?? null, note: `Invoice ${prep.invoice.number}` });
  if (outcome.kind === "declined") {
    const a = await withTransaction((run) => markAttemptDeclined(run, prep.attempt.id, outcome.code, outcome.reason));
    return { ok: false, code: "declined", reason: outcome.reason, status: 402, ...(a ? {} : {}) };
  }
  if (outcome.kind === "unknown") {
    await withTransaction((run) => markAttemptUnknown(run, prep.attempt.id, outcome.reason));
    return { ok: true, state: "unknown", attemptId: prep.attempt.id, amountCents: prep.attempt.amount_cents, reused: prep.reused, message: "We didn't get a clear answer from the payment processor. Don't pay again — we'll confirm within a few minutes and email you." };
  }
  const applied = await withTransaction((run) => applyProviderPayment(run, { attemptId: prep.attempt.id, payment: outcome.payment, actor: input.actor }));
  const state = applied?.attempt.state ?? "unknown";
  return { ok: true, state, attemptId: prep.attempt.id, amountCents: prep.attempt.amount_cents, reused: prep.reused, message: describe(state, prep.attempt.method) };
}

function describe(state: AttemptRow["state"], method: PaymentMethod): string {
  switch (state) {
    case "completed":
      return "Payment received — thank you.";
    case "pending":
      return method === "ach" ? "Bank transfer started. It usually settles in 3–5 business days; the invoice shows as paid once it clears." : "Payment is processing.";
    case "failed":
      return "The payment did not go through. Nothing was charged.";
    case "refunded":
      return "This payment was refunded.";
    case "returned":
      return "This bank transfer was returned by your bank.";
    case "disputed":
      return "This payment needs a look from SJ Carpentry; nothing further is charged.";
    default:
      return "We are confirming this payment with the processor.";
  }
}

/** Verify on the RAW body, persist to source_events, then process. Returns
 *  the HTTP status to answer with; the event is durable before any 200. */
export async function handleSquareWebhook(rawBody: string, signatureHeader: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const { signatureKey, notificationUrl } = squareWebhookConfig();
  const verified = verifyWebhookSignature(rawBody, signatureHeader, notificationUrl, signatureKey);
  let payload: SquareWebhookEnvelope;
  try {
    payload = JSON.parse(rawBody) as SquareWebhookEnvelope;
  } catch {
    return { status: 400, body: { error: "malformed json" } };
  }
  const eventId = typeof payload.event_id === "string" && payload.event_id ? payload.event_id : null;
  if (!eventId) return { status: 400, body: { error: "missing event_id" } };
  const { event, created } = await withTransaction((run) =>
    recordSourceEvent(run, { provider: "square", account: typeof payload.merchant_id === "string" ? payload.merchant_id : "", eventId, eventType: payload.type ?? "", payload: payload as Record<string, unknown>, verified, sourceAt: payload.created_at ?? null, ignore: !verified }),
  );
  if (!verified) return { status: 401, body: { error: "signature verification failed", recorded: event.id } };
  try {
    const r = await withTransaction(async (run) => {
      const out = await processSquareEvent(run, { payload, sourceEventId: event.id });
      await run(`UPDATE source_events SET state = 'done', processed_at = now() WHERE id = $1 AND state IN ('pending','failed')`, [event.id]);
      return out;
    });
    return { status: 200, body: { ok: true, duplicate: !created, ...r } };
  } catch (err) {
    // Durable already; the worker / next delivery retries processing.
    await withTransaction((run) => run(`UPDATE source_events SET state = 'failed', last_error = $2, attempts = attempts + 1 WHERE id = $1`, [event.id, String((err as Error).message).slice(0, 2000)]));
    return { status: 200, body: { ok: true, deferred: true } };
  }
}

export { SQUARE_SIGNATURE_HEADER };

export async function runPaymentsReconcile(principal: Principal) {
  const adapter = getSquareAdapter();
  return withTransaction((run) => reconcilePendingAttempts(run, adapter, { principal }));
}
