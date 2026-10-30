-- 0036 — Credit card surcharge on online card payments (lib/payments/surcharge.ts).
--
-- Square's surcharge setting only covers in-person payments, so the portal
-- checkout adds it: a credit card (not debit / prepaid) pays enough on top of
-- the invoice balance to cover Square's fee, capped per brand.
--
-- payment_attempts.amount_cents stays what Square charges (invoice share +
-- surcharge); surcharge_cents is the part that is NOT credited to the
-- invoice. card_brand / card_type are Square's reading of the card.

ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS surcharge_cents integer NOT NULL DEFAULT 0;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS card_brand text;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS card_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_surcharge_check') THEN
    ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_surcharge_check
      CHECK (surcharge_cents >= 0 AND surcharge_cents < amount_cents AND (surcharge_cents = 0 OR method = 'card'));
  END IF;
END $$;

-- Joe's settings: Square took 4.0% on the live card payments; 3% is the cap
-- (Visa's). Editable on Settings › Payments.
INSERT INTO app_settings (key, value)
VALUES ('payments.card_surcharge', '{"feePct":4,"capPct":3,"brandCapPct":{}}')
ON CONFLICT (key) DO NOTHING;
