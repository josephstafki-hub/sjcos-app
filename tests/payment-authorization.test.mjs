import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizationStatement, cleanSignerName, requestIp } from "../lib/payments/authorization.ts";

const base = { signerName: "Chuck Spaeth", method: "card", invoiceNumber: "INV-003", milestone: "Deposit", projectLabel: "3567 Hickory Circle, Prior Lake", amountCents: 2204356, surchargeCents: 0 };

test("card statement names the cardholder, amount, invoice and project", () => {
  const s = authorizationStatement(base);
  assert.match(s, /^I, Chuck Spaeth, am the cardholder/);
  assert.match(s, /charge \$22,043\.56 one time/);
  assert.match(s, /invoice INV-003 \(Deposit\) for the project at 3567 Hickory Circle, Prior Lake\.$/);
  assert.doesNotMatch(s, /surcharge/);
});

test("a surcharged card states the total and the split", () => {
  const s = authorizationStatement({ ...base, amountCents: 100000, surchargeCents: 3000 });
  assert.match(s, /charge \$1,030\.00 one time/);
  assert.match(s, /\$1,000\.00 invoice balance plus a \$30\.00 credit card surcharge/);
});

test("bank transfer statement is a one-time debit", () => {
  const s = authorizationStatement({ ...base, method: "ach" });
  assert.match(s, /account holder/);
  assert.match(s, /debit \$22,043\.56 one time from the bank account/);
});

test("signer names are cleaned and junk refused", () => {
  assert.equal(cleanSignerName("  Chuck   Spaeth "), "Chuck Spaeth");
  for (const bad of ["", " ", "1", "12345", null, 42, "x".repeat(121)]) assert.equal(cleanSignerName(bad), null);
});

test("client IP comes from nginx, not a forged forwarded-for", () => {
  const h = (o) => ({ get: (k) => o[k] ?? null });
  assert.equal(requestIp(h({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4, 198.51.100.7" })), "198.51.100.7");
  assert.equal(requestIp(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" })), "198.51.100.7");
  assert.equal(requestIp(h({})), "");
});
