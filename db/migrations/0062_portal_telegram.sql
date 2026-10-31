-- 0062 — Portal messages on Telegram (Joe, 2026-10-31).
--
-- A client (or sub) message in the portal now pushes to Joe's phone with the
-- message text. When he swipes-to-reply on that push, his text is posted into
-- the same portal thread as him (lib/decisions/owner-replies.ts
-- recordPortalReply). The push's Telegram message id is remembered here with
-- the thread it came from:
--
--   telegram_reply_targets.portal_channel_key   chat_messages.channel_key of the
--                                               thread (portal:<slug>,
--                                               portal:lead:<slug>, dm:<sub>)
--   telegram_reply_targets.portal_message_id    the message the push was about
--
-- Only an explicit reply to that push posts anything. A loose message to the
-- bot never reaches a client.

ALTER TABLE telegram_reply_targets ADD COLUMN IF NOT EXISTS portal_channel_key text;
ALTER TABLE telegram_reply_targets ADD COLUMN IF NOT EXISTS portal_message_id bigint;

-- push_outbox accepts the new 'portal_message' kind (parked overnight in quiet
-- hours like every other push).
ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed','voice_call','comms','decision','payment','contract_signed','portal_message'));
