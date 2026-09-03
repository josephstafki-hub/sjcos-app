import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyTelnyxSignature, publicKeyFromBase64, TOLERANCE_S } from "../lib/comms/telnyx-signature.ts";

// A locally generated Ed25519 keypair stands in for Telnyx's. The raw public
// key is the last 32 bytes of the SPKI DER — exactly what Telnyx hands out.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const pubB64 = rawPub.toString("base64");

const body = JSON.stringify({ data: { event_type: "message.received", payload: { text: "hi", to: [{ phone_number: "+17735550002" }] } } });
const now = 1_760_000_000_000;
const ts = String(Math.floor(now / 1000) - 5);
const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");

test("accepts a valid signature", () => {
  const r = verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: sig, publicKeyB64: pubB64, nowMs: now });
  assert.deepEqual(r, { ok: true });
});

test("publicKeyFromBase64 round-trips the raw key", () => {
  const k = publicKeyFromBase64(pubB64);
  assert.equal(k.asymmetricKeyType, "ed25519");
  assert.throws(() => publicKeyFromBase64("AAAA"), /32 bytes/);
});

test("rejects a tampered body", () => {
  const r = verifyTelnyxSignature({ rawBody: body.replace("hi", "hi!"), timestamp: ts, signature: sig, publicKeyB64: pubB64, nowMs: now });
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not match/);
});

test("rejects a re-serialized body (bytes changed)", () => {
  const reserialized = JSON.stringify(JSON.parse(body), null, 2);
  const r = verifyTelnyxSignature({ rawBody: reserialized, timestamp: ts, signature: sig, publicKeyB64: pubB64, nowMs: now });
  assert.equal(r.ok, false);
});

test("rejects a wrong key", () => {
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const r = verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: sig, publicKeyB64: other, nowMs: now });
  assert.equal(r.ok, false);
});

test("rejects a timestamp older than 5 minutes (replay)", () => {
  const old = String(Math.floor(now / 1000) - TOLERANCE_S - 1);
  const oldSig = sign(null, Buffer.from(`${old}|${body}`), privateKey).toString("base64");
  const r = verifyTelnyxSignature({ rawBody: body, timestamp: old, signature: oldSig, publicKeyB64: pubB64, nowMs: now });
  assert.equal(r.ok, false);
  assert.match(r.reason, /replay/);
});

test("accepts a timestamp just inside the window", () => {
  const edge = String(Math.floor(now / 1000) - TOLERANCE_S + 1);
  const edgeSig = sign(null, Buffer.from(`${edge}|${body}`), privateKey).toString("base64");
  const r = verifyTelnyxSignature({ rawBody: body, timestamp: edge, signature: edgeSig, publicKeyB64: pubB64, nowMs: now });
  assert.equal(r.ok, true);
});

test("rejects missing headers and garbage", () => {
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: null, signature: sig, publicKeyB64: pubB64, nowMs: now }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: null, publicKeyB64: pubB64, nowMs: now }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: "yesterday", signature: sig, publicKeyB64: pubB64, nowMs: now }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: "not-64-bytes", publicKeyB64: pubB64, nowMs: now }).ok, false);
  assert.equal(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signature: sig, publicKeyB64: "nope", nowMs: now }).ok, false);
});
