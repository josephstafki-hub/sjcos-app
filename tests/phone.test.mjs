import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeE164, isE164, last10, formatUsPhone, toE164 } from "../lib/comms/phone.ts";

test("10-digit US numbers get +1", () => {
  assert.deepEqual(normalizeE164("6125551234"), { ok: true, e164: "+16125551234" });
  assert.deepEqual(normalizeE164("(612) 555-1234"), { ok: true, e164: "+16125551234" });
  assert.deepEqual(normalizeE164(" 612.555.1234 "), { ok: true, e164: "+16125551234" });
});

test("11-digit numbers with a leading 1 are accepted", () => {
  assert.deepEqual(normalizeE164("16125551234"), { ok: true, e164: "+16125551234" });
  assert.deepEqual(normalizeE164("+1 612 555 1234"), { ok: true, e164: "+16125551234" });
  assert.equal(toE164("+16125551234"), "+16125551234");
});

test("everything else is rejected, never guessed", () => {
  for (const bad of ["", "   ", "555-1234", "+44 20 7946 0958", "612555123", "26125551234", "+1612555123", "0125551234", "1125551234"]) {
    const r = normalizeE164(bad);
    assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.ok(r.error.length > 0);
  }
  assert.throws(() => toE164("555-1234"));
});

test("isE164 is strict", () => {
  assert.equal(isE164("+16125551234"), true);
  assert.equal(isE164("16125551234"), false);
  assert.equal(isE164("+11125551234"), false);
  assert.equal(isE164(null), false);
});

test("last10 + formatting", () => {
  assert.equal(last10("+1 (612) 555-1234"), "6125551234");
  assert.equal(formatUsPhone("+16125551234"), "(612) 555-1234");
  assert.equal(formatUsPhone("bogus"), "bogus");
});
