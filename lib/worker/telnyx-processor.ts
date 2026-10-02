// Telnyx source-event processors (A03b). App-side module: it reaches the
// server-only comms code (lib/sms.ts, lib/voice.ts) and is loaded either by
// Next.js (webhook after()) or by scripts/sjcos-worker.mjs through
// lib/worker/node-hooks.mjs. Both processors are idempotent per Telnyx event
// id, so the webhook fast path, the worker and a late duplicate can all run
// them without a second effect.
//
//   messaging (message.*): inbound record / delivery receipt — one pass does
//   everything (MMS download included); the webhook runs it inline, the worker
//   is the recovery path.
//   voice (call.*): the webhook runs handleVoiceEvent phase=immediate (the
//   next Call Control command, latency-critical); the worker runs
//   phase=deferred (recording download, transcript + AI notes, voicemail work
//   item, owner push) — see docs/automation-reliability/recovery.md.

import { parseMessagingEvent } from "@/lib/comms/sms-inbound";
import { parseVoiceEvent } from "@/lib/comms/voice-flow";
import { applyDeliveryReceipt, recordInboundSms } from "@/lib/sms";
import { handleVoiceEvent } from "@/lib/voice";
import type { SourceEventProcessor, ProcessOutcome } from "./types";
import type { SourceEvent } from "@/lib/commands/source-events";

export const TELNYX_PROVIDER = "telnyx";

export async function processTelnyxMessaging(event: SourceEvent): Promise<ProcessOutcome> {
  const ev = parseMessagingEvent(event.payload);
  if (!ev) return { ok: true, note: "not a messaging event" };
  if (ev.eventType === "message.received" && ev.direction !== "outbound") {
    const r = await recordInboundSms(ev);
    return { ok: true, note: r.duplicate ? "duplicate inbound" : `inbound recorded in thread ${r.threadId}` };
  }
  if (ev.eventType === "message.sent" || ev.eventType === "message.finalized") {
    const r = await applyDeliveryReceipt(ev);
    return { ok: true, note: r.matched ? "receipt applied" : "receipt for unknown message" };
  }
  return { ok: true, note: `ignored ${ev.eventType}` };
}

export async function processTelnyxVoiceDeferred(event: SourceEvent): Promise<ProcessOutcome> {
  const ev = parseVoiceEvent(event.payload);
  if (!ev) return { ok: true, note: "not a call event" };
  const r = await handleVoiceEvent(ev, { phase: "deferred" });
  return { ok: true, note: r.note };
}

/** The worker-side processor for everything Telnyx sends. */
export const telnyxProcessor: SourceEventProcessor = {
  provider: TELNYX_PROVIDER,
  async process(event) {
    if (event.event_type.startsWith("message.")) return processTelnyxMessaging(event);
    if (event.event_type.startsWith("call.")) return processTelnyxVoiceDeferred(event);
    return { ok: true, note: `ignored ${event.event_type}` };
  },
};

/** Webhook-side (inline) processor for messaging events only. */
export const telnyxMessagingInline: SourceEventProcessor = {
  provider: TELNYX_PROVIDER,
  process: (event) => processTelnyxMessaging(event),
};
