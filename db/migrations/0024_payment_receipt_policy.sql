-- 0024 — Client payment receipts (lib/payments/receipt.ts).
-- Square does not email receipts for Payments API charges. When a Square
-- payment completes, the app emails the client "payment received" with the
-- Square receipt link. Seeded as a draft like every policy; Joe asked
-- (2026-10-10) for these to go out automatically, so it is activated by hand
-- after this migration, not here. With it inactive each receipt waits as a
-- decision instead.

INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('payment.receipt', 1,
   '{"lane":"sends","trigger":"square_payment_completed","excludes":["pending_ach"],"recipient":"project_client_email"}'::jsonb,
   'draft', 'claude-code',
   'Email the client a short payment-received note with the Square receipt link when a Square card or bank-transfer payment completes. One per payment; never for a bank transfer that is still pending.')
ON CONFLICT (key, version) DO NOTHING;
