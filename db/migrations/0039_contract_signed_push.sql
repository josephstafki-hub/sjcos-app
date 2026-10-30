-- 0039 — Tell Joe when a client signs the contract.
-- A signed construction contract (portal or in person) drops a card on Joe's
-- bell and a Telegram push (lib/actions/esign.ts → notifyOwner), so
-- push_outbox needs to accept the new 'contract_signed' kind.

ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed','voice_call','comms','decision','payment','contract_signed'));
