// Voice provider (Telnyx Call Control dial through lib/telnyx.ts).
//
// A click-to-call rings the caller first (their cell, or their browser tab); the intent's effect is the dial of
// that first leg. The call_control_id Telnyx returns is the provider ref; the
// voice webhook (lib/voice.ts handleVoiceEvent) carries the call from there.

import { classifyTransportError, outboundDisabled, recordFakeSend, type Provider, type ProviderResult, type ReconcileOutcome } from "./types.ts";

export interface VoicePayload {
  /** Internal calls.id, carried in client_state so the webhook finds the row. */
  callId: string;
  /** The first leg: the caller's cell (+E.164), or their browser phone
   *  (sip:<user>@sip.telnyx.com, lib/voice-browser.ts). */
  to: string;
  from: string;
  timeoutSecs: number;
  /** The counterparty the call is about (for the audit line only). */
  counterparty: string;
  [k: string]: unknown;
}

export interface VoiceTransport {
  configured(): Promise<boolean> | boolean;
  dial(p: VoicePayload): Promise<{ callControlId: string; callLegId: string | null; callSessionId: string | null }>;
  status?(callControlId: string): Promise<{ state: string } | null>;
}

const E164 = /^\+[1-9]\d{6,14}$/;
/** The caller's own browser phone (a Telnyx telephony credential on our account). */
const BROWSER_SIP = /^sip:[A-Za-z0-9_.-]{3,64}@sip\.telnyx\.com$/;

export function makeVoiceProvider(transport: VoiceTransport = defaultTransport): Provider<VoicePayload> {
  return {
    name: "voice",
    async send(payload, ctx): Promise<ProviderResult> {
      const first = String(payload.to ?? "");
      if (!E164.test(first) && !BROWSER_SIP.test(first)) return { responseClass: "permanent", error: `"${payload.to}" is not a +E.164 number or a browser phone address.`, transmitted: false };
      if (outboundDisabled()) return recordFakeSend("voice", payload, ctx);
      if (!(await transport.configured())) return { responseClass: "permanent", error: "Voice is not configured (VOICE_APPLICATION_ID unset).", transmitted: false };
      try {
        const leg = await transport.dial(payload);
        return { responseClass: "accepted", providerRef: leg.callControlId, providerState: leg.callSessionId ? `session:${leg.callSessionId}` : "dialing", transmitted: true };
      } catch (err) {
        return classifyTransportError(err, { status: (err as { status?: number }).status ?? null });
      }
    },
    async reconcile(intent): Promise<ReconcileOutcome> {
      if (outboundDisabled()) return { state: "unknown", note: "outbound disabled; nothing to reconcile against" };
      if (!intent.providerRef || !transport.status) return { state: "unknown", note: "no call control id recorded; the voice webhook or the daily call sweep settles this" };
      try {
        const s = await transport.status(intent.providerRef);
        if (!s) return { state: "permanent_failure", note: "Telnyx has no call with the recorded id" };
        return { state: "confirmed", providerState: s.state, note: `Telnyx reports ${s.state}` };
      } catch (err) {
        return { state: "unknown", note: `status poll failed: ${(err as Error).message}` };
      }
    },
  };
}

const defaultTransport: VoiceTransport = {
  async configured() {
    const { voiceConfigFrom } = await import("../comms/env");
    return voiceConfigFrom() !== null;
  },
  async dial(p) {
    const [{ voiceConfigFrom }, { callControl }] = await Promise.all([import("../comms/env"), import("../telnyx")]);
    const cfg = voiceConfigFrom();
    if (!cfg) throw Object.assign(new Error("Voice is not configured."), { status: 400 });
    return callControl.dial(cfg, {
      to: p.to,
      from: p.from,
      timeoutSecs: p.timeoutSecs,
      linkTo: null,
      state: { c: p.callId, r: "owner", p: "answered" },
      // The browser phone only auto-answers the call it asked for.
      ...(p.to.startsWith("sip:") ? { customHeaders: [{ name: "X-SJC-Call", value: p.callId }] } : {}),
    });
  },
  async status(id) {
    const [{ voiceConfigFrom }, { telnyxRequest, TelnyxError }] = await Promise.all([import("../comms/env"), import("../telnyx")]);
    const cfg = voiceConfigFrom();
    if (!cfg) return null;
    try {
      const out = await telnyxRequest<{ data?: { is_alive?: boolean } }>(cfg.apiKey, "GET", `/calls/${encodeURIComponent(id)}`);
      return { state: out?.data?.is_alive ? "alive" : "ended" };
    } catch (err) {
      if (err instanceof TelnyxError && err.status === 404) return null;
      throw err;
    }
  },
};
