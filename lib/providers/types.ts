// Provider adapters — the ONLY code that talks to an outbound provider on
// behalf of an intent (A05/A06). Every adapter maps the provider's real
// answer onto one vocabulary the dispatcher understands:
//
//   accepted   the provider took the request (queued / sent); a later
//              webhook or poll may confirm delivery
//   confirmed  the provider proved the effect (delivered / bridged)
//   retryable  refused BEFORE anything transmitted (connection refused,
//              DNS, 429 with no request body accepted) — safe to try again
//   unknown    we cannot tell whether it went out (timeout AFTER the request
//              was written, 5xx, malformed success body) — HELD for
//              reconciliation, never retried blindly, never refunded
//   permanent  the provider rejected it for good (4xx validation, bad
//              recipient, missing config) — no retry
//
// `transmitted` says whether the request left this box; a refund of a grant
// use is only ever allowed when it is false.
//
// Fake mode: when process.env.SJC_OUTBOUND_DISABLED === "1" (the test harness
// sets it) no adapter contacts the network. The would-be send is appended to
// the in-memory `fakeOutbox` and answered 'accepted' unless a test installed
// an outcome override (setFakeOutcome).
//
// Pure module: no db, no "server-only", no "@/…" imports — tests drive it.

export type ProviderResponseClass = "accepted" | "confirmed" | "retryable" | "unknown" | "permanent";

export interface ProviderResult {
  responseClass: ProviderResponseClass;
  /** The provider's id for this effect (Gmail message id, Telnyx message id, call control id, Telegram message id). */
  providerRef?: string | null;
  providerState?: string | null;
  error?: string | null;
  /** Did the request leave this box? False only when the failure happened before the write. */
  transmitted: boolean;
  /** Backoff hint for retryable failures. */
  retryInSeconds?: number;
}

export interface ProviderContext {
  operationKey: string;
  intentId: string;
  attempt: number;
}

export type ReconcileOutcome =
  | { state: "confirmed"; providerRef?: string | null; providerState?: string | null; note?: string }
  | { state: "permanent_failure"; note: string }
  | { state: "pending"; note: string } // provably never happened → safe to retry
  | { state: "unknown"; note: string }; // still cannot tell

export interface Provider<P = Record<string, unknown>> {
  readonly name: string;
  send(payload: P, ctx: ProviderContext): Promise<ProviderResult>;
  /** Establish what really happened for an 'unknown'/'accepted' intent. */
  reconcile?(intent: { id: string; operationKey: string; payload: P; providerRef: string | null; attemptedAt: string | null }): Promise<ReconcileOutcome>;
}

export function outboundDisabled(): boolean {
  return process.env.SJC_OUTBOUND_DISABLED === "1";
}

export interface FakeSend {
  n: number;
  provider: string;
  operationKey: string;
  intentId: string;
  payload: Record<string, unknown>;
  at: string;
  result: ProviderResult;
}

/** Everything a fake-mode adapter "sent", in order. Tests read and reset it. */
export const fakeOutbox: FakeSend[] = [];

type FakeOutcome = (provider: string, payload: Record<string, unknown>, ctx: ProviderContext) => ProviderResult | undefined;
let fakeOutcome: FakeOutcome | null = null;

/** Test seam: decide what a fake send answers (return undefined for the default 'accepted'). */
export function setFakeOutcome(fn: FakeOutcome | null): void {
  fakeOutcome = fn;
}

export function resetFakeOutbox(): void {
  fakeOutbox.length = 0;
  fakeOutcome = null;
}

export function recordFakeSend(provider: string, payload: Record<string, unknown>, ctx: ProviderContext): ProviderResult {
  const override = fakeOutcome?.(provider, payload, ctx);
  const n = fakeOutbox.length + 1;
  const result: ProviderResult = override ?? { responseClass: "accepted", providerRef: `fake:${provider}:${n}`, transmitted: true };
  fakeOutbox.push({ n, provider, operationKey: ctx.operationKey, intentId: ctx.intentId, payload, at: new Date().toISOString(), result });
  return result;
}

/** Errors thrown by a transport BEFORE the request body was written: the
 *  provider never saw it. */
export class NotTransmittedError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent = false) {
    super(message);
    this.name = "NotTransmittedError";
    this.permanent = permanent;
  }
}

const PRE_TRANSMIT = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET before|socket hang up before|getaddrinfo|network unreachable|ENETUNREACH|EHOSTUNREACH/i;
const TIMEOUT = /timeout|timed out|aborted|AbortError|ETIMEDOUT|ECONNRESET|socket hang up|EPIPE/i;

/** Map a thrown transport error to a result. `status` is the HTTP status when
 *  the provider answered at all. The default for anything ambiguous is
 *  'unknown' — the request may have been processed. */
export function classifyTransportError(err: unknown, opts: { status?: number | null; messageHint?: string } = {}): ProviderResult {
  const message = (err instanceof Error ? err.message : String(err)) || "provider call failed";
  const status = opts.status ?? (err as { status?: number; code?: number })?.status ?? (typeof (err as { code?: unknown })?.code === "number" ? ((err as { code: number }).code) : null);
  if (err instanceof NotTransmittedError) {
    return { responseClass: err.permanent ? "permanent" : "retryable", error: message, transmitted: false };
  }
  if (typeof status === "number" && status > 0) {
    if (status === 429) return { responseClass: "retryable", error: message, transmitted: true, retryInSeconds: 120 };
    if (status === 408) return { responseClass: "unknown", error: message, transmitted: true };
    if (status >= 400 && status < 500) return { responseClass: "permanent", error: message, transmitted: true };
    // 5xx: the provider may or may not have acted before failing.
    return { responseClass: "unknown", error: message, transmitted: true };
  }
  if (PRE_TRANSMIT.test(message)) return { responseClass: "retryable", error: message, transmitted: false, retryInSeconds: 60 };
  if (TIMEOUT.test(message)) return { responseClass: "unknown", error: message, transmitted: true };
  return { responseClass: "unknown", error: message, transmitted: true };
}
