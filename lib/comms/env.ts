// Provider configuration for SMS + voice, validated as a whole. Pure: takes an
// env object so the unit tests can drive it and so the same report serves
// startup (instrumentation.ts), the health endpoint and every send path.
//
// Semantics — fail closed, fail loud:
//   • A feature is ENABLED when its switch var is set (SMS_PROVIDER for
//     messaging, VOICE_APPLICATION_ID for voice, TELNYX_API_KEY for 10DLC).
//     Unset switch = feature inert: one calm log line, nothing else complains.
//   • An enabled feature with ANY missing/invalid var is BROKEN: the report
//     names every missing var at once (never just the first), the feature
//     refuses to run (config getters return null), and the startup check
//     files a work item + pushes Joe.
//   • The 10DLC block is only needed by scripts/register-10dlc.mjs and the
//     daily registration watch; it is reported, not enforced, at app startup.
//
// Twilio is gone for good (account banned 2026-08-29): SMS_PROVIDER must be
// exactly "telnyx"; SMS_ACCOUNT_SID / SMS_AUTH_TOKEN / SMS_WEBHOOK_SECRET are
// flagged as stale if still present.

import { isE164 } from "./phone.ts";

export type EnvLike = Record<string, string | undefined>;

export const SMS_VARS = [
  "SMS_PROVIDER",
  "SMS_API_KEY",
  "SMS_MESSAGING_PROFILE_ID",
  "SMS_FROM_NUMBER",
  "SMS_PUBLIC_KEY",
] as const;
export const VOICE_VARS = [
  "VOICE_APPLICATION_ID",
  "VOICE_FROM_NUMBER",
  "VOICE_FORWARD_TO",
  "VOICE_RECORDING",
  "VOICE_RECORDING_ANNOUNCEMENT",
  "VOICE_TRANSCRIPTION",
] as const;
export const TENDLC_VARS = [
  "TELNYX_API_KEY",
  "TENDLC_LEGAL_NAME",
  "TENDLC_DISPLAY_NAME",
  "TENDLC_EIN",
  "TENDLC_PHONE",
  "TENDLC_STREET",
  "TENDLC_CITY",
  "TENDLC_STATE",
  "TENDLC_POSTAL_CODE",
  "TENDLC_COUNTRY",
  "TENDLC_EMAIL",
  "TENDLC_WEBSITE",
  "TENDLC_VERTICAL",
] as const;
/** Removed with Twilio. Present = somebody's .env.local is stale. */
export const STALE_VARS = ["SMS_ACCOUNT_SID", "SMS_AUTH_TOKEN", "SMS_WEBHOOK_SECRET"] as const;

export interface FeatureReport {
  /** Switch var present → the feature is meant to run. */
  enabled: boolean;
  /** enabled && nothing missing/invalid. */
  ok: boolean;
  missing: string[];
  invalid: string[];
}

export interface CommsEnvReport {
  sms: FeatureReport;
  voice: FeatureReport;
  tendlc: FeatureReport;
  stale: string[];
  /** One line per problem, ready for a log or a work-item body. */
  problems: string[];
}

export interface SmsConfig {
  provider: "telnyx";
  apiKey: string;
  messagingProfileId: string;
  fromNumber: string;
  publicKey: string;
}

export interface VoiceConfig {
  applicationId: string;
  fromNumber: string;
  forwardTo: string;
  recording: "all" | "off";
  announcement: "on" | "off";
  transcription: "telnyx";
  /** SMS_API_KEY — one Telnyx account, one bearer for both products. */
  apiKey: string;
  publicKey: string;
}

const v = (env: EnvLike, k: string) => (env[k] ?? "").trim();

function report(
  env: EnvLike,
  vars: readonly string[],
  switchVar: string,
  validate: (missing: string[], invalid: string[]) => void,
): FeatureReport {
  const enabled = v(env, switchVar) !== "";
  const missing = vars.filter((k) => v(env, k) === "");
  const invalid: string[] = [];
  if (enabled) validate(missing, invalid);
  return { enabled, ok: enabled && missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function commsEnvReport(env: EnvLike = process.env as EnvLike): CommsEnvReport {
  const sms = report(env, SMS_VARS, "SMS_PROVIDER", (missing, invalid) => {
    const p = v(env, "SMS_PROVIDER").toLowerCase();
    if (p !== "telnyx") {
      invalid.push(`SMS_PROVIDER must be "telnyx" (got "${p}") — Twilio is banned; no other provider is wired`);
    }
    if (!missing.includes("SMS_FROM_NUMBER") && !isE164(v(env, "SMS_FROM_NUMBER"))) {
      invalid.push("SMS_FROM_NUMBER must be +E.164 (e.g. +16125551234)");
    }
    if (!missing.includes("SMS_PUBLIC_KEY") && Buffer.from(v(env, "SMS_PUBLIC_KEY"), "base64").length !== 32) {
      invalid.push("SMS_PUBLIC_KEY must be the base64 raw Ed25519 public key (32 bytes)");
    }
  });
  const voice = report(env, VOICE_VARS, "VOICE_APPLICATION_ID", (missing, invalid) => {
    for (const k of ["VOICE_FROM_NUMBER", "VOICE_FORWARD_TO"]) {
      if (!missing.includes(k) && !isE164(v(env, k))) invalid.push(`${k} must be +E.164`);
    }
    const rec = v(env, "VOICE_RECORDING");
    if (rec && !["all", "off"].includes(rec)) invalid.push(`VOICE_RECORDING must be "all" or "off" (got "${rec}")`);
    const ann = v(env, "VOICE_RECORDING_ANNOUNCEMENT");
    if (ann && !["on", "off"].includes(ann)) {
      invalid.push(`VOICE_RECORDING_ANNOUNCEMENT must be "on" or "off" (got "${ann}")`);
    }
    const tr = v(env, "VOICE_TRANSCRIPTION");
    if (tr && tr !== "telnyx") {
      invalid.push(`VOICE_TRANSCRIPTION must be "telnyx" (got "${tr}") — the local Whisper path is not built`);
    }
    // Voice commands and webhook verification share the messaging credentials.
    if (v(env, "SMS_API_KEY") === "") missing.push("SMS_API_KEY (voice commands use the same Telnyx bearer)");
    if (v(env, "SMS_PUBLIC_KEY") === "") missing.push("SMS_PUBLIC_KEY (voice webhooks are signed with the same key)");
  });
  const tendlc = report(env, TENDLC_VARS, "TELNYX_API_KEY", (missing, invalid) => {
    if (!missing.includes("TENDLC_EIN") && !/^\d{2}-\d{7}$/.test(v(env, "TENDLC_EIN"))) {
      invalid.push("TENDLC_EIN must look like 12-3456789");
    }
    if (!missing.includes("TENDLC_PHONE") && !isE164(v(env, "TENDLC_PHONE"))) invalid.push("TENDLC_PHONE must be +E.164");
    if (!missing.includes("TENDLC_WEBSITE") && !/^https:\/\//i.test(v(env, "TENDLC_WEBSITE"))) {
      invalid.push("TENDLC_WEBSITE must start with https://");
    }
    if (!missing.includes("TENDLC_STREET") && /p\.?\s?o\.?\s?box/i.test(v(env, "TENDLC_STREET"))) {
      invalid.push("TENDLC_STREET must not be a P.O. box");
    }
    if (!missing.includes("TENDLC_COUNTRY") && v(env, "TENDLC_COUNTRY").toUpperCase() !== "US") {
      invalid.push("TENDLC_COUNTRY must be US");
    }
  });
  const stale = STALE_VARS.filter((k) => v(env, k) !== "");

  const problems: string[] = [];
  const add = (name: string, r: FeatureReport) => {
    if (!r.enabled) return;
    if (r.missing.length) problems.push(`${name}: missing ${r.missing.join(", ")}`);
    for (const i of r.invalid) problems.push(`${name}: ${i}`);
  };
  add("SMS", sms);
  add("Voice", voice);
  add("10DLC", tendlc);
  if (stale.length) problems.push(`Stale Twilio vars still set (remove them): ${stale.join(", ")}`);
  return { sms, voice, tendlc, stale, problems };
}

/** Telnyx messaging config, or null when SMS is off OR misconfigured (fail closed). */
export function smsConfigFrom(env: EnvLike = process.env as EnvLike): SmsConfig | null {
  const r = commsEnvReport(env).sms;
  if (!r.ok) return null;
  return {
    provider: "telnyx",
    apiKey: v(env, "SMS_API_KEY"),
    messagingProfileId: v(env, "SMS_MESSAGING_PROFILE_ID"),
    fromNumber: v(env, "SMS_FROM_NUMBER"),
    publicKey: v(env, "SMS_PUBLIC_KEY"),
  };
}

/** Voice config, or null when voice is off OR misconfigured (fail closed). */
export function voiceConfigFrom(env: EnvLike = process.env as EnvLike): VoiceConfig | null {
  const r = commsEnvReport(env).voice;
  if (!r.ok) return null;
  return {
    applicationId: v(env, "VOICE_APPLICATION_ID"),
    fromNumber: v(env, "VOICE_FROM_NUMBER"),
    forwardTo: v(env, "VOICE_FORWARD_TO"),
    recording: (v(env, "VOICE_RECORDING") || "all") as "all" | "off",
    announcement: (v(env, "VOICE_RECORDING_ANNOUNCEMENT") || "off") as "on" | "off",
    transcription: "telnyx",
    apiKey: v(env, "SMS_API_KEY"),
    publicKey: v(env, "SMS_PUBLIC_KEY"),
  };
}

/** Multi-line human summary for logs. */
export function formatCommsEnvReport(r: CommsEnvReport): string {
  const line = (name: string, f: FeatureReport) =>
    !f.enabled
      ? `${name}: inert (switch var unset)`
      : f.ok
        ? `${name}: configured`
        : `${name}: BROKEN — ${[...f.missing.map((m) => `missing ${m}`), ...f.invalid].join("; ")}`;
  return [
    line("SMS", r.sms),
    line("Voice", r.voice),
    line("10DLC", r.tendlc),
    ...(r.stale.length ? [`Stale Twilio vars: ${r.stale.join(", ")}`] : []),
  ].join("\n");
}
