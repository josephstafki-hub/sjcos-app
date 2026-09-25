// Square webhook signature verification (A20). Pure.
//
// Square signs each notification as
//   base64( HMAC-SHA256( signature_key, notification_url + raw_body ) )
// and sends it in the `x-square-hmacsha256-signature` header. The URL must be
// EXACTLY the notification URL registered in the Square developer dashboard
// (scheme, host, path — no trailing-slash drift), and the body must be the raw
// bytes as received, never re-serialized JSON.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SQUARE_SIGNATURE_HEADER = "x-square-hmacsha256-signature";

export function squareSignature(signatureKey: string, notificationUrl: string, rawBody: string | Buffer): string {
  const h = createHmac("sha256", signatureKey);
  h.update(notificationUrl);
  h.update(rawBody);
  return h.digest("base64");
}

export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null | undefined, notificationUrl: string, signatureKey: string): boolean {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const expected = Buffer.from(squareSignature(signatureKey, notificationUrl, rawBody));
  const given = Buffer.from(signatureHeader.trim());
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
