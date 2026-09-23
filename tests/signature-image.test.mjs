import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignatureDataUrl, pngDimensions, SIGNATURE_PNG_MAX_BYTES } from "../lib/signature-image.ts";

// A 1×1 transparent PNG — the smallest real PNG the pad could ever produce.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const TINY_PNG_URL = `data:image/png;base64,${TINY_PNG_B64}`;

test("empty / missing → null (caller decides whether that's allowed)", () => {
  assert.equal(parseSignatureDataUrl(undefined), null);
  assert.equal(parseSignatureDataUrl(null), null);
  assert.equal(parseSignatureDataUrl(""), null);
  assert.equal(parseSignatureDataUrl("   "), null);
});

test("a real PNG data URL decodes to bytes with the PNG magic", () => {
  const r = parseSignatureDataUrl(TINY_PNG_URL);
  assert.ok(r && r.ok);
  assert.equal(r.png.readUInt8(1), 0x50); // 'P'
  assert.deepEqual(pngDimensions(r.png), { width: 1, height: 1 });
});

test("the prefix match is case-insensitive and tolerant of surrounding whitespace", () => {
  const r = parseSignatureDataUrl(`  DATA:IMAGE/PNG;BASE64,${TINY_PNG_B64}\n`);
  assert.ok(r && r.ok);
});

test("a JPEG / SVG / plain-text payload is refused", () => {
  assert.equal(parseSignatureDataUrl("data:image/jpeg;base64,/9j/4AAQ").ok, false);
  assert.equal(parseSignatureDataUrl("data:image/svg+xml;base64,PHN2Zz4=").ok, false);
  assert.equal(parseSignatureDataUrl("hello").ok, false);
});

test("a PNG data URL whose bytes aren't PNG is refused", () => {
  const fake = Buffer.from("this is not a png at all, just some text bytes").toString("base64");
  const r = parseSignatureDataUrl(`data:image/png;base64,${fake}`);
  assert.equal(r.ok, false);
  assert.match(r.error, /valid PNG/);
});

test("oversized payloads are refused before decoding", () => {
  const big = "A".repeat(Math.ceil((SIGNATURE_PNG_MAX_BYTES * 4) / 3) + 4096);
  const r = parseSignatureDataUrl(`data:image/png;base64,${big}`);
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
});
