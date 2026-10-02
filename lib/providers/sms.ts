// SMS provider (Telnyx messaging through lib/telnyx.ts).
//
// Telnyx answers a POST /messages with the message id; that id is the
// provider reference the delivery-receipt webhook (lib/sms.ts
// applyDeliveryReceipt) later matches, so an 'accepted' intent becomes
// 'confirmed' from the provider's own event, never from a guess. An intent
// that timed out AFTER the request was written stays 'unknown' until a
// receipt arrives or GET /messages/{id} (when we have an id) settles it.

import { classifyTransportError, outboundDisabled, recordFakeSend, type Provider, type ProviderResult, type ReconcileOutcome } from "./types.ts";

export interface SmsPayload {
  to: string; // +E.164
  text: string;
  mediaUrls?: string[];
  [k: string]: unknown;
}

export interface SmsTransport {
  configured(): Promise<boolean> | boolean;
  send(msg: { to: string; text: string; mediaUrls?: string[] }): Promise<{ id: string; toStatus: string | null }>;
  /** GET /messages/{id} → delivery status, or null when Telnyx has no such message. */
  status?(id: string): Promise<{ status: string } | null>;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Telnyx's own "we tried but the carrier said no" words. */
const TELNYX_TERMINAL = /failed|undeliverable|rejected|expired/i;
const TELNYX_FINAL_OK = /delivered/i;

export function makeSmsProvider(transport: SmsTransport = defaultTransport): Provider<SmsPayload> {
  return {
    name: "sms",
    async send(payload, ctx): Promise<ProviderResult> {
      const to = String(payload.to ?? "").trim();
      const text = String(payload.text ?? "").trim();
      if (!E164.test(to)) return { responseClass: "permanent", error: `"${to || "(empty)"}" is not a +E.164 phone number.`, transmitted: false };
      if (!text) return { responseClass: "permanent", error: "Empty message.", transmitted: false };
      if (text.length > 1600) return { responseClass: "permanent", error: "Message is too long (1600 characters max).", transmitted: false };
      if (outboundDisabled()) return recordFakeSend("sms", payload, ctx);
      if (!(await transport.configured())) return { responseClass: "permanent", error: "SMS is not configured (SMS_* env).", transmitted: false };
      try {
        const out = await transport.send({ to, text, mediaUrls: payload.mediaUrls });
        const st = out.toStatus ?? "queued";
        return { responseClass: TELNYX_FINAL_OK.test(st) ? "confirmed" : "accepted", providerRef: out.id, providerState: st, transmitted: true };
      } catch (err) {
        return classifyTransportError(err, { status: (err as { status?: number }).status ?? null });
      }
    },
    async reconcile(intent): Promise<ReconcileOutcome> {
      if (outboundDisabled()) return { state: "unknown", note: "outbound disabled; nothing to reconcile against" };
      if (!intent.providerRef) return { state: "unknown", note: "no Telnyx message id was recorded; waiting for a delivery receipt or owner review" };
      if (!transport.status) return { state: "unknown", note: "transport cannot poll message status" };
      try {
        const s = await transport.status(intent.providerRef);
        if (!s) return { state: "permanent_failure", note: "Telnyx has no message with the recorded id" };
        if (TELNYX_FINAL_OK.test(s.status)) return { state: "confirmed", providerState: s.status, note: "Telnyx reports delivered" };
        if (TELNYX_TERMINAL.test(s.status)) return { state: "permanent_failure", note: `Telnyx reports ${s.status}` };
        return { state: "unknown", note: `Telnyx reports ${s.status}` };
      } catch (err) {
        return { state: "unknown", note: `status poll failed: ${(err as Error).message}` };
      }
    },
  };
}

const defaultTransport: SmsTransport = {
  async configured() {
    const { smsConfigFrom } = await import("../comms/env");
    return smsConfigFrom() !== null;
  },
  async send(msg) {
    const [{ smsConfigFrom }, { sendTelnyxMessage }] = await Promise.all([import("../comms/env"), import("../telnyx")]);
    const cfg = smsConfigFrom();
    if (!cfg) throw Object.assign(new Error("SMS is not configured."), { status: 400 });
    return sendTelnyxMessage(cfg, { to: msg.to, text: msg.text, mediaUrls: msg.mediaUrls });
  },
  async status(id) {
    const [{ smsConfigFrom }, { telnyxRequest, TelnyxError }] = await Promise.all([import("../comms/env"), import("../telnyx")]);
    const cfg = smsConfigFrom();
    if (!cfg) return null;
    try {
      const out = await telnyxRequest<{ data?: { to?: { status?: string }[] } }>(cfg.apiKey, "GET", `/messages/${encodeURIComponent(id)}`);
      return { status: out?.data?.to?.[0]?.status ?? "unknown" };
    } catch (err) {
      if (err instanceof TelnyxError && err.status === 404) return null;
      throw err;
    }
  },
};
