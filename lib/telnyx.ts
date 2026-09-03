import "server-only";

// The ONLY module that talks to api.telnyx.com from the app. Messaging (SMS/
// MMS), Call Control (voice commands), the 10DLC read endpoints the daily
// watch polls, and the health probes. Every call: bearer from env, JSON in/
// out, a real timeout, and a TelnyxError that carries Telnyx's errors[] so
// callers can classify failures (lib/comms/sms-inbound.ts classifySendFailure)
// instead of showing "HTTP 422".
//
// Nothing here logs a body: bodies carry client phone numbers, message text
// and recording URLs. Errors are surfaced to the caller, which files a work
// item — never into the void.

import type { SmsConfig, VoiceConfig } from "@/lib/comms/env";
import type { ClientState } from "@/lib/comms/voice-flow";
import { encodeClientState } from "@/lib/comms/voice-flow";
import { TENDLC_PATHS } from "@/lib/comms/tendlc.mjs";

const BASE = () => (process.env.TELNYX_API_BASE ?? "https://api.telnyx.com/v2").replace(/\/$/, "");

export interface TelnyxApiError {
  code: string;
  title: string;
  detail: string;
}

export class TelnyxError extends Error {
  status: number;
  errors: TelnyxApiError[];
  constructor(status: number, errors: TelnyxApiError[], fallback: string) {
    super(errors.length ? errors.map((e) => `${e.code ? `[${e.code}] ` : ""}${e.detail || e.title}`).join("; ") : fallback);
    this.name = "TelnyxError";
    this.status = status;
    this.errors = errors;
  }
}

function parseErrors(body: unknown): TelnyxApiError[] {
  const errs = body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors) ? ((body as { errors: unknown[] }).errors) : [];
  return errs.map((e) => {
    const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    return { code: String(r.code ?? ""), title: String(r.title ?? ""), detail: String(r.detail ?? "") };
  });
}

export async function telnyxRequest<T = unknown>(
  apiKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 15_000,
): Promise<T> {
  if (!apiKey) throw new TelnyxError(0, [], "Telnyx API key is not configured.");
  let res: Response;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new TelnyxError(0, [], `Telnyx unreachable (${(e as Error).message})`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new TelnyxError(res.status, parseErrors(json), `Telnyx HTTP ${res.status}`);
  return json as T;
}

// ─── Messaging ───────────────────────────────────────────────────────────────

export interface SentMessage {
  id: string;
  toStatus: string | null;
}

export async function sendTelnyxMessage(
  cfg: SmsConfig,
  input: { to: string; text: string; mediaUrls?: string[] },
): Promise<SentMessage> {
  const out = await telnyxRequest<{ data?: { id?: string; to?: { status?: string }[] } }>(cfg.apiKey, "POST", "/messages", {
    from: cfg.fromNumber,
    to: input.to,
    text: input.text,
    messaging_profile_id: cfg.messagingProfileId,
    ...(input.mediaUrls?.length ? { media_urls: input.mediaUrls, type: "MMS" } : {}),
  });
  const id = out?.data?.id;
  if (!id) throw new TelnyxError(200, [], "Telnyx accepted the message but returned no id.");
  return { id, toStatus: out.data?.to?.[0]?.status ?? null };
}

/** Download a (short-lived) Telnyx media URL. Caps the size; no auth needed. */
export async function downloadMedia(url: string, maxBytes = 25 * 1024 * 1024): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`media download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new Error(`media too large (${len} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`media too large (${buf.length} bytes)`);
  return { bytes: buf, mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

// ─── Call Control ────────────────────────────────────────────────────────────

const cc = (leg: string, action: string) => `/calls/${encodeURIComponent(leg)}/actions/${action}`;

/** TTS voice for speak commands. "female"/"male" run on the basic (free-ish)
 *  service level; a Polly/ElevenLabs id switches to premium. */
function ttsVoice(): { voice: string; service_level: "basic" | "premium"; language?: string } {
  const v = (process.env.VOICE_TTS_VOICE ?? "female").trim();
  return v === "female" || v === "male" ? { voice: v, service_level: "basic", language: "en-US" } : { voice: v, service_level: "premium" };
}

export const callControl = {
  answer: (cfg: VoiceConfig, leg: string, state: ClientState) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "answer"), { client_state: encodeClientState(state) }),

  speak: (cfg: VoiceConfig, leg: string, text: string, state: ClientState) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "speak"), {
      payload: text.slice(0, 2900),
      payload_type: "text",
      ...ttsVoice(),
      client_state: encodeClientState(state),
    }),

  recordStart: (cfg: VoiceConfig, leg: string, opts: { playBeep: boolean; state: ClientState }) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "record_start"), {
      format: "mp3",
      channels: "dual",
      play_beep: opts.playBeep,
      max_length: Number(process.env.VOICE_RECORDING_MAX_S ?? 7200),
      ...(cfg.transcription === "telnyx"
        ? {
            transcription: true,
            transcription_engine: (process.env.VOICE_TRANSCRIPTION_ENGINE ?? "B").trim(),
            transcription_language: "en-US",
          }
        : {}),
      client_state: encodeClientState(opts.state),
    }),

  dial: async (
    cfg: VoiceConfig,
    input: { to: string; from: string; timeoutSecs: number; linkTo: string | null; state: ClientState },
  ): Promise<{ callControlId: string; callLegId: string | null; callSessionId: string | null }> => {
    const out = await telnyxRequest<{ data?: { call_control_id?: string; call_leg_id?: string; call_session_id?: string } }>(
      cfg.apiKey,
      "POST",
      "/calls",
      {
        connection_id: cfg.applicationId,
        to: input.to,
        from: input.from,
        timeout_secs: input.timeoutSecs,
        time_limit_secs: Number(process.env.VOICE_CALL_MAX_S ?? 7200),
        ...(input.linkTo ? { link_to: input.linkTo } : {}),
        client_state: encodeClientState(input.state),
      },
    );
    const id = out?.data?.call_control_id;
    if (!id) throw new TelnyxError(200, [], "Telnyx dial returned no call_control_id.");
    return { callControlId: id, callLegId: out.data?.call_leg_id ?? null, callSessionId: out.data?.call_session_id ?? null };
  },

  bridge: (cfg: VoiceConfig, leg: string, withLeg: string, state: ClientState) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "bridge"), {
      call_control_id: withLeg,
      client_state: encodeClientState(state),
    }),

  playbackStart: (cfg: VoiceConfig, leg: string, audioUrl: string, opts: { loop: boolean; state: ClientState }) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "playback_start"), {
      audio_url: audioUrl,
      audio_type: "wav",
      ...(opts.loop ? { loop: "infinity" } : {}),
      client_state: encodeClientState(opts.state),
    }),

  playbackStop: (cfg: VoiceConfig, leg: string) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "playback_stop"), { stop: "all" }),

  hangup: (cfg: VoiceConfig, leg: string, state?: ClientState) =>
    telnyxRequest(cfg.apiKey, "POST", cc(leg, "hangup"), state ? { client_state: encodeClientState(state) } : {}),
};

// ─── 10DLC reads (daily watch) ───────────────────────────────────────────────

export const tendlcApi = {
  brand: (apiKey: string, brandId: string) => telnyxRequest<Record<string, unknown>>(apiKey, "GET", TENDLC_PATHS.brandGet(brandId)),
  campaign: (apiKey: string, campaignId: string) => telnyxRequest<Record<string, unknown>>(apiKey, "GET", TENDLC_PATHS.campaignGet(campaignId)),
  assignment: (apiKey: string, phone: string) => telnyxRequest<Record<string, unknown>>(apiKey, "GET", TENDLC_PATHS.phoneNumberCampaignGet(phone)),
};

// ─── Health probes ───────────────────────────────────────────────────────────

export async function probeMessagingProfile(apiKey: string, profileId: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const out = await telnyxRequest<{ data?: { name?: string } }>(apiKey, "GET", `/messaging_profiles/${encodeURIComponent(profileId)}`, undefined, 10_000);
    return { ok: true, name: out?.data?.name ?? profileId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function probeCallControlApp(apiKey: string, appId: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const out = await telnyxRequest<{ data?: { application_name?: string } }>(apiKey, "GET", `/call_control_applications/${encodeURIComponent(appId)}`, undefined, 10_000);
    return { ok: true, name: out?.data?.application_name ?? appId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
