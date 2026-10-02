import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSignature, squareSignature } from "../lib/payments/square/signature.ts";
import { squareEnvironment } from "../lib/payments/square/index.ts";

// Known vector: base64(HMAC-SHA256(key, notification_url + raw_body)),
// computed independently with `openssl dgst -sha256 -hmac` semantics.
const KEY = "wbBB2iN4TjNhHrm5r3vSyw";
const URL = "https://os.example.test/api/webhooks/square";
const BODY =
  '{"merchant_id":"MLEFBHHSJGVHD","type":"payment.updated","event_id":"6a8f5f28-54a1-4eb0-a98a-3111513fd4fc","created_at":"2026-09-23T15:04:05.000Z","data":{"type":"payment","id":"KkAkhdMsgzn59SM8A89WgKwekxLZY","object":{"payment":{"id":"KkAkhdMsgzn59SM8A89WgKwekxLZY","status":"COMPLETED","amount_money":{"amount":12500,"currency":"USD"}}}}}';
const SIG = "KmojDZ/BZAXd87bAwrU7c87Pznb7SWdqPtqavMirZFU=";

test("Square webhook signature: known vector verifies; any drift refuses", () => {
  assert.equal(squareSignature(KEY, URL, BODY), SIG);
  assert.equal(verifyWebhookSignature(BODY, SIG, URL, KEY), true);
  assert.equal(verifyWebhookSignature(Buffer.from(BODY), SIG, URL, KEY), true, "raw buffer body");
  assert.equal(verifyWebhookSignature(BODY + " ", SIG, URL, KEY), false, "body re-serialized / padded");
  assert.equal(verifyWebhookSignature(BODY, SIG, URL + "/", KEY), false, "trailing slash on the notification url");
  assert.equal(verifyWebhookSignature(BODY, SIG, URL, "other-key"), false);
  assert.equal(verifyWebhookSignature(BODY, SIG.slice(0, -2) + "==", URL, KEY), false, "tampered signature");
  assert.equal(verifyWebhookSignature(BODY, null, URL, KEY), false);
  assert.equal(verifyWebhookSignature(BODY, SIG, URL, ""), false, "no key configured → never verifies");
  assert.equal(verifyWebhookSignature(BODY, "short", URL, KEY), false, "length mismatch is a refusal, not a throw");
});

test("adapter selection never picks the real Square without an explicit env + token, and never when outbound is disabled", () => {
  assert.equal(squareEnvironment({}), "fake");
  assert.equal(squareEnvironment({ SQUARE_ENV: "sandbox" }), "fake", "no token");
  assert.equal(squareEnvironment({ SQUARE_ACCESS_TOKEN: "x" }), "fake", "no env");
  assert.equal(squareEnvironment({ SQUARE_ENV: "sandbox", SQUARE_ACCESS_TOKEN: "x" }), "sandbox");
  assert.equal(squareEnvironment({ SQUARE_ENV: "production", SQUARE_ACCESS_TOKEN: "x" }), "production");
  assert.equal(squareEnvironment({ SQUARE_ENV: "prod", SQUARE_ACCESS_TOKEN: "x" }), "fake", "unknown env name");
  assert.equal(squareEnvironment({ SQUARE_ENV: "production", SQUARE_ACCESS_TOKEN: "x", SJC_OUTBOUND_DISABLED: "1" }), "fake");
});
