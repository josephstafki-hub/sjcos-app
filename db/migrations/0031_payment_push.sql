-- 0031 — Tell Joe when a client pays online.
-- A Square payment that completes (card, or a bank transfer that cleared),
-- a bank transfer the client just started, and one the bank returned each
-- drop a 'money' card on Joe's bell and a Telegram push
-- (lib/payments/owner-alert.ts). The push row is written inside the payment's
-- transaction, so push_outbox needs to accept the new 'payment' kind.

ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed','voice_call','comms','decision','payment'));
