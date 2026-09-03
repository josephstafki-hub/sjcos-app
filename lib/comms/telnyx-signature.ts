// Telnyx webhook signature verification (API V2, Ed25519). ONE implementation
// shared by the messaging webhook (app/api/sms/webhook) and the voice webhook
// (app/api/voice/webhook): both are signed with the same public key.
//
// Procedure (Telnyx docs):
//   1. Read the RAW request body as text — before any JSON parsing. Parsing
//      and re-stringifying changes the bytes and breaks the signature.
//   2. Signed payload = `${telnyx-timestamp}|${rawBody}`.
//   3. Verify the base64 `telnyx-signature-ed25519` header against the
//      account's public key (raw 32-byte Ed25519 key, base64) using Node's
//      built-in crypto — the raw key is wrapped in the SPKI DER prefix to
//      build a KeyObject.
//   4. Reject timestamps more than TOLERANCE_S old (replay guard). A small
//      future skew is tolerated for clock drift.
//
// Pure module: no db, no server-only, so tests prove it with a locally
// generated keypair before any Telnyx account exists.

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

export const TOLERANCE_S = 5 * 60;
const FUTURE_SKEW_S = 60;

// DER prefix for an Ed25519 SubjectPublicKeyInfo (RFC 8410): the raw 32-byte
// key follows these 12 bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Build a KeyObject from Telnyx's base64 raw public key. Throws on garbage. */
export function publicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64.trim(), "base64");
  if (raw.length !== 32) throw new Error(`Ed25519 public key must be 32 bytes, got ${raw.length}`);
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export interface VerifyInput {
  rawBody: string;
  /** `telnyx-timestamp` header (unix seconds). */
  timestamp: string | null | undefined;
  /** `telnyx-signature-ed25519` header (base64). */
  signature: string | null | undefined;
  /** Base64 raw Ed25519 public key (SMS_PUBLIC_KEY). */
  publicKeyB64: string;
  /** Test seam; defaults to now. */
  nowMs?: number;
}

export function verifyTelnyxSignature(input: VerifyInput): VerifyResult {
  const ts = (input.timestamp ?? "").trim();
  const sig = (input.signature ?? "").trim();
  if (!ts) return { ok: false, reason: "missing telnyx-timestamp header" };
  if (!sig) return { ok: false, reason: "missing telnyx-signature-ed25519 header" };
  if (!/^\d+$/.test(ts)) return { ok: false, reason: "telnyx-timestamp is not a unix timestamp" };

  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const age = now - Number(ts);
  if (age > TOLERANCE_S) {
    return { ok: false, reason: `telnyx-timestamp is ${age}s old (limit ${TOLERANCE_S}s) — replay rejected` };
  }
  if (age < -FUTURE_SKEW_S) return { ok: false, reason: `telnyx-timestamp is ${-age}s in the future` };

  let key: KeyObject;
  try {
    key = publicKeyFromBase64(input.publicKeyB64);
  } catch (e) {
    return { ok: false, reason: `bad SMS_PUBLIC_KEY: ${(e as Error).message}` };
  }
  const sigBytes = Buffer.from(sig, "base64");
  if (sigBytes.length !== 64) return { ok: false, reason: `signature must be 64 bytes, got ${sigBytes.length}` };

  const data = Buffer.from(`${ts}|${input.rawBody}`, "utf8");
  let good = false;
  try {
    good = cryptoVerify(null, data, key, sigBytes);
  } catch (e) {
    return { ok: false, reason: `verify threw: ${(e as Error).message}` };
  }
  return good ? { ok: true } : { ok: false, reason: "signature does not match body" };
}
