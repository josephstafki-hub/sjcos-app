import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SURCHARGE,
  maxSurchargePct,
  offsetPct,
  parseSurchargeConfig,
  surchargeCents,
  surchargeNotice,
  surchargePct,
  surchargeable,
} from "../lib/payments/surcharge.ts";

const credit = (brand = "VISA") => ({ brand, cardType: "CREDIT", prepaidType: "NOT_PREPAID" });

test("covering Square's fee: 4% of the total = 4.17% of the balance, held to the cap", () => {
  assert.equal(offsetPct({ feePct: 4, capPct: 3, brandCapPct: {} }).toFixed(4), "4.1667");
  assert.equal(surchargePct(DEFAULT_SURCHARGE, "VISA"), 3);
  assert.equal(surchargeCents(2200000, DEFAULT_SURCHARGE, credit()), 66000);
  // a lower fee than the cap: charge only what covers it, rounded down
  const cheap = { feePct: 2.5, capPct: 3, brandCapPct: {} };
  assert.equal(surchargeCents(100000, cheap, credit()), 2564, "2.5 / 97.5 = 2.564%");
  assert.equal(surchargeCents(333, DEFAULT_SURCHARGE, credit()), 9, "rounded down, never over the cap");
});

test("per-brand caps; debit, prepaid and unknown cards pay nothing", () => {
  const cfg = { feePct: 4, capPct: 3, brandCapPct: { MASTERCARD: 4, AMERICAN_EXPRESS: 5 } };
  assert.equal(surchargeCents(100000, cfg, credit("VISA")), 3000);
  assert.equal(surchargeCents(100000, cfg, credit("MASTERCARD")), 4000);
  assert.equal(surchargeCents(100000, cfg, credit("AMERICAN_EXPRESS")), 4166, "cap above the fee: exactly covers the fee");
  assert.equal(surchargeCents(100000, cfg, { brand: "VISA", cardType: "DEBIT", prepaidType: "NOT_PREPAID" }), 0);
  assert.equal(surchargeCents(100000, cfg, { brand: "VISA", cardType: "CREDIT", prepaidType: "PREPAID" }), 0);
  assert.equal(surchargeCents(100000, cfg, { brand: "VISA", cardType: "UNKNOWN_CARD_TYPE" }), 0);
  assert.equal(surchargeCents(100000, cfg, null), 0);
  assert.equal(surchargeable({ cardType: "credit", prepaidType: "UNKNOWN_PREPAID_TYPE" }), true);
  assert.equal(maxSurchargePct(cfg).toFixed(4), "4.1667");
});

test("notice text follows the setting; fee 0 turns it off; parse clamps", () => {
  assert.equal(surchargeNotice(DEFAULT_SURCHARGE), "Credit card payments carry a 3% surcharge to cover card processing fees. Debit cards, bank transfer and check have no fee.");
  assert.match(surchargeNotice({ feePct: 4, capPct: 3, brandCapPct: { MASTERCARD: 4 } }), /a surcharge of up to 4% to cover/);
  assert.equal(surchargeNotice({ feePct: 0, capPct: 3, brandCapPct: {} }), null);
  assert.equal(surchargeCents(100000, { feePct: 0, capPct: 3, brandCapPct: {} }, credit()), 0);
  assert.deepEqual(parseSurchargeConfig(null), DEFAULT_SURCHARGE);
  assert.deepEqual(parseSurchargeConfig("not json"), DEFAULT_SURCHARGE);
  assert.deepEqual(parseSurchargeConfig('{"feePct":4,"capPct":9,"brandCapPct":{"visa":2,"x":"nope"}}'), { feePct: 4, capPct: 5, brandCapPct: { VISA: 2 } });
});
